const fs = require('fs');
const path = require('path');

// Code-Monkey/unit-test workers already run `dotnet build`/`dotnet test` themselves,
// for real, via their own validation loop (see entrypoint-lib/implement-prompts.sh).
// Rather than re-running those commands a second time deterministically (double the
// wall-clock cost for a signal that already exists), this reads the ACTUAL exit
// status Claude Code's own Bash tool recorded for those calls — `tool_result.is_error`
// reflects the real shell exit code, not a text-parsed guess. Takes the LAST matching
// call per command (a model may retry up to 3x per its own validation loop), so a
// prior failed attempt followed by a real fix reads correctly as passed.
//
// The exit code alone is NOT enough, which is how MR !167 deadlocked: 13 tests marked
// `[Fact(Skip=...)]` never run, so `dotnet test` exits 0 and the stage reads as a clean
// pass. The counts were sitting in the same tool_result the whole time —
//   Passed!  - Failed:     0, Passed:  1888, Skipped:    13, Total:  1901
// — so `tests` below parses that summary and the individual failure names out of the
// result body. The driver gates on those numbers, not on the exit code.

// Emitted once per test assembly by `dotnet test`; sum all assemblies.
const SUMMARY_LINE = /(?:Passed!|Failed!|Skipped!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/g;

// The per-test failure lines in the same output. `[FAIL]` appears on the xUnit.net
// diagnostic line and `Failed <name>` on VSTest's listing of the same test, so the
// Set dedupes what would otherwise be every failure reported twice. The `Failed\s+`
// alternative deliberately requires whitespace, which is what keeps it from matching
// the `Failed!  - Failed: 1, Passed: ...` summary line.
const FAILED_TEST_LINE = /^\s*(?:Failed\s+|\[xUnit\.net[^\]]*\]\s+)([A-Za-z_][\w.]*\.[\w]+)/;

// tool_result content is either a plain string or an array of content blocks,
// depending on how the tool reported — flatten both to searchable text.
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => (typeof block === 'string' ? block : block?.text || '')).join('\n');
}

function parseTestOutput(text) {
  let failed = 0;
  let passed = 0;
  let skipped = 0;
  let total = 0;
  let found = false;

  SUMMARY_LINE.lastIndex = 0;
  let match;
  while ((match = SUMMARY_LINE.exec(text)) !== null) {
    found = true;
    failed += Number(match[1]);
    passed += Number(match[2]);
    skipped += Number(match[3]);
    total += Number(match[4]);
  }
  if (!found) return null;

  const failingNames = new Set();
  if (failed > 0) {
    for (const line of text.split('\n')) {
      if (!/\[FAIL\]|^\s*Failed\s/.test(line)) continue;
      const nameMatch = FAILED_TEST_LINE.exec(line);
      if (nameMatch) failingNames.add(nameMatch[1]);
    }
  }

  return { failed, passed, skipped, total, failing_names: [...failingNames] };
}

function readBuildResult(runDir) {
  const transcriptPath = path.join(runDir, 'transcript.jsonl');
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  } catch {
    return { build_found: false, test_found: false, build_passed: false, test_passed: false, tests: null };
  }

  let lastBuildToolUseId = null;
  let lastTestToolUseId = null;
  const isErrorByToolUseId = new Map();
  const textByToolUseId = new Map();

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;

    if (obj.type === 'assistant') {
      for (const block of content) {
        if (block.type !== 'tool_use' || block.name !== 'Bash') continue;
        const command = block.input?.command || '';
        if (/\bdotnet\s+build\b/.test(command)) lastBuildToolUseId = block.id;
        if (/\bdotnet\s+test\b/.test(command)) lastTestToolUseId = block.id;
      }
    } else if (obj.type === 'user') {
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        isErrorByToolUseId.set(block.tool_use_id, !!block.is_error);
        textByToolUseId.set(block.tool_use_id, resultText(block.content));
      }
    }
  }

  const buildFound = lastBuildToolUseId !== null;
  const testFound = lastTestToolUseId !== null;

  return {
    build_found: buildFound,
    test_found: testFound,
    // Fail safe: no recognizable build/test call at all means we can't vouch for it —
    // never assume a pass just because nothing was found.
    build_passed: buildFound && isErrorByToolUseId.get(lastBuildToolUseId) === false,
    test_passed: testFound && isErrorByToolUseId.get(lastTestToolUseId) === false,
    // null when the run never produced a parseable summary (no test call, or output
    // truncated). Callers must treat null as "unknown", not as "zero failures".
    tests: testFound ? parseTestOutput(textByToolUseId.get(lastTestToolUseId) || '') : null,
  };
}

module.exports = { readBuildResult, parseTestOutput };
