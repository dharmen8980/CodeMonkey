const { createHash } = require('crypto');

const START = '<!-- codemonkey-spec:start -->';
const END = '<!-- codemonkey-spec:end -->';
const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const specHash = specification => hash(JSON.stringify(canonical(specification)));

function fromTicket(ticket) {
  const t = ticket.triage || {};
  return {
    schema_version: 1,
    ticket: ticket.jira_key || ticket.title || '(ad-hoc)',
    fr_number: ticket.fr_number || null,
    brief: t.brief || ticket.initial_brief || '',
    acceptance_criteria: (t.acceptance_criteria || []).map((text, i) => ({ id: `AC-${i + 1}`, text })),
    affected_areas: t.affected_areas || [],
    constraints: t.constraints || [],
    verification_method: t.verification_method || 'ui',
    verification_reason: t.verification_reason || '',
  };
}

function validateSpec(spec) {
  if (spec?.schema_version !== 1 || typeof spec.brief !== 'string' || !spec.brief.trim()) {
    throw new Error('MR specification requires schema_version 1 and a verified brief');
  }
  if (!Array.isArray(spec.acceptance_criteria) || !spec.acceptance_criteria.length
    || spec.acceptance_criteria.some((c, i) => c?.id !== `AC-${i + 1}` || typeof c.text !== 'string' || !c.text.trim())) {
    throw new Error('MR specification needs nonempty criteria with ordered, stable AC-1, AC-2, … IDs');
  }
  for (const key of ['affected_areas', 'constraints']) {
    if (!Array.isArray(spec[key]) || spec[key].some(v => typeof v !== 'string')) throw new Error(`Invalid specification ${key}`);
  }
  if (!['unit_test_only', 'api', 'ui'].includes(spec.verification_method)) throw new Error('Invalid specification verification_method');
  return spec;
}

function renderDescription(ticket) {
  const spec = validateSpec(fromTicket(ticket));
  return 'Draft implementation of the verified specification below. Edit requirements in this block; '
    + 'keep criterion IDs stable and append new criteria. A requirement change restarts test authoring.\n\n'
    + `${START}\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n${END}`;
}

function parseDescription(description) {
  const text = String(description || '');
  if (text.split(START).length !== 2 || text.split(END).length !== 2) {
    throw new Error('MR description is missing its unique codemonkey-spec block; restore it before retrying');
  }
  const block = text.slice(text.indexOf(START) + START.length, text.indexOf(END)).trim();
  const match = /^```json\s*([\s\S]*?)\s*```$/.exec(block);
  if (!match) throw new Error('MR specification must be a JSON fenced block');
  return validateSpec(JSON.parse(match[1]));
}

function snapshotMr(mr, previous) {
  const specification = parseDescription(mr.description);
  const contentHash = specHash(specification);
  return {
    schema_version: 1,
    revision: previous ? previous.revision + (previous.content_hash === contentHash ? 0 : 1) : 1,
    content_hash: contentHash,
    source: { mr_iid: String(mr.iid), mr_url: mr.web_url || '', commit_sha: mr.sha || null },
    captured_at: new Date().toISOString(),
    specification,
  };
}

function matchesMr(snapshot, mr) {
  return snapshot.content_hash === specHash(parseDescription(mr.description));
}
function criteria(ticket) {
  return ticket.spec_snapshot?.specification.acceptance_criteria.map(c => c.text) || ticket.triage?.acceptance_criteria;
}

module.exports = { fromTicket, renderDescription, parseDescription, snapshotMr, matchesMr, criteria };
