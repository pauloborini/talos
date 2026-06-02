#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'atlas-workflow-orchestrator';
const RUN_DIR = path.join('.atlas', 'state');
const SENSITIVE_KEY = /(authorization|credential|password|secret|token|api[_-]?key)/i;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRD_PATTERNS = {
  section_3_objective: ['TBD', 'a confirmar', 'talvez', 'não definido'],
  section_4_scope: ['pode ser', 'depende de', 'ainda não', 'incompleto'],
  section_5_decisions: ['vago'],
  section_8_experience: ['a definir', 'gap', 'depende de'],
  section_9_contracts: ['ainda não definido', 'mock apenas', 'a confirmar'],
};
const SECTION_LABELS = {
  section_3_objective: '§3 Objetivo',
  section_4_scope: '§4 Escopo funcional',
  section_5_decisions: '§5 Decisões de produto',
  section_8_experience: '§8 Fluxos e cenários UX',
  section_9_contracts: '§9 Contrato funcional',
};
const SECTION_HEADING = {
  section_3_objective: /^##\s+3\.\s+/,
  section_4_scope: /^##\s+4\.\s+/,
  section_5_decisions: /^##\s+5\.\s+/,
  section_8_experience: /^##\s+8\.\s+/,
  section_9_contracts: /^##\s+9\.\s+/,
};
const REQUIRED_PRD_SECTIONS = [
  ['1', 'Resumo'],
  ['2', 'Problema'],
  ['3', 'Objetivo'],
  ['4', 'Escopo funcional'],
  ['5', 'Decisões de produto'],
  ['6', 'Regras e invariantes'],
  ['7', 'Antes e depois'],
  ['8', 'Fluxos e cenários UX'],
  ['9', 'Contrato funcional'],
  ['10', 'Critérios de aceite'],
  ['11', 'Riscos'],
  ['12', 'Dependências'],
  ['13', 'Referências'],
  ['14', 'Histórico'],
];
const REQUIRED_PLAN_SECTIONS = [
  ['1', 'Tradução executiva'],
  ['2', 'Invariantes de execução'],
  ['3', 'Pitfalls'],
  ['4', 'Estado na abertura da sprint'],
  ['5', 'Tarefas de execução'],
  ['6', 'Contratos técnicos'],
  ['7', 'Slices'],
  ['8', 'Validação e checklist'],
];
const WORKFLOW_CONFIG = {
  path: 'builtin:atlas-workflow-v0.3.0',
  skills: {
    prd_generator: 'atlas-sprint-prd-generator',
    prd_interview: 'atlas-prd-interview',
    plan_handoff: 'atlas-plan-handoff',
    plan_execute: 'atlas-plan-execute',
    slice_review: 'atlas-slice-review',
    task_validator: 'atlas-task-validator',
  },
  modes: ['full', 'direct', 'interview-only', 'interview_only'],
};
// Camada de adapter: conhecimento host-específico centralizado em código.
// Skills consultam atlas_capabilities e usam o descritor retornado em vez de
// hardcodar nome de host. Adicionar host novo = adicionar entrada aqui.
// Contrato HostAdapter (DEC-007): entrada runtime data-driven. Campos:
//   subagent_dispatch, todo_tool, hooks, capabilities_flags. plan_paths/state são
//   portáveis (iguais a todos os hosts) e vivem em capabilities(). Adicionar host =
//   adicionar entrada aqui; nenhum ramo `if host==` em outro lugar.
// capabilities_flags: pré-requisitos essenciais (subagent_available, mcp_available)
//   são hard-fail no preflight (DEC-004); todo_available é não-essencial.
const HOST_ADAPTERS = {
  claude: {
    label: 'Claude Code',
    subagent_dispatch: {
      mechanism: 'Agent(subagent_type)',
      example: 'Agent(subagent_type: "atlas-task-validator", prompt: "<state_path>")',
      registration: 'agents/<name>.md na raiz do plugin',
    },
    todo_tool: 'TodoWrite',
    hooks: { supported: true, mechanism: 'hooks/claude/settings.snippet.json' },
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
  },
  codex: {
    label: 'Codex App',
    subagent_dispatch: {
      mechanism: '$<skill-name>',
      example: 'invocar $atlas-task-validator com <state_path> como único argumento',
      registration: 'agents/openai.yaml por skill (allow_implicit_invocation)',
    },
    todo_tool: 'tasks',
    hooks: { supported: false, mechanism: null },
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
  },
  generic: {
    label: 'Host genérico',
    subagent_dispatch: {
      mechanism: 'subagente nativo do host',
      example: 'despachar o subagente atlas-task-validator passando apenas <state_path>',
      registration: 'mecanismo nativo equivalente do host',
    },
    todo_tool: null,
    hooks: { supported: false, mechanism: null },
    // generic EXIGE subagente+MCP do host (DEC-004); host MCP-only sem subagente
    // fica fora de escopo e é rejeitado no preflight, não degradado.
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: false },
  },
};

// Pré-requisitos de determinismo (DEC-004): essenciais → hard-fail no preflight;
// não-essenciais → seguem sem o recurso, registrando. Contrato consumido por S09.
const PREREQUISITES = {
  essential: ['subagent_available', 'mcp_available'],
  non_essential: ['todo_available'],
};

// Versão do contrato atlas_capabilities. Política: incremento aditivo (campos novos
// opcionais) mantém compat — consumidores DEVEM ignorar campos desconhecidos.
// Remoção/renomeação de campo ou mudança de semântica exige bump e nota de migração.
// v1 → v2: adiciona capabilities_flags, hooks, prerequisites, known_hosts (aditivo).
const CAPABILITIES_SCHEMA_VERSION = 2;

