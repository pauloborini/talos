// Testes de unidade do núcleo portável do MCP (S04 / F2-A6).
// Cobre: detecção de host (registry data-driven + precedência), contrato
// atlas_capabilities (schema_version, flags, known_hosts) e hard-fail de
// pré-requisitos (DEC-004). Rodar: node --test packages/mcp-server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HOST_NAMES,
  PREREQUISITES,
  CAPABILITIES_SCHEMA_VERSION,
  WORKFLOW_CONFIG,
  GUARANTEE_LEVELS,
  detectHost,
  capabilities,
  checkPrerequisites,
  expectedNextPhase,
  guaranteeLevelForMode,
  classifyArtifactContent,
  BANNER_TEMPLATES,
  BANNER_EVENTS,
  renderBanner,
  verifyArtifact,
  scanPrd,
  verifyTemplateConformance,
  classifyInput,
  preflight,
  lockDispatch,
  assertAfterPlan,
} from './server.js';

test('detectHost: arg host explícito tem prioridade máxima', () => {
  const r = detectHost({ host: 'codex' }, { CLAUDE_PLUGIN_ROOT: '/x' });
  assert.equal(r.host, 'codex');
  assert.equal(r.detected_via, 'arg');
});

test('detectHost: ATLAS_HOST sobrepõe sinais de env nativos', () => {
  const r = detectHost({}, { ATLAS_HOST: 'codex', CLAUDE_PLUGIN_ROOT: '/x' });
  assert.equal(r.host, 'codex');
  assert.equal(r.detected_via, 'env:ATLAS_HOST');
});

test('detectHost: env nativo Claude/Codex via registry', () => {
  assert.equal(detectHost({}, { CLAUDE_PLUGIN_ROOT: '/x' }).host, 'claude');
  assert.equal(detectHost({}, { CODEX_HOME: '/y' }).host, 'codex');
  assert.equal(detectHost({}, { CODEX_PLUGIN_ROOT: '/y' }).host, 'codex');
});

test('detectHost: sem sinal cai em generic', () => {
  const r = detectHost({}, {});
  assert.equal(r.host, 'generic');
  assert.equal(r.detected_via, 'default');
});

test('detectHost: host inválido em arg/env é ignorado (cai em generic)', () => {
  assert.equal(detectHost({ host: 'inexistente' }, {}).host, 'generic');
  assert.equal(detectHost({}, { ATLAS_HOST: 'inexistente' }).host, 'generic');
});

test('capabilities: schema_version atual e campos do contrato v2', () => {
  const cap = capabilities({ host: 'claude' });
  assert.equal(cap.schema_version, CAPABILITIES_SCHEMA_VERSION);
  assert.equal(cap.schema_version, 2);
  assert.ok(cap.capabilities_flags);
  assert.ok(cap.hooks);
  assert.deepEqual(cap.prerequisites, PREREQUISITES);
  assert.deepEqual(cap.known_hosts, HOST_NAMES);
});

test('detectHost: opencode via ATLAS_HOST injetado pelo packaging', () => {
  const r = detectHost({}, { ATLAS_HOST: 'opencode' });
  assert.equal(r.host, 'opencode');
  assert.equal(r.detected_via, 'env:ATLAS_HOST');
});

test('capabilities: perfil opencode (subagente @, mcp local, todo nativo todowrite)', () => {
  const cap = capabilities({ host: 'opencode' });
  assert.equal(cap.host, 'opencode');
  assert.equal(cap.capabilities_flags.subagent_available, true);
  assert.equal(cap.capabilities_flags.mcp_available, true);
  assert.equal(cap.capabilities_flags.todo_available, true);
  assert.equal(cap.todo_tool, 'todowrite');
  assert.match(cap.subagent_dispatch.registration, /\.opencode\/agents/);
});

test('checkPrerequisites: opencode qualificado passa', () => {
  assert.equal(checkPrerequisites({ host: 'opencode' }).status, 'passed');
});

test('HOST_NAMES inclui opencode', () => {
  assert.ok(HOST_NAMES.includes('opencode'));
});

test('detectHost: pi via ATLAS_HOST injetado pela config do pi-mcp-adapter', () => {
  const r = detectHost({}, { ATLAS_HOST: 'pi' });
  assert.equal(r.host, 'pi');
});

