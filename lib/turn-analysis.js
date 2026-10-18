const fs = require('fs');
const path = require('path');
const { ARTIFACTS_DIR } = require('./config');
const { loadTasks } = require('./task-store');
const { PRICE_PER_MTOK, estimateTrackedCostFromTranscript } = require('./pricing');

const RUN_ID_RE = /^[a-f0-9]{16}$/;

// Ordered so the first matching rule wins for commands that could satisfy more
// than one bucket (e.g. `git log -- ...` mentions a path but is git bookkeeping,
// not discovery).
function classifyBash(command) {
  const cmd = (command || '').trim();
  if (/^(git|glab)\b/.test(cmd)) return 'git';
  if (/\bdotnet\s+(build|test|format)\b|\bnpm\s+(run\s+build|test|install)\b/.test(cmd)) return 'build_test';
  if (/^(grep|find|ls|cat|head|tail|wc)\b/.test(cmd)) return 'discovery';
  if (/^mkdir\b/.test(cmd)) return 'edit';
  return 'other';
}

function classifyToolUse(name, input) {
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') return 'edit';
  if (name === 'Read' || name === 'Glob' || name === 'Grep') return 'discovery';
  if (name === 'Bash') return classifyBash(input && input.command);
  if (name === 'GitCommit' || name === 'GitLabMrCreate' || name === 'GitLabMrNote') return 'git';
  if (name === 'BuildTest') return 'build_test';
  return 'other';
}

function translateHarnessTrace(events) {
  const translated = [];
  for (const event of events) {
    if (event.event === 'turn.completed') {
      const usage = event.usage || {};
      const toolCalls = Array.isArray(event.tool_calls) ? event.tool_calls : [];
      translated.push({
        type: 'assistant',
        message: {
          id: `harness-turn-${event.turn}`,
          usage: {
            input_tokens: usage.input_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_write_input_tokens,
            output_tokens: usage.output_tokens,
          },
          content: [
            { type: 'text', text: event.assistant_text || '' },
            ...toolCalls.map(call => ({
              type: 'tool_use',
              id: call.id,
              name: call.name,
              input: call.arguments,
            })),
          ],
        },
      });
    } else if (event.event === 'tool.completed') {
      translated.push({
        type: 'user',
        timestamp: event.timestamp,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: event.tool_call_id,
            content: event.success ? (event.result ?? '') : (event.error ?? ''),
            is_error: !event.success,
          }],
        },
      });
    }
  }
  return translated;
}

function parseTranscriptEvents(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  const events = [];
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch (e) { /* tolerate partial/malformed lines */ }
  }
  return events;
}

function readTranscriptEvents(transcriptPath) {
  const events = parseTranscriptEvents(transcriptPath);
  return events[0] && events[0].schema === 'harness.trace.v1'
    ? translateHarnessTrace(events)
    : events;
}