function detectHost(args = {}) {
  if (args.host && HOST_ADAPTERS[args.host]) return { host: args.host, detected_via: 'arg' };
  const override = process.env.ATLAS_HOST;
  if (override && HOST_ADAPTERS[override]) return { host: override, detected_via: 'env:ATLAS_HOST' };
  if (process.env.CLAUDE_PLUGIN_ROOT) return { host: 'claude', detected_via: 'env:CLAUDE_PLUGIN_ROOT' };
  if (process.env.CODEX_HOME || process.env.CODEX_PLUGIN_ROOT) return { host: 'codex', detected_via: 'env:CODEX' };
  return { host: 'generic', detected_via: 'default' };
}

function capabilities(args = {}) {
  const { host, detected_via } = detectHost(args);
  const adapter = HOST_ADAPTERS[host];
  return {
    host,
    host_label: adapter.label,
    detected_via,
    schema_version: CAPABILITIES_SCHEMA_VERSION,
    subagent_dispatch: adapter.subagent_dispatch,
    todo_tool: adapter.todo_tool,
    hooks: adapter.hooks,
    capabilities_flags: adapter.capabilities_flags,
    prerequisites: PREREQUISITES,
    plan_paths: {
      write: '.atlas/plans/',
      read_order: ['.atlas/plans/', '.cursor/plans/', '.codex/plans/'],
      deprecated_read: ['.cursor/plans/', '.codex/plans/'],
    },
    state_backend: 'atlas_run_state',
    state_dir: RUN_DIR,
    known_hosts: Object.keys(HOST_ADAPTERS),
  };
}

const LEGACY_ROUTE_KEY = ['fam', 'ily'].join('');
const VERSION_CANDIDATES = [
  path.resolve(SERVER_DIR, '../../VERSION'),
];
const PACKAGE_VERSION_CANDIDATES = [
  path.resolve(SERVER_DIR, 'package.json'),
];

function readVersion() {
  const info = readVersionInfo();
  return info.version;
}

function readVersionInfo() {
  let rootVersion = null;
  let packageVersion = null;
  const errors = [];

  for (const candidate of VERSION_CANDIDATES) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value) {
        rootVersion = value;
        break;
      }
    } catch (error) {
      errors.push({ path: candidate, cause: error.message });
    }
  }

  for (const candidate of PACKAGE_VERSION_CANDIDATES) {
    try {
      if (!fs.existsSync(candidate)) continue;
      packageVersion = JSON.parse(fs.readFileSync(candidate, 'utf8')).version || null;
      if (packageVersion) break;
    } catch (error) {
      errors.push({ path: candidate, cause: error.message });
    }
  }

  const version = rootVersion || packageVersion || 'unknown';
  const mismatch = rootVersion && packageVersion && rootVersion !== packageVersion;
  return {
    version,
    root_version: rootVersion,
    package_version: packageVersion,
    status: mismatch ? 'blocked' : 'passed',
    error: mismatch ? `Drift de versão: VERSION=${rootVersion}, package.json=${packageVersion}` : null,
    errors,
    next_action: mismatch ? 'alinhar_versoes_do_plugin' : 'avançar',
  };
}

function parseWorkflowConfig() {
  return WORKFLOW_CONFIG;
}

function consumerRoot(args = {}) {
  const explicitRoot = optionalString(args, 'project_root');
  return path.resolve(explicitRoot && explicitRoot.trim() !== '' ? explicitRoot : process.cwd());
}

function runRoot(args = {}) {
  return path.join(consumerRoot(args), RUN_DIR);
}

function ensureRunDir(args = {}) {
  const dir = runRoot(args);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw rpcError(-32602, 'run_id obrigatório');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw rpcError(-32602, 'run_id inválido: use apenas letras, números, ponto, hífen ou underscore');
  }
  return runId;
}

function optionalString(args, key) {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw rpcError(-32602, `Campo inválido: ${key} deve ser string`);
  }
  return value;
}

function optionalData(args) {
  if (args.data === undefined || args.data === null) return undefined;
  if (typeof args.data !== 'object' || Array.isArray(args.data)) {
    throw rpcError(-32602, 'Campo inválido: data deve ser objeto');
  }
  return args.data;
}

function requiredString(args, key) {
  const value = optionalString(args, key);
  if (!value || value.trim() === '') {
    throw rpcError(-32602, `${key} obrigatório`);
  }
  return value;
}

function resolveConsumerPath(inputPath, args = {}) {
  const value = requiredString({ value: inputPath }, 'value');
  return path.resolve(consumerRoot(args), value);
}

function statePath(runId, args = {}) {
  const runDir = path.join(ensureRunDir(args), validateRunId(runId));
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  return path.join(runDir, 'run.json');
}

function nowIso() {
  return new Date().toISOString();
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(nested),
    ]),
  );
}

function logCall(entry, args = {}) {
  const line = JSON.stringify({ timestamp: nowIso(), ...entry }) + '\n';
  fs.appendFileSync(path.join(ensureRunDir(args), 'mcp.log'), line, { mode: 0o600 });
}

function rpcError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  error.data = data;
  return error;
}

function ping() {
  const version = readVersionInfo();
  return {
    status: version.status === 'passed' ? 'alive' : 'blocked',
    name: SERVER_NAME,
    version: version.version,
    version_check: version,
    transport: 'stdio',
    capabilities: [
      'atlas_ping',
      'atlas_capabilities',
      'atlas_run_state',
      'atlas_verify_artifact',
      'atlas_scan_prd',
      'atlas_verify_template_conformance',
      'atlas_preflight',
      'atlas_lock_dispatch',
      'atlas_assert_after_plan',
    ],
    state_dir: RUN_DIR,
  };
}

function stateInvalid(message, cause, extra = {}) {
  return {
    status: 'blocked',
    error: message,
    cause,
    impact: 'ledger_nao_confiavel_fase_bloqueada',
    next_action: 'recuperar_ou_remover_estado_invalido_com_decisao_explicita',
    ...extra,
  };
}

