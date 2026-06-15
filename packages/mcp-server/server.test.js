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
  checkJoinCapability,
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
  lockValidator as lockValidatorCore,
  assertAfterPlan,
  runState,
  ping,
  toolsList,
} from './server.js';

function lockValidator(args) {
  if (args.action === 'complete' && args.dispatch_token === undefined) {
    try {
      const state = runState({
        action: 'get',
        run_id: args.run_id,
        project_root: args.project_root,
      });
      const token = state.validator_recovery?.expected_dispatch_token;
      if (Number.isInteger(token)) args = { ...args, dispatch_token: token };
    } catch {
      // Testes de hard-fail sem slot/estado devem alcançar o runtime sem token.
    }
  }
  return lockValidatorCore(args);
}

test('ping: capabilities cobre exatamente a superfície de tools (sem drift)', () => {
  // Guard cruzado do P0: ping().capabilities é derivado de toolsList() — qualquer
  // tool nova ou removida propaga sozinha. Este teste falha se alguém reintroduzir
  // uma lista manual paralela que omita uma tool (regressão histórica:
  // atlas_classify_input ficou fora do ping e podia abortar run válida).
  const toolNames = toolsList().tools.map((tool) => tool.name).sort();
  const capList = [...ping().capabilities].sort();
  assert.deepEqual(capList, toolNames);
  assert.ok(capList.includes('atlas_classify_input'), 'atlas_classify_input deve estar nas capabilities');
});

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

test('capabilities: schema_version atual e campos do contrato v5', () => {
  const cap = capabilities({ host: 'claude' });
  assert.equal(cap.schema_version, CAPABILITIES_SCHEMA_VERSION);
  assert.equal(cap.schema_version, 5);
  assert.ok(cap.capabilities_flags);
  assert.ok(cap.validator_dispatch);
  assert.ok(cap.hooks);
  assert.deepEqual(cap.prerequisites, PREREQUISITES);
  assert.deepEqual(cap.known_hosts, HOST_NAMES);
});

test('capabilities: validator_dispatch de todos os hosts expõe exatamente { dispatcher, join } (sibling-only, sem campos de topologia legada)', () => {
  for (const host of HOST_NAMES) {
    const cap = capabilities({ host });
    // Guard de forma: o contrato sibling-only tem APENAS estas duas chaves.
    // Provar o conjunto exato garante que quaisquer campos de topologia legada
    // (dispatcher por executor, flags de subagente-do-executor, loop de reparo
    // embutido) sumiram do contrato sem precisar nomeá-los.
    assert.deepEqual(
      Object.keys(cap.validator_dispatch).sort(),
      ['dispatcher', 'join'],
      `host ${host}: validator_dispatch deve ter exatamente { dispatcher, join }`,
    );
    assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator', `host ${host}`);
  }
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
  assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator');
  assert.deepEqual(Object.keys(cap.validator_dispatch).sort(), ['dispatcher', 'join']);
});

test('capabilities: perfil codex usa subagent nativo, não $skill in-context', () => {
  const cap = capabilities({ host: 'codex' });
  assert.equal(cap.host, 'codex');
  assert.equal(cap.subagent_dispatch.mechanism, 'spawn_agent(agent_type)');
  assert.match(cap.subagent_dispatch.registration, /\.codex\/agents/);
  assert.doesNotMatch(cap.subagent_dispatch.example, /\$atlas/);
  assert.equal(cap.capabilities_flags.subagent_available, true);
  assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator');
  assert.deepEqual(Object.keys(cap.validator_dispatch).sort(), ['dispatcher', 'join']);
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

// ── Gate JOIN (DEC-SIB-003, SPEC_JOIN_CAPABILITY_S03 §6) ─────────────────────

test('HOST_ADAPTERS: validator_dispatch.join declarado em todos os hosts', () => {
  for (const host of HOST_NAMES) {
    const join = capabilities({ host }).validator_dispatch.join;
    assert.ok(join, `host ${host} deve ter join`);
    assert.ok(['self_evident', 'must_report'].includes(join.sync), `host ${host} sync`);
    assert.ok(typeof join.mechanism === 'string' && join.mechanism.length > 0, `host ${host} mechanism`);
  }
});

test('capabilities: join self_evident em claude/codex/opencode, must_report em pi/generic', () => {
  assert.equal(capabilities({ host: 'codex' }).validator_dispatch.join.sync, 'self_evident');
  assert.equal(capabilities({ host: 'codex' }).validator_dispatch.join.confidence, 'confirmed');
  assert.equal(capabilities({ host: 'claude' }).validator_dispatch.join.sync, 'self_evident');
  assert.equal(capabilities({ host: 'claude' }).validator_dispatch.join.confidence, 'presumed');
  assert.equal(capabilities({ host: 'opencode' }).validator_dispatch.join.sync, 'self_evident');
  assert.equal(capabilities({ host: 'pi' }).validator_dispatch.join.sync, 'must_report');
  assert.equal(capabilities({ host: 'pi' }).validator_dispatch.join.confidence, 'reported_required');
  assert.equal(capabilities({ host: 'generic' }).validator_dispatch.join.sync, 'must_report');
});

test('checkJoinCapability: codex self_evident passa sem reportar join (confidence confirmed)', () => {
  const r = checkJoinCapability({ host: 'codex' });
  assert.equal(r.status, 'passed');
  assert.equal(r.confidence, 'confirmed');
});

test('checkJoinCapability: claude/opencode self_evident presumido passa sem report', () => {
  for (const host of ['claude', 'opencode']) {
    const r = checkJoinCapability({ host });
    assert.equal(r.status, 'passed', `host ${host}`);
    assert.equal(r.confidence, 'presumed', `host ${host}`);
  }
});

test('checkJoinCapability: pi sem join_sync_available → blocked (DEC-SIB-003)', () => {
  const r = checkJoinCapability({ host: 'pi' });
  assert.equal(r.status, 'blocked');
  assert.match(r.error, /pi.*join síncrono.*DEC-SIB-003/);
  assert.equal(r.impact, 'sem_join_sincrono_o_slot_de_validacao_vaza_em_fire_and_forget');
  assert.ok(r.next_action);
});

test('checkJoinCapability: pi com join_sync_available:true passa', () => {
  const r = checkJoinCapability({ host: 'pi', host_capabilities: { join_sync_available: true } });
  assert.equal(r.status, 'passed');
});

test('checkJoinCapability: generic sem report → blocked', () => {
  assert.equal(checkJoinCapability({ host: 'generic' }).status, 'blocked');
});

test('checkJoinCapability: join_sync_available:false (não true) → blocked (fail-closed)', () => {
  assert.equal(checkJoinCapability({ host: 'pi', host_capabilities: { join_sync_available: false } }).status, 'blocked');
});

test('checkJoinCapability: join_sync_available não polui effective_flags do prereq', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { join_sync_available: true } });
  assert.equal(r.status, 'passed');
  assert.equal(r.effective_flags.join_sync_available, undefined);
});

