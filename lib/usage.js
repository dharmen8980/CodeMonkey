const fs = require('fs');
const path = require('path');

// --- Usage parsing ---
function parseUsage(output) {
  const match = output.match(/---USAGE_START---([\s\S]*?)---USAGE_END---/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch (e) {
    return null;
  }
}

function readArtifactUsage(runDir) {
  const usagePath = path.join(runDir, 'usage.json');
  try {
    if (fs.existsSync(usagePath)) {
      return JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { parseUsage, readArtifactUsage };