test('capabilities: perfil pi expõe required_deps obrigatórias (DEC-005)', () => {
  const cap = capabilities({ host: 'pi' });
  assert.equal(cap.host, 'pi');
  assert.deepEqual(cap.required_deps, ['pi-mcp-adapter', 'pi-subagents']);
  assert.equal(cap.capabilities_flags.todo_available, false);
});

test('capabilities: hosts sem deps externas têm required_deps vazio', () => {
  for (const h of ['claude', 'codex', 'opencode', 'generic']) {
    assert.deepEqual(capabilities({ host: h }).required_deps, []);
  }
});

test('checkPrerequisites: pi sem pi-subagents é hard-fail com next_action pi', () => {
  const r = checkPrerequisites({ host: 'pi', host_capabilities: { subagent_available: false } });
  assert.equal(r.status, 'blocked');
  assert.match(r.next_action, /pi-mcp-adapter/);
});

test('HOST_NAMES inclui pi', () => {
  assert.ok(HOST_NAMES.includes('pi'));
});

test('capabilities: flags por host', () => {
  for (const h of ['claude', 'codex']) {
    const f = capabilities({ host: h }).capabilities_flags;
    assert.equal(f.subagent_available, true);
    assert.equal(f.mcp_available, true);
    assert.equal(f.todo_available, true);
  }
  const g = capabilities({ host: 'generic' }).capabilities_flags;
  assert.equal(g.subagent_available, true);
  assert.equal(g.mcp_available, true);
  assert.equal(g.todo_available, false);
});

test('checkPrerequisites: host qualificado passa', () => {
  const r = checkPrerequisites({ host: 'claude' });
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.missing, []);
});

test('checkPrerequisites: subagente ausente é hard-fail', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: false, mcp_available: true } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available']);
});

test('checkPrerequisites: MCP ausente é hard-fail', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { mcp_available: false } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['mcp_available']);
});

test('checkPrerequisites: todo ausente NÃO bloqueia (não-essencial)', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { todo_available: false } });
  assert.equal(r.status, 'passed');
});

test('checkPrerequisites: override não-booleano é ignorado', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { subagent_available: 'nope' } });
  assert.equal(r.status, 'passed');
});

test('generic: EXIGE subagente+MCP — host MCP-only (sem subagente) é hard-fail (DEC-004)', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: false, mcp_available: true } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available']);
});

test('generic: host sem MCP é hard-fail', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: true, mcp_available: false } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['mcp_available']);
});

test('generic: host com subagente+MCP reportados passa (todo ausente não bloqueia)', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: true, mcp_available: true } });
  assert.equal(r.status, 'passed');
});

// Fail-closed (must_report): generic/pi sem report afirmativo são bloqueados — a
// garantia de determinismo vira contrato, não otimismo do perfil.
test('generic: sem host_capabilities é hard-fail (fail-closed)', () => {
  const r = checkPrerequisites({ host: 'generic' });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available', 'mcp_available']);
  assert.equal(r.cause, 'host_nao_reportou_disponibilidade');
});

test('pi: sem host_capabilities é hard-fail (fail-closed)', () => {
  const r = checkPrerequisites({ host: 'pi' });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available', 'mcp_available']);
  assert.equal(r.cause, 'host_nao_reportou_disponibilidade');
  assert.match(r.next_action, /pi-mcp-adapter/);
});

test('pi: qualificado com report afirmativo passa', () => {
  const r = checkPrerequisites({ host: 'pi', host_capabilities: { subagent_available: true, mcp_available: true } });
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.missing, []);
});

test('override: chave desconhecida não vaza para effective_flags', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { foo: true } });
  assert.equal(r.status, 'passed');
  assert.equal(r.effective_flags.foo, undefined);
});

test('capabilities: prereq_policy must_report em pi/generic, self_evident nos nativos', () => {
  assert.equal(capabilities({ host: 'pi' }).prereq_policy, 'must_report');
  assert.equal(capabilities({ host: 'generic' }).prereq_policy, 'must_report');
  for (const h of ['claude', 'codex', 'opencode']) {
    assert.equal(capabilities({ host: h }).prereq_policy, 'self_evident');
  }
});