test('preflight: gate JOIN — pi sem join_sync_available → blocked gate JOIN', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rjoin-pi-fail', project_root: root, mode: 'execute',
    host: 'pi', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.gate, 'JOIN');
  assert.match(r.error, /join síncrono/);
});

test('preflight: gate JOIN — pi com prereq+join reportados passa', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rjoin-pi-ok', project_root: root, mode: 'execute',
    host: 'pi',
    host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: true },
  });
  assert.equal(r.status, 'passed');
});

test('preflight: gate JOIN — generic sem join → blocked; com subagent+mcp+join → passa', () => {
  const root = tmpRoot();
  const blocked = preflight({
    run_id: 'rjoin-gen-fail', project_root: root, mode: 'execute',
    host: 'generic', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.gate, 'JOIN');
  const ok = preflight({
    run_id: 'rjoin-gen-ok', project_root: root, mode: 'execute',
    host: 'generic',
    host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: true },
  });
  assert.equal(ok.status, 'passed');
});

test('preflight: ordem determinística — PREREQ precede JOIN (pi sem prereq → gate PREREQ, não JOIN)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rjoin-order', project_root: root, mode: 'execute',
    host: 'pi', host_capabilities: { subagent_available: false },
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.gate, 'PREREQ');
});

test('checkJoinCapability: join_sync_available não-booleano (string "true" ou número 1) → blocked (fail-closed)', () => {
  // Garante que a defesa server-side `=== true` rejeita valores truthy não-booleanos.
  for (const host of ['pi', 'generic']) {
    for (const nonBool of ['true', 1]) {
      const r = checkJoinCapability({ host, host_capabilities: { join_sync_available: nonBool } });
      assert.equal(r.status, 'blocked', `host=${host} join_sync_available=${JSON.stringify(nonBool)} deveria ser blocked`);
    }
  }
});

test('preflight: join_sync_available não-booleano (string "true" ou número 1) em must_report → gate JOIN blocked', () => {
  const root = tmpRoot();
  for (const host of ['pi', 'generic']) {
    for (const nonBool of ['true', 1]) {
      const r = preflight({
        run_id: `rjoin-nonbool-${host}-${nonBool}`, project_root: root, mode: 'execute',
        host,
        host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: nonBool },
      });
      assert.equal(r.status, 'blocked', `host=${host} join_sync_available=${JSON.stringify(nonBool)} deveria ser blocked`);
      assert.equal(r.gate, 'JOIN', `host=${host} gate deveria ser JOIN`);
    }
  }
});

test('preflight: self_evident — codex/claude/opencode passam sem reportar join', () => {
  const root = tmpRoot();
  for (const host of ['codex', 'claude', 'opencode']) {
    const r = preflight({
      run_id: `rjoin-self-${host}`, project_root: root, mode: 'execute',
      host, host_capabilities: { subagent_available: true, mcp_available: true },
    });
    assert.equal(r.status, 'passed', `host ${host}`);
  }
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
  assert.equal(repairStart.repair_budget, 1);
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

  const redirectedRepair = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/rv1/slice-repaired.json',
  });
  assert.equal(redirectedRepair.status, 'blocked');
  assert.equal(redirectedRepair.stale_discarded, true);
  assert.match(redirectedRepair.error, /state_path do repair ativo diverge/);

  const repairDone = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/rv1/slice.json',
  });
  assert.equal(repairDone.status, 'passed');
  assert.equal(repairDone.validator_status, 'ready_for_retry');

  const start2 = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv1/slice.json',
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
    state_path: '.atlas/state/rv2/slice.json',
  });
  assert.equal(repair1Done.status, 'passed');

  const start2 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.atlas/state/rv2/slice.json',
  });
  assert.equal(start2.status, 'passed');

  const fail2 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.atlas/state/rv2/slice.json',
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

// --- S11 (DEC-SIB-002): teto de attempts é invariante de CONTRATO MCP ---
// O teto canônico VALIDATOR_MAX_ATTEMPTS=2 não pode ser elevado por um run.json
// adulterado/corrompido. normalizeValidatorCycle clampa max_attempts ao teto.

test('S11: run.json adulterado (max_attempts=99, attempts_used=2) → 3º validator blocked', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's11a', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's11a', project_root: root, action: 'start', phase: 'plan_execute' });

  // Gera um validator_cycle real, depois adultera o run.json em disco para
  // inflar max_attempts e marcar 2 attempts já usados (estado terminal de teto).
  const start1 = lockValidator({
    run_id: 's11a', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11a/slice.json',
  });
  assert.equal(start1.status, 'passed');

  const runFile = path.join(root, '.atlas', 'state', 's11a', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.max_attempts = 99;
  raw.data.validator_cycle.attempts_used = 2;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  // Apesar de max_attempts=99 no disco, o teto efetivo é 2 → 3º proibido.
  const third = lockValidator({
    run_id: 's11a', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11a/slice-third.json',
  });
  assert.equal(third.status, 'blocked');
  assert.match(third.error, /Terceiro validator proibido/);
  // O erro reporta o teto clampado (2), não o valor adulterado (99).
  assert.match(third.error, /máximo=2/);
});

