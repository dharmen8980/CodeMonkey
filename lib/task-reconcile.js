const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { ARTIFACTS_DIR, TIMEOUT_MS } = require('./config');
const { loadTasks, mutateTasks, updateTask } = require('./task-store');
const { readArtifactUsage } = require('./usage');
const { finalizeRun } = require('./agent-finalize');

// tasks.json is a derived, mutable operational log; artifacts/<run>/manifest.json is
// the durable per-run record. If the two drift (a restart wiped tasks.json, an
// overlapping process clobbered it, a usage write-back was lost), rebuild the missing
// entries from the manifests so the dashboard/chat totals reflect every run on disk.
// Runs its own reconcile on startup and self-heals going forward.
function reconcileTasksFromArtifacts() {
  let scanned = 0, added = 0;
  try {
    const dirs = fs.readdirSync(ARTIFACTS_DIR).filter(d => {
      if (!/^[a-f0-9]{16}$/.test(d)) return false;   // run-id dirs only (skips logs/, tmp)
      try { return fs.statSync(path.join(ARTIFACTS_DIR, d)).isDirectory(); } catch { return false; }
    });
    mutateTasks(tasks => {
      const known = new Set([...tasks.map(t => t.run_id), ...tasks.map(t => t.id)].filter(Boolean));
      for (const dir of dirs) {
        const manifestPath = path.join(ARTIFACTS_DIR, dir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;    // aborted run, nothing to count
        scanned += 1;
        let m;
        try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }
        if (known.has(m.run_id) || known.has(m.task_id)) continue;

        // Normalize usage so `usage.cost_usd` always exists (two-phase manifests carry
        // total_cost_usd instead), because that's the field every total sums on.
        let usage = m.usage || null;
        if (usage && usage.cost_usd == null && usage.total_cost_usd != null) {
          usage = { ...usage, cost_usd: usage.total_cost_usd };
        }

        tasks.push({
          id: m.task_id || m.run_id,
          task_type: m.task_type || 'new-task',
          description: m.task || '',
          source: m.source || 'unknown',
          status: m.status || 'completed',
          received_at: m.started_at || null,
          started_at: m.started_at || null,
          finished_at: m.finished_at || null,
          duration_ms: m.duration_ms || null,
          run_id: m.run_id || dir,
          run_dir: path.join(ARTIFACTS_DIR, dir),
          mr_url: m.mr_url || null,
          usage,
          backfilled: true,   // provenance: reconstructed from manifest, not live-recorded
        });
        known.add(m.run_id); known.add(m.task_id);
        added += 1;
      }
      return null;
    });
  } catch (e) {
    console.log(`   ⚠️  Task reconcile skipped: ${e.message}`);
    return;
  }
  if (added) console.log(`   🔁 Reconciled ${added} run(s) from artifacts into tasks.json (scanned ${scanned} manifests)`);
}

