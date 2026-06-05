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
  path: 'builtin:atlas-workflow',
  skills: {
    prd_generator: 'atlas-sprint-prd-generator',
    prd_interview: 'atlas-prd-interview',
    plan_handoff: 'atlas-plan-handoff',
    plan_execute: 'atlas-plan-execute',
    slice_review: 'atlas-slice-review',
    task_validator: 'atlas-task-validator',
  },
  modes: ['full', 'direct', 'execute', 'interview-only', 'interview_only'],
};

// Nível de garantia declarado no routing/output (PRD D12). Enum fechado:
// pipelines completas (full/direct/execute) declaram full_pipeline; uso avulso
// documental/leitura declara reduced_standalone (fora do escopo desta camada).
// Data-driven: rota → nível, sem ramo solto. Modos sem execução de código
// (interview-only) NÃO declaram guarantee_level (não há execução a garantir):
// guaranteeLevelForMode devolve null e o campo é OMITIDO do output (PRD D2/D12).
const GUARANTEE_LEVELS = ['full_pipeline', 'reduced_standalone'];
const MODE_GUARANTEE_LEVEL = {
  full: 'full_pipeline',
  direct: 'full_pipeline',
  execute: 'full_pipeline',
};
function guaranteeLevelForMode(mode) {
  return MODE_GUARANTEE_LEVEL[mode] ?? null;
}

// Banco canônico de templates de banner de fase (PRD §9 / D7–D9, PLAN §6.2).
// Fonte única na camada determinística: o orquestrador apenas ECOA a string
// pronta — nunca monta texto livre. Data-driven como HOST_ADAPTERS: tabela única
// `event → template`, sem string de banner inline espalhada pelos gates.
// Símbolo fixo `▸`, idioma pt-BR, exatamente uma linha por evento. Os 11 eventos
// fechados do PRD §9. Slots no formato {nome} são preenchidos por renderBanner.
const BANNER_TEMPLATES = {
  roteia: '▸ atlas: roteamento · input={tipo} → modo={modo}',
  roteia_troca: '▸ atlas: roteamento · pediu={x} mas input={y} → modo={z}',
  preflight_ok: '▸ atlas: preflight · ok ({caps})',
  preflight_fail: '▸ atlas: preflight · BLOCK · {motivo}',
  prd_lacunas: '▸ atlas: prd · {n} lacunas',
  prd_ok: '▸ atlas: prd · ok',
  entrevista: '▸ atlas: entrevista · {n} perguntas',
  plano: '▸ atlas: plano · validado (TC pass)',
  exec: '▸ atlas: exec · slice {i}/{n}',
  validacao: '▸ atlas: validação · {status}',
  review: '▸ atlas: review · {status}',
  done: '▸ atlas: done · {resumo}',
};
const BANNER_EVENTS = Object.keys(BANNER_TEMPLATES);

// Modo-alvo do roteamento por tipo de input (PRD D3/D6): o tipo de fato manda
// sobre o modo pedido. plan → execute (executa plano pronto); prd/backlog → full
// (gera/usa plano). Data-driven: alimenta o slot {modo} do banner `roteia`.
const ROUTED_MODE_BY_TYPE = {
  plan: 'execute',
  prd: 'full',
  backlog: 'full',
};