test('S11: run.json com max_attempts=99 e attempts_used=1 → start permitido, cycle reporta max_attempts=2', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's11b', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's11b', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's11b', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11b/slice.json',
  });
  assert.equal(start1.status, 'passed');

  // Adultera: max_attempts=99, attempts_used=1, slot livre (idle) → permite attempt 2.
  const runFile = path.join(root, '.atlas', 'state', 's11b', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.max_attempts = 99;
  raw.data.validator_cycle.attempts_used = 1;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  const start2 = lockValidator({
    run_id: 's11b', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11b/slice-2.json',
  });
  assert.equal(start2.status, 'passed', 'attempt 2 ainda permitido');
  assert.equal(start2.validator_attempt, 2);
  // O cycle resultante ecoa o teto clampado (2), nunca o valor adulterado (99).
  assert.equal(start2.validator_cycle.max_attempts, 2);
  assert.match(start2.banner ?? '', /running 2\/2/);
});

test('S11: max_attempts ausente/inválido no run.json → default 2', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's11c', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's11c', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's11c', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11c/slice.json',
  });
  assert.equal(start1.status, 'passed');

  const runFile = path.join(root, '.atlas', 'state', 's11c', 'run.json');

  // Variante ausente → default 2.
  let raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  delete raw.data.validator_cycle.max_attempts;
  raw.data.validator_cycle.attempts_used = 1;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));
  const startMissing = lockValidator({
    run_id: 's11c', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11c/slice-missing.json',
  });
  assert.equal(startMissing.status, 'passed');
  assert.equal(startMissing.validator_cycle.max_attempts, 2);

  // Variante 0/inválido → piso ≥1 não aceito do estado, cai no default 2.
  // attempts_used=1 garante que, se o teto caísse para 0/1 indevidamente,
  // o start seria bloqueado; como o default é 2, o attempt 2 passa.
  raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.max_attempts = 0;
  raw.data.validator_cycle.attempts_used = 1;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));
  const startZero = lockValidator({
    run_id: 's11c', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11c/slice-zero.json',
  });
  assert.equal(startZero.status, 'passed', 'max_attempts=0 no disco não rebaixa o teto');
  assert.equal(startZero.validator_cycle.max_attempts, 2);
});

// S11 (DEC-SIB-002): piso ≥0 em attempts_used — adulteração negativa não eleva teto efetivo.
// attempts_used=-5 com max_attempts=2 não pode liberar 7 dispatches (2 - (-5) = 7).
// O teto efetivo deve permanecer 2 independentemente do valor de attempts_used no disco.

test('S11: attempts_used=-5 adulterado → teto efetivo continua 2 (máx 2 dispatches, 3º blocked)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's11d', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's11d', project_root: root, action: 'start', phase: 'plan_execute' });

  // Adultera o run.json antes de qualquer validator: attempts_used=-5.
  // Sem o piso ≥0, isso criaria teto efetivo de 7 (2 - (-5) = 7), permitindo
  // 7 dispatches em vez de 2. Com o piso, normaliza para 0 e o teto efetivo
  // permanece 2. Após cada start aceito, o servidor grava attempts_used correto
  // em disco (1, depois 2) — o ataque de adulteração vale apenas na leitura inicial.
  const runFile = path.join(root, '.atlas', 'state', 's11d', 'run.json');
  let raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle = raw.data.validator_cycle ?? {};
  raw.data.validator_cycle.max_attempts = 2;
  raw.data.validator_cycle.attempts_used = -5;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  // Attempt 1 — deve passar (attempts_used normalizado para 0, 0 < 2).
  // O servidor grava attempts_used=1 no run.json após aceitar o start.
  const start1 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11d/slice-1.json',
  });
  assert.equal(start1.status, 'passed', 'attempt 1 deve ser permitido');
  assert.equal(start1.validator_attempt, 1);

  // Completa attempt 1 via fail → repair_required para liberar slot e manter
  // attempts_used=1 gravado no run.json pelo servidor.
  const complete1 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s11d/slice-1.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
  });
  assert.equal(complete1.status, 'passed', 'complete 1 deve funcionar');

  // Inicia repair (obrigatório após verdict=fail).
  const repairStart = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s11d/slice-1.json',
  });
  assert.equal(repairStart.status, 'passed', 'repair_start deve funcionar');

  // Conclui repair para liberar retry.
  const repairComplete = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/s11d/slice-1.json',
  });
  assert.equal(repairComplete.status, 'passed', 'repair_complete deve funcionar');

  // Attempt 2 — deve passar. O servidor leu attempts_used=1 (gravado por ele mesmo
  // após start1), não -5. Portanto validator_attempt=2.
  const start2 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11d/slice-2.json',
  });
  assert.equal(start2.status, 'passed', 'attempt 2 deve ser permitido');
  assert.equal(start2.validator_attempt, 2, 'attempt 2 é o segundo dispatch correto');

  // Completa attempt 2 com fail: como attempt=2 >= max_attempts=2, o servidor
  // retorna status='blocked' sinalizando que o ciclo está esgotado
  // (blocked_final_validator_failed). Isso é o comportamento correto — o teto
  // foi respeitado e não há 3º dispatch disponível.
  const complete2 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s11d/slice-2.json',
    validator_run_id: start2.validator_run_id,
    verdict: 'fail',
  });
  // O complete do 2º attempt com fail retorna blocked_final_validator_failed
  // (teto esgotado), não um erro de validação — confirma que o teto efetivo=2.
  assert.equal(complete2.status, 'blocked', 'complete 2 com fail esgota o teto → blocked_final_validator_failed');
  assert.match(complete2.error, /Segundo validator falhou/);
  assert.match(complete2.error, /máximo=2/);

  // Confirma que o ciclo foi marcado como bloqueado no run.json.
  // Qualquer tentativa de start adicional deve ser rejeitada.
  const start3 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s11d/slice-3.json',
  });
  assert.equal(start3.status, 'blocked', '3º attempt deve ser bloqueado');
  // A adulteração inicial com attempts_used=-5 não inflou o teto efetivo:
  // apenas 2 dispatches foram realizados, não 7 (que seria 2-(-5)+1).
});

