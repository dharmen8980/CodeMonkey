const fs = require('fs');
const { exec } = require('child_process');
const { PRICE_PER_MTOK } = require('./pricing');

// Live $ ceiling alongside the wall-clock TIMEOUT_MS in agent-spawn.js. A run can
// blow through budget fast without running long — a tight retry loop hammering
// the API burns tokens turn after turn — so time alone isn't a sufficient guard.
//
// `claude -p ... --output-format stream-json` only reports total_cost_usd once,
// in the final `result` line, which a run that's spending too much may never
// reach. But every intermediate `assistant` line carries that turn's own exact
// usage (input/output/cache tokens) — stream-json just splits one logical turn
// across several JSONL lines (one per content block) that all repeat the same
// message.id and usage snapshot, so dedup by message.id and sum, same as the
// retrospective accounting in turn-analysis.js.
//
// Polls the host-visible transcript.jsonl (bind-mounted from the container, see
// implement-phase.sh's `| tee`) rather than reading anything inside the
// container, so this needs no image/entrypoint changes.
function startCostGuard(transcriptPath, containerName, limitUsd, onLimitExceeded) {
  let offset = 0;
  let costUsd = 0;
  let stopped = false;
  let timer = null;
  const seenMessageIds = new Set();

  const scheduleNext = () => {
    if (!stopped) timer = setTimeout(poll, 3000);
  };

  function poll() {
    if (stopped) return;
    fs.stat(transcriptPath, (statErr, stat) => {
      if (stopped) return;
      if (statErr || stat.size <= offset) return scheduleNext();

      const stream = fs.createReadStream(transcriptPath, {
        start: offset, end: stat.size - 1, encoding: 'utf8',
      });
      let buf = '';
      stream.on('data', (chunk) => { buf += chunk; });
      stream.on('error', scheduleNext);
      stream.on('end', () => {
        offset = stat.size;
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.type !== 'assistant') continue;
          const msgId = obj.message && obj.message.id;
          const usage = obj.message && obj.message.usage;
          if (!usage || !msgId || seenMessageIds.has(msgId)) continue;
          seenMessageIds.add(msgId);

          const inputTok = usage.input_tokens || 0;
          const outputTok = usage.output_tokens || 0;
          const cacheReadTok = usage.cache_read_input_tokens || 0;
          const cacheWriteTok = usage.cache_creation_input_tokens || 0;
          costUsd += (
            inputTok * PRICE_PER_MTOK.input
            + outputTok * PRICE_PER_MTOK.output
            + cacheReadTok * PRICE_PER_MTOK.cacheRead
            + cacheWriteTok * PRICE_PER_MTOK.cacheWrite
          ) / 1e6;
        }

        if (costUsd >= limitUsd) {
          stopped = true;
          console.log(`\n💸 Cost limit reached for ${containerName}: $${costUsd.toFixed(4)} >= $${limitUsd}, killing...`);
          exec(`docker kill ${containerName}`, (killErr) => {
            if (killErr) console.log(`   Warning: docker kill failed: ${killErr.message}`);
          });
          onLimitExceeded(costUsd);
          return;
        }
        scheduleNext();
      });
    });
  }

  timer = setTimeout(poll, 3000);

  return {
    stop: () => { stopped = true; if (timer) clearTimeout(timer); },
  };
}

module.exports = { startCostGuard };
