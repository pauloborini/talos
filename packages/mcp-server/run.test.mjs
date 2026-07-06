import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_SH = path.join(DIR, 'run.sh');
const PLUGIN_ROOT = path.resolve(DIR, '../..');
const CURSOR_NODE = '/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node';

test('run.sh é executável', () => {
  fs.accessSync(RUN_SH, fs.constants.X_OK);
});

test('run.sh --resolve-node encontra Node com PATH mínimo no macOS', { skip: process.platform !== 'darwin' }, () => {
  const resolved = execFileSync(RUN_SH, ['--resolve-node'], {
    env: {
      HOME: process.env.HOME ?? '/tmp',
      PATH: '/usr/bin:/bin',
    },
    encoding: 'utf8',
  }).trim();

  assert.ok(resolved.length > 0);
  assert.ok(fs.existsSync(resolved), `binário inexistente: ${resolved}`);
  const mode = fs.statSync(resolved).mode;
  assert.ok(mode & fs.constants.S_IXUSR, `sem +x: ${resolved}`);
});

test('run.sh --resolve-node prioriza node embutido do Cursor quando disponível', {
  skip: process.platform !== 'darwin' || !fs.existsSync(CURSOR_NODE),
}, () => {
  const resolved = execFileSync(RUN_SH, ['--resolve-node'], {
    env: {
      HOME: process.env.HOME ?? '/tmp',
      PATH: '/usr/bin:/bin',
    },
    encoding: 'utf8',
  }).trim();

  assert.equal(resolved, CURSOR_NODE);
});

test('run.sh resolve server sem CLAUDE_PLUGIN_ROOT no env', () => {
  const out = execFileSync(RUN_SH, ['--resolve-node'], {
    env: {
      HOME: process.env.HOME ?? '/tmp',
      PATH: process.env.PATH ?? '/usr/bin:/bin',
    },
    encoding: 'utf8',
  }).trim();
  assert.ok(out.length > 0);
});