// Preenche os slots {nome} do template do evento com `slots` e devolve a string
// pt-BR pronta. Evento desconhecido é erro de programação (lança). Slot ausente
// não é silenciado: deixa o marcador visível para o defeito não passar batido.
function renderBanner(event, slots = {}) {
  const template = BANNER_TEMPLATES[event];
  if (template === undefined) {
    throw rpcError(-32603, `Evento de banner desconhecido: ${event}`);
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(slots, key) ? String(slots[key]) : match
  ));
}
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
  opencode: {
    label: 'opencode',
    subagent_dispatch: {
      mechanism: '@<name> (ou auto por description)',
      example: 'invocar @atlas-task-validator passando <state_path>',
      registration: '.opencode/agents/<name>.md (frontmatter description + mode: subagent)',
    },
    // opencode expõe `todowrite` nativo ao agente primário (orquestrador). O `todoread`
    // foi fundido em `todowrite` (mar/2026): a tool retorna a lista atual no output.
    // Subagentes têm `todowrite` desabilitado por padrão, mas o todo é usado pelo
    // orquestrador (primário), não pelos validadores — então a flag descreve o nível certo.
    todo_tool: 'todowrite',
    hooks: { supported: true, mechanism: '.opencode/plugins/' },
    // Nativo compatível: subagente (.opencode/agents) + MCP local (opencode.json) + todo (todowrite).
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
  },
  pi: {
    label: 'pi cli',
    subagent_dispatch: {
      // pi-subagents dispara pela tool `subagent({agent, task})` — NÃO por @name nem via MCP.
      // As tools MCP do Atlas chegam proxiadas/prefixadas pelo pi-mcp-adapter (atlas_workflow_<tool>).
      mechanism: 'subagent({ agent, task }) — tool do pi-subagents',
      example: 'subagent({ agent: "atlas-task-validator", task: "<state_path>", context: "fresh" })',
      registration: '.pi/agents/<name>.md (pi-subagents; frontmatter name + description + tools)',
    },
    todo_tool: null,
    hooks: { supported: false, mechanism: null },
    // pi exige 2 deps externas obrigatórias (DEC-005): pi-mcp-adapter (MCP) e
    // pi-subagents (subagente). O perfil declara a expectativa; a disponibilidade
    // real é reportada em host_capabilities no preflight — ausente => hard-fail.
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: false },
    required_deps: ['pi-mcp-adapter', 'pi-subagents'],
    // must_report: essenciais dependem de deps externas não-sondáveis pelo servidor.
    // Fail-closed — só passam se o caller reportar disponibilidade real (não otimismo do perfil).
    prereq_policy: 'must_report',
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
    // must_report: host desconhecido — o servidor não pode presumir subagente+MCP.
    // Fail-closed — exige report afirmativo de disponibilidade.
    prereq_policy: 'must_report',
  },
};

// Pré-requisitos de determinismo (DEC-004): essenciais → hard-fail no preflight;
// não-essenciais → seguem sem o recurso, registrando. Contrato consumido por S09.
const PREREQUISITES = {
  essential: ['subagent_available', 'mcp_available'],
  non_essential: ['todo_available'],
};
const PREREQUISITE_FLAGS = [...PREREQUISITES.essential, ...PREREQUISITES.non_essential];

// Versão do contrato atlas_capabilities. Política: incremento aditivo (campos novos
// opcionais) mantém compat — consumidores DEVEM ignorar campos desconhecidos.
// Remoção/renomeação de campo ou mudança de semântica exige bump e nota de migração.
// v1 → v2: adiciona capabilities_flags, hooks, prerequisites, known_hosts,
//   required_deps, prereq_policy (aditivo).
const CAPABILITIES_SCHEMA_VERSION = 2;

// Nomes de host derivados do registry — única fonte de verdade para enums de schema.
// Adicionar host em HOST_ADAPTERS propaga automaticamente (sem enum hardcoded).
const HOST_NAMES = Object.keys(HOST_ADAPTERS);

// Registry de detecção de host, data-driven e ordenado por precedência (DEC-003).
// Adicionar host = adicionar um detector aqui (env próprio/arquivo); sem ramo solto.
// `arg host` e `ATLAS_HOST` (override explícito) têm prioridade sobre sinais de env.
// Cada detector retorna o nome do host se casar, ou null. Só hosts presentes em
// HOST_ADAPTERS são aceitos (perfil desconhecido cai em generic).
const HOST_DETECTORS = [
  { via: 'env:CLAUDE_PLUGIN_ROOT', detect: (env) => (env.CLAUDE_PLUGIN_ROOT ? 'claude' : null) },
  { via: 'env:CODEX', detect: (env) => (env.CODEX_HOME || env.CODEX_PLUGIN_ROOT ? 'codex' : null) },
  // opencode/pi não expõem env distintivo garantido no subprocesso MCP (S01).
  // Detecção determinística: o packaging injeta ATLAS_HOST no env do MCP —
  //   opencode: opencode.json → mcp.<name>.environment.ATLAS_HOST = "opencode"
  //   pi: mcp.json (pi-mcp-adapter) → env.ATLAS_HOST = "pi"
  // Tratado pela branch ATLAS_HOST acima; sem file-detection frágil.
];