function validateStateShape(state, source) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return stateInvalid(`Estado local incompatível: ${source}`, 'state_nao_e_objeto');
  }
  if (typeof state.run_id !== 'string' || state.run_id.trim() === '') {
    return stateInvalid(`Estado local parcial: ${source}`, 'run_id_ausente_ou_invalido');
  }
  if (typeof state.phase !== 'string' || state.phase.trim() === '') {
    return stateInvalid(`Estado local parcial: ${source}`, 'phase_ausente_ou_invalida', { run_id: state.run_id });
  }
  if (typeof state.status !== 'string' || state.status.trim() === '') {
    return stateInvalid(`Estado local parcial: ${source}`, 'status_ausente_ou_invalido', { run_id: state.run_id });
  }
  if (!state.data || typeof state.data !== 'object' || Array.isArray(state.data)) {
    return stateInvalid(`Estado local parcial: ${source}`, 'data_ausente_ou_invalida', { run_id: state.run_id });
  }
  const stateVersion = state.data?.routing?.version;
  const currentVersion = readVersionInfo().version;
  if (stateVersion && stateVersion !== currentVersion) {
    return stateInvalid(
      `Estado local incompatível: ${source}`,
      `routing.version=${stateVersion}, current=${currentVersion}`,
      {
        run_id: state.run_id,
        impact: 'pipeline_hibrido_poderia_gerar_ledger_falso',
        next_action: 'reiniciar_run_apos_alinhar_versao_do_plugin',
      },
    );
  }
  return { status: 'passed', state };
}

function inspectRunStateFile(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validateStateShape(state, path.basename(file));
  } catch (error) {
    return stateInvalid(
      `Estado local corrompido: ${file}`,
      error.message,
      { next_action: 'recuperar_ou_remover_estado_corrompido_com_decisao_explicita' },
    );
  }
}

function findActiveRunConflict(runId, args = {}) {
  const dir = ensureRunDir(args);
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'run.json');
    if (!fs.existsSync(file)) continue;
    const inspected = inspectRunStateFile(file);
    if (inspected.status === 'blocked') return inspected;
    const state = inspected.state;
    if (state.run_id === runId) continue;
    const active = state.data?.dispatch?.active;
    if (active?.phase) {
      return {
        status: 'blocked',
        error: `Lock conflict: run ativa ${state.run_id} na fase ${active.phase}`,
        cause: 'dispatch_ativo_em_outra_run',
        impact: 'segunda_run_poderia_corromper_estado_ou_ledger',
        conflicting_run_id: state.run_id,
        active_phase: active.phase,
        next_action: 'aguardar_ou_liberar_lock_com_decisao_explicita',
      };
    }
  }
  return { status: 'passed' };
}

function readState(runId, args = {}) {
  const file = statePath(runId, args);
  if (!fs.existsSync(file)) {
    throw rpcError(-32004, `Run inexistente: ${runId}`, { run_id: runId });
  }
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const inspected = validateStateShape(state, `${runId}.json`);
    if (inspected.status === 'blocked') {
      throw rpcError(-32003, `Estado inválido para run: ${runId}`, {
        run_id: runId,
        cause: inspected.cause,
        impact: inspected.impact,
        next_action: inspected.next_action,
      });
    }
    return state;
  } catch (cause) {
    if (cause.code) throw cause;
    throw rpcError(-32003, `Estado inválido para run: ${runId}`, {
      run_id: runId,
      cause: cause.message,
      impact: 'ledger_nao_confiavel_fase_bloqueada',
      next_action: 'recuperar_ou_remover_estado_corrompido_com_decisao_explicita',
    });
  }
}

function upsertState(args) {
  const runId = validateRunId(args.run_id);
  const phase = optionalString(args, 'phase');
  const status = optionalString(args, 'status');
  const summary = optionalString(args, 'summary');
  const data = optionalData(args);
  const timestamp = nowIso();
  let previous = null;

  try {
    previous = readState(runId, args);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const next = {
    run_id: runId,
    phase: phase ?? previous?.phase ?? 'unknown',
    status: status ?? previous?.status ?? 'unknown',
    summary: summary ?? previous?.summary ?? null,
    data: redact(data ?? previous?.data ?? {}),
    created_at: previous?.created_at ?? timestamp,
    updated_at: timestamp,
    last_call: {
      tool: 'atlas_run_state',
      action: 'upsert',
      timestamp,
    },
  };

  const target = statePath(runId, args);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
  return next;
}

function patchGateResult(runId, gate, result, args = {}) {
  let previous = null;
  try {
    previous = readState(runId, args);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const data = {
    ...(previous?.data ?? {}),
    gates: {
      ...(previous?.data?.gates ?? {}),
      [gate]: redact(result),
    },
  };

  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous?.phase ?? 'gates',
    status: result.status === 'passed' ? 'gate_passed' : 'gate_blocked',
    summary: `${gate}: ${result.status}`,
    data,
  });
}

function patchTemplateConformanceResult(runId, result, args = {}) {
  let previous = null;
  try {
    previous = readState(runId, args);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const data = {
    ...(previous?.data ?? {}),
    template_conformance: redact(result),
    gates: {
      ...(previous?.data?.gates ?? {}),
      template_conformance: redact(result),
    },
  };

  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous?.phase ?? 'template_conformance',
    status: result.status === 'passed' ? 'template_conformance_passed' : 'template_conformance_blocked',
    summary: `template_conformance: ${result.status}`,
    data,
  });
}

function patchRoutingResult(runId, result, args = {}) {
  let previous = null;
  try {
    previous = readState(runId, args);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const data = {
    ...(previous?.data ?? {}),
    routing: result.routing ?? previous?.data?.routing ?? null,
    gates: {
      ...(previous?.data?.gates ?? {}),
      [result.gate ?? 'G10']: redact(result),
    },
  };

  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous?.phase ?? 'preflight',
    status: result.status === 'passed' ? 'preflight_passed' : 'preflight_blocked',
    summary: `G10: ${result.status}`,
    data,
  });
}