// stream-json splits one logical assistant turn into several JSONL lines —
// one per content block (text/thinking/tool_use) — all sharing the same
// message.id and each repeating that turn's full usage snapshot.
// input_tokens/cache_read_input_tokens/cache_creation_input_tokens on that
// snapshot are exact (verified against the CLI's own run totals).
// output_tokens on the same snapshot is NOT — it's capped at a tiny per-chunk
// number unrelated to real generated length (extended-thinking tokens aren't
// reflected there). The only exact output figure is the run's single
// cumulative total from the final `result` event.
//
// To still show a per-turn output number, estimate it from context growth:
// cache_creation_input_tokens on the NEXT turn already measures the tokens
// newly written to the cached prefix since this turn, i.e. this turn's output
// plus whatever tool-result text got appended after it. Subtracting an
// estimated tool-result token count (text length / 4) isolates the output
// portion. This has a known bias — the char/4 estimate is crude, and
// prompt-cache TTL expiry can force a full-prefix rewrite that looks like a
// huge output spike — so the raw per-turn values are used only as relative
// WEIGHTS, rescaled to sum exactly to the run's real, exact output-token
// total. Always render this as an estimate, never as exact.
function extractToolCalls(transcriptPath, realOutputTotal) {
  if (!fs.existsSync(transcriptPath)) return null;
  const events = readTranscriptEvents(transcriptPath);

  const order = [];
  const messages = new Map();
  const resultTimestamps = new Map(); // tool_use_id -> ISO timestamp of its tool_result
  let currentId = null;
  for (const obj of events) {
    if (obj.type === 'assistant' && obj.message) {
      const id = obj.message.id;
      if (!messages.has(id)) { messages.set(id, { usage: obj.message.usage, blocks: [], toolResultChars: 0 }); order.push(id); }
      const entry = messages.get(id);
      entry.usage = obj.message.usage;
      for (const block of (obj.message.content || [])) entry.blocks.push(block);
      currentId = id;
      continue;
    }
    if (obj.type === 'user' && obj.message) {
      const content = Array.isArray(obj.message.content) ? obj.message.content : [];
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        if (block.tool_use_id && obj.timestamp) resultTimestamps.set(block.tool_use_id, obj.timestamp);
        if (!currentId || !messages.has(currentId)) continue;
        const text = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content) ? block.content.map(c => c.text || '').join('') : '';
        messages.get(currentId).toolResultChars += text.length;
      }
    }
  }

  const ctxSize = usage => (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const rawOutputs = order.map((id, i) => {
    if (i === order.length - 1) return 0; // no next turn to diff context against
    const cur = messages.get(id);
    const next = messages.get(order[i + 1]);
    const delta = ctxSize(next.usage) - ctxSize(cur.usage);
    return Math.max(0, delta - cur.toolResultChars / 4);
  });
  const rawTotal = rawOutputs.reduce((a, b) => a + b, 0);
  const scale = (realOutputTotal > 0 && rawTotal > 0) ? realOutputTotal / rawTotal : 0;

  const calls = [];
  const phaseCosts = { discovery: 0, edit: 0, build_test: 0, git: 0, other: 0 };
  let prevTs = null;
  order.forEach((id, i) => {
    const { usage, blocks } = messages.get(id);
    const inputTok = usage.input_tokens || 0;
    const cacheReadTok = usage.cache_read_input_tokens || 0;
    const cacheWriteTok = usage.cache_creation_input_tokens || 0;
    const outputTokEst = rawOutputs[i] * scale;
    const exactCost = (inputTok * PRICE_PER_MTOK.input + cacheReadTok * PRICE_PER_MTOK.cacheRead + cacheWriteTok * PRICE_PER_MTOK.cacheWrite) / 1e6;
    const msgCost = exactCost + (outputTokEst * PRICE_PER_MTOK.output) / 1e6;

    const toolBlocks = blocks.filter(b => b.type === 'tool_use');
    const n = toolBlocks.length || 1;
    // Multiple tool calls sharing one turn split that turn's tokens/cost evenly
    // — an approximation when they clearly weren't equal work, but rare.
    const perCall = {
      input_tokens: inputTok / n,
      cache_read_tokens: cacheReadTok / n,
      cache_creation_tokens: cacheWriteTok / n,
      output_tokens_est: outputTokEst / n,
      cost_usd: msgCost / n,
    };

    if (!toolBlocks.length) { phaseCosts.other += msgCost; return; }
    for (const block of toolBlocks) {
      const input = block.input || {};
      const phase = classifyToolUse(block.name, input);
      let detail = '';
      if (block.name === 'Bash') detail = (input.command || '').replace(/\s+/g, ' ').slice(0, 160);
      else if (input.file_path || input.path) detail = input.file_path || input.path;
      // Duration = time between this call's tool_result and the previous
      // one's — spans the model's "thinking" latency for this turn plus this
      // tool's own execution time. Exact (matched by tool_use_id), not
      // estimated — the first call in a run has no prior anchor, so it's null.
      const ts = resultTimestamps.get(block.id);
      const durationSec = (ts && prevTs) ? (new Date(ts) - new Date(prevTs)) / 1000 : null;
      if (ts) prevTs = ts;
      calls.push({ id: block.id, name: block.name, phase, detail, duration_sec: durationSec, ...perCall });
      phaseCosts[phase] += perCall.cost_usd;
    }
  });

  return { calls, phaseCosts };
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => c.text || '').join('');
  return content == null ? '' : JSON.stringify(content, null, 2);
}