test('S11: attempts_used float/string/null → normalizado para 0, start permitido como attempt 1', () => {
  const invalidValues = [-3.7, '2', null, undefined, false, {}, []];
  for (const [idx, badValue] of invalidValues.entries()) {
    const runId = `s11e${idx}`;
    const root = tmpRoot();
    preflight({
      run_id: runId, project_root: root, mode: 'execute',
      host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
    });
    lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });

    // Adultera attempts_used com valor inválido.
    const runFile = path.join(root, '.atlas', 'state', runId, 'run.json');
    const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    raw.data.validator_cycle = raw.data.validator_cycle ?? {};
    raw.data.validator_cycle.attempts_used = badValue;
    raw.data.validator_cycle.status = 'idle';
    raw.data.validator_cycle.active = null;
    fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

    // Start deve ser permitido como attempt 1 (attempts_used normalizado para 0).
    const start = lockValidator({
      run_id: runId, project_root: root, host: 'codex', action: 'start',
      state_path: `.atlas/state/${runId}/slice.json`,
    });
    assert.equal(
      start.status, 'passed',
      `attempts_used=${JSON.stringify(badValue)} deve normalizar para 0 e permitir attempt 1`,
    );
    assert.equal(start.validator_attempt, 1, `validator_attempt deve ser 1 para attempts_used=${JSON.stringify(badValue)}`);
  }
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

test('atlas_lock_validator: sibling é a única topologia; todos os hosts operam o lock sem gate', () => {
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
  assert.equal(r.status, 'passed');
  assert.equal(r.validator_status, 'running');
  assert.equal(r.validator_cycle.topology, undefined);
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
    state_path: '.atlas/state/tok1/slice.json',
  });

  const start2 = lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/tok1/slice.json',
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

test('S04: validatorComplete sem dispatch_token bloqueia e preserva slot ativo', () => {
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

  const missingToken = lockValidatorCore({
    run_id: 'tok4', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/tok4/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(missingToken.status, 'blocked');
  assert.equal(missingToken.stale_discarded, true);
  assert.equal(missingToken.next_action, 'reler_validator_recovery_e_reenviar_token');
  assert.notEqual(readRunJson(root, 'tok4').data.validator_cycle.active, null);
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
    state_path: '.atlas/state/mono1/slice.json',
  });

  const start2 = lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/mono1/slice.json',
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

  // Caso 2: caller não envia dispatch_token → hard-fail, slot permanece ativo.
  const withoutToken = lockValidatorCore({
    run_id: 'legacy1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/legacy1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(withoutToken.status, 'blocked');
  assert.equal(withoutToken.next_action, 'reler_validator_recovery_e_reenviar_token');
  assert.notEqual(readRunJson(root, 'legacy1').data.validator_cycle.active, null);
});

// S05 — reforço: host claude (antes era executor-dispatched) percorre ciclo completo
// idêntico ao codex após remoção dos guards de topologia. Prova que
// start→fail→repair→start→pass funciona host-agnóstico sem qualquer gate de host residual.
test('S05: host claude percorre ciclo completo start→fail→repair→start→pass idêntico ao codex', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'claude1', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'claude1', project_root: root, action: 'start', phase: 'plan_execute' });

  // 1º start — deve retornar passed/running com dispatch_token = 1.
  const start1 = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'start',
    state_path: '.atlas/state/claude1/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.validator_status, 'running');
  assert.equal(start1.dispatch_token, 1);
  assert.equal(start1.validator_cycle.topology, undefined, 'sem topology residual pós-S05');

  // 1º complete com verdict fail → status 'passed', validator_status 'repair_required', slot fecha.
  const fail1 = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'complete',
    state_path: '.atlas/state/claude1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'foo.ts', line: 1, msg: 'erro' }] },
  });
  assert.equal(fail1.status, 'passed');
  assert.equal(fail1.validator_status, 'repair_required');
  assert.equal(fail1.next_action, 'start_findings_repair_lock');
  let cycle = readRunJson(root, 'claude1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, 1, 'token preservado após fail');
  assert.equal(cycle.active, null, 'slot fechado após complete');

  // repair_start → repair_complete.
  const repairStart = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'repair_start',
    state_path: '.atlas/state/claude1/slice.json',
  });
  assert.ok(repairStart.repair_run_id, 'repair_run_id presente');
  lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/claude1/slice.json',
  });

  // 2º start — attempt e dispatch_token incrementam (monotonicidade).
  const start2 = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'start',
    state_path: '.atlas/state/claude1/slice.json',
  });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.validator_status, 'running');
  assert.ok(start2.dispatch_token > 1, `dispatch_token deve ser > 1 (foi ${start2.dispatch_token})`);
  cycle = readRunJson(root, 'claude1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, start2.dispatch_token, 'run.json em sincronia com retorno');
  assert.equal(cycle.active.dispatch_token, start2.dispatch_token, 'active.dispatch_token sincronizado');

  // 2º complete com verdict pass → fecha o ciclo.
  const pass1 = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'complete',
    state_path: '.atlas/state/claude1/slice.json',
    validator_run_id: start2.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(pass1.status, 'passed');
  assert.equal(pass1.validator_status, 'passed');
  cycle = readRunJson(root, 'claude1').data.validator_cycle;
  assert.equal(cycle.status, 'passed', 'ciclo fechado como passed');
  assert.equal(cycle.active, null, 'slot nulo após pass terminal');
});

// ── S10: endurecimento de bordas anti-stale / idempotência reconhecível ───────

// (a) attempt-1 retorna DEPOIS de attempt-2 despachado → blocked, slot do
// attempt-2 intacto, marcado stale_discarded (run_id divergente).
test('S10(a): retorno stale do attempt-1 após attempt-2 despachado → blocked, slot intacto', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10a', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10a', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10a/slice.json',
  });
  // attempt-1 falha → repair → attempt-2 (novo slot ativo).
  lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10a/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  const repairStart = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s10a/slice.json',
  });
  lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/s10a/slice.json',
  });
  const start2 = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10a/slice.json',
  });
  assert.equal(start2.status, 'passed');

  // attempt-1 (run_id antigo) chega tarde → blocked, stale_discarded, slot intacto.
  const stale = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10a/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(stale.status, 'blocked');
  assert.equal(stale.stale_discarded, true);
  assert.match(stale.error, /validator_run_id não corresponde/);

  const cycle = readRunJson(root, 's10a').data.validator_cycle;
  assert.equal(cycle.active.run_id, start2.validator_run_id, 'slot do attempt-2 preservado');
  assert.equal(cycle.status, 'running');
});