function patchDispatchResult(runId, result, args = {}) {
  const previous = readState(runId, args);
  const currentDispatch = previous.data?.dispatch ?? {};
  const history = [
    ...(currentDispatch.history ?? []),
    {
      timestamp: result.timestamp,
      phase: result.phase ?? null,
      action: result.action ?? null,
      status: result.status,
      next_action: result.next_action ?? null,
      error: result.error ?? null,
    },
  ];
  const data = {
    ...(previous.data ?? {}),
    dispatch: {
      ...currentDispatch,
      ...(result.dispatch ?? {}),
      history,
    },
    gates: {
      ...(previous.data?.gates ?? {}),
      [result.gate ?? 'G7']: redact(result),
    },
  };

  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous.phase ?? 'dispatch',
    status: result.status === 'passed' ? 'dispatch_ok' : 'dispatch_blocked',
    summary: `${result.gate ?? 'G7'}: ${result.status}`,
    data,
  });
}

function runState(args = {}) {
  const action = args.action ?? 'get';
  if (action === 'get') return readState(validateRunId(args.run_id), args);
  if (action === 'upsert') return upsertState(args);
  throw rpcError(-32602, `Ação inválida para atlas_run_state: ${action}`);
}

function verifyArtifact(args = {}) {
  const runId = validateRunId(args.run_id);
  const artifactPath = requiredString(args, 'artifact_path');
  const absolutePath = resolveConsumerPath(artifactPath, args);
  const timestamp = nowIso();
  let result;

  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      result = {
        gate: 'G1',
        status: 'blocked',
        artifact_path: artifactPath,
        timestamp,
        error: `Artefato não é arquivo legível: ${artifactPath}`,
        next_action: 'corrigir_artefato',
      };
    } else {
      fs.accessSync(absolutePath, fs.constants.R_OK);
      result = {
        gate: 'G1',
        status: 'passed',
        artifact_path: artifactPath,
        bytes: stat.size,
        timestamp,
        next_action: 'avançar',
      };
    }
  } catch (error) {
    result = {
      gate: 'G1',
      status: 'blocked',
      artifact_path: artifactPath,
      timestamp,
      error: `Artefato ausente ou ilegível: ${artifactPath}`,
      cause: error.message,
      next_action: 'corrigir_artefato',
    };
  }

  patchGateResult(runId, 'G1', result, args);
  return result;
}

function splitPrdSections(content) {
  const sections = {};
  let current = null;
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matched = Object.entries(SECTION_HEADING).find(([, regex]) => regex.test(line));
    if (matched) current = matched[0];
    if (current) {
      sections[current] ??= [];
      sections[current].push({ line: index + 1, text: line });
    }
  }

  return sections;
}

function lineIsExcluded(line) {
  return line.toLowerCase().includes('depende de plano');
}

function scanSectionPatterns(sections) {
  const matches = [];

  for (const [sectionKey, patterns] of Object.entries(PRD_PATTERNS)) {
    const lines = sections[sectionKey] ?? [];
    const sectionText = lines.map((line) => line.text).join('\n').trim();

    if (sectionKey === 'section_5_decisions') {
      const hasDecisionRows = /\|\s*D\d+\s*\|/.test(sectionText);
      if (!hasDecisionRows) {
        matches.push({
          section: SECTION_LABELS[sectionKey],
          pattern: '(empty or minimal content)',
          line: lines[0]?.line ?? null,
          excerpt: 'Seção sem decisão D* fechada.',
          reason: 'Decisões de produto vazias ou mínimas bloqueiam planejamento.',
        });
      }
    }

    for (const { line, text } of lines) {
      if (lineIsExcluded(text)) continue;
      const lower = text.toLowerCase();
      for (const pattern of patterns) {
        if (lower.includes(pattern.toLowerCase())) {
          matches.push({
            section: SECTION_LABELS[sectionKey],
            pattern,
            line,
            excerpt: text.trim().slice(0, 240),
            reason: 'Padrão de ambiguidade bloqueante detectado.',
          });
        }
      }
    }
  }

  return matches;
}

function scanPrd(args = {}) {
  const runId = validateRunId(args.run_id);
  const prdPath = requiredString(args, 'prd_path');
  const absolutePath = resolveConsumerPath(prdPath, args);
  const timestamp = nowIso();
  let result;

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.trim() === '') {
      result = {
        gate: 'G5',
        status: 'blocked',
        prd_path: prdPath,
        timestamp,
        blocking_count: 1,
        blocking_matches: [{
          section: 'documento',
          pattern: '(empty file)',
          line: null,
          excerpt: '',
          reason: 'PRD vazio não pode avançar como documento pronto.',
        }],
        next_action: 'entrevista',
      };
    } else {
      const blockingMatches = scanSectionPatterns(splitPrdSections(content));
      result = {
        gate: 'G5',
        status: blockingMatches.length === 0 ? 'passed' : 'blocked',
        prd_path: prdPath,
        timestamp,
        blocking_count: blockingMatches.length,
        blocking_matches: blockingMatches,
        next_action: blockingMatches.length === 0 ? 'avançar' : 'entrevista',
        message: blockingMatches.length === 0
          ? 'Ambiguity scan: 0 padrões bloqueantes — entrevista pulada'
          : 'Ambiguity scan: padrões bloqueantes encontrados — entrevista obrigatória',
      };
    }
  } catch (error) {
    result = {
      gate: 'G5',
      status: 'blocked',
      prd_path: prdPath,
      timestamp,
      blocking_count: 1,
      blocking_matches: [{
        section: 'documento',
        pattern: '(read error)',
        line: null,
        excerpt: '',
        reason: `PRD ilegível: ${prdPath}`,
      }],
      error: `PRD ausente ou ilegível: ${prdPath}`,
      cause: error.message,
      next_action: 'entrevista',
    };
  }

  patchGateResult(runId, 'G5', result, args);
  return result;
}

