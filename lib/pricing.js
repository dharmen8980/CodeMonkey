const fs = require('fs');

// Per-Mtok USD rates for the Sonnet family on Bedrock — verified against the
// CLI's own run totals (see lib/turn-analysis.js). Shared by the retrospective
// dashboard cost breakdown and the live cost-guard so the two never drift apart.
const PRICE_PER_MTOK = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };

// A run killed by the timeout or cost-guard never reaches the CLI's own final
// `result` event, so it has no `total_cost_usd` and task.usage is null (see
// agent-finalize.js) — not because the run was free, but because nothing ever
// computed a total for it. The transcript that survives the kill (bind-mounted
// via `tee`, see implement-phase.sh) still has every turn's own input/cache
// token usage, which is exact per turn — only output/reasoning tokens are
// unrecoverable this way (see cost-guard.js's own comment on why). So this
// gives a real, if partial, cost instead of null: always an underestimate of
// true spend, never a fabricated overestimate.
function estimateTrackedCostFromTranscript(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) return null;
  let costUsd = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let model = null;
  const seenMessageIds = new Set();

  const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant' || !obj.message) continue;
    const msgId = obj.message.id;
    const usage = obj.message.usage;
    if (!usage || !msgId || seenMessageIds.has(msgId)) continue;
    seenMessageIds.add(msgId);
    if (!model && obj.message.model) model = obj.message.model;

    inputTokens += usage.input_tokens || 0;
    cacheReadTokens += usage.cache_read_input_tokens || 0;
    cacheWriteTokens += usage.cache_creation_input_tokens || 0;
    costUsd += (
      (usage.input_tokens || 0) * PRICE_PER_MTOK.input
      + (usage.cache_read_input_tokens || 0) * PRICE_PER_MTOK.cacheRead
      + (usage.cache_creation_input_tokens || 0) * PRICE_PER_MTOK.cacheWrite
    ) / 1e6;
  }

  if (!seenMessageIds.size) return null;
  return {
    cost_usd: costUsd,
    input_tokens: inputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheWriteTokens,
    output_tokens: 0, // unrecoverable from the transcript alone — see comment above
    num_turns: seenMessageIds.size,
    model,
    approx: true,
  };
}

module.exports = { PRICE_PER_MTOK, estimateTrackedCostFromTranscript };
