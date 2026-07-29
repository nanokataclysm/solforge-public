#!/usr/bin/env node
/** @deprecated use tools/validator/validate-solforge-roles.mjs */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(root, 'tools/validator/validate-solforge-roles.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