function collectHeadings(content) {
  const headings = new Map();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = /^##\s+(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (match) headings.set(match[1], { title: match[2], line: index + 1 });
  }
  return headings;
}

function hasRequiredStatus(content, requiredStatus) {
  const regex = new RegExp(`\\|\\s*\\*\\*Status\\*\\*\\s*\\|\\s*${requiredStatus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`, 'i');
  return regex.test(content);
}

function conformancePending(category, item, line, message, nextAction = 'corrigir_artefato') {
  return { category, item, line, message, next_action: nextAction };
}

function verifyRequiredSections(headings, requiredSections) {
  return requiredSections
    .filter(([number]) => !headings.has(number))
    .map(([number, title]) => conformancePending(
      'seção_obrigatória',
      `§${number} ${title}`,
      null,
      `Seção obrigatória ausente: §${number} ${title}`,
    ));
}

function verifyPrdConformance(content, requiredStatus) {
  const pendencies = verifyRequiredSections(collectHeadings(content), REQUIRED_PRD_SECTIONS);

  if (requiredStatus && !hasRequiredStatus(content, requiredStatus)) {
    pendencies.push(conformancePending(
      'status',
      requiredStatus,
      null,
      `Status documental requerido ausente: ${requiredStatus}`,
      'ajustar_status_documental',
    ));
  }

  if (!/\|\s*D\d+\s*\|/.test(content)) {
    pendencies.push(conformancePending(
      'decisões',
      'D*',
      null,
      'PRD sem decisões D* fechadas.',
      'registrar_decisoes_fechadas',
    ));
  }

  for (const group of ['Produto', 'UX', 'Dados', 'Regressão de produto']) {
    if (!new RegExp(`\\*\\*${group}\\*\\*`, 'i').test(content)) {
      pendencies.push(conformancePending(
        'critérios_de_aceite',
        group,
        null,
        `Grupo de critérios ausente: ${group}`,
        'completar_criterios_de_aceite',
      ));
    }
  }

  const checkboxCount = (content.match(/^- \[[ xX]\]\s+\S/gm) ?? []).length;
  if (checkboxCount === 0) {
    pendencies.push(conformancePending(
      'critérios_de_aceite',
      'checkboxes',
      null,
      'Critérios de aceite observáveis não encontrados.',
      'completar_criterios_de_aceite',
    ));
  }

  return pendencies;
}

function verifyPlanConformance(content) {
  const pendencies = verifyRequiredSections(collectHeadings(content), REQUIRED_PLAN_SECTIONS);

  if (!/\|\s*\*\*PRD\*\*\s*\|/.test(content)) {
    pendencies.push(conformancePending(
      'referência_prd',
      'PRD',
      null,
      'Plano sem link/campo PRD no cabeçalho.',
      'vincular_prd',
    ));
  }

  if (!/####\s+T\d+\./.test(content)) {
    pendencies.push(conformancePending(
      'tarefas',
      'T01..Tn',
      null,
      'Plano sem tarefas numeradas T01..Tn.',
      'criar_tarefas_numeradas',
    ));
  }

  if (!/BOUNDARY_PRD_PLAN\.md/.test(content)) {
    pendencies.push(conformancePending(
      'boundary',
      'BOUNDARY_PRD_PLAN.md',
      null,
      'Plano sem referência à fronteira PRD/PLAN.',
      'vincular_boundary',
    ));
  }

  return pendencies;
}

function verifyTemplateConformance(args = {}) {
  const runId = validateRunId(args.run_id);
  const artifactPath = requiredString(args, 'artifact_path');
  const artifactType = requiredString(args, 'artifact_type');
  if (!['prd', 'plan'].includes(artifactType)) {
    throw rpcError(-32602, 'artifact_type inválido: use prd ou plan');
  }

  const requiredStatus = optionalString(args, 'required_status');
  const absolutePath = resolveConsumerPath(artifactPath, args);
  const timestamp = nowIso();
  let result;

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.trim() === '') {
      result = {
        gate: 'template_conformance',
        status: 'blocked',
        artifact_type: artifactType,
        artifact_path: artifactPath,
        timestamp,
        pending_count: 1,
        pendencies: [conformancePending(
          'documento',
          'arquivo_vazio',
          null,
          'Artefato vazio não pode passar em conformidade.',
        )],
        next_action: 'corrigir_artefato',
      };
    } else {
      const pendencies = artifactType === 'prd'
        ? verifyPrdConformance(content, requiredStatus)
        : verifyPlanConformance(content);
      result = {
        gate: 'template_conformance',
        status: pendencies.length === 0 ? 'passed' : 'blocked',
        artifact_type: artifactType,
        artifact_path: artifactPath,
        required_status: requiredStatus ?? null,
        timestamp,
        pending_count: pendencies.length,
        pendencies,
        next_action: pendencies.length === 0 ? 'avançar' : pendencies[0].next_action,
      };
    }
  } catch (error) {
    result = {
      gate: 'template_conformance',
      status: 'blocked',
      artifact_type: artifactType,
      artifact_path: artifactPath,
      timestamp,
      pending_count: 1,
      pendencies: [conformancePending(
        'leitura',
        artifactPath,
        null,
        `Artefato ausente ou ilegível: ${artifactPath}`,
      )],
      error: `Artefato ausente ou ilegível: ${artifactPath}`,
      cause: error.message,
      next_action: 'corrigir_artefato',
    };
  }

  patchTemplateConformanceResult(runId, result, args);
  return result;
}

