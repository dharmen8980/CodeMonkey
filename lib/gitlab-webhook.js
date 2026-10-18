const { exec } = require('child_process');

const { loadPipeline } = require('./pipeline-store');
const { generateRunId } = require('./utils');
const { postSonarSummaryComment } = require('./sonar');
const { notifySonarGateResult } = require('./pipeline-driver');

// --- GitLab webhook processing ---
function handleGitlabWebhook(payload) {
  const event = payload.object_kind;
  console.log(`\n📨 GitLab event: ${event}, action: ${payload.object_attributes?.action || 'n/a'}`);
  if (event === 'note') console.log(`   Note type: ${payload.object_attributes?.noteable_type}, has MR: ${!!payload.merge_request}`);

  if (event === 'note') {
    const note = payload.object_attributes;
    const mr = payload.merge_request;
    const pipelineTrigger = /<!-- pipeline-trigger:([a-f0-9-]+) -->/.exec(note.note || '')?.[1] || null;

    // Only act on MR comments
    if (!mr && note.noteable_type !== 'MergeRequest') {
      console.log(`   Ignoring non-MR note (type: ${note.noteable_type})`);
      return null;
    }

    // Ignore comments from Code-Monkey (by username or display name)
    const BOT_USERNAMES = ['project_6430_bot_56de137d449328595ba01877789ca043'];
    const BOT_NAMES = ['Code-Monkey'];
    const authorUsername = payload.user?.username || '';
    const authorName = payload.user?.name || '';
    console.log(`   Note author: ${note.author_id}, username: ${authorUsername}, name: ${authorName}`);

    if (BOT_USERNAMES.includes(authorUsername) || BOT_NAMES.includes(authorName)) {
      console.log(`   Skipping: comment from Code-Monkey (${authorUsername})`);
      return null;
    }

    // Route by mention: @CodeMonkey -> review-feedback (current behavior), @UnitTest -> unit-test agent,
    // @Sonar -> SonarQube scan (no AI agent — runs in persistent sonar-scanner container).
    const mentionsCodeMonkey = /@codemonkey\b/i.test(note.note);
    const mentionsUnitTest = /@unittest\b/i.test(note.note);
    const mentionsSonar = /@sonar\b/i.test(note.note);

    if (!mentionsCodeMonkey && !mentionsUnitTest && !mentionsSonar) {
      console.log(`   Ignoring comment: no @CodeMonkey, @UnitTest, or @Sonar mention`);
      return null;
    }

    // @Sonar is deterministic (not AI). Short-circuit the task/spawn pipeline
    // and kick the scanner container directly. Decoration comes from the
    // SonarQube plugin — nothing for orchestrator to post.
    if (mentionsSonar) {
      const mrIid = mr?.iid || note.noteable_id;
      const src = mr?.source_branch;
      const tgt = mr?.target_branch;
      if (!mrIid || !src || !tgt) {
        console.log(`   ⚠️  @Sonar mention missing MR context (iid=${mrIid}, src=${src}, tgt=${tgt}) — skipping`);
        return null;
      }
      const shellSafe = (s) => String(s).replace(/[^A-Za-z0-9._/-]/g, '');
      const cmd = `docker exec sonar-scanner /usr/local/bin/scan-mr.sh ${shellSafe(mrIid)} ${shellSafe(src)} ${shellSafe(tgt)}`;
      console.log(`\n🔍 @Sonar triggered on !${mrIid} (${src} → ${tgt}) — kicking scanner`);
      exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`   ❌ Sonar scan failed for !${mrIid}:`, err.message);
          console.error(stderr?.slice(-500));
          // Tell the pipeline driver too, in case a ticket is waiting on this MR at
          // stage sonar_gate — otherwise it'd sit stuck with nothing to poll for.
          notifySonarGateResult(mrIid, { passed: false, error: err.message }, pipelineTrigger);
          return;
        }
        console.log(`   ✅ Sonar scan finished for !${mrIid}`);
        // scan-mr.sh runs two analyses: a target-branch baseline refresh first,
        // then the actual PR-mode scan. Each prints its own "ce/task?id=" line —
        // take the last one so we wait on the PR task, not the baseline task.
        const ceMatches = [...stdout.matchAll(/api\/ce\/task\?id=([a-zA-Z0-9-]+)/g)];
        const ceTaskId = ceMatches.length ? ceMatches[ceMatches.length - 1][1] : null;
        if (pipelineTrigger && !ceTaskId) {
          notifySonarGateResult(mrIid, { passed: false, error: 'scanner returned no analysis task ID' }, pipelineTrigger);
          return;
        }
        postSonarSummaryComment(mrIid, ceTaskId)
          .then(gate => notifySonarGateResult(mrIid, gate || { passed: false, error: 'no gate result' }, pipelineTrigger));
      });
      return null;
    }

    if (mentionsCodeMonkey && mentionsUnitTest) {
      console.log(`   Both @CodeMonkey and @UnitTest mentioned — routing to review-feedback`);
    }

    const taskType = mentionsCodeMonkey ? 'review-feedback' : 'unit-test';

    const mrIid = mr?.iid || note.noteable_id || 'unknown';
    const mrUrl = mr?.url || '';
    const mrBranch = mr?.source_branch || '';

    const ticket = pipelineTrigger ? loadPipeline().find(t =>
      t.worker_trigger === pipelineTrigger && String(t.mr_iid) === String(mrIid)
      && t.status === 'running' && t.stage === (taskType === 'unit-test' ? 'unit_test' : 'implement')) : null;
    // Never turn a stale/unknown pipeline comment into a standalone worker task.
    if (pipelineTrigger && !ticket?.worker_context) return null;
    const task = {
      id: generateRunId(),
      task_type: taskType,
      description: taskType === 'unit-test'
        ? `Write acceptance tests for MR !${mrIid} comment`
        : `Address review feedback on MR !${mrIid}`,
      mr_iid: String(mrIid),
      mr_url: mrUrl,
      mr_branch: mrBranch,
      review_comments: note.note,
      // Retain provenance even for standalone feedback. Workers never inject a
      // second copy by blindly fetching recent notes.
      trigger_note_id: note.id,
      source: 'gitlab-webhook',
      pipeline_trigger_id: pipelineTrigger,
      pipeline_ticket_id: ticket?.id || null,
      pipeline_context: ticket?.worker_context || null,
      received_at: new Date().toISOString(),
      status: 'pending'
    };

    console.log(`\n💬 MR comment received on !${mrIid} (${taskType}): "${note.note.substring(0, 80)}..."`);
    return task;
  }

  if (event === 'merge_request') {
    const mr = payload.object_attributes;
    const action = mr.action;

    // MR approved — notify only, merging is human-exclusive
    if (action === 'approved') {
      console.log(`\n✅ MR !${mr.iid} approved — ready for human merge`);
      return null;
    }

    // MR unapproved / changes requested
    if (action === 'unapproved') {
      console.log(`\n⚠️  MR !${mr.iid} unapproved — waiting for review comments`);
      return null;
    }
  }

  console.log(`\n📨 GitLab webhook received: ${event} (no action taken)`);
  return null;
}

module.exports = { handleGitlabWebhook };