// (b) complete duplicado do mesmo run_id após slot fechado → blocked
// stale_discarded idempotente, last_verdict ecoado.
test('S10(b): complete duplicado após slot fechado → idempotente reconhecível, last_verdict ecoado', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10b', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10b', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10b', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10b/slice.json',
  });
  const good = lockValidator({
    run_id: 's10b', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10b/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass_with_observations',
  });
  assert.equal(good.status, 'passed');
  assert.equal(good.validator_status, 'passed_with_observations');

  // Retorno duplicado do MESMO run_id após slot fechado.
  const dup = lockValidator({
    run_id: 's10b', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10b/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass_with_observations',
  });
  assert.equal(dup.status, 'blocked');
  assert.equal(dup.stale_discarded, true);
  assert.equal(dup.reason, 'stale_duplicate_already_applied');
  assert.equal(dup.last_verdict, 'passed_with_observations');
  assert.equal(dup.applied_validator_status, 'passed_with_observations');
  assert.equal(dup.next_action, 'descartar_retorno_duplicado_idempotente');

  // Slot continua fechado, ciclo terminal intacto.
  const cycle = readRunJson(root, 's10b').data.validator_cycle;
  assert.equal(cycle.active, null);
  assert.equal(cycle.status, 'passed_with_observations');

  // run_id desconhecido após slot fechado → erro genérico, mas stale_discarded.
  const unknown = lockValidator({
    run_id: 's10b', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10b/slice.json',
    validator_run_id: 's10b:validator:99:desconhecido', verdict: 'pass',
  });
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.stale_discarded, true);
  assert.equal(unknown.next_action, 'start_validator_primeiro');
  assert.equal(unknown.reason, undefined, 'sem reason de duplicado para run_id desconhecido');
});

// (c) repair_complete duplicado → idempotente reconhecível.
test('S10(c): repair_complete duplicado → idempotente reconhecível', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10c', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10c', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10c/slice.json',
  });
  lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10c/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  const repairStart = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s10c/slice.json',
  });
  const repairDone = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/s10c/slice.json',
  });
  assert.equal(repairDone.status, 'passed');

  // Retorno duplicado do MESMO repair_run_id após repair concluído.
  const dup = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/s10c/slice.json',
  });
  assert.equal(dup.status, 'blocked');
  assert.equal(dup.stale_discarded, true);
  assert.equal(dup.reason, 'repair_duplicate_already_applied');
  assert.equal(dup.next_action, 'descartar_retorno_duplicado_idempotente');

  // Ciclo continua em ready_for_retry, não corrompido.
  const cycle = readRunJson(root, 's10c').data.validator_cycle;
  assert.equal(cycle.status, 'ready_for_retry');
  assert.equal(cycle.repair.active, null);

  // repair_run_id desconhecido fora de ordem → blocked stale_discarded, sem reason.
  const unknown = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: 's10c:repair:99:desconhecido',
    state_path: '.atlas/state/s10c/slice.json',
  });
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.stale_discarded, true);
  assert.equal(unknown.reason, undefined);
});