function preflight(args = {}) {
  const runId = validateRunId(args.run_id);
  if (Object.prototype.hasOwnProperty.call(args, LEGACY_ROUTE_KEY)) {
    throw rpcError(-32602, `unknown_property: ${LEGACY_ROUTE_KEY}`);
  }
  const mode = requiredString(args, 'mode');
  const expectedVersion = optionalString(args, 'expected_version');
  const config = parseWorkflowConfig();
  const version = readVersionInfo();
  const activeConflict = findActiveRunConflict(runId, args);
  const timestamp = nowIso();
  let previous = null;

  try {
    previous = readState(runId, args);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const currentRouting = previous?.data?.routing;
  let result;

  if (version.status === 'blocked') {
    result = {
      gate: 'VERSION_DRIFT',
      status: 'blocked',
      timestamp,
      mode,
      version,
      error: version.error,
      cause: version.error,
      impact: 'pipeline_hibrido_poderia_gerar_artefato_invalido',
      next_action: version.next_action,
    };
  } else if (expectedVersion && expectedVersion !== version.version) {
    result = {
      gate: 'VERSION_DRIFT',
      status: 'blocked',
      timestamp,
      mode,
      expected_version: expectedVersion,
      received_version: version.version,
      error: `Drift de versão: esperado ${expectedVersion}, MCP reportou ${version.version}`,
      cause: 'expected_version_diverge_do_mcp',
      impact: 'pipeline_hibrido_poderia_gerar_artefato_invalido',
      next_action: 'alinhar_versao_do_host_ou_reinstalar_plugin',
    };
  } else if (activeConflict.status === 'blocked') {
    result = {
      gate: 'LOCK_CONFLICT',
      status: 'blocked',
      timestamp,
      mode,
      error: activeConflict.error,
      cause: activeConflict.cause ?? null,
      impact: activeConflict.impact ?? 'workflow_bloqueado_para_preservar_integridade_do_ledger',
      conflicting_run_id: activeConflict.conflicting_run_id ?? null,
      active_phase: activeConflict.active_phase ?? null,
      next_action: activeConflict.next_action,
    };
  } else if (!config.modes.includes(mode)) {
    result = {
      gate: 'G10',
      status: 'blocked',
      timestamp,
      mode,
      error: `Modo inválido: ${mode}`,
      supported_modes: config.modes,
      next_action: 'corrigir_rota',
    };
  } else if (currentRouting && currentRouting.mode !== mode) {
      result = {
        gate: 'G10',
        status: 'blocked',
        timestamp,
        mode,
        locked_mode: currentRouting.mode,
        error: `Troca de modo bloqueada: ${currentRouting.mode} -> ${mode}`,
        next_action: 'encerrar_run_ou_usar_modo_travado',
      };
  } else {
    result = {
      gate: 'G10',
      status: 'passed',
      timestamp,
      mode,
      routing: {
        mode,
        skills: config.skills,
        version: version.version,
        locked_at: currentRouting?.locked_at ?? timestamp,
        config_path: config.path,
        supported_modes: config.modes,
      },
      next_action: 'avançar',
    };
  }

  patchRoutingResult(runId, result, args);
  return result;
}

function getDispatchState(runId, args = {}) {
  const state = readState(runId, args);
  const routing = state.data?.routing;
  if (!routing) {
    throw rpcError(-32011, 'Preflight não executado: execute atlas_preflight antes do dispatch', {
      run_id: runId,
    });
  }
  return { state, routing, dispatch: state.data?.dispatch ?? {} };
}

function expectedNextPhase(routing, dispatch) {
  if (dispatch.next_phase) return dispatch.next_phase;
  if (routing.mode === 'full') return 'plan_handoff';
  if (routing.mode === 'direct') return 'plan_execute';
  return 'prd_interview';
}

function startDispatch(args, context) {
  const phase = requiredString(args, 'phase');
  if (Object.prototype.hasOwnProperty.call(args, LEGACY_ROUTE_KEY)) {
    throw rpcError(-32602, `unknown_property: ${LEGACY_ROUTE_KEY}`);
  }
  const timestamp = nowIso();

  if (context.dispatch.active) {
    return {
      gate: 'G7',
      action: 'start',
      phase,
      status: 'blocked',
      timestamp,
      error: `Dispatch paralelo bloqueado: fase ativa ${context.dispatch.active.phase}`,
      current_phase: context.dispatch.active.phase,
      expected_phase: context.dispatch.active.phase,
      next_action: 'aguardar_fase_ativa',
    };
  }

  if (phase === 'slice_review' && !context.dispatch.execution_completed) {
    return {
      gate: 'G8',
      action: 'start',
      phase,
      status: 'blocked',
      timestamp,
      error: 'Review bloqueado: execução ainda não concluída com validator',
      current_phase: context.dispatch.previous_phase ?? null,
      expected_phase: 'plan_execute',
      next_action: 'dispatch_plan_execute_blocking',
    };
  }

  const expected = expectedNextPhase(context.routing, context.dispatch);
  if (phase !== expected && phase !== 'slice_review') {
    return {
      gate: 'G7',
      action: 'start',
      phase,
      status: 'blocked',
      timestamp,
      error: `Fase fora de ordem: esperado ${expected}, recebido ${phase}`,
      current_phase: context.dispatch.previous_phase ?? null,
      expected_phase: expected,
      next_action: `dispatch_${expected}`,
    };
  }

  return {
    gate: 'G7',
    action: 'start',
    phase,
    status: 'passed',
    timestamp,
    current_phase: phase,
    expected_phase: expected,
    dispatch: {
      active: { phase, started_at: timestamp },
      previous_phase: context.dispatch.previous_phase ?? null,
      next_phase: null,
      next_action: `complete_${phase}`,
    },
    next_action: `complete_${phase}`,
  };
}

function completeDispatch(args, context) {
  const phase = requiredString(args, 'phase');
  const timestamp = nowIso();
  const active = context.dispatch.active;

  if (!active || active.phase !== phase) {
    return {
      gate: 'G7',
      action: 'complete',
      phase,
      status: 'blocked',
      timestamp,
      error: `Conclusão fora de ordem: fase ativa ${active?.phase ?? 'nenhuma'}, recebido ${phase}`,
      current_phase: active?.phase ?? null,
      expected_phase: active?.phase ?? expectedNextPhase(context.routing, context.dispatch),
      next_action: active ? `complete_${active.phase}` : `dispatch_${expectedNextPhase(context.routing, context.dispatch)}`,
    };
  }

  if (phase === 'plan_handoff' && context.routing.mode === 'full') {
    return {
      gate: 'G11',
      action: 'complete',
      phase,
      status: 'passed',
      timestamp,
      dispatch: {
        active: null,
        previous_phase: phase,
        plan_validated: true,
        next_phase: 'plan_execute',
        next_action: 'dispatch_plan_execute_blocking',
      },
      next_action: 'dispatch_plan_execute_blocking',
    };
  }

  if (phase === 'plan_execute') {
    const validatorStatus = requiredString(args, 'validator_status');
    if (validatorStatus !== 'passed') {
      return {
        gate: 'G8',
        action: 'complete',
        phase,
        status: 'blocked',
        timestamp,
        error: `Execução não pode concluir sem validator passed; recebido ${validatorStatus}`,
        current_phase: phase,
        expected_phase: 'task_validator',
        next_action: 'rodar_task_validator_antes_do_review',
      };
    }
    return {
      gate: 'G8',
      action: 'complete',
      phase,
      status: 'passed',
      timestamp,
      validator_status: validatorStatus,
      dispatch: {
        active: null,
        previous_phase: phase,
        execution_completed: true,
        validator_status: validatorStatus,
        next_phase: 'slice_review',
        next_action: 'review_optional_or_complete',
      },
      next_action: 'review_optional_or_complete',
    };
  }

  if (phase === 'slice_review') {
    return {
      gate: 'G8',
      action: 'complete',
      phase,
      status: 'passed',
      timestamp,
      dispatch: {
        active: null,
        previous_phase: phase,
        review_completed: true,
        next_phase: null,
        next_action: 'complete_allowed',
      },
      next_action: 'complete_allowed',
    };
  }

  return {
    gate: 'G7',
    action: 'complete',
    phase,
    status: 'passed',
    timestamp,
    dispatch: {
      active: null,
      previous_phase: phase,
      next_phase: expectedNextPhase(context.routing, context.dispatch),
      next_action: `dispatch_${expectedNextPhase(context.routing, context.dispatch)}`,
    },
    next_action: `dispatch_${expectedNextPhase(context.routing, context.dispatch)}`,
  };
}

function abortDispatch(args, context) {
  const phase = requiredString(args, 'phase');
  const timestamp = nowIso();
  const active = context.dispatch.active;
  const result = {
    gate: 'G7',
    action: 'abort',
    phase,
    status: active?.phase === phase ? 'passed' : 'blocked',
    timestamp,
    error: active?.phase === phase ? null : `Abort fora de ordem: fase ativa ${active?.phase ?? 'nenhuma'}, recebido ${phase}`,
    current_phase: active?.phase ?? null,
    expected_phase: active?.phase ?? null,
    dispatch: active?.phase === phase ? {
      active: null,
      previous_phase: phase,
      next_phase: phase,
      next_action: `retry_${phase}`,
    } : {},
    next_action: active?.phase === phase ? `retry_${phase}` : `complete_${active?.phase ?? expectedNextPhase(context.routing, context.dispatch)}`,
  };
  return result;
}

function lockDispatch(args = {}) {
  const runId = validateRunId(args.run_id);
  if (Object.prototype.hasOwnProperty.call(args, LEGACY_ROUTE_KEY)) {
    throw rpcError(-32602, `unknown_property: ${LEGACY_ROUTE_KEY}`);
  }
  const action = args.action ?? 'start';
  if (!['start', 'complete', 'abort'].includes(action)) {
    throw rpcError(-32602, `Ação inválida para atlas_lock_dispatch: ${action}`);
  }

  const context = getDispatchState(runId, args);
  const result =
    action === 'start' ? startDispatch(args, context) :
    action === 'complete' ? completeDispatch(args, context) :
    abortDispatch(args, context);

  patchDispatchResult(runId, result, args);
  return result;
}

function assertAfterPlan(args = {}) {
  const runId = validateRunId(args.run_id);
  const attemptedAction = requiredString(args, 'attempted_action');
  const { routing, dispatch } = getDispatchState(runId, args);
  const timestamp = nowIso();
  let result;

  if (routing.mode === 'full' && dispatch.plan_validated && !dispatch.execution_completed) {
    if (attemptedAction === 'dispatch_plan_execute') {
      result = {
        gate: 'G11',
        action: 'assert_after_plan',
        phase: 'after_plan',
        status: 'passed',
        timestamp,
        current_phase: dispatch.previous_phase ?? null,
        expected_phase: 'plan_execute',
        next_action: 'dispatch_plan_execute_blocking',
      };
    } else {
      result = {
        gate: 'G11',
        action: 'assert_after_plan',
        phase: 'after_plan',
        status: 'blocked',
        timestamp,
        error: `Conclusão prematura bloqueada no full: ${attemptedAction}`,
        current_phase: dispatch.previous_phase ?? null,
        expected_phase: 'plan_execute',
        next_action: 'dispatch_plan_execute_blocking',
      };
    }
  } else {
    result = {
      gate: 'G11',
      action: 'assert_after_plan',
      phase: 'after_plan',
      status: 'passed',
      timestamp,
      current_phase: dispatch.previous_phase ?? null,
      expected_phase: dispatch.next_phase ?? null,
      next_action: dispatch.next_action ?? 'avançar',
    };
  }

  patchDispatchResult(runId, result, args);
  return result;
}

function toolResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolsList() {
  return {
    tools: [
      {
        name: 'atlas_ping',
        description: 'Retorna saúde, identidade, versão e capacidades mínimas do MCP Atlas Workflow.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
      },
      {
        name: 'atlas_capabilities',
        description: 'Adapter de host: detecta o host (Claude/Codex/genérico) e retorna descritores canônicos de disparo de subagente, todo nativo e paths de plano. Skills consultam isto em vez de hardcodar nome de host.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            host: { type: 'string', enum: ['claude', 'codex', 'generic'] },
          },
        },
      },
      {
        name: 'atlas_run_state',
        description: 'Cria, atualiza ou consulta estado de run em .atlas/state/ no cwd do projeto consumidor.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id'],
          properties: {
            action: { type: 'string', enum: ['get', 'upsert'], default: 'get' },
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            phase: { type: 'string' },
            status: { type: 'string' },
            summary: { type: 'string' },
            data: { type: 'object' },
          },
        },
      },
      {
        name: 'atlas_verify_artifact',
        description: 'Gate G1: verifica se artefato obrigatório existe em disco e é legível.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'artifact_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            artifact_path: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'atlas_scan_prd',
        description: 'Gate G5: escaneia PRD por padrões determinísticos de ambiguidade bloqueante.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'prd_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            prd_path: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'atlas_verify_template_conformance',
        description: 'Gate de conformidade: valida PRD ou plano contra o template canônico aplicável e registra pendências acionáveis.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'artifact_path', 'artifact_type'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            artifact_path: { type: 'string', minLength: 1 },
            artifact_type: { type: 'string', enum: ['prd', 'plan'] },
            required_status: { type: 'string' },
          },
        },
      },
      {
        name: 'atlas_preflight',
        description: 'Gate G10: valida modo, versão e lock ativo, travando a rota da run.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'mode'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            mode: { type: 'string', enum: ['full', 'direct', 'interview-only', 'interview_only'] },
            expected_version: { type: 'string' },
          },
        },
      },
      {
        name: 'atlas_lock_dispatch',
        description: 'Gates G7/G8: controla fase ativa, transições de dispatch, validator antes de review e concorrência 1.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'phase'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            action: { type: 'string', enum: ['start', 'complete', 'abort'], default: 'start' },
            phase: { type: 'string', enum: ['plan_handoff', 'plan_execute', 'slice_review'] },
            validator_status: { type: 'string' },
          },
        },
      },
      {
        name: 'atlas_assert_after_plan',
        description: 'Gate G11: bloqueia encerramento prematuro do modo full após plano validado e antes da execução.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'attempted_action'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            attempted_action: { type: 'string' },
          },
        },
      },
    ],
  };
}

