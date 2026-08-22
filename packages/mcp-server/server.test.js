// Testes de unidade do núcleo portável do MCP (S04 / F2-A6).
// Cobre: detecção de host (registry data-driven + precedência), contrato
// talos_capabilities (schema_version, flags, known_hosts) e hard-fail de
// pré-requisitos (DEC-004). Rodar: node --test packages/mcp-server/
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  checkDispatchCapability,
  expectedNextPhase,
  documentFlowForRouting,
  expectedExecutorSkill,
  guaranteeLevelForMode,
  classifyArtifactContent,
  BANNER_TEMPLATES,
  BANNER_EVENTS,
  renderBanner,
  verifyArtifact,
  scanAcceptance,
  verifyTemplateConformance,
  verifySprintFile,
  verifyBacklogIndex,
  selectNextSprint,
  nextActionForSelectedSprint,
  updateSprintStatus,
  syncManualValidation,
  emitMemoryHandoff,
  propagateRevalidation,
  classifyInput,
  preflight,
  lockDispatch,
  lockValidator as lockValidatorCore,
  captureWorktreeSnapshot,
  validateStateBoundary,
  classifyAcceptanceResults,
  assertAfterPlan,
  runState,
  ping,
  toolsList,
  commitState,
} from './server.js';
import {
  parseSprintRows,
  validateSprintFileConformance,
  validateAcceptanceSeal,
  computeAcceptanceSeal,
  extractAcceptanceBlock,
  applyInterviewRound,
  approveAcceptanceContract,
  closedDecisionIds,
  parseCriticalReview,
  requiresCriticalReview,
  CRITICAL_REVIEW_REASONS,
} from '../skills/_shared/scripts/document_quality.mjs';
import { fileURLToPath } from 'node:url';

const SPRINT_TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../templates/SPRINT_TEMPLATE.md',
);
const SPRINT_INTERVIEW_SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/talos-sprint-interview/SKILL.md',
);
const ORCHESTRATOR_SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../orchestrator/skills/talos/SKILL.md',
);
const PLAN_EXECUTE_SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/talos-plan-execute/SKILL.md',
);
const DIRECT_EXECUTE_SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/talos-direct-execute/SKILL.md',
);
const FINDINGS_REPAIR_SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/talos-findings-repair/SKILL.md',
);
const SLICE_REVIEW_SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/talos-slice-review/SKILL.md',
);

function ensureValidatorStateFixture(root, runId, statePath) {
  // Em state_schema_version 3, o boundary exige git real (base_sha/head_sha +
  // snapshots coerentes). Para testes do ciclo validator que não focam em
  // boundary (FSM, dispatch_token, idempotência), este helper garante um repo
  // git mínimo + state v3 coerente quando o fixture ainda não existe.
  const abs = path.resolve(root, statePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs)) return;
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  } catch {
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'talos@example.invalid']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Talos Test']);
    fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
    execFileSync('git', ['-C', root, 'add', 'README.md']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'base']);
  }
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const baseline = captureWorktreeSnapshot(root);
  fs.writeFileSync(abs, JSON.stringify({
    state_schema_version: 3,
    run_id: runId, slice: 'test', base_sha: head, head_sha: head, contract_kind: 'plan',
    tasks: [], files_changed: [],
    diff_stat: '0 files', plan_path: '.talos/plans/test.md',
    boundary_refs: [], obligations: [], invariants: [], scenario_probes: [],
    risk_probes: [], validation_map: [], task_evidence: [], repair_evidence: [],
    worktree_baseline: baseline, worktree_final: baseline,
    executed_at: new Date().toISOString(), executor_skill: 'talos-plan-execute',
  }, null, 2));
}

function lockValidator(args) {
  // AC-1.3.3 (LEG4): o wrapper NUNCA emite checkpoint público `state_path_created`
  // (event morto desde o Plano 01). Testes de ciclo que precisam de slice em
  // disco: fixture de READER (ensureValidatorStateFixture) e, na sequência, o
  // sha do arquivo é registrado no ledger via upsert — caminho de harness
  // documentado, NÃO o caminho execute (o execute real é commitState). Sem sha
  // no ledger o start bloquearia por órfão; registrar o sha isola o comportamento
  // sob prova (FSM, token, teto, proof-of-work) do gate de dual-writer.
  if (args.action === 'start' && args.state_path) {
    try {
      ensureValidatorStateFixture(args.project_root, args.run_id, args.state_path);
      const abs = path.resolve(args.project_root, args.state_path);
      const sha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      const current = runState({ action: 'get', run_id: args.run_id, project_root: args.project_root });
      const data = current.data ?? {};
      const liveness = data.dispatch?.active?.liveness ?? {};
      data.dispatch = {
        ...(data.dispatch ?? {}),
        active: {
          ...(data.dispatch?.active ?? {}),
          liveness: {
            ...liveness,
            status: 'handoff_ready',
            last_checkpoint: 'commit_state',
            last_progress_at: new Date().toISOString(),
            slice_commit_sha256: sha,
            last_commit_state_path: args.state_path,
          },
        },
      };
      runState({ action: 'upsert', run_id: args.run_id, project_root: args.project_root, data });
    } catch {
      // Testes de hard-fail devem alcançar o runtime original.
    }
  }
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
  if (args.action === 'complete' && args.challenge_response === undefined) {
    // Testes do ciclo validator que não focam em proof-of-work esperam que o
    // challenge (se emitido) seja satisfeito automaticamente. O recovery expõe
    // o arquivo do challenge; injetamos o hash real para que o veredito do
    // teste reflita a lógica sob prova (FSM, idempotência), não o challenge.
    try {
      const state = runState({
        action: 'get',
        run_id: args.run_id,
        project_root: args.project_root,
      });
      const challenge = state.validator_recovery?.challenge;
      if (challenge?.file) {
        const challengeAbs = path.resolve(args.project_root, challenge.file);
        if (fs.existsSync(challengeAbs)) {
          args = { ...args, challenge_response: sha256File(args.project_root, challenge.file) };
        }
      }
    } catch {
      // Sem recovery acessível: o runtime original decide (challenge_failed se exigido).
    }
  }
  if (args.action === 'complete' && !Object.hasOwn(args, 'data')) {
    args = { ...args, data: { findings: [] } };
  }
  return lockValidatorCore(args);
}

function finding(overrides = {}) {
  return {
    id: 'F-001', severity: 'P1', file: 'x.ts', line: 1,
    failure_mode: 'fluxo inválido', evidence: 'teste falhou',
    recommendation: 'corrigir fluxo', fix_validation: 'node --test',
    ...overrides,
  };
}

function resolvedRepair(root, statePath, findingId = 'F-001', file = 'x.ts') {
  const abs = path.join(root, statePath);
  const state = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const evidence = {
    finding_id: findingId, files_touched: [file], checks_run: ['node --test'], status: 'resolved',
  };
  state.repair_evidence = [evidence];
  // Em state_schema_version 3, o repair_complete revalida boundary e compara o
  // delta de snapshots (before vs after) contra os arquivos tocados pelo repair.
  // Para o delta ser não-vazio, o repair precisa modificar de fato o worktree.
  // Criar/mutar o arquivo garante que snapshotDeltaFiles detecte a mudança.
  const fileAbs = path.join(root, file);
  const previous = fs.existsSync(fileAbs) ? fs.readFileSync(fileAbs, 'utf8') : '';
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
  fs.writeFileSync(fileAbs, `${previous}// repair ${findingId} ${Date.now()}\n`);
  const filesChanged = [...new Set([...(state.files_changed ?? []), file])].sort();
  state.files_changed = filesChanged;
  state.worktree_final = captureWorktreeSnapshot(root);
  state.diff_stat = `${filesChanged.length} files`;
  fs.writeFileSync(abs, JSON.stringify(state, null, 2));
  return { repairs: [evidence] };
}

test('ping: capabilities cobre exatamente a superfície de tools (sem drift)', () => {
  // Guard cruzado do P0: ping().capabilities é derivado de toolsList() — qualquer
  // tool nova ou removida propaga sozinha. Este teste falha se alguém reintroduzir
  // uma lista manual paralela que omita uma tool (regressão histórica:
  // talos_classify_input ficou fora do ping e podia abortar run válida).
  const toolNames = toolsList().tools.map((tool) => tool.name).sort();
  const capList = [...ping().capabilities].sort();
  assert.deepEqual(capList, toolNames);
  assert.ok(capList.includes('talos_classify_input'), 'talos_classify_input deve estar nas capabilities');
});

test('tools: conjunto registrado é exatamente a lista canônica, sem adição (AC-04.3.1 / INV3)', () => {
  // Lista nomeada explicitamente no teste: qualquer tool nova exige atualização
  // consciente desta lista (e revisão de INV3) — adicionar aqui é a decisão, não
  // o acidente. A revisão fria do backlog não entra no MCP (Q-CBR-06): sem lock,
  // sem selo, sem gate novo.
  const expected = [
    'talos_assert_after_plan',
    'talos_capabilities',
    'talos_classify_input',
    'talos_commit_state',
    'talos_lock_dispatch',
    'talos_lock_validator',
    'talos_ping',
    'talos_preflight',
    'talos_run_state',
    'talos_scan_acceptance',
    'talos_select_next_sprint',
    'talos_sync_manual_validation',
    'talos_update_sprint_status',
    'talos_verify_artifact',
    'talos_verify_backlog_index',
    'talos_verify_sprint_file',
    'talos_verify_template_conformance',
  ].sort();
  assert.deepEqual(toolsList().tools.map((tool) => tool.name).sort(), expected);
});

test('detectHost: arg host explícito tem prioridade máxima', () => {
  const r = detectHost({ host: 'codex' }, { CLAUDE_PLUGIN_ROOT: '/x' });
  assert.equal(r.host, 'codex');
  assert.equal(r.detected_via, 'arg');
});

test('detectHost: TALOS_HOST sobrepõe sinais de env nativos', () => {
  const r = detectHost({}, { TALOS_HOST: 'codex', CLAUDE_PLUGIN_ROOT: '/x' });
  assert.equal(r.host, 'codex');
  assert.equal(r.detected_via, 'env:TALOS_HOST');
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
  assert.equal(detectHost({}, { TALOS_HOST: 'inexistente' }).host, 'generic');
});

test('capabilities: schema_version atual e campos do contrato v5', () => {
  const cap = capabilities({ host: 'claude' });
  assert.equal(cap.schema_version, CAPABILITIES_SCHEMA_VERSION);
  assert.equal(cap.schema_version, 5);
  assert.ok(cap.capabilities_flags);
  assert.ok(cap.validator_dispatch);
  assert.ok(cap.question_prompt);
  assert.equal(cap.question_prompt.mode, 'structured');
  assert.equal(cap.question_prompt.persistence, 'sprint_after_each_round');
  assert.ok(cap.hooks);
  assert.deepEqual(cap.prerequisites, PREREQUISITES);
  assert.deepEqual(cap.known_hosts, HOST_NAMES);
});

test('capabilities: mecanismo estruturado de entrevista declarado por adapter sem alterar schema v5', () => {
  for (const host of HOST_NAMES) {
    const prompt = capabilities({ host }).question_prompt;
    assert.equal(typeof prompt.mechanism, 'string', `host ${host}`);
    assert.ok(prompt.mechanism.length > 0, `host ${host}`);
    assert.ok(prompt.max_questions >= 1 && prompt.max_questions <= 4, `host ${host}`);
    assert.equal(prompt.options_per_question, 3, `host ${host}`);
  }
  assert.equal(capabilities({ host: 'codex' }).schema_version, 5);
});

test('capabilities: validator_dispatch de todos os hosts expõe dispatcher/join; Codex adiciona contrato explícito do validator', () => {
  for (const host of HOST_NAMES) {
    const cap = capabilities({ host });
    // Guard de forma: sibling-only exige dispatcher/join em todos os hosts.
    // Codex adiciona metadados explícitos do custom agent; consumidores devem
    // ignorar campos aditivos fora do mínimo portável.
    assert.ok('dispatcher' in cap.validator_dispatch, `host ${host}: dispatcher ausente`);
    assert.ok('join' in cap.validator_dispatch, `host ${host}: join ausente`);
    assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator', `host ${host}`);
  }
});

test('detectHost: opencode via TALOS_HOST injetado pelo packaging', () => {
  const r = detectHost({}, { TALOS_HOST: 'opencode' });
  assert.equal(r.host, 'opencode');
  assert.equal(r.detected_via, 'env:TALOS_HOST');
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
  assert.match(cap.subagent_dispatch.registration, /CODEX_HOME\/agents/);
  assert.match(cap.subagent_dispatch.registration, /init codex/);
  assert.doesNotMatch(cap.subagent_dispatch.example, /\$talos/);
  assert.equal(cap.capabilities_flags.subagent_available, true);
  assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator');
  assert.equal(cap.validator_dispatch.required_agent_type, 'talos-task-validator');
  assert.equal(cap.validator_dispatch.required_codex_model, undefined);
  assert.equal(cap.validator_dispatch.required_codex_model_reasoning_effort, undefined);
});

test('checkPrerequisites: opencode qualificado passa', () => {
  assert.equal(checkPrerequisites({ host: 'opencode' }).status, 'passed');
});

test('HOST_NAMES inclui opencode', () => {
  assert.ok(HOST_NAMES.includes('opencode'));
});

test('detectHost: pi via TALOS_HOST injetado pela config do pi-mcp-adapter', () => {
  const r = detectHost({}, { TALOS_HOST: 'pi' });
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

test('capabilities: perfil zcode declara fallback de subagente (limitação do host, v0.11.0)', () => {
  const cap = capabilities({ host: 'zcode' });
  assert.equal(cap.host, 'zcode');
  const fb = cap.subagent_dispatch.fallback;
  assert.ok(fb, 'zcode deve ter subagent_dispatch.fallback');
  assert.equal(fb.enabled, true);
  assert.equal(fb.subagent_type, 'general-purpose');
  assert.equal(fb.reason, 'plugin_subagents_do_not_inherit_mcp');
  assert.ok(typeof fb.prompt_template === 'string' && fb.prompt_template.length > 0);
  // O prompt_template referencia o agent .md canônico (fonte única) e ZCODE_PLUGIN_ROOT.
  assert.match(fb.prompt_template, /agents\/<name>\.md/);
  assert.match(fb.prompt_template, /ZCODE_PLUGIN_ROOT/);
});

test('capabilities: hosts não-zcode NÃO declaram fallback (schema aditivo, sem regressão)', () => {
  for (const h of ['claude', 'codex', 'opencode', 'pi', 'antigravity', 'generic']) {
    const sd = capabilities({ host: h }).subagent_dispatch;
    const fb = sd.fallback;
    assert.ok(!fb || fb.enabled !== true, `${h} não deve ter fallback.enabled:true (regressão de adapter)`);
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

test('detectHost: antigravity via TALOS_HOST injetado pelo mcp_config.json', () => {
  const r = detectHost({}, { TALOS_HOST: 'antigravity' });
  assert.equal(r.host, 'antigravity');
  assert.equal(r.detected_via, 'env:TALOS_HOST');
});

test('capabilities: perfil antigravity (subagente define_subagent/invoke_subagent, mcp nativo, sem todo, self_evident)', () => {
  const cap = capabilities({ host: 'antigravity' });
  assert.equal(cap.host, 'antigravity');
  assert.equal(cap.host_label, 'Antigravity');
  assert.match(cap.subagent_dispatch.mechanism, /define_subagent.*invoke_subagent/);
  assert.equal(cap.subagent_dispatch.skill_loading, 'embed_in_system_prompt');
  assert.equal(cap.validator_dispatch.dispatcher, 'orchestrator');
  assert.equal(cap.validator_dispatch.join.sync, 'self_evident');
  assert.equal(cap.todo_tool, null);
  assert.equal(cap.capabilities_flags.subagent_available, true);
  assert.equal(cap.capabilities_flags.mcp_available, true);
  assert.equal(cap.capabilities_flags.todo_available, false);
  // host nativo (subagente+MCP nativos) → self_evident, não exige host_capabilities
  assert.equal(cap.prereq_policy, 'self_evident');
  assert.deepEqual(cap.required_deps, []);
  // question_prompt: ask_question nativo + retomada automática pós-entrevista
  assert.equal(cap.question_prompt.mechanism, 'ask_question');
  assert.equal(cap.question_prompt.resume_after_interview, 'automatic');
});


test('checkPrerequisites: antigravity (self_evident) passa sem report — host nativo', () => {
  assert.equal(checkPrerequisites({ host: 'antigravity' }).status, 'passed');
});

test('HOST_NAMES inclui antigravity', () => {
  assert.ok(HOST_NAMES.includes('antigravity'));
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
    host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: true, dispatch_mutable: true },
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
    host_capabilities: { subagent_available: true, mcp_available: true, join_sync_available: true, dispatch_mutable: true },
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

// ── Gate DISPATCH_CAPABILITY (DEC-008) ─────────────────────────────────────

test('checkDispatchCapability: modo audit passa independente de dispatch_capability', () => {
  // Modos read-only (audit, interview-only) não exigem mutação.
  for (const host of ['zcode', 'claude', 'generic']) {
    const r = checkDispatchCapability({ host }, 'audit');
    assert.equal(r.status, 'passed', `host ${host} audit`);
    assert.equal(r.reason, 'modo_readonly_nao_exige_mutacao');
  }
});

test('checkDispatchCapability: modo interview-only passa independente de dispatch_capability', () => {
  for (const mode of ['interview-only', 'interview_only']) {
    const r = checkDispatchCapability({ host: 'zcode' }, mode);
    assert.equal(r.status, 'passed');
    assert.equal(r.reason, 'modo_readonly_nao_exige_mutacao');
  }
});

test('checkDispatchCapability: host mutable (claude/codex/opencode) passa para modos de execução', () => {
  for (const host of ['claude', 'codex', 'opencode']) {
    for (const mode of ['full', 'direct', 'execute']) {
      const r = checkDispatchCapability({ host }, mode);
      assert.equal(r.status, 'passed', `host ${host} mode ${mode}`);
      assert.equal(r.capability, 'mutable');
    }
  }
});

test('checkDispatchCapability: host unknown (zcode) sem dispatch_mutable → blocked para execução', () => {
  for (const mode of ['full', 'direct', 'execute']) {
    const r = checkDispatchCapability({ host: 'zcode' }, mode);
    assert.equal(r.status, 'blocked', `zcode ${mode}`);
    assert.equal(r.capability, 'unknown');
    assert.equal(r.cause, 'dispatch_capability_nao_verificada');
    assert.ok(r.next_action.includes('dispatch_mutable'), `next_action deve mencionar dispatch_mutable: ${r.next_action}`);
  }
});

test('checkDispatchCapability: host unknown (zcode) com dispatch_mutable:true → passa', () => {
  for (const mode of ['full', 'direct', 'execute']) {
    const r = checkDispatchCapability(
      { host: 'zcode', host_capabilities: { dispatch_mutable: true } },
      mode,
    );
    assert.equal(r.status, 'passed', `zcode ${mode} com dispatch_mutable`);
    assert.equal(r.capability, 'reported_mutable');
    assert.equal(r.reported, true);
  }
});

test('checkDispatchCapability: nenhum host atual declara readonly', () => {
  // Branch readonly fica reservada para adapter futuro; hoje nenhum host deve cair nela.
  for (const host of HOST_NAMES) {
    assert.notEqual(capabilities({ host }).dispatch_capability, 'readonly', `host ${host}`);
  }
});

test('checkDispatchCapability: generic/pi unknown sem report → blocked', () => {
  for (const host of ['generic', 'pi']) {
    const r = checkDispatchCapability({ host }, 'execute');
    assert.equal(r.status, 'blocked', `host ${host}`);
    assert.equal(r.capability, 'unknown');
    assert.equal(r.cause, 'dispatch_capability_nao_verificada');
  }
});

test('checkDispatchCapability: generic/pi unknown com dispatch_mutable:true → passa', () => {
  for (const host of ['generic', 'pi']) {
    const r = checkDispatchCapability(
      { host, host_capabilities: { dispatch_mutable: true } },
      'execute',
    );
    assert.equal(r.status, 'passed', `host ${host}`);
    assert.equal(r.capability, 'reported_mutable');
  }
});

test('checkDispatchCapability: dispatch_mutable não-booleano → ignorado (fail-closed)', () => {
  // Apenas === true é aceito; strings ou números são ignorados.
  for (const nonBool of ['true', 1, null]) {
    const r = checkDispatchCapability(
      { host: 'zcode', host_capabilities: { dispatch_mutable: nonBool } },
      'execute',
    );
    assert.equal(r.status, 'blocked', `dispatch_mutable=${JSON.stringify(nonBool)} deveria ser blocked`);
  }
});

test('preflight: gate DISPATCH — zcode modo execute sem dispatch_mutable → blocked', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rdispatch-zcode-fail', project_root: root, mode: 'execute',
    host: 'zcode', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.gate, 'DISPATCH');
  assert.equal(r.dispatch_capability, 'unknown');
  assert.equal(r.cause, 'dispatch_capability_nao_verificada');
  assert.ok(r.next_action.includes('dispatch_mutable'));
});

test('preflight: gate DISPATCH — zcode modo audit passa (read-only, sem mutação)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rdispatch-zcode-audit', project_root: root, mode: 'audit',
    host: 'zcode',
  });
  assert.equal(r.status, 'passed');
});

test('preflight: gate DISPATCH — zcode modo execute com dispatch_mutable:true → passa', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rdispatch-zcode-ok', project_root: root, mode: 'execute',
    host: 'zcode',
    host_capabilities: { subagent_available: true, mcp_available: true, dispatch_mutable: true },
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.routing.dispatch_capability, 'reported_mutable');
});

test('preflight: gate DISPATCH — claude modo execute passa (mutable)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rdispatch-claude-ok', project_root: root, mode: 'execute',
    host: 'claude',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.routing.dispatch_capability, 'mutable');
});

test('preflight: ordem determinística — DISPATCH após JOIN', () => {
  const root = tmpRoot();
  // JOIN bloqueia antes de DISPATCH (pi sem join_sync_available).
  const r = preflight({
    run_id: 'rdispatch-order', project_root: root, mode: 'execute',
    host: 'pi', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.gate, 'JOIN', 'JOIN deve preceder DISPATCH');
});

test('preflight: gate DISPATCH — pi com prereq+join+dispatch → passa', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rdispatch-pi-ok', project_root: root, mode: 'execute',
    host: 'pi',
    host_capabilities: {
      subagent_available: true, mcp_available: true,
      join_sync_available: true,
      dispatch_mutable: true,
    },
  });
  assert.equal(r.status, 'passed');
});

test('capabilities: dispatch_capability declarado em todos os hosts', () => {
  for (const host of HOST_NAMES) {
    const cap = capabilities({ host });
    assert.ok(['mutable', 'unknown', 'readonly'].includes(cap.dispatch_capability),
      `host ${host}: dispatch_capability=${cap.dispatch_capability} inválido`);
  }
  assert.equal(capabilities({ host: 'claude' }).dispatch_capability, 'mutable');
  assert.equal(capabilities({ host: 'codex' }).dispatch_capability, 'mutable');
  assert.equal(capabilities({ host: 'opencode' }).dispatch_capability, 'mutable');
  assert.equal(capabilities({ host: 'zcode' }).dispatch_capability, 'unknown');
  assert.equal(capabilities({ host: 'antigravity' }).dispatch_capability, 'unknown');
  assert.equal(capabilities({ host: 'pi' }).dispatch_capability, 'unknown');
  assert.equal(capabilities({ host: 'generic' }).dispatch_capability, 'unknown');
});

// ── Slice A: modo execute, classify_input, routing, guarantee_level ──────────