// --- Startup reconciliation for tasks orphaned by a server crash/restart ---
//
// spawnAgent's finalizeRun only ever runs inside the exec() callback tied to the
// child process THIS server instance spawned. If the server dies (crash, manual
// kill, redeploy) while a container is running, that callback is lost forever and
// the task sits at status 'running' even after the container finishes — the exact
// bug found 2026-08-20 (MR !131's task: container finished, pushed, commented, but
// tasks.json never learned about it because the process died first).
//
// On every startup, for each task still marked 'running':
//   1. If artifacts/<run>/manifest.json already exists, the container finished
//      (successfully or not) before/after the restart — adopt that result directly.
//   2. Else if the container is still alive, reattach via `docker wait` (works for
//      any container regardless of which process spawned it) and re-run the normal
//      finalize path once it exits, preserving the original timeout deadline.
//   3. Else the container is gone with no manifest — it was killed or crashed with
//      no result ever written. Mark it failed rather than leaving it 'running' forever.
function reconcileRunningContainers() {
  const stuck = loadTasks().filter(t => t.status === 'running' && t.run_id);
  if (!stuck.length) return;

  console.log(`\n🔁 Reconciling ${stuck.length} task(s) left 'running' from a previous process...`);

  for (const task of stuck) {
    const runDir = task.run_dir || path.join(ARTIFACTS_DIR, task.run_id);
    const manifestPath = path.join(runDir, 'manifest.json');
    const containerName = task.container || `ai-agent-${task.run_id}`;

    if (fs.existsSync(manifestPath)) {
      adoptFromManifest(task, manifestPath);
      continue;
    }

    // No manifest.json means finalizeRun/the old exec() callback never ran (the
    // process died first — exactly the MR !131 incident). But usage.json /
    // implement-usage.json are written by the container's own entrypoint the moment
    // its claude run finishes, independent of this server — if they're present, the
    // run genuinely completed and we can reconstruct the result instead of wrongly
    // reporting a finished success as a failure just because nothing was there to
    // catch it.
    const startMs = task.started_at ? new Date(task.started_at).getTime() : Date.now();
    if (readArtifactUsage(runDir)) {
      console.log(`   ✅ ${task.id} (${containerName}): no manifest, but usage artifacts show the run finished — recovering as completed`);
      finalizeRun(task, task.run_id, containerName, runDir, task.started_at, startMs, { killedByTimeout: false, error: null });
      continue;
    }

    exec(`docker inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null`, (err, out) => {
      const running = !err && String(out).trim() === 'true';
      if (running) {
        reattachRunningContainer(task, containerName, runDir);
      } else {
        console.log(`   ⚠️  ${task.id} (${containerName}) was 'running' but the container is gone with no manifest — marking failed`);
        updateTask(task.id, {
          status: 'failed',
          error: 'Orchestrator restarted while this task was in progress and the container was gone with no result on disk (killed manually or during a restart before it could finish).',
          finished_at: new Date().toISOString(),
        });
      }
    });
  }
}

function adoptFromManifest(task, manifestPath) {
  let m;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) {
    console.log(`   ⚠️  ${task.id}: manifest.json unreadable (${e.message}), leaving as-is`);
    return;
  }
  console.log(`   ✅ ${task.id}: container had already finished (${m.status}) — backfilling from manifest`);
  updateTask(task.id, {
    status: m.status || 'completed',
    usage: m.usage || task.usage,
    finished_at: m.finished_at || new Date().toISOString(),
    duration_ms: m.duration_ms,
    mr_url: m.mr_url || task.mr_url,
    error: m.status === 'failed' || m.status === 'timeout' ? (task.error || `run exited with status ${m.status}`) : task.error,
  });
}

// `docker wait` blocks until the named container stops and prints its exit code —
// it works for a container this process didn't spawn, which is exactly what we need
// after a restart. The container runs with --rm, but removal happens only after it
// stops, so the wait itself is unaffected.
function reattachRunningContainer(task, containerName, runDir) {
  console.log(`   🔌 ${task.id}: container ${containerName} is still running — reattaching`);
  const startMs = task.started_at ? new Date(task.started_at).getTime() : Date.now();
  const remaining = TIMEOUT_MS - (Date.now() - startMs);

  let killedByTimeout = false;
  const timer = setTimeout(() => {
    killedByTimeout = true;
    console.log(`\n⏱️  Timeout reached for reattached ${containerName}, killing...`);
    exec(`docker kill ${containerName}`, (err) => {
      if (err) console.log(`   Warning: docker kill failed: ${err.message}`);
    });
  }, Math.max(remaining, 0));

  exec(`docker wait ${containerName}`, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout) => {
    clearTimeout(timer);
    const exitCode = parseInt(String(stdout).trim(), 10);
    const waitError = !error && exitCode !== 0 ? new Error(`container exited with code ${exitCode}`) : error;
    finalizeRun(task, task.run_id, containerName, runDir, task.started_at, startMs, {
      killedByTimeout, error: waitError,
    });
  });
}

module.exports = { reconcileTasksFromArtifacts, reconcileRunningContainers, adoptFromManifest, reattachRunningContainer };
