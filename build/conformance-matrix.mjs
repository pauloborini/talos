#!/usr/bin/env node
// Matriz de conformance multi-host (S11 / F5). Por host suportado, valida via
// stdio o ciclo crítico: boot + ping + capabilities + preflight (PASS) +
// preflight PREREQ hard-fail (simulado) + veredito JSON parseável do agente.
// Tudo simulado por env (sem host real). Falha (exit != 0) em qualquer célula.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'packages/mcp-server/server.js');

// Hosts suportados + onde mora o arquivo de agente (p/ checagem de veredito).
const HOSTS = [
  { host: 'claude', agent: 'agents/atlas-task-validator.md' },
  { host: 'codex', agent: 'packages/skills/atlas-task-validator/SKILL.md' },
  { host: 'opencode', agent: 'hosts/opencode/.opencode/agents/atlas-task-validator.md' },
  { host: 'pi', agent: 'hosts/pi/agents/atlas-task-validator.md' },
  { host: 'generic', agent: 'agents/atlas-task-validator.md' },
];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-conf-'));

function call(server, requests) {
  return new Promise((resolve) => {
    let buf = '';
    const out = {};
    server.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.id && m.result && m.result.content) out[m.id] = JSON.parse(m.result.content[0].text);
        if (m.id === requests.length) { server.stdin.end(); }
      }
    });
    server.on('close', () => resolve(out));
    for (const r of requests) server.stdin.write(`${JSON.stringify(r)}\n`);
  });
}

function verdictParseable(agentRel) {
  const text = fs.readFileSync(path.join(ROOT, agentRel), 'utf8');
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const block = blocks.find((b) => b.includes('"verdict"'));
  if (!block) return false;
  // Bloco canônico é JSON válido (valores são strings/0, sem placeholders <...>).
  // Parse real: prova que o contrato de veredito é JSON parseável de verdade.
  try {
    const parsed = JSON.parse(block);
    return parsed && typeof parsed === 'object' && 'verdict' in parsed;
  } catch {
    return false;
  }
}

const errors = [];
for (const { host, agent } of HOSTS) {
  const env = { ...process.env };
  delete env.ATLAS_HOST; delete env.CLAUDE_PLUGIN_ROOT; delete env.CODEX_HOME; delete env.CODEX_PLUGIN_ROOT;
  env.ATLAS_HOST = host;
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'atlas_ping', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'atlas_capabilities', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'atlas_preflight', arguments: { run_id: `conf-${host}-ok`, mode: 'direct', project_root: TMP, host_capabilities: { subagent_available: true, mcp_available: true } } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'atlas_preflight', arguments: { run_id: `conf-${host}-blk`, mode: 'direct', project_root: TMP, host_capabilities: { subagent_available: false } } } },
  ];
  const server = spawn('node', [SERVER], { env, cwd: TMP, stdio: ['pipe', 'pipe', 'ignore'] });
  // eslint-disable-next-line no-await-in-loop
  const r = await call(server, reqs);

  const cells = [];
  const fail = (msg) => { errors.push(`[${host}] ${msg}`); cells.push('✗'); };
  const ok = () => cells.push('✓');

  // boot + ping
  (r[2] && r[2].status === 'alive') ? ok() : fail('ping != alive');
  // capabilities host + schema
  (r[3] && r[3].host === host && r[3].schema_version === 2) ? ok() : fail(`capabilities host '${r[3]?.host}' sv '${r[3]?.schema_version}'`);
  // preflight PASS: prereq ok + rota travada no G10 (assert forte, não só !=PREREQ)
  (r[4] && r[4].status === 'passed' && r[4].gate === 'G10') ? ok() : fail(`preflight PASS != G10/passed (${JSON.stringify(r[4])})`);
  // preflight PREREQ hard-fail simulado
  (r[5] && r[5].gate === 'PREREQ' && r[5].status === 'blocked') ? ok() : fail(`preflight hard-fail não disparou (${r[5]?.gate}/${r[5]?.status})`);
  // veredito parseável
  verdictParseable(agent) ? ok() : fail('veredito JSON não encontrado/estruturado');

  console.log(`  ${cells.join(' ')}  ${host}  [ping|caps|preflight|hardfail|verdict]`);
}

fs.rmSync(TMP, { recursive: true, force: true });

if (errors.length) {
  console.error('conformance-matrix: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('conformance-matrix: ok (5 hosts × 5 cenários verdes — simulado por env)');
