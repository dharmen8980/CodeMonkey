const https = require('https');

// --- Teams notification ---
function notifyTeams(task, status, output, usage) {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return;

  const duration = task.received_at
    ? Math.round((Date.now() - new Date(task.received_at).getTime()) / 1000)
    : 0;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const mrMatch = output && output.match(/https:\/\/gitlab[^\s)]+merge_requests\/\d+/);
  const mrUrl = mrMatch ? mrMatch[0] : '';

  const icon = status === 'completed' ? '✅' : '❌';
  const title = `${icon} Code-Monkey ${status}: ${task.description || 'Unknown task'}`;

  let body = `**Duration:** ${durationStr}\n\n`;
  if (usage) {
    body += `**Tokens:** ${usage.input_tokens.toLocaleString()} in / ${usage.output_tokens.toLocaleString()} out`;
    if (usage.cache_read_tokens) body += ` (${usage.cache_read_tokens.toLocaleString()} cached)`;
    body += `\n\n**Cost:** $${usage.cost_usd.toFixed(4)}\n\n`;
    body += `**Turns:** ${usage.num_turns}\n\n`;
    if (usage.model) body += `**Model:** ${usage.model}\n\n`;
    if (usage.timing) {
      body += `**Breakdown:** Clone ${usage.timing.clone_sec}s | Claude ${usage.timing.claude_sec}s | Total ${usage.timing.total_sec}s\n\n`;
    }
  }
  if (mrUrl) body += `**MR:** ${mrUrl}\n\n`;
  if (status === 'failed') {
    const errorSnippet = (task.error || output || '').slice(-300);
    body += `**Error:**\n\`\`\`\n${errorSnippet}\n\`\`\``;
  }

  const payload = JSON.stringify({
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", wrap: true },
          { type: "TextBlock", text: body, wrap: true }
        ]
      }
    }]
  });

  const url = new URL(webhookUrl);
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };

  const req = https.request(options, (res) => {
    if (res.statusCode >= 300) {
      console.log(`   ⚠️  Teams notification failed: ${res.statusCode}`);
    } else {
      console.log(`   📣 Teams notified: ${status}`);
    }
  });
  req.on('error', (e) => console.log(`   ⚠️  Teams notification error: ${e.message}`));
  req.write(payload);
  req.end();
}

module.exports = { notifyTeams };