test('WORKFLOW_CONFIG: modo execute presente; audit e interview-only/interview_only mantidos (T01)', () => {
  assert.ok(WORKFLOW_CONFIG.modes.includes('execute'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('full'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('direct'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('audit'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('interview-only'));
  assert.ok(WORKFLOW_CONFIG.modes.includes('interview_only'));
  assert.ok(!WORKFLOW_CONFIG.modes.includes('plan'));
  assert.equal(WORKFLOW_CONFIG.skills.backlog_generator, 'talos-backlog-generator');
  assert.equal(WORKFLOW_CONFIG.skills.audit, 'talos-audit');
});

test('documentFlowForRouting: macro input prioriza backlog antes de sprint/plano', () => {
  const full = documentFlowForRouting('full', 'idea');
  assert.equal(full.priority, 'backlog_first');
  assert.deepEqual(full.skills, [
    'talos-backlog-generator',
    'talos-sprint-interview',
    'talos-plan-handoff',
  ]);
  assert.deepEqual(full.artifacts, ['BACKLOG_MESTRE_*.md', 'SPRINT_S<NN>_*.md', 'PLAN_*.md']);
  assert.ok(!full.skills.includes('talos-sprint-prd-generator'));
  assert.ok(!full.artifacts.includes('PRD_*.md'));

  const direct = documentFlowForRouting('direct', 'roadmap');
  assert.equal(direct.priority, 'backlog_first');
  assert.deepEqual(direct.skills, [
    'talos-backlog-generator',
    'talos-sprint-interview',
  ]);
  assert.ok(!direct.artifacts.includes('PRD_*.md'));
});

test('documentFlowForRouting: backlog existente preserva execução pequena por sprint', () => {
  const flow = documentFlowForRouting('full', 'backlog-item', 'backlog');
  assert.equal(flow.priority, 'sprint_from_backlog');
  assert.ok(!flow.skills.includes('talos-backlog-generator'));
  assert.deepEqual(flow.artifacts, ['SPRINT_S<NN>_*.md', 'PLAN_*.md']);
  assert.ok(flow.skills.includes('talos-sprint-interview'));
  assert.ok(!flow.artifacts.includes('PRD_*.md'));
});

test('documentFlowForRouting: input sprint é alias estrito de backlog-item', () => {
  const full = documentFlowForRouting('full', 'sprint');
  assert.equal(full.priority, 'sprint_from_backlog');
  assert.ok(!full.skills.includes('talos-backlog-generator'));
  assert.deepEqual(full.artifacts, ['SPRINT_S<NN>_*.md', 'PLAN_*.md']);

  const direct = documentFlowForRouting('direct', 'sprint');
  assert.equal(direct.priority, 'sprint_from_backlog');
  assert.ok(!direct.skills.includes('talos-backlog-generator'));
  assert.deepEqual(direct.artifacts, ['SPRINT_S<NN>_*.md']);
});

test('documentFlowForRouting: fallback é recorte_first sem PRD (AC-3.1.3/3.1.4)', () => {
  const flow = documentFlowForRouting('full', 'plan');
  assert.equal(flow.priority, 'recorte_first');
  assert.ok(flow.skills.includes('talos-sprint-interview'));
  assert.ok(!flow.skills.includes('talos-sprint-prd-generator'));
  assert.ok(!flow.artifacts.includes('PRD_*.md'));
  assert.notEqual(flow.priority, 'prd_first');
});

test('expectedNextPhase: execute → plan_execute sem regredir full/direct/interview (T02)', () => {
  assert.equal(expectedNextPhase({ mode: 'execute' }, {}), 'plan_execute');
  assert.equal(expectedNextPhase({ mode: 'full' }, {}), 'plan_handoff');
  assert.equal(expectedNextPhase({ mode: 'direct' }, {}), 'plan_execute');
  assert.equal(expectedNextPhase({ mode: 'interview-only' }, {}), 'sprint_interview');
  assert.equal(expectedNextPhase({ mode: 'audit' }, {}), 'audit_report');
  // next_phase explícito do dispatch sempre prevalece
  assert.equal(expectedNextPhase({ mode: 'execute' }, { next_phase: 'slice_review' }), 'slice_review');
});

test('matriz modo → executor preserva phase plan_execute compartilhada (Etapa 1 T01)', () => {
  assert.equal(expectedExecutorSkill('full'), 'talos-plan-execute');
  assert.equal(expectedExecutorSkill('execute'), 'talos-plan-execute');
  assert.equal(expectedExecutorSkill('direct'), 'talos-direct-execute');
  assert.equal(expectedExecutorSkill('interview-only'), null);
  assert.equal(expectedExecutorSkill('audit'), null);
  for (const mode of ['direct', 'execute']) {
    assert.equal(expectedNextPhase({ mode }, {}), 'plan_execute');
  }
});

test('talos_preflight materializa executor efetivo por modo sem alterar phase/FSM (Etapa 1 T01)', () => {
  for (const [mode, executor] of [
    ['full', 'talos-plan-execute'],
    ['direct', 'talos-direct-execute'],
    ['execute', 'talos-plan-execute'],
  ]) {
    const result = preflight({
      run_id: `route-${mode}`,
      project_root: tmpRoot(),
      mode,
      host: 'codex',
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.routing.executor_skill, executor);
    assert.equal(expectedNextPhase(result.routing, {}), mode === 'full' ? 'plan_handoff' : 'plan_execute');
  }
});

test('talos_preflight materializa document_flow backlog_first para macro input', () => {
  const result = preflight({
    run_id: 'route-full-idea-backlog-first',
    project_root: tmpRoot(),
    mode: 'full',
    input_type: 'idea',
    artifact_type: 'idea',
    host: 'codex',
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.routing.document_flow.priority, 'backlog_first');
  assert.equal(result.routing.document_flow.skills[0], 'talos-backlog-generator');
  assert.equal(expectedNextPhase(result.routing, {}), 'plan_handoff');
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
  assert.equal(guaranteeLevelForMode('audit'), null);
  assert.equal(guaranteeLevelForMode('desconhecido'), null);
});

test('talos_preflight: audit passa sem executor/guarantee_level e expõe talos-audit', () => {
  const result = preflight({
    run_id: 'route-audit',
    project_root: tmpRoot(),
    mode: 'audit',
    host: 'codex',
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.routing.executor_skill, undefined);
  assert.equal(result.routing.guarantee_level, undefined);
  assert.equal(result.routing.skills.audit, 'talos-audit');
  assert.equal(expectedNextPhase(result.routing, {}), 'audit_report');
});

// Fixture de plano conforme o template canônico (verifyPlanConformance → 0 pendências).
const CONFORMANT_PLAN = [
  '# Documento qualquer',
  '',
  '| Campo | Valor |',
  '|-------|-------|',
  '| **Sprint file** | [SPRINT_S01_runtime.md](./SPRINT_S01_runtime.md) — `eval_manifest` §9 |',
  '',
  'Política: [BOUNDARY_SPRINT_PLAN.md](./TEMPLATES/BOUNDARY_SPRINT_PLAN.md).',
  '',
  '## 1. Tradução executiva',
  '## 2. Invariantes de execução',
  '## 3. Pitfalls',
  '## 4. Estado na abertura da sprint',
  '## 5. Tarefas de execução',
  '#### T01. Primeira tarefa',
  '- **Eval/Policy:** Sprint §9 EVAL-001 / Sprint §10 policy_manifest',
  '## 6. Contratos técnicos',
  '## 7. Slices',
  '## 8. Validação e checklist',
  '',
].join('\n');

test('contrato interview-only: TC rejeita artifact_type prd (AC-3.2.1)', () => {
  const root = tmpRoot();
  const runId = 'interview-only-tc-plan-only';
  preflight({ run_id: runId, project_root: root, mode: 'interview-only', host: 'codex' });
  const planPath = path.join(root, 'PLAN_BRAINSTORM.md');
  fs.writeFileSync(planPath, CONFORMANT_PLAN);
  assert.equal(verifyTemplateConformance({
    run_id: runId, project_root: root, artifact_path: planPath, artifact_type: 'plan',
  }).status, 'passed');
  assert.throws(
    () => verifyTemplateConformance({
      run_id: runId, project_root: root, artifact_path: planPath, artifact_type: 'prd',
    }),
    (err) => err?.code === -32602 || /artifact_type inválido/.test(String(err?.message ?? err)),
  );
});

test('classifyArtifactContent: plano renomeado (sem prefixo PLAN_) classifica como plan via verdade forte (T03)', () => {
  const r = classifyArtifactContent(CONFORMANT_PLAN, 'docs/algo_renomeado.md');
  assert.equal(r.artifact_type, 'plan');
  assert.equal(r.signal, 'template_conformance');
});

test('classifyArtifactContent: nome PLAN_*.md é só dica fraca, não verdade (T03)', () => {
  const r = classifyArtifactContent('# Nada relevante aqui\n\nconteúdo solto', 'PLAN_vazio.md');
  assert.equal(r.artifact_type, 'plan');
  assert.equal(r.signal, 'weak_name_hint');
});

test('classifyArtifactContent: PRD-ish classifica como idea (D9 / AC-3.1.4)', () => {
  const prd = '# PRD: algo\n\n## 3. Decisões de produto\n\n| ID | Decisão |\n|----|---------|\n| D1 | x |';
  const r = classifyArtifactContent(prd, 'docs/PRD_algo.md');
  assert.equal(r.artifact_type, 'idea');
  assert.equal(r.signal, 'spec_markers');
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

const BANNER_RE = /^▸ talos: /;

test('BANNER_TEMPLATES: banco tem exatamente os 11 eventos lógicos (T06 / AC-3.3.2)', () => {
  // 12 entradas: os 11 eventos do banco + a variante preflight ok/fail conta como
  // dois templates (preflight_ok/preflight_fail) e aceite como dois (aceite_ok/aceite_lacunas).
  const eventos = [
    'roteia', 'roteia_troca', 'preflight_ok', 'preflight_fail',
    'aceite_lacunas', 'aceite_ok', 'entrevista', 'plano', 'exec',
    'validacao', 'review', 'done',
  ];
  for (const ev of eventos) {
    assert.ok(Object.prototype.hasOwnProperty.call(BANNER_TEMPLATES, ev), `falta evento ${ev}`);
    assert.match(BANNER_TEMPLATES[ev], BANNER_RE, `template ${ev} sem prefixo canônico`);
  }
  assert.deepEqual(BANNER_EVENTS, eventos);
  assert.equal(BANNER_EVENTS.length, 12);
  assert.ok(!Object.prototype.hasOwnProperty.call(BANNER_TEMPLATES, 'prd_ok'));
  assert.ok(!Object.prototype.hasOwnProperty.call(BANNER_TEMPLATES, 'prd_lacunas'));
});

test('renderBanner: preenche slots e devolve string pt-BR canônica (T06 / AC-3.3.3)', () => {
  assert.equal(
    renderBanner('roteia', { tipo: 'plan', modo: 'execute' }),
    '▸ talos: roteamento · input=plan → modo=execute',
  );
  assert.equal(
    renderBanner('roteia_troca', { x: 'direct', y: 'plan', z: 'execute' }),
    '▸ talos: roteamento · pediu=direct mas input=plan → modo=execute',
  );
  assert.equal(renderBanner('preflight_ok', { caps: 'subagent+mcp' }), '▸ talos: preflight · ok (subagent+mcp)');
  assert.equal(renderBanner('preflight_fail', { motivo: 'x' }), '▸ talos: preflight · BLOCK · x');
  assert.equal(renderBanner('aceite_lacunas', { n: 3 }), '▸ talos: aceite · 3 lacunas');
  assert.equal(renderBanner('aceite_ok', {}), '▸ talos: aceite · ok');
  assert.equal(renderBanner('exec', { i: 2, n: 5 }), '▸ talos: exec · slice 2/5');
  assert.equal(renderBanner('validacao', { status: 'pass' }), '▸ talos: validação · pass');
  assert.equal(renderBanner('review', { status: 'ok' }), '▸ talos: review · ok');
  assert.equal(renderBanner('done', { resumo: 'feito' }), '▸ talos: done · feito');
});

test('renderBanner: evento desconhecido lança (T06)', () => {
  assert.throws(() => renderBanner('inexistente', {}), /Evento de banner desconhecido/);
});

// Fixtures e helper de isolamento por temp dir (project_root).
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-sliceB-'));
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
  '| **Sprint file** | [SPRINT_S01_runtime.md](./SPRINT_S01_runtime.md) — `eval_manifest` §9 |',
  '',
  'Política: [BOUNDARY_SPRINT_PLAN.md](./TEMPLATES/BOUNDARY_SPRINT_PLAN.md).',
  '',
  '## 1. Tradução executiva',
  '## 2. Invariantes de execução',
  '## 3. Pitfalls',
  '## 4. Estado na abertura da sprint',
  '## 5. Tarefas de execução',
  '#### T01. Primeira tarefa',
  '- **Eval/Policy:** Sprint §9 EVAL-001 / Sprint §10 policy_manifest',
  '## 6. Contratos técnicos',
  '## 7. Slices',
  '## 8. Validação e checklist',
  '',
].join('\n');

const STRICT_PRD_DOC = [
  '# PRD: sprint runtime',
  '',
  '| Campo | Valor |',
  '|-------|-------|',
  '| **Status** | Aprovado para implementação |',
  '| **Sprint file** | [SPRINT_S01_runtime.md](./SPRINT_S01_runtime.md#9-eval-manifest) |',
  '',
  '- Eval source: `SPRINT_S01_runtime.md §9 eval_manifest`',
  '',
  '## 1. Contexto e objetivo',
  'Objetivo.',
  '## 2. Escopo',
  'Escopo.',
  '## 3. Decisões de produto',
  '| ID | Decisão |',
  '|---|---|',
  '| D1 | Fechado |',
  '## 4. Fluxos e cenários UX',
  'Fluxo.',
  '## 5. Contrato funcional e invariantes',
  'Contrato.',
  '## 6. Critérios de aceite',
  '**Produto**',
  '- [ ] EVAL-001 comprovado.',
  '**UX**',
  '- [ ] Fluxo ok.',
  '**Dados**',
  '- [ ] Dados ok.',
  '**Regressão de produto**',
  '- [ ] Regressão ok.',
  '',
].join('\n');

function sprintDoc({
  id = 'S01',
  evalId = id,
  includeEval = true,
  backlog = 'BACKLOG.md#S01',
  status = 'ready',
  dorStatus = null,
  contratoStatus = 'draft',
  includeContrato = true,
  omitDecisions = false,
  omitAceiteBlock = false,
  /** "manual" = AC com M (valida manual); null = omitir bloco acceptance */
  omitAcceptance = null,
  /** undefined = auto-selo quando aprovado; null = omitir campo; string = valor literal */
  selo = undefined,
  /** v0.16.0: prioridade da §1 usada pelo bloqueio de `premissa` (D4) */
  moscow = 'Must',
  prioridade = 'P0',
  /** v0.16.0: procedência da linha D1 da §7.1 e dos ACs da §7.3 */
  decisionOrigin = 'usuario',
  acceptanceOrigin = 'usuario',
  /** v0.16.0 (CN6): célula `Fonte` da linha `Discussão` da §4; `null` omite a linha */
  discussao = '.app-work/brainstorming/runtime-harness/BRAINSTORM.md',
} = {}) {
  const acceptanceBlock = omitAceiteBlock ? [] : [
    '### 7.3 Aceite binário',
    '```yaml',
    'acceptance:',
    '  - id: AC-001',
    `    origin: "${acceptanceOrigin}"`,
    '    behavior: "Gate observável passa quando AC válido"',
    '    decisions: [D1]',
    '    scenario: "Carregar harness"',
    '    evals: [EVAL-001]',
    '    evidence:',
    '      required: [I, T-outcome, W]',
    '      manual: null',
    '  - id: AC-002',
    `    origin: "${acceptanceOrigin}"`,
    '    behavior: "Parser antigo preservado após mudança"',
    '    decisions: [D1]',
    '    scenario: "Regressão de produto"',
    '    evals: [EVAL-001]',
    '    evidence:',
    '      required: [I, T-outcome]',
    '      manual: null',
    '```',
  ];
  const contratoBlock = includeContrato ? [
    '## 7. Contrato de produto (congelado)',
    '### 7.1 Decisões de produto (D*)',
    '| ID | Decisão | Origem |',
    '|---|---|---|',
    ...(omitDecisions ? [] : [`| D1 | Runtime harness entrega gate observável | ${decisionOrigin} |`]),
    '### 7.2 Cenários UX',
    '### 7.2.1 Carregar harness',
    '- **Entrada:** operador abre o harness',
    '- **Comportamento:** loading / vazio / erro',
    '- **Sucesso:** gate passa',
    ...acceptanceBlock,
  ] : [
    '## 7. Contrato de produto (congelado)',
    'sem contrato',
  ];
  const sealMeta = [];
  if (selo === null) {
    // omitir campo (AC-2.1.3)
  } else if (typeof selo === 'string') {
    sealMeta.push(`| Selo do contrato | ${selo} |`);
  } else if (contratoStatus !== 'aprovado') {
    sealMeta.push('| Selo do contrato | pendente até aprovação |');
  }
  let doc = [
    `# Sprint viva — ${id} — Runtime harness`,
    '',
    '## 1. Metadados',
    '| Campo | Valor |',
    '|---|---|',
    `| Sprint ID | ${id} |`,
    '| Nome | Runtime harness |',
    `| Status | ${status} |`,
    `| Backlog mestre | ${backlog} |`,
    `| Contrato status | ${contratoStatus} |`,
    ...sealMeta,
    '| PRD | pendente |',
    '| PLAN | pendente |',
    '| State / evidência | pendente |',
    '| Revalidação | false |',
    `| Fase | F0 |`,
    `| MoSCoW | ${moscow} |`,
    `| Prioridade | ${prioridade} |`,
    '| Responsável | Talos |',
    '| Criado em | 2026-06-29 |',
    '| Última atualização | 2026-06-29 |',
    '',
    '## 2. Objetivo e valor',
    'Objetivo único.',
    '## 3. Escopo da sprint',
    '- [ ] Entrega',
    '## 4. Contexto e fontes',
    '| Tipo | Fonte | Uso nesta sprint |',
    '|---|---|---|',
    '| Backlog | BACKLOG.md#S01 | escopo |',
    ...(discussao === null ? [] : [`| Discussão | ${discussao} | decisão/contexto |`]),
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
    ...(dorStatus ? [`**Status DoR:** ${dorStatus}`] : []),
    '## 9. Eval manifest',
    ...(includeEval ? [
      '```yaml',
      'eval_manifest:',
      `  sprint_id: "${evalId}"`,
      '  objective: "runtime harness"',
      '  must_prove:',
      '    - id: "EVAL-001"',
      '      claim: "gate passa"',
      '      source: "SPRINT"',
      '      evidence_required: "node --test"',
      '  regression_guards:',
      '    - "parser antigo preservado"',
      '  negative_paths:',
      '    - "manifest ausente falha"',
      '```',
    ] : ['sem manifest']),
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
    '| gate passa | sprint | node --test | pendente | pending |',
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
    '| técnico | nada | S02 | registrar |',
    '## 16. Histórico',
    '| Data | Autor | Mudança |',
    '|---|---|---|',
    '| 2026-06-29 | Talos | Criação |',
  ].join('\n');
  if (contratoStatus === 'aprovado' && selo === undefined) {
    const computed = computeAcceptanceSeal(doc);
    doc = doc.replace(
      `| Contrato status | ${contratoStatus} |`,
      `| Contrato status | ${contratoStatus} |\n| Selo do contrato | ${computed} |`,
    );
  }
  return doc;
}

const BACKLOG_WITH_SPRINT_FILE = [
  '## 7. Registro de sprints',
  '| ID | Sprint | Fase-fonte | Objetivo (1 linha) | MoSCoW | Ganho | Esforço | Prioridade | PRD | Depende de | Estado | Gate | Sprint file | PLAN | State |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | backlog | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | PLAN_S01.md | .talos/state/S01.json |',
  '',
].join('\n');

test('talos_verify_artifact: gate retorna banner não-vazio (passed → plano) (T07)', () => {
  const root = tmpRoot();
  const file = path.join(root, 'PLAN_x.md');
  fs.writeFileSync(file, CONFORMANT_PLAN_DOC);
  const r = verifyArtifact({ run_id: 'r1', project_root: root, artifact_path: 'PLAN_x.md' });
  assert.equal(r.status, 'passed');
  assert.match(r.banner, BANNER_RE);
  assert.equal(r.banner, '▸ talos: plano · validado (TC pass)');
});

test('talos_verify_artifact: ausente → banner de BLOCK não-vazio (T07)', () => {
  const root = tmpRoot();
  const r = verifyArtifact({ run_id: 'r1', project_root: root, artifact_path: 'nao_existe.md' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ talos: preflight · BLOCK · /);
});

test('talos_scan_acceptance: 0 bloqueantes na §7 → banner aceite · ok (AC-3.3.1)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT.md'), sprintDoc({ contratoStatus: 'draft' }));
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.banner, '▸ talos: aceite · ok');
  assert.equal(r.sprint_path, 'SPRINT.md');
});

test('talos_scan_acceptance: sprint vazio → banner aceite · {n} lacunas (AC-3.3.1)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT.md'), '   ');
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT.md' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ talos: aceite · \d+ lacunas$/);
});

test('talos_scan_acceptance: ambiguidade TBD na §7 bloqueia (AC-3.3.1)', () => {
  const root = tmpRoot();
  const ambiguous = sprintDoc().replace(
    '| D1 | Runtime harness entrega gate observável | usuario |',
    '| D1 | Runtime harness TBD a confirmar | usuario |',
  );
  fs.writeFileSync(path.join(root, 'SPRINT.md'), ambiguous);
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.blocking_count >= 1);
  assert.match(r.banner, /^▸ talos: aceite · \d+ lacunas$/);
});

test('talos_scan_acceptance: behavior de AC com TBD bloqueia (AC-1.2.2)', () => {
  const root = tmpRoot();
  const ambiguous = sprintDoc().replace(
    'behavior: "Gate observável passa quando AC válido"',
    'behavior: "Gate observável TBD a confirmar"',
  );
  fs.writeFileSync(path.join(root, 'SPRINT.md'), ambiguous);
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.blocking_count >= 1);
  assert.ok(r.blocking_matches.some((m) => /behavior ambíguo/.test(m.pattern)));
});

test('talos_scan_acceptance: AC válido sem TBD passa (AC-1.2.2 contraprova)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT.md'), sprintDoc({ contratoStatus: 'draft' }));
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT.md' });
  assert.equal(r.status, 'passed');
  assert.ok(!r.blocking_matches.some((m) => /behavior ambíguo/.test(m.pattern)));
});

test('talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)', () => {
  const root = tmpRoot();
  const ambiguous = sprintDoc().replace(
    'behavior: "Gate observável passa quando AC válido"',
    'behavior: "Gate observável TBD a confirmar"',
  );
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_markdown: ambiguous });
  assert.equal(r.status, 'blocked');
  assert.equal(r.source, 'draft');
  assert.equal(r.sprint_path, null);
  assert.ok(r.blocking_count >= 1);
  assert.ok(r.blocking_matches.some((m) => /behavior ambíguo/.test(m.pattern)));
  // O rascunho não foi persistido em disco: nenhum sprint file nasce da chamada.
  assert.ok(!fs.existsSync(path.join(root, 'SPRINT.md')), 'scan de rascunho não deve gravar arquivo');
  // Contraprova: rascunho sem padrão bloqueante passa, ainda em memória.
  const clean = scanAcceptance({ run_id: 'r1', project_root: root, sprint_markdown: sprintDoc({ contratoStatus: 'draft' }) });
  assert.equal(clean.status, 'passed');
  assert.equal(clean.source, 'draft');
  assert.equal(clean.sprint_path, null);
  // Rascunho vazio: mesma pendência de arquivo vazio do caminho por path
  // (`blocking_count: 1`), com `source: 'draft'` — comportamento declarado na
  // task 02.2 ("Rascunho vazio") e coberto por este AC.
  const vazio = scanAcceptance({ run_id: 'r1', project_root: root, sprint_markdown: '' });
  assert.equal(vazio.status, 'blocked');
  assert.equal(vazio.blocking_count, 1);
  assert.equal(vazio.source, 'draft');
  assert.equal(vazio.blocking_matches[0].pattern, '(empty file)');
});

test('talos_scan_acceptance: sprint_path continua lendo o arquivo com source file (AC-02.2.2)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT.md'), sprintDoc({ contratoStatus: 'draft' }));
  const r = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.source, 'file');
  assert.equal(r.sprint_path, 'SPRINT.md');
  // Path com ambiguidade segue bloqueando pelo mesmo payload de hoje + source.
  const ambiguous = sprintDoc().replace(
    '| D1 | Runtime harness entrega gate observável | usuario |',
    '| D1 | Runtime harness TBD a confirmar | usuario |',
  );
  fs.writeFileSync(path.join(root, 'SPRINT_AMB.md'), ambiguous);
  const blocked = scanAcceptance({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT_AMB.md' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.source, 'file');
  assert.ok(blocked.blocking_count >= 1);
});

test('talos_scan_acceptance: sprint_path e sprint_markdown juntos → erro de uso (AC-02.2.3)', () => {
  const root = tmpRoot();
  const r = scanAcceptance({
    run_id: 'r1',
    project_root: root,
    sprint_path: 'SPRINT.md',
    sprint_markdown: '# rascunho',
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.next_action, 'usar_um_dos_dois');
  assert.match(r.error, /exatamente um/);
  // Nenhum dos dois conteúdos foi escaneado: o chamador sabe que a chamada é inválida.
  assert.equal(r.blocking_matches[0].pattern, '(sprint_path e sprint_markdown juntos)');
  // Nem um nem outro: o erro de argumento obrigatório existente permanece.
  assert.throws(
    () => scanAcceptance({ run_id: 'r1', project_root: root }),
    /sprint_path obrigatório/,
  );
});

test('talos_verify_template_conformance: plano conforme → banner plano (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PLAN_x.md'), CONFORMANT_PLAN_DOC);
  const r = verifyTemplateConformance({ run_id: 'r1', project_root: root, artifact_path: 'PLAN_x.md', artifact_type: 'plan' });
  assert.equal(r.status, 'passed');
  assert.equal(r.banner, '▸ talos: plano · validado (TC pass)');
});

test('talos_verify_template_conformance: modo sprint exige Sprint file/EVAL no PLAN (AC-3.2.2/3.2.3)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PLAN_ok.md'), CONFORMANT_PLAN_DOC);
  assert.equal(verifyTemplateConformance({
    run_id: 'r1', project_root: root, artifact_path: 'PLAN_ok.md', artifact_type: 'plan',
    require_sprint_file: true,
  }).status, 'passed');

  assert.throws(
    () => verifyTemplateConformance({
      run_id: 'r1', project_root: root, artifact_path: 'PLAN_ok.md', artifact_type: 'prd',
    }),
    (err) => err?.code === -32602 || /artifact_type inválido/.test(String(err?.message ?? err)),
  );

  fs.writeFileSync(path.join(root, 'PLAN_sem_sprint.md'), CONFORMANT_PLAN_DOC.replace(/\| \*\*Sprint file\*\*.*\n/, ''));
  const planNoSprint = verifyTemplateConformance({
    run_id: 'r1', project_root: root, artifact_path: 'PLAN_sem_sprint.md', artifact_type: 'plan',
  });
  assert.equal(planNoSprint.status, 'blocked');
  assert.ok(planNoSprint.pendencies.some((p) => p.category === 'sprint_file'));

  fs.writeFileSync(path.join(root, 'PLAN_sem_eval.md'), CONFORMANT_PLAN_DOC.replace(/\| \*\*Sprint file\*\*.*\n/, '').replace(/- \*\*Eval\/Policy:\*\*.*\n/, '').replace(/EVAL-001/g, ''));
  const planBlocked = verifyTemplateConformance({
    run_id: 'r1', project_root: root, artifact_path: 'PLAN_sem_eval.md', artifact_type: 'plan',
    require_sprint_file: true,
  });
  assert.equal(planBlocked.status, 'blocked');
  assert.ok(planBlocked.pendencies.some((p) => p.category === 'sprint_file'));
});

test('talos_verify_template_conformance: plano não conforme → banner BLOCK (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'ruim.md'), '# nada\n\nconteúdo solto');
  const r = verifyTemplateConformance({ run_id: 'r1', project_root: root, artifact_path: 'ruim.md', artifact_type: 'plan' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ talos: preflight · BLOCK · /);
});

test('parseSprintRows: captura colunas novas sem quebrar legado', () => {
  const rows = parseSprintRows(BACKLOG_WITH_SPRINT_FILE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'S01');
  assert.equal(rows[0].state, 'backlog');
  assert.equal(rows[0].sprint_file, '`.talos/backlog/sprints/SPRINT_S01_runtime.md`');
  assert.equal(rows[0].plan, 'PLAN_S01.md');
  assert.equal(rows[0].state_file, '.talos/state/S01.json');
});

test('parseSprintRows: aceita sub-sprint decimal registrada no backlog', () => {
  const rows = parseSprintRows(BACKLOG_WITH_SPRINT_FILE.replaceAll('S01', 'S17.1'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'S17.1');
  assert.equal(rows[0].sprint_file, '`.talos/backlog/sprints/SPRINT_S17.1_runtime.md`');
});

test('talos_verify_sprint_file: válido passa com vínculo no backlog', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE);
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.pending_count, 0);
});

test('talos_verify_sprint_file: aceita sub-sprint decimal registrada', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  const backlog = BACKLOG_WITH_SPRINT_FILE.replaceAll('S01', 'S17.1');
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S17.1_runtime.md'), sprintDoc({ id: 'S17.1', evalId: 'S17.1', backlog: 'BACKLOG.md#S17.1' }));
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlog);
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S17.1_runtime.md',
    sprint_id: 'S17.1',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.pending_count, 0);
});

test('talos_verify_sprint_file: falta eval_manifest falha', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), sprintDoc({ includeEval: false }));
  const r = verifySprintFile({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT_S01.md', sprint_id: 'S01' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'eval_manifest'));
});

test('talos_verify_sprint_file: sprint_id divergente falha', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), sprintDoc());
  const r = verifySprintFile({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT_S01.md', sprint_id: 'S02' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.item === 'Sprint ID' || p.item === 'sprint_id'));
});

test('talos_verify_sprint_file: backlog link ausente falha', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), sprintDoc());
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE.replace('S01', 'S02'));
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: 'SPRINT_S01.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'backlog_link'));
});

test('SPRINT_TEMPLATE: §7 contrato congelado com 7.1/7.2/7.3 e YAML acceptance AC-* (AC-1.1.1)', () => {
  const template = fs.readFileSync(SPRINT_TEMPLATE_PATH, 'utf8');
  assert.match(template, /^## 7\. Contrato de produto \(congelado\)\s*$/m);
  assert.match(template, /^### 7\.1 Decisões de produto \(D\*\)\s*$/m);
  assert.match(template, /^### 7\.2 Cenários UX\s*$/m);
  assert.match(template, /^### 7\.3 Aceite binário\s*$/m);
  assert.match(template, /^```ya?ml\s*$/m);
  assert.match(template, /acceptance:\s*\n\s*-\s+id:\s+AC-\d+/m);
  assert.match(template, /evidence:\s*\n\s+required:/m);
  // LEG1 morto: nenhum dos 4 grupos checkbox como autoridade de aceite.
  assert.doesNotMatch(template, /\*\*Produto\*\*\s*\n\s*-\s*\[/);
  assert.doesNotMatch(template, /\*\*UX\*\*\s*\n\s*-\s*\[/);
  assert.doesNotMatch(template, /\*\*Dados\*\*\s*\n\s*-\s*\[/);
  assert.doesNotMatch(template, /\*\*Regressão de produto\*\*\s*\n\s*-\s*\[/);
});

test('SPRINT_TEMPLATE: §1 contém Contrato status (AC-1.1.2)', () => {
  const template = fs.readFileSync(SPRINT_TEMPLATE_PATH, 'utf8');
  assert.match(template, /^\|\s*Contrato status\s*\|\s*\[draft \/ aprovado\]\s*\|/m);
});

test('SPRINT_TEMPLATE: numeração 1–16 preservada; §9/§10/§12/§13/§16 intactas (AC-1.1.3)', () => {
  const template = fs.readFileSync(SPRINT_TEMPLATE_PATH, 'utf8');
  for (const heading of [
    '## 1. Metadados',
    '## 2. Objetivo e valor',
    '## 3. Escopo da sprint',
    '## 4. Contexto e fontes',
    '## 5. Dependências e bloqueios',
    '## 6. Decisões da sprint',
    '## 7. Contrato de produto (congelado)',
    '## 8. Definition of Ready',
    '## 9. Eval manifest',
    '## 10. Policy manifest',
    '## 11. Guia e sensores',
    '## 12. Evidence-to-claim',
    '## 13. PLAN',
    '## 14. Execução e validação',
    '## 15. Aprendizados e handoff para próximas sprints',
    '## 16. Histórico',
  ]) {
    assert.match(template, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'));
  }
  assert.doesNotMatch(template, /^## 7\. Critérios candidatos para PRD\s*$/m);
});

test('talos-sprint-interview SKILL: não exige 4 grupos checkbox como aceite §7.3; indexa AC-*/YAML acceptance (AC-1.1.3)', () => {
  const skill = fs.readFileSync(SPRINT_INTERVIEW_SKILL_PATH, 'utf8');
  // LEG1 morto: a obrigação dos 4 grupos como critério de aceite não existe mais.
  assert.ok(
    !/os 4 grupos \(Produto\/UX\/Dados\/Regressão\) devem existir/.test(skill),
    'SKILL ainda exige os 4 grupos checkbox como critério de §7.3',
  );
  assert.ok(
    !/§7\.3 Aceite binário.*\(Produto, UX, Dados, Regressão de produto\)/s.test(skill),
    'SKILL ainda descreve §7.3 como os 4 grupos',
  );
  // Critério explícito para AC-*/YAML acceptance presente.
  assert.match(skill, /AC-\*/);
  assert.match(skill, /YAML/);
  assert.match(skill, /acceptance/);
});

test('validateSprintFileConformance: contrato §7 completo → valid:true (AC-1.2.1)', () => {
  const r = validateSprintFileConformance(sprintDoc({ contratoStatus: 'draft' }));
  assert.equal(r.valid, true, `pendências: ${JSON.stringify(r.pendencies)}`);
  assert.equal(r.pending_count, 0);
});

test('validateSprintFileConformance: sem D* → pendência decisoes (AC-1.2.2)', () => {
  const r = validateSprintFileConformance(sprintDoc({ omitDecisions: true }));
  assert.equal(r.valid, false);
  assert.ok(r.pendencies.some((p) => p.category === 'contrato_produto' && p.item === 'decisoes'));
});

test('validateSprintFileConformance: EVAL órfão (sem AC) → pendência hierarquia AC⊃EVAL (AC-1.1.2)', () => {
  // Adiciona EVAL-999 ao eval_manifest sem nenhum AC o referenciando.
  const withOrphanEval = sprintDoc().replace(
    /(\s+must_prove:\n\s+- id: "EVAL-001"[\s\S]*?\n\s+negative_paths:[^\n]*\n)([\s\S]*?)```/,
    '$1    - id: "EVAL-999"\n      claim: "órfão"\n      source: "Sprint"\n      evidence_required: "teste"\n$2```',
  );
  const r = validateSprintFileConformance(withOrphanEval);
  assert.equal(r.valid, false);
  assert.ok(
    r.pendencies.some((p) => p.category === 'contrato_produto' && p.item === 'aceite' && /EVAL-999/.test(p.message)),
    `esperava pendência EVAL-999 órfão; obtido: ${JSON.stringify(r.pendencies)}`,
  );
});

test('validateSprintFileConformance: sem bloco acceptance → pendência aceite (AC-1.2.3)', () => {
  const r = validateSprintFileConformance(sprintDoc({ omitAceiteBlock: true }));
  assert.equal(r.valid, false);
  assert.ok(r.pendencies.some((p) => p.category === 'contrato_produto' && p.item === 'aceite'));
});

test('validateSprintFileConformance: standalone sem pendência de backlink (AC-1.2.4)', () => {
  const markdown = sprintDoc({ backlog: 'Não aplicável (standalone)' });
  const r = validateSprintFileConformance(markdown, {
    sprintPath: 'SPRINT_S01_standalone.md',
    sprintId: 'S01',
    backlogPath: 'BACKLOG.md',
    backlogMarkdown: BACKLOG_WITH_SPRINT_FILE.replace('S01', 'S99'),
  });
  assert.equal(r.valid, true);
  assert.ok(!r.pendencies.some((p) => p.category === 'backlog_link'));
  assert.ok(!r.pendencies.some((p) => p.item === 'Backlog mestre'));
});

test('validateSprintFileConformance: manifests e evidence-to-claim preservados (AC-1.2.5)', () => {
  const withoutEval = validateSprintFileConformance(sprintDoc({ includeEval: false }));
  assert.ok(withoutEval.pendencies.some((p) => p.category === 'eval_manifest'));

  const withoutPolicy = validateSprintFileConformance(
    sprintDoc().replace(/```yaml\npolicy_manifest:[\s\S]*?```/, 'sem policy'),
  );
  assert.ok(withoutPolicy.pendencies.some((p) => p.category === 'policy_manifest'));

  const withoutEvidence = validateSprintFileConformance(
    sprintDoc().replace(
      '| Claim | Onde foi prometido | Evidência esperada | Evidência real | Status |',
      '| Claim | Fonte | Esperada | Real | Estado |',
    ),
  );
  assert.ok(withoutEvidence.pendencies.some((p) => p.category === 'evidence_to_claim'));
});

// ===== Plano 6 — Review crítica via policy_manifest (AC-6.1.* / CN5) =====

// Injeta `critical_review` no fence policy_manifest do sprintDoc().
function policyWithCriticalReview({ required = 'true', reasons = '[authorization]' } = {}) {
  return sprintDoc().replace(
    /```yaml\npolicy_manifest:\n  forbidden_scope:\n    - "hosts"\n  required_gates:\n    - "talos_verify_sprint_file"\n```/,
    '```yaml\npolicy_manifest:\n  forbidden_scope:\n    - "hosts"\n  required_gates:\n    - "talos_verify_sprint_file"\n'
      + '  critical_review:\n    required: ' + required + '\n    reasons: ' + reasons + '\n```',
  );
}

// Conteúdo do fence policy_manifest (sem os backticks) para parse direto.
function policyBlockOf(markdown) {
  const m = /```ya?ml\s*\n(policy_manifest:[\s\S]*?)```/.exec(markdown);
  return m ? m[1] : null;
}

test('validateSprintFileConformance: critical_review.reasons fora do enum fixo → pendência (AC-6.1.1)', () => {
  const r = validateSprintFileConformance(policyWithCriticalReview({ reasons: '[authorization, livre]' }));
  assert.equal(r.valid, false);
  assert.ok(
    r.pendencies.some((p) => p.category === 'policy_manifest' && p.item === 'critical_review.reasons' && /livre/.test(p.message)),
    `esperava pendência critical_review.reasons nomeando 'livre'; obtido: ${JSON.stringify(r.pendencies)}`,
  );
  // Contraprova: reasons dentro do enum → sem pendência de critical_review.
  const ok = validateSprintFileConformance(
    policyWithCriticalReview({ required: 'true', reasons: '[authorization, public_contract]' }),
  );
  assert.equal(ok.valid, true, `pendências: ${JSON.stringify(ok.pendencies)}`);
});

test('validateSprintFileConformance: critical_review.required não booleano → pendência (AC-6.1.1)', () => {
  const r = validateSprintFileConformance(policyWithCriticalReview({ required: 'sim' }));
  assert.equal(r.valid, false);
  assert.ok(
    r.pendencies.some((p) => p.category === 'policy_manifest' && p.item === 'critical_review.required'),
    `esperava pendência critical_review.required; obtido: ${JSON.stringify(r.pendencies)}`,
  );
});

test('validateSprintFileConformance: critical_review.required:true sem reasons → pendência (AC-6.1.1, D09 sem inferência)', () => {
  const r = validateSprintFileConformance(policyWithCriticalReview({ required: 'true', reasons: '[]' }));
  assert.equal(r.valid, false);
  assert.ok(
    r.pendencies.some((p) => p.category === 'policy_manifest' && p.item === 'critical_review.reasons'),
    `esperava pendência critical_review.reasons; obtido: ${JSON.stringify(r.pendencies)}`,
  );
});

test('requiresCriticalReview/parseCriticalReview: parse determinístico do policy_manifest (AC-6.1.2 helper)', () => {
  assert.equal(requiresCriticalReview(policyBlockOf(policyWithCriticalReview({ required: 'true' }))), true);
  assert.equal(requiresCriticalReview(policyBlockOf(policyWithCriticalReview({ required: 'false' }))), false);
  // policy_manifest sem critical_review → false (review crítica não é default).
  assert.equal(requiresCriticalReview(policyBlockOf(sprintDoc())), false);
  const parsed = parseCriticalReview(policyBlockOf(policyWithCriticalReview({ required: 'true', reasons: '[authorization]' })));
  assert.deepEqual(parsed, { required: true, reasons: ['authorization'] });
});

test('talos_verify_sprint_file: critical_review.reasons inválido → blocked com pendência (AC-6.1.1 seam S-REV)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'),
    policyWithCriticalReview({ reasons: '[prosa_livre]' }),
  );
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE);
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(
    r.pendencies.some((p) => p.category === 'policy_manifest' && p.item === 'critical_review.reasons'),
    `esperava pendência critical_review.reasons no gate; obtido: ${JSON.stringify(r.pendencies)}`,
  );
});