test('PREREQUISITES: subagente e mcp são essenciais; todo não', () => {
  assert.ok(PREREQUISITES.essential.includes('subagent_available'));
  assert.ok(PREREQUISITES.essential.includes('mcp_available'));
  assert.ok(PREREQUISITES.non_essential.includes('todo_available'));
  assert.ok(!PREREQUISITES.essential.includes('todo_available'));
});

// ── Slice A: modo execute, classify_input, routing, guarantee_level ──────────

test('WORKFLOW_CONFIG: modo execute presente; interview-only/interview_only mantidos (T01)', () => {
  assert.ok(WORKFLOW_CONFIG.modes.includes('execute'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('full'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('direct'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('interview-only'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('interview_only'));
});

test('expectedNextPhase: execute → plan_execute sem regredir full/direct/interview (T02)', () => {
  assert.equal(expectedNextPhase({ mode: 'execute' }, {}), 'plan_execute');
  assert.equal(expectedNextPhase({ mode: 'full' }, {}), 'plan_handoff');
  assert.equal(expectedNextPhase({ mode: 'direct' }, {}), 'plan_execute');
  assert.equal(expectedNextPhase({ mode: 'interview-only' }, {}), 'prd_interview');
  // next_phase explícito do dispatch sempre prevalece
  assert.equal(expectedNextPhase({ mode: 'execute' }, { next_phase: 'slice_review' }), 'slice_review');
});

test('guaranteeLevelForMode: execute/full/direct = full_pipeline (T04)', () => {
  assert.equal(guaranteeLevelForMode('execute'), 'full_pipeline');
  assert.equal(guaranteeLevelForMode('full'), 'full_pipeline');
  assert.equal(guaranteeLevelForMode('direct'), 'full_pipeline');
  assert.ok(GUARANTEE_LEVELS.includes('full_pipeline'));
  assert.ok(GUARANTEE_LEVELS.includes('reduced_standalone'));
  assert.equal(GUARANTEE_LEVELS.length, 2);
});

test('guaranteeLevelForMode: modos sem execução (interview) → null (campo omitido)', () => {
  assert.equal(guaranteeLevelForMode('interview-only'), null);
  assert.equal(guaranteeLevelForMode('interview_only'), null);
  assert.equal(guaranteeLevelForMode('desconhecido'), null);
});

// Fixture de plano conforme o template canônico (verifyPlanConformance → 0 pendências).
const CONFORMANT_PLAN = [
  '# Documento qualquer',
  '',
  '| Campo | Valor |',
  '|-------|-------|',
  '| **PRD** | [PRD_x.md](./PRD_x.md) |',
  '',
  'Política: [BOUNDARY_PRD_PLAN.md](./TEMPLATES/BOUNDARY_PRD_PLAN.md).',
  '',
  '## 1. Tradução executiva',
  '## 2. Invariantes de execução',
  '## 3. Pitfalls',
  '## 4. Estado na abertura da sprint',
  '## 5. Tarefas de execução',
  '#### T01. Primeira tarefa',
  '## 6. Contratos técnicos',
  '## 7. Slices',
  '## 8. Validação e checklist',
  '',
].join('\n');

test('classifyArtifactContent: plano renomeado (sem prefixo PLAN_) classifica como plan via verdade forte (T03, PRD §10)', () => {
  const r = classifyArtifactContent(CONFORMANT_PLAN, 'docs/algo_renomeado.md');
  assert.equal(r.artifact_type, 'plan');
  assert.equal(r.signal, 'template_conformance');
});

test('classifyArtifactContent: nome PLAN_*.md é só dica fraca, não verdade (T03)', () => {
  const r = classifyArtifactContent('# Nada relevante aqui\n\nconteúdo solto', 'PLAN_vazio.md');
  assert.equal(r.artifact_type, 'plan');
  assert.equal(r.signal, 'weak_name_hint');
});

test('classifyArtifactContent: PRD por marcadores de template (T03)', () => {
  const prd = '# PRD: algo\n\n## 5. Decisões de produto\n\n| ID | Decisão |\n|----|---------|\n| D1 | x |';
  const r = classifyArtifactContent(prd, 'docs/PRD_algo.md');
  assert.equal(r.artifact_type, 'prd');
});

test('classifyArtifactContent: backlog por marcadores (T03)', () => {
  const r = classifyArtifactContent('# BACKLOG_MESTRE\n\nSprint S01: ...', 'docs/BACKLOG.md');
  assert.equal(r.artifact_type, 'backlog');
});

test('classifyArtifactContent: input sem marcadores → unknown (T03)', () => {
  const r = classifyArtifactContent('texto solto qualquer sem estrutura', 'notas.md');
  assert.equal(r.artifact_type, 'unknown');
});

// ── Slice B: banco de templates de banner + campo banner nos gates ───────────

const BANNER_RE = /^▸ atlas: /;

test('BANNER_TEMPLATES: banco tem exatamente os 11 eventos do PRD §9 (T06)', () => {
  // 12 entradas: os 11 eventos do banco + a variante preflight ok/fail conta como
  // dois templates (preflight_ok/preflight_fail) e prd como dois (prd_ok/prd_lacunas).
  // O PRD §9 enumera 11 EVENTOS lógicos; o banco materializa cada variante de status.
  const eventos = [
    'roteia', 'roteia_troca', 'preflight_ok', 'preflight_fail',
    'prd_lacunas', 'prd_ok', 'entrevista', 'plano', 'exec',
    'validacao', 'review', 'done',
  ];
  for (const ev of eventos) {
    assert.ok(Object.prototype.hasOwnProperty.call(BANNER_TEMPLATES, ev), `falta evento ${ev}`);
    assert.match(BANNER_TEMPLATES[ev], BANNER_RE, `template ${ev} sem prefixo canônico`);
  }
  // Os 11 eventos lógicos do PRD: roteia, roteia c/ troca, preflight, prd, entrevista,
  // plano, exec, validação, review, done + preflight_ok/fail e prd_ok/lacunas como pares.
  assert.deepEqual(BANNER_EVENTS, eventos);
  assert.equal(BANNER_EVENTS.length, 12);
});

test('renderBanner: preenche slots e devolve string pt-BR canônica (T06)', () => {
  assert.equal(
    renderBanner('roteia', { tipo: 'plan', modo: 'execute' }),
    '▸ atlas: roteamento · input=plan → modo=execute',
  );
  assert.equal(
    renderBanner('roteia_troca', { x: 'direct', y: 'plan', z: 'execute' }),
    '▸ atlas: roteamento · pediu=direct mas input=plan → modo=execute',
  );
  assert.equal(renderBanner('preflight_ok', { caps: 'subagent+mcp' }), '▸ atlas: preflight · ok (subagent+mcp)');
  assert.equal(renderBanner('preflight_fail', { motivo: 'x' }), '▸ atlas: preflight · BLOCK · x');
  assert.equal(renderBanner('prd_lacunas', { n: 3 }), '▸ atlas: prd · 3 lacunas');
  assert.equal(renderBanner('prd_ok', {}), '▸ atlas: prd · ok');
  assert.equal(renderBanner('exec', { i: 2, n: 5 }), '▸ atlas: exec · slice 2/5');
  assert.equal(renderBanner('validacao', { status: 'pass' }), '▸ atlas: validação · pass');
  assert.equal(renderBanner('review', { status: 'ok' }), '▸ atlas: review · ok');
  assert.equal(renderBanner('done', { resumo: 'feito' }), '▸ atlas: done · feito');
});

test('renderBanner: evento desconhecido lança (T06)', () => {
  assert.throws(() => renderBanner('inexistente', {}), /Evento de banner desconhecido/);
});

// Fixtures e helper de isolamento por temp dir (project_root).
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sliceB-'));
  return dir;
}

const VALID_PRD = [
  '# PRD: algo',
  '',
  '| Campo | Valor |',
  '|-------|-------|',
  '| **Status** | Aprovado |',
  '',
  '## 5. Decisões de produto',
  '',
  '| ID | Decisão |',
  '|----|---------|',
  '| D1 | fechada |',
  '',
  '## 10. Critérios de aceite',
  '',
  '**Produto**',
  '- [ ] critério observável',
  '',
].join('\n');

const CONFORMANT_PLAN_DOC = [
  '# Documento qualquer',
  '',
  '| Campo | Valor |',
  '|-------|-------|',
  '| **PRD** | [PRD_x.md](./PRD_x.md) |',
  '',
  'Política: [BOUNDARY_PRD_PLAN.md](./TEMPLATES/BOUNDARY_PRD_PLAN.md).',
  '',
  '## 1. Tradução executiva',
  '## 2. Invariantes de execução',
  '## 3. Pitfalls',
  '## 4. Estado na abertura da sprint',
  '## 5. Tarefas de execução',
  '#### T01. Primeira tarefa',
  '## 6. Contratos técnicos',
  '## 7. Slices',
  '## 8. Validação e checklist',
  '',
].join('\n');

test('atlas_verify_artifact: gate retorna banner não-vazio (passed → plano) (T07)', () => {
  const root = tmpRoot();
  const file = path.join(root, 'PLAN_x.md');
  fs.writeFileSync(file, CONFORMANT_PLAN_DOC);
  const r = verifyArtifact({ run_id: 'r1', project_root: root, artifact_path: 'PLAN_x.md' });
  assert.equal(r.status, 'passed');
  assert.match(r.banner, BANNER_RE);
  assert.equal(r.banner, '▸ atlas: plano · validado (TC pass)');
});

test('atlas_verify_artifact: ausente → banner de BLOCK não-vazio (T07)', () => {
  const root = tmpRoot();
  const r = verifyArtifact({ run_id: 'r1', project_root: root, artifact_path: 'nao_existe.md' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ atlas: preflight · BLOCK · /);
});

test('atlas_scan_prd: 0 bloqueantes → banner prd · ok (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PRD.md'), VALID_PRD);
  const r = scanPrd({ run_id: 'r1', project_root: root, prd_path: 'PRD.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.banner, '▸ atlas: prd · ok');
});

test('atlas_scan_prd: PRD vazio → banner prd · {n} lacunas (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PRD.md'), '   ');
  const r = scanPrd({ run_id: 'r1', project_root: root, prd_path: 'PRD.md' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ atlas: prd · \d+ lacunas$/);
});

test('atlas_verify_template_conformance: plano conforme → banner plano (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PLAN_x.md'), CONFORMANT_PLAN_DOC);
  const r = verifyTemplateConformance({ run_id: 'r1', project_root: root, artifact_path: 'PLAN_x.md', artifact_type: 'plan' });
  assert.equal(r.status, 'passed');
  assert.equal(r.banner, '▸ atlas: plano · validado (TC pass)');
});

