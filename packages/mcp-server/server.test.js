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
  lockValidator,
  assertAfterPlan,
  runState,
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

test('capabilities: schema_version atual e campos do contrato v3', () => {
  const cap = capabilities({ host: 'claude' });
  assert.equal(cap.schema_version, CAPABILITIES_SCHEMA_VERSION);
  assert.equal(cap.schema_version, 3);
  assert.ok(cap.capabilities_flags);
  assert.ok(cap.validator_dispatch);
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
  assert.equal(cap.validator_dispatch.topology, 'nested');
  assert.equal(cap.validator_dispatch.dispatcher, 'executor');
});

test('capabilities: perfil codex usa subagent nativo, não $skill in-context', () => {
  const cap = capabilities({ host: 'codex' });
  assert.equal(cap.host, 'codex');
  assert.equal(cap.subagent_dispatch.mechanism, 'spawn_agent(agent_type)');
  assert.match(cap.subagent_dispatch.registration, /\.codex\/agents/);
  assert.doesNotMatch(cap.subagent_dispatch.example, /\$atlas/);
  assert.equal(cap.capabilities_flags.subagent_available, true);
  assert.equal(cap.validator_dispatch.topology, 'sibling');
  assert.equal(cap.validator_dispatch.nested_subagent_available, false);
  assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator');
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
  assert.ok(!WORKFLOW_CONFIG.modes.includes('plan'));
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

test('classifyArtifactContent: plano renomeado (sem prefixo PLAN_) classifica como plan via verdade forte (T03, PRD §5)', () => {
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
  const prd = '# PRD: algo\n\n## 3. Decisões de produto\n\n| ID | Decisão |\n|----|---------|\n| D1 | x |';
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

test('BANNER_TEMPLATES: banco tem exatamente os 11 eventos do PRD §4 (T06)', () => {
  // 12 entradas: os 11 eventos do banco + a variante preflight ok/fail conta como
  // dois templates (preflight_ok/preflight_fail) e prd como dois (prd_ok/prd_lacunas).
  // O PRD §4 enumera 11 EVENTOS lógicos; o banco materializa cada variante de status.
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
  '## 3. Decisões de produto',
  '',
  '| ID | Decisão |',
  '|----|---------|',
  '| D1 | fechada |',
  '',
  '## 6. Critérios de aceite',
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

test('atlas_classify_input: idea (texto livre, não arquivo) → not_a_file/direct, sem BLOCK (A6)', () => {
  const root = tmpRoot();
  const r = classifyInput({
    run_id: 'r1',
    project_root: root,
    input_path: 'criar .atlas-smoke/SMOKE_PROOF.md — smoke test G9',
  });
  assert.equal(r.status, 'not_a_file');
  assert.equal(r.artifact_type, 'idea');
  assert.equal(r.routed_mode, 'direct');
  assert.equal(r.banner, '▸ atlas: roteamento · input=idea → modo=direct');
  assert.doesNotMatch(r.banner, /BLOCK/);
});

test('atlas_classify_input: path com cara de arquivo mas ausente → BLOCK (erro real, não idea) (A6)', () => {
  const root = tmpRoot();
  const r = classifyInput({ run_id: 'r1', project_root: root, input_path: 'PLAN_inexistente.md' });
  assert.equal(r.status, 'blocked');
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

test('atlas_lock_dispatch: plan_execute aceita passed_with_observations como terminal aprovado', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rld-passobs', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'rld-passobs', project_root: root, action: 'start', phase: 'plan_execute' });
  const r = lockDispatch({
    run_id: 'rld-passobs',
    project_root: root,
    action: 'complete',
    phase: 'plan_execute',
    validator_status: 'passed_with_observations',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.validator_status, 'passed_with_observations');
});

test('atlas_lock_validator: codex sibling bloqueia validator concorrente e exige repair antes do retry', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rv1', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'rv1', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv1/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.validator_attempt, 1);
  assert.match(start1.validator_run_id, /^rv1:validator:1:/);

  const concurrent = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv1/slice.json',
  });
  assert.equal(concurrent.status, 'blocked');
  assert.match(concurrent.error, /já está ativo/);

  const fail1 = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.atlas/state/rv1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  assert.equal(fail1.status, 'passed');
  assert.equal(fail1.validator_status, 'repair_required');
  assert.equal(fail1.next_action, 'start_findings_repair_lock');

  const repairStart = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.atlas/state/rv1/slice.json',
  });
  assert.equal(repairStart.status, 'passed');
  assert.equal(repairStart.validator_status, 'repair_running');
  assert.match(repairStart.repair_run_id, /^rv1:repair:1:/);

  const repairConcurrent = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.atlas/state/rv1/slice.json',
  });
  assert.equal(repairConcurrent.status, 'blocked');
  assert.match(repairConcurrent.error, /Repair já está ativo/);

  const retryBeforeRepair = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv1/slice-repaired.json',
  });
  assert.equal(retryBeforeRepair.status, 'blocked');
  assert.equal(retryBeforeRepair.next_action, 'complete_findings_repair');

  const repairDone = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/rv1/slice-repaired.json',
  });
  assert.equal(repairDone.status, 'passed');
  assert.equal(repairDone.validator_status, 'ready_for_retry');

  const start2 = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv1/slice-repaired.json',
  });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.validator_attempt, 2);
});