test('orquestrador SKILL G8: critical_review.required:true exige slice-review ANTES de talos_update_sprint_status (AC-6.1.2 / CN5 sink)', () => {
  // O sink de CN5 é packages/orchestrator/skills/talos/SKILL.md:G8 — o teste lê o
  // arquivo do disco (não string fabricada) e exige a ordem do contrato.
  const skill = fs.readFileSync(ORCHESTRATOR_SKILL_PATH, 'utf8');
  const g8Row = skill.split('\n').find((line) => /^\|\s*G8\s*\|/.test(line));
  assert.ok(g8Row, 'linha G8 ausente no SKILL do orquestrador');
  assert.match(g8Row, /critical_review\.required/);
  const sliceAt = g8Row.indexOf('slice-review');
  const statusAt = g8Row.indexOf('talos_update_sprint_status');
  assert.ok(
    sliceAt >= 0 && statusAt > sliceAt,
    'G8 não exige slice-review ANTES de talos_update_sprint_status quando critical_review.required:true',
  );
  // A review crítica é obrigatória por policy — não pode continuar tratando
  // review só como opcional via `--review` nesse caso.
  assert.match(g8Row, /obrigat[óo]ria/);
  assert.match(g8Row, /não depende de `--review`|sem `--review`/);
});

test('SPRINT_TEMPLATE §10: policy_manifest inclui critical_review com enum fixo de reasons (Plano 6 template)', () => {
  const template = fs.readFileSync(SPRINT_TEMPLATE_PATH, 'utf8');
  const section = template.slice(template.indexOf('## 10. Policy manifest'));
  assert.match(section, /critical_review:/);
  for (const reason of CRITICAL_REVIEW_REASONS) {
    assert.ok(section.includes(reason), `template §10 sem reason '${reason}'`);
  }
  assert.match(section, /required:\s*(true|false)/);
});

test('talos_verify_sprint_file: contrato completo passa no gate público (AC-1.2.1 seam)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE);
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.pending_count, 0);
});

test('validateAcceptanceSeal: aprovado + bloco intacto → tampered:false (AC-2.1.1)', () => {
  const markdown = sprintDoc({ contratoStatus: 'aprovado' });
  const block = extractAcceptanceBlock(markdown);
  assert.ok(block && block.startsWith('## 7.'));
  const seal = validateAcceptanceSeal(markdown);
  assert.equal(seal.sealed, true);
  assert.equal(seal.tampered, false);
  assert.match(computeAcceptanceSeal(markdown), /^sha256:[a-f0-9]{64}$/);
});

test('validateAcceptanceSeal: aprovado + bloco alterado 1 char → tampered:true (AC-2.1.2)', () => {
  const intact = sprintDoc({ contratoStatus: 'aprovado' });
  assert.equal(validateAcceptanceSeal(intact).tampered, false);
  const adulterated = intact.replace(
    '| D1 | Runtime harness entrega gate observável | usuario |',
    '| D1 | Runtime harness entrega gate observávelX | usuario |',
  );
  const seal = validateAcceptanceSeal(adulterated);
  assert.equal(seal.sealed, true);
  assert.equal(seal.tampered, true);
});

test('validateAcceptanceSeal: aprovado sem Selo do contrato → tampered:true (AC-2.1.3)', () => {
  const markdown = sprintDoc({ contratoStatus: 'aprovado', selo: null });
  const seal = validateAcceptanceSeal(markdown);
  assert.equal(seal.sealed, false);
  assert.equal(seal.tampered, true);
});

test('validateAcceptanceSeal: draft ignora selo → tampered:false (AC-2.1.4)', () => {
  const markdown = sprintDoc({
    contratoStatus: 'draft',
    selo: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  const seal = validateAcceptanceSeal(markdown);
  assert.equal(seal.sealed, false);
  assert.equal(seal.tampered, false);
});

test('talos_verify_sprint_file: aprovado adulterado → blocked FROZEN_ACCEPTANCE_TAMPERED (AC-2.2.1)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  const intact = sprintDoc({ contratoStatus: 'aprovado' });
  const adulterated = intact.replace(
    '| D1 | Runtime harness entrega gate observável | usuario |',
    '| D1 | Runtime harness entrega gate observávelX | usuario |',
  );
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), adulterated);
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE);
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) =>
    p.category === 'contrato_congelado' && p.item === 'FROZEN_ACCEPTANCE_TAMPERED'));
});

test('talos_verify_sprint_file: aprovado intacto → passed (AC-2.2.2)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'),
    sprintDoc({ contratoStatus: 'aprovado' }),
  );
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE);
  const r = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.pending_count, 0);
});

test('SPRINT_TEMPLATE: §1 contém Selo do contrato (AC-2.2.3)', () => {
  const template = fs.readFileSync(SPRINT_TEMPLATE_PATH, 'utf8');
  assert.match(template, /^\|\s*Selo do contrato\s*\|\s*\[pendente até aprovação\]\s*\|/m);
});

test('talos_verify_sprint_file: premissa_count numérico em passed e blocked (AC-01.4.2)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  // passed com zero premissas: campo presente e numérico (falsificador: emitir
  // só quando > 0 deixaria `premissa_count` ausente aqui e o consumidor não
  // distinguiria "zero premissas" de "gate antigo").
  fs.writeFileSync(
    path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'),
    sprintDoc({ moscow: 'Should', prioridade: 'P1' }),
  );
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), BACKLOG_WITH_SPRINT_FILE);
  const passed = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.premissa_count, 0);

  // passed com premissas em sprint não-prioritária: conta linhas §7.1 + itens §7.3.
  const withPremissas = sprintDoc({ moscow: 'Should', prioridade: 'P1', decisionOrigin: 'premissa', acceptanceOrigin: 'premissa' });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), withPremissas);
  const passedPremissas = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(passedPremissas.status, 'passed');
  assert.equal(passedPremissas.premissa_count, 3, 'D1 da §7.1 + AC-001 + AC-002 da §7.3');

  // blocked com premissa em sprint Must/P0: campo presente e batendo com o fixture.
  fs.writeFileSync(
    path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'),
    sprintDoc({ decisionOrigin: 'premissa' }),
  );
  const blocked = verifySprintFile({
    run_id: 'r1',
    project_root: root,
    sprint_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    sprint_id: 'S01',
    backlog_path: 'BACKLOG.md',
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.premissa_count, 1);
  assert.ok(blocked.pendencies.some((p) => p.category === 'procedencia_premissa_em_prioridade'));
});

test('talos_verify_backlog_index: derivado:<path> inexistente reprova também no gate de backlog (AC-01.4.3)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  // Path inexistente: o mesmo artefato que reprova em verifySprintFile precisa
  // reprovar aqui — sem `root` em inspectBacklogIndex a resolução fica inerte.
  fs.writeFileSync(
    path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'),
    sprintDoc({ moscow: 'Should', prioridade: 'P1', decisionOrigin: 'derivado:packages/nao/existe.js' }),
  );
  const r = verifyBacklogIndex({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(
    r.pendencies.some((p) => p.category === 'sprint_file' && /origem_path_inexistente/.test(p.item)),
    `esperava pendência sprint_file:*:origem_path_inexistente; obtido: ${JSON.stringify(r.pendencies)}`,
  );
  assert.equal(r.premissa_count, 0, 'premissa_count sempre presente, inclusive zero');

  // Contraprova com arquivo real: `derivado:packages/existe.js` resolve contra o
  // root do consumidor e o índice passa.
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages/existe.js'), 'export const real = true;\n');
  fs.writeFileSync(
    path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'),
    sprintDoc({ moscow: 'Should', prioridade: 'P1', decisionOrigin: 'derivado:packages/existe.js' }),
  );
  const ok = verifyBacklogIndex({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(ok.status, 'passed', JSON.stringify(ok.pendencies, null, 1));
  assert.equal(ok.premissa_count, 0);
});

test('applyInterviewRound: grava decisão D* na §7 (AC-4.2.1)', () => {
  const base = sprintDoc({ contratoStatus: 'draft' });
  const updated = applyInterviewRound(base, [
    { decision_id: 'D1', value: 'Harness usa gate binário observável' },
  ], '2026-07-19');
  assert.match(updated, /^\| D1 \| Harness usa gate binário observável \| usuario \|$/m);
  assert.ok(closedDecisionIds(updated).has('D1'));
  const section7 = updated.slice(updated.indexOf('## 7.'));
  assert.match(section7, /^\| D1 \| Harness usa gate binário observável \| usuario \|$/m);
});

test('applyInterviewRound: approve sela contrato com validateAcceptanceSeal (AC-4.2.2)', () => {
  const base = sprintDoc({ contratoStatus: 'draft' });
  const updated = applyInterviewRound(base, [
    { decision_id: 'D1', value: 'Harness usa gate binário observável' },
  ], '2026-07-19', { approve: true });
  assert.match(updated, /^\|\s*Contrato status\s*\|\s*aprovado\s*\|$/im);
  assert.match(updated, /^\|\s*Selo do contrato\s*\|\s*sha256:[a-f0-9]{64}\s*\|$/im);
  const seal = validateAcceptanceSeal(updated);
  assert.equal(seal.sealed, true);
  assert.equal(seal.tampered, false);
  const approvedOnly = approveAcceptanceContract(
    applyInterviewRound(base, [{ decision_id: 'D1', value: 'Harness usa gate binário observável' }], '2026-07-19'),
  );
  assert.equal(validateAcceptanceSeal(approvedOnly).tampered, false);
  assert.equal(
    computeAcceptanceSeal(updated),
    updated.match(/^\|\s*Selo do contrato\s*\|\s*(sha256:[a-f0-9]{64})\s*\|$/im)[1],
  );
});

function backlogWithRows(rows) {
  return [
    '## 7. Registro de sprints',
    '| ID | Sprint | Fase-fonte | Objetivo (1 linha) | MoSCoW | Ganho | Esforço | Prioridade | PRD | Depende de | Estado | Gate | Sprint file | PLAN | State |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function writeSprintFixture(root, id, {
  status = 'ready',
  dorStatus = 'verde',
  contratoStatus = 'draft',
  plan = 'pendente',
} = {}) {
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  let doc = sprintDoc({ id, backlog: `BACKLOG.md#${id}`, status, dorStatus, contratoStatus });
  if (plan !== 'pendente') {
    doc = doc.replace('| PLAN | pendente |', `| PLAN | ${plan} |`);
  }
  fs.writeFileSync(
    path.join(root, `.talos/backlog/sprints/SPRINT_${id}_runtime.md`),
    doc,
  );
}

function writeHandoffTemplateFixture(root) {
  // Fonte versionada no repo (não `.talos/`, gitignored). Runtime do consumidor
  // continua lendo `.talos/memory/HANDOFF_TEMPLATE.md` no project_root.
  const templateSrc = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'fixtures/HANDOFF_TEMPLATE.md',
  );
  const destDir = path.join(root, '.talos/memory');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(templateSrc, path.join(destDir, 'HANDOFF_TEMPLATE.md'));
}

// State v3 com acceptance_results (campo emitido pelo validator no complete e
// persistido no state; consumido pelo gate de status do updateSprintStatus).
function writeStateWithAcceptance(root, name, acceptanceResults, extra = {}) {
  const state = {
    state_schema_version: 3,
    run_id: 'r-plano3',
    slice: 'A',
    base_sha: 'a'.repeat(40),
    head_sha: 'a'.repeat(40),
    contract_kind: 'plan',
    tasks: ['T01'],
    files_changed: ['src/entrega.js'],
    diff_stat: '1 file',
    plan_path: '.talos/plans/PLAN_S01_runtime.md',
    boundary_refs: ['B1'],
    obligations: [],
    invariants: [],
    scenario_probes: [],
    risk_probes: [],
    validation_map: [],
    task_evidence: [],
    repair_evidence: [],
    worktree_baseline: [],
    worktree_final: [],
    executed_at: '2026-08-02T00:00:00Z',
    executor_skill: 'talos-plan-execute',
    sprint_file_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    proof_refs: {},
    ...extra,
  };
  if (acceptanceResults !== undefined) state.acceptance_results = acceptanceResults;
  const dir = path.join(root, '.talos/state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(state, null, 2));
}

test('talos_verify_backlog_index: índice válido passa com sprint file e status espelhado', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const r = verifyBacklogIndex({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.sprint_count, 1);
  assert.equal(r.sprints[0].sprint_file_status, 'valid');
});

test('talos_verify_backlog_index: status drift backlog x sprint file bloqueia', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'doing', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const r = verifyBacklogIndex({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'status_drift'));
});

test('talos_select_next_sprint: escolhe sprint ready com maior prioridade determinística', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  writeSprintFixture(root, 'S02', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime A | F0 | objetivo | Should | Alto | Baixo | P0 | pendente | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
    '| S02 | Runtime B | F0 | objetivo | Must | Médio | Alto | P1 | pendente | — | ready | — | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.selected.sprint_id, 'S02');
  assert.deepEqual(r.candidates, ['S02', 'S01']);
  assert.equal(r.next_action, 'sprint_interview');
  assert.notEqual(r.next_action, 'gerar_prd');
  assert.equal(r.selected.contrato_status, 'draft');
  assert.equal(r.selected.contrato_sealed, false);
});

test('talos_select_next_sprint: §7 draft → sprint_interview (nunca gerar_prd)', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S13', { status: 'ready', dorStatus: 'verde', contratoStatus: 'draft' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S13 | Contrato draft | F0 | objetivo | Must | Alto | Baixo | P0 | — | — | ready | — | `.talos/backlog/sprints/SPRINT_S13_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.next_action, 'sprint_interview');
  assert.equal(r.selected.prd_path, null);
  assert.ok(!String(r.next_action).includes('prd'));
});

test('talos_select_next_sprint: §7 aprovado+selo sem PLAN → plan_handoff', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde', contratoStatus: 'aprovado' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | — | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.selected.contrato_status, 'aprovado');
  assert.equal(r.selected.contrato_sealed, true);
  assert.equal(r.next_action, 'plan_handoff');
});

test('talos_select_next_sprint: PLAN real → plan_execute', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', {
    status: 'ready',
    dorStatus: 'verde',
    contratoStatus: 'aprovado',
    plan: '.talos/plans/PLAN_S01_runtime.md',
  });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | — | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | `.talos/plans/PLAN_S01_runtime.md` | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.next_action, 'plan_execute');
  assert.equal(r.selected.plan_path, '.talos/plans/PLAN_S01_runtime.md');
});

test('nextActionForSelectedSprint: matriz canônica 0.14 mode-aware', () => {
  const draft = { contrato_status: 'draft', contrato_sealed: false, plan: null };
  const sealed = { contrato_status: 'aprovado', contrato_sealed: true, plan: null };
  const sealedPending = { contrato_status: 'aprovado', contrato_sealed: true, plan: 'pendente' };
  const sealedWithPlan = { contrato_status: 'aprovado', contrato_sealed: true, plan: 'PLAN_S01.md' };
  const sealedNoSeal = { contrato_status: 'aprovado', contrato_sealed: false, plan: null };

  assert.equal(nextActionForSelectedSprint(draft), 'sprint_interview');
  assert.equal(nextActionForSelectedSprint(sealedPending), 'plan_handoff');
  assert.equal(nextActionForSelectedSprint(sealedWithPlan), 'plan_execute');
  assert.equal(nextActionForSelectedSprint(sealedNoSeal), 'sprint_interview');

  assert.equal(nextActionForSelectedSprint(sealed, 'direct'), 'plan_execute');
  assert.equal(nextActionForSelectedSprint(sealedWithPlan, 'direct'), 'plan_execute');
  assert.equal(nextActionForSelectedSprint(draft, 'direct'), 'sprint_interview');

  assert.equal(nextActionForSelectedSprint(sealed, 'interview-only'), 'sprint_interview');
  assert.equal(nextActionForSelectedSprint(sealedWithPlan, 'full'), 'plan_execute');
  assert.equal(nextActionForSelectedSprint(sealed, 'full'), 'plan_handoff');
});

test('talos_select_next_sprint: mode=direct + §7 selado → plan_execute (não plan_handoff)', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde', contratoStatus: 'aprovado' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | — | — | ready | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    mode: 'direct',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.next_action, 'plan_execute');
  assert.notEqual(r.next_action, 'plan_handoff');
  assert.notEqual(r.next_action, 'gerar_prd');
});

test('talos_select_next_sprint: dependência interna não done bloqueia seleção', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'backlog', dorStatus: 'verde' });
  writeSprintFixture(root, 'S02', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Base | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | backlog | — | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
    '| S02 | Depende | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | ready | — | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.equal(r.selected, null);
  assert.ok(r.rejected.some((item) => item.id === 'S02' && item.reasons.some((reason) => /unmet_dependencies=S01:backlog/.test(reason))));
});

test('talos_update_sprint_status: sincroniza done no backlog e sprint file com evidência', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    plan_path: 'PLAN_S01.md',
    state_path: '.talos/state/S01.json',
    evidence: 'validator pass',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.previous_status, 'ready');
  assert.equal(r.next_status, 'done');
  const backlog = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const row = parseSprintRows(backlog)[0];
  assert.equal(row.state, 'done');
  assert.equal(row.gate, 'validator:pass');
  assert.equal(row.prd, 'pendente');
  assert.equal(row.plan, 'PLAN_S01.md');
  assert.equal(row.state_file, '.talos/state/S01.json');
  const sprint = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), 'utf8');
  assert.match(sprint, /^\| Status \| done \|$/m);
  assert.doesNotMatch(sprint, /^\|\s*PRD\s*\|\s*PRD_S01\.md\s*\|/m);
  assert.match(sprint, /\| Sprint status update \| validator:pass \| validator pass \|/);
  assert.match(sprint, /\| Talos MCP \| Status -> done; validator=pass; evidence=validator pass \|/);
  assert.equal(verifyBacklogIndex({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' }).status, 'passed');
});

test('talos_update_sprint_status: prd_path legado só atualiza coluna do backlog', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'doing',
    prd_path: 'legado-ignorado-no-sprint.md',
    plan_path: 'PLAN_S01.md',
  });
  assert.equal(r.status, 'passed');
  const row = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'))[0];
  assert.equal(row.prd, 'legado-ignorado-no-sprint.md');
  assert.equal(row.plan, 'PLAN_S01.md');
  const sprint = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), 'utf8');
  assert.doesNotMatch(sprint, /legado-ignorado-no-sprint/);
});

test('talos_update_sprint_status: done sem validator terminal bloqueia e não muta', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const before = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'validator_verdict'));
  assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), before);
});

test('talos_update_sprint_status: reabrir done bloqueia por padrão', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'done', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | PRD_S01.md | — | done | validator:pass | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | PLAN_S01.md | .talos/state/S01.json |',
  ]));
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'doing',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'status_transition'));
});

test('handoff emit: done+pass com template cria HANDOFF e retorna handoff_path', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    plan_path: 'PLAN_S01.md',
    state_path: '.talos/state/S01.json',
    evidence: 'validator pass',
  });
  assert.equal(r.status, 'passed');
  assert.ok(r.handoff_path);
  assert.match(r.handoff_path, /^\.talos\/memory\/HANDOFF_s01_runtime_\d{8}\.md$/);
  assert.equal(r.next_action, 'promover_handoff');
  const handoffAbs = path.join(root, r.handoff_path);
  assert.ok(fs.existsSync(handoffAbs));
  const handoff = fs.readFileSync(handoffAbs, 'utf8');
  assert.match(handoff, /^\| sprint_id \| S01 \|$/m);
  assert.match(handoff, /^\| status_pos_validator \| pass \|$/m);
  assert.match(handoff, /^\| origem \| talos_update_sprint_status \|$/m);
  assert.match(handoff, /## Contexto da entrega/);
  assert.match(handoff, /state_path \| `\.talos\/state\/S01\.json`/);
  assert.match(handoff, /plan_path \| `PLAN_S01\.md`/);
  assert.match(handoff, /plan_path \| `PLAN_S01\.md` \|\n\n---\n/);
  assert.match(handoff, /0 candidatos — nenhum fato durável promovido automaticamente\. Sucesso\./);
});

test('handoff emit: done+pass_with_observations emite handoff', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass_with_observations',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'passed');
  assert.ok(r.handoff_path);
  const handoff = fs.readFileSync(path.join(root, r.handoff_path), 'utf8');
  assert.match(handoff, /^\| status_pos_validator \| pass_with_observations \|$/m);
});

test('handoff emit: done sem validator terminal bloqueia sem criar HANDOFF', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const memoryDir = path.join(root, '.talos/memory');
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'fail',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'blocked');
  assert.equal(r.handoff_path, undefined);
  const handoffs = fs.existsSync(memoryDir)
    ? fs.readdirSync(memoryDir).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name))
    : [];
  assert.equal(handoffs.length, 0);
});

test('handoff emit: template ausente bloqueia com pendência handoff_emit', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const backlogBefore = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const sprintAbs = path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md');
  const sprintBefore = fs.readFileSync(sprintAbs, 'utf8');
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'handoff_emit'));
  assert.equal(r.handoff_path, undefined);
  // Atomicidade P2: sem write parcial — backlog e sprint permanecem ready.
  assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), backlogBefore);
  assert.equal(fs.readFileSync(sprintAbs, 'utf8'), sprintBefore);
  assert.match(backlogBefore, /\|\s*ready\s*\|/);
  assert.match(fs.readFileSync(sprintAbs, 'utf8'), /^\| Status \| ready \|$/m);
});

test('handoff emit: falha de FS no write do HANDOFF faz rollback backlog+sprint (P2)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const backlogBefore = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const sprintAbs = path.resolve(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md');
  const sprintBefore = fs.readFileSync(sprintAbs, 'utf8');
  const memoryDir = path.resolve(root, '.talos/memory');
  const realWrite = fs.writeFileSync;
  mock.method(fs, 'writeFileSync', (target, data, ...rest) => {
    const resolved = path.resolve(target);
    if (resolved.startsWith(memoryDir) && /HANDOFF_.*_\d{8}\.md$/.test(path.basename(resolved))) {
      throw Object.assign(new Error('ENOSPC: simulated'), { code: 'ENOSPC' });
    }
    return realWrite(target, data, ...rest);
  });
  try {
    const r = updateSprintStatus({
      run_id: 'r1',
      project_root: root,
      backlog_path: 'BACKLOG.md',
      sprint_id: 'S01',
      status: 'done',
      validator_verdict: 'pass',
      state_path: '.talos/state/S01.json',
    });
    assert.equal(r.status, 'blocked');
    assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), backlogBefore);
    assert.equal(fs.readFileSync(sprintAbs, 'utf8'), sprintBefore);
  } finally {
    mock.restoreAll();
  }
});

test('talos_update_sprint_status: falha de FS no sprint file faz rollback do backlog (P2)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const before = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const sprintAbs = path.resolve(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md');
  // Injeta falha de FS determinística só no write do sprint file: o backlog já foi
  // escrito quando o sprint file falha (EACCES), exercitando o caminho de rollback.
  const realWrite = fs.writeFileSync;
  mock.method(fs, 'writeFileSync', (target, data, ...rest) => {
    if (path.resolve(target) === sprintAbs) {
      throw Object.assign(new Error('EACCES: simulated'), { code: 'EACCES' });
    }
    return realWrite(target, data, ...rest);
  });
  try {
    const r = updateSprintStatus({
      run_id: 'r1',
      project_root: root,
      backlog_path: 'BACKLOG.md',
      sprint_id: 'S01',
      status: 'done',
      validator_verdict: 'pass',
      state_path: '.talos/state/S01.json',
      evidence: 'validator pass',
    });
    assert.equal(r.status, 'blocked');
    // Backlog restaurado ao original — sem drift backlog↔sprint.
    assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), before);
  } finally {
    mock.restoreAll();
  }
});

// ===== Plano 3 — manual_validation_pending, DEP e handoff (AC-3.*) =====

test('talos_select_next_sprint: dependência manual_validation_pending satisfaz DEP (AC-3.1.1)', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'manual_validation_pending', dorStatus: 'verde' });
  writeSprintFixture(root, 'S02', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Base | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
    '| S02 | Depende | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | ready | ready | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.selected.sprint_id, 'S02');
  assert.ok(!r.rejected.some((item) => item.id === 'S02'));
  assert.ok(!r.rejected.some((item) => item.reasons.some((reason) => /unmet_dependencies=S01/.test(reason))));
});

test('talos_update_sprint_status: manual_validation_pending com M pendente não emite handoff (AC-3.1.2)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
    { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
  ]);
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'manual_validation_pending',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
    evidence: 'validator pass; M pendente',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.next_status, 'manual_validation_pending');
  assert.equal(r.handoff_path, undefined);
  assert.notEqual(r.next_action, 'promover_handoff');
  const row = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'))[0];
  assert.equal(row.state, 'manual_validation_pending');
  assert.equal(row.gate, 'validator:pass;manual_pending');
  const sprint = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), 'utf8');
  assert.match(sprint, /^\| Status \| manual_validation_pending \|$/m);
  const handoffs = fs.existsSync(path.join(root, '.talos/memory'))
    ? fs.readdirSync(path.join(root, '.talos/memory')).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name))
    : [];
  assert.equal(handoffs.length, 0);
});

test('BACKLOG_MESTRE_TEMPLATE: §5.1 e DoR alinhados a manual_validation_pending (AC-3.1.3)', () => {
  const templatePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../templates/BACKLOG_MESTRE_TEMPLATE.md',
  );
  const template = fs.readFileSync(templatePath, 'utf8');
  // §5.1: cadeia de estados e tabela de significados incluem manual_validation_pending.
  assert.match(template, /backlog → ready → doing → review → manual_validation_pending → done/);
  assert.match(template, /\| manual_validation_pending \|/);
  // DoR: dependências aceitam done OU manual_validation_pending (não só done).
  const dorLine = template.split('\n').find((line) => line.includes('Dependências anteriores'));
  assert.ok(dorLine, 'DoR global com linha de dependências anteriores');
  assert.match(dorLine, /manual_validation_pending/);
  assert.doesNotMatch(dorLine, /^\- \[ \] Dependências anteriores `done` ou explicitamente não bloqueantes\.\s*$/);
});

test('update_sprint_status done emite handoff quando AC proved sem M (AC-3.2.1 / CN1)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
    { id: 'AC-002', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
  ]);
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
    evidence: 'validator pass',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.next_status, 'done');
  assert.ok(r.handoff_path);
  assert.equal(r.next_action, 'promover_handoff');
  const row = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'))[0];
  assert.equal(row.state, 'done');
});

test('update_sprint_status: done bloqueado quando acceptance_results tem manual_pending (VC1)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
  ]);
  const before = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const r = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'acceptance_results'));
  // nunca done com M aberto: sem mutação e sem handoff.
  assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), before);
  const handoffs = fs.existsSync(path.join(root, '.talos/memory'))
    ? fs.readdirSync(path.join(root, '.talos/memory')).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name))
    : [];
  assert.equal(handoffs.length, 0);
});