test('atlas_verify_template_conformance: plano não conforme → banner BLOCK (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'ruim.md'), '# nada\n\nconteúdo solto');
  const r = verifyTemplateConformance({ run_id: 'r1', project_root: root, artifact_path: 'ruim.md', artifact_type: 'plan' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ atlas: preflight · BLOCK · /);
});

test('atlas_classify_input: plano → banner roteia com modo=execute (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PLAN_x.md'), CONFORMANT_PLAN_DOC);
  const r = classifyInput({ run_id: 'r1', project_root: root, input_path: 'PLAN_x.md' });
  assert.equal(r.artifact_type, 'plan');
  assert.equal(r.routed_mode, 'execute');
  assert.equal(r.banner, '▸ atlas: roteamento · input=plan → modo=execute');
});

test('atlas_classify_input: unknown → banner BLOCK não-vazio (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'notas.md'), 'texto solto sem estrutura');
  const r = classifyInput({ run_id: 'r1', project_root: root, input_path: 'notas.md' });
  assert.equal(r.artifact_type, 'unknown');
  assert.match(r.banner, /^▸ atlas: preflight · BLOCK · /);
});

test('atlas_preflight: execute qualificado → banner preflight · ok (T07)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rpf', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.banner, '▸ atlas: preflight · ok (subagent+mcp)');
});

test('atlas_preflight: modo inválido → banner BLOCK não-vazio (T07)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rpf2', project_root: root, mode: 'modo_invalido',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ atlas: preflight · BLOCK · /);
});

test('atlas_lock_dispatch: start plan_execute em execute → banner exec não-vazio (T07)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rld', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  const r = lockDispatch({ run_id: 'rld', project_root: root, action: 'start', phase: 'plan_execute' });
  assert.equal(r.status, 'passed');
  assert.match(r.banner, /^▸ atlas: exec · slice \d+\/\d+$/);
});

test('atlas_assert_after_plan: execute → banner plano não-vazio (T07)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'raa', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  const r = assertAfterPlan({ run_id: 'raa', project_root: root, attempted_action: 'dispatch_plan_execute' });
  assert.equal(r.applicable, false);
  assert.equal(r.banner, '▸ atlas: plano · validado (TC pass)');
});