test('atlas_lock_validator: terceiro validator é impossível e segundo fail bloqueia a slice', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rv2', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'rv2', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv2/slice.json',
  });
  lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.atlas/state/rv2/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  const repairStart = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.atlas/state/rv2/slice.json',
  });
  assert.equal(repairStart.status, 'passed');
  const repair1 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: 'rv2:repair:1:fake',
    state_path: '.atlas/state/rv2/slice-repaired.json',
  });
  assert.equal(repair1.status, 'blocked');
  assert.match(repair1.error, /repair_run_id não corresponde/);

  const repairConcurrent = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.atlas/state/rv2/slice.json',
  });
  assert.equal(repairConcurrent.status, 'blocked');
  assert.match(repairConcurrent.error, /Repair já está ativo/);

  const repair1Done = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/rv2/slice-repaired.json',
  });
  assert.equal(repair1Done.status, 'passed');

  const start2 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv2/slice-repaired.json',
  });
  assert.equal(start2.status, 'passed');

  const fail2 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.atlas/state/rv2/slice-repaired.json',
    validator_run_id: start2.validator_run_id,
    verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'y.ts', line: 2, msg: 'still bad' }] },
  });
  assert.equal(fail2.status, 'blocked');
  assert.equal(fail2.validator_status, 'blocked_final_validator_failed');

  const third = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv2/slice-third.json',
  });
  assert.equal(third.status, 'blocked');
  assert.match(third.error, /Terceiro validator proibido/);
});

test('atlas_lock_validator: retorno stale do validator não fecha slot ativo', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rv4', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'rv4', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'rv4',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv4/slice.json',
  });

  const stale = lockValidator({
    run_id: 'rv4',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.atlas/state/rv4/slice.json',
    validator_run_id: 'rv4:validator:1:stale',
    verdict: 'pass',
  });
  assert.equal(stale.status, 'blocked');
  assert.match(stale.error, /validator_run_id não corresponde/);

  const good = lockValidator({
    run_id: 'rv4',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.atlas/state/rv4/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(good.status, 'passed');
  assert.equal(good.validator_status, 'passed');
});

test('atlas_lock_validator: hosts nested não usam o gate sibling', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rv3', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'rv3', project_root: root, action: 'start', phase: 'plan_execute' });
  const r = lockValidator({
    run_id: 'rv3',
    project_root: root,
    host: 'claude',
    action: 'start',
    state_path: '.atlas/state/rv3/slice.json',
  });
  assert.equal(r.status, 'blocked');
  assert.match(r.error, /topologia sibling/);
});

// --- S04: token de dispatch monotônico explícito no validator_cycle ---