// (d) re-spun: ler estado de disco, obter validator_recovery determinístico.
test('S10(d): atlas_run_state(get) expõe validator_recovery do slot ativo (recovery re-spun)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10d', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10d', project_root: root, action: 'start', phase: 'plan_execute' });

  // Sem slot ativo ainda → validator_recovery null.
  const before = runState({ action: 'get', run_id: 's10d', project_root: root });
  assert.equal(before.validator_recovery, null);

  const start1 = lockValidator({
    run_id: 's10d', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10d/slice.json',
  });

  // Re-spun: leitura pura do disco expõe o slot esperado de forma determinística.
  const recovery = runState({ action: 'get', run_id: 's10d', project_root: root });
  assert.notEqual(recovery.validator_recovery, null);
  assert.equal(recovery.validator_recovery.expected_validator_run_id, start1.validator_run_id);
  assert.equal(recovery.validator_recovery.expected_dispatch_token, start1.dispatch_token);
  assert.equal(recovery.validator_recovery.expected_state_path, '.atlas/state/s10d/slice.json');
  assert.equal(recovery.validator_recovery.status, 'running');

  // Após fechar o slot, validator_recovery volta a null.
  lockValidator({
    run_id: 's10d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10d/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  const after = runState({ action: 'get', run_id: 's10d', project_root: root });
  assert.equal(after.validator_recovery, null);
});

// (e) regressão Codex sem token: caminho idempotente não exige dispatch_token.
test('S10(e): Codex com dispatch_token mantém idempotência por run_id', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10e', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10e', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10e', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10e/slice.json',
  });
  // Helper injeta o dispatch_token do validator_recovery, como faz o orquestrador.
  const good = lockValidator({
    run_id: 's10e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10e/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(good.status, 'passed');

  // Duplicado → idempotente reconhecível por run_id.
  const dup = lockValidator({
    run_id: 's10e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10e/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(dup.status, 'blocked');
  assert.equal(dup.stale_discarded, true);
  assert.equal(dup.reason, 'stale_duplicate_already_applied');
  assert.equal(dup.last_verdict, 'passed');
});

// (f) P3-2: duplicado de attempt-1 (fail→repair_required) chegando com o ciclo
// já em repair_required. O complete fail grava status:'passed' no history (result
// .status é 'passed' no caminho repair); o duplicado tardio casa o evento e
// retorna applied_validator_status='repair_required' para o consumidor não
// confundir com slice concluída. Slot NÃO reabre (blocked, stale_discarded).
test('S10(f): duplicado de attempt-1 (fail→repair_required) em repair_required → applied_validator_status=repair_required', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10f', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10f', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10f', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s10f/slice.json',
  });
  // attempt-1 falha → repair_required (result.status='passed', validator_status='repair_required').
  const fail1 = lockValidator({
    run_id: 's10f', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10f/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  assert.equal(fail1.status, 'passed');
  assert.equal(fail1.validator_status, 'repair_required');

  // Ciclo está em repair_required (slot fechado, repair ainda não iniciado).
  const cycleMid = readRunJson(root, 's10f').data.validator_cycle;
  assert.equal(cycleMid.status, 'repair_required');
  assert.equal(cycleMid.active, null);

  // Complete duplicado tardio do MESMO run_id de attempt-1 chega em repair_required.
  const dup = lockValidator({
    run_id: 's10f', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s10f/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
  });
  assert.equal(dup.status, 'blocked');
  assert.equal(dup.stale_discarded, true);
  assert.equal(dup.reason, 'stale_duplicate_already_applied');
  // Estado real que aquele complete produziu — NÃO uma conclusão bem-sucedida.
  assert.equal(dup.applied_validator_status, 'repair_required');
  assert.equal(dup.last_verdict, 'fail');
  assert.equal(dup.next_action, 'descartar_retorno_duplicado_idempotente');

  // Slot NÃO reabriu; ciclo permanece em repair_required.
  const cycleAfter = readRunJson(root, 's10f').data.validator_cycle;
  assert.equal(cycleAfter.status, 'repair_required');
  assert.equal(cycleAfter.active, null);
});

// =====================================================================
// S12 — Contrato legível da FSM sibling (SPEC_FSM_SIBLING_S02 §1 e §2)
// =====================================================================
//
// Objetivo S12: travar a FSM como PROPRIEDADE legível. Dois eixos:
//   1. Transição canônica completa — dirige o ciclo por TODOS os estados
//      do §1 e asserta cycle.status PERSISTIDO em disco em cada transição.
//   2. Matriz de transições ILEGAIS (§2 hard-fails) ainda não cobertas.
//
// Helper local: lê o cycle.status diretamente do run.json (fonte de verdade
// persistida), em vez de confiar só no retorno do tool. Determinístico:
// nenhuma asserção depende de timestamp.

// --- S12.1: transição canônica da FSM (teste-contrato) ---
//
// Mapeamento estado → evento (SPEC §1.2), asserido via cycle.status no disco:
//
//   ESTADO INICIAL          idle                  (ciclo não iniciado)
//     --[validatorStart]-->  running              (attempt 1)
//     --[complete(fail)]-->  repair_required      (attempt<max → reparo pendente)
//     --[repair_start]-->    repair_running       (atlas-findings-repair ativo)
//     --[repair_complete]--> ready_for_retry      (reparo concluído; retry autorizado)
//     --[validatorStart]-->  running              (attempt 2, último dispatch)
//     --[complete(pass)]-->  passed               (TERMINAL; active=null)
//
test('S12.1: ciclo canônico da FSM percorre idle→running→repair_required→repair_running→ready_for_retry→running→passed (cycle.status persistido em cada transição)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12fsm', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12fsm', project_root: root, action: 'start', phase: 'plan_execute' });

  // Lê o status persistido no disco — fonte de verdade da FSM, não o retorno do tool.
  const status = () => {
    const cycle = readRunJson(root, 's12fsm').data?.validator_cycle ?? {};
    // Default 'idle' espelha normalizeValidatorCycle (SPEC §1.1 / server.js:823).
    return typeof cycle.status === 'string' ? cycle.status : 'idle';
  };
  const slot = () => readRunJson(root, 's12fsm').data?.validator_cycle?.active ?? null;

  // [estado inicial] idle — antes de qualquer despacho do validator.
  // (lockDispatch cria o run.json; o validator_cycle ainda não foi iniciado.)
  assert.equal(status(), 'idle', 'estado inicial deve ser idle (SPEC §1.1)');

  // idle --[validatorStart]--> running (attempt 1).
  const start1 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12fsm/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.validator_attempt, 1);
  assert.equal(status(), 'running', 'após validatorStart → running');
  assert.notEqual(slot(), null, 'running tem slot ativo');

  // running --[complete(fail), attempt<max]--> repair_required.
  const fail1 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12fsm/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  assert.equal(fail1.validator_status, 'repair_required');
  assert.equal(status(), 'repair_required', 'após complete(fail) attempt<max → repair_required');
  assert.equal(slot(), null, 'repair_required fecha o slot do validator');

  // repair_required --[repair_start]--> repair_running.
  const repairStart = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s12fsm/slice.json',
  });
  assert.equal(repairStart.validator_status, 'repair_running');
  assert.equal(status(), 'repair_running', 'após repair_start → repair_running');

  // repair_running --[repair_complete]--> ready_for_retry.
  const repairDone = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/s12fsm/slice.json',
  });
  assert.equal(repairDone.validator_status, 'ready_for_retry');
  assert.equal(status(), 'ready_for_retry', 'após repair_complete → ready_for_retry (retry autorizado)');

  // ready_for_retry --[validatorStart]--> running (attempt 2, último dispatch).
  const start2 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12fsm/slice.json',
  });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.validator_attempt, 2);
  assert.equal(status(), 'running', 'após 2º validatorStart → running (attempt 2)');

  // running --[complete(pass)]--> passed (TERMINAL).
  const pass2 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12fsm/slice.json',
    validator_run_id: start2.validator_run_id, verdict: 'pass',
  });
  assert.equal(pass2.status, 'passed');
  assert.equal(pass2.validator_status, 'passed');
  assert.equal(status(), 'passed', 'após complete(pass) → passed (terminal)');
  assert.equal(slot(), null, 'terminal passed: slot ativo é null (SPEC §1.1)');
});

