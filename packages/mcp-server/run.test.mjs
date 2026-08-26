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

// Hosts que não injetam CLAUDE_PLUGIN_ROOT nem expandem o placeholder no argv
// (Cursor/Grok): o bootstrap tem que achar o run.sh nos caches conhecidos,
// escolhendo a instalação mais recente (-nt) entre marketplace/plugin/versão.
function bootstrapCommand(file) {
  const mcp = mcpFrom(file);
  return { cmd: mcp.command, argv: [mcp.args[0], mcp.args[1], mcp.args[2]], label: file.includes('plugin-manifests') ? 'template-claude' : 'claude-plugin' };
}

function plantRunSh(home, relCache, marker, mtimeMs) {
  const dir = path.join(home, relCache, 'packages/mcp-server');
  fs.mkdirSync(dir, { recursive: true });
  const sh = path.join(dir, 'run.sh');
  fs.writeFileSync(sh, `#!/usr/bin/env bash\necho "${marker}"\n`);
  fs.chmodSync(sh, 0o755);
  fs.utimesSync(sh, new Date(mtimeMs), new Date(mtimeMs));
  return sh;
}

const NO_PLUGIN_ROOT_ENV = (home) => ({
  HOME: home,
  PATH: process.env.PATH ?? '/usr/bin:/bin',
});

for (const file of [PLUGIN_JSON, MANIFEST_JSON]) {
  test(`plugin.json (${bootstrapCommand(file).label}) -c resolve run.sh do cache mais recente sem env de plugin`, () => {
    const { cmd, argv } = bootstrapCommand(file);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-bootstrap-home-'));
    plantRunSh(home, '.cursor/plugins/cache/talos/talos/antigo', 'PICKED:ANTIGO', Date.now() - 60_000);
    plantRunSh(home, '.zcode/cli/plugins/cache/talos/talos/0.0.9', 'PICKED:NOVO', Date.now());
    const out = execFileSync(cmd, argv, {
      cwd: os.tmpdir(),
      env: NO_PLUGIN_ROOT_ENV(home),
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.match(out, /PICKED:NOVO/);
    assert.doesNotMatch(out, /PICKED:ANTIGO/);
  });

  test(`plugin.json (${bootstrapCommand(file).label}) -c falha com mensagem acionável quando nada é encontrado`, () => {
    const { cmd, argv } = bootstrapCommand(file);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-bootstrap-vazio-'));
    let err;
    try {
      execFileSync(cmd, argv, {
        cwd: os.tmpdir(),
        env: NO_PLUGIN_ROOT_ENV(home),
        encoding: 'utf8',
        timeout: 10_000,
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'bootstrap deveria falhar sem nenhum run.sh conhecido');
    assert.equal(err.status, 1);
    assert.match(String(err.stderr), /run\.sh não encontrado/);
    assert.match(String(err.stderr), /atualize\/reinstale/);
  });
}
