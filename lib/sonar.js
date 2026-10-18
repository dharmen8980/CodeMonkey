const http = require('http');
const https = require('https');

const { postGitlabMrNote } = require('./gitlab-client');
const { escapeMdHtml } = require('./markdown-escape');

// --- SonarQube API client ---
// The Community Branch Plugin decorates the MR itself, but only with a pass/fail
// badge — no per-metric actuals/thresholds and no issue detail. We pull the same
// data the plugin has via SonarQube's own REST API and post it as a second,
// more detailed MR comment.
const SONAR_HOST_URL = process.env.SONAR_HOST_URL || 'http://localhost:9000';
const SONAR_TOKEN = process.env.SONAR_TOKEN || '';
const SONAR_PROJECT_KEY = process.env.SONAR_PROJECT_KEY || '';

function sonarApiGet(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const url = new URL(SONAR_HOST_URL + pathAndQuery);
    const client = url.protocol === 'https:' ? https : http;
    const auth = Buffer.from(`${SONAR_TOKEN}:`).toString('base64');
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300) {
          reject(new Error(`Sonar API ${pathAndQuery} -> ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// The scanner uploads the report and returns immediately — SonarQube processes
// it asynchronously in the Compute Engine. Poll the background task so we don't
// read stale (pre-analysis) quality gate/measures data.
async function waitForSonarCeTask(ceTaskId, { timeoutMs = 90000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { task } = await sonarApiGet(`/api/ce/task?id=${encodeURIComponent(ceTaskId)}`);
    if (task.status === 'SUCCESS') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`Sonar background task ${ceTaskId} ended with status ${task.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for Sonar background task ${ceTaskId}`);
}

const SONAR_METRIC_LABELS = {
  new_coverage: 'Coverage on new code',
  new_duplicated_lines_density: 'Duplication on new code',
  new_violations: 'New issues',
  new_bugs: 'New bugs',
  new_vulnerabilities: 'New vulnerabilities',
  new_security_hotspots: 'New security hotspots',
  new_code_smells: 'New code smells'
};
const SONAR_PERCENT_METRICS = new Set(['new_coverage', 'new_duplicated_lines_density']);
const SONAR_SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
const SONAR_SEVERITY_EMOJI = { BLOCKER: '🟥', CRITICAL: '🟧', MAJOR: '🟨', MINOR: '🟦', INFO: '⬜' };

function formatSonarMetricValue(metricKey, value) {
  if (value === undefined || value === null) return 'n/a';
  return SONAR_PERCENT_METRICS.has(metricKey) ? `${Number(value).toFixed(1)}%` : value;
}

function formatSonarThreshold(comparator, threshold, metricKey) {
  const unit = SONAR_PERCENT_METRICS.has(metricKey) ? '%' : '';
  // LT -> gate fails if actual <  threshold -> requirement is actual >= threshold
  // GT -> gate fails if actual >  threshold -> requirement is actual <= threshold
  return comparator === 'LT' ? `≥ ${threshold}${unit}` : `≤ ${threshold}${unit}`;
}

// Per-file new-code metrics, so the summary can call out *where* coverage/duplication
// is lacking rather than just the project-wide aggregate. Only files with new lines to
// cover or new duplicated lines are worth surfacing — most touched files have neither.
async function fetchSonarFileBreakdown(mrIid) {
  let fileTreeRes;
  try {
    fileTreeRes = await sonarApiGet(
      `/api/measures/component_tree?component=${encodeURIComponent(SONAR_PROJECT_KEY)}&pullRequest=${encodeURIComponent(mrIid)}` +
      `&qualifiers=FIL&ps=500&metricKeys=new_coverage,new_lines_to_cover,new_uncovered_lines,new_duplicated_lines_density,new_duplicated_lines`
    );
  } catch (e) {
    console.error(`   ⚠️  Failed to fetch per-file Sonar breakdown for !${mrIid}: ${e.message}`);
    return { lowCoverage: [], duplicated: [] };
  }
  const files = (fileTreeRes.components || []).map((c) => {
    const measureByKey = {};
    (c.measures || []).forEach((m) => { measureByKey[m.metric] = m.period ? m.period.value : m.value; });
    return { path: c.path || c.name, measures: measureByKey };
  });

  const lowCoverage = files
    .filter((f) => Number(f.measures.new_lines_to_cover) > 0)
    .sort((a, b) => Number(a.measures.new_coverage || 0) - Number(b.measures.new_coverage || 0));

  const duplicated = files
    .filter((f) => Number(f.measures.new_duplicated_lines) > 0)
    .sort((a, b) => Number(b.measures.new_duplicated_lines_density || 0) - Number(a.measures.new_duplicated_lines_density || 0));

  return { lowCoverage, duplicated };
}

async function fetchSonarPrSummary(mrIid, analysisId) {
  const [gateRes, measuresRes, issuesRes, fileBreakdown] = await Promise.all([
    sonarApiGet(analysisId
      ? `/api/qualitygates/project_status?analysisId=${encodeURIComponent(analysisId)}`
      : `/api/qualitygates/project_status?projectKey=${encodeURIComponent(SONAR_PROJECT_KEY)}&pullRequest=${encodeURIComponent(mrIid)}`),
    sonarApiGet(`/api/measures/component?component=${encodeURIComponent(SONAR_PROJECT_KEY)}&pullRequest=${encodeURIComponent(mrIid)}&metricKeys=new_coverage,new_duplicated_lines_density,new_lines,new_bugs,new_vulnerabilities,new_code_smells,new_security_hotspots,new_violations`),
    sonarApiGet(`/api/issues/search?componentKeys=${encodeURIComponent(SONAR_PROJECT_KEY)}&pullRequest=${encodeURIComponent(mrIid)}&resolved=false&ps=50`),
    fetchSonarFileBreakdown(mrIid)
  ]);
  return {
    gate: gateRes.projectStatus,
    measures: measuresRes.component.measures,
    issues: issuesRes.issues,
    total: issuesRes.total,
    lowCoverage: fileBreakdown.lowCoverage,
    duplicated: fileBreakdown.duplicated
  };
}

function buildSonarCommentMarkdown(mrIid, summary) {
  const { gate, measures, issues, total, lowCoverage, duplicated } = summary;
  const passed = gate.status === 'OK';
  const measureByKey = {};
  measures.forEach((m) => { measureByKey[m.metric] = m.period ? m.period.value : m.value; });

  let md = `## 🔍 SonarQube Analysis — New Code (MR !${mrIid})\n\n`;
  md += passed ? `**Quality Gate: ✅ Passed**\n\n` : `**Quality Gate: ❌ Failed**\n\n`;

  md += `| Metric | Value | Threshold |\n|---|---|---|\n`;
  (gate.conditions || []).forEach((c) => {
    const label = SONAR_METRIC_LABELS[c.metricKey] || c.metricKey;
    const value = formatSonarMetricValue(c.metricKey, c.actualValue);
    const threshold = formatSonarThreshold(c.comparator, c.errorThreshold, c.metricKey);
    const icon = c.status === 'OK' ? '✅' : '❌';
    md += `| ${label} | ${value} | ${threshold} ${icon} |\n`;
  });

  if (measureByKey.new_lines !== undefined) {
    md += `\n*${measureByKey.new_lines} new lines analyzed.*\n`;
  }

  if (lowCoverage && lowCoverage.length) {
    md += `\n### Files with uncovered new code (${lowCoverage.length})\n\n`;
    md += `| File | New coverage | Uncovered new lines |\n|---|---|---|\n`;
    lowCoverage.slice(0, 10).forEach((f) => {
      const coverage = formatSonarMetricValue('new_coverage', f.measures.new_coverage);
      md += `| \`${f.path}\` | ${coverage} | ${f.measures.new_uncovered_lines ?? 'n/a'} |\n`;
    });
    if (lowCoverage.length > 10) {
      md += `\n_...and ${lowCoverage.length - 10} more files — see the full breakdown in SonarQube._\n`;
    }
  }

  if (duplicated && duplicated.length) {
    md += `\n### Files with duplicated new code (${duplicated.length})\n\n`;
    md += `| File | New duplication | Duplicated new lines |\n|---|---|---|\n`;
    duplicated.slice(0, 10).forEach((f) => {
      const density = formatSonarMetricValue('new_duplicated_lines_density', f.measures.new_duplicated_lines_density);
      md += `| \`${f.path}\` | ${density} | ${f.measures.new_duplicated_lines ?? 'n/a'} |\n`;
    });
    if (duplicated.length > 10) {
      md += `\n_...and ${duplicated.length - 10} more files — see the full breakdown in SonarQube._\n`;
    }
  }

  if (total > 0) {
    md += `\n### New Issues (${total})\n\n`;
    const bySeverity = {};
    issues.forEach((i) => { (bySeverity[i.severity] = bySeverity[i.severity] || []).push(i); });
    const maxShown = 20;
    let shownCount = 0;
    SONAR_SEVERITY_ORDER.forEach((sev) => {
      const group = bySeverity[sev];
      if (!group || !group.length || shownCount >= maxShown) return;
      md += `**${SONAR_SEVERITY_EMOJI[sev] || ''} ${sev}**\n`;
      group.slice(0, maxShown - shownCount).forEach((i) => {
        const file = i.component.split(':').pop();
        const line = i.line ? `:${i.line}` : '';
        md += `- \`${file}${line}\` — ${escapeMdHtml(i.message)}\n`;
        shownCount++;
      });
      md += `\n`;
    });
    if (total > shownCount) {
      md += `_...and ${total - shownCount} more — see the full list in SonarQube._\n\n`;
    }
  }

  md += `\n[View full analysis in SonarQube](${SONAR_HOST_URL}/dashboard?id=${encodeURIComponent(SONAR_PROJECT_KEY)}&pullRequest=${encodeURIComponent(mrIid)})\n`;
  md += `\n<sub>Posted by the orchestrator — the Community Edition's own MR decoration doesn't include per-metric coverage/duplication breakdowns.</sub>`;
  return md;
}

// Returns the gate result so callers (the @Sonar webhook path, and the pipeline
// driver's sonar_gate stage) can act on pass/fail themselves — this used to be
// fire-and-forget with nothing returned, which was fine when the only caller was
// "post a comment and done," but the pipeline needs a real pass/fail to decide
// whether to proceed or loop back to implement.
async function postSonarSummaryComment(mrIid, ceTaskId) {
  try {
    let analysisId;
    if (ceTaskId) {
      console.log(`   ⏳ Waiting for Sonar background task ${ceTaskId}...`);
      analysisId = (await waitForSonarCeTask(ceTaskId)).analysisId;
      if (!analysisId) throw new Error('completed Sonar task returned no analysis ID');
    }
    const summary = await fetchSonarPrSummary(mrIid, analysisId);
    const md = buildSonarCommentMarkdown(mrIid, summary);
    await postGitlabMrNote(mrIid, md);
    console.log(`   💬 Posted Sonar summary comment on !${mrIid} (gate: ${summary.gate.status})`);
    return { passed: summary.gate.status === 'OK', quality_gate_status: summary.gate.status,
      failed_conditions: (summary.gate.conditions || []).filter(c => c.status === 'ERROR'),
      issues: summary.issues, low_coverage: summary.lowCoverage };
  } catch (e) {
    console.error(`   ⚠️  Failed to post Sonar summary for !${mrIid}: ${e.message}`);
    return { passed: false, error: e.message };
  }
}

module.exports = { postSonarSummaryComment };