// S12.1b — Simetria de terminais: ciclo canônico com passed_with_observations.
// P3-1: garante que passed_with_observations também fecha slot (cycle.active===null),
// simétrico ao assert já existente para passed em S12.1.
test('S12.1b: ciclo canônico termina em passed_with_observations com slot fechado (cycle.active===null — simetria com passed)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12fsm_pwo', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12fsm_pwo', project_root: root, action: 'start', phase: 'plan_execute' });

  const slot = () => readRunJson(root, 's12fsm_pwo').data?.validator_cycle?.active ?? null;

  // Attempt 1 — start aceito.
  const start1 = lockValidator({
    run_id: 's12fsm_pwo', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12fsm_pwo/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.notEqual(slot(), null, 'slot ativo após start');

  // complete com pass_with_observations → passed_with_observations (TERMINAL).
  const pwo = lockValidator({
    run_id: 's12fsm_pwo', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12fsm_pwo/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass_with_observations',
  });
  assert.equal(pwo.validator_status, 'passed_with_observations');
  const cycle = readRunJson(root, 's12fsm_pwo').data.validator_cycle;
  assert.equal(cycle.status, 'passed_with_observations', 'status persistido = passed_with_observations');
  // P3-1: slot DEVE ser null — terminal aprovado fecha o slot (simetria com passed).
  assert.equal(cycle.active, null, 'terminal passed_with_observations: slot ativo é null (SPEC §1.1)');
});

// --- S12.2: matriz de transições ILEGAIS (§2 hard-fails) ---
//
// Cobertura existente (NÃO duplicada aqui):
//   - 2º start em repair_required SEM repair concluído (HF-07) → já coberto no
//     teste "codex sibling bloqueia validator concorrente..." (retryBeforeRepair).
//   - complete com run_id desconhecido após slot fechado (HF-09) → já coberto em S10(b).
//   - repair_complete DUPLICADO após repair concluído → já coberto em S10(c).
//   - validator/repair concorrente (HF-04/HF-14) → já coberto nos testes sibling.
//
// Novos abaixo: as transições ilegais do §2 que ainda NÃO tinham teste dedicado.

// (a) HF-08: complete SEM start prévio — ciclo idle puro, nenhum slot jamais aberto.
test('S12.2(a): complete sem start prévio (ciclo idle) → blocked, start_validator_primeiro', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12a', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12a', project_root: root, action: 'start', phase: 'plan_execute' });

  // Nunca houve validatorStart → cycle idle, active null.
  const complete = lockValidator({
    run_id: 's12a', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12a/slice.json',
    validator_run_id: 's12a:validator:1:fake', verdict: 'pass',
  });
  assert.equal(complete.status, 'blocked');
  assert.match(complete.error, /Nenhum validator ativo/);
  assert.equal(complete.next_action, 'start_validator_primeiro');
});

// (b) HF-15: repair_start quando status != repair_required (fora de ordem).
// Caso: logo após um validatorStart aceito, status=running → repair não pode iniciar.
test('S12.2(b): repair_start em status running (fora de ordem) → blocked, completar_validator_fail_antes_do_repair', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12b', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12b', project_root: root, action: 'start', phase: 'plan_execute' });

  // start aceito → status running (validator ainda ativo).
  lockValidator({
    run_id: 's12b', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12b/slice.json',
  });

  // repair_start com validator ativo: o 1º guard (validator ativo) dispara primeiro.
  const repairWhileActive = lockValidator({
    run_id: 's12b', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s12b/slice.json',
  });
  assert.equal(repairWhileActive.status, 'blocked');
  assert.match(repairWhileActive.error, /Repair não pode iniciar enquanto há validator ativo/);
});

// (b2) HF-15 puro: status repair_running (não repair_required) → "Repair fora de ordem".
// Atinge o branch cycle.status !== 'repair_required' sem o slot de validator ativo,
// dirigindo o ciclo até repair_running e tentando um 2º repair_start fora de ordem.
test('S12.2(b2): repair_start em status repair_running (fora de ordem, sem validator ativo) → blocked', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12b2', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12b2', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12b2/slice.json',
  });
  lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12b2/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'boom' }] },
  });
  // status → repair_running.
  lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s12b2/slice.json',
  });
  // 2º repair_start: repair já ativo → blocked (guard de concorrência dispara antes do "fora de ordem").
  const second = lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s12b2/slice.json',
  });
  assert.equal(second.status, 'blocked');
  assert.match(second.error, /Repair já está ativo/);
});

// (c) HF-19: repair_complete SEM repair ativo — nenhum repair jamais iniciado.
test('S12.2(c): repair_complete sem repair ativo (ciclo idle) → blocked', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12c', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12c', project_root: root, action: 'start', phase: 'plan_execute' });

  // Nenhum validator, nenhum repair → repair_complete é fora de ordem.
  const repairComplete = lockValidator({
    run_id: 's12c', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: 's12c:repair:1:fake',
    state_path: '.atlas/state/s12c/slice.json',
  });
  assert.equal(repairComplete.status, 'blocked');
  // status idle ≠ repair_running → "Repair fora de ordem" OU "Nenhum repair ativo".
  assert.match(repairComplete.error, /Repair fora de ordem|Nenhum repair ativo/);
});

// (d) GAP FECHADO em S12: start após terminal passed/passed_with_observations.
// SPEC §1.3 / D-S02-2: terminais NÃO têm transição de saída — não reabrem.
// Antes do fix, um 2º validatorStart após pass reabria como attempt 2 (defeito).
test('S12.2(d): validatorStart após terminal passed → blocked (terminal não reabre — SPEC §1.3)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12d', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12d', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's12d', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12d/slice.json',
  });
  const pass1 = lockValidator({
    run_id: 's12d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12d/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(pass1.validator_status, 'passed');
  assert.equal(readRunJson(root, 's12d').data.validator_cycle.status, 'passed');

  // Novo start sobre terminal passed → blocked (não reabre, não vira attempt 2).
  const reopen = lockValidator({
    run_id: 's12d', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12d/slice-2.json',
  });
  assert.equal(reopen.status, 'blocked');
  assert.equal(reopen.validator_attempt, undefined, 'terminal não gera novo attempt');
  assert.match(reopen.error, /terminal não reabre|já concluído/);
  // Ciclo permanece terminal passed; slot não reabre.
  const cycle = readRunJson(root, 's12d').data.validator_cycle;
  assert.equal(cycle.status, 'passed');
  assert.equal(cycle.active, null);
});

// (d2) Mesmo gap para passed_with_observations (terminal aprovado com observações).
test('S12.2(d2): validatorStart após terminal passed_with_observations → blocked (terminal não reabre)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12d2', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12d2', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's12d2', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12d2/slice.json',
  });
  lockValidator({
    run_id: 's12d2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12d2/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass_with_observations',
  });
  assert.equal(readRunJson(root, 's12d2').data.validator_cycle.status, 'passed_with_observations');

  const reopen = lockValidator({
    run_id: 's12d2', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12d2/slice-2.json',
  });
  assert.equal(reopen.status, 'blocked');
  assert.equal(reopen.validator_status, 'passed_with_observations');
  assert.match(reopen.error, /terminal não reabre|já concluído/);
});

