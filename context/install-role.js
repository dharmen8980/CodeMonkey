#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const ROLES = ['chat', 'triage', 'new-task', 'review-feedback', 'unit-test', 'implement'];

function installRole(role, source, destination, artifacts) {
  if (!ROLES.includes(role)) throw new Error(`Unknown instruction role: ${role}`);
  const common = fs.readFileSync(path.join(source, 'instructions/common.md'), 'utf8');
  const specific = fs.readFileSync(path.join(source, `instructions/${role}.md`), 'utf8');
  const instructions = `${common}\n\n${specific}`;
  fs.mkdirSync(destination, { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(destination, 'CLAUDE.md'), instructions);
  fs.writeFileSync(path.join(destination, 'instructions.md'), instructions);
  fs.writeFileSync(path.join(artifacts, 'instructions.md'), instructions);
  const manifest = { version: 1, role, instructions,
    instructions_sha256: createHash('sha256').update(instructions).digest('hex'), references: {} };
  fs.writeFileSync(path.join(artifacts, 'instruction-references.json'), '{}');
  fs.writeFileSync(path.join(artifacts, 'instruction-manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (require.main === module) {
  installRole(process.argv[2], '/opt/orchestrator-context', '/root/.claude', process.argv[3]);
  fs.rmSync('/opt/orchestrator-context', { recursive: true });
}
module.exports = { installRole, ROLES };
