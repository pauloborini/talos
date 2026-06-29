#!/usr/bin/env node
// Matriz de conformance multi-host (S11 / F5). Por host suportado, valida via
// stdio o ciclo crítico: boot + ping + capabilities + preflight (PASS) +
// preflight PREREQ hard-fail (simulado) + veredito JSON parseável do agente.
//
// ESCOPO HONESTO (não é teatro verde): isto exercita só a LÓGICA DO MCP SERVER via
// stdio, com ATLAS_HOST setado por env. NÃO exercita a integração real das extensões
// de host — opencode (.opencode/agents + opencode.json) é coberto por teste manual no
// opencode real; pi (pi-mcp-adapter proxia/prefixa as tools + pi-subagents dispara via
// tool `subagent`) só é validado ponta-a-ponta no pi real. Verde aqui = server correto,
// não = host instalado funcionando. Falha (exit != 0) em qualquer célula.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'packages/mcp-server/server.js');

// Contrato atual: ver CAPABILITIES_SCHEMA_VERSION em packages/mcp-server/server.js (v5).
const EXPECTED_SCHEMA_VERSION = 5;

// Hosts suportados + onde mora o arquivo de agente (p/ checagem de veredito) +
// join.sync esperado por perfil (sibling-only, DEC-SIB-003): hosts nativos
// (claude/codex/opencode/zcode) = 'self_evident'; must_report (pi/generic) = 'must_report'.
// dispatch_mutable é reportado nos cenários PASS para hosts com dispatch_capability
// unknown; hosts mutable ignoram o flag.
const HOSTS = [
  { host: 'claude', agent: 'agents/atlas-task-validator.md', join_sync: 'self_evident' },
  { host: 'codex', agent: 'plugins/atlas-workflow-orchestrator/.codex/agents/atlas-task-validator.toml', join_sync: 'self_evident' },
  { host: 'opencode', agent: 'hosts/opencode/.opencode/agents/atlas-task-validator.md', join_sync: 'self_evident' },
  { host: 'pi', agent: 'hosts/pi/.pi/agents/atlas-task-validator.md', join_sync: 'must_report' },
  { host: 'zcode', agent: 'hosts/zcode/agents/atlas-task-validator.md', join_sync: 'self_evident' },
  { host: 'generic', agent: 'agents/atlas-task-validator.md', join_sync: 'must_report' },
];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-conf-'));

