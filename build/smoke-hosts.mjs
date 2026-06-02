#!/usr/bin/env node
// Smoke de não-regressão multi-host (S04 / G3; base da matriz de conformance S11).
// Sobe o MCP server via stdio com o env de cada host e valida boot + detecção +
// contrato atlas_capabilities + atlas_ping. Falha (exit != 0) em qualquer divergência.
//
// Cursor não tem perfil próprio: instala via manifest Claude e expõe CLAUDE_PLUGIN_ROOT,
// então é coberto pelo caso `claude` (mesma detecção). Ver DISTRIBUICAO_INVARIANTE.md.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/mcp-server/server.js');

// caso → { env extra, host esperado, via esperado, label }
const CASES = [
  { name: 'claude (= cursor via CLAUDE_PLUGIN_ROOT)', env: { CLAUDE_PLUGIN_ROOT: '/tmp/x' }, host: 'claude', via: 'env:CLAUDE_PLUGIN_ROOT' },
  { name: 'codex (CODEX_HOME)', env: { CODEX_HOME: '/tmp/y' }, host: 'codex', via: 'env:CODEX' },
  { name: 'opencode (ATLAS_HOST via opencode.json)', env: { ATLAS_HOST: 'opencode' }, host: 'opencode', via: 'env:ATLAS_HOST' },
  { name: 'generic (sem env)', env: {}, host: 'generic', via: 'default' },
  { name: 'override ATLAS_HOST', env: { ATLAS_HOST: 'codex', CLAUDE_PLUGIN_ROOT: '/tmp/x' }, host: 'codex', via: 'env:ATLAS_HOST' },
];

function rpc(server, msg) {
  server.stdin.write(`${JSON.stringify(msg)}\n`);
}

function runCase(c) {
  return new Promise((resolve) => {
    // Limpa env de host herdado para não contaminar a detecção.
    const env = { ...process.env };
    delete env.ATLAS_HOST; delete env.CLAUDE_PLUGIN_ROOT; delete env.CODEX_HOME; delete env.CODEX_PLUGIN_ROOT;
    Object.assign(env, c.env);
    const server = spawn('node', [SERVER], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const results = {};
    server.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.id === 2) results.cap = JSON.parse(m.result.content[0].text);
        if (m.id === 3) { results.ping = JSON.parse(m.result.content[0].text); server.stdin.end(); }
      }
    });
    server.on('close', () => resolve(results));
    rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'atlas_capabilities', arguments: {} } });
    rpc(server, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'atlas_ping', arguments: {} } });
  });
}

const errors = [];
for (const c of CASES) {
  const r = await runCase(c);
  const cap = r.cap ?? {};
  if (cap.host !== c.host) errors.push(`${c.name}: host '${cap.host}' != esperado '${c.host}'`);
  if (cap.detected_via !== c.via) errors.push(`${c.name}: detected_via '${cap.detected_via}' != '${c.via}'`);
  if (cap.schema_version !== 2) errors.push(`${c.name}: schema_version '${cap.schema_version}' != 2`);
  if (!cap.capabilities_flags) errors.push(`${c.name}: sem capabilities_flags`);
  if (!r.ping || r.ping.status !== 'alive') errors.push(`${c.name}: atlas_ping status '${r.ping?.status}' != 'alive'`);
  if (!errors.some((e) => e.startsWith(c.name))) console.log(`  ✓ ${c.name} → host=${cap.host} sv=${cap.schema_version} ping=ok`);
}

if (errors.length) {
  console.error('smoke-hosts: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('smoke-hosts: ok (boot + detecção + capabilities + ping por host)');
