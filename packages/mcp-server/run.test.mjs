import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

test('server.js responde initialize via symlink do entrypoint', () => {
  const server = path.join(DIR, 'server.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-mcp-symlink-'));
  const link = path.join(tmp, 'server-link.js');
  fs.symlinkSync(server, link);

  const node = execFileSync(RUN_SH, ['--resolve-node'], {
    env: { HOME: process.env.HOME ?? '/tmp', PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  }).trim();

  const init = `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  })}\n`;

  const out = execFileSync(node, [link], {
    input: init,
    env: {
      HOME: process.env.HOME ?? '/tmp',
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    },
    encoding: 'utf8',
    timeout: 5000,
  });

  assert.match(out, /"protocolVersion":"2024-11-05"/);
});

const PLUGIN_JSON = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
const MANIFEST_JSON = path.join(PLUGIN_ROOT, 'plugin-manifests/claude/plugin.json');

function mcpFrom(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.talos;
}

test('plugin.json Claude/Cursor não usa path literal de CLAUDE_PLUGIN_ROOT como argv', () => {
  for (const file of [PLUGIN_JSON, MANIFEST_JSON]) {
    const mcp = mcpFrom(file);
    assert.equal(mcp.command, '/bin/bash');
    assert.equal(mcp.args[0], '-c');
    assert.equal(mcp.args[2], 'talos-mcp');
    assert.equal(mcp.args.includes('${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/run.sh'), false);
    assert.match(mcp.args[1], /PLUGIN_ROOT/);
  }
});

test('plugin.json -c acha run.sh via CLAUDE_PLUGIN_ROOT com cwd fora do plugin', () => {
  const mcp = mcpFrom(PLUGIN_JSON);
  const out = execFileSync(mcp.command, [mcp.args[0], mcp.args[1], mcp.args[2], '--resolve-node'], {
    cwd: os.tmpdir(),
    env: {
      HOME: process.env.HOME ?? '/tmp',
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
    },
    encoding: 'utf8',
  }).trim();
  assert.ok(out.length > 0);
  assert.ok(fs.existsSync(out), `binário inexistente: ${out}`);
});