// Full input + result for one tool call, looked up on demand by tool_use_id —
// kept out of extractToolCalls'/analyzeTask's per-run payload since that's
// fetched in bulk for the whole turns table and full tool I/O (a Read of a
// 2000-line file, a long grep) would bloat every page load. Re-scans the
// transcript only when a user actually clicks a turn.
//
// stream-json emits one block per JSONL line, all sharing the assistant
// message's id — a message that reasons before calling a tool looks like
// [thinking] [text] [tool_use] [tool_use] ... across several lines, not one.
// The turn's real latency (what shows as duration_sec in the timeline) is
// mostly the model producing that thinking/text, not the tool executing, so
// it's tracked alongside the tool_use blocks here rather than discarded.
function getToolCallDetail(runId, toolUseId) {
  if (!RUN_ID_RE.test(runId) || !toolUseId) return null;
  const transcriptPath = path.join(ARTIFACTS_DIR, runId, 'transcript.jsonl');
  if (!fs.existsSync(transcriptPath)) return null;
  const events = readTranscriptEvents(transcriptPath);

  const messageBlocks = new Map(); // message.id -> blocks accumulated so far
  let toolUse = null;
  let toolUseMessageId = null;
  let toolResult = null;
  for (const obj of events) {
    if (obj.type === 'assistant' && obj.message) {
      const id = obj.message.id;
      const blocks = messageBlocks.get(id) || [];
      for (const block of obj.message.content || []) {
        blocks.push(block);
        if (!toolUse && block.type === 'tool_use' && block.id === toolUseId) {
          toolUse = block;
          toolUseMessageId = id;
        }
      }
      messageBlocks.set(id, blocks);
    }
    if (obj.type === 'user' && obj.message) {
      const content = Array.isArray(obj.message.content) ? obj.message.content : [];
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id === toolUseId) toolResult = block;
      }
    }
    // Safe to stop once both are in hand: a tool's result only ever appears
    // after its whole assistant message has finished streaming, so the
    // sibling thinking/text blocks captured above are already complete.
    if (toolUse && toolResult) break;
  }
  if (!toolUse) return null;

  const siblings = messageBlocks.get(toolUseMessageId) || [];
  const thinking = siblings.filter(b => b.type === 'thinking').map(b => b.thinking).join('\n\n') || null;
  const text = siblings.filter(b => b.type === 'text').map(b => b.text).join('\n\n') || null;

  return {
    name: toolUse.name,
    input: toolUse.input || {},
    result: toolResult ? toolResultText(toolResult.content) : null,
    is_error: toolResult ? !!toolResult.is_error : false,
    thinking,
    text,
  };
}

// Loaded on demand: the short prompt, explicitly supplied instructions, and
// input snapshots together explain what the worker was given. Old transcripts
// remain readable even when their instruction snapshots were never captured.
function getInitialPrompt(runId) {
  if (!RUN_ID_RE.test(runId)) return null;
  const transcriptPath = path.join(ARTIFACTS_DIR, runId, 'transcript.jsonl');
  if (!fs.existsSync(transcriptPath)) return null;
  const events = parseTranscriptEvents(transcriptPath);
  const readInputs = () => {
    const inputs = {};
    for (const name of ['instructions.md', 'instruction-manifest.json', 'spec.json', 'handoff.json', 'feedback.json', 'request.json', 'run-context.json']) {
      try { inputs[name] = fs.readFileSync(path.join(ARTIFACTS_DIR, runId, name), 'utf8'); }
      catch { /* older runs and role-specific optional inputs */ }
    }
    return inputs;
  };
  for (const obj of events) {
    if (obj.type === 'prompt') {
      return { prompt: obj.prompt, model: obj.model || null, ts: obj.ts || null, inputs: readInputs() };
    }
  }
  if (events[0] && events[0].schema === 'harness.trace.v1') {
    const runStarted = events.find(obj => obj.event === 'run.started');
    if (runStarted) {
      // Harness runs do not capture prompt text because their entrypoint has no equivalent write-through yet.
      return { prompt: null, model: runStarted.model || null, ts: runStarted.timestamp || null, inputs: readInputs() };
    }
  }
  return null;
}