function readRunJson(root, runId) {
  const file = path.join(root, '.atlas', 'state', runId, 'run.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('S04: dispatch_token incrementa monotonicamente a cada validatorStart aceito', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'tok1', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'tok1', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/tok1/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.dispatch_token, 1);
  let cycle = readRunJson(root, 'tok1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, 1);
  assert.equal(cycle.active.dispatch_token, 1);

  // fail → repair → retry → segundo start incrementa o token (1 → 2).
  lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/tok1/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  // token sobrevive ao complete (preservado pelo merge), slot fechado.
  cycle = readRunJson(root, 'tok1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, 1);
  assert.equal(cycle.active, null);

  const repairStart = lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/tok1/slice.json',
  });
  lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/tok1/slice-repaired.json',
  });

  const start2 = lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/tok1/slice-repaired.json',
  });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.dispatch_token, 2);
  cycle = readRunJson(root, 'tok1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, 2);
  assert.equal(cycle.active.dispatch_token, 2);
});

test('S04: dispatch_token sobrevive a re-spun (releitura do estado em disco)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'tok2', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'tok2', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'tok2', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/tok2/slice.json',
  });
  assert.equal(start1.dispatch_token, 1);

  // Re-spun: lê o run.json do disco como faria a próxima chamada após reinício.
  const reread = readRunJson(root, 'tok2').data.validator_cycle;
  assert.equal(reread.dispatch_token, 1);
  assert.equal(reread.active.dispatch_token, 1);
  assert.equal(reread.status, 'running');

  // complete com o token preservado de disco fecha normalmente.
  const done = lockValidator({
    run_id: 'tok2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/tok2/slice.json',
    validator_run_id: start1.validator_run_id,
    dispatch_token: reread.active.dispatch_token,
    verdict: 'pass',
  });
  assert.equal(done.status, 'passed');
});

test('S04: validatorComplete com token divergente → blocked, slot não fecha', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'tok3', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'tok3', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'tok3', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/tok3/slice.json',
  });
  assert.equal(start1.dispatch_token, 1);

  const stale = lockValidator({
    run_id: 'tok3', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/tok3/slice.json',
    validator_run_id: start1.validator_run_id,
    dispatch_token: 99,
    verdict: 'pass',
  });
  assert.equal(stale.status, 'blocked');
  assert.match(stale.error, /token de dispatch divergente: esperado 1, recebido 99/);

  // Slot permanece ativo após divergência.
  const cycle = readRunJson(root, 'tok3').data.validator_cycle;
  assert.notEqual(cycle.active, null);
  assert.equal(cycle.active.dispatch_token, 1);
  assert.equal(cycle.status, 'running');

  // complete com token correto fecha normalmente (slot não foi corrompido).
  const good = lockValidator({
    run_id: 'tok3', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/tok3/slice.json',
    validator_run_id: start1.validator_run_id,
    dispatch_token: 1,
    verdict: 'pass',
  });
  assert.equal(good.status, 'passed');
  assert.equal(good.validator_status, 'passed');
});