// Fechamento Plano F (A6/P1): SKILL SPRINT_STATUS_SYNC exige acceptance_results
// para done; o escape "quando presentes" do Plano 3 permitia done+handoff sem
// prova de AC. Sem o campo (ou com state ilegível/v2), done bloqueia.
test('update_sprint_status: done bloqueado sem acceptance_results no state (A6 / Plano F)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  // state_path apontado mas arquivo ausente → results null → blocked.
  const before = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const rMissing = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(rMissing.status, 'blocked');
  assert.ok(rMissing.pendencies.some((p) => p.category === 'acceptance_results' && /exige acceptance_results/.test(p.message)));
  assert.equal(rMissing.handoff_path, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), before);

  // state v3 sem o campo → blocked.
  writeStateWithAcceptance(root, 'S01.json', undefined);
  const rNoField = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(rNoField.status, 'blocked');
  assert.ok(rNoField.pendencies.some((p) => p.category === 'acceptance_results'));
  assert.equal(rNoField.handoff_path, undefined);

  // state v2 com acceptance_results forjado → LEG2 side-path: ainda blocked.
  const forgedV2 = {
    state_schema_version: 2,
    acceptance_results: [{ id: 'AC-001', status: 'proved', proof_types: ['I:present'] }],
  };
  fs.mkdirSync(path.join(root, '.talos/state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/state/S01-v2.json'), JSON.stringify(forgedV2));
  const rV2 = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01-v2.json',
  });
  assert.equal(rV2.status, 'blocked');
  assert.ok(rV2.pendencies.some((p) => p.category === 'acceptance_results'));
  assert.equal(rV2.handoff_path, undefined);
});

test('manual_validation_pending satisfaz DEP e não emite handoff (CN2)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'review', dorStatus: 'verde' });
  writeSprintFixture(root, 'S02', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Base | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
    '| S02 | Depende | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | ready | ready | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
    { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
  ]);
  const up = updateSprintStatus({
    run_id: 'r1',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'manual_validation_pending',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(up.status, 'passed');
  assert.equal(up.handoff_path, undefined);
  assert.notEqual(up.next_action, 'promover_handoff');
  const r = selectNextSprint({ run_id: 'r2', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.selected.sprint_id, 'S02');
  assert.ok(!r.rejected.some((item) => item.reasons.some((reason) => /unmet_dependencies=S01/.test(reason))));
  const handoffs = fs.existsSync(path.join(root, '.talos/memory'))
    ? fs.readdirSync(path.join(root, '.talos/memory')).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name))
    : [];
  assert.equal(handoffs.length, 0);
});

test('talos_update_sprint_status: manual_validation_pending exige validator terminal e acceptance_results', () => {
  // (a) validator não-terminal bloqueia MVP.
  const rootA = tmpRoot();
  writeSprintFixture(rootA, 'S01', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(rootA, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(rootA, 'S01.json', [{ id: 'AC-001', status: 'manual_pending', proof_types: ['M:pending'] }]);
  const rA = updateSprintStatus({
    run_id: 'r1', project_root: rootA, backlog_path: 'BACKLOG.md', sprint_id: 'S01',
    status: 'manual_validation_pending', validator_verdict: 'fail', state_path: '.talos/state/S01.json',
  });
  assert.equal(rA.status, 'blocked');
  assert.ok(rA.pendencies.some((p) => p.category === 'validator_verdict'));
  // (b) sem acceptance_results no state bloqueia MVP.
  const rootB = tmpRoot();
  writeSprintFixture(rootB, 'S01', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(rootB, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(rootB, 'S01.json', undefined);
  const rB = updateSprintStatus({
    run_id: 'r1', project_root: rootB, backlog_path: 'BACKLOG.md', sprint_id: 'S01',
    status: 'manual_validation_pending', validator_verdict: 'pass', state_path: '.talos/state/S01.json',
  });
  assert.equal(rB.status, 'blocked');
  assert.ok(rB.pendencies.some((p) => p.category === 'acceptance_results'));
  // (c) unproved presente bloqueia MVP.
  const rootC = tmpRoot();
  writeSprintFixture(rootC, 'S01', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(rootC, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(rootC, 'S01.json', [{ id: 'AC-001', status: 'unproved', proof_types: ['T-outcome:unproved'] }]);
  const rC = updateSprintStatus({
    run_id: 'r1', project_root: rootC, backlog_path: 'BACKLOG.md', sprint_id: 'S01',
    status: 'manual_validation_pending', validator_verdict: 'pass', state_path: '.talos/state/S01.json',
  });
  assert.equal(rC.status, 'blocked');
  assert.ok(rC.pendencies.some((p) => p.category === 'acceptance_results'));
  // (d) sem manual_pending (todos proved) → MVP não é o status certo.
  const rootD = tmpRoot();
  writeSprintFixture(rootD, 'S01', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(rootD, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(rootD, 'S01.json', [{ id: 'AC-001', status: 'proved', proof_types: ['T-outcome:proved'] }]);
  const rD = updateSprintStatus({
    run_id: 'r1', project_root: rootD, backlog_path: 'BACKLOG.md', sprint_id: 'S01',
    status: 'manual_validation_pending', validator_verdict: 'pass', state_path: '.talos/state/S01.json',
  });
  assert.equal(rD.status, 'blocked');
  assert.ok(rD.pendencies.some((p) => p.category === 'acceptance_results'));
});

// ===== Plano 4 — relatório de validação manual e sync (AC-4.* / CN3 / D11-D15) =====

// Sprint file com AC-002 (e opcionalmente AC-003) declarando smoke manual `M`
// (evidence.manual objeto) — base do relatório MV-*.
function writeSprintWithManual(root, id, {
  status = 'review',
  dorStatus = 'verde',
  extraManualAc = false,
} = {}) {
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  let doc = sprintDoc({ id, backlog: `BACKLOG.md#${id}`, status, dorStatus, contratoStatus: 'draft' });
  doc = doc.replace(
    '      required: [I, T-outcome]\n      manual: null',
    '      required: [I, T-outcome, M]\n      manual:\n        severity: alta\n        scenario: "validação manual"\n        expected_evidence: "resultado observável"\n        impact_paths: ["src/initial.js"]',
  );
  if (extraManualAc) {
    doc = doc.replace(
      '        impact_paths: ["src/initial.js"]\n```',
      '        impact_paths: ["src/initial.js"]\n  - id: AC-003\n    origin: "usuario"\n    behavior: "Outro smoke manual"\n    decisions: [D1]\n    scenario: "Regressão"\n    evals: [EVAL-001]\n    evidence:\n      required: [I, T-outcome, M]\n      manual:\n        severity: normal\n        scenario: "validação manual 2"\n        expected_evidence: "resultado observável 2"\n        impact_paths: ["src/initial.js"]\n```',
    );
  }
  fs.writeFileSync(path.join(root, `.talos/backlog/sprints/SPRINT_${id}_runtime.md`), doc);
}

// Relatório canônico `.talos/manual-validation/<slug>.md` (template Plano 4).
function writeManualValidationReport(root, rows, { slug = 'backlog', backlogPath = 'BACKLOG.md' } = {}) {
  const dir = path.join(root, '.talos/manual-validation');
  fs.mkdirSync(dir, { recursive: true });
  const doc = [
    `# Validações manuais abertas — ${slug}`,
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| Backlog | \`${backlogPath}\` |`,
    '| Atualizado em | 2026-08-02T00:00:00Z |',
    '',
    '## Pendências',
    '',
    '| ID | Sprint / AC | Severidade | Status | Cenário | Ambiente | Evidência esperada | Resultado / justificativa |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${slug}.md`), doc);
}

function setupMvpSprint(root, { acceptance, extraManualAc = false } = {}) {
  writeHandoffTemplateFixture(root);
  writeSprintWithManual(root, 'S01', { status: 'manual_validation_pending', dorStatus: 'verde', extraManualAc });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | `.talos/state/S01.json` |',
  ]));
  writeStateWithAcceptance(root, 'S01.json', acceptance);
}

test('MANUAL_VALIDATION_REPORT_TEMPLATE: estrutura canônica do relatório (Plano 4)', () => {
  const templatePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../templates/MANUAL_VALIDATION_REPORT_TEMPLATE.md',
  );
  const template = fs.readFileSync(templatePath, 'utf8');
  assert.match(template, /## Pendências/);
  assert.match(template, /\| ID \| Sprint \/ AC \| Severidade \| Status \| Cenário \| Ambiente \| Evidência esperada \| Resultado \/ justificativa \|/);
  assert.match(template, /MV-S01-AC-002/);
  assert.match(template, /fix_manual_validation_report/);
});

test('talos_sync_manual_validation: waiver sem justificativa bloqueia (AC-4.1.1)', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | waived | passo a passo | dev | resultado observável | — |',
  ]);
  const r = syncManualValidation({ run_id: 'r-waiver', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'relatorio_manual' && /justificativa/.test(p.message)));
  assert.equal(r.next_action, 'fix_manual_validation_report');
  // sem drift: state e relatório intactos.
  const state = JSON.parse(fs.readFileSync(path.join(root, '.talos/state/S01.json'), 'utf8'));
  assert.equal(state.acceptance_results.find((item) => item.id === 'AC-002').status, 'manual_pending');
  assert.equal(fs.existsSync(path.join(root, '.talos/manual-validation/backlog.md')), true);
});

test('talos_sync_manual_validation: item fantasma sem AC.manual correspondente bloqueia (AC-4.1.2)', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  // AC-001 existe no contrato mas com manual: null — sem AC.manual correspondente.
  writeManualValidationReport(root, [
    '| MV-S01-AC-001 | S01 / AC-001 | alta | validated | passo a passo | dev | resultado observável | smoke ok |',
  ]);
  const r = syncManualValidation({ run_id: 'r-phantom', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'relatorio_manual' && /fantasma/.test(p.message)));
  assert.equal(r.next_action, 'fix_manual_validation_report');
});

test('sync manual validated promove done (AC-4.2.1 / CN3)', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | validated | passo a passo | dev | resultado observável | smoke ok na dev |',
  ]);
  const r = syncManualValidation({ run_id: 'r-cn3', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed', JSON.stringify(r.pendencies, null, 1));
  assert.equal(r.sprints[0].sprint_id, 'S01');
  assert.equal(r.sprints[0].state, 'done');
  assert.equal(r.sprints[0].promoted, true);
  assert.ok(r.handoff_path, 'sync validado deve emitir handoff');
  assert.equal(r.next_action, 'promover_handoff');
  const row = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'))[0];
  assert.equal(row.state, 'done');
  const sprint = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), 'utf8');
  assert.match(sprint, /^\| Status \| done \|$/m);
  // state sincronizado (D24): AC-002 proved com M:validated + ref do relatório.
  const state = JSON.parse(fs.readFileSync(path.join(root, '.talos/state/S01.json'), 'utf8'));
  const ac002 = state.acceptance_results.find((item) => item.id === 'AC-002');
  assert.equal(ac002.status, 'proved');
  assert.ok(ac002.proof_types.includes('M:validated'));
  assert.equal(state.manual_validation_report, '.talos/manual-validation/backlog.md');
  // relatório sem pendências é removido (D12).
  assert.equal(fs.existsSync(path.join(root, '.talos/manual-validation/backlog.md')), false);
  // handoff real no disco.
  const handoffs = fs.readdirSync(path.join(root, '.talos/memory')).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name));
  assert.equal(handoffs.length, 1);
});

test('talos_sync_manual_validation: M failed bloqueia a origem sem handoff', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | failed | passo a passo | dev | resultado observável | smoke falhou no fluxo X |',
  ]);
  const r = syncManualValidation({ run_id: 'r-fail', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed', JSON.stringify(r.pendencies, null, 1));
  assert.equal(r.sprints[0].state, 'blocked');
  assert.equal(r.sprints[0].promoted, true);
  assert.equal(r.handoff_path, null);
  assert.equal(r.next_action, 'corrigir_smoke_falho');
  const row = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'))[0];
  assert.equal(row.state, 'blocked');
  const state = JSON.parse(fs.readFileSync(path.join(root, '.talos/state/S01.json'), 'utf8'));
  const ac002 = state.acceptance_results.find((item) => item.id === 'AC-002');
  assert.equal(ac002.status, 'violated');
  assert.ok(ac002.proof_types.includes('M:failed'));
  const handoffs = fs.readdirSync(path.join(root, '.talos/memory')).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name));
  assert.equal(handoffs.length, 0);
});

test('talos_sync_manual_validation: sync parcial mantém MVP e relatório com pendências abertas (D12)', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    extraManualAc: true,
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
      { id: 'AC-003', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | validated | passo a passo | dev | resultado observável | smoke ok na dev |',
    '| MV-S01-AC-003 | S01 / AC-003 | normal | pending | passo a passo | staging | resultado observável 2 | — |',
  ]);
  const r = syncManualValidation({ run_id: 'r-partial', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed', JSON.stringify(r.pendencies, null, 1));
  assert.equal(r.sprints[0].state, 'manual_validation_pending');
  assert.equal(r.sprints[0].promoted, false);
  assert.equal(r.handoff_path, null);
  assert.equal(r.next_action, 'aguardar_validacao_manual');
  const state = JSON.parse(fs.readFileSync(path.join(root, '.talos/state/S01.json'), 'utf8'));
  assert.equal(state.acceptance_results.find((item) => item.id === 'AC-002').status, 'proved');
  assert.equal(state.acceptance_results.find((item) => item.id === 'AC-003').status, 'manual_pending');
  // relatório reescrito: só a pendência aberta AC-003 permanece.
  const report = fs.readFileSync(path.join(root, '.talos/manual-validation/backlog.md'), 'utf8');
  assert.match(report, /MV-S01-AC-003/);
  assert.doesNotMatch(report, /MV-S01-AC-002/);
  // D24: histórico no sprint (§16) registra o M sincronizado.
  const sprint = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), 'utf8');
  assert.match(sprint, /Talos MCP sync manual/);
  assert.match(sprint, /MV-S01-AC-002:validated/);
});

test('talos_sync_manual_validation: lock por backlog bloqueia sync concorrente (D15)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.talos/manual-validation'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/manual-validation/backlog.lock'), '{"run_id":"r-outro"}');
  const r = syncManualValidation({ run_id: 'r-lock', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'lock'));
  assert.equal(r.next_action, 'aguardar_sync_anterior_ou_remover_lock_manual');
});

test('talos_sync_manual_validation: relatório ausente bloqueia com criar_relatorio_manual', () => {
  const root = tmpRoot();
  const r = syncManualValidation({ run_id: 'r-missing', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'relatorio_manual' && p.next_action === 'criar_relatorio_manual'));
  assert.equal(r.next_action, 'criar_relatorio_manual');
});

test('talos_sync_manual_validation: relatório inválido bloqueia sem drift (fix_manual_validation_report)', () => {
  // (a) status fora do enum.
  const rootA = tmpRoot();
  setupMvpSprint(rootA, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(rootA, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | ok | passo a passo | dev | resultado observável | smoke ok |',
  ]);
  const rA = syncManualValidation({ run_id: 'r-a', project_root: rootA, backlog_path: 'BACKLOG.md' });
  assert.equal(rA.status, 'blocked');
  assert.equal(rA.next_action, 'fix_manual_validation_report');
  // (b) ID MV malformado.
  const rootB = tmpRoot();
  setupMvpSprint(rootB, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(rootB, [
    '| MV-S01-999 | S01 / 999 | alta | validated | x | y | z | ok |',
  ]);
  const rB = syncManualValidation({ run_id: 'r-b', project_root: rootB, backlog_path: 'BACKLOG.md' });
  assert.equal(rB.status, 'blocked');
  assert.equal(rB.next_action, 'fix_manual_validation_report');
  // (c) coluna Sprint/AC divergente do id.
  const rootC = tmpRoot();
  setupMvpSprint(rootC, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(rootC, [
    '| MV-S01-AC-002 | S01 / AC-003 | alta | validated | x | y | z | ok |',
  ]);
  const rC = syncManualValidation({ run_id: 'r-c', project_root: rootC, backlog_path: 'BACKLOG.md' });
  assert.equal(rC.status, 'blocked');
  assert.equal(rC.next_action, 'fix_manual_validation_report');
  // (d) MV duplicado.
  const rootD = tmpRoot();
  setupMvpSprint(rootD, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(rootD, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | validated | x | y | z | ok 1 |',
    '| MV-S01-AC-002 | S01 / AC-002 | alta | validated | x | y | z | ok 2 |',
  ]);
  const rD = syncManualValidation({ run_id: 'r-d', project_root: rootD, backlog_path: 'BACKLOG.md' });
  assert.equal(rD.status, 'blocked');
  assert.ok(rD.pendencies.some((p) => p.category === 'relatorio_manual' && /duplicado/.test(p.message)));
});

test('talos_sync_manual_validation: ledger append-only no run state (D24)', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    extraManualAc: true,
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
      { id: 'AC-003', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | validated | x | dev | y | ok 1 |',
    '| MV-S01-AC-003 | S01 / AC-003 | normal | pending | x | staging | y | — |',
  ]);
  const runId = 'r-ledger';
  const first = syncManualValidation({ run_id: runId, project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(first.status, 'passed');
  const state1 = runState({ run_id: runId, project_root: root });
  assert.ok(Array.isArray(state1.data.manual_validation));
  const n1 = state1.data.manual_validation.length;
  assert.ok(n1 >= 1);
  assert.ok(state1.data.manual_validation.some((e) => e.mv_id === 'MV-S01-AC-002' && e.next_status === 'proved'));
  // Segunda sync (mesmo run_id): AC-003 validado → append, sem apagar o primeiro.
  writeManualValidationReport(root, [
    '| MV-S01-AC-003 | S01 / AC-003 | normal | validated | x | staging | y | ok 2 |',
  ]);
  const second = syncManualValidation({ run_id: runId, project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(second.status, 'passed');
  const state2 = runState({ run_id: runId, project_root: root });
  assert.ok(state2.data.manual_validation.length > n1, 'ledger deve crescer (append-only)');
  assert.deepEqual(
    state2.data.manual_validation.slice(0, n1),
    state1.data.manual_validation,
    'eventos anteriores preservados',
  );
});

// ===== Plano 5 — flag revalidation_required e cone (AC-5.* / CN4 / D2/D6/D10/D20) =====

test('revalidation_required não pertence a BACKLOG_STATES (AC-5.1.1 / INV4)', () => {
  // (a) textual: enum canônico do MCP sem a flag (fonte é o código real).
  const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const enumLine = source.split('\n').find((line) => line.includes('const BACKLOG_STATES = new Set'));
  assert.ok(enumLine, 'BACKLOG_STATES deve existir');
  assert.doesNotMatch(enumLine, /revalidation_required/i, 'flag não pode entrar no enum de status');
  // (b) comportamental: status `revalidation_required` é rejeitado como status inválido.
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | ready | ready | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
  ]));
  const r = updateSprintStatus({
    run_id: 'r51',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'revalidation_required',
    validator_verdict: 'pass',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'status' && /inválido/.test(p.message)));
});

test('update_sprint_status: done bloqueado com revalidation_required ligada (AC-5.1.2)', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'manual_validation_pending', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | `.talos/state/S01.json` | true |',
  ]));
  // Sem acceptance_results no state: revalidação não observada → fail-closed.
  writeStateWithAcceptance(root, 'S01.json', undefined);
  const before = fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8');
  const r = updateSprintStatus({
    run_id: 'r52',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'blocked');
  assert.ok(r.pendencies.some((p) => p.category === 'revalidation_required'));
  assert.equal(r.next_action, 'revalidar_aceite_afetado');
  // zero mutação e zero handoff.
  assert.equal(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'), before);
  const handoffs = fs.existsSync(path.join(root, '.talos/memory'))
    ? fs.readdirSync(path.join(root, '.talos/memory')).filter((name) => /^HANDOFF_.*_\d{8}\.md$/.test(name))
    : [];
  assert.equal(handoffs.length, 0);
});

test('update_sprint_status: done com flag ligada exige revalidação (todos proved) e limpa a flag', () => {
  const root = tmpRoot();
  writeHandoffTemplateFixture(root);
  writeSprintFixture(root, 'S01', { status: 'manual_validation_pending', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Runtime | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | `.talos/state/S01.json` | true |',
  ]));
  // Revalidação observada: state com acceptance_results todos proved (D10).
  writeStateWithAcceptance(root, 'S01.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
    { id: 'AC-002', status: 'proved', proof_types: ['I:present', 'T-outcome:proved', 'M:validated'] },
  ]);
  const r = updateSprintStatus({
    run_id: 'r53',
    project_root: root,
    backlog_path: 'BACKLOG.md',
    sprint_id: 'S01',
    status: 'done',
    validator_verdict: 'pass',
    state_path: '.talos/state/S01.json',
  });
  assert.equal(r.status, 'passed', JSON.stringify(r.pendencies, null, 1));
  assert.equal(r.next_status, 'done');
  assert.ok(r.handoff_path);
  const row = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'))[0];
  assert.equal(row.state, 'done');
  assert.equal(row.revalidation_required, false, 'revalidação concluída deve limpar a flag');
  const sprint = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), 'utf8');
  assert.match(sprint, /^\| Revalidação \| false \|$/m, 'metadado sync no sprint file (D2)');
});

test('parseSprintRows: índices estáveis — state row[10], state_file row[14], revalidation row[15] (AC-5.1.3)', () => {
  const rows = parseSprintRows(backlogWithRows([
    '| S01 | A | F0 | o | Must | Alto | Baixo | P0 | pendente | — | review | g | a.md | b.md | c.json | true |',
    '| S02 | B | F0 | o | Must | Alto | Baixo | P0 | pendente | S01 | doing | g | a.md | b.md | c.json | yes |',
    '| S03 | C | F0 | o | Must | Alto | Baixo | P0 | pendente | — | done | g | a.md | b.md | c.json | 1 |',
    '| S04 | D | F0 | o | Must | Alto | Baixo | P0 | pendente | — | done | g | a.md | b.md | c.json | FALSE |',
    '| S05 | E | F0 | o | Must | Alto | Baixo | P0 | pendente | — | done | g | a.md | b.md | c.json | — |',
    '| S06 | F | F0 | o | Must | Alto | Baixo | P0 | pendente | — | done | g | a.md | b.md | c.json |',
  ]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  // Estado permanece no índice 10; State file no 14; Revalidação derivada do 15.
  assert.equal(byId.get('S01').state, 'review');
  assert.equal(byId.get('S01').state_file, 'c.json');
  assert.equal(byId.get('S01').revalidation_required, true);
  assert.equal(byId.get('S02').revalidation_required, true, 'yes liga a flag');
  assert.equal(byId.get('S03').revalidation_required, true, '1 liga a flag');
  assert.equal(byId.get('S04').revalidation_required, false, 'FALSE não liga');
  assert.equal(byId.get('S05').revalidation_required, false, '— não liga');
  // Coluna ausente (artefato 0.15 com 15 células) = vazia/false, sem quebrar.
  assert.equal(byId.get('S06').state, 'done');
  assert.equal(byId.get('S06').state_file, 'c.json');
  assert.equal(byId.get('S06').revalidation_required, false);
});

test('propagateRevalidation: fecho transitivo de Depende de (AC-5.2.1 unit)', () => {
  const rows = parseSprintRows(backlogWithRows([
    '| S01 | Origem | F0 | o | Must | Alto | Baixo | P0 | pendente | — | blocked | g | a.md | b.md | c.json |',
    '| S02 | Dep1 | F0 | o | Must | Alto | Baixo | P0 | pendente | S01 | review | g | a.md | b.md | c.json |',
    '| S03 | Dep2 | F0 | o | Must | Alto | Baixo | P0 | pendente | S02 | review | g | a.md | b.md | c.json |',
    '| S04 | Indep | F0 | o | Must | Alto | Baixo | P0 | pendente | — | review | g | a.md | b.md | c.json |',
  ]));
  const flagged = propagateRevalidation(rows, ['S01']);
  assert.deepEqual([...flagged].sort(), ['S02', 'S03']);
});

test('M failed liga revalidation_required no cone (CN4 / AC-5.2.1)', () => {
  const root = tmpRoot();
  setupMvpSprint(root, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  // Grafo S01 ← S02 ← S03; S04 independente.
  writeSprintFixture(root, 'S02', { status: 'review', dorStatus: 'verde' });
  writeSprintFixture(root, 'S03', { status: 'review', dorStatus: 'verde' });
  writeSprintFixture(root, 'S04', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Origem | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | `.talos/state/S01.json` |',
    '| S02 | Dep1 | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | review | g | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
    '| S03 | Dep2 | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S02 | review | g | `.talos/backlog/sprints/SPRINT_S03_runtime.md` | pendente | pendente |',
    '| S04 | Indep | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | g | `.talos/backlog/sprints/SPRINT_S04_runtime.md` | pendente | pendente |',
  ]));
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | failed | passo a passo | dev | resultado observável | smoke falhou no fluxo X |',
  ]);
  const r = syncManualValidation({ run_id: 'r-cone', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed', JSON.stringify(r.pendencies, null, 1));
  assert.equal(r.sprints[0].sprint_id, 'S01');
  assert.equal(r.sprints[0].state, 'blocked', 'origem com M falho fica blocked');
  assert.equal(r.handoff_path, null);
  const rows = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'));
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get('S01').revalidation_required, false, 'origem não recebe a flag');
  assert.equal(byId.get('S02').revalidation_required, true, 'dependente direto recebe a flag');
  assert.equal(byId.get('S03').revalidation_required, true, 'fecho transitivo recebe a flag');
  assert.equal(byId.get('S04').revalidation_required, false, 'independente não recebe a flag');
  // D2: metadado sync no sprint file dos dependentes flagados; independente intacto.
  const s02 = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S02_runtime.md'), 'utf8');
  assert.match(s02, /^\| Revalidação \| true \|$/m);
  const s03 = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S03_runtime.md'), 'utf8');
  assert.match(s03, /^\| Revalidação \| true \|$/m);
  const s04 = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S04_runtime.md'), 'utf8');
  assert.match(s04, /^\| Revalidação \| false \|$/m);
});

test('sync com M failed na origem e M validated no dependente: dependente done limpa a flag no mesmo sync (CN3 x CN4)', () => {
  // Revalidação observada no MESMO sync que ligou o cone: o dependente direto
  // (S02) é revalidado (M validated → state todos proved) e promovido a done
  // com a flag limpa — CN3 preservado para dependentes flagados; S03 (fecho
  // transitivo, sem linha no relatório) permanece com a flag.
  const root = tmpRoot();
  setupMvpSprint(root, {
    acceptance: [
      { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
      { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
    ],
  });
  writeSprintWithManual(root, 'S02', { status: 'manual_validation_pending', dorStatus: 'verde' });
  writeSprintFixture(root, 'S03', { status: 'review', dorStatus: 'verde' });
  writeSprintFixture(root, 'S04', { status: 'review', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Origem | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | `.talos/state/S01.json` |',
    '| S02 | Dep1 | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | manual_validation_pending | validator:pass;manual_pending | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | `.talos/state/S02.json` |',
    '| S03 | Dep2 | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S02 | review | g | `.talos/backlog/sprints/SPRINT_S03_runtime.md` | pendente | pendente |',
    '| S04 | Indep | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | g | `.talos/backlog/sprints/SPRINT_S04_runtime.md` | pendente | pendente |',
  ]));
  writeStateWithAcceptance(root, 'S02.json', [
    { id: 'AC-001', status: 'proved', proof_types: ['I:present', 'T-outcome:proved'] },
    { id: 'AC-002', status: 'manual_pending', proof_types: ['I:present', 'M:pending'] },
  ]);
  writeManualValidationReport(root, [
    '| MV-S01-AC-002 | S01 / AC-002 | alta | failed | passo a passo | dev | resultado observável | smoke falhou no fluxo X |',
    '| MV-S02-AC-002 | S02 / AC-002 | alta | validated | passo a passo | dev | resultado observável | revalidado com sucesso |',
  ]);
  const r = syncManualValidation({ run_id: 'r-cone-clear', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed', JSON.stringify(r.pendencies, null, 1));
  const rows = parseSprintRows(fs.readFileSync(path.join(root, 'BACKLOG.md'), 'utf8'));
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get('S01').state, 'blocked', 'origem com M falho fica blocked');
  assert.equal(byId.get('S01').revalidation_required, false, 'origem não recebe a flag');
  assert.equal(byId.get('S02').state, 'done', 'dependente revalidado no mesmo sync promove done');
  assert.equal(byId.get('S02').revalidation_required, false, 'revalidação concluída limpa a flag na promoção');
  assert.equal(byId.get('S03').revalidation_required, true, 'fecho transitivo preservado (sem linha no relatório)');
  assert.equal(byId.get('S04').revalidation_required, false, 'independente intacto');
  assert.ok(r.handoff_path, 'done do dependente emite handoff (CN3 preservado)');
  const s02 = fs.readFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S02_runtime.md'), 'utf8');
  assert.match(s02, /^\| Revalidação \| false \|$/m, 'metadado sprint limpo (D2)');
});

test('talos_select_next_sprint: flag revalidation_required não exclui candidata (AC-5.2.2)', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S01', { status: 'done', dorStatus: 'verde' });
  writeSprintFixture(root, 'S02', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Base | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | done | validator:pass | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
    '| S02 | Depende | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | ready | ready | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente | true |',
  ]));
  const r = selectNextSprint({ run_id: 'r522', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(r.status, 'passed');
  assert.equal(r.selected.sprint_id, 'S02', 'flag não filtra candidata pronta com deps ok');
  assert.ok(!r.rejected.some((item) => item.id === 'S02'));
});

test('BACKLOG_MESTRE_TEMPLATE: coluna Revalidação após State no fim do índice (Plano 5)', () => {
  const templatePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../templates/BACKLOG_MESTRE_TEMPLATE.md',
  );
  const template = fs.readFileSync(templatePath, 'utf8');
  const headerLine = template.split('\n').find((line) => /^\| ID \| Sprint \|/.test(line));
  assert.ok(headerLine, 'header do registro de sprints');
  assert.match(headerLine, /\| State \| Revalidação \|\s*$/, 'Revalidação é a última coluna (índice 15)');
  assert.match(template, /Revalidação \(flag, não status\)/);
  // flag não vira status na cadeia §5.1.
  assert.doesNotMatch(template, /→ revalidation_required →/);
  assert.doesNotMatch(template, /manual_validation_pending → revalidation_required/);
});

test('SPRINT_TEMPLATE: metadado Revalidação no §1 (D2)', () => {
  const templatePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../templates/SPRINT_TEMPLATE.md',
  );
  const template = fs.readFileSync(templatePath, 'utf8');
  assert.match(template, /^\| Revalidação \|/m);
  assert.match(template, /cone de revalidação, D2\/D20/);
});

test('talos_classify_input: plano → banner roteia com modo=execute (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'PLAN_x.md'), CONFORMANT_PLAN_DOC);
  const r = classifyInput({ run_id: 'r1', project_root: root, input_path: 'PLAN_x.md' });
  assert.equal(r.artifact_type, 'plan');
  assert.equal(r.routed_mode, 'execute');
  assert.equal(r.banner, '▸ talos: roteamento · input=plan → modo=execute');
});

