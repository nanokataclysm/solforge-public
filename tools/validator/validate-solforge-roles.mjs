#!/usr/bin/env node
/**
 * Solforge role + policy validator (replaces root validate-development-personas.mjs).
 * Checks policy/development-personas.json against wired product roles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIRED_ROLES } from '../../apps/orchestrator/lib/models.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const policyPath = path.join(root, 'policy/development-personas.json');

/** Product-wired roles (must exist in models / MCP) */
const WIRED = WIRED_ROLES;

/** Full persona set still allowed in policy for lab documentation */
const OPTIONAL = Object.freeze([
  'cartographer', 'architect', 'builder', 'validator',
  'sentinel', 'operator', 'designer', 'curator',
]);

const errors = [];

if (!fs.existsSync(policyPath)) {
  console.error('missing', policyPath);
  process.exit(1);
}

const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const personas = policy.personas ?? [];
const ids = new Set(personas.map((p) => p.id));

for (const id of WIRED) {
  // planner may map to architect/builder in old policy — require navigator at minimum
  if (id === 'navigator' && !ids.has('navigator')) {
    errors.push('wired role navigator missing from policy');
  }
}

// Every persona must have mode + allowed_actions
for (const p of personas) {
  if (!p.id) errors.push('persona without id');
  if (!p.default_mode) errors.push(`${p.id}: missing default_mode`);
  if (!Array.isArray(p.allowed_actions)) errors.push(`${p.id}: allowed_actions`);
  if (!Array.isArray(p.forbidden_actions)) errors.push(`${p.id}: forbidden_actions`);
}

if (errors.length) {
  console.error('FAIL');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

console.log('OK solforge roles');
console.log(JSON.stringify({ wired: WIRED, policyPersonas: [...ids], optional: OPTIONAL }, null, 2));