test('S04: validatorComplete sem dispatch_token mantém compat (caminho Codex por run_id)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'tok4', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'tok4', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'tok4', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/tok4/slice.json',
  });

  // Sem dispatch_token no payload: a checagem por run_id continua valendo.
  const good = lockValidator({
    run_id: 'tok4', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/tok4/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(good.status, 'passed');
  assert.equal(good.validator_status, 'passed');
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

// ── P3: testes de segurança e robustez do dispatch_token (S04 slice-review) ───

// P3(a): redação — chave genérica `token` é redatada; `dispatch_token` sobrevive.
test('P3(a): redact() redigita token/access_token/password mas preserva dispatch_token', () => {
  const root = tmpRoot();
  // Upsert de estado com payload sensível misturado a dispatch_token legítimo.
  runState({
    action: 'upsert',
    run_id: 'redact1',
    project_root: root,
    phase: 'plan_execute',
    status: 'running',
    summary: 'teste de redação P3(a)',
    data: {
      auth: {
        token: 'Bearer sk-SEGREDO',
        access_token: 'ghp_SECRETO',
        password: 'hunter2',
      },
      dispatch_token: 5,
    },
  });

  const persisted = readRunJson(root, 'redact1');

  // Campos sensíveis devem ter sido redatados.
  assert.equal(persisted.data.auth.token, '[REDACTED]');
  assert.equal(persisted.data.auth.access_token, '[REDACTED]');
  assert.equal(persisted.data.auth.password, '[REDACTED]');

  // dispatch_token (allowlist exata) deve sobreviver intacto.
  assert.equal(persisted.data.dispatch_token, 5);
});

// P3(b): monotonicidade travada — dispatch_token nunca reseta entre ciclos.
test('P3(b): dispatch_token do 2º validatorStart > 1º após start→fail→repair→start', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'mono1', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'mono1', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/mono1/slice.json',
  });
  const token1 = readRunJson(root, 'mono1').data.validator_cycle.dispatch_token;

  lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/mono1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'a.ts', line: 1, msg: 'x' }] },
  });

  // dispatch_token persiste após complete (não reseta).
  const tokenAfterFail = readRunJson(root, 'mono1').data.validator_cycle.dispatch_token;
  assert.equal(tokenAfterFail, token1);

  const repairStart = lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/mono1/slice.json',
  });
  lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/mono1/slice-repaired.json',
  });

  const start2 = lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/mono1/slice-repaired.json',
  });
  const token2 = readRunJson(root, 'mono1').data.validator_cycle.dispatch_token;

  // Monotonicidade: token do 2º start é estritamente maior que o do 1º.
  assert.ok(token2 > token1, `esperado token2 (${token2}) > token1 (${token1})`);
  assert.equal(start2.dispatch_token, token2);
});

// P3(c): estado legado pré-S04 (sem dispatch_token no run.json) entra em
// validatorComplete — comportamento determinístico, sem mascarar divergência.
// Resultado esperado: como cycle.dispatch_token normaliza para 0 e active.dispatch_token
// também normaliza para 0, uma chamada com dispatch_token=1 (valor do caller)
// detecta divergência (0 !== 1) e retorna blocked. Ausência de dispatch_token
// no payload segue o caminho legado por run_id (passes se run_id bate).
test('P3(c): estado legado pré-S04 sem dispatch_token — comportamento determinístico documentado', () => {
  const root = tmpRoot();
  // Simular estado legado: preflight + lockDispatch + validatorStart (gera active),
  // depois apagar dispatch_token manualmente do run.json para imitar estado pré-S04.
  preflight({
    run_id: 'legacy1', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'legacy1', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 'legacy1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/legacy1/slice.json',
  });

  // Reescrever o run.json removendo dispatch_token do ciclo e do active
  // para simular estado gerado por versão pré-S04.
  const runFile = path.join(root, '.atlas', 'state', 'legacy1', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  delete raw.data.validator_cycle.dispatch_token;
  delete raw.data.validator_cycle.active.dispatch_token;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  // Caso 1: caller envia dispatch_token=1 → normalizeValidatorCycle normaliza
  // o dispatch_token ausente como 0; active.dispatch_token ausente também normaliza
  // como 0. Divergência 0 !== 1 → blocked (sem mascarar, determinístico).
  const withToken = lockValidator({
    run_id: 'legacy1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/legacy1/slice.json',
    validator_run_id: start1.validator_run_id,
    dispatch_token: 1,
    verdict: 'pass',
  });
  // dispatch_token ausente no estado legado normaliza para 0; caller envia 1 → divergência.
  assert.equal(withToken.status, 'blocked');
  assert.match(withToken.error, /token de dispatch divergente/);

  // Caso 2: caller não envia dispatch_token → caminho legado por run_id,
  // fecha normalmente sem verificar token.
  const withoutToken = lockValidator({
    run_id: 'legacy1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/legacy1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(withoutToken.status, 'passed');
  assert.equal(withoutToken.validator_status, 'passed');
});