test('talos_classify_input: unknown → banner BLOCK não-vazio (T07)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'notas.md'), 'texto solto sem estrutura');
  const r = classifyInput({ run_id: 'r1', project_root: root, input_path: 'notas.md' });
  assert.equal(r.artifact_type, 'unknown');
  assert.match(r.banner, /^▸ talos: preflight · BLOCK · /);
});

test('talos_classify_input: idea (texto livre, não arquivo) → not_a_file/direct, sem BLOCK (A6)', () => {
  const root = tmpRoot();
  const r = classifyInput({
    run_id: 'r1',
    project_root: root,
    input_path: 'criar .talos-smoke/SMOKE_PROOF.md — smoke test G9',
  });
  assert.equal(r.status, 'not_a_file');
  assert.equal(r.artifact_type, 'idea');
  assert.equal(r.routed_mode, 'direct');
  assert.equal(r.banner, '▸ talos: roteamento · input=idea → modo=direct');
  assert.doesNotMatch(r.banner, /BLOCK/);
});

test('talos_classify_input: path com cara de arquivo mas ausente → BLOCK (erro real, não idea) (A6)', () => {
  const root = tmpRoot();
  const r = classifyInput({ run_id: 'r1', project_root: root, input_path: 'PLAN_inexistente.md' });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ talos: preflight · BLOCK · /);
});

test('talos_preflight: execute qualificado → banner preflight · ok (T07)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rpf', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.banner, '▸ talos: preflight · ok (subagent+mcp)');
});

test('talos_preflight: modo inválido → banner BLOCK não-vazio (T07)', () => {
  const root = tmpRoot();
  const r = preflight({
    run_id: 'rpf2', project_root: root, mode: 'modo_invalido',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  assert.equal(r.status, 'blocked');
  assert.match(r.banner, /^▸ talos: preflight · BLOCK · /);
});

test('talos_lock_dispatch: start plan_execute em execute → banner exec não-vazio (T07)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'rld', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  const r = lockDispatch({ run_id: 'rld', project_root: root, action: 'start', phase: 'plan_execute' });
  assert.equal(r.status, 'passed');
  assert.match(r.banner, /^▸ talos: exec · slice \d+\/\d+$/);
});

test('talos_lock_dispatch: plan_execute cria liveness G12 no start e aceita checkpoint', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'g12live', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });

  const start = lockDispatch({ run_id: 'g12live', project_root: root, action: 'start', phase: 'plan_execute' });
  assert.equal(start.status, 'passed');

  let state = readRunJson(root, 'g12live');
  assert.equal(state.data.dispatch.active.phase, 'plan_execute');
  assert.equal(state.data.dispatch.active.liveness.status, 'spawned');
  assert.equal(state.data.dispatch.active.liveness.required_first_checkpoint, null);
  assert.equal(state.data.dispatch.active.base_sha, start.dispatch.active.base_sha);

  // G12 (D4): só first_write é checkpoint público; eventos antigos morreram.
  const dead = lockDispatch({
    run_id: 'g12live',
    project_root: root,
    action: 'checkpoint',
    phase: 'plan_execute',
    event: 'executor_started',
  });
  assert.equal(dead.status, 'blocked');
  assert.match(dead.error, /Checkpoint desconhecido/);

  const checkpoint = lockDispatch({
    run_id: 'g12live',
    project_root: root,
    action: 'checkpoint',
    phase: 'plan_execute',
    event: 'first_write',
    plan_path: '.talos/plans/PLAN_S41.md',
  });
  assert.equal(checkpoint.status, 'passed');
  assert.equal(checkpoint.executor_liveness, 'executing');

  state = readRunJson(root, 'g12live');
  assert.equal(state.data.dispatch.active.liveness.last_checkpoint, 'first_write');
  assert.equal(state.data.dispatch.active.liveness.checkpoints[0].plan_path, '.talos/plans/PLAN_S41.md');
  assert.ok(Array.isArray(state.data.dispatch.active.liveness.worktree_baseline));
  assert.equal(state.data.dispatch.history.at(-1).event, 'first_write');
});

test('talos_lock_dispatch: status marca bootstrap sem checkpoint como stalled e libera retry', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'g12stall', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'g12stall', project_root: root, action: 'start', phase: 'plan_execute' });

  const runFile = path.join(root, '.talos', 'state', 'g12stall', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.dispatch.active.started_at = '2000-01-01T00:00:00.000Z';
  raw.data.dispatch.active.liveness.bootstrap_deadline_at = '2000-01-01T00:02:00.000Z';
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  const status = lockDispatch({ run_id: 'g12stall', project_root: root, action: 'status', phase: 'plan_execute' });
  assert.equal(status.status, 'blocked');
  assert.equal(status.cause, 'executor_bootstrap_timeout');
  assert.equal(status.next_action, 'retry_plan_execute');

  const state = readRunJson(root, 'g12stall');
  assert.equal(state.data.dispatch.active, null);
  assert.equal(state.data.dispatch.executor_liveness.status, 'stalled');
  assert.equal(state.data.dispatch.next_phase, 'plan_execute');

  const retry = lockDispatch({ run_id: 'g12stall', project_root: root, action: 'start', phase: 'plan_execute' });
  assert.equal(retry.status, 'passed');
  assert.equal(readRunJson(root, 'g12stall').data.dispatch.active.phase, 'plan_execute');
});

test('talos_lock_dispatch: status marca checkpoint antigo sem progresso como stalled', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'g12progress', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'g12progress', project_root: root, action: 'start', phase: 'plan_execute' });
  lockDispatch({
    run_id: 'g12progress',
    project_root: root,
    action: 'checkpoint',
    phase: 'plan_execute',
    event: 'first_write',
  });

  const runFile = path.join(root, '.talos', 'state', 'g12progress', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.dispatch.active.liveness.last_progress_at = '2000-01-01T00:00:00.000Z';
  raw.data.dispatch.active.liveness.next_progress_deadline_at = '2000-01-01T00:05:00.000Z';
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  const status = lockDispatch({ run_id: 'g12progress', project_root: root, action: 'status', phase: 'plan_execute' });
  assert.equal(status.status, 'blocked');
  assert.equal(status.cause, 'executor_progress_timeout');
  assert.equal(status.next_action, 'retry_plan_execute');
  assert.equal(readRunJson(root, 'g12progress').data.dispatch.executor_liveness.status, 'stalled');
});

test('talos_lock_dispatch: handoff_ready não expira enquanto aguarda validator', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'g12handoff', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'g12handoff', project_root: root, action: 'start', phase: 'plan_execute' });
  // Caminho execute real (AC-1.3.1): commitState projeta v3, grava e marca
  // handoff_ready com sha no ledger — sem checkpoint público state_path_created.
  const commit = commitState({
    run_id: 'g12handoff',
    project_root: root,
    slice: 'A',
    proofs: [
      { kind: 'T', id: 'T01', check: 'node --test packages/mcp-server/server.test.js' },
      { kind: 'AC', id: 'AC-001', check: 'node --test packages/mcp-server/server.test.js' },
    ],
  });
  assert.equal(commit.status, 'passed');
  const stateRel = commit.state_path;
  const abs = path.join(root, stateRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const runFile = path.join(root, '.talos', 'state', 'g12handoff', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.dispatch.active.liveness.last_progress_at = '2000-01-01T00:00:00.000Z';
  raw.data.dispatch.active.liveness.next_progress_deadline_at = '2000-01-01T00:05:00.000Z';
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  const status = lockDispatch({ run_id: 'g12handoff', project_root: root, action: 'status', phase: 'plan_execute' });
  assert.equal(status.status, 'passed');
  assert.equal(status.executor_liveness, 'handoff_ready');
  assert.equal(readRunJson(root, 'g12handoff').data.dispatch.active.phase, 'plan_execute');
});

test('talos_lock_dispatch: events antigos de checkpoint são bloqueados (AC-1.2.5)', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'g12dead', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'g12dead', project_root: root, action: 'start', phase: 'plan_execute' });
  for (const event of ['executor_started', 'skill_loaded', 'plan_loaded', 'handoff_accepted', 'task_started', 'state_path_created']) {
    const result = lockDispatch({
      run_id: 'g12dead', project_root: root, action: 'checkpoint', phase: 'plan_execute', event,
    });
    assert.equal(result.status, 'blocked', event);
    assert.equal(result.gate, 'G12');
    assert.match(result.error, /Checkpoint desconhecido/);
  }
});

test('talos_lock_dispatch: first_write exige plan_execute ativo e é one-shot', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'g12path', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'g12path', project_root: root, action: 'start', phase: 'plan_execute' });

  const first = lockDispatch({
    run_id: 'g12path',
    project_root: root,
    action: 'checkpoint',
    phase: 'plan_execute',
    event: 'first_write',
  });
  assert.equal(first.status, 'passed');

  const second = lockDispatch({
    run_id: 'g12path',
    project_root: root,
    action: 'checkpoint',
    phase: 'plan_execute',
    event: 'first_write',
  });
  assert.equal(second.status, 'blocked');
  assert.equal(second.next_action, 'prosseguir_para_commit_state');

  const state = readRunJson(root, 'g12path');
  assert.ok(Array.isArray(state.data.dispatch.active.liveness.worktree_baseline));
  assert.equal(state.data.dispatch.active.liveness.checkpoints.filter((entry) => entry.event === 'first_write').length, 1);
});

test('talos_lock_validator: G12 bloqueia start sem commit MCP com sha (AC-1.3.1/1.3.2)', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'g12validator', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'g12validator', project_root: root, action: 'start', phase: 'plan_execute' });

  const stateRel = '.talos/state/g12validator/slice.json';
  // JSON v3 válido escrito à mão, SEM commitState → ledger sem sha → órfão.
  const abs = path.join(root, stateRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const baseline = captureWorktreeSnapshot(root);
  fs.writeFileSync(abs, JSON.stringify({
    state_schema_version: 3,
    run_id: 'g12validator', slice: 'A', base_sha: head, head_sha: head, contract_kind: 'plan',
    tasks: [], files_changed: [],
    diff_stat: '0 files', plan_path: '.talos/plans/x.md',
    boundary_refs: [], obligations: [], invariants: [], scenario_probes: [],
    risk_probes: [], validation_map: [], task_evidence: [], repair_evidence: [],
    worktree_baseline: baseline, worktree_final: baseline,
    executed_at: new Date().toISOString(), executor_skill: 'talos-plan-execute',
  }, null, 2));

  const beforeCommit = lockValidatorCore({
    run_id: 'g12validator',
    project_root: root,
    action: 'start',
    state_path: stateRel,
  });
  assert.equal(beforeCommit.status, 'blocked');
  assert.equal(beforeCommit.gate, 'G12');
  assert.equal(beforeCommit.next_action, 'commitar_via_talos_commit_state_antes_do_validator');

  // O JSON à mão (órfão) não pode ser sobrescrito pelo commit absoluto: remover
  // antes do commit legítimo — o commit é o writer único do path da slice.
  fs.rmSync(abs, { force: true });

  // Commit legítimo do path da slice (slice.json): handoff_ready + sha batem →
  // start passed (AC-1.3.1).
  const sliceCommit = commitState({
    run_id: 'g12validator',
    project_root: root,
    slice: 'slice',
    plan_path: '.talos/plans/x.md',
    proofs: [{ kind: 'T', id: 'T01', check: 'node --test packages/mcp-server/server.test.js' }],
  });
  assert.equal(sliceCommit.status, 'passed');
  const ok = lockValidatorCore({
    run_id: 'g12validator',
    project_root: root,
    action: 'start',
    state_path: stateRel,
  });
  assert.equal(ok.status, 'passed');
  assert.equal(ok.validator_status, 'running');
});

test('talos_lock_dispatch: plan_execute aceita passed_with_observations como terminal aprovado', () => {
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

test('talos_lock_validator: codex sibling bloqueia validator concorrente e exige repair antes do retry', () => {
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
    state_path: '.talos/state/rv1/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.validator_attempt, 1);
  assert.match(start1.validator_run_id, /^rv1:validator:1:/);

  const concurrent = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.talos/state/rv1/slice.json',
  });
  assert.equal(concurrent.status, 'blocked');
  assert.match(concurrent.error, /já está ativo/);

  const fail1 = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.talos/state/rv1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [finding()] },
  });
  assert.equal(fail1.status, 'passed');
  assert.equal(fail1.validator_status, 'repair_required');
  assert.equal(fail1.next_action, 'start_findings_repair_lock');

  const repairStart = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.talos/state/rv1/slice.json',
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
    state_path: '.talos/state/rv1/slice.json',
  });
  assert.equal(repairConcurrent.status, 'blocked');
  assert.match(repairConcurrent.error, /Repair já está ativo/);

  const retryBeforeRepair = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.talos/state/rv1/slice-repaired.json',
  });
  assert.equal(retryBeforeRepair.status, 'blocked');
  assert.equal(retryBeforeRepair.next_action, 'complete_findings_repair');

  const redirectedRepair = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/rv1/slice-repaired.json',
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
    state_path: '.talos/state/rv1/slice.json',
    data: resolvedRepair(root, '.talos/state/rv1/slice.json'),
  });
  assert.equal(repairDone.status, 'passed');
  assert.equal(repairDone.validator_status, 'ready_for_retry');

  const start2 = lockValidator({
    run_id: 'rv1',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.talos/state/rv1/slice.json',
  });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.validator_attempt, 2);
});

test('talos_lock_validator: terceiro validator é impossível e segundo fail bloqueia a slice', () => {
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
    state_path: '.talos/state/rv2/slice.json',
  });
  lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.talos/state/rv2/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [finding()] },
  });
  const repairStart = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.talos/state/rv2/slice.json',
  });
  assert.equal(repairStart.status, 'passed');
  const repair1 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: 'rv2:repair:1:fake',
    state_path: '.talos/state/rv2/slice-repaired.json',
  });
  assert.equal(repair1.status, 'blocked');
  assert.match(repair1.error, /repair_run_id não corresponde/);

  const repairConcurrent = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_start',
    state_path: '.talos/state/rv2/slice.json',
  });
  assert.equal(repairConcurrent.status, 'blocked');
  assert.match(repairConcurrent.error, /Repair já está ativo/);

  const repair1Done = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/rv2/slice.json',
    data: resolvedRepair(root, '.talos/state/rv2/slice.json'),
  });
  assert.equal(repair1Done.status, 'passed');

  const start2 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.talos/state/rv2/slice.json',
  });
  assert.equal(start2.status, 'passed');

  const fail2 = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.talos/state/rv2/slice.json',
    validator_run_id: start2.validator_run_id,
    verdict: 'fail',
    data: { findings: [finding({ file: 'y.ts', line: 2 })] },
  });
  assert.equal(fail2.status, 'blocked');
  assert.equal(fail2.validator_status, 'blocked_final_validator_failed');

  const third = lockValidator({
    run_id: 'rv2',
    project_root: root,
    host: 'codex',
    action: 'start',
    state_path: '.talos/state/rv2/slice-third.json',
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
    state_path: '.talos/state/s11a/slice.json',
  });
  assert.equal(start1.status, 'passed');

  const runFile = path.join(root, '.talos', 'state', 's11a', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.max_attempts = 99;
  raw.data.validator_cycle.attempts_used = 2;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  // Apesar de max_attempts=99 no disco, o teto efetivo é 2 → 3º proibido.
  const third = lockValidator({
    run_id: 's11a', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s11a/slice-third.json',
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
    state_path: '.talos/state/s11b/slice.json',
  });
  assert.equal(start1.status, 'passed');

  // Adultera: max_attempts=99, attempts_used=1, slot livre (idle) → permite attempt 2.
  const runFile = path.join(root, '.talos', 'state', 's11b', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.max_attempts = 99;
  raw.data.validator_cycle.attempts_used = 1;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  const start2 = lockValidator({
    run_id: 's11b', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s11b/slice-2.json',
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
    state_path: '.talos/state/s11c/slice.json',
  });
  assert.equal(start1.status, 'passed');

  const runFile = path.join(root, '.talos', 'state', 's11c', 'run.json');

  // Variante ausente → default 2.
  let raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  delete raw.data.validator_cycle.max_attempts;
  raw.data.validator_cycle.attempts_used = 1;
  raw.data.validator_cycle.status = 'idle';
  raw.data.validator_cycle.active = null;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));
  const startMissing = lockValidator({
    run_id: 's11c', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s11c/slice-missing.json',
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
    state_path: '.talos/state/s11c/slice-zero.json',
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
  const runFile = path.join(root, '.talos', 'state', 's11d', 'run.json');
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
    state_path: '.talos/state/s11d/slice-1.json',
  });
  assert.equal(start1.status, 'passed', 'attempt 1 deve ser permitido');
  assert.equal(start1.validator_attempt, 1);

  // Completa attempt 1 via fail → repair_required para liberar slot e manter
  // attempts_used=1 gravado no run.json pelo servidor.
  const complete1 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s11d/slice-1.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
  });
  assert.equal(complete1.status, 'passed', 'complete 1 deve funcionar');

  // Inicia repair (obrigatório após verdict=fail).
  const repairStart = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s11d/slice-1.json',
  });
  assert.equal(repairStart.status, 'passed', 'repair_start deve funcionar');

  // Conclui repair para liberar retry.
  const repairComplete = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/s11d/slice-1.json',
  });
  assert.equal(repairComplete.status, 'passed', 'repair_complete deve funcionar');

  // Attempt 2 — deve passar. O servidor leu attempts_used=1 (gravado por ele mesmo
  // após start1), não -5. Portanto validator_attempt=2.
  const start2 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s11d/slice-2.json',
  });
  assert.equal(start2.status, 'passed', 'attempt 2 deve ser permitido');
  assert.equal(start2.validator_attempt, 2, 'attempt 2 é o segundo dispatch correto');

  // Completa attempt 2 com fail: como attempt=2 >= max_attempts=2, o servidor
  // retorna status='blocked' sinalizando que o ciclo está esgotado
  // (blocked_final_validator_failed). Isso é o comportamento correto — o teto
  // foi respeitado e não há 3º dispatch disponível.
  const complete2 = lockValidator({
    run_id: 's11d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s11d/slice-2.json',
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
    state_path: '.talos/state/s11d/slice-3.json',
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
    const runFile = path.join(root, '.talos', 'state', runId, 'run.json');
    const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    raw.data.validator_cycle = raw.data.validator_cycle ?? {};
    raw.data.validator_cycle.attempts_used = badValue;
    raw.data.validator_cycle.status = 'idle';
    raw.data.validator_cycle.active = null;
    fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

    // Start deve ser permitido como attempt 1 (attempts_used normalizado para 0).
    const start = lockValidator({
      run_id: runId, project_root: root, host: 'codex', action: 'start',
      state_path: `.talos/state/${runId}/slice.json`,
    });
    assert.equal(
      start.status, 'passed',
      `attempts_used=${JSON.stringify(badValue)} deve normalizar para 0 e permitir attempt 1`,
    );
    assert.equal(start.validator_attempt, 1, `validator_attempt deve ser 1 para attempts_used=${JSON.stringify(badValue)}`);
  }
});

test('talos_lock_validator: retorno stale do validator não fecha slot ativo', () => {
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
    state_path: '.talos/state/rv4/slice.json',
  });

  const stale = lockValidator({
    run_id: 'rv4',
    project_root: root,
    host: 'codex',
    action: 'complete',
    state_path: '.talos/state/rv4/slice.json',
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
    state_path: '.talos/state/rv4/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(good.status, 'passed');
  assert.equal(good.validator_status, 'passed');
});

test('talos_lock_validator: sibling é a única topologia; todos os hosts operam o lock sem gate', () => {
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
    state_path: '.talos/state/rv3/slice.json',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.validator_status, 'running');
  assert.equal(r.validator_cycle.topology, undefined);
});

// --- S04: token de dispatch monotônico explícito no validator_cycle ---

function readRunJson(root, runId) {
  const file = path.join(root, '.talos', 'state', runId, 'run.json');
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
    state_path: '.talos/state/tok1/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.dispatch_token, 1);
  let cycle = readRunJson(root, 'tok1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, 1);
  assert.equal(cycle.active.dispatch_token, 1);

  // fail → repair → retry → segundo start incrementa o token (1 → 2).
  lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/tok1/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
  });
  // token sobrevive ao complete (preservado pelo merge), slot fechado.
  cycle = readRunJson(root, 'tok1').data.validator_cycle;
  assert.equal(cycle.dispatch_token, 1);
  assert.equal(cycle.active, null);

  const repairStart = lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/tok1/slice.json',
  });
  lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/tok1/slice.json',
    data: resolvedRepair(root, '.talos/state/tok1/slice.json'),
  });

  const start2 = lockValidator({
    run_id: 'tok1', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/tok1/slice.json',
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
    state_path: '.talos/state/tok2/slice.json',
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
    state_path: '.talos/state/tok2/slice.json',
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
    state_path: '.talos/state/tok3/slice.json',
  });
  assert.equal(start1.dispatch_token, 1);

  const stale = lockValidator({
    run_id: 'tok3', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/tok3/slice.json',
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
    state_path: '.talos/state/tok3/slice.json',
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
    state_path: '.talos/state/tok4/slice.json',
  });

  const missingToken = lockValidatorCore({
    run_id: 'tok4', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/tok4/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'pass',
  });
  assert.equal(missingToken.status, 'blocked');
  assert.equal(missingToken.stale_discarded, true);
  assert.equal(missingToken.next_action, 'reler_validator_recovery_e_reenviar_token');
  assert.notEqual(readRunJson(root, 'tok4').data.validator_cycle.active, null);
});

test('talos_assert_after_plan: execute → banner plano não-vazio (T07)', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'raa', project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  const r = assertAfterPlan({ run_id: 'raa', project_root: root, attempted_action: 'dispatch_plan_execute' });
  assert.equal(r.applicable, false);
  assert.equal(r.banner, '▸ talos: plano · validado (TC pass)');
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
    state_path: '.talos/state/mono1/slice.json',
  });
  const token1 = readRunJson(root, 'mono1').data.validator_cycle.dispatch_token;

  lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/mono1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [finding({ file: 'a.ts' })] },
  });

  // dispatch_token persiste após complete (não reseta).
  const tokenAfterFail = readRunJson(root, 'mono1').data.validator_cycle.dispatch_token;
  assert.equal(tokenAfterFail, token1);

  const repairStart = lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/mono1/slice.json',
  });
  lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/mono1/slice.json',
    data: resolvedRepair(root, '.talos/state/mono1/slice.json'),
  });

  const start2 = lockValidator({
    run_id: 'mono1', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/mono1/slice.json',
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
    state_path: '.talos/state/legacy1/slice.json',
  });

  // Reescrever o run.json removendo dispatch_token do ciclo e do active
  // para simular estado gerado por versão pré-S04.
  const runFile = path.join(root, '.talos', 'state', 'legacy1', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  delete raw.data.validator_cycle.dispatch_token;
  delete raw.data.validator_cycle.active.dispatch_token;
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));

  // Caso 1: caller envia dispatch_token=1 → normalizeValidatorCycle normaliza
  // o dispatch_token ausente como 0; active.dispatch_token ausente também normaliza
  // como 0. Divergência 0 !== 1 → blocked (sem mascarar, determinístico).
  const withToken = lockValidator({
    run_id: 'legacy1', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/legacy1/slice.json',
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
    state_path: '.talos/state/legacy1/slice.json',
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
    state_path: '.talos/state/claude1/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.validator_status, 'running');
  assert.equal(start1.dispatch_token, 1);
  assert.equal(start1.validator_cycle.topology, undefined, 'sem topology residual pós-S05');

  // 1º complete com verdict fail → status 'passed', validator_status 'repair_required', slot fecha.
  const fail1 = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'complete',
    state_path: '.talos/state/claude1/slice.json',
    validator_run_id: start1.validator_run_id,
    verdict: 'fail',
    data: { findings: [finding({ file: 'foo.ts' })] },
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
    state_path: '.talos/state/claude1/slice.json',
  });
  assert.ok(repairStart.repair_run_id, 'repair_run_id presente');
  lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/claude1/slice.json',
    data: resolvedRepair(root, '.talos/state/claude1/slice.json', 'F-001', 'foo.ts'),
  });

  // 2º start — attempt e dispatch_token incrementam (monotonicidade).
  const start2 = lockValidator({
    run_id: 'claude1', project_root: root, host: 'claude', action: 'start',
    state_path: '.talos/state/claude1/slice.json',
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
    state_path: '.talos/state/claude1/slice.json',
    validator_run_id: start2.validator_run_id,
    verdict: 'pass',
    data: { findings: [], repaired_finding_ids: ['F-001'] },
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
    state_path: '.talos/state/s10a/slice.json',
  });
  // attempt-1 falha → repair → attempt-2 (novo slot ativo).
  lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10a/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
  });
  const repairStart = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s10a/slice.json',
  });
  lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/s10a/slice.json',
    data: resolvedRepair(root, '.talos/state/s10a/slice.json'),
  });
  const start2 = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s10a/slice.json',
  });
  assert.equal(start2.status, 'passed');

  // attempt-1 (run_id antigo) chega tarde → blocked, stale_discarded, slot intacto.
  const stale = lockValidator({
    run_id: 's10a', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10a/slice.json',
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
    state_path: '.talos/state/s10b/slice.json',
  });
  const good = lockValidator({
    run_id: 's10b', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10b/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass_with_observations',
  });
  assert.equal(good.status, 'passed');
  assert.equal(good.validator_status, 'passed_with_observations');

  // Retorno duplicado do MESMO run_id após slot fechado.
  const dup = lockValidator({
    run_id: 's10b', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10b/slice.json',
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
    state_path: '.talos/state/s10b/slice.json',
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
    state_path: '.talos/state/s10c/slice.json',
  });
  lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10c/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
  });
  const repairStart = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s10c/slice.json',
  });
  const repairDone = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/s10c/slice.json',
    data: resolvedRepair(root, '.talos/state/s10c/slice.json'),
  });
  assert.equal(repairDone.status, 'passed');

  const runFile = path.join(root, '.talos/state/s10c/run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.history = [];
  fs.writeFileSync(runFile, JSON.stringify(raw));

  // Retorno duplicado do MESMO repair_run_id após repair concluído.
  const dup = lockValidator({
    run_id: 's10c', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/s10c/slice.json',
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
    state_path: '.talos/state/s10c/slice.json',
  });
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.stale_discarded, true);
  assert.equal(unknown.reason, undefined);
});

// (d) re-spun: ler estado de disco, obter validator_recovery determinístico.
test('S10(d): talos_run_state(get) expõe validator_recovery do slot ativo (recovery re-spun)', () => {
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
    state_path: '.talos/state/s10d/slice.json',
  });

  // Re-spun: leitura pura do disco expõe o slot esperado de forma determinística.
  const recovery = runState({ action: 'get', run_id: 's10d', project_root: root });
  assert.notEqual(recovery.validator_recovery, null);
  assert.equal(recovery.validator_recovery.expected_validator_run_id, start1.validator_run_id);
  assert.equal(recovery.validator_recovery.expected_dispatch_token, start1.dispatch_token);
  assert.equal(recovery.validator_recovery.expected_state_path, '.talos/state/s10d/slice.json');
  assert.equal(recovery.validator_recovery.status, 'running');

  // Após fechar o slot, validator_recovery volta a null.
  lockValidator({
    run_id: 's10d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10d/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  const after = runState({ action: 'get', run_id: 's10d', project_root: root });
  assert.equal(after.validator_recovery, null);
});