function detectHost(args = {}, env = process.env) {
  if (args.host && HOST_ADAPTERS[args.host]) return { host: args.host, detected_via: 'arg' };
  const override = env.ATLAS_HOST;
  if (override && HOST_ADAPTERS[override]) return { host: override, detected_via: 'env:ATLAS_HOST' };
  for (const detector of HOST_DETECTORS) {
    const host = detector.detect(env);
    if (host && HOST_ADAPTERS[host]) return { host, detected_via: detector.via };
  }
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
    required_deps: adapter.required_deps ?? [],
    prerequisites: PREREQUISITES,
    // 'must_report' avisa o orquestrador que DEVE apurar e reportar host_capabilities
    // (subagente/MCP reais) no preflight — sem isso, o gate PREREQ falha-fechado.
    prereq_policy: adapter.prereq_policy ?? 'self_evident',
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

// Hard-fail de pré-requisitos de determinismo (DEC-004). Mescla as flags do perfil
// do host com a disponibilidade real reportada pelo caller (`host_capabilities`).
//
// Política por host (`prereq_policy`):
//   - 'self_evident' (claude/codex/opencode, default): runtime nativo. Flag essencial
//     vem do report quando presente, senão do perfil (otimista justificado: MCP-vivo
//     prova-se no boot; subagente é nativo do plugin instalado).
//   - 'must_report' (pi/generic): essencial depende de dep externa (pi) ou de host
//     desconhecido (generic) — NÃO sondável pelo servidor. Fail-closed: a flag só
//     conta como true se reportada explicitamente true; ausente/não-bool ⇒ false ⇒
//     blocked. Converte a garantia de prosa do orquestrador em contrato.
//
// O merge é delimitado a PREREQUISITE_FLAGS (chave desconhecida no override é ignorada;
// o additionalProperties:false do schema é enforçado na camada do client MCP, este
// loop é a defesa server-side). Capability não-essencial (todo) nunca bloqueia.
function checkPrerequisites(args = {}) {
  const { host } = detectHost(args);
  const adapter = HOST_ADAPTERS[host];
  const mustReport = adapter.prereq_policy === 'must_report';
  const reported = args.host_capabilities && typeof args.host_capabilities === 'object'
    ? args.host_capabilities
    : {};
  const flags = {};
  for (const key of PREREQUISITE_FLAGS) {
    const reportedVal = typeof reported[key] === 'boolean' ? reported[key] : undefined;
    if (mustReport && PREREQUISITES.essential.includes(key)) {
      flags[key] = reportedVal === true;
    } else {
      flags[key] = reportedVal !== undefined ? reportedVal : adapter.capabilities_flags[key];
    }
  }
  const missing = PREREQUISITES.essential.filter((key) => flags[key] !== true);
  if (missing.length === 0) {
    return { status: 'passed', host, effective_flags: flags, missing: [] };
  }
  const unreported = mustReport && PREREQUISITES.essential.every(
    (key) => typeof reported[key] !== 'boolean',
  );
  return {
    status: 'blocked',
    host,
    effective_flags: flags,
    missing,
    error: `Pré-requisito de determinismo ausente no host '${host}': ${missing.join(', ')}`,
    cause: unreported ? 'host_nao_reportou_disponibilidade' : 'host_sem_prerequisito_essencial',
    impact: 'sem_isolamento_de_contexto_o_validator_perde_determinismo_em_tarefa_grande',
    next_action: host === 'pi'
      ? 'instalar_pi-mcp-adapter_e_pi-subagents_e_reportar_host_capabilities'
      : 'usar_host_com_subagente_e_mcp_nativos_ou_reportar_host_capabilities',
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
        banner: renderBanner('preflight_fail', { motivo: `artefato inválido: ${artifactPath}` }),
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
        banner: renderBanner('plano', {}),
        next_action: 'avançar',
      };
    }
  } catch (error) {
    result = {
      gate: 'G1',
      status: 'blocked',
      artifact_path: artifactPath,
      timestamp,
      banner: renderBanner('preflight_fail', { motivo: `artefato ausente: ${artifactPath}` }),
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
        banner: renderBanner('prd_lacunas', { n: 1 }),
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
        banner: blockingMatches.length === 0
          ? renderBanner('prd_ok', {})
          : renderBanner('prd_lacunas', { n: blockingMatches.length }),
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
      banner: renderBanner('prd_lacunas', { n: 1 }),
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
        banner: renderBanner('preflight_fail', { motivo: `TC ${artifactType}: arquivo vazio` }),
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
        banner: pendencies.length === 0
          ? renderBanner('plano', {})
          : renderBanner('preflight_fail', { motivo: `TC ${artifactType}: ${pendencies.length} pendências` }),
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
      banner: renderBanner('preflight_fail', { motivo: `TC ${artifactType}: artefato ilegível` }),
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

// Detecta tipo de input para roteamento (PRD D4/D5). Hierarquia de confiança:
//   (1) verdade forte: conformidade de template de plano passa → 'plan';
//   (2) dica: cabeçalho/frontmatter canônico de plano → 'plan';
//   (3) dica fraca: nome casando PLAN_*.md → 'plan';
//   PRD/backlog por marcadores de template; senão 'unknown'.
// Nome de arquivo nunca basta sozinho nem engana (PRD §10): só conta como dica
// fraca e cede para a verdade forte. Reusa verifyPlanConformance para (1).
function classifyArtifactContent(content, fileName = '') {
  const text = content ?? '';

  // (1) Verdade forte: plano conforme o template canônico (zero pendências).
  if (text.trim() !== '' && verifyPlanConformance(text).length === 0) {
    return { artifact_type: 'plan', signal: 'template_conformance' };
  }

  // (2) Dica de cabeçalho/frontmatter canônico de plano.
  const planHeaderHint = /\|\s*\*\*PRD\*\*\s*\|/.test(text)
    || /^#\s+PLAN[\s_]/im.test(text)
    || /\bexecution_mode\b/.test(text);
  if (planHeaderHint && /####\s+T\d+\./.test(text)) {
    return { artifact_type: 'plan', signal: 'header_hint' };
  }

  // PRD: marcadores do template canônico de PRD.
  const prdHint = /^#\s+PRD[:\s]/im.test(text)
    || /\|\s*D\d+\s*\|/.test(text)
    || /Decisões de produto/i.test(text);
  if (prdHint) {
    return { artifact_type: 'prd', signal: 'prd_markers' };
  }

  // Backlog: marcadores do template canônico de backlog/roadmap.
  const backlogHint = /\bBACKLOG[\s_]/i.test(text)
    || /\bSprint\s+S\d+/i.test(text)
    || /\bRoadmap\b/i.test(text);
  if (backlogHint) {
    return { artifact_type: 'backlog', signal: 'backlog_markers' };
  }

  // (3) Dica fraca: nome PLAN_*.md, só se nada mais classificou.
  if (/(^|\/)PLAN_[^/]*\.md$/i.test(fileName)) {
    return { artifact_type: 'plan', signal: 'weak_name_hint' };
  }

  return { artifact_type: 'unknown', signal: 'no_match' };
}

function classifyInput(args = {}) {
  const runId = validateRunId(args.run_id);
  const inputPath = requiredString(args, 'input_path');
  const absolutePath = resolveConsumerPath(inputPath, args);
  const timestamp = nowIso();
  let result;

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const { artifact_type, signal } = classifyArtifactContent(content, inputPath);
    // Modo-alvo por tipo de input (PRD D3/D6): o fato manda. plan → execute;
    // prd/backlog → full (gera/usa plano). Data-driven; sem ramo solto.
    const routedMode = ROUTED_MODE_BY_TYPE[artifact_type] ?? null;
    result = {
      gate: 'classify_input',
      status: artifact_type === 'unknown' ? 'unknown' : 'classified',
      input_path: inputPath,
      artifact_type,
      routed_mode: routedMode,
      detection_signal: signal,
      timestamp,
      // Banner canônico do banco (T06/T07): roteamento por tipo de input.
      banner: artifact_type === 'unknown'
        ? renderBanner('preflight_fail', { motivo: `input não classificado: ${inputPath}` })
        : renderBanner('roteia', { tipo: artifact_type, modo: routedMode }),
      next_action: artifact_type === 'unknown' ? 'pedir_esclarecimento' : 'rotear_por_tipo',
    };
  } catch (error) {
    result = {
      gate: 'classify_input',
      status: 'blocked',
      input_path: inputPath,
      artifact_type: 'unknown',
      timestamp,
      banner: renderBanner('preflight_fail', { motivo: `input ilegível: ${inputPath}` }),
      error: `Input ausente ou ilegível: ${inputPath}`,
      cause: error.message,
      next_action: 'corrigir_input',
    };
  }

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

  const prereq = checkPrerequisites(args);
  if (prereq.status === 'blocked') {
    result = {
      gate: 'PREREQ',
      status: 'blocked',
      timestamp,
      mode,
      host: prereq.host,
      missing_prerequisites: prereq.missing,
      effective_flags: prereq.effective_flags,
      error: prereq.error,
      cause: prereq.cause,
      impact: prereq.impact,
      next_action: prereq.next_action,
    };
  } else if (version.status === 'blocked') {
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
    const guaranteeLevel = guaranteeLevelForMode(mode);
    // Campo OMITIDO quando o modo não declara garantia (interview-only → null).
    result = {
      gate: 'G10',
      status: 'passed',
      timestamp,
      mode,
      ...(guaranteeLevel ? { guarantee_level: guaranteeLevel } : {}),
      routing: {
        mode,
        ...(guaranteeLevel ? { guarantee_level: guaranteeLevel } : {}),
        skills: config.skills,
        version: version.version,
        locked_at: currentRouting?.locked_at ?? timestamp,
        config_path: config.path,
        supported_modes: config.modes,
      },
      next_action: 'avançar',
    };
  }

  // Banner canônico do preflight (T07): passed → preflight_ok com caps efetivas;
  // qualquer block → preflight_fail com motivo derivado do gate/erro. Derivado do
  // status final (não espalha string por branch) — fonte única no banco BANNER_TEMPLATES.
  if (result.status === 'passed') {
    result.banner = renderBanner('preflight_ok', { caps: 'subagent+mcp' });
  } else {
    const motivo = result.error
      ? String(result.error).slice(0, 80)
      : `${result.gate} bloqueado`;
    result.banner = renderBanner('preflight_fail', { motivo });
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
  if (routing.mode === 'execute') return 'plan_execute';
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

  result.banner = dispatchBanner(result);
  patchDispatchResult(runId, result, args);
  return result;
}

// Banner canônico do lock_dispatch (T07): mapeia (fase, status) ao evento do
// banco. Fase de execução → `exec`/`validação`; review → `review`; conclusão de
// plano → `plano`; bloqueio → `preflight_fail` (BLOCK genérico com motivo).
// Tabela data-driven; nenhuma string de banner montada inline no gate.
function dispatchBanner(result) {
  if (result.status === 'blocked') {
    const motivo = result.error ? String(result.error).slice(0, 80) : `${result.phase} bloqueado`;
    return renderBanner('preflight_fail', { motivo });
  }
  if (result.phase === 'slice_review') {
    return renderBanner('review', { status: result.action === 'complete' ? 'ok' : 'iniciado' });
  }
  if (result.phase === 'plan_execute') {
    // complete carrega validator_status → evento de validação; start → exec da slice.
    return result.action === 'complete'
      ? renderBanner('validacao', { status: result.validator_status ?? 'ok' })
      : renderBanner('exec', { i: 1, n: 1 });
  }
  if (result.phase === 'plan_handoff') {
    return renderBanner('plano', {});
  }
  // demais fases (prd_interview etc.): exec genérico da fase em andamento.
  return renderBanner('exec', { i: 1, n: 1 });
}

function assertAfterPlan(args = {}) {
  const runId = validateRunId(args.run_id);
  const attemptedAction = requiredString(args, 'attempted_action');
  const { routing, dispatch } = getDispatchState(runId, args);
  const timestamp = nowIso();
  let result;

  if (routing.mode === 'execute') {
    // PRD D13: o gate de bloqueio pós-plano é próprio do full e NÃO se aplica a
    // execute — o plano já é o input inicial. Aqui não se exige fase de plano;
    // o equivalente é a re-verificação do plano antes de despachar a execução.
    result = {
      gate: 'G11',
      action: 'assert_after_plan',
      phase: 'after_plan',
      status: 'passed',
      mode: 'execute',
      applicable: false,
      timestamp,
      current_phase: dispatch.previous_phase ?? null,
      expected_phase: 'plan_execute',
      note: 'assert_after_plan não se aplica em execute (PRD D13): plano é o input; re-verifique o plano antes do dispatch.',
      next_action: 'reverificar_plano_e_dispatch_plan_execute',
    };
  } else if (routing.mode === 'full' && dispatch.plan_validated && !dispatch.execution_completed) {
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

  // Banner canônico do assert_after_plan (T07): pós-plano coerente com o evento
  // `plano` (plano validado / re-verificação) quando passa; BLOCK com motivo quando
  // bloqueia. Fonte única no banco BANNER_TEMPLATES.
  result.banner = result.status === 'blocked'
    ? renderBanner('preflight_fail', { motivo: result.error ? String(result.error).slice(0, 80) : 'pós-plano bloqueado' })
    : renderBanner('plano', {});

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
            host: { type: 'string', enum: HOST_NAMES },
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
        name: 'atlas_classify_input',
        description: 'Classifica o input em backlog|prd|plan|unknown (PRD D4/D5). Verdade forte = conformidade de template de plano passa; depois cabeçalho canônico; nome PLAN_*.md é só dica fraca. Devolve artifact_type + banner de roteamento. Alimenta o guardrail anti plano-de-plano.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'input_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            input_path: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'atlas_preflight',
        description: 'Gate PREREQ+G10: hard-fail de pré-requisitos de determinismo (subagente/MCP do host, DEC-004), depois valida modo, versão e lock ativo, travando a rota da run. Output declara guarantee_level (enum full_pipeline|reduced_standalone).',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'mode'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            mode: { type: 'string', enum: WORKFLOW_CONFIG.modes },
            expected_version: { type: 'string' },
            host: { type: 'string', enum: HOST_NAMES },
            // additionalProperties:false é enforçado pelo client MCP; o servidor ainda
            // delimita defensivamente o override a PREREQUISITE_FLAGS em checkPrerequisites.
            host_capabilities: {
              type: 'object',
              description: 'Disponibilidade real reportada pelo host (override das flags do perfil). Ex.: pi sem deps → {"subagent_available":false}.',
              additionalProperties: false,
              properties: {
                subagent_available: { type: 'boolean' },
                mcp_available: { type: 'boolean' },
                todo_available: { type: 'boolean' },
              },
            },
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
        name === 'atlas_classify_input' ? classifyInput(args) :
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

function startStdioLoop() {
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
}

// Só inicia o loop stdio quando executado como entrypoint (node server.js).
// Importado por testes (node --test), o módulo expõe funções puras sem bootar I/O.
const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) startStdioLoop();

export {
  HOST_ADAPTERS,
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
};