// Line counts from the run's own changes.diff — how much code actually came
// out the other end, to weigh against how many turns/dollars it took to get
// there. Skips the `+++`/`---` file headers so only real added/removed lines
// count.
function diffStats(runId) {
  const diffPath = path.join(ARTIFACTS_DIR, runId, 'changes.diff');
  if (!fs.existsSync(diffPath)) return { diff_additions: null, diff_deletions: null, diff_lines: null };
  const lines = fs.readFileSync(diffPath, 'utf8').split('\n');
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { diff_additions: additions, diff_deletions: deletions, diff_lines: additions + deletions };
}

function categoryTokensAndCosts(usage) {
  if (!usage) {
    return {
      input_tokens: null, input_cost_usd: null,
      cache_read_tokens: null, cache_read_cost_usd: null,
      cache_write_tokens: null, cache_write_cost_usd: null,
      output_tokens: null, output_cost_usd: null,
    };
  }
  // Older tasks.json entries predate a schema change and are missing some of
  // these fields entirely (undefined) — default each to 0 explicitly, since
  // undefined * rate is NaN, and NaN silently zeroes out via `|| 0` in the
  // aggregate sum rather than erroring, which understates cost with no signal.
  const u = usage;
  const inputTok = u.input_tokens || 0;
  const cacheReadTok = u.cache_read_tokens || 0;
  const cacheWriteTok = u.cache_creation_tokens || 0;
  const outputTok = u.output_tokens || 0;
  const rawInputCost = (inputTok * PRICE_PER_MTOK.input) / 1e6;
  const rawCacheReadCost = (cacheReadTok * PRICE_PER_MTOK.cacheRead) / 1e6;
  const rawCacheWriteCost = (cacheWriteTok * PRICE_PER_MTOK.cacheWrite) / 1e6;
  const rawOutputCost = (outputTok * PRICE_PER_MTOK.output) / 1e6;
  const rawTotal = rawInputCost + rawCacheReadCost + rawCacheWriteCost + rawOutputCost;
  const scale = (u.cost_usd != null && rawTotal > 0) ? u.cost_usd / rawTotal : 1;

  return {
    input_tokens: inputTok, input_cost_usd: rawInputCost * scale,
    cache_read_tokens: cacheReadTok, cache_read_cost_usd: rawCacheReadCost * scale,
    cache_write_tokens: cacheWriteTok, cache_write_cost_usd: rawCacheWriteCost * scale,
    output_tokens: outputTok, output_cost_usd: rawOutputCost * scale,
  };
}