// Fixture p/ o cenário `execute`: arquivo com nome PLAN_*.md → classify_input o
// classifica como `plan` (dica de nome), roteando para o modo execute (PRD D5/D6).
const PLAN_FIXTURE = 'PLAN_conf_execute.md';
fs.writeFileSync(path.join(TMP, PLAN_FIXTURE), '# PLAN conformance execute\n\nPlano de fixture para o cenário execute da matriz.\n');

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
  let text = fs.readFileSync(path.join(ROOT, agentRel), 'utf8');
  if (agentRel.endsWith('.toml')) {
    const m = text.match(/^developer_instructions\s*=\s*(".*")$/m);
    if (!m) return false;
    try { text = JSON.parse(m[1]); } catch { return false; }
  }
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
for (const { host, agent, join_sync } of HOSTS) {
  const env = { ...process.env };
  delete env.ATLAS_HOST; delete env.CLAUDE_PLUGIN_ROOT; delete env.CODEX_HOME; delete env.CODEX_PLUGIN_ROOT;
  env.ATLAS_HOST = host;
  const reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'atlas_ping', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'atlas_capabilities', arguments: {} } },
    // host_capabilities reporta join_sync_available + dispatch_mutable:
    // - JOIN é fail-closed para hosts must_report (pi/generic);
    // - DISPATCH é fail-closed para dispatch_capability unknown (pi/zcode/generic).
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'atlas_preflight', arguments: { run_id: `conf-${host}-ok`, mode: 'direct', project_root: TMP, host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: true, dispatch_mutable: true } } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'atlas_preflight', arguments: { run_id: `conf-${host}-blk`, mode: 'direct', project_root: TMP, host_capabilities: { subagent_available: false } } } },
    // Cenário `execute` (T15): preflight(execute) → classify_input(plano) →
    // lock_dispatch(start, plan_execute) como PRIMEIRA fase → assert_after_plan no-op.
    // Run_id próprio para a rota travar em execute (sem colidir com os -ok/-blk de direct).
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'atlas_preflight', arguments: { run_id: `conf-${host}-exec`, mode: 'execute', project_root: TMP, host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: true, dispatch_mutable: true } } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'atlas_classify_input', arguments: { run_id: `conf-${host}-exec`, project_root: TMP, input_path: PLAN_FIXTURE } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'atlas_lock_dispatch', arguments: { run_id: `conf-${host}-exec`, project_root: TMP, action: 'start', phase: 'plan_execute' } } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'atlas_assert_after_plan', arguments: { run_id: `conf-${host}-exec`, project_root: TMP, attempted_action: 'dispatch_plan_execute' } } },
    // Cleanup: aborta a fase ativa para liberar o lock no ledger compartilhado (TMP
    // é único entre hosts); sem isto o próximo host bate em LOCK_CONFLICT no preflight.
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'atlas_lock_dispatch', arguments: { run_id: `conf-${host}-exec`, project_root: TMP, action: 'abort', phase: 'plan_execute' } } },
    // Cenário JOIN/blocked (P3 S13): preflight audit com PREREQ ok (subagent+mcp true)
    // mas SEM join_sync_available. Audit evita o gate DISPATCH, isolando o gate JOIN.
    // Para must_report (pi/generic): gate JOIN bloqueado.
    // Para self_evident (claude/codex/opencode/zcode): preflight passa — não exige report.
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'atlas_preflight', arguments: { run_id: `conf-${host}-jblk`, mode: 'audit', project_root: TMP, host_capabilities: { subagent_available: true, mcp_available: true } } } },
  ];
  const server = spawn('node', [SERVER], { env, cwd: TMP, stdio: ['pipe', 'pipe', 'ignore'] });
  // eslint-disable-next-line no-await-in-loop
  const r = await call(server, reqs);

  const cells = [];
  const fail = (msg) => { errors.push(`[${host}] ${msg}`); cells.push('✗'); };
  const ok = () => cells.push('✓');

  // boot + ping
  (r[2] && r[2].status === 'alive') ? ok() : fail('ping != alive');
  // capabilities host + schema v5 + topologia sibling (dispatcher orchestrator,
  // sem topology, join.sync por perfil — DEC-SIB-001/003).
  {
    const cap = r[3] ?? {};
    const vd = cap.validator_dispatch ?? {};
    (cap.host === host
      && cap.schema_version === EXPECTED_SCHEMA_VERSION
      && vd.dispatcher === 'orchestrator'
      && vd.topology === undefined
      && vd.join && vd.join.sync === join_sync)
      ? ok()
      : fail(`capabilities host '${cap.host}' sv '${cap.schema_version}' dispatcher '${vd.dispatcher}' topology '${vd.topology}' join.sync '${vd.join?.sync}' (esperado join.sync '${join_sync}')`);
  }
  // preflight PASS: prereq ok + rota travada no G10 (assert forte, não só !=PREREQ)
  (r[4] && r[4].status === 'passed' && r[4].gate === 'G10') ? ok() : fail(`preflight PASS != G10/passed (${JSON.stringify(r[4])})`);
  // preflight PREREQ hard-fail simulado
  (r[5] && r[5].gate === 'PREREQ' && r[5].status === 'blocked') ? ok() : fail(`preflight hard-fail não disparou (${r[5]?.gate}/${r[5]?.status})`);
  // veredito parseável
  verdictParseable(agent) ? ok() : fail('veredito JSON não encontrado/estruturado');

  // --- Cenário `execute` (T15) ---
  // preflight(execute): rota travada no G10/passed + guarantee_level full_pipeline + banner.
  (r[6] && r[6].gate === 'G10' && r[6].status === 'passed' && r[6].mode === 'execute'
    && r[6].guarantee_level === 'full_pipeline' && typeof r[6].banner === 'string' && r[6].banner.length > 0)
    ? ok() : fail(`preflight(execute) != G10/passed/full_pipeline+banner (${JSON.stringify(r[6])})`);
  // classify_input: plano detectado → artifact_type plan, routed_mode execute, banner não vazio.
  (r[7] && r[7].artifact_type === 'plan' && r[7].routed_mode === 'execute'
    && typeof r[7].banner === 'string' && r[7].banner.length > 0)
    ? ok() : fail(`classify_input(plano) != plan/execute+banner (${JSON.stringify(r[7])})`);
  // lock_dispatch(start, plan_execute) como PRIMEIRA fase em execute: G7/passed + banner.
  (r[8] && r[8].gate === 'G7' && r[8].status === 'passed' && r[8].phase === 'plan_execute'
    && typeof r[8].banner === 'string' && r[8].banner.length > 0)
    ? ok() : fail(`lock_dispatch(start,plan_execute) != G7/passed+banner (${JSON.stringify(r[8])})`);
  // assert_after_plan em execute: no-op explícito (applicable:false, passed) + banner.
  (r[9] && r[9].status === 'passed' && r[9].applicable === false && r[9].mode === 'execute'
    && typeof r[9].banner === 'string' && r[9].banner.length > 0)
    ? ok() : fail(`assert_after_plan(execute) != passed/applicable:false+banner (${JSON.stringify(r[9])})`);

  // --- Cenário JOIN/blocked (P3 S13) ---
  // must_report (pi/generic): PREREQ ok mas join_sync_available ausente → gate JOIN blocked.
  // self_evident (claude/codex/opencode/zcode): mesmo payload audit → preflight passa (G10/passed).
  if (join_sync === 'must_report') {
    (r[11] && r[11].gate === 'JOIN' && r[11].status === 'blocked')
      ? ok() : fail(`preflight JOIN/blocked != JOIN/blocked para must_report (${JSON.stringify(r[11])})`);
  } else {
    (r[11] && r[11].gate === 'G10' && r[11].status === 'passed')
      ? ok() : fail(`preflight JOIN/pass != G10/passed para self_evident (${JSON.stringify(r[11])})`);
  }

  console.log(`  ${cells.join(' ')}  ${host}  [ping|caps|preflight|hardfail|verdict|exec.preflight|exec.classify|exec.dispatch|exec.assert|join.gate]`);
}

fs.rmSync(TMP, { recursive: true, force: true });

if (errors.length) {
  console.error('conformance-matrix: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('conformance-matrix: ok (6 hosts × 10 cenários verdes — simulado por env)');
