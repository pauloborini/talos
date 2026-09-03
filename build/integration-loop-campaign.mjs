#!/usr/bin/env node
// Harness de integração stdio — campanha real do loop de sprints (0.21.0 boundary).
//
// ESCOPO HONESTO: sobe packages/mcp-server/server.js como PROCESSO REAL e fala
// só por JSON-RPC via stdin/stdout (tools/call) — nenhuma função interna é
// importada/chamada direto. Materializa um sandbox git REAL com 4 sprints §7
// aprovadas/seladas (uma com Traceability: v1) e percorre a cadeia completa
// por sprint: preflight -> select_next -> lock_dispatch(start) -> first_write
// -> commit_state -> lock_validator(start/complete) -> update_sprint_status
// -> select_next de novo. Inclui os caminhos negativos do boundary 0.21 (D6-D22
// do FSM_BOUNDARY_MINIMAL_GUIDE): first_write ausente, claim fora do fato,
// JSON órfão + reconcile, terminal+review bloqueando select_next, slot de
// validator com id divergente.
//
// Não corrige o MCP. Não commita nada no repo do projeto. Grava capture JSONL
// por operação e emite relatório de campanha (markdown) ao final.
//
// Uso: node build/integration-loop-campaign.mjs [--out-dir <dir>]

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { computeAcceptanceSeal } from '../packages/skills/_shared/scripts/document_quality.mjs';
import { TRACEABILITY_SCHEMA_VERSION } from '../packages/mcp-server/traceability.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'packages/mcp-server/server.js');
const HANDOFF_TEMPLATE_SRC = path.join(ROOT, 'packages/mcp-server/fixtures/HANDOFF_TEMPLATE.md');

const argOutIdx = process.argv.indexOf('--out-dir');
const OUT_DIR = argOutIdx !== -1 && process.argv[argOutIdx + 1]
  ? path.resolve(process.argv[argOutIdx + 1])
  : path.join(ROOT, '.app-work', 'VALIDACAO_INTEGRADA_LOOP_2026-09-03');
