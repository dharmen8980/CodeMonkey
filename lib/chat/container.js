const fs = require('fs');
const path = require('path');
const { exec, execFile, spawn } = require('child_process');

const {
  CHAT_DIR, CHAT_BOOT_TIMEOUT_MS, CHAT_MAX_SESSIONS, CHAT_IMAGE, ORCH_DATA_MOUNTS,
  chatContainerName, chatEnvFile,
} = require('./config');
const { loadClaudeSession, clearClaudeSession } = require('./history');

// chatId -> { id, createdAt, lastSeen, busy, pending, containerName, containerReady }
const chatSessions = new Map();

// No idle reaper: containers persist until killed or replaced after an image rebuild.
function getOrCreateChat(chatId) {
  let s = chatSessions.get(chatId);
  if (s) { s.lastSeen = Date.now(); return s; }
  if (chatSessions.size >= CHAT_MAX_SESSIONS) return null;
  s = {
    id: chatId, createdAt: Date.now(), lastSeen: Date.now(),
    busy: false, pending: null,
    containerName: chatContainerName(chatId), containerReady: false,
    claudeSessionId: null,   // set after the first turn; used to --resume later turns
  };
  chatSessions.set(chatId, s);
  return s;
}

// Is a container with this name up right now? (Survives an orchestrator restart —
// detached containers keep running, so we adopt rather than double-boot.)
function dockerRunning(name, cb) {
  exec(`docker inspect -f '{{.State.Running}}' ${name} 2>/dev/null`, (err, stdout) => {
    cb(!err && String(stdout).trim() === 'true');
  });
}

function listRunningChatContainers(cb) {
  execFile('docker', ['ps', '--filter', 'name=ai-chat-', '--format', '{{.Names}}'], (err, stdout) => {
    cb(new Set(err ? [] : String(stdout).trim().split('\n').filter(Boolean)));
  });
}

// A rebuilt tag must replace the old container and its native Claude session;
// adopting it would preserve the previous instructions indefinitely.
function chatImageCurrent(name, cb) {
  execFile('docker', ['image', 'inspect', '-f', '{{.Id}}', CHAT_IMAGE], (err, wanted) => {
    if (err) return cb(new Error(`Cannot inspect ${CHAT_IMAGE}; build the chat image before starting a turn`));
    execFile('docker', ['inspect', '-f', '{{.Image}}', name], (inspectError, actual) => {
      cb(inspectError, !inspectError && wanted.trim() === actual.trim());
    });
  });
}

// Poll the bind-mounted session dir for the readiness marker the boot script writes.
function waitForChatReady(sessionDir, ok, fail) {
  const readyPath = path.join(sessionDir, 'ready');
  const errPath = path.join(sessionDir, 'boot-error');
  const deadline = Date.now() + CHAT_BOOT_TIMEOUT_MS;
  (function poll() {
    if (fs.existsSync(readyPath)) return ok();
    if (fs.existsSync(errPath)) {
      let d = ''; try { d = fs.readFileSync(errPath, 'utf8'); } catch { /* ignore */ }
      return fail(new Error('container boot error: ' + d.trim()));
    }
    if (Date.now() > deadline) return fail(new Error('container boot timed out'));
    setTimeout(poll, 500);
  })();
}

// Make sure a warm container exists for this session, booting one if needed.
// cb(err). On success session.containerReady is true and a `docker exec` will land.
function ensureChatContainer(session, cb) {
  const name = session.containerName;
  const sessionDir = path.join(CHAT_DIR, session.id);
  fs.mkdirSync(sessionDir, { recursive: true });

  dockerRunning(name, (running) => {
    if (running) {
      // Adopt an existing container (server restarted, or a prior boot we lost track of).
      // Its claude session store is intact, so recover the session id from disk if we
      // lost the in-memory copy — resume can keep working across a server restart.
      return chatImageCurrent(name, (error, current) => {
        if (error) return cb(error);
        if (!current) return killChatContainer(session, err => err ? cb(err) : ensureChatContainer(session, cb));
        waitForChatReady(sessionDir,
          () => {
            session.containerReady = true;
            if (!session.claudeSessionId) session.claudeSessionId = loadClaudeSession(session.id);
            cb(null);
          },
          (err) => cb(err));
      });
    }

    // Fresh boot. Clear any stale container record + markers first.
    exec(`docker rm -f ${name} 2>/dev/null`, () => {
      for (const f of ['ready', 'boot-error']) {
        try { fs.rmSync(path.join(sessionDir, f), { force: true }); } catch { /* ignore */ }
      }
      fs.writeFileSync(path.join(sessionDir, 'env'), chatEnvFile());

      const args = [
        'run', '-d',
        '--name', name,
        '--memory=2g', '--cpus=2', '--pids-limit=512',
        '--env-file', path.join(sessionDir, 'env'),
        '-v', `${sessionDir}:/workspace/io:rw`,
        // Always mounted (unlike teams-chat's optional export) — the orchestrator-logs
        // MCP server reads these for the pull-based run/ticket detail tools.
        '-v', `${ORCH_DATA_MOUNTS.tasksFile}:/workspace/orch-data/tasks.json:ro`,
        '-v', `${ORCH_DATA_MOUNTS.pipelineFile}:/workspace/orch-data/pipeline.json:ro`,
        '-v', `${ORCH_DATA_MOUNTS.artifactsDir}:/workspace/orch-data/artifacts:ro`,
        '-v', `${ORCH_DATA_MOUNTS.logsDir}:/workspace/orch-data/logs:ro`,
      ];
      // Optional: exported Teams chat JSON for the teams-chat MCP server (see
      // chat/teams-chat-mcp-server.py). Read-only; unset means the tool has nothing to read.
      if (process.env.TEAMS_CHAT_EXPORT_DIR) {
        args.push('-v', `${process.env.TEAMS_CHAT_EXPORT_DIR}:/workspace/exports:ro`);
      }
      args.push(CHAT_IMAGE);
      console.log(`\n🚀 Booting long-lived chat container ${name}`);
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let errout = '';
      child.stderr.on('data', d => { errout += d; });
      child.on('error', (e) => cb(e));
      child.on('close', (code) => {
        if (code !== 0) return cb(new Error(`docker run exited ${code}: ${errout.slice(-300)}`));
        waitForChatReady(sessionDir,
          () => {
            session.containerReady = true;
            // Brand-new container = empty claude session store. Any prior session id is
            // now dead, so drop it; the next turn starts fresh (with transcript replay).
            session.claudeSessionId = null;
            clearClaudeSession(session.id);
            console.log(`   ✅ ${name} ready`);
            cb(null);
          },
          (err) => cb(err));
      });
    });
  });
}

// Remove a session container for a UI kill or replacement after rebuilding the image.
function killChatContainer(session, cb) {
  const name = session?.containerName || chatContainerName(session?.id || '');
  exec(`docker rm -f ${name} 2>/dev/null`, (err) => {
    if (err) { if (cb) cb(err); return; }
    if (session) { session.containerReady = false; session.claudeSessionId = null; }
    // The native claude session died with the container; drop the stored id.
    if (session?.id) clearClaudeSession(session.id);
    if (cb) cb();
  });
}

module.exports = { chatSessions, getOrCreateChat, dockerRunning, listRunningChatContainers, chatImageCurrent, waitForChatReady, ensureChatContainer, killChatContainer };