// P2 — regressão da ordem de guards: terminal atingido no attempt 2 (último).
//
// Antes da correção da ordem, quando a slice PASSA no attempt 2, o estado fica
// attempts_used=2 e max_attempts=2. Um novo validatorStart disparava HF-05
// ("Terceiro validator proibido") ANTES do guard terminal, devolvendo causa de
// FALHA para uma slice que foi APROVADA.
//
// Após a correção: guard terminal precede HF-05 → reopen retorna causa
// "terminal não reabre" (encerrar_slice_terminal_aprovada), não "terceiro proibido".
test('S12.2(e): reabrir slice que passou no attempt 2 (terminal no último attempt) → blocked com causa TERMINAL, não "terceiro proibido" — P2 guard-order regression', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's12e', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's12e', project_root: root, action: 'start', phase: 'plan_execute' });

  // Attempt 1: fail → repair.
  const start1 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12e/slice.json',
  });
  assert.equal(start1.status, 'passed', 'attempt 1 aceito');
  const fail1 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12e/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [{ severity: 'P1', file: 'x.ts', line: 1, msg: 'falha1' }] },
  });
  assert.equal(fail1.validator_status, 'repair_required', 'fail1 → repair_required');

  const repairStart = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.atlas/state/s12e/slice.json',
  });
  lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.atlas/state/s12e/slice.json',
  });

  // Attempt 2 (último): pass → terminal.
  const start2 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12e/slice.json',
  });
  assert.equal(start2.status, 'passed', 'attempt 2 aceito');
  assert.equal(start2.validator_attempt, 2, 'é o attempt 2');
  const pass2 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.atlas/state/s12e/slice.json',
    validator_run_id: start2.validator_run_id, verdict: 'pass',
  });
  assert.equal(pass2.validator_status, 'passed', 'attempt 2 terminou em passed');

  // Estado: attempts_used=2, max_attempts=2, cycle.status='passed' (terminal).
  const cycleAfterPass = readRunJson(root, 's12e').data.validator_cycle;
  assert.equal(cycleAfterPass.attempts_used, 2, 'attempts_used=2 após attempt 2');
  assert.equal(cycleAfterPass.status, 'passed', 'ciclo em estado terminal passed');
  assert.equal(cycleAfterPass.active, null, 'slot fechado após terminal');

  // Reabrir: DEVE retornar causa TERMINAL (não "terceiro validator proibido").
  const reopen = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'start',
    state_path: '.atlas/state/s12e/slice-3.json',
  });
  assert.equal(reopen.status, 'blocked', 'reopen bloqueado');
  // Causa deve ser a do guard terminal, não a de HF-05 (contagem).
  assert.equal(reopen.next_action, 'encerrar_slice_terminal_aprovada',
    'next_action deve ser encerrar_slice_terminal_aprovada (não tratar_como_blocked_final_validator_failed)');
  assert.equal(reopen.validator_status, 'passed', 'validator_status ecoado = passed');
  assert.match(reopen.error, /terminal não reabre|já concluído/,
    'error menciona terminal, não "terceiro proibido"');
  // Ciclo permanece intacto — não foi modificado.
  const cycleAfterReopen = readRunJson(root, 's12e').data.validator_cycle;
  assert.equal(cycleAfterReopen.status, 'passed', 'ciclo permanece passed após reopen bloqueado');
  assert.equal(cycleAfterReopen.active, null, 'slot permanece null');
});

// ───────────────────────────────────────────────────────────────────────────
// Regressões do lote de confiabilidade 0.7.1 (achados do smoke S18 multi-host).
// ───────────────────────────────────────────────────────────────────────────

// P2: `atlas_run_state(upsert)` com `data` parcial DEVE preservar dispatch.active.
// O executor escreve o handoff via upsert parcial; antes do fix, o replace cego
// apagava dispatch.active={plan_execute} e o lock_validator(start) seguinte
// bloqueava ("current_phase null"). Confirmado em Codex + opencode @ 0.7.0.
test('P2: upsert parcial preserva dispatch.active (não derruba o lock de fase)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'p2merge', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'p2merge', project_root: root, action: 'start', phase: 'plan_execute' });
  // Executor persiste o handoff com um data parcial (sem repetir dispatch/routing).
  runState({
    action: 'upsert',
    run_id: 'p2merge',
    project_root: root,
    data: { validator_handoff_required: true, state_path: '.atlas/state/p2merge/slice.json' },
  });
  const after = readRunJson(root, 'p2merge');
  assert.equal(after.data.dispatch?.active?.phase, 'plan_execute', 'dispatch.active preservado após upsert parcial');
  assert.equal(after.data.validator_handoff_required, true, 'chave nova do upsert aplicada');
  assert.equal(after.data.routing?.mode, 'execute', 'routing preservado após upsert parcial');
});

// Version-conflict: um run ANTIGO inativo (versão anterior do plugin) não pode
// travar um run NOVO. Antes do fix, findActiveRunConflict dava hard-fail de versão
// em qualquer run.json do diretório — quem atualizava de 0.6.x ficava com todo run
// novo bloqueado. Confirmado ao retomar PV08a (state pv01–pv07 em 0.6.2).
test('version-conflict: run antigo inativo de versão anterior não bloqueia run novo', () => {
  const root = tmpRoot();
  // Resíduo de versão anterior, sem dispatch ativo.
  const oldDir = path.join(root, '.atlas', 'state', 'run-velho');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'run.json'), JSON.stringify({
    run_id: 'run-velho',
    phase: 'preflight',
    status: 'dispatch_ok',
    data: { routing: { version: '0.6.2', mode: 'full' }, dispatch: { active: null } },
  }, null, 2));
  const r = preflight({
    run_id: 'run-novo', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'passed', 'run novo passa apesar do resíduo 0.6.2 inativo');
});

// Banner cosmético: verificar um PRD não pode ecoar "plano · validado".
test('banner: verify_artifact com artifact_kind=prd ecoa banner de PRD; default mantém plano', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PRD_x.md'), VALID_PRD);
  fs.writeFileSync(path.join(root, 'PLAN_x.md'), CONFORMANT_PLAN_DOC);
  const prd = verifyArtifact({ run_id: 'bk', project_root: root, artifact_path: 'PRD_x.md', artifact_kind: 'prd' });
  assert.equal(prd.status, 'passed');
  assert.equal(prd.banner, '▸ atlas: prd · ok');
  const plan = verifyArtifact({ run_id: 'bk', project_root: root, artifact_path: 'PLAN_x.md' });
  assert.equal(plan.banner, '▸ atlas: plano · validado (TC pass)', 'default (sem kind) preserva banner de plano');
});