test('P2: talos_run_state(recovery) expõe só recovery mínimo do validator', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'recover1', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 'recover1', project_root: root, action: 'start', phase: 'plan_execute' });
  const start = lockValidator({
    run_id: 'recover1', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/recover1/slice.json',
  });

  const full = runState({ action: 'get', run_id: 'recover1', project_root: root });
  const recovery = runState({ action: 'recovery', run_id: 'recover1', project_root: root });

  assert.equal(recovery.run_id, 'recover1');
  assert.equal(recovery.validator_recovery.expected_validator_run_id, start.validator_run_id);
  assert.equal(recovery.validator_recovery.expected_dispatch_token, full.validator_recovery.expected_dispatch_token);
  assert.equal(recovery.validator_recovery.expected_state_path, '.talos/state/recover1/slice.json');
  assert.equal(Object.hasOwn(recovery, 'data'), false);
  assert.equal(Object.hasOwn(recovery, 'last_call'), false);
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
    state_path: '.talos/state/s10e/slice.json',
  });
  // Helper injeta o dispatch_token do validator_recovery, como faz o orquestrador.
  const good = lockValidator({
    run_id: 's10e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10e/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(good.status, 'passed');

  // Duplicado → idempotente reconhecível por run_id.
  const dup = lockValidator({
    run_id: 's10e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10e/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(dup.status, 'blocked');
  assert.equal(dup.stale_discarded, true);
  assert.equal(dup.reason, 'stale_duplicate_already_applied');
  assert.equal(dup.last_verdict, 'passed');
});

test('S10(e2): idempotência de validator não depende de history persistido', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10e2', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10e2', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10e2', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s10e2/slice.json',
  });
  lockValidator({
    run_id: 's10e2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10e2/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });

  const runFile = path.join(root, '.talos/state/s10e2/run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.history = [];
  fs.writeFileSync(runFile, JSON.stringify(raw));

  const dup = lockValidator({
    run_id: 's10e2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10e2/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(dup.status, 'blocked');
  assert.equal(dup.stale_discarded, true);
  assert.equal(dup.reason, 'stale_duplicate_already_applied');
  assert.equal(dup.applied_validator_status, 'passed');
});

// (f) P3-2: duplicado de attempt-1 (fail→repair_required) chegando com o ciclo
// já em repair_required. O complete fail grava marcador em `applied`; o duplicado
// tardio casa o evento e retorna applied_validator_status='repair_required' para
// o consumidor não confundir com slice concluída. Slot NÃO reabre.
test('S10(f): duplicado de attempt-1 (fail→repair_required) em repair_required → applied_validator_status=repair_required', () => {
  const root = tmpRoot();
  preflight({
    run_id: 's10f', project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: 's10f', project_root: root, action: 'start', phase: 'plan_execute' });

  const start1 = lockValidator({
    run_id: 's10f', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s10f/slice.json',
  });
  // attempt-1 falha → repair_required (result.status='passed', validator_status='repair_required').
  const fail1 = lockValidator({
    run_id: 's10f', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s10f/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
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
    state_path: '.talos/state/s10f/slice.json',
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
//     --[repair_start]-->    repair_running       (talos-findings-repair ativo)
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
    state_path: '.talos/state/s12fsm/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.equal(start1.validator_attempt, 1);
  assert.equal(status(), 'running', 'após validatorStart → running');
  assert.notEqual(slot(), null, 'running tem slot ativo');

  // running --[complete(fail), attempt<max]--> repair_required.
  const fail1 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12fsm/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
  });
  assert.equal(fail1.validator_status, 'repair_required');
  assert.equal(status(), 'repair_required', 'após complete(fail) attempt<max → repair_required');
  assert.equal(slot(), null, 'repair_required fecha o slot do validator');

  // repair_required --[repair_start]--> repair_running.
  const repairStart = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s12fsm/slice.json',
  });
  assert.equal(repairStart.validator_status, 'repair_running');
  assert.equal(status(), 'repair_running', 'após repair_start → repair_running');

  // repair_running --[repair_complete]--> ready_for_retry.
  const repairDone = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/s12fsm/slice.json',
    data: resolvedRepair(root, '.talos/state/s12fsm/slice.json'),
  });
  assert.equal(repairDone.validator_status, 'ready_for_retry');
  assert.equal(status(), 'ready_for_retry', 'após repair_complete → ready_for_retry (retry autorizado)');

  // ready_for_retry --[validatorStart]--> running (attempt 2, último dispatch).
  const start2 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s12fsm/slice.json',
  });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.validator_attempt, 2);
  assert.equal(status(), 'running', 'após 2º validatorStart → running (attempt 2)');

  // running --[complete(pass)]--> passed (TERMINAL).
  const pass2 = lockValidator({
    run_id: 's12fsm', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12fsm/slice.json',
    validator_run_id: start2.validator_run_id, verdict: 'pass',
    data: { findings: [], repaired_finding_ids: ['F-001'] },
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
    state_path: '.talos/state/s12fsm_pwo/slice.json',
  });
  assert.equal(start1.status, 'passed');
  assert.notEqual(slot(), null, 'slot ativo após start');

  // complete com pass_with_observations → passed_with_observations (TERMINAL).
  const pwo = lockValidator({
    run_id: 's12fsm_pwo', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12fsm_pwo/slice.json',
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
    state_path: '.talos/state/s12a/slice.json',
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
    state_path: '.talos/state/s12b/slice.json',
  });

  // repair_start com validator ativo: o 1º guard (validator ativo) dispara primeiro.
  const repairWhileActive = lockValidator({
    run_id: 's12b', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s12b/slice.json',
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
    state_path: '.talos/state/s12b2/slice.json',
  });
  lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12b2/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
  });
  // status → repair_running.
  lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s12b2/slice.json',
  });
  // 2º repair_start: repair já ativo → blocked (guard de concorrência dispara antes do "fora de ordem").
  const second = lockValidator({
    run_id: 's12b2', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s12b2/slice.json',
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
    state_path: '.talos/state/s12c/slice.json',
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
    state_path: '.talos/state/s12d/slice.json',
  });
  const pass1 = lockValidator({
    run_id: 's12d', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12d/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass',
  });
  assert.equal(pass1.validator_status, 'passed');
  assert.equal(readRunJson(root, 's12d').data.validator_cycle.status, 'passed');

  // Novo start sobre terminal passed → blocked (não reabre, não vira attempt 2).
  const reopen = lockValidator({
    run_id: 's12d', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s12d/slice-2.json',
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
    state_path: '.talos/state/s12d2/slice.json',
  });
  lockValidator({
    run_id: 's12d2', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12d2/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'pass_with_observations',
  });
  assert.equal(readRunJson(root, 's12d2').data.validator_cycle.status, 'passed_with_observations');

  const reopen = lockValidator({
    run_id: 's12d2', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s12d2/slice-2.json',
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
    state_path: '.talos/state/s12e/slice.json',
  });
  assert.equal(start1.status, 'passed', 'attempt 1 aceito');
  const fail1 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12e/slice.json',
    validator_run_id: start1.validator_run_id, verdict: 'fail',
    data: { findings: [finding()] },
  });
  assert.equal(fail1.validator_status, 'repair_required', 'fail1 → repair_required');

  const repairStart = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'repair_start',
    state_path: '.talos/state/s12e/slice.json',
  });
  lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'repair_complete',
    repair_run_id: repairStart.repair_run_id,
    state_path: '.talos/state/s12e/slice.json',
    data: resolvedRepair(root, '.talos/state/s12e/slice.json'),
  });

  // Attempt 2 (último): pass → terminal.
  const start2 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'start',
    state_path: '.talos/state/s12e/slice.json',
  });
  assert.equal(start2.status, 'passed', 'attempt 2 aceito');
  assert.equal(start2.validator_attempt, 2, 'é o attempt 2');
  const pass2 = lockValidator({
    run_id: 's12e', project_root: root, host: 'codex', action: 'complete',
    state_path: '.talos/state/s12e/slice.json',
    validator_run_id: start2.validator_run_id, verdict: 'pass',
    data: { findings: [], repaired_finding_ids: ['F-001'] },
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
    state_path: '.talos/state/s12e/slice-3.json',
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

// P2: `talos_run_state(upsert)` com `data` parcial DEVE preservar dispatch.active.
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
    data: { validator_handoff_required: true, state_path: '.talos/state/p2merge/slice.json' },
  });
  const after = readRunJson(root, 'p2merge');
  assert.equal(after.data.dispatch?.active?.phase, 'plan_execute', 'dispatch.active preservado após upsert parcial');
  assert.equal(after.data.validator_handoff_required, true, 'chave nova do upsert aplicada');
  assert.equal(after.data.routing?.mode, 'execute', 'routing preservado após upsert parcial');
});

test('P2: run ledger é persistido em JSON compacto', () => {
  const root = tmpRoot();
  runState({
    action: 'upsert',
    run_id: 'compact-ledger',
    project_root: root,
    phase: 'preflight',
    status: 'passed',
    data: { routing: { mode: 'execute' } },
  });

  const raw = fs.readFileSync(path.join(root, '.talos/state/compact-ledger/run.json'), 'utf8');
  assert.equal(raw.endsWith('\n'), true);
  assert.equal(raw.split('\n').length, 2, 'JSON compacto deve ocupar uma linha + newline final');
  assert.doesNotMatch(raw, /\n\s+"/, 'não deve persistir JSON pretty com indentação');
  assert.equal(JSON.parse(raw).run_id, 'compact-ledger');
});

test('P2: gates persistem ledger mínimo sem duplicar payload MCP completo', () => {
  const root = tmpRoot();
  preflight({
    run_id: 'compact-gates',
    project_root: root,
    mode: 'execute',
    host: 'codex',
    host_capabilities: { subagent_available: true, mcp_available: true },
  });

  const state = readRunJson(root, 'compact-gates');
  assert.equal(state.data.gates.G10.status, 'passed');
  assert.equal(state.data.gates.G10.gate, 'G10');
  assert.equal(state.data.routing.mode, 'execute');
  assert.equal(state.data.gates.G10.routing, undefined, 'routing completo fica só em data.routing');
  assert.equal(state.data.gates.G10.skills, undefined, 'skills completas não duplicam dentro de gates');
});

// Version-conflict: um run ANTIGO inativo (versão anterior do plugin) não pode
// travar um run NOVO. Antes do fix, findActiveRunConflict dava hard-fail de versão
// em qualquer run.json do diretório — quem atualizava de 0.6.x ficava com todo run
// novo bloqueado. Confirmado ao retomar PV08a (state pv01–pv07 em 0.6.2).
test('version-conflict: run antigo inativo de versão anterior não bloqueia run novo', () => {
  const root = tmpRoot();
  // Resíduo de versão anterior, sem dispatch ativo.
  const oldDir = path.join(root, '.talos', 'state', 'run-velho');
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

// Banner cosmético: verificar um sprint/contrato não pode ecoar "plano · validado".
test('banner: verify_artifact com artifact_kind=sprint ecoa banner de aceite; default mantém plano', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_x.md'), sprintDoc());
  fs.writeFileSync(path.join(root, 'PLAN_x.md'), CONFORMANT_PLAN_DOC);
  const sprint = verifyArtifact({ run_id: 'bk', project_root: root, artifact_path: 'SPRINT_x.md', artifact_kind: 'sprint' });
  assert.equal(sprint.status, 'passed');
  assert.equal(sprint.banner, '▸ talos: aceite · ok');
  const plan = verifyArtifact({ run_id: 'bk', project_root: root, artifact_path: 'PLAN_x.md' });
  assert.equal(plan.banner, '▸ talos: plano · validado (TC pass)', 'default (sem kind) preserva banner de plano');
});

test('verify_artifact: artifact_kind=json bloqueia JSON inválido e aprova JSON parseável', () => {
  const root = tmpRoot();
  const invalidPath = '.talos/state/json-gate/validator-output.json';
  const invalidAbs = path.join(root, invalidPath);
  fs.mkdirSync(path.dirname(invalidAbs), { recursive: true });
  fs.writeFileSync(invalidAbs, '{"msg":"\\$reason"}\n');

  const invalid = verifyArtifact({
    run_id: 'json-gate',
    project_root: root,
    artifact_path: invalidPath,
    artifact_kind: 'json',
  });
  assert.equal(invalid.status, 'blocked');
  assert.match(invalid.cause, /Invalid|escape|JSON/);

  fs.writeFileSync(invalidAbs, JSON.stringify({ msg: '$reason' }, null, 2));
  const valid = verifyArtifact({
    run_id: 'json-gate',
    project_root: root,
    artifact_path: invalidPath,
    artifact_kind: 'json',
  });
  assert.equal(valid.status, 'passed');
  assert.equal(valid.parsed_type, 'object');
});

// P1.1 — proof-of-work do validador irmão. Setup: run com plan_execute ativo, um
// state_path real apontando para files_changed com arquivo real no boundary.
function setupValidatorRun(runId, files = {}) {
  const { root, head } = initGitFixture();
  preflight({
    run_id: runId, project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  const filesChanged = Object.keys(files);
  const baseline = captureWorktreeSnapshot(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const finalSnapshot = captureWorktreeSnapshot(root);
  const sliceRel = `.talos/state/${runId}/slice.json`;
  const sliceAbs = path.join(root, sliceRel);
  fs.mkdirSync(path.dirname(sliceAbs), { recursive: true });
  fs.writeFileSync(sliceAbs, JSON.stringify({
    state_schema_version: 3,
    run_id: runId, slice: 'A', base_sha: head, head_sha: head, contract_kind: 'plan',
    tasks: ['T01'], files_changed: filesChanged,
    diff_stat: `${filesChanged.length} files`, plan_path: '.talos/plans/x.plan.md',
    boundary_refs: ['§2.I1'], obligations: [], invariants: [], scenario_probes: [],
    risk_probes: [], validation_map: [],
    task_evidence: filesChanged.map((file) => ({ task: 'T01', files: [file], checks: [], result: 'passed' })),
    repair_evidence: [],
    worktree_baseline: baseline, worktree_final: finalSnapshot,
    executed_at: '2026-06-15T00:00:00Z', executor_skill: 'talos-plan-execute',
  }, null, 2));
  return { root, sliceRel };
}

function sha256File(root, rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

test('proof-of-work: start emite challenge quando o boundary tem arquivo legível', () => {
  const { root, sliceRel } = setupValidatorRun('pow1', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow1', project_root: root, action: 'start', state_path: sliceRel });
  assert.equal(start.status, 'passed');
  assert.ok(start.challenge, 'challenge emitido');
  assert.equal(start.challenge.file, 'src/foo.js');
  assert.equal(start.challenge.algo, 'sha256');
  // Exposto ao validador via recovery (canal canônico).
  const rec = runState({ action: 'get', run_id: 'pow1', project_root: root }).validator_recovery;
  assert.equal(rec.challenge.file, 'src/foo.js');
});

test('proof-of-work: complete com hash correto passa e marca challenge_verified', () => {
  const { root, sliceRel } = setupValidatorRun('pow2', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow2', project_root: root, action: 'start', state_path: sliceRel });
  const done = lockValidator({
    run_id: 'pow2', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, 'src/foo.js'), verdict: 'pass',
  });
  assert.equal(done.status, 'passed');
  assert.equal(done.validator_status, 'passed');
  assert.equal(done.challenge_verified, 'verified');
});

test('talos_lock_validator: validator_output_path inválido bloqueia complete sem fechar slot', () => {
  const runId = 'validator-json-output';
  const { root, sliceRel } = setupValidatorRun(runId, { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: runId, project_root: root, action: 'start', state_path: sliceRel });
  const outputRel = `.talos/state/${runId}/validator-output.json`;
  const outputAbs = path.join(root, outputRel);
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
  fs.writeFileSync(outputAbs, '{"observations":[{"msg":"\\$reason"}]}\n');

  const blocked = lockValidator({
    run_id: runId,
    project_root: root,
    action: 'complete',
    state_path: sliceRel,
    validator_run_id: start.validator_run_id,
    dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file),
    validator_output_path: outputRel,
    verdict: 'pass',
    data: { findings: [] },
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.validator_status, 'invalid_validator_output_json');
  assert.notEqual(readRunJson(root, runId).data.validator_cycle.active, null);

  fs.writeFileSync(outputAbs, JSON.stringify({ verdict: 'pass', findings: [] }, null, 2));
  const passed = lockValidator({
    run_id: runId,
    project_root: root,
    action: 'complete',
    state_path: sliceRel,
    validator_run_id: start.validator_run_id,
    dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file),
    validator_output_path: outputRel,
    verdict: 'pass',
    data: { findings: [] },
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.validator_status, 'passed');
});

test('proof-of-work: complete aceita saída do shasum (hash + nome do arquivo)', () => {
  const { root, sliceRel } = setupValidatorRun('pow2b', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow2b', project_root: root, action: 'start', state_path: sliceRel });
  const done = lockValidator({
    run_id: 'pow2b', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: `${sha256File(root, 'src/foo.js')}  src/foo.js`, verdict: 'pass',
  });
  assert.equal(done.status, 'passed');
  assert.equal(done.challenge_verified, 'verified');
});

test('proof-of-work: complete com hash errado bloqueia (challenge_failed) sem fechar o slot', () => {
  const { root, sliceRel } = setupValidatorRun('pow3', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow3', project_root: root, action: 'start', state_path: sliceRel });
  const bad = lockValidator({
    run_id: 'pow3', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: 'deadbeef', verdict: 'pass',
  });
  assert.equal(bad.status, 'blocked');
  assert.equal(bad.validator_status, 'challenge_failed');
  assert.equal(bad.cause, 'validator_proof_of_work_failed');
  // Slot preservado: o mesmo validador pode reenviar o hash correto.
  const rec = runState({ action: 'get', run_id: 'pow3', project_root: root }).validator_recovery;
  assert.equal(rec.expected_validator_run_id, start.validator_run_id, 'slot ativo preservado');
  const good = lockValidator({
    run_id: 'pow3', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, 'src/foo.js'), verdict: 'pass',
  });
  assert.equal(good.status, 'passed');
});

test('proof-of-work: contador bounded não depende de history persistido', () => {
  const { root, sliceRel } = setupValidatorRun('pow3b', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow3b', project_root: root, action: 'start', state_path: sliceRel });
  const payload = {
    run_id: 'pow3b', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: 'deadbeef', verdict: 'pass',
  };
  const first = lockValidator(payload);
  assert.equal(first.validator_status, 'challenge_failed');
  assert.equal(first.challenge_failures, 1);

  const runFile = path.join(root, '.talos/state/pow3b/run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.validator_cycle.history = [];
  fs.writeFileSync(runFile, JSON.stringify(raw));

  const second = lockValidator(payload);
  assert.equal(second.validator_status, 'challenge_failed');
  assert.equal(second.challenge_failures, 2);
  const exhausted = lockValidator(payload);
  assert.equal(exhausted.validator_status, 'challenge_exhausted');
});

test('proof-of-work: challenge emitido exige challenge_response (ausência bloqueia)', () => {
  const { root, sliceRel } = setupValidatorRun('pow4', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow4', project_root: root, action: 'start', state_path: sliceRel });
  // Usa lockValidatorCore diretamente para testar a ausência real de
  // challenge_response — o wrapper lockValidator injeta o hash automaticamente
  // para testes do ciclo que não focam em proof-of-work.
  const noResp = lockValidatorCore({
    run_id: 'pow4', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token, verdict: 'pass',
    data: { findings: [] },
  });
  assert.equal(noResp.status, 'blocked');
  assert.equal(noResp.validator_status, 'challenge_failed');
  assert.match(noResp.error, /challenge_response_ausente/);
});

test('proof-of-work: arquivo removido após challenge falha fechado e consome orçamento bounded', () => {
  const { root, sliceRel } = setupValidatorRun('pow-file-removed', {
    'src/foo.js': 'export const x = 1;\n',
  });
  const start = lockValidator({
    run_id: 'pow-file-removed', project_root: root, action: 'start', state_path: sliceRel,
  });
  fs.rmSync(path.join(root, start.challenge.file));
  const payload = {
    run_id: 'pow-file-removed', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: 'deadbeef', verdict: 'pass',
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const failed = lockValidator(payload);
    assert.equal(failed.status, 'blocked');
    assert.equal(failed.validator_status, 'challenge_failed');
    assert.match(failed.error, /challenge_file_unreadable/);
    assert.equal(failed.challenge_failures, attempt);
  }
  const exhausted = lockValidator(payload);
  assert.equal(exhausted.status, 'blocked');
  assert.equal(exhausted.validator_status, 'challenge_exhausted');
});

test('proof-of-work: arquivo ilegível após challenge nunca aprova o veredito', {
  skip: process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0),
}, () => {
  const { root, sliceRel } = setupValidatorRun('pow-file-unreadable', {
    'src/foo.js': 'export const x = 1;\n',
  });
  const start = lockValidator({
    run_id: 'pow-file-unreadable', project_root: root, action: 'start', state_path: sliceRel,
  });
  const challenged = path.join(root, start.challenge.file);
  fs.chmodSync(challenged, 0o000);
  try {
    const failed = lockValidator({
      run_id: 'pow-file-unreadable', project_root: root, action: 'complete', state_path: sliceRel,
      validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
      challenge_response: 'deadbeef', verdict: 'pass',
    });
    assert.equal(failed.status, 'blocked');
    assert.equal(failed.validator_status, 'challenge_failed');
    assert.match(failed.error, /challenge_file_unreadable/);
  } finally {
    fs.chmodSync(challenged, 0o600);
  }
});

function initGitFixture() {
  const root = tmpRoot();
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'talos@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Talos Test']);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  execFileSync('git', ['-C', root, 'add', 'README.md']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'base']);
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { root, head };
}

function fixtureState(name, replacements = {}) {
  let raw = fs.readFileSync(path.resolve('packages/mcp-server/fixtures', name), 'utf8');
  for (const [token, value] of Object.entries(replacements)) raw = raw.replaceAll(token, value);
  return JSON.parse(raw);
}

function withSnapshot(state, root, baseline = []) {
  state.worktree_baseline = baseline;
  state.worktree_final = captureWorktreeSnapshot(root);
  return state;
}

function writeSliceState(root, runId, state) {
  const sliceRel = `.talos/state/${runId}/slice.json`;
  const abs = path.join(root, sliceRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ ...state, run_id: runId }, null, 2));
  return sliceRel;
}

function compactStateV3(state) {
  const files = state.files_changed ?? [];
  const checkTable = [...new Set([
    ...(state.validation_map ?? []).flatMap((item) => item.checks ?? []),
    ...(state.task_evidence ?? []).flatMap((item) => item.checks ?? []),
    ...(state.eval_results ?? []).flatMap((item) => item.checks ?? []),
    ...(state.repair_evidence ?? []).flatMap((item) => item.checks_run ?? []),
  ])];
  const fileIndexes = (items = []) => items.map((item) => files.indexOf(item)).filter((index) => index >= 0);
  const checkIndexes = (items = []) => items.map((item) => checkTable.indexOf(item)).filter((index) => index >= 0);
  const out = {
    state_schema_version: 3,
    run_id: state.run_id,
    slice: state.slice,
    base_sha: state.base_sha,
    head_sha: state.head_sha,
    contract_kind: state.contract_kind,
    tasks: state.tasks,
    files_changed: files,
    diff_stat: state.diff_stat,
    plan_path: state.plan_path,
    boundary_refs: state.boundary_refs,
    sprint_id: state.sprint_id,
    sprint_file_path: state.sprint_file_path,
    prd_path: state.prd_path,
    contract_ids: {
      obligations: (state.obligations ?? []).map((item) => item.id).filter(Boolean),
      invariants: (state.invariants ?? []).map((item) => item.id).filter(Boolean),
      scenarios: (state.scenario_probes ?? []).map((item) => item.id).filter(Boolean),
      risks: (state.risk_probes ?? []).map((item) => item.id).filter(Boolean),
    },
    eval_results: (state.eval_results ?? []).map((item) => ({
      id: item.id,
      status: item.status,
      evidence: item.evidence ?? [],
      checks: checkIndexes(item.checks),
    })),
    policy_scope: state.policy_scope,
    check_table: checkTable,
    validation_map: (state.validation_map ?? []).map((item) => ({
      obligation_ids: item.obligation_ids ?? [],
      checks: checkIndexes(item.checks),
      status: item.status,
    })),
    task_evidence: (state.task_evidence ?? []).map((item) => ({
      task: item.task,
      files: fileIndexes(item.files),
      checks: checkIndexes(item.checks),
      result: item.result,
    })),
    repair_evidence: (state.repair_evidence ?? []).map((item) => ({
      finding_id: item.finding_id,
      files: fileIndexes(item.files_touched),
      checks: checkIndexes(item.checks_run),
      status: item.status,
    })),
    worktree_baseline: (state.worktree_baseline ?? []).map((item) => [item.path, item.status, item.sha256]),
    worktree_final: (state.worktree_final ?? []).map((item) => [item.path, item.status, item.sha256]),
    executed_at: state.executed_at,
    executor_skill: state.executor_skill,
  };
  for (const key of ['sprint_id', 'sprint_file_path', 'prd_path', 'policy_scope']) {
    if (out[key] === undefined) delete out[key];
  }
  if (!Array.isArray(state.eval_results)) delete out.eval_results;
  return out;
}

// AC-2.1.1: state v2 é hard-fail em 0.15 (LEG2 morto). v1 implícito também.
// Antes (0.14): v1/v2 eram aceitos/normalizados. Agora só state_schema_version:3.
test('AC-2.1.1: state com state_schema_version:2 é rejeitado (hard-fail legado)', () => {
  const root = tmpRoot();
  const state = fixtureState('state-legacy-plan.json');
  state.state_schema_version = 2;
  const statePath = writeSliceState(root, state.run_id, state);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /state_schema_version deve ser 3.*recebido 2/);
});

test('AC-2.1.1: state v1 implícito (sem state_schema_version) é rejeitado', () => {
  const root = tmpRoot();
  const state = fixtureState('state-legacy-plan.json');
  const statePath = writeSliceState(root, state.run_id, state);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /state_schema_version deve ser 3.*recebido 1/);
});

test('Etapa 2: direct sem obligations bloqueia', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/direct.js'), 'export const direct = true;\n');
  const state = fixtureState('state-direct.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  state.obligations = [];
  const statePath = writeSliceState(root, state.run_id, state);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('direct exige obligations não vazio'));
});

test('Etapa 2: direct aceita schema v3 compacto com obligations por ID', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/direct.js'), 'export const direct = true;\n');
  const state = fixtureState('state-direct.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  withSnapshot(state, root);
  const compact = compactStateV3(state);
  const statePath = writeSliceState(root, 'direct-v3', compact);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.obligations, [{ id: 'O1' }]);
  assert.deepEqual(result.state.task_evidence[0].files, ['src/direct.js']);
});

test('Etapa 2: fixtures plan e direct novos passam no mesmo validator de state', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/direct.js'), 'export const direct = true;\n');
  const direct = fixtureState('state-direct.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  withSnapshot(direct, root);
  const directPath = writeSliceState(root, direct.run_id, direct);
  assert.equal(validateStateBoundary(directPath, { project_root: root }).ok, true);
  const planBaseline = captureWorktreeSnapshot(root);
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  const plan = fixtureState('state-repair.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  plan.files_changed = ['src/initial.js'];
  plan.diff_stat = '1 file';
  plan.repair_evidence = [];
  withSnapshot(plan, root, planBaseline);
  const planPath = writeSliceState(root, 'fixture-plan-current', plan);
  assert.equal(validateStateBoundary(planPath, { project_root: root }).ok, true);
});

function planStateForBoundary(root, head, baseline, files) {
  const state = fixtureState('state-repair.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  state.files_changed = [...files].sort();
  state.diff_stat = `${files.length} files`;
  state.task_evidence = [{ task: 'T03', files: [...files].sort(), checks: ['node --test'], result: 'passed' }];
  state.repair_evidence = [];
  return withSnapshot(state, root, baseline);
}

function attachSprintEvidence(state, { id = 'S01', sprintPath = '.talos/backlog/sprints/SPRINT_S01_runtime.md' } = {}) {
  state.sprint_id = id;
  state.sprint_file_path = sprintPath;
  state.prd_path = '.talos/prd/PRD_S01_runtime.md';
  state.eval_results = [{
    id: 'EVAL-001',
    claim: 'gate passa',
    status: 'passed',
    evidence: ['node --test packages/mcp-server/server.test.js'],
    checks: ['node --test packages/mcp-server/server.test.js'],
  }];
  state.evidence_to_claim = [{
    claim_id: 'EVAL-001',
    source: `${sprintPath} §9`,
    evidence: ['node --test packages/mcp-server/server.test.js'],
    status: 'passed',
  }];
  state.policy_scope = {
    forbidden_scope: ['secrets'],
    required_gates: ['talos_verify_sprint_file', 'talos-task-validator'],
  };
  return state;
}

function setupSprintEvidenceBoundary(runId = 'sprint-state-ok') {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  const baseline = captureWorktreeSnapshot(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  const state = attachSprintEvidence(planStateForBoundary(root, head, baseline, ['src/initial.js']));
  const statePath = writeSliceState(root, runId, state);
  return { root, statePath, state };
}

test('state boundary: sprint/eval/policy completos passam', () => {
  const { root, statePath } = setupSprintEvidenceBoundary();
  assert.equal(validateStateBoundary(statePath, { project_root: root }).ok, true);
});

test('state boundary: schema v3 compacto passa sem evidence_to_claim persistido', () => {
  const { root, statePath, state } = setupSprintEvidenceBoundary('sprint-state-v3');
  const compact = compactStateV3(state);
  assert.equal(compact.evidence_to_claim, undefined);
  fs.writeFileSync(path.join(root, statePath), JSON.stringify(compact));
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, true);
  assert.equal(result.state.state_schema_version, 3);
  assert.deepEqual(result.state.task_evidence[0].files, ['src/initial.js']);
  assert.ok(result.state.worktree_final.some((item) => item.path === 'src/initial.js'));
  assert.deepEqual(result.state.evidence_to_claim.map((item) => item.claim_id), ['EVAL-001']);
});

test('state boundary: schema v3 bloqueia índice compacto inválido', () => {
  const { root, statePath, state } = setupSprintEvidenceBoundary('sprint-state-v3-invalid-index');
  const compact = compactStateV3(state);
  compact.task_evidence[0].files = [99];
  fs.writeFileSync(path.join(root, statePath), JSON.stringify(compact));
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /task_evidence\[0\]\.files\[0\] índice inválido/);
});

test('state boundary: schema v3 com EVAL ausente não exige evidence_to_claim legado', () => {
  const { root, statePath, state } = setupSprintEvidenceBoundary('sprint-state-v3-missing-eval');
  const compact = compactStateV3(state);
  compact.eval_results = [];
  fs.writeFileSync(path.join(root, statePath), JSON.stringify(compact));
  const result = validateStateBoundary(statePath, { project_root: root });
  const joined = result.violations.join(' ');
  assert.equal(result.ok, false);
  assert.match(joined, /EVAL sem resultado/);
  assert.doesNotMatch(joined, /evidence_to_claim/);
});

test('state boundary: sprint declarado exige todos EVAL-* como passed e evidence_to_claim', () => {
  const missing = setupSprintEvidenceBoundary('sprint-state-missing-eval');
  missing.state.eval_results = [];
  fs.writeFileSync(path.join(missing.root, missing.statePath), JSON.stringify({ ...missing.state, run_id: 'sprint-state-missing-eval' }, null, 2));
  let result = validateStateBoundary(missing.statePath, { project_root: missing.root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /EVAL sem resultado/);

  const failed = setupSprintEvidenceBoundary('sprint-state-failed-eval');
  failed.state.eval_results[0].status = 'failed';
  fs.writeFileSync(path.join(failed.root, failed.statePath), JSON.stringify({ ...failed.state, run_id: 'sprint-state-failed-eval' }, null, 2));
  result = validateStateBoundary(failed.statePath, { project_root: failed.root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /EVAL não comprovado como passed/);
});

test('state boundary: policy_scope.forbidden_scope bloqueia arquivo tocado', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  const baseline = captureWorktreeSnapshot(root);
  fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'secrets/token.txt'), 'nope\n');
  const state = attachSprintEvidence(planStateForBoundary(root, head, baseline, ['secrets/token.txt']));
  const statePath = writeSliceState(root, 'sprint-state-policy-block', state);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /forbidden_scope/);
});

test('state boundary: allowed_scope legado é informativo, não lista permitida', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  const baseline = captureWorktreeSnapshot(root);
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/outside.js'), 'export const outside = true;\n');
  const state = attachSprintEvidence(planStateForBoundary(root, head, baseline, ['tests/outside.js']));
  state.policy_scope.allowed_scope = ['src'];
  const statePath = writeSliceState(root, 'sprint-state-allowed-informative', state);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, true);
});