function analyzeTask(task) {
  if (!task.run_id || !RUN_ID_RE.test(task.run_id)) return null;
  const transcriptPath = path.join(ARTIFACTS_DIR, task.run_id, 'transcript.jsonl');
  // A run killed by the timeout/cost-guard never reaches the CLI's own final
  // `result` event, so task.usage is null — not because it was free, but
  // because nothing ever computed a total for it (see agent-finalize.js). Fall
  // back to a tracked-cost estimate from the surviving transcript rather than
  // showing null/$0, which otherwise makes exactly the runs worth scrutinizing
  // (timeouts, retry loops) invisible to every cost stat, average or percentile.
  const usage = task.usage || estimateTrackedCostFromTranscript(transcriptPath);
  const realOutputTotal = usage ? (usage.output_tokens || 0) : 0;
  const extracted = extractToolCalls(transcriptPath, realOutputTotal);
  if (!extracted) return null;
  const { calls: toolCalls, phaseCosts: rawPhaseCosts } = extracted;

  const phaseCounts = { discovery: 0, edit: 0, build_test: 0, git: 0, other: 0 };
  let firstEditIndex = -1;
  toolCalls.forEach((call, i) => {
    phaseCounts[call.phase] += 1;
    if (firstEditIndex === -1 && call.phase === 'edit') firstEditIndex = i;
  });

  // Rescale the estimated per-phase split to sum to the task's own exact
  // reported cost (usage.cost_usd), so dollar figures always add up. For an
  // approximate (killed-run) usage, this is the tracked input+cache total, not
  // the CLI's own — still leaves output-phase cost at 0 since realOutputTotal
  // is 0 for those, rather than fabricating an output split we have no basis for.
  const trueCost = usage ? usage.cost_usd : null;
  const rawTotal = Object.values(rawPhaseCosts).reduce((a, b) => a + b, 0);
  const scale = (trueCost != null && rawTotal > 0) ? trueCost / rawTotal : 1;
  const phaseCosts = {};
  for (const [phase, cost] of Object.entries(rawPhaseCosts)) phaseCosts[phase] = cost * scale;
  toolCalls.forEach(call => { call.cost_usd *= scale; });

  const total = toolCalls.length;

  return {
    id: task.id,
    description: task.description,
    task_type: task.task_type,
    // The two bot personas this orchestrator runs: UnitTest owns the dedicated
    // "unit-test" task type; everything else (review-feedback, new-task/Teams
    // messages) goes through the CodeMonkey implement pipeline.
    agent: task.task_type === 'unit-test' ? 'UnitTest' : 'CodeMonkey',
    status: task.status,
    error: task.error || null,
    finished_at: task.finished_at || null,
    started_at: task.started_at || task.received_at || null,
    run_id: task.run_id,
    mr_iid: task.mr_iid || null,
    mr_url: task.mr_url || null,
    ...diffStats(task.run_id),
    // What the human actually gave the agent to work from — a GitLab review
    // comment, a raw Teams/Discord message, or (fallback) just the description.
    // Lets us line discovery-heavy runs up against the prompt that caused them.
    comment: task.review_comments || task.raw_message || task.description || null,
    model: usage ? usage.model : null,
    num_turns: usage ? usage.num_turns : null,
    cost_usd: usage ? usage.cost_usd : null,
    // True for a killed run's backfilled estimate: tracked input+cache cost
    // only, no output/reasoning tokens (unrecoverable — see
    // estimateTrackedCostFromTranscript), so this is always a floor on real
    // spend, never the exact CLI-reported total the way a completed run's is.
    cost_approx: !!(usage && usage.approx),
    // Straight from the CLI's own exact run totals (not re-summed from
    // tool_calls, which excludes text/thinking-only turns) — token counts here
    // are exact. Dollar amounts are rescaled below so the four categories sum
    // exactly to cost_usd — flat per-Mtok rates don't perfectly match real
    // billing (cache 1h vs 5m tiers, minor per-model differences), so an
    // unscaled version would be off by a few percent. For a backfilled
    // (approx) usage, categoryTokensAndCosts still holds: the three tracked
    // categories are real, output stays 0.
    ...categoryTokensAndCosts(usage),
    duration_ms: task.duration_ms,
    tool_calls_total: total,
    phase_counts: phaseCounts,
    phase_costs: phaseCosts,
    // Flat, sortable `<phase>_pct`/`<phase>_cost_pct` fields for all five
    // phases (not just discovery) — same definition, generalized.
    ...PHASES.reduce((acc, phase) => {
      acc[`${phase}_pct`] = total ? phaseCounts[phase] / total : 0;
      acc[`${phase}_cost_pct`] = trueCost ? phaseCosts[phase] / trueCost : 0;
      return acc;
    }, {}),
    turns_before_first_edit: firstEditIndex === -1 ? total : firstEditIndex,
    tool_calls: toolCalls,
  };
}