function handleRequest(message) {
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    return {
      id,
      result: {
        protocolVersion: params.protocolVersion ?? '2024-11-05',
        serverInfo: { name: SERVER_NAME, version: readVersion() },
        capabilities: { tools: {} },
      },
    };
  }
  if (method === 'tools/list') return { id, result: toolsList() };
  if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments ?? {};
    try {
      const value =
        name === 'atlas_ping' ? ping() :
        name === 'atlas_capabilities' ? capabilities(args) :
        name === 'atlas_run_state' ? runState(args) :
        name === 'atlas_verify_artifact' ? verifyArtifact(args) :
        name === 'atlas_scan_prd' ? scanPrd(args) :
        name === 'atlas_verify_template_conformance' ? verifyTemplateConformance(args) :
        name === 'atlas_preflight' ? preflight(args) :
        name === 'atlas_lock_dispatch' ? lockDispatch(args) :
        name === 'atlas_assert_after_plan' ? assertAfterPlan(args) :
        (() => { throw rpcError(-32601, `Tool desconhecida: ${name}`); })();
      logCall({ tool: name, run: args.run_id ?? null, status: 'ok' }, args);
      return { id, result: toolResult(value) };
    } catch (error) {
      logCall({ tool: name, run: args.run_id ?? null, status: 'error', error: error.message }, args);
      throw error;
    }
  }
  if (method === 'notifications/initialized') return null;
  throw rpcError(-32601, `Método desconhecido: ${method}`);
}