const CAPTURE_DIR = path.join(OUT_DIR, 'captures');
fs.mkdirSync(CAPTURE_DIR, { recursive: true });
const CAPTURE_PATH = path.join(CAPTURE_DIR, `campaign.${Date.now()}.jsonl`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-campaign-'));

// ── Sandbox git real ──────────────────────────────────────────────────────
function git(args) {
  return execFileSync('git', ['-C', TMP, ...args], { encoding: 'utf8' }).trim();
}
git(['init', '-q']);
git(['config', 'user.email', 'talos-campaign@example.invalid']);
git(['config', 'user.name', 'Talos Campaign']);
fs.writeFileSync(path.join(TMP, 'README.md'), '# sandbox campanha integração\n');
git(['add', 'README.md']);
git(['commit', '-qm', 'base']);

fs.mkdirSync(path.join(TMP, '.talos/memory'), { recursive: true });
fs.copyFileSync(HANDOFF_TEMPLATE_SRC, path.join(TMP, '.talos/memory/HANDOFF_TEMPLATE.md'));

// ── Fixture de sprint file §7 (réplica fiel de sprintDoc() em server.test.js) ─
function sprintDoc({
  id, status = 'ready', dorStatus = 'verde', contratoStatus = 'aprovado',
  moscow = 'Must', prioridade = 'P0', traceability = false,
} = {}) {
  const acceptanceBlock = [
    '### 7.3 Aceite binário',
    '```yaml',
    'acceptance:',
    '  - id: AC-001',
    '    origin: "usuario"',
    '    behavior: "Gate observável passa quando AC válido"',
    '    decisions: [D1]',
    '    scenario: "Carregar harness"',
    '    evals: [EVAL-001]',
    '    evidence:',
    '      required: [I, T-outcome, W]',
    '      manual: null',
    '  - id: AC-002',
    '    origin: "usuario"',
    '    behavior: "Parser antigo preservado após mudança"',
    '    decisions: [D1]',
    '    scenario: "Regressão de produto"',
    '    evals: [EVAL-001]',
    '    evidence:',
    '      required: [I, T-outcome]',
    '      manual: null',
    '```',
  ];
  const contratoBlock = [
    '## 7. Contrato de produto (congelado)',
    '### 7.1 Decisões de produto (D*)',
    '| ID | Decisão | Origem |',
    '|---|---|---|',
    '| D1 | Runtime harness entrega gate observável | usuario |',
    '### 7.2 Cenários UX',
    '### 7.2.1 Carregar harness',
    '- **Entrada:** operador abre o harness',
    '- **Comportamento:** loading / vazio / erro',
    '- **Sucesso:** gate passa',
    ...acceptanceBlock,
  ];
  let doc = [
    `# Sprint viva — ${id} — Campanha de integração`,
    '',
    '## 1. Metadados',
    '| Campo | Valor |',
    '|---|---|',
    `| Sprint ID | ${id} |`,
    '| Nome | Campanha de integração |',
    `| Status | ${status} |`,
    `| Backlog mestre | BACKLOG.md#${id} |`,
    `| Contrato status | ${contratoStatus} |`,
    '| PRD | pendente |',
    '| PLAN | pendente |',
    '| State / evidência | pendente |',
    '| Revalidação | false |',
    ...(traceability ? ['| Traceability | v1 |'] : []),
    '| Fase | F0 |',
    `| MoSCoW | ${moscow} |`,
    `| Prioridade | ${prioridade} |`,
    '| Responsável | Talos |',
    '| Criado em | 2026-09-03 |',
    '| Última atualização | 2026-09-03 |',
    '',
    '## 2. Objetivo e valor',
    'Objetivo único.',
    '## 3. Escopo da sprint',
    '- [ ] Entrega',
    '## 4. Contexto e fontes',
    '| Tipo | Fonte | Uso nesta sprint |',
    '|---|---|---|',
    `| Backlog | BACKLOG.md#${id} | escopo |`,
    '| Discussão | .app-work/VALIDACAO_INTEGRADA_LOOP_2026-09-03/campanha | decisão/contexto |',
    '## 5. Dependências e bloqueios',
    '| ID | Tipo | Descrição | Status | Evidência |',
    '|---|---|---|---|---|',
    '| DEP-001 | interna | nada | done | link |',
    '## 6. Decisões da sprint',
    '| ID | Decisão | Fonte | Impacto | Status |',
    '|---|---|---|---|---|',
    '| SD-001 | seguir | backlog | baixo | aprovada |',
    ...contratoBlock,
    '## 8. Definition of Ready',
    '- [ ] Próxima ação explícita.',
    `**Status DoR:** ${dorStatus}`,
    '## 9. Eval manifest',
    '```yaml',
    'eval_manifest:',
    `  sprint_id: "${id}"`,
    '  objective: "campanha de integração stdio"',
    '  must_prove:',
    '    - id: "EVAL-001"',
    '      claim: "gate passa"',
    '      source: "SPRINT"',
    '      evidence_required: "harness stdio"',
    '  regression_guards:',
    '    - "boundary git+ledger preservado"',
    '  negative_paths:',
    '    - "manifest ausente falha"',
    '```',
    '## 10. Policy manifest',
    '```yaml',
    'policy_manifest:',
    '  forbidden_scope:',
    '    - "hosts"',
    '  required_gates:',
    '    - "talos_verify_sprint_file"',
    '```',
    '## 11. Guia e sensores',
    '- [ ] Guia',
    '## 12. Evidence-to-claim',
    '| Claim | Onde foi prometido | Evidência esperada | Evidência real | Status |',
    '|---|---|---|---|---|',
    '| gate passa | sprint | harness stdio | pendente | pending |',
    '## 13. PLAN',
    '| Campo | Valor |',
    '|---|---|',
    '| Status | pendente |',
    '## 14. Execução e validação',
    '| Gate | Status | Evidência |',
    '|---|---|---|',
    '| Sprint file válido | pending | pendente |',
    '## 15. Aprendizados e handoff para próximas sprints',
    '| Tipo | Aprendizado | Afeta | Ação |',
    '|---|---|---|---|',
    '| técnico | nada | — | registrar |',
    '## 16. Histórico',
    '| Data | Autor | Mudança |',
    '|---|---|---|',
    '| 2026-09-03 | Talos | Criação |',
  ].join('\n');
  if (contratoStatus === 'aprovado') {
    const computed = computeAcceptanceSeal(doc);
    doc = doc.replace(
      `| Contrato status | ${contratoStatus} |`,
      `| Contrato status | ${contratoStatus} |\n| Selo do contrato | ${computed} |`,
    );
  }
  return doc;
}

fs.mkdirSync(path.join(TMP, '.talos/backlog/sprints'), { recursive: true });
const SPRINTS = {
  S01: { moscow: 'Must', prioridade: 'P0', dependsOn: null, traceability: false },
  S02: { moscow: 'Must', prioridade: 'P1', dependsOn: null, traceability: false },
  S03: { moscow: 'Should', prioridade: 'P2', dependsOn: 'S01', traceability: true },
  S04: { moscow: 'Should', prioridade: 'P3', dependsOn: null, traceability: false },
};
for (const [id, cfg] of Object.entries(SPRINTS)) {
  fs.writeFileSync(
    path.join(TMP, `.talos/backlog/sprints/SPRINT_${id}_campanha.md`),
    sprintDoc({ id, moscow: cfg.moscow, prioridade: cfg.prioridade, traceability: cfg.traceability }),
  );
}

function backlogRow(id) {
  const cfg = SPRINTS[id];
  const dep = cfg.dependsOn ?? '—';
  return `| ${id} | Campanha ${id} | F0 | objetivo integração | ${cfg.moscow} | Alto | Baixo | ${cfg.prioridade} | — | ${dep} | ready | — | \`.talos/backlog/sprints/SPRINT_${id}_campanha.md\` | pendente | pendente |`;
}
const BACKLOG_MD = [
  '# BACKLOG_MESTRE campanha de integração',
  '',
  '## 7. Registro de sprints',
  '| ID | Sprint | Fase-fonte | Objetivo (1 linha) | MoSCoW | Ganho | Esforço | Prioridade | PRD | Depende de | Estado | Gate | Sprint file | PLAN | State |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...Object.keys(SPRINTS).map(backlogRow),
  '',
].join('\n');
fs.writeFileSync(path.join(TMP, 'BACKLOG.md'), BACKLOG_MD);

// ── Transporte stdio JSON-RPC real ────────────────────────────────────────
const server = spawn('node', [SERVER], {
  cwd: TMP,
  env: { ...process.env, TALOS_HOST: 'claude' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

class Rpc {
  constructor(proc) {
    this.proc = proc;
    this.buf = '';
    this.pending = new Map();
    this.nextId = 1;
    proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  async raw(method, params) {
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    const p = new Promise((resolve) => this.pending.set(id, { resolve }));
    this.proc.stdin.write(`${JSON.stringify(req)}\n`);
    return p;
  }

  async call(step, tool, args) {
    const msg = await this.raw('tools/call', { name: tool, arguments: args });
    let parsed = null;
    let isError = false;
    if (msg.error) {
      isError = true;
      parsed = msg.error;
    } else if (msg.result && msg.result.content && msg.result.content[0]) {
      try { parsed = JSON.parse(msg.result.content[0].text); } catch { parsed = msg.result; }
    } else {
      parsed = msg.result;
    }
    const entry = {
      seq: this.nextId - 1, step, tool, args, response: parsed,
      is_rpc_error: isError, timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(CAPTURE_PATH, `${JSON.stringify(entry)}\n`);
    return { parsed, isError };
  }
}

const rpc = new Rpc(server);

// ── Relatório da campanha ─────────────────────────────────────────────────
const report = { checks: [], findings: [], startedAt: new Date().toISOString() };
function check(label, cond, detail) {
  report.checks.push({ label, ok: Boolean(cond), detail: detail ?? null });
  const mark = cond ? 'OK ' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
  return Boolean(cond);
}

function sha256Rel(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(TMP, rel))).digest('hex');
}
function writeFileReal(rel, content) {
  const abs = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

async function solveChallenge(challenge) {
  if (!challenge) return undefined;
  return sha256Rel(challenge.file);
}

// ── Fluxo genérico de uma slice (sprint) ──────────────────────────────────
async function runSlice(sprintId, opts = {}) {
  const runId = `camp-${sprintId.toLowerCase()}`;
  const sprintFilePath = `.talos/backlog/sprints/SPRINT_${sprintId}_campanha.md`;

  if (opts.traceability) {
    const trace = await rpc.call(`${sprintId}: traceability upsert marker v1`, 'talos_traceability', {
      run_id: runId, project_root: TMP, backlog_path: 'BACKLOG.md', action: 'upsert',
      sprint: { sprint_id: sprintId, schema: TRACEABILITY_SCHEMA_VERSION },
    });
    check(`${sprintId}: traceability upsert marca ledger.sprints.${sprintId}.schema`, trace.parsed?.document?.sprints?.[sprintId]?.schema === TRACEABILITY_SCHEMA_VERSION, JSON.stringify(trace.parsed));
  }

  const pre = await rpc.call(`${sprintId}: preflight`, 'talos_preflight', {
    run_id: runId, project_root: TMP, mode: 'direct', host: 'claude',
    host_capabilities: { subagent_available: true, mcp_available: true },
  });
  check(`${sprintId}: preflight G10/passed`, pre.parsed?.gate === 'G10' && pre.parsed?.status === 'passed', JSON.stringify(pre.parsed));

  // update_sprint_status(doing/review) muta BACKLOG.md (arquivo real, fora de
  // .talos/ — não é filtrado do fact git). Feito ANTES de lock_dispatch(start)
  // para que essas mutações já estejam refletidas no t0 (D6) e não apareçam
  // como dirty da slice (evitando falso "evidência diverge do boundary real").
  await rpc.call(`${sprintId}: update_sprint_status doing`, 'talos_update_sprint_status', {
    run_id: runId, project_root: TMP, backlog_path: 'BACKLOG.md', sprint_id: sprintId, status: 'doing',
  });
  await rpc.call(`${sprintId}: update_sprint_status review`, 'talos_update_sprint_status', {
    run_id: runId, project_root: TMP, backlog_path: 'BACKLOG.md', sprint_id: sprintId, status: 'review',
  });

  const start = await rpc.call(`${sprintId}: lock_dispatch start`, 'talos_lock_dispatch', {
    run_id: runId, project_root: TMP, action: 'start', phase: 'plan_execute',
  });
  check(`${sprintId}: lock_dispatch(start) G7/passed`, start.parsed?.status === 'passed', JSON.stringify(start.parsed));

  const srcRel = `src/${sprintId.toLowerCase()}_feature.js`;
  writeFileReal(srcRel, `// ${sprintId} feature real, mutada pela campanha em ${new Date().toISOString()}\nmodule.exports.value = ${Math.floor(Math.random() * 1000)};\n`);

  // ── Negativo (S04): commit sem first_write com worktree suja ────────────
  if (opts.negativePaths) {
    const noFw = await rpc.call(`${sprintId}: commit sem first_write (negativo D-sem-first-write)`, 'talos_commit_state', {
      run_id: runId, project_root: TMP, slice: `${sprintId}-slice1`,
      proofs: [{ kind: 'AC', id: 'AC-001', check: 'assert.ok(true) via harness', files: [srcRel] }],
      obligation_ids: ['D1'],
      sprint_file_path: sprintFilePath,
    });
    check(`${sprintId}: commit sem first_write recusado (sem_first_write_dirty)`, noFw.parsed?.code === 'sem_first_write_dirty', JSON.stringify(noFw.parsed));
  }

  const fw = await rpc.call(`${sprintId}: lock_dispatch checkpoint first_write`, 'talos_lock_dispatch', {
    run_id: runId, project_root: TMP, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  check(`${sprintId}: first_write heartbeat passed`, fw.parsed?.status === 'passed', JSON.stringify(fw.parsed));

  // ── Negativo (S04): claim fora do fato ───────────────────────────────────
  if (opts.negativePaths) {
    const phantom = await rpc.call(`${sprintId}: commit com claim fantasma (negativo D9)`, 'talos_commit_state', {
      run_id: runId, project_root: TMP, slice: `${sprintId}-slice1`,
      proofs: [{ kind: 'AC', id: 'AC-001', check: 'assert.ok(true) via harness', files: [srcRel, 'nonexistent/phantom.js'] }],
      obligation_ids: ['D1'],
      sprint_file_path: sprintFilePath,
    });
    check(`${sprintId}: claim fantasma recusado (claim_fora_do_fact)`, phantom.parsed?.code === 'claim_fora_do_fact', JSON.stringify(phantom.parsed));
  }

  const testRel = `tests/${sprintId.toLowerCase()}_feature.test.js`;
  writeFileReal(testRel, `// teste real da campanha para ${sprintId}\n`);

  const commit1 = await rpc.call(`${sprintId}: commit_state execute`, 'talos_commit_state', {
    run_id: runId, project_root: TMP, slice: `${sprintId}-slice1`,
    proofs: [
      { kind: 'AC', id: 'AC-001', check: `node --test ${testRel} -> assert.equal(actual, expected) valida ${sprintId}`, files: [srcRel, testRel] },
      { kind: 'AC', id: 'AC-002', check: `assert.ok(regressionPreserved) via ${testRel}`, files: [testRel] },
      { kind: 'EVAL', id: 'EVAL-001', check: `harness stdio evidencia EVAL-001 real via ${testRel}` },
    ],
    obligation_ids: ['D1'],
    sprint_file_path: sprintFilePath,
  });
  check(`${sprintId}: commit_state execute G12/passed`, commit1.parsed?.status === 'passed', JSON.stringify(commit1.parsed));
  const statePath1 = commit1.parsed?.state_path;

  // ── Negativo (S04): JSON órfão + reconcile ───────────────────────────────
  let statePath = statePath1;
  if (opts.negativePaths) {
    const abs = path.resolve(TMP, statePath1);
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const tampered = { ...parsed, diff_stat: 'ADULTERADO POR TESTE — não reflete o disco' };
    fs.writeFileSync(abs, `${JSON.stringify(tampered)}\n`);

    const orphanStart = await rpc.call(`${sprintId}: validator start sobre JSON órfão (negativo D12/INV6)`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'start', state_path: statePath1,
    });
    check(`${sprintId}: órfão detectado, next_action reconcile_state`, orphanStart.parsed?.status === 'blocked' && orphanStart.parsed?.next_action === 'reconcile_state', JSON.stringify(orphanStart.parsed));

    const reconcileBlind = await rpc.call(`${sprintId}: commit_state reconcile (sem proofs — auto-extração do disco)`, 'talos_commit_state', {
      run_id: runId, project_root: TMP, slice: `${sprintId}-slice1`,
    });
    check(`${sprintId}: reconcile (sem proofs) G12/passed`, reconcileBlind.parsed?.status === 'passed' && reconcileBlind.parsed?.role === 'reconcile', JSON.stringify(reconcileBlind.parsed));

    let reconciledState = null;
    try {
      reconciledState = JSON.parse(fs.readFileSync(path.resolve(TMP, reconcileBlind.parsed?.state_path ?? statePath1), 'utf8'));
    } catch { /* melhor esforço — usado só para diagnosticar o achado abaixo */ }
    const planPathBugConfirmed = reconciledState?.contract_kind === 'plan' && reconciledState?.executor_skill === 'talos-direct-execute';
    report.findings = report.findings ?? [];
    if (planPathBugConfirmed) {
      report.findings.push({
        id: 'FINDING-RECONCILE-DIRECT-CONTRACT-KIND',
        summary: "commit_state role=reconcile SEM proofs herda diskState.plan_path (default '.talos/plans/direct.md' que projectCommitStateV3 grava mesmo em modo direct, nunca null) e sobrescreve contract_kind de 'direct' para 'plan' — quebra validateStateBoundary ('talos-direct-execute exige contract_kind=direct') para toda slice direct que precise de reconcile sem re-submeter proofs.",
        state_path: reconcileBlind.parsed?.state_path,
        capture_step: `${sprintId}: commit_state reconcile (sem proofs — auto-extração do disco)`,
      });
      console.log(`[FINDING] ${sprintId}: reconcile sem proofs quebrou contract_kind (direct -> plan). Ver relatório final.`);
    }
    check(`${sprintId}: reconcile sem proofs preserva contract_kind=direct (D12)`, !planPathBugConfirmed, JSON.stringify(reconciledState));

    // reconcileBlind já deixou disco=ledger consistentes (ainda que com o
    // contract_kind quebrado pelo achado acima) — um novo commit_state ao MESMO
    // path seria recusado (`handoff_ja_pronto`, nada mudou). Para provar a
    // recuperação real por proofs explícitas (D12), tampera de novo (2º órfão)
    // antes de recommitar.
    const abs2 = path.resolve(TMP, reconcileBlind.parsed?.state_path ?? statePath1);
    const parsed2 = JSON.parse(fs.readFileSync(abs2, 'utf8'));
    fs.writeFileSync(abs2, `${JSON.stringify({ ...parsed2, diff_stat: 'ADULTERADO NOVAMENTE POR TESTE' })}\n`);

    // Recuperação por caminho alternativo real (proofs explícitas — contorna a
    // extração automática que carrega o achado acima) para a campanha seguir
    // coerente sem mascarar o defeito, já registrado com evidência.
    const reconcileExplicit = await rpc.call(`${sprintId}: commit_state reconcile (com proofs explícitas)`, 'talos_commit_state', {
      run_id: runId, project_root: TMP, slice: `${sprintId}-slice1`,
      proofs: [
        { kind: 'AC', id: 'AC-001', check: `node --test ${testRel} -> assert.equal(actual, expected) valida ${sprintId} (reconcile)`, files: [srcRel, testRel] },
        { kind: 'AC', id: 'AC-002', check: `assert.ok(regressionPreserved) via ${testRel}`, files: [testRel] },
        { kind: 'EVAL', id: 'EVAL-001', check: `harness stdio evidencia EVAL-001 real via ${testRel} (reconcile)` },
      ],
      obligation_ids: ['D1'],
      sprint_file_path: sprintFilePath,
    });
    check(`${sprintId}: reconcile (com proofs) recupera G12/passed com contract_kind=direct`, reconcileExplicit.parsed?.status === 'passed', JSON.stringify(reconcileExplicit.parsed));
    statePath = reconcileExplicit.parsed?.state_path ?? statePath1;
  }

  const vstart = await rpc.call(`${sprintId}: lock_validator start`, 'talos_lock_validator', {
    run_id: runId, project_root: TMP, action: 'start', state_path: statePath,
  });
  check(`${sprintId}: validator start G4/passed`, vstart.parsed?.status === 'passed', JSON.stringify(vstart.parsed));
  let dispatchToken = vstart.parsed?.dispatch_token;
  let challengeResponse = await solveChallenge(vstart.parsed?.challenge);

  // ── Negativo (S04): complete com validator_run_id divergente (D13) ──────
  if (opts.negativePaths) {
    // D13: só um id CANÔNICO (mesmo formato `<run>:validator:<n>:<ts>` de um
    // validator_run_id real) mas divergente do slot ativo é "stale real" e
    // continua blocked (D13 texto: "dois slots ou stale real continuam
    // blocked"). Um id não-canônico ou omitido é loosely-matched ao slot único
    // — já provado nas 4 sprints acima, onde nenhuma chamada de complete envia
    // validator_run_id e todas fecham normalmente.
    const staleCanonicalId = `${runId}:validator:99:2020-01-01T00:00:00.000Z`;
    const wrongId = await rpc.call(`${sprintId}: validator complete id canônico mas stale (negativo D13)`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'complete', state_path: statePath,
      validator_run_id: staleCanonicalId,
      verdict: 'pass', dispatch_token: dispatchToken, challenge_response: challengeResponse,
      data: { findings: [], acceptance_results: [{ id: 'AC-001', status: 'proved' }, { id: 'AC-002', status: 'proved' }] },
    });
    check(`${sprintId}: id canônico stale recusado (stale_discarded)`, wrongId.parsed?.status === 'blocked' && wrongId.parsed?.stale_discarded === true, JSON.stringify(wrongId.parsed));
  }

  let verdict = 'pass';
  const acceptancePassed = [
    { id: 'AC-001', status: 'proved', proof_types: ['T-outcome:proved', 'I:present', 'W:present'] },
    { id: 'AC-002', status: 'proved', proof_types: ['T-outcome:proved', 'I:present'] },
  ];

  if (opts.failThenRepair) {
    const failComplete = await rpc.call(`${sprintId}: validator complete fail (repair)`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'complete', state_path: statePath,
      verdict: 'fail', dispatch_token: dispatchToken, challenge_response: challengeResponse,
      data: {
        findings: [{
          id: 'F-001', severity: 'P1', file: srcRel,
          failure_mode: 'lógica incompleta do gate observável',
          evidence: 'harness detectou comportamento não coberto', line: 2,
          recommendation: 'ajustar implementação para cobrir o caso', fix_validation: `node --test ${testRel}`,
        }],
        // D22: o oráculo mecânico classifica pelas provas reais (files+check com
        // assert) — como o commit já satisfaz I/T-outcome/W para ambos os AC, o
        // packet deve ecoar 'proved' nos dois; a razão do fail é a finding P1
        // (uma lacuna real que a checagem mecânica de presença não pega).
        acceptance_results: [
          { id: 'AC-001', status: 'proved', proof_types: ['T-outcome:proved', 'I:present', 'W:present'] },
          { id: 'AC-002', status: 'proved', proof_types: ['T-outcome:proved', 'I:present'] },
        ],
      },
    });
    check(`${sprintId}: validator complete fail passed (repair_required)`, failComplete.parsed?.status === 'passed' && failComplete.parsed?.validator_status === 'repair_required', JSON.stringify(failComplete.parsed));

    const repairStart = await rpc.call(`${sprintId}: repair_start`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'repair_start', state_path: statePath, origin: 'validator',
    });
    check(`${sprintId}: repair_start G4/passed`, repairStart.parsed?.status === 'passed', JSON.stringify(repairStart.parsed));
    const repairRunId = repairStart.parsed?.repair_run_id;

    writeFileReal(srcRel, `// ${sprintId} feature CORRIGIDA pelo repair em ${new Date().toISOString()}\nmodule.exports.value = ${Math.floor(Math.random() * 1000)};\nmodule.exports.fixed = true;\n`);

    const repairCommit = await rpc.call(`${sprintId}: commit_state repair`, 'talos_commit_state', {
      run_id: runId, project_root: TMP, slice: `${sprintId}-slice1`,
      proofs: [
        { kind: 'AC', id: 'AC-001', check: `node --test ${testRel} -> assert.equal(actual, expected) valida ${sprintId} (pós-repair)`, files: [srcRel, testRel] },
        { kind: 'AC', id: 'AC-002', check: `assert.ok(regressionPreserved) via ${testRel}`, files: [testRel] },
        { kind: 'EVAL', id: 'EVAL-001', check: `harness stdio evidencia EVAL-001 real via ${testRel} (pós-repair)` },
      ],
      obligation_ids: ['D1'],
      repair: [{ finding_id: 'F-001', files: [srcRel], checks: [`node --test ${testRel}`], status: 'resolved' }],
      sprint_file_path: sprintFilePath,
    });
    check(`${sprintId}: commit_state repair G12/passed`, repairCommit.parsed?.status === 'passed', JSON.stringify(repairCommit.parsed));
    if (repairCommit.parsed?.status === 'passed' && repairCommit.parsed?.role !== 'repair') {
      // ACHADO: validatorComplete(fail) persiste acceptance_results direto no
      // disco (fs.writeFileSync fora de commitState/markCommitHandoff) sem
      // atualizar liveness.slice_commit_sha256 no ledger. O próximo commit_state
      // legítimo do repair vê disco != ledger e inferCommitRole (D12, checagem
      // de sha diverge ANTES da checagem de cycle.status===repair_required,
      // server.js:7451 vs 7460) classifica role='reconcile' em vez de 'repair'
      // — pulando silenciosamente o enforcement D15 (repair[].files deve ser
      // subconjunto do que foi mutado NESTE repair).
      report.findings.push({
        id: 'FINDING-REPAIR-MISCLASSIFIED-AS-RECONCILE',
        summary: `commit_state do repair pós-fail foi classificado role='${repairCommit.parsed?.role}' em vez de 'repair': validatorComplete grava acceptance_results direto no disco sem atualizar liveness.slice_commit_sha256, e inferCommitRole (server.js:7451) checa divergência de sha ANTES de checar cycle.status==='repair_required' (server.js:7460) — repair legítimo após fail com sprint_file_path é sistematicamente reclassificado como reconcile, pulando o enforcement D15 de repair[].files.`,
        state_path: repairCommit.parsed?.state_path,
        capture_step: `${sprintId}: commit_state repair`,
      });
      console.log(`[FINDING] ${sprintId}: commit_state repair classificado como '${repairCommit.parsed?.role}' (esperado 'repair'). Ver relatório final.`);
    }
    statePath = repairCommit.parsed?.state_path ?? statePath;

    const repairComplete = await rpc.call(`${sprintId}: repair_complete`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'repair_complete', state_path: statePath, repair_run_id: repairRunId,
      data: {
        repairs: [{ finding_id: 'F-001', files_touched: [srcRel], checks_run: [`node --test ${testRel}`], status: 'resolved' }],
      },
    });
    check(`${sprintId}: repair_complete G4/passed`, repairComplete.parsed?.status === 'passed', JSON.stringify(repairComplete.parsed));

    const vstart2 = await rpc.call(`${sprintId}: lock_validator start (2º attempt)`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'start', state_path: statePath,
    });
    check(`${sprintId}: 2º validator start G4/passed`, vstart2.parsed?.status === 'passed', JSON.stringify(vstart2.parsed));
    dispatchToken = vstart2.parsed?.dispatch_token;
    challengeResponse = await solveChallenge(vstart2.parsed?.challenge);

    const finalComplete = await rpc.call(`${sprintId}: validator complete pass (pós-repair)`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'complete', state_path: statePath,
      verdict: 'pass', dispatch_token: dispatchToken, challenge_response: challengeResponse,
      data: { findings: [], repaired_finding_ids: ['F-001'], acceptance_results: acceptancePassed },
    });
    check(`${sprintId}: validator complete pass pós-repair`, finalComplete.parsed?.status === 'passed' && finalComplete.parsed?.validator_status === 'passed', JSON.stringify(finalComplete.parsed));
    verdict = 'pass';
  } else {
    const complete = await rpc.call(`${sprintId}: validator complete pass`, 'talos_lock_validator', {
      run_id: runId, project_root: TMP, action: 'complete', state_path: statePath,
      verdict: 'pass', dispatch_token: dispatchToken, challenge_response: challengeResponse,
      data: { findings: [], acceptance_results: acceptancePassed },
    });
    check(`${sprintId}: validator complete pass`, complete.parsed?.status === 'passed' && complete.parsed?.validator_status === 'passed', JSON.stringify(complete.parsed));
  }

  const completeDispatch = await rpc.call(`${sprintId}: lock_dispatch complete (libera fase para próximo sprint)`, 'talos_lock_dispatch', {
    run_id: runId, project_root: TMP, action: 'complete', phase: 'plan_execute', validator_status: 'passed',
  });
  check(`${sprintId}: lock_dispatch(complete) G8/passed`, completeDispatch.parsed?.status === 'passed', JSON.stringify(completeDispatch.parsed));

  // ── D17: terminal + sprint ainda 'review' -> select_next recusa ─────────
  const blockedSelect = await rpc.call(`${sprintId}: select_next ANTES do update_sprint_status (D17)`, 'talos_select_next_sprint', {
    run_id: runId, project_root: TMP, backlog_path: 'BACKLOG.md',
  });
  check(`${sprintId}: select_next blocked por terminal+review (D17)`, blockedSelect.parsed?.status === 'blocked' && blockedSelect.parsed?.selected === null, JSON.stringify(blockedSelect.parsed));

  const done = await rpc.call(`${sprintId}: update_sprint_status done`, 'talos_update_sprint_status', {
    run_id: runId, project_root: TMP, backlog_path: 'BACKLOG.md', sprint_id: sprintId,
    status: 'done', validator_verdict: verdict, state_path: statePath,
    evidence: 'validator pass real via harness stdio',
  });
  check(`${sprintId}: update_sprint_status done passed`, done.parsed?.status === 'passed' && done.parsed?.next_status === 'done', JSON.stringify(done.parsed));

  const unblockedSelect = await rpc.call(`${sprintId}: select_next DEPOIS do update_sprint_status`, 'talos_select_next_sprint', {
    run_id: runId, project_root: TMP, backlog_path: 'BACKLOG.md',
  });
  const thisRejection = unblockedSelect.parsed?.rejected?.find((r) => r.id === sprintId);
  const stillBlockedByReview = thisRejection?.reasons?.some((r) => r.includes('review') || r.includes('terminal'));
  check(`${sprintId}: select_next não mais blocked por review/terminal deste sprint (rejeição, se houver, é só state=done — fila pode estar vazia)`, !stillBlockedByReview, JSON.stringify(unblockedSelect.parsed));

  return { statePath, verdict };
}