// Per-model stats so we can see, e.g., which model spends comparatively more of
// its turns on discovery instead of implementation.
const PHASES = ['discovery', 'edit', 'build_test', 'git', 'other'];

function summarize(analyzed) {
  const count = analyzed.length;
  if (!count) return null;
  const sum = key => analyzed.reduce((acc, t) => acc + (t[key] || 0), 0);
  // Avg % of a task's own turns spent in each phase, averaged across tasks —
  // same definition as avg_discovery_pct, just for the other four buckets too.
  const avgTurnPct = phase => analyzed.reduce((acc, t) =>
    acc + (t.tool_calls_total ? t.phase_counts[phase] / t.tool_calls_total : 0), 0) / count;
  const avgCostPct = phase => analyzed.reduce((acc, t) =>
    acc + (t.cost_usd ? t.phase_costs[phase] / t.cost_usd : 0), 0) / count;

  const avgPhasePct = {};
  const avgPhaseCostPct = {};
  for (const phase of PHASES) {
    avgPhasePct[phase] = avgTurnPct(phase);
    avgPhaseCostPct[phase] = avgCostPct(phase);
  }

  return {
    tasks_analyzed: count,
    avg_turns: sum('num_turns') / count,
    avg_cost_usd: sum('cost_usd') / count,
    avg_tool_calls: sum('tool_calls_total') / count,
    // Per-task averages of the CLI's own exact token totals, split by category
    // rather than by phase — input/cache-read/cache-write are exact; output is
    // the CLI's real cumulative total for the whole task (also exact — the
    // per-turn *split* of output is the only estimated part, tracked above).
    avg_input_tokens: sum('input_tokens') / count,
    avg_input_cost_usd: sum('input_cost_usd') / count,
    avg_cache_read_tokens: sum('cache_read_tokens') / count,
    avg_cache_read_cost_usd: sum('cache_read_cost_usd') / count,
    avg_cache_write_tokens: sum('cache_write_tokens') / count,
    avg_cache_write_cost_usd: sum('cache_write_cost_usd') / count,
    avg_output_tokens: sum('output_tokens') / count,
    avg_output_cost_usd: sum('output_cost_usd') / count,
    avg_discovery_pct: avgPhasePct.discovery,
    avg_discovery_cost_pct: avgPhaseCostPct.discovery,
    avg_phase_pct: avgPhasePct,
    avg_phase_cost_pct: avgPhaseCostPct,
    avg_turns_before_first_edit: sum('turns_before_first_edit') / count,
    phase_totals: analyzed.reduce((acc, t) => {
      for (const [phase, n] of Object.entries(t.phase_counts)) acc[phase] = (acc[phase] || 0) + n;
      return acc;
    }, {}),
    phase_cost_totals: analyzed.reduce((acc, t) => {
      for (const [phase, cost] of Object.entries(t.phase_costs)) acc[phase] = (acc[phase] || 0) + cost;
      return acc;
    }, {}),
  };
}

function groupAndSummarize(analyzed, keyFn, keyName) {
  const groups = analyzed.reduce((acc, t) => {
    const key = keyFn(t);
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});
  return Object.entries(groups)
    .map(([key, group]) => ({ [keyName]: key, ...summarize(group) }))
    .sort((a, b) => b.avg_discovery_pct - a.avg_discovery_pct);
}