function send(message) {
  if (message === null || message.id === undefined) return;
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(`${body}\n`);
}

function parseMessages(buffer) {
  const messages = [];
  let rest = buffer;

  while (true) {
    const crlfHeaderEnd = rest.indexOf('\r\n\r\n');
    const lfHeaderEnd = rest.indexOf('\n\n');
    const hasCrlfHeader = crlfHeaderEnd !== -1 && (lfHeaderEnd === -1 || crlfHeaderEnd <= lfHeaderEnd);
    const headerEnd = hasCrlfHeader ? crlfHeaderEnd : lfHeaderEnd;
    if (headerEnd === -1) break;
    const header = rest.slice(0, headerEnd);
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) break;
    const length = Number(match[1]);
    const bodyStart = headerEnd + (hasCrlfHeader ? 4 : 2);
    const bodyEnd = bodyStart + length;
    if (rest.length < bodyEnd) return { messages, rest };
    messages.push(JSON.parse(rest.slice(bodyStart, bodyEnd)));
    rest = rest.slice(bodyEnd);
  }

  if (messages.length === 0 && /^Content-Length:/i.test(rest) && !/\r?\n\r?\n/.test(rest)) {
    return { messages, rest };
  }

  if (messages.length === 0 && rest.includes('\n')) {
    const lines = rest.split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  }

  return { messages, rest };
}

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  try {
    const parsed = parseMessages(pending + chunk);
    pending = parsed.rest;
    for (const message of parsed.messages) {
      try {
        send(handleRequest(message));
      } catch (error) {
        send({
          id: message.id,
          error: {
            code: error.code ?? -32000,
            message: error.message,
            data: error.data,
          },
        });
      }
    }
  } catch (error) {
    send({ id: null, error: { code: -32700, message: `JSON inválido: ${error.message}` } });
  }
});
