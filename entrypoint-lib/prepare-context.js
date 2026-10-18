#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function prepareContext(task, repo, artifacts) {
  const write = (name, data) => fs.writeFileSync(path.join(artifacts, name), JSON.stringify(data, null, 2));
  const context = task.pipeline_context;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  if (task.pipeline_trigger_id && !context?.spec) throw new Error('Pipeline trigger has no specification snapshot');
  if (context?.expected_commit && context.expected_commit !== commit) throw new Error('MR branch changed before worker checkout; retry against its current revision');
  if (context) {
    write('spec.json', context.spec);
    write('handoff.json', context.handoff);
    write('feedback.json', context.feedback);
    // Pre-touch the unit_test worker's required handoff files so it can use the Edit
    // tool (which it reliably reaches for) instead of Write on a brand-new file — the
    // worker has repeatedly tried Bash heredocs/redirection for test-plan.json instead
    // of the Write tool despite explicit instructions, and Bash cannot create files via
    // redirection regardless of --add-dir. An existing file sidesteps that entirely.
    if (context.stage === 'unit_test') {
      write('test-plan.json', {});
      write('needs_decision.json', {});
    }
  } else {
    write('request.json', { description: task.description, feedback: task.review_comments, trigger_note_id: task.trigger_note_id, mr: task.mr });
  }
  const changed = execFileSync('git', ['diff', '--name-status', `origin/${process.env.TARGET_BRANCH || 'main'}...HEAD`], { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(artifacts, 'changed-files.txt'), changed);
  write('run-context.json', { version: 1, role: context?.stage || task.task_type,
    pipeline: !!context, mr: task.mr, commit_sha: commit,
    specification_hash: context?.spec?.content_hash || null,
    specification_revision: context?.spec?.revision || null });
}
if (require.main === module) {
  prepareContext(JSON.parse(fs.readFileSync('/workspace/task.json', 'utf8')), '/workspace/repo', '/workspace/_artifacts');
}
module.exports = { prepareContext };