// Rough "how many triggers did it take to land this MR" view — every trigger
// (pipeline or manual comment, no attempt to tell them apart) that named the
// same mr_iid, with total cost and total diff size as a cheap complexity
// proxy to eyeball against the trigger count. Tasks with no mr_iid (pre-dates
// the field, or never linked to an MR) are excluded rather than bucketed
// under a fake key.
function groupByMr(analyzed) {
  const groups = new Map();
  for (const t of analyzed) {
    if (!t.mr_iid) continue;
    if (!groups.has(t.mr_iid)) groups.set(t.mr_iid, []);
    groups.get(t.mr_iid).push(t);
  }
  return Array.from(groups.entries()).map(([mr_iid, tasks]) => {
    const sum = key => tasks.reduce((acc, t) => acc + (t[key] || 0), 0);
    const starts = tasks.map(t => t.started_at).filter(Boolean).sort();
    const finishes = tasks.map(t => t.finished_at).filter(Boolean).sort();
    return {
      mr_iid,
      mr_url: (tasks.find(t => t.mr_url) || {}).mr_url || null,
      trigger_count: tasks.length,
      total_cost_usd: sum('cost_usd'),
      total_diff_additions: sum('diff_additions'),
      total_diff_deletions: sum('diff_deletions'),
      total_diff_lines: sum('diff_lines'),
      first_started_at: starts[0] || null,
      last_finished_at: finishes[finishes.length - 1] || null,
      tasks: tasks
        .slice()
        .sort((a, b) => new Date(a.started_at || 0) - new Date(b.started_at || 0))
        .map(t => ({ id: t.id, description: t.description, agent: t.agent, status: t.status, cost_usd: t.cost_usd, diff_lines: t.diff_lines, finished_at: t.finished_at })),
    };
  }).sort((a, b) => b.trigger_count - a.trigger_count);
}

// completed/failed/timeout/killed all get analyzed — a run that burned 80 turns
// of discovery before timing out is exactly the kind of thing we're hunting
// for, not something to exclude. pending is skipped since there's no run_id/
// transcript to reason about yet.
const ANALYZABLE_STATUSES = new Set(['completed', 'failed', 'timeout', 'killed']);

// A running task's transcript is still being appended to on disk — analyzeTask
// already tolerates that (missing task.usage falls back to
// estimateTrackedCostFromTranscript, malformed trailing JSON lines are
// skipped), so it can be shown in the table live. But it's kept out of
// ANALYZABLE_STATUSES/summarize(): a half-finished run's turn count and
// tracked-only cost would skew the aggregate/model/agent averages that assume
// a finished task.
const LIVE_STATUSES = new Set(['running']);

function analyzeRecentTasks(limit = Infinity) {
  const tasks = loadTasks()
    .filter(t => (ANALYZABLE_STATUSES.has(t.status) || LIVE_STATUSES.has(t.status)) && t.run_id)
    .sort((a, b) => new Date(b.finished_at || b.started_at || b.received_at || 0) - new Date(a.finished_at || a.started_at || a.received_at || 0))
    .slice(0, limit);

  const analyzed = tasks.map(analyzeTask).filter(Boolean);
  const finished = analyzed.filter(t => ANALYZABLE_STATUSES.has(t.status));
  const aggregate = summarize(finished) || { tasks_analyzed: 0 };
  aggregate.by_model = groupAndSummarize(finished, t => t.model || 'unknown', 'model');
  aggregate.by_agent = groupAndSummarize(finished, t => t.agent, 'agent');
  aggregate.by_mr = groupByMr(finished);

  return { aggregate, tasks: analyzed };
}

// Cheap companion to analyzeRecentTasks for polling: analyzeRecentTasks(Infinity)
// re-parses every historical transcript on every call (fine for a one-shot page
// load, too slow to poll every few seconds). This only ever touches the 0-2
// tasks that are actually running right now, so the turns page can poll it
// continuously to show a running task's timeline growing live without
// re-reading the whole history each tick.
function analyzeLiveTasks() {
  const tasks = loadTasks().filter(t => LIVE_STATUSES.has(t.status) && t.run_id);
  return { tasks: tasks.map(analyzeTask).filter(Boolean) };
}

module.exports = {
  analyzeTask,
  analyzeRecentTasks,
  analyzeLiveTasks,
  classifyToolUse,
  extractToolCalls,
  getToolCallDetail,
  getInitialPrompt,
  readTranscriptEvents,
  translateHarnessTrace,
};