test('state boundary: allowed_scope legado inválido falha como shape, não como boundary', () => {
  const boundary = setupSprintEvidenceBoundary('sprint-state-allowed-invalid');
  boundary.state.policy_scope.allowed_scope = 'src';
  fs.writeFileSync(path.join(boundary.root, boundary.statePath), JSON.stringify({ ...boundary.state, run_id: 'sprint-state-allowed-invalid' }, null, 2));
  const result = validateStateBoundary(boundary.statePath, { project_root: boundary.root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /allowed_scope deve ser array/);
});

// AC-2.2.1: proof_ref a teste sem assert de outcome → unproved (D22 oráculo).
// Fixture: arquivo de teste que só chama o caminho (sem assert) vs comando
// `node --test <arquivo>` sem palavra "assert" na string — o oráculo lê o arquivo.
test('AC-2.2.1: proof_ref a teste sem assert de outcome → AC status unproved', () => {
  const acContract = [
    { id: 'AC-001', behavior: 'efeito X', evidence: { required: ['I', 'T-outcome'], manual: null } },
  ];
  const state = {
    check_table: ['node --test tests/exercise-only.test.js'],
    proof_refs: { 'AC-001': { checks: [0], files: [0] } },
    files_changed: ['tests/exercise-only.test.js'],
  };
  const files = {
    'tests/exercise-only.test.js': "import { run } from '../src/runner.js';\nrun();\n",
  };
  const { results, violations } = classifyAcceptanceResults(state, acContract, {
    readText: (rel) => {
      if (!(rel in files)) throw new Error(`missing ${rel}`);
      return files[rel];
    },
  });
  assert.equal(violations.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'AC-001');
  assert.equal(results[0].status, 'unproved', 'check sem assert deve ser unproved');
  assert.ok(results[0].proof_types.some((p) => p === 'T-outcome:unproved'));
});

// AC-2.2.2: proof_ref a teste com assert de retorno/efeito → elegível a proved.
// O comando é `node --test <arquivo>` (sem "assert" na string); o assert mora no arquivo.
test('AC-2.2.2: proof_ref a teste com assert de retorno/efeito → proved', () => {
  const acContract = [
    { id: 'AC-001', behavior: 'efeito X', evidence: { required: ['I', 'T-outcome'], manual: null } },
  ];
  const state = {
    check_table: ['node --test tests/outcome.test.js'],
    proof_refs: { 'AC-001': { checks: [0], files: [0] } },
    files_changed: ['tests/outcome.test.js'],
  };
  const files = {
    'tests/outcome.test.js':
      "import assert from 'node:assert/strict';\nimport { run } from '../src/runner.js';\nassert.equal(run(), 42);\n",
  };
  const { results, violations } = classifyAcceptanceResults(state, acContract, {
    readText: (rel) => {
      if (!(rel in files)) throw new Error(`missing ${rel}`);
      return files[rel];
    },
  });
  assert.equal(violations.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'AC-001');
  assert.equal(results[0].status, 'proved', 'check com assert no arquivo deve ser proved');
  assert.ok(results[0].proof_types.some((p) => p === 'T-outcome:proved'));
});

// AC-2.2.1 complementar: AC com M aberto e provas auto verdes → manual_pending.
test('AC-2.2.1 complementar: provas auto verdes + M aberto → manual_pending', () => {
  const acContract = [
    { id: 'AC-001', behavior: 'efeito X', evidence: { required: ['I', 'T-outcome'], manual: { severity: 'alta' } } },
  ];
  const state = {
    check_table: ['node --test tests/outcome.test.js'],
    proof_refs: { 'AC-001': { checks: [0], files: [0] } },
    files_changed: ['tests/outcome.test.js'],
  };
  const files = {
    'tests/outcome.test.js':
      "import assert from 'node:assert/strict';\nassert.ok(true);\n",
  };
  const { results, violations } = classifyAcceptanceResults(state, acContract, {
    readText: (rel) => files[rel],
  });
  assert.equal(violations.length, 0);
  assert.equal(results[0].status, 'manual_pending');
});

// S-PROOF (sink do VC5): validatorComplete exige acceptance_results quando o
// state declara sprint_file_path, e confronta o packet com o oráculo mecânico.
test('talos_lock_validator complete: sprint_file_path exige acceptance_results (VC5 sink)', () => {
  const runId = 'sprint-acceptance-complete';
  const { root } = initGitFixture();
  preflight({
    run_id: runId, project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  // Worktree será mutado (src/ + tests/) → first_write imediatamente antes (AC-1.2.2).
  const firstWrite = lockDispatch({
    run_id: runId, project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  assert.equal(firstWrite.status, 'passed');
  const stateRel = `.talos/state/${runId}/slice.json`;
  fs.mkdirSync(path.dirname(path.join(root, stateRel)), { recursive: true });
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  fs.writeFileSync(
    path.join(root, 'tests/outcome.test.js'),
    "import assert from 'node:assert/strict';\nimport { initial } from '../src/initial.js';\nassert.equal(initial, true);\n",
  );
  // Handoff execute real: commitState grava v3 (absoluto) e marca handoff_ready
  // com sha no ledger. O state em disco foi re-projetado pelo commit — o
  // boundary revalida em cima do objeto commitado.
  const commit = commitState({
    run_id: runId,
    project_root: root,
    slice: 'slice',
    plan_path: '.talos/plans/PLAN_S01_runtime.md',
    sprint_file_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    proofs: [
      { kind: 'AC', id: 'AC-001', check: 'node --test tests/outcome.test.js', files: ['src/initial.js', 'tests/outcome.test.js'] },
      { kind: 'AC', id: 'AC-002', check: 'node --test tests/outcome.test.js', files: ['src/initial.js'] },
      { kind: 'EVAL', id: 'EVAL-001', check: 'node --test tests/outcome.test.js' },
      { kind: 'T', id: 'T01', check: 'node --test tests/outcome.test.js', files: ['src/initial.js'] },
    ],
  });
  assert.equal(commit.status, 'passed');
  assert.equal(commit.state_path, stateRel, 'commitState grava no path canônico da slice');

  const start = lockValidatorCore({ run_id: runId, project_root: root, action: 'start', state_path: stateRel });
  assert.equal(start.status, 'passed');
  assert.ok(start.challenge, 'boundary com arquivo emite challenge');

  // Sem acceptance_results → fail estrutural.
  const missing = lockValidatorCore({
    run_id: runId, project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
    data: { findings: [] },
  });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.validator_status, 'missing_acceptance_results');
  assert.match(missing.error, /acceptance_results cobrindo AC-001, AC-002/);

  // Packet mentindo proved quando oráculo não bate → acceptance_oracle_mismatch.
  // (State sem proof_refs seria unproved; aqui removemos proof_refs temporariamente
  // via second run — em vez disso, emitimos statuses errados contra state com prova.)
  const lied = lockValidatorCore({
    run_id: runId, project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
    data: {
      findings: [],
      acceptance_results: [
        { id: 'AC-001', status: 'unproved', proof_types: ['T-outcome:unproved'] },
        { id: 'AC-002', status: 'unproved', proof_types: ['T-outcome:unproved'] },
      ],
    },
  });
  assert.equal(lied.status, 'blocked');
  assert.equal(lied.validator_status, 'acceptance_oracle_mismatch');
  assert.match(lied.error, /oracle=proved/);

  // Com acceptance_results ecoando o oráculo → passa.
  const done = lockValidatorCore({
    run_id: runId, project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
    data: {
      findings: [],
      acceptance_results: [
        { id: 'AC-001', status: 'proved', proof_types: ['T-outcome:proved', 'I:present', 'W:present'] },
        { id: 'AC-002', status: 'proved', proof_types: ['T-outcome:proved', 'I:present'] },
      ],
    },
  });
  assert.equal(done.status, 'passed');
  assert.equal(done.validator_status, 'passed');
});

// D22: shape estrito de acceptance_results. Status fora do enum, id fora de
// AC-NNN e cobertura incompleta (AC do §7.3 ausente) → fail estrutural
// (invalid_acceptance_shape), mesmo com verdict pass.
test('talos_lock_validator complete: acceptance_results com shape inválido → invalid_acceptance_shape', () => {
  const runId = 'sprint-acceptance-shape-invalid';
  const { root } = initGitFixture();
  preflight({
    run_id: runId, project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  // Worktree será mutado (src/) → first_write imediatamente antes (AC-1.2.2).
  const firstWrite = lockDispatch({
    run_id: runId, project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  assert.equal(firstWrite.status, 'passed');
  const stateRel = `.talos/state/${runId}/slice.json`;
  fs.mkdirSync(path.dirname(path.join(root, stateRel)), { recursive: true });
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintDoc());
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  const commit = commitState({
    run_id: runId,
    project_root: root,
    slice: 'slice',
    plan_path: '.talos/plans/PLAN_S01_runtime.md',
    sprint_file_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    proofs: [
      { kind: 'AC', id: 'AC-001', check: 'node --test tests/outcome.test.js', files: ['src/initial.js'] },
      { kind: 'AC', id: 'AC-002', check: 'node --test tests/outcome.test.js', files: ['src/initial.js'] },
      { kind: 'EVAL', id: 'EVAL-001', check: 'node --test tests/outcome.test.js' },
    ],
  });
  assert.equal(commit.status, 'passed');
  assert.equal(commit.state_path, `.talos/state/${runId}/slice.json`);

  const start = lockValidatorCore({ run_id: runId, project_root: root, action: 'start', state_path: stateRel });
  assert.equal(start.status, 'passed');

  // Shape inválido composto: status fora do enum + id fora de AC-NNN + AC-002 ausente.
  const invalid = lockValidatorCore({
    run_id: runId, project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
    data: {
      findings: [],
      acceptance_results: [
        { id: 'AC-001', status: 'weird' },
        { id: 'EVAL-1', status: 'proved', proof_types: ['T-outcome:proved'] },
      ],
    },
  });
  assert.equal(invalid.status, 'blocked');
  assert.equal(invalid.validator_status, 'invalid_acceptance_shape');
  assert.match(invalid.error, /status deve ser proved\|unproved\|violated\|manual_pending/);
  assert.match(invalid.error, /id deve ser AC-NNN/);
  assert.match(invalid.error, /acceptance_results sem AC: AC-002/);
});

// CN2/VC1 (Plano 3): a cadeia completa do fluxo real. O executor escreve o state
// com proof_refs e SEM acceptance_results (skill: "emitido pelo validator no
// complete — não pelo executor"); o complete valida o eco contra o oráculo e
// PERSISTE acceptance_results no state em disco; o update_sprint_status lê
// desse state. Sem a persistência, MVP é inalcançável (emitir_acceptance_results
// no_state) e done com M aberto emitiria handoff — gate morto no fluxo real.
test('cadeia real: complete persiste acceptance_results no state; update_sprint_status consome (CN2/VC1)', () => {
  const runId = 'sprint-acceptance-chain';
  const { root } = initGitFixture();
  preflight({
    run_id: runId, project_root: root, mode: 'execute',
    host: 'codex', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  // Worktree será mutado (src/ + tests/) → first_write imediatamente antes (AC-1.2.2).
  const firstWrite = lockDispatch({
    run_id: runId, project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  assert.equal(firstWrite.status, 'passed');
  const stateRel = `.talos/state/${runId}/slice.json`;
  fs.mkdirSync(path.dirname(path.join(root, stateRel)), { recursive: true });
  fs.mkdirSync(path.join(root, '.talos/backlog/sprints'), { recursive: true });
  // Sprint com AC-002 carregando smoke manual (M) — gera manual_pending no oráculo.
  const sprintWithManual = sprintDoc({ status: 'review' }).replace(
    '      required: [I, T-outcome]\n      manual: null',
    '      required: [I, T-outcome, M]\n      manual:\n        severity: alta\n        scenario: "validação manual"\n        expected_evidence: "resultado observável"\n        impact_paths: ["src/initial.js"]',
  );
  fs.writeFileSync(path.join(root, '.talos/backlog/sprints/SPRINT_S01_runtime.md'), sprintWithManual);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  fs.writeFileSync(
    path.join(root, 'tests/outcome.test.js'),
    "import assert from 'node:assert/strict';\nimport { initial } from '../src/initial.js';\nassert.equal(initial, true);\n",
  );
  const commit = commitState({
    run_id: runId,
    project_root: root,
    slice: 'slice',
    plan_path: '.talos/plans/PLAN_S01_runtime.md',
    sprint_file_path: '.talos/backlog/sprints/SPRINT_S01_runtime.md',
    proofs: [
      { kind: 'AC', id: 'AC-001', check: 'node --test tests/outcome.test.js', files: ['src/initial.js', 'tests/outcome.test.js'] },
      { kind: 'AC', id: 'AC-002', check: 'node --test tests/outcome.test.js', files: ['src/initial.js'] },
      { kind: 'EVAL', id: 'EVAL-001', check: 'node --test tests/outcome.test.js' },
    ],
  });
  assert.equal(commit.status, 'passed');
  assert.equal(commit.state_path, `.talos/state/${runId}/slice.json`);

  const start = lockValidatorCore({ run_id: runId, project_root: root, action: 'start', state_path: stateRel });
  assert.equal(start.status, 'passed');

  // Eco do oráculo: AC-001 proved; AC-002 manual_pending (M aberto).
  const done = lockValidatorCore({
    run_id: runId, project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
    data: {
      findings: [],
      acceptance_results: [
        { id: 'AC-001', status: 'proved', proof_types: ['T-outcome:proved', 'I:present', 'W:present'] },
        { id: 'AC-002', status: 'manual_pending', proof_types: ['T-outcome:proved', 'I:present', 'M:pending'] },
      ],
    },
  });
  assert.equal(done.status, 'passed');

  // A persistência: o state em disco agora carrega acceptance_results (fonte do gate).
  const persisted = JSON.parse(fs.readFileSync(path.join(root, commit.state_path), 'utf8'));
  assert.ok(Array.isArray(persisted.acceptance_results), 'complete deve persistir acceptance_results no state');
  assert.equal(persisted.acceptance_results.length, 2);
  assert.equal(persisted.acceptance_results.find((item) => item.id === 'AC-002').status, 'manual_pending');

  // Backlog com S01 (review) e S02 dependendo de S01.
  writeSprintFixture(root, 'S02', { status: 'ready', dorStatus: 'verde' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S01 | Base | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | — | review | validator:pending | `.talos/backlog/sprints/SPRINT_S01_runtime.md` | pendente | pendente |',
    '| S02 | Depende | F0 | objetivo | Must | Alto | Baixo | P0 | pendente | S01 | ready | ready | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
  ]));

  // CN2 (cadeia): MVP com M aberto passa e S02 avança via DEP.
  const mv = updateSprintStatus({
    run_id: 'r-chain', project_root: root, backlog_path: 'BACKLOG.md', sprint_id: 'S01',
    status: 'manual_validation_pending', validator_verdict: 'pass', state_path: stateRel,
  });
  assert.equal(mv.status, 'passed', JSON.stringify(mv.pendencies, null, 1));
  assert.equal(mv.next_status, 'manual_validation_pending');
  assert.equal(mv.handoff_path, undefined);
  const sel = selectNextSprint({ run_id: 'r-chain2', project_root: root, backlog_path: 'BACKLOG.md' });
  assert.equal(sel.status, 'passed');
  assert.equal(sel.selected.sprint_id, 'S02');

  // VC1 (cadeia): done com M aberto continua bloqueado lendo o MESMO state persistido.
  const dv = updateSprintStatus({
    run_id: 'r-chain3', project_root: root, backlog_path: 'BACKLOG.md', sprint_id: 'S01',
    status: 'done', validator_verdict: 'pass', state_path: stateRel,
  });
  assert.equal(dv.status, 'blocked');
  assert.ok(dv.pendencies.some((p) => p.category === 'acceptance_results'));
  assert.match(dv.pendencies.find((p) => p.category === 'acceptance_results').message, /AC-002:manual_pending/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Plano 01 — `talos_commit_state` / G12 `first_write` / órfão
// (CN1/CN2/CN3/CN5/CN9/CN10; VC1–VC4; LEG1/LEG3/LEG4; INV1/INV2/INV5/INV6/INV7)
// ═══════════════════════════════════════════════════════════════════════════

function planCommitSetup(runId, { mutar = false } = {}) {
  // Plano 01: o fluxo execute exige repo git real (base_sha no start + snapshot
  // no first_write). tmpRoot() puro não é repo — usar initGitFixture().
  const { root, head } = initGitFixture();
  preflight({
    run_id: runId, project_root: root, mode: 'execute',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  const start = lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  assert.equal(start.status, 'passed');
  assert.equal(start.dispatch.active.base_sha, head);
  if (mutar) {
    // AC-1.2.2: first_write imediatamente ANTES da 1ª mutação (baseline limpa).
    const firstWrite = lockDispatch({
      run_id: runId, project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
    });
    assert.equal(firstWrite.status, 'passed');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  }
  return { root };
}

// AC-1.1.1 (CN1/VC1/VC4/INV2): commit projeta v3 completo no disco e retorna
// state_path + state_sha256 iguais ao sha do arquivo.
test('Plano 01: talos_commit_state projeta v3 completo e retorna sha do arquivo (AC-1.1.1)', () => {
  const { root } = planCommitSetup('commit-v3', { mutar: true });
  const commit = commitState({
    run_id: 'commit-v3',
    project_root: root,
    slice: 'A',
    plan_path: '.talos/plans/PLAN_S41.md',
    proofs: [
      { kind: 'AC', id: 'AC-001', check: 'node --test packages/mcp-server/server.test.js', files: ['src/a.js'] },
      { kind: 'EVAL', id: 'EVAL-001', check: 'node --test packages/mcp-server/server.test.js' },
      { kind: 'T', id: 'T01', check: 'node --test packages/mcp-server/server.test.js', files: ['src/a.js'] },
    ],
  });
  assert.equal(commit.status, 'passed');
  assert.equal(commit.gate, 'G12');
  assert.equal(commit.role, 'execute');
  const stateRel = commit.state_path;
  const abs = path.join(root, stateRel);
  assert.equal(fs.existsSync(abs), true);
  const disk = JSON.parse(fs.readFileSync(abs, 'utf8'));
  assert.equal(disk.state_schema_version, 3, 'INV2: disco sempre v3');
  // AC-1.2.2: baseline capturada ANTES da 1ª mutação — worktree limpo → [].
  assert.ok(Array.isArray(disk.worktree_baseline), 'baseline é array (pode ser [] no caso limpo)');
  assert.ok(Array.isArray(disk.worktree_final) && disk.worktree_final.length > 0, 'final carrega a mutação');
  assert.equal(disk.files_changed.includes('src/a.js'), true);
  // proof sem `files` → proof_refs[AC].files = [] (falsificador AC-1.1.1).
  const acRef = disk.proof_refs['AC-001'];
  assert.deepEqual(acRef.files, [0], 'files do proof viraram índices em files_changed');
  assert.ok(Array.isArray(disk.check_table) && disk.check_table.length >= 1);
  const diskSha = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  assert.equal(commit.state_sha256, diskSha, 'retorno carrega o sha do arquivo');
  // Ledger da run ganha sha + handoff_ready (sink VC1).
  const ledger = readRunJson(root, 'commit-v3');
  assert.equal(ledger.data.dispatch.active.liveness.status, 'handoff_ready');
  assert.equal(ledger.data.dispatch.active.liveness.slice_commit_sha256, diskSha);
  assert.equal(ledger.data.dispatch.active.liveness.last_commit_state_path, stateRel);
  assert.notEqual(ledger.data.dispatch.active.liveness.last_checkpoint, 'state_path_created');
  // Boundary aceita o objeto commitado (INV2/CN5).
  const boundary = validateStateBoundary(stateRel, { project_root: root });
  assert.equal(boundary.ok, true, boundary.violations.join('; '));
});

// AC-1.1.2 (CN9/INV5): acceptance_results no input → -32602, disco intacto.
test('Plano 01: commit rejeita acceptance_results no input (AC-1.1.2)', () => {
  const { root } = planCommitSetup('commit-denied', { mutar: true });
  const stateRel = '.talos/state/commit-denied/A.json';
  const abs = path.join(root, stateRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'ORIGINAL');
  assert.throws(
    () => commitState({
      run_id: 'commit-denied', project_root: root, slice: 'A',
      proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test' }],
      acceptance_results: [{ id: 'AC-001', status: 'proved' }],
    }),
    (error) => error.code === -32602 && /acceptance_results/.test(error.message),
  );
  assert.equal(fs.readFileSync(abs, 'utf8'), 'ORIGINAL', 'disco intacto após -32602');
});

// AC-1.1.3 (VC3/INV6): role no input → -32602; repair sem slot → blocked sem escrita.
test('Plano 01: role pelo lock — role no input é -32602; repair sem slot bloqueia (AC-1.1.3)', () => {
  const { root } = planCommitSetup('commit-role', { mutar: true });
  assert.throws(
    () => commitState({
      run_id: 'commit-role', project_root: root, slice: 'A',
      proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test' }],
      role: 'execute',
    }),
    (error) => error.code === -32602 && /role/.test(error.message),
  );
  const stateRel = '.talos/state/commit-role/A.json';
  const abs = path.join(root, stateRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'ORIGINAL');
  // Sem slot repair_start (ciclo idle): repair[] sem slot → blocked, sem escrita.
  const repair = commitState({
    run_id: 'commit-role', project_root: root, slice: 'A',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test' }],
    repair: [{ finding_id: 'F-001', files: ['src/a.js'], checks: ['node --test'], status: 'resolved' }],
  });
  assert.equal(repair.status, 'blocked');
  assert.equal(repair.code, 'repair_sem_slot');
  assert.match(repair.error, /repair\[\] sem slot repair_start/);
  assert.equal(fs.readFileSync(abs, 'utf8'), 'ORIGINAL', 'repair sem slot não escreve');
});

// AC-1.1.4 (CN10/INV7): check é string honor — commit não spawna o comando.
test('Plano 01: commit honra check string sem executar (AC-1.1.4)', () => {
  const { root } = planCommitSetup('commit-honor', { mutar: true });
  const commit = commitState({
    run_id: 'commit-honor',
    project_root: root,
    slice: 'A',
    proofs: [
      { kind: 'AC', id: 'AC-001', check: 'comando-inexistente-que-nao-roda --exit 7' },
    ],
  });
  assert.equal(commit.status, 'passed', 'check não é spawnado; honor da string');
  const disk = JSON.parse(fs.readFileSync(path.join(root, commit.state_path), 'utf8'));
  assert.ok(disk.check_table.includes('comando-inexistente-que-nao-roda --exit 7'));
});

// AC-1.1.5 (CN1/VC2): repair com slot aberto append repair_evidence e preserva baseline.
test('Plano 01: commit repair preserva worktree_baseline do execute (AC-1.1.5)', () => {
  const { root } = planCommitSetup('commit-repair', { mutar: true });
  const first = commitState({
    run_id: 'commit-repair', project_root: root, slice: 'A',
    plan_path: '.talos/plans/PLAN_S41.md',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test', files: ['src/a.js'] }],
  });
  assert.equal(first.status, 'passed');
  const baselineAfterExecute = readRunJson(root, 'commit-repair').data.dispatch.active.liveness.worktree_baseline;

  // fail do validator → repair_required abre slot repair.
  const stateRel = first.state_path;
  const start = lockValidator({ run_id: 'commit-repair', project_root: root, action: 'start', state_path: stateRel });
  assert.equal(start.status, 'passed');
  lockValidator({
    run_id: 'commit-repair', project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'fail',
    data: { findings: [finding({ file: 'src/a.js' })] },
  });
  const repairStart = lockValidator({ run_id: 'commit-repair', project_root: root, action: 'repair_start', state_path: stateRel });
  assert.equal(repairStart.status, 'passed');

  // Mutação do repair no worktree; commit repair preserva a baseline do execute.
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
  const repairCommit = commitState({
    run_id: 'commit-repair', project_root: root, slice: 'A',
    plan_path: '.talos/plans/PLAN_S41.md',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test', files: ['src/a.js'] }],
    repair: [{ finding_id: 'F-001', files: ['src/a.js'], checks: ['node --test'], status: 'resolved' }],
  });
  assert.equal(repairCommit.status, 'passed');
  assert.equal(repairCommit.role, 'repair');
  const disk = JSON.parse(fs.readFileSync(path.join(root, stateRel), 'utf8'));
  assert.deepEqual(disk.worktree_baseline, baselineAfterExecute, 'repair NÃO sobrescreve baseline do execute');
  assert.equal(disk.repair_evidence.length, 1);
  assert.equal(disk.repair_evidence[0].finding_id, 'F-001');
});

// AC-1.2.1 (CN2/VC2): start grava base_sha = HEAD no ledger.
test('Plano 01: lock_dispatch start grava base_sha=HEAD (AC-1.2.1)', () => {
  const { root } = planCommitSetup('commit-basesha', {});
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const ledger = readRunJson(root, 'commit-basesha');
  assert.equal(ledger.data.dispatch.active.base_sha, head);
  assert.match(ledger.data.dispatch.active.base_sha, /^[a-f0-9]{40}$/);
});

// AC-1.2.2 (CN2/VC2): first_write uma vez; segunda bloqueada; repair não emite.
test('Plano 01: first_write one-shot e repair não emite (AC-1.2.2)', () => {
  const { root } = planCommitSetup('commit-fw', {});
  const first = lockDispatch({
    run_id: 'commit-fw', project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  assert.equal(first.status, 'passed');
  const second = lockDispatch({
    run_id: 'commit-fw', project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  assert.equal(second.status, 'blocked');
  assert.match(second.error, /first_write já emitido/);

  // repair ativo → first_write blocked (D9: role pelo lock).
  const { root: root2 } = planCommitSetup('commit-fw2', { mutar: true });
  const commit = commitState({
    run_id: 'commit-fw2', project_root: root2, slice: 'A',
    plan_path: '.talos/plans/PLAN_S41.md',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test', files: ['src/a.js'] }],
  });
  const start = lockValidator({ run_id: 'commit-fw2', project_root: root2, action: 'start', state_path: commit.state_path });
  lockValidator({
    run_id: 'commit-fw2', project_root: root2, action: 'complete', state_path: commit.state_path,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root2, start.challenge.file), verdict: 'fail',
    data: { findings: [finding({ file: 'src/a.js' })] },
  });
  lockValidator({ run_id: 'commit-fw2', project_root: root2, action: 'repair_start', state_path: commit.state_path });
  const repairFirstWrite = lockDispatch({
    run_id: 'commit-fw2', project_root: root2, action: 'checkpoint', phase: 'plan_execute', event: 'first_write',
  });
  assert.equal(repairFirstWrite.status, 'blocked');
  assert.match(repairFirstWrite.error, /repair ativo não emite first_write/);
});

// AC-1.2.3 (CN2): worktree sujo sem first_write → commit blocked; limpo sem first_write → passed.
test('Plano 01: commit exige first_write se worktree sujo; no-op passa (AC-1.2.3)', () => {
  const { root } = planCommitSetup('commit-dirty', {});
  fs.writeFileSync(path.join(root, 'src-dirty.js'), 'x\n');
  const blocked = commitState({
    run_id: 'commit-dirty', project_root: root, slice: 'A',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test' }],
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.code, 'sem_first_write_dirty');
  assert.equal(blocked.next_action, 'emitir_first_write_antes_do_commit');

  // No-op slice (worktree limpo) sem first_write → passed.
  const { root: root2 } = planCommitSetup('commit-clean', {});
  const clean = commitState({
    run_id: 'commit-clean', project_root: root2, slice: 'A',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test' }],
  });
  assert.equal(clean.status, 'passed');
  const disk = JSON.parse(fs.readFileSync(path.join(root2, clean.state_path), 'utf8'));
  assert.deepEqual(disk.files_changed, []);
});

// AC-1.2.4 (CN2/D12): bootstrap expirado sem gesto stalled; com commit em 120s não stalled.
test('Plano 01: g12 bootstrap D12 — no-op commit em 120s não stalled (AC-1.2.4)', () => {
  const { root } = planCommitSetup('commit-boot', {});
  const commit = commitState({
    run_id: 'commit-boot', project_root: root, slice: 'A',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test' }],
  });
  assert.equal(commit.status, 'passed');
  const runFile = path.join(root, '.talos', 'state', 'commit-boot', 'run.json');
  const raw = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  raw.data.dispatch.active.started_at = '2000-01-01T00:00:00.000Z';
  raw.data.dispatch.active.liveness.bootstrap_deadline_at = '2000-01-01T00:02:00.000Z';
  fs.writeFileSync(runFile, JSON.stringify(raw, null, 2));
  const status = lockDispatch({ run_id: 'commit-boot', project_root: root, action: 'status', phase: 'plan_execute' });
  assert.equal(status.status, 'passed', 'commit em 120s (mesmo sem first_write) não stalled');

  // Sem nenhum gesto, deadline passado → stalled (bootstrap).
  const { root: root2 } = planCommitSetup('commit-boot2', {});
  const runFile2 = path.join(root2, '.talos', 'state', 'commit-boot2', 'run.json');
  const raw2 = JSON.parse(fs.readFileSync(runFile2, 'utf8'));
  raw2.data.dispatch.active.started_at = '2000-01-01T00:00:00.000Z';
  raw2.data.dispatch.active.liveness.bootstrap_deadline_at = '2000-01-01T00:02:00.000Z';
  fs.writeFileSync(runFile2, JSON.stringify(raw2, null, 2));
  const status2 = lockDispatch({ run_id: 'commit-boot2', project_root: root2, action: 'status', phase: 'plan_execute' });
  assert.equal(status2.status, 'blocked');
  assert.equal(status2.cause, 'executor_bootstrap_timeout');
});

// AC-1.2.5 (LEG1): events antigos → checkpoint desconhecido.
test('Plano 01: g12 checkpoint desconhecido para events antigos (AC-1.2.5)', () => {
  const { root } = planCommitSetup('commit-dead', {});
  for (const event of ['executor_started', 'skill_loaded', 'plan_loaded', 'handoff_accepted', 'task_started', 'state_path_created']) {
    const result = lockDispatch({
      run_id: 'commit-dead', project_root: root, action: 'checkpoint', phase: 'plan_execute', event,
    });
    assert.equal(result.status, 'blocked', event);
    assert.match(result.error, /Checkpoint desconhecido/);
  }
});

// AC-1.3.1 (CN5/VC1/INV2): commit → lock_validator(start) passa e boundary aceita.
test('Plano 01: commit alimenta validateStateBoundary e start passed (AC-1.3.1)', () => {
  const { root } = planCommitSetup('commit-start', { mutar: true });
  const commit = commitState({
    run_id: 'commit-start', project_root: root, slice: 'A',
    plan_path: '.talos/plans/PLAN_S41.md',
    proofs: [
      { kind: 'AC', id: 'AC-001', check: 'node --test packages/mcp-server/server.test.js', files: ['src/a.js'] },
      { kind: 'EVAL', id: 'EVAL-001', check: 'node --test packages/mcp-server/server.test.js' },
      { kind: 'T', id: 'T01', check: 'node --test packages/mcp-server/server.test.js', files: ['src/a.js'] },
    ],
  });
  assert.equal(commit.status, 'passed');
  const start = lockValidator({ run_id: 'commit-start', project_root: root, action: 'start', state_path: commit.state_path });
  assert.equal(start.status, 'passed');
  assert.equal(start.validator_status, 'running');
});

// AC-1.3.2 (CN3/INV1/VC1): órfão A (JSON à mão, sem sha) e órfão B (sha divergente) blocked.
test('Plano 01: órfão bloqueia validatorStart (AC-1.3.2)', () => {
  const { root } = planCommitSetup('commit-orphan', { mutar: true });
  const stateRel = '.talos/state/commit-orphan/A.json';
  const abs = path.join(root, stateRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const baseline = captureWorktreeSnapshot(root);
  const validV3 = {
    state_schema_version: 3,
    run_id: 'commit-orphan', slice: 'A', base_sha: head, head_sha: head, contract_kind: 'plan',
    tasks: ['T01'], files_changed: ['src/a.js'],
    diff_stat: '1 file', plan_path: '.talos/plans/x.md',
    boundary_refs: [], obligations: [], invariants: [], scenario_probes: [],
    risk_probes: [], validation_map: [],
    task_evidence: [{ task: 'T01', files: ['src/a.js'], checks: ['node --test'], result: 'passed' }],
    repair_evidence: [],
    worktree_baseline: baseline, worktree_final: captureWorktreeSnapshot(root),
    executed_at: new Date().toISOString(), executor_skill: 'talos-plan-execute',
  };

  // (i) Write à mão sem commitState → ledger sem sha → blocked.
  fs.writeFileSync(abs, JSON.stringify(validV3, null, 2));
  const startA = lockValidatorCore({ run_id: 'commit-orphan', project_root: root, action: 'start', state_path: stateRel });
  assert.equal(startA.status, 'blocked');
  assert.equal(startA.gate, 'G12');
  assert.equal(startA.next_action, 'commitar_via_talos_commit_state_antes_do_validator');
  assert.equal(startA.slice_commit_sha256, null);

  // O JSON à mão (órfão) não pode ser sobrescrito pelo commit absoluto: remover
  // antes do commit legítimo — o commit é o writer único do path da slice.
  fs.rmSync(abs, { force: true });

  // Commit legítimo do MESMO path; depois o teste sobrescreve o arquivo à mão
  // com v3 diferente → sha do disco diverge do ledger → blocked (órfão B).
  const commit = commitState({
    run_id: 'commit-orphan', project_root: root, slice: 'A',
    plan_path: '.talos/plans/x.md',
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test', files: ['src/a.js'] }],
  });
  assert.equal(commit.status, 'passed');
  const good = lockValidatorCore({ run_id: 'commit-orphan', project_root: root, action: 'start', state_path: stateRel });
  assert.equal(good.status, 'passed');
  // Novo ciclo: complete pass para liberar o ciclo.
  lockValidatorCore({
    run_id: 'commit-orphan', project_root: root, action: 'complete', state_path: stateRel,
    validator_run_id: good.validator_run_id, dispatch_token: good.dispatch_token,
    challenge_response: sha256File(root, good.challenge.file), verdict: 'pass',
    data: { findings: [], acceptance_results: [{ id: 'AC-001', status: 'proved', proof_types: ['T-outcome:proved'] }] },
  });
  fs.writeFileSync(abs, JSON.stringify({ ...validV3, files_changed: ['src/outro.js'], diff_stat: '1 file' }, null, 2));
  const startB = lockValidatorCore({ run_id: 'commit-orphan', project_root: root, action: 'start', state_path: stateRel });
  assert.equal(startB.status, 'blocked');
  assert.equal(startB.gate, 'G12');
  assert.match(startB.error, /órfão|diverge/);
});

// AC-1.3.3 (LEG4): wrapper lockValidator não emite state_path_created.
test('Plano 01: wrapper lockValidator não emite event morto (AC-1.3.3)', () => {
  const source = fs.readFileSync(new URL('./server.test.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /event:\s*['"]state_path_created['"]/);
  assert.doesNotMatch(source, /['"]state_path_created['"]\s*,\s*state_path/);
});

// VC3: direct route → commit direto (contract_kind direct, executor_skill direct).
test('Plano 01: commit em rota direct projeta contract_kind=direct (VC3)', () => {
  const { root } = initGitFixture();
  preflight({
    run_id: 'commit-direct', project_root: root, mode: 'direct',
    host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true },
  });
  const start = lockDispatch({ run_id: 'commit-direct', project_root: root, action: 'start', phase: 'plan_execute' });
  assert.equal(start.status, 'passed');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/d.js'), 'export const d = 1;\n');
  lockDispatch({ run_id: 'commit-direct', project_root: root, action: 'checkpoint', phase: 'plan_execute', event: 'first_write' });
  const commit = commitState({
    run_id: 'commit-direct', project_root: root, slice: 'A', plan_path: undefined,
    obligation_ids: ['O1'],
    proofs: [{ kind: 'AC', id: 'AC-001', check: 'node --test', files: ['src/d.js'] }],
  });
  assert.equal(commit.status, 'passed');
  const disk = JSON.parse(fs.readFileSync(path.join(root, commit.state_path), 'utf8'));
  assert.equal(disk.contract_kind, 'direct');
  assert.equal(disk.executor_skill, 'talos-direct-execute');
  assert.deepEqual(disk.contract_ids.obligations, ['O1']);
});

// ═══════════════════════════════════════════════════════════════════════════
// Plano 02 — skills + orquestrador sem blob (CN4/CN6; LEG2; INV3)
// ═══════════════════════════════════════════════════════════════════════════

// AC-2.1.1 (CN4/LEG2): execute/direct citam talos_commit_state + first_write e
// não ensinam blob/7 events/STATE_FILE_SCHEMA nem despacham validator/review.
test('Plano 02: skills execute/direct onda 1 sem blob (AC-2.1.1)', () => {
  const deadAnchors = [
    'STATE_FILE_SCHEMA.md',
    'worktree_baseline',
    'worktree_final',
    'state_path_created',
    'executor_started',
    'skill_loaded',
    'plan_loaded',
    'handoff_accepted',
    'task_started',
    '"acceptance_results"',
  ];
  for (const [name, skillPath] of [
    ['talos-plan-execute', PLAN_EXECUTE_SKILL_PATH],
    ['talos-direct-execute', DIRECT_EXECUTE_SKILL_PATH],
  ]) {
    const skill = fs.readFileSync(skillPath, 'utf8');
    assert.match(skill, /talos_commit_state/, `${name} cita o verbo de commit`);
    assert.match(skill, /first_write/, `${name} cita first_write`);
    for (const anchor of deadAnchors) {
      assert.doesNotMatch(skill, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} não ensina âncora morta ${anchor}`);
    }
    // D6: a skill pode CITAR o validator como destinatário do handoff, mas nunca
    // instruir o executor a despachá-lo (dispatch de subagente = orquestrador).
    assert.doesNotMatch(skill, /Agent\s*\([^)]*subagent_type\s*:\s*talos-task-validator/, `${name} não despacha validator`);
    assert.doesNotMatch(skill, /subagent_type\s*:\s*talos-task-validator/, `${name} não usa subagent_type validator`);
    assert.doesNotMatch(skill, /Agent\s*\([^)]*subagent_type\s*:\s*talos-slice-review/, `${name} não despacha review`);
  }
});

// AC-2.1.2 (CN4/LEG2): repair manda talos_commit_state com repair[], mesmo
// state_path, sem instruir Write/recompute de worktree_* à mão.
test('Plano 02: skill repair usa commit com repair[] e sem Write (AC-2.1.2)', () => {
  const skill = fs.readFileSync(FINDINGS_REPAIR_SKILL_PATH, 'utf8');
  assert.match(skill, /talos_commit_state/, 'repair cita o verbo de commit');
  assert.match(skill, /repair/, 'repair cita repair[]');
  assert.match(skill, /state_path/, 'repair usa o mesmo state_path');
  // A skill pode citar JSON.stringify/Write/worktree_* PARA LER ou PROIBIR; o
  // que não pode é instruir o executor a montar/editar o JSON de slice ou
  // recomputar campos projetados.
  assert.doesNotMatch(skill, /Write the state file|Crie o state file|writeFileSync/, 'repair não instrui Write do JSON');
  assert.doesNotMatch(skill, /atualize (os )?worktree_|recompute (o )?worktree_|preencha (os )?worktree_/i, 'repair não instrui recompute de worktree_*');
  assert.doesNotMatch(skill, /state_path_created/, 'repair não emite event morto');
});

// AC-2.1.3 (CN4/LEG2): orquestrador G12 descreve first_write + commit e não
// lista os 7 events como obrigação do executor.
test('Plano 02: orquestrador G12 onda 1 (AC-2.1.3)', () => {
  const skill = fs.readFileSync(ORCHESTRATOR_SKILL_PATH, 'utf8');
  assert.match(skill, /first_write/, 'G12 cita first_write');
  assert.match(skill, /talos_commit_state/, 'G12 cita talos_commit_state');
  for (const dead of ['executor_started', 'skill_loaded', 'plan_loaded', 'handoff_accepted', 'task_started', 'state_path_created']) {
    assert.doesNotMatch(skill, new RegExp(dead), `G12 não exige event morto ${dead}`);
  }
});

// AC-2.2.1 (CN6/INV3): G8 permanece skill+subagente; execute/repair não
// despacham slice-review nem task-validator.
test('Plano 02: slice-review não citado como dispatch nas skills de execução (AC-2.2.1)', () => {
  const review = fs.readFileSync(SLICE_REVIEW_SKILL_PATH, 'utf8');
  // G8 não virou fechamento F nem inline no executor.
  assert.doesNotMatch(review, /Plano F|fechamento F|pack-close/, 'G8 não vira fechamento F');
  // G8 segue skill+subagente: dispatch é condição de orquestrador (G8), não
  // inline no executor.
  assert.match(review, /orchestrator|orquestrador/i, 'G8 descreve dispatch pelo orquestrador');
  for (const skillPath of [PLAN_EXECUTE_SKILL_PATH, DIRECT_EXECUTE_SKILL_PATH, FINDINGS_REPAIR_SKILL_PATH]) {
    const skill = fs.readFileSync(skillPath, 'utf8');
    assert.doesNotMatch(skill, /subagent_type\s*:\s*talos-slice-review/, 'execute/repair não despacham slice-review');
    assert.doesNotMatch(skill, /subagent_type\s*:\s*talos-task-validator/, 'execute/repair não despacham validator');
  }
});

// D2 (sem AC: motivo): output JSON do validator intocado nesta trilha.
test('Plano 02: output do talos-task-validator não mudou de papel', () => {
  const validator = fs.readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../skills/talos-task-validator/SKILL.md',
  ), 'utf8');
  assert.match(validator, /verdict/i, 'validator segue emitindo veredito');
});

// AC-3.2.2 (INV4, plano 03): a lista canônica de tools não contém tools de onda
// 2/3 (capture, evento, reseal, slice_view, pref) e o G12 do orquestrador não
// exige `sprint_pref`/`talos-sprint-pref` como etapa desta release. Falsificador
// declarado: "alguma dessas tools aparecer na lista canônica, ou o G12/orquestrador
// exigir sprint_pref antes do fechamento da slice".
test('Plano 03: tools lista sem onda 2/3 e G12 sem pref obrigatório (AC-3.2.2)', () => {
  const toolNames = toolsList().tools.map((tool) => tool.name);
  for (const forbidden of ['talos_capture_cmd', 'talos_run_event', 'talos_consume_reseal', 'talos_slice_view', 'talos_sprint_pref']) {
    assert.ok(!toolNames.includes(forbidden), `tool de onda 2/3 fora da lista: ${forbidden}`);
  }
  const orchestrator = fs.readFileSync(ORCHESTRATOR_SKILL_PATH, 'utf8');
  assert.doesNotMatch(orchestrator, /sprint_pref/, 'orquestrador não exige sprint_pref');
  assert.doesNotMatch(orchestrator, /talos-sprint-pref/, 'orquestrador não exige talos-sprint-pref');
  const g12 = orchestrator.split('\n').find((line) => /^\|\s*G12\s*\|/.test(line)) ?? '';
  assert.doesNotMatch(g12, /pref/, 'G12 não menciona pref');
});

test('F-003: dirty preexistente intacto não contamina; mutação posterior entra no boundary', () => {
  const { root, head } = initGitFixture();
  fs.writeFileSync(path.join(root, 'README.md'), 'dirty anterior\n');
  const baseline = captureWorktreeSnapshot(root);
  const intact = planStateForBoundary(root, head, baseline, []);
  const intactPath = writeSliceState(root, 'dirty-intacto', intact);
  assert.equal(validateStateBoundary(intactPath, { project_root: root }).ok, true);

  fs.writeFileSync(path.join(root, 'README.md'), 'alterado durante a slice\n');
  const mutated = planStateForBoundary(root, head, baseline, ['README.md']);
  const mutatedPath = writeSliceState(root, 'dirty-mutado', mutated);
  assert.equal(validateStateBoundary(mutatedPath, { project_root: root }).ok, true);

  const omitted = { ...mutated, files_changed: [], task_evidence: [] };
  const omittedPath = writeSliceState(root, 'dirty-omitido', omitted);
  const result = validateStateBoundary(omittedPath, { project_root: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /README\.md/);
});

test('F-003: untracked novo omitido e state stale bloqueiam', () => {
  const { root, head } = initGitFixture();
  const baseline = captureWorktreeSnapshot(root);
  fs.writeFileSync(path.join(root, 'novo.js'), 'v1\n');
  const omitted = planStateForBoundary(root, head, baseline, []);
  const omittedPath = writeSliceState(root, 'untracked-omitido', omitted);
  assert.match(validateStateBoundary(omittedPath, { project_root: root }).violations.join(' '), /novo\.js/);

  const stale = planStateForBoundary(root, head, baseline, ['novo.js']);
  const stalePath = writeSliceState(root, 'state-stale', stale);
  fs.writeFileSync(path.join(root, 'novo.js'), 'v2\n');
  assert.match(validateStateBoundary(stalePath, { project_root: root }).violations.join(' '), /worktree_final stale/);
});

test('F-003: remoção e rename são representados no delta real', () => {
  const removed = initGitFixture();
  const removedBaseline = captureWorktreeSnapshot(removed.root);
  fs.rmSync(path.join(removed.root, 'README.md'));
  const removedState = planStateForBoundary(removed.root, removed.head, removedBaseline, ['README.md']);
  const removedPath = writeSliceState(removed.root, 'arquivo-removido', removedState);
  assert.equal(validateStateBoundary(removedPath, { project_root: removed.root }).ok, true);
  assert.deepEqual(removedState.worktree_final.find((entry) => entry.path === 'README.md'), {
    path: 'README.md', status: 'D', sha256: null,
  });

  const renamed = initGitFixture();
  const renamedBaseline = captureWorktreeSnapshot(renamed.root);
  execFileSync('git', ['-C', renamed.root, 'mv', 'README.md', 'RENAMED.md']);
  const renamedState = planStateForBoundary(
    renamed.root, renamed.head, renamedBaseline, ['README.md', 'RENAMED.md'],
  );
  const renamedPath = writeSliceState(renamed.root, 'arquivo-renomeado', renamedState);
  assert.equal(validateStateBoundary(renamedPath, { project_root: renamed.root }).ok, true);
  assert.deepEqual(renamedState.worktree_final.map((entry) => [entry.path, entry.status]), [
    ['README.md', 'D'], ['RENAMED.md', 'R'],
  ]);
});

test('Etapa 2: SHAs divergentes bloqueiam boundary stale', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/direct.js'), 'export const direct = true;\n');
  const state = fixtureState('state-direct.json', { __BASE_SHA__: head, __HEAD_SHA__: '0000000000000000000000000000000000000000' });
  const statePath = writeSliceState(root, state.run_id, state);
  const result = validateStateBoundary(statePath, { project_root: root });
  assert.equal(result.ok, false);
  assert.match(result.violations.join(' '), /boundary Git inválido/);
});

test('Etapa 2: P1 com verdict pass é rejeitado pelo MCP', () => {
  const { root, sliceRel } = setupValidatorRun('verdict-p1-pass', {});
  const start = lockValidator({ run_id: 'verdict-p1-pass', project_root: root, action: 'start', state_path: sliceRel });
  const result = lockValidator({
    run_id: 'verdict-p1-pass', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token, verdict: 'pass',
    data: { findings: [{
      id: 'F-001', severity: 'P1', file: 'src/x.js', line: 1,
      failure_mode: 'fluxo quebra', evidence: 'teste falhou', recommendation: 'corrigir fluxo',
      fix_validation: 'node --test', msg: 'fluxo quebra: teste falhou',
    }] },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.validator_status, 'invalid_verdict_severity');
});

test('F-002: findings sem ID, duplicados, inválidos ou incompletos nunca fecham G4', () => {
  const cases = [
    { name: 'id ausente', items: [{ ...finding(), id: undefined }] },
    { name: 'id formato inválido', items: [finding({ id: 'finding-1' })] },
    { name: 'id duplicado', items: [finding(), finding({ file: 'y.ts' })] },
    { name: 'severity desconhecida', items: [finding({ severity: 'critical' })] },
    { name: 'linha inválida', items: [finding({ line: 0 })] },
    { name: 'campo vazio', items: [finding({ evidence: '  ' })] },
  ];
  for (const [index, sample] of cases.entries()) {
    const runId = `finding-shape-${index}`;
    const { root, sliceRel } = setupValidatorRun(runId, {
      'src/foo.js': 'export const x = 1;\n',
    });
    const start = lockValidator({ run_id: runId, project_root: root, action: 'start', state_path: sliceRel });
    const result = lockValidator({
      run_id: runId, project_root: root, action: 'complete', state_path: sliceRel,
      validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
      challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
      data: { findings: sample.items },
    });
    assert.equal(result.status, 'blocked', sample.name);
    assert.equal(result.validator_status, 'invalid_finding_shape', sample.name);
  }
});

test('F-002: packet ausente ou findings não-array nunca fecham G4', () => {
  const cases = [
    { name: 'packet ausente', data: undefined },
    { name: 'findings ausente', data: {} },
    { name: 'findings objeto', data: { findings: {} } },
  ];
  for (const [index, sample] of cases.entries()) {
    const runId = `finding-packet-shape-${index}`;
    const { root, sliceRel } = setupValidatorRun(runId, {
      'src/foo.js': 'export const x = 1;\n',
    });
    const start = lockValidator({ run_id: runId, project_root: root, action: 'start', state_path: sliceRel });
    const complete = {
      run_id: runId, project_root: root, action: 'complete', state_path: sliceRel,
      validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
      challenge_response: sha256File(root, start.challenge.file), verdict: 'pass',
      ...(sample.data === undefined ? {} : { data: sample.data }),
    };
    const result = sample.data === undefined ? lockValidatorCore(complete) : lockValidator(complete);
    assert.equal(result.status, 'blocked', sample.name);
    assert.equal(result.validator_status, 'invalid_finding_shape', sample.name);
  }
});

test('Etapa 2: repair inclui arquivo novo e segundo validator correlaciona finding', () => {
  const { root, head } = initGitFixture();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  const runId = 'repair-correlation';
  const initial = fixtureState('state-repair.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  initial.files_changed = ['src/initial.js'];
  initial.diff_stat = '1 file';
  initial.repair_evidence = [];
  withSnapshot(initial, root);
  const sliceRel = writeSliceState(root, runId, initial);
  preflight({ run_id: runId, project_root: root, mode: 'execute', host: 'claude', host_capabilities: { subagent_available: true, mcp_available: true } });
  lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  const start1 = lockValidator({ run_id: runId, project_root: root, action: 'start', state_path: sliceRel });
  assert.equal(start1.status, 'passed');
  const fail1 = lockValidator({
    run_id: runId, project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start1.validator_run_id, dispatch_token: start1.dispatch_token,
    challenge_response: sha256File(root, start1.challenge.file), verdict: 'fail',
    data: { findings: [{
      id: 'F-001', severity: 'P1', file: 'src/initial.js', line: 1,
      failure_mode: 'evidência incompleta', evidence: 'arquivo auxiliar ausente',
      recommendation: 'criar arquivo auxiliar', fix_validation: 'node --test',
    }] },
  });
  assert.equal(fail1.validator_status, 'repair_required');
  const repairStart = lockValidator({ run_id: runId, project_root: root, action: 'repair_start', state_path: sliceRel });
  assert.equal(repairStart.findings[0].msg, 'evidência incompleta: arquivo auxiliar ausente');
  fs.writeFileSync(path.join(root, 'src/repair-new.js'), 'export const repaired = true;\n');
  const repaired = fixtureState('state-repair.json', { __BASE_SHA__: head, __HEAD_SHA__: head });
  withSnapshot(repaired, root);
  fs.writeFileSync(path.join(root, sliceRel), JSON.stringify({ ...repaired, run_id: runId }, null, 2));
  const repairComplete = lockValidator({
    run_id: runId, project_root: root, action: 'repair_complete', state_path: sliceRel,
    repair_run_id: repairStart.repair_run_id,
    data: { repairs: [{ finding_id: 'F-001', files_touched: ['src/repair-new.js'], checks_run: ['node --test'], status: 'resolved' }] },
  });
  assert.equal(repairComplete.status, 'passed');
  const start2 = lockValidator({ run_id: runId, project_root: root, action: 'start', state_path: sliceRel });
  assert.equal(start2.status, 'passed');
  assert.equal(start2.validator_attempt, 2);
  assert.equal(start2.validator_cycle.findings_packet.findings[0].id, 'F-001');
  const missingCorrelation = lockValidator({
    run_id: runId, project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start2.validator_run_id, dispatch_token: start2.dispatch_token,
    challenge_response: sha256File(root, start2.challenge.file), verdict: 'pass',
    data: { findings: [], repaired_finding_ids: ['F-001'] },
    data: { findings: [], repaired_finding_ids: [] },
  });
  assert.equal(missingCorrelation.status, 'blocked');
  assert.equal(missingCorrelation.validator_status, 'repair_correlation_missing');
  const pass2 = lockValidator({
    run_id: runId, project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start2.validator_run_id, dispatch_token: start2.dispatch_token,
    challenge_response: sha256File(root, start2.challenge.file), verdict: 'pass',
    data: { findings: [], repaired_finding_ids: ['F-001'] },
  });
  assert.equal(pass2.status, 'passed');
  assert.equal(pass2.validator_status, 'passed');
  const boundary = validateStateBoundary(sliceRel, { project_root: root });
  assert.equal(boundary.ok, true);
  assert.ok(boundary.state.files_changed.includes('src/repair-new.js'));
  assert.equal(boundary.state.repair_evidence[0].finding_id, 'F-001');
});

function setupExtendedRepair(runId) {
  const { root, head } = initGitFixture();
  const baseline = captureWorktreeSnapshot(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/initial.js'), 'export const initial = true;\n');
  const initial = planStateForBoundary(root, head, baseline, ['src/initial.js']);
  const sliceRel = writeSliceState(root, runId, initial);
  preflight({
    run_id: runId, project_root: root, mode: 'execute', host: 'claude',
    host_capabilities: { subagent_available: true, mcp_available: true },
  });
  lockDispatch({ run_id: runId, project_root: root, action: 'start', phase: 'plan_execute' });
  const start = lockValidator({ run_id: runId, project_root: root, action: 'start', state_path: sliceRel });
  lockValidator({
    run_id: runId, project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: sha256File(root, start.challenge.file), verdict: 'fail',
    data: { findings: [finding({ file: 'src/initial.js' })] },
  });
  const repairStart = lockValidator({ run_id: runId, project_root: root, action: 'repair_start', state_path: sliceRel });
  return { root, head, baseline, sliceRel, repairStart };
}

function persistExtendedRepair(context, evidence, files) {
  const state = planStateForBoundary(context.root, context.head, context.baseline, files);
  state.task_evidence = [{
    task: 'T03', files: ['src/initial.js'], checks: ['node --test'], result: 'passed',
  }];
  state.repair_evidence = evidence;
  fs.writeFileSync(path.join(context.root, context.sliceRel), JSON.stringify({
    ...state, run_id: path.basename(path.dirname(context.sliceRel)),
  }, null, 2));
}

test('F-005: repair ID desconhecido ou duplicado bloqueia', () => {
  for (const scenario of ['unknown', 'duplicate']) {
    const context = setupExtendedRepair(`repair-${scenario}`);
    fs.writeFileSync(path.join(context.root, 'src/repair.js'), 'export const repair = true;\n');
    const baseEvidence = {
      finding_id: scenario === 'unknown' ? 'F-999' : 'F-001',
      files_touched: ['src/repair.js'], checks_run: ['node --test'], status: 'resolved',
    };
    const evidence = scenario === 'duplicate' ? [baseEvidence, { ...baseEvidence }] : [baseEvidence];
    persistExtendedRepair(context, evidence, ['src/initial.js', 'src/repair.js']);
    const result = lockValidator({
      run_id: `repair-${scenario}`, project_root: context.root, action: 'repair_complete',
      state_path: context.sliceRel, repair_run_id: context.repairStart.repair_run_id,
      data: { repairs: evidence },
    });
    assert.equal(result.status, 'blocked', scenario);
    assert.match(result.error, scenario === 'unknown' ? /ID desconhecido/ : /ID duplicado/);
  }
});

test('F-005: arquivo extra e metadados stale bloqueiam repair_complete', () => {
  const extra = setupExtendedRepair('repair-extra');
  fs.writeFileSync(path.join(extra.root, 'src/repair.js'), 'repair\n');
  fs.writeFileSync(path.join(extra.root, 'src/extra.js'), 'extra\n');
  const evidence = [{
    finding_id: 'F-001', files_touched: ['src/repair.js'], checks_run: ['node --test'], status: 'resolved',
  }];
  persistExtendedRepair(extra, evidence, ['src/initial.js', 'src/repair.js', 'src/extra.js']);
  const extraResult = lockValidator({
    run_id: 'repair-extra', project_root: extra.root, action: 'repair_complete',
    state_path: extra.sliceRel, repair_run_id: extra.repairStart.repair_run_id,
    data: { repairs: evidence },
  });
  assert.equal(extraResult.status, 'blocked');
  assert.match(extraResult.error, /boundary|evidência/);

  const stale = setupExtendedRepair('repair-stale');
  fs.writeFileSync(path.join(stale.root, 'src/repair.js'), 'repair\n');
  persistExtendedRepair(stale, evidence, ['src/initial.js', 'src/repair.js']);
  const raw = JSON.parse(fs.readFileSync(path.join(stale.root, stale.sliceRel), 'utf8'));
  raw.diff_stat = '0 files';
  fs.writeFileSync(path.join(stale.root, stale.sliceRel), JSON.stringify(raw, null, 2));
  const staleResult = lockValidator({
    run_id: 'repair-stale', project_root: stale.root, action: 'repair_complete',
    state_path: stale.sliceRel, repair_run_id: stale.repairStart.repair_run_id,
    data: { repairs: evidence },
  });
  assert.equal(staleResult.status, 'blocked');
  assert.match(staleResult.error, /diff_stat stale/);
});

test('proof-of-work: boundary sem arquivo legível não emite challenge nem exige resposta (não quebra)', () => {
  const { root, sliceRel } = setupValidatorRun('pow5', {}); // files_changed vazio
  const start = lockValidator({ run_id: 'pow5', project_root: root, action: 'start', state_path: sliceRel });
  assert.equal(start.challenge, null, 'sem arquivo no boundary → challenge null');
  const done = lockValidator({
    run_id: 'pow5', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token, verdict: 'pass',
  });
  assert.equal(done.status, 'passed', 'sem challenge não há enforcement (backward-compat)');
  assert.equal(done.challenge_verified, 'no_challenge');
});

test('proof-of-work: challenge é re-emitido e enforçado no attempt 2 (fail→repair→retry)', () => {
  const { root, sliceRel } = setupValidatorRun('pow6', {
    'src/a.js': 'export const a = 1;\n',
    'src/b.js': 'export const b = 2;\n',
  });
  // attempt 1: fail com challenge correto → repair_required.
  const start1 = lockValidator({ run_id: 'pow6', project_root: root, action: 'start', state_path: sliceRel });
  assert.ok(start1.challenge, 'attempt 1 emite challenge');
  const fail1 = lockValidator({
    run_id: 'pow6', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start1.validator_run_id, dispatch_token: start1.dispatch_token,
    challenge_response: sha256File(root, start1.challenge.file), verdict: 'fail',
    data: { findings: [finding({ file: 'src/a.js' })] },
  });
  assert.equal(fail1.validator_status, 'repair_required');
  assert.equal(fail1.challenge_verified, 'verified', 'fail também exige proof-of-work');

  // repair completo → retry autorizado.
  const rs = lockValidator({ run_id: 'pow6', project_root: root, action: 'repair_start', state_path: sliceRel });
  lockValidator({
    run_id: 'pow6', project_root: root, action: 'repair_complete', repair_run_id: rs.repair_run_id,
    state_path: sliceRel, data: resolvedRepair(root, sliceRel, 'F-001', 'src/a.js'),
  });

  // attempt 2: NOVO challenge (novo dispatch_token), enforçado de novo.
  const start2 = lockValidator({ run_id: 'pow6', project_root: root, action: 'start', state_path: sliceRel });
  assert.equal(start2.validator_attempt, 2);
  assert.ok(start2.challenge, 'attempt 2 re-emite challenge');
  // hash errado no attempt 2 ainda bloqueia.
  const bad2 = lockValidator({
    run_id: 'pow6', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start2.validator_run_id, dispatch_token: start2.dispatch_token,
    challenge_response: 'deadbeef', verdict: 'pass',
  });
  assert.equal(bad2.validator_status, 'challenge_failed');
  // hash correto do challenge do attempt 2 fecha terminal.
  const pass2 = lockValidator({
    run_id: 'pow6', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start2.validator_run_id, dispatch_token: start2.dispatch_token,
    challenge_response: sha256File(root, start2.challenge.file), verdict: 'pass',
    data: { findings: [], repaired_finding_ids: ['F-001'] },
  });
  assert.equal(pass2.status, 'passed');
  assert.equal(pass2.challenge_verified, 'verified');
});

test('proof-of-work: arquivo do challenge some entre start e complete → fail-closed', () => {
  const { root, sliceRel } = setupValidatorRun('pow7', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow7', project_root: root, action: 'start', state_path: sliceRel });
  assert.ok(start.challenge);
  // arquivo do boundary deletado depois do start (ex.: slice que removeu o arquivo).
  fs.rmSync(path.join(root, start.challenge.file));
  const done = lockValidator({
    run_id: 'pow7', project_root: root, action: 'complete', state_path: sliceRel,
    validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
    challenge_response: 'qualquer-coisa', verdict: 'pass',
  });
  assert.equal(done.status, 'blocked', 'mutação do boundary após start deve bloquear');
  assert.equal(done.validator_status, 'challenge_failed');
  assert.match(done.error, /challenge_file_unreadable/);
});

test('proof-of-work: falhas de challenge são bounded — esgotado o teto, slot fecha terminal (challenge_exhausted)', () => {
  const { root, sliceRel } = setupValidatorRun('pow8', { 'src/foo.js': 'export const x = 1;\n' });
  const start = lockValidator({ run_id: 'pow8', project_root: root, action: 'start', state_path: sliceRel });
  let last;
  // Hash sempre errado: re-dispatch deve parar em algum momento (fail-closed),
  // nunca loopar. Bound em poucas iterações independe do valor da constante.
  for (let i = 0; i < 6; i += 1) {
    last = lockValidator({
      run_id: 'pow8', project_root: root, action: 'complete', state_path: sliceRel,
      validator_run_id: start.validator_run_id, dispatch_token: start.dispatch_token,
      challenge_response: 'deadbeef', verdict: 'pass',
    });
    if (last.validator_status === 'challenge_exhausted') break;
    assert.equal(last.validator_status, 'challenge_failed', `iteração ${i} ainda em re-dispatch`);
  }
  assert.equal(last.validator_status, 'challenge_exhausted', 'o re-dispatch é bounded e termina');
  assert.equal(last.cause, 'validator_proof_of_work_exhausted');
  assert.equal(last.status, 'blocked');
  // Slot fechado terminal: recovery não expõe mais validador ativo.
  const rec = runState({ action: 'get', run_id: 'pow8', project_root: root }).validator_recovery;
  assert.equal(rec, null, 'slot terminal fechado (sem active)');
});