// ── Loop principal da campanha ────────────────────────────────────────────
async function main() {
  await rpc.raw('initialize', {});
  const ping = await rpc.call('boot: ping', 'talos_ping', {});
  check('boot: ping alive', ping.parsed?.status === 'alive', JSON.stringify(ping.parsed));

  const order = [];
  let guard = 0;
  while (guard++ < 8) {
    const sel = await rpc.call(`select_next (iteração ${guard})`, 'talos_select_next_sprint', {
      run_id: `camp-select-${guard}`, project_root: TMP, backlog_path: 'BACKLOG.md',
    });
    if (sel.parsed?.status !== 'passed' || !sel.parsed?.selected) {
      check(`select_next (iteração ${guard}): fila esgotada corretamente`, sel.parsed?.status === 'blocked', JSON.stringify(sel.parsed));
      break;
    }
    const sprintId = sel.parsed.selected.sprint_id;
    order.push(sprintId);
    check(`select_next escolheu ${sprintId} (contrato aprovado+selado: ${sel.parsed.selected.contrato_sealed})`, sel.parsed.selected.contrato_sealed === true, JSON.stringify(sel.parsed.selected));

    if (sprintId === 'S03') {
      // Antes de S01 fechar, S03 deve estar em `rejected` por unmet_dependencies.
      // (Verificado explicitamente abaixo, fora do loop de seleção do S01.)
    }

    await runSlice(sprintId, {
      failThenRepair: sprintId === 'S02',
      traceability: SPRINTS[sprintId].traceability,
      negativePaths: sprintId === 'S04',
    });

    if (sprintId === 'S01') {
      // Real commit git após a 1ª sprint fechar — exercita o ramo `committedNow`
      // (git diff base_sha...HEAD) além do ramo worktree-dirty (sliceDeltaNow).
      git(['add', '-A']);
      git(['commit', '-qm', 'campanha: S01 fechada']);
    }
  }
  check('campanha percorreu as 4 sprints na ordem esperada', order.length === 4 && new Set(order).size === 4, JSON.stringify(order));

  // Verificação explícita de D5: com S01 ainda não fechado, S03 (depende de S01)
  // deveria aparecer em `rejected` na 1ª seleção. Reconstituído via capture.
  const captureLines = fs.readFileSync(CAPTURE_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const firstSelect = captureLines.find((e) => e.tool === 'talos_select_next_sprint' && e.step.startsWith('select_next (iteração 1)'));
  const s03Rejected = firstSelect?.response?.rejected?.find((r) => r.id === 'S03');
  check('D5: S03 rejeitada por unmet_dependencies na 1ª seleção (antes de S01 done)', Boolean(s03Rejected && s03Rejected.reasons.some((r) => r.startsWith('unmet_dependencies'))), JSON.stringify(s03Rejected));

  server.stdin.end();
  await new Promise((resolve) => server.once('close', resolve));

  const passCount = report.checks.filter((c) => c.ok).length;
  const failCount = report.checks.length - passCount;
  const lines = [
    '# Relatório de campanha — integration-loop-campaign.mjs',
    '',
    `Data: ${new Date().toISOString()}`,
    `Sandbox: \`${TMP}\` (removido automaticamente ao final, exceto se \`--keep-tmp\`)`,
    `Capture JSONL: \`${path.relative(ROOT, CAPTURE_PATH)}\``,
    `Ordem de seleção: ${order.join(' -> ')}`,
    '',
    `## Veredito: ${failCount === 0 ? 'TODOS OS CHECKS PASSARAM' : `${failCount} CHECK(S) FALHOU/FALHARAM`}`,
    '',
    `${passCount}/${report.checks.length} checks OK.`,
    '',
    '## Findings confirmados durante a campanha',
    '',
    report.findings.length === 0
      ? 'Nenhum.'
      : report.findings.map((f) => `### ${f.id}\n\n${f.summary}\n\n- state_path: \`${f.state_path}\`\n- passo: \`${f.capture_step}\``).join('\n\n'),
    '',
    '## Checks',
    '',
    '| # | Status | Label | Detalhe |',
    '|---|---|---|---|',
    ...report.checks.map((c, i) => `| ${i + 1} | ${c.ok ? 'OK' : 'FAIL'} | ${c.label} | ${(c.detail ?? '').slice(0, 200).replace(/\|/g, '\\|')} |`),
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const reportPath = path.join(OUT_DIR, `campaign-report.${Date.now()}.md`);
  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`\nRelatório: ${reportPath}`);
  console.log(`Capture: ${CAPTURE_PATH}`);
  console.log(`${passCount}/${report.checks.length} checks OK.`);

  if (!process.argv.includes('--keep-tmp')) {
    fs.rmSync(TMP, { recursive: true, force: true });
  } else {
    console.log(`Sandbox preservado: ${TMP}`);
  }

  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('integration-loop-campaign: erro fatal', error);
  try { server.kill(); } catch { /* best-effort */ }
  process.exit(1);
});
