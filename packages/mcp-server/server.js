#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseSprintRows,
  parseDecisionRows,
  validateSprintFileConformance,
  validateAcceptanceSeal,
  parseAcceptanceContract,
} from '../skills/_shared/scripts/document_quality.mjs';

const SERVER_NAME = 'talos';
const RUN_DIR = path.join('.talos', 'state');
const SENSITIVE_KEY = /(authorization|credential|password|secret|token|api[_-]?key)/i;
// S04: chaves cujo nome casa com SENSITIVE_KEY (substring `token`) mas NÃO são
// segredo/PII — são contadores monotônicos do slot de validação que PRECISAM
// persistir e sobreviver a re-spun. Allowlist exata (não substring).
// APENAS `dispatch_token` (nome interno específico); a chave genérica `token`
// permanece sujeita a redação para não expor segredos de payloads de usuário.
const NON_SENSITIVE_KEYS = new Set(['dispatch_token']);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
// Gate G5: padrões de ambiguidade bloqueante no bloco de contrato (§7) do sprint file.
const ACCEPTANCE_PATTERNS = {
  section_7_decisions: ['vago', 'TBD', 'a confirmar', 'talvez', 'não definido', '[...]'],
  section_7_ux: ['a definir', 'gap', 'depende de', 'TBD', 'a confirmar', '[...]'],
  section_7_aceite: ['TBD', 'a confirmar', 'ainda não', 'incompleto', 'pode ser', '[...]'],
};
const SECTION_LABELS = {
  section_7_decisions: '§7.1 Decisões de produto',
  section_7_ux: '§7.2 Cenários UX',
  section_7_aceite: '§7.3 Aceite binário',
};
const SECTION_HEADING = {
  section_7_decisions: /^###\s+7\.1\s+/,
  section_7_ux: /^###\s+7\.2(?:\.\d+)?\s+/,
  section_7_aceite: /^###\s+7\.3\s+/,
};
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
  path: 'builtin:talos',
  skills: {
    backlog_generator: 'talos-backlog-generator',
    sprint_interview: 'talos-sprint-interview',
    plan_handoff: 'talos-plan-handoff',
    plan_execute: 'talos-plan-execute',
    direct_execute: 'talos-direct-execute',
    audit: 'talos-audit',
    findings_repair: 'talos-findings-repair',
    slice_review: 'talos-slice-review',
    task_validator: 'talos-task-validator',
  },
  modes: ['full', 'direct', 'execute', 'interview-only', 'interview_only', 'audit'],
};

const VALIDATOR_MAX_ATTEMPTS = 2;
// P2-1: teto de falhas de proof-of-work POR attempt. challenge_failed não consome
// attempt nem fecha o slot (re-despacha o mesmo validador), mas sem limite um
// mismatch sistemático (ex.: validador resolve o path do challenge com CWD
// diferente do consumer_root do MCP) loopa pra sempre. Após este teto de falhas
// para o mesmo validator_run_id, o slot fecha terminal (fail-closed): a slice
// bloqueia com causa explícita em vez de re-despachar indefinidamente.
const VALIDATOR_CHALLENGE_MAX_FAILURES = 2;
const VALIDATOR_PASSED_STATUSES = new Set(['passed', 'passed_with_observations']);
const EXECUTOR_BOOTSTRAP_TIMEOUT_MS = 120_000;
const EXECUTOR_PROGRESS_TIMEOUT_MS = 300_000;
// G12 (D4): checkpoint público do executor é SÓ `first_write`. Events antigos
// (executor_started, skill_loaded, plan_loaded, handoff_accepted, task_started,
// state_path_created) são bloqueados — dual-writer morre aqui (LEG1).
const EXECUTOR_CHECKPOINT_EVENTS = new Set([
  'first_write',
]);

function validatorRunId(runId, attempt, timestamp) {
  return `${runId}:validator:${attempt}:${timestamp}`;
}

function repairRunId(runId, attempt, timestamp) {
  return `${runId}:repair:${attempt}:${timestamp}`;
}

// Nível de garantia declarado no routing/output (PRD D12). Enum fechado:
// pipelines completas (full/direct/execute) declaram full_pipeline; uso avulso
// documental/leitura declara reduced_standalone (fora do escopo desta camada).
// Data-driven: rota → nível, sem ramo solto. Modos sem execução de código
// (interview-only/audit) NÃO declaram guarantee_level (não há execução a garantir):
// guaranteeLevelForMode devolve null e o campo é OMITIDO do output (PRD D2/D12).
const GUARANTEE_LEVELS = ['full_pipeline', 'reduced_standalone'];
const MODE_GUARANTEE_LEVEL = {
  full: 'full_pipeline',
  direct: 'full_pipeline',
  execute: 'full_pipeline',
};
const MODE_EXECUTOR_SKILL = {
  full: WORKFLOW_CONFIG.skills.plan_execute,
  direct: WORKFLOW_CONFIG.skills.direct_execute,
  execute: WORKFLOW_CONFIG.skills.plan_execute,
};
function guaranteeLevelForMode(mode) {
  return MODE_GUARANTEE_LEVEL[mode] ?? null;
}

function expectedExecutorSkill(mode) {
  return MODE_EXECUTOR_SKILL[mode] ?? null;
}

// Banco canônico de templates de banner de fase (PRD §4 Fluxos / D*, PLAN §6.2).
// Fonte única na camada determinística: o orquestrador apenas ECOA a string
// pronta — nunca monta texto livre. Data-driven como HOST_ADAPTERS: tabela única
// `event → template`, sem string de banner inline espalhada pelos gates.
// Símbolo fixo `▸`, idioma pt-BR, exatamente uma linha por evento. Os 11 eventos
// fechados do contrato §7. Slots no formato {nome} são preenchidos por renderBanner.
const BANNER_TEMPLATES = {
  roteia: '▸ talos: roteamento · input={tipo} → modo={modo}',
  roteia_troca: '▸ talos: roteamento · pediu={x} mas input={y} → modo={z}',
  preflight_ok: '▸ talos: preflight · ok ({caps})',
  preflight_fail: '▸ talos: preflight · BLOCK · {motivo}',
  aceite_lacunas: '▸ talos: aceite · {n} lacunas',
  aceite_ok: '▸ talos: aceite · ok',
  entrevista: '▸ talos: entrevista · {n} perguntas',
  plano: '▸ talos: plano · validado (TC pass)',
  exec: '▸ talos: exec · slice {i}/{n}',
  validacao: '▸ talos: validação · {status}',
  review: '▸ talos: review · {status}',
  done: '▸ talos: done · {resumo}',
};
const BANNER_EVENTS = Object.keys(BANNER_TEMPLATES);

// Modo-alvo do roteamento por tipo de input: o tipo de fato manda sobre o modo
// pedido. plan → execute (executa plano pronto); backlog → full (gera/usa plano).
// Spec/PRD-ish classifica como idea → direct (D9). Data-driven: alimenta o slot
// {modo} do banner `roteia`.
const ROUTED_MODE_BY_TYPE = {
  plan: 'execute',
  backlog: 'full',
  // idea = descrição livre ou spec (não é arquivo de plano). Roteia para `direct`.
  idea: 'direct',
};
const BACKLOG_PRIORITY_INPUT_TYPES = new Set(['idea', 'briefing', 'roadmap', 'conversation', 'spec-macro']);
const BACKLOG_STATES = new Set(['backlog', 'ready', 'doing', 'review', 'manual_validation_pending', 'done', 'blocked']);
const BACKLOG_MOSCOW = new Set(['Must', 'Should', 'Could', "Won't now"]);
const BACKLOG_LEVEL = new Set(['alto', 'médio', 'baixo']);
const BACKLOG_PRIORITY = new Set(['P0', 'P1', 'P2', 'P3']);
const SPRINT_DEP_RE = /S\d{2}(?:[a-z]|\.\d+)?/g;
const VALIDATOR_VERDICTS = new Set(['pass', 'pass_with_observations', 'fail', 'not_run']);
const TERMINAL_VALIDATOR_VERDICTS = new Set(['pass', 'pass_with_observations']);
const SPRINT_STATUS_TRANSITIONS = {
  backlog: new Set(['ready', 'blocked']),
  ready: new Set(['doing', 'review', 'done', 'blocked']),
  doing: new Set(['review', 'done', 'blocked']),
  review: new Set(['manual_validation_pending', 'done', 'doing', 'blocked']),
  manual_validation_pending: new Set(['done', 'blocked']),
  blocked: new Set(['ready', 'backlog']),
  done: new Set(['done']),
};
const MOSCOW_RANK = new Map([['Must', 0], ['Should', 1], ['Could', 2], ["Won't now", 3]]);
const GAIN_RANK = new Map([['alto', 0], ['médio', 1], ['baixo', 2]]);
const EFFORT_RANK = new Map([['baixo', 0], ['médio', 1], ['alto', 2]]);
const PRIORITY_RANK = new Map([['P0', 0], ['P1', 1], ['P2', 2], ['P3', 3]]);
// Plano 4 — relatório de validação manual (D11-D15/D24). Um relatório por backlog;
// IDs estáveis MV-<sprint>-<ac>; estados válidos do relatório (proposta §6).
const MANUAL_VALIDATION_DIR = '.talos/manual-validation';
const MANUAL_VALIDATION_REPORT_STATUSES = new Set(['pending', 'in_progress', 'validated', 'waived', 'failed']);
const MANUAL_VALIDATION_MV_ID_RE = /^MV-(S\d{2}(?:[a-z]|\.\d+)?)-(AC-\d+)$/;
// D14/D24: resultado humano mapeado para o acceptance_results do state (oráculo).
const MANUAL_VALIDATION_STATE_MAP = {
  validated: { to: 'proved', proof: 'M:validated' },
  waived: { to: 'proved', proof: 'M:waived' },
  failed: { to: 'violated', proof: 'M:failed' },
};

function documentFlowForRouting(mode, inputType = null, artifactType = null) {
  const normalizedInput = typeof inputType === 'string' ? inputType.trim().toLowerCase() : null;
  const normalizedArtifact = typeof artifactType === 'string' ? artifactType.trim().toLowerCase() : null;
  const macroInput = BACKLOG_PRIORITY_INPUT_TYPES.has(normalizedInput) || normalizedArtifact === 'idea';
  if ((mode === 'full' || mode === 'direct') && macroInput) {
    return {
      priority: 'backlog_first',
      reason: 'entrada_macro_sem_backlog_canonico',
      skills: [
        WORKFLOW_CONFIG.skills.backlog_generator,
        WORKFLOW_CONFIG.skills.sprint_interview,
        ...(mode === 'full' ? [WORKFLOW_CONFIG.skills.plan_handoff] : []),
      ],
      artifacts: [
        'BACKLOG_MESTRE_*.md',
        'SPRINT_S<NN>_*.md',
        ...(mode === 'full' ? ['PLAN_*.md'] : []),
      ],
    };
  }
  if (normalizedInput === 'backlog-item' || normalizedInput === 'sprint' || normalizedArtifact === 'backlog') {
    return {
      priority: 'sprint_from_backlog',
      reason: 'backlog_canonico_ja_fornecido',
      skills: [
        WORKFLOW_CONFIG.skills.sprint_interview,
        ...(mode === 'full' ? [WORKFLOW_CONFIG.skills.plan_handoff] : []),
      ],
      artifacts: [
        'SPRINT_S<NN>_*.md',
        ...(mode === 'full' ? ['PLAN_*.md'] : []),
      ],
    };
  }
  return {
    priority: 'recorte_first',
    reason: 'entrada_ja_recortada_ou_modo_sem_backlog',
    skills: [
      WORKFLOW_CONFIG.skills.sprint_interview,
      ...(mode === 'full' ? [WORKFLOW_CONFIG.skills.plan_handoff] : []),
    ],
    artifacts: [
      'SPRINT_S<NN>_*.md',
      ...(mode === 'full' ? ['PLAN_*.md'] : []),
    ],
  };
}

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
// Skills consultam talos_capabilities e usam o descritor retornado em vez de
// hardcodar nome de host. Adicionar host novo = adicionar entrada aqui.
// Contrato HostAdapter (DEC-007): entrada runtime data-driven. Campos:
//   subagent_dispatch, question_prompt, todo_tool, hooks, capabilities_flags. plan_paths/state são
//   portáveis (iguais a todos os hosts) e vivem em capabilities(). Adicionar host =
//   adicionar entrada aqui; nenhum ramo `if host==` em outro lugar.
// capabilities_flags: pré-requisitos essenciais (subagent_available, mcp_available)
//   são hard-fail no preflight (DEC-004); todo_available é não-essencial.
const HOST_ADAPTERS = {
  claude: {
    label: 'Claude Code',
    subagent_dispatch: {
      mechanism: 'Agent(subagent_type)',
      example: 'Agent(subagent_type: "talos-task-validator", prompt: "<state_path>")',
      registration: 'agents/<name>.md na raiz do plugin',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'self_evident',
        confidence: 'presumed',
        mechanism: 'Agent(subagent_type) bloqueante por design do host',
      },
    },
    question_prompt: { mechanism: 'AskUserQuestion', mode: 'structured', max_questions: 4, options_per_question: 3, persistence: 'sprint_after_each_round' },
    todo_tool: 'TodoWrite',
    hooks: { supported: true, mechanism: 'hooks/claude/settings.snippet.json' },
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
    // Claude Code é o host de referência: subagente mutável confirmado em produção
    // (Write/Edit/Bash disponíveis no Agent nativo). dispatch_capability 'mutable'
    // garante que modos de execução (full/direct/execute) passam sem report adicional.
    dispatch_capability: 'mutable',
  },
  codex: {
    label: 'Codex App',
    subagent_dispatch: {
      mechanism: 'spawn_agent(agent_type)',
      example: 'spawn_agent(agent_type: "talos-task-validator", items: [{ type: "text", text: "<state_path>" }])',
      registration: 'CODEX_HOME/agents/<name>.toml via `npx github:pauloborini/talos init codex` (custom agent nativo; developer_instructions carrega o SKILL.md; modelo herdado do host/conta)',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      required_agent_type: 'talos-task-validator',
      join: {
        sync: 'self_evident',
        confidence: 'confirmed',
        mechanism: 'spawn_agent bloqueante; retorno via state_path + veredito; no Codex deve usar explicitamente agent_type="talos-task-validator"',
      },
    },
    question_prompt: { mechanism: 'request_user_input', mode: 'structured', max_questions: 3, options_per_question: 3, persistence: 'sprint_after_each_round' },
    todo_tool: 'tasks',
    hooks: { supported: false, mechanism: null },
    // Codex subagents are native, but spawned agents do not receive spawn_agent in
    // the current host tool surface. Validator runs as an isolated sibling
    // dispatched by the orchestrator after the executor writes state_path.
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
    // Codex spawn_agent confirmado em produção com capacidade de mutação.
    dispatch_capability: 'mutable',
  },
  opencode: {
    label: 'opencode',
    subagent_dispatch: {
      mechanism: '@<name> (ou auto por description)',
      example: 'invocar @talos-task-validator passando <state_path>',
      registration: '.opencode/agents/<name>.md (frontmatter description + mode: subagent)',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'self_evident',
        confidence: 'presumed',
        mechanism: '@<name> bloqueante presumido',
      },
    },
    question_prompt: { mechanism: 'question', mode: 'structured', max_questions: 4, options_per_question: 3, persistence: 'sprint_after_each_round' },
    // opencode expõe `todowrite` nativo ao agente primário (orquestrador). O `todoread`
    // foi fundido em `todowrite` (mar/2026): a tool retorna a lista atual no output.
    // Subagentes têm `todowrite` desabilitado por padrão, mas o todo é usado pelo
    // orquestrador (primário), não pelos validadores — então a flag descreve o nível certo.
    todo_tool: 'todowrite',
    hooks: { supported: true, mechanism: '.opencode/plugins/' },
    // Nativo compatível: subagente (.opencode/agents) + MCP local (opencode.json) + todo (todowrite).
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
    // opencode @<name> confirmado em produção com capacidade de mutação.
    dispatch_capability: 'mutable',
  },
  pi: {
    label: 'pi cli',
    subagent_dispatch: {
      // pi-subagents dispara pela tool `subagent({agent, task})` — NÃO por @name nem via MCP.
      // As tools MCP do Talos chegam proxiadas/prefixadas pelo pi-mcp-adapter (talos_<tool>).
      mechanism: 'subagent({ agent, task }) — tool do pi-subagents',
      example: 'subagent({ agent: "talos-task-validator", task: "<state_path>", context: "fresh" })',
      registration: '.pi/agents/<name>.md (pi-subagents; frontmatter name + description + tools)',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'must_report',
        confidence: 'reported_required',
        mechanism: 'subagent({agent,task}) via pi-subagents; join depende de dep externa',
      },
    },
    question_prompt: { mechanism: 'interactive_prompt', mode: 'structured', max_questions: 4, options_per_question: 3, persistence: 'sprint_after_each_round' },
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
    // dispatch_capability 'unknown' — subagente depende de pi-subagents (dep externa).
    // Exige host_capabilities.dispatch_mutable === true para modos de execução.
    dispatch_capability: 'unknown',
  },
  antigravity: {
    label: 'Antigravity',
    // Antigravity não tem skill loader nativo em subagentes — o SKILL.md completo
    // DEVE ser embutido no Prompt de cada invoke_subagent (via define_subagent como
    // system_prompt ou diretamente no Prompt). Nunca despachar subagente sem SKILL.md
    // injetado, pois o subagente não carregará o contrato e o pipeline vai impasse.
    //
    // Fluxo para fases de execução/validação (executor, validator, repair, review):
    //   1. define_subagent(name: "<talos-exec>", system_prompt: "<SKILL.MD completo>")
    //   2. invoke_subagent(Subagents: [{TypeName: "<talos-exec>", Role: "<papel>",
    //                                   Prompt: "<state_path ou plan_path>",
    //                                   Workspace: "branch"}])
    //   — invoke_subagent é BLOQUEANTE por design: não polling, não background.
    //   — Workspace: "branch" garante isolamento de contexto (fronteira G4/G9).
    //
    // Fases documentais (contrato §7, entrevista, plano) NÃO usam subagente — o orquestrador
    // conduz no fio principal; define_subagent não é chamado para essas fases.
    subagent_dispatch: {
      mechanism: 'define_subagent(name, system_prompt) + invoke_subagent(Subagents: [{TypeName, Role, Prompt, Workspace}])',
      example: 'define_subagent(name: "talos-task-validator", system_prompt: "<SKILL.MD completo do talos-task-validator>") seguido de invoke_subagent(Subagents: [{TypeName: "talos-task-validator", Role: "Validador frio", Prompt: "<state_path>", Workspace: "branch"}])',
      registration: 'define_subagent dinâmico por sessão — o SKILL.md canônico é passado como system_prompt; sem pré-registro persistente',
      // Sem loader nativo: o SKILL.md DEVE ser embutido no system_prompt do define_subagent.
      // Não usar TypeName: "self" sem injetar o SKILL.md — o subagente herdaria o contexto
      // do orquestrador e violaria o isolamento frio (G4/G9).
      skill_loading: 'embed_in_system_prompt',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'self_evident',
        confidence: 'high',
        mechanism: 'invoke_subagent bloqueante por design do host — sem polling, sem callback',
      },
    },
    // question_prompt: usado pela talos-sprint-interview para fazer perguntas ao usuário.
    // No Antigravity, usar ask_question (ferramenta nativa de perguntas interativas).
    // IMPORTANTE — resume_after_interview: após receber respostas via ask_question,
    // persistir no sprint file (§7) e RETOMAR O PIPELINE IMEDIATAMENTE sem nova confirmação.
    // Nunca aguardar input adicional do usuário entre fases — viola fire-and-continue.
    question_prompt: {
      mechanism: 'ask_question',
      mode: 'structured',
      max_questions: 4,
      options_per_question: 3,
      persistence: 'sprint_after_each_round',
      resume_after_interview: 'automatic',
    },
    todo_tool: null,
    hooks: { supported: false, mechanism: null },
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: false },
    // self_evident: MCP nativo + invoke_subagent bloqueante provados pelo boot do host.
    // Não exige host_capabilities report (igual claude/codex/opencode).
    prereq_policy: 'self_evident',
    // dispatch_capability 'unknown' — não verificado em produção com mutação real.
    // Exige host_capabilities.dispatch_mutable === true para modos de execução.
    dispatch_capability: 'unknown',
  },
  zcode: {
    label: 'ZCode',
    subagent_dispatch: {
      // ZCode roda no Claude Agent SDK: Agent(subagent_type) nativo e bloqueante.
      // Skills/agents do plugin vivem no bundle (.zcode-plugin) carregado pelo host.
      mechanism: 'Agent(subagent_type)',
      example: 'Agent(subagent_type: "talos-task-validator", prompt: "<state_path>")',
      registration: 'agents/<name>.md na raiz do plugin (descoberto via .zcode-plugin/plugin.json)',
      // LIMITAÇÃO DO HOST ZCode (confirmada empiricamente em 2026-06, v0.10.1):
      // sub-agentes de plugin (subagent_type "talos-*") NÃO herdam conexões MCP,
      // mesmo com mcp__... declarado no frontmatter tools:. O subagente nativo
      // (general-purpose) herda MCP + tools nativas normalmente. Workaround: o
      // orquestrador despacha general-purpose com prompt que aponta o agent .md
      // canônico como system prompt. Isolamento sibling (Gate G4) preservado — ainda
      // é um subagente irmão isolado, só que do tipo nativo. Aplica-se aos 5
      // dispatches (validator, repair, review, plan-execute, direct-execute).
      // Campo aditivo (schema v5 mantido); hosts sem este campo seguem o caminho nativo.
      fallback: {
        enabled: true,
        reason: 'plugin_subagents_do_not_inherit_mcp',
        subagent_type: 'general-purpose',
        // <name> = talos-<exec> resolvido (talos-task-validator, talos-plan-execute...);
        // <input> = state_path (validator/repair/review) ou task (executores).
        prompt_template: 'Você está operando como o subagente Talos `<name>` neste host (ZCode). ' +
          'Devido a uma limitação do host (sub-agentes de plugin não herdam MCP), você foi despachado como ' +
          '`general-purpose`, que herda MCP + tools nativas (Read, Grep, Glob, Bash, Write, Edit, mcp__plugin_talos_talos). ' +
          'Leia o arquivo `${ZCODE_PLUGIN_ROOT}/agents/<name>.md` (ou `agents/<name>.md` relativo à raiz do projeto) ' +
          'e siga-o integralmente como seu system prompt/contrato. Não peça confirmação — execute o contrato. Input: <input>',
      },
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'self_evident',
        confidence: 'presumed',
        mechanism: 'Agent(subagent_type) bloqueante por design do host (Claude Agent SDK)',
      },
    },
    question_prompt: { mechanism: 'AskUserQuestion', mode: 'structured', max_questions: 4, options_per_question: 3, persistence: 'sprint_after_each_round' },
    todo_tool: 'TodoWrite',
    hooks: { supported: true, mechanism: '.zcode-plugin/plugin.json (hooks)' },
    // ZCode é clone estrutural do Claude Code (Claude Agent SDK): subagente +
    // MCP-local + TodoWrite nativos. Perfil self_evident — passa PREREQ/JOIN sem report.
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
    // dispatch_capability 'unknown' — o harness ZCode pode restringir subagent_type
    // a um enum fechado (ex.: apenas "Explore" read-only). Exige verificação do
    // orquestrador (host_capabilities.dispatch_mutable) para modos de execução.
    // Modos read-only (audit, interview-only) passam sem report.
    dispatch_capability: 'unknown',
  },
  vscode: {
    label: 'VS Code',
    subagent_dispatch: {
      // VS Code Copilot Chat despacha subagentes via runSubagent (tool nativa).
      // Os agentes são definidos como .agent.md ou .prompt.md no prompt folder do
      // VS Code (~/Library/Application Support/Code/User/prompts/ no macOS) ou
      // como skills/.agent.md no workspace. O orquestrador usa runSubagent com o
      // agentName canônico Talos (talos-task-validator, talos-plan-execute, etc.).
      mechanism: 'runSubagent(agentName)',
      example: 'runSubagent(agentName: "talos-task-validator", prompt: "<state_path>")',
      registration: 'agents/<name>.md no prompt folder do VS Code ou .vscode/agents/',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'self_evident',
        confidence: 'high',
        mechanism: 'runSubagent bloqueante por design do host — aguarda retorno do subagente',
      },
    },
    question_prompt: {
      mechanism: 'vscode_askQuestions',
      mode: 'structured',
      max_questions: 4,
      options_per_question: 3,
      persistence: 'sprint_after_each_round',
    },
    // VS Code Copilot Chat expõe manage_todo_list nativo ao agente primário.
    todo_tool: 'manage_todo_list',
    hooks: { supported: false, mechanism: null },
    // VS Code tem subagente (runSubagent) + MCP nativo (mcp.json) + todo (manage_todo_list)
    // todas capabilities self_evident — confirmadas no ambiente de execução.
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
    // self_evident: MCP nativo + runSubagent bloqueante provados pelo boot do host.
    prereq_policy: 'self_evident',
    // VS Code runSubagent confirmado em produção com capacidade de mutação
    // (Write/Edit/Bash disponíveis no subagente nativo).
    dispatch_capability: 'mutable',
  },
  mavis: {
    label: 'Mavis (MiniMax Code)',
    // Mavis expõe subagentes via tool nativa `task` com agent_name — não há
    // `Agent(subagent_type)` literal. Cada subagente Talos vira um custom agent
    // Mavis (config.yaml em ~/.minimax/agents/talos-<name>/) com system_prompt
    // derivado de agents/<talos-<name>.md. O orquestrador despacha via
    // `task({ agent_name: "talos-<name>", prompt: "<state_path>" })` e usa
    // `mavis session send` (síncrono) para o gate JOIN ficar self_evident.
    subagent_dispatch: {
      mechanism: 'task({ agent_name }) / mavis session send',
      example: 'task({ agent_name: "talos-task-validator", prompt: "<state_path>" }) ou session send { session_id: "<sub-session>", content: "<state_path>" }',
      registration: '~/.minimax/agents/talos-<name>/config.yaml (custom agent Mavis; system_prompt = corpo de agents/<talos-<name>.md do Talos)',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        // Mavis `task` foreground é síncrono (retorna task result no mesmo turno).
        // Equivalente a session send bloqueante. Sem polling, sem background.
        sync: 'self_evident',
        confidence: 'high',
        mechanism: 'task foreground / session send bloqueante por design do host — aguarda retorno do subagente no mesmo turno',
      },
    },
    // Mavis expõe ask_user como tool de questionamento estruturado (1–4 steps,
    // selectionMode single/multiple). Equivalente direto a AskUserQuestion.
    // Limitação: max 4 steps por tool call (igual Claude). Mapeamento 1:1.
    question_prompt: {
      mechanism: 'ask_user',
      mode: 'structured',
      max_questions: 4,
      options_per_question: 4,
      persistence: 'sprint_after_each_round',
    },
    // Mavis expõe todowrite nativo (built-in tool) ao agente primário e subagentes.
    todo_tool: 'todowrite',
    // Mavis Plugin V1 não suporta hooks (PreToolUse/Stop). PreToolUse trava
    // de path vira `null`; nada quebra porque o gate é não-essencial.
    hooks: { supported: false, mechanism: null },
    // Mavis tem subagente (task/session send) + MCP (Plugin V1 servers.mcp.json)
    // + todo (todowrite) — todos capabilities self_evident (nativas do host,
    // boot prova MCP-vivo, subagente é nativo).
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: true },
    // self_evident: MCP nativo + task/session send bloqueante nativos do Mavis.
    prereq_policy: 'self_evident',
    // Mavis task(session send) confirmado em produção com capacidade de mutação
    // (Read/Write/Edit/Bash/Glob/Grep disponíveis no subagente nativo). Smoke
    // inicial roda `talos_ping` e `talos_capabilities` (read-only); gate
    // DISPATCH é self_evident porque o Mavis não restringe tools por agente.
    dispatch_capability: 'mutable',
  },
  generic: {
    label: 'Host genérico',
    subagent_dispatch: {
      mechanism: 'subagente nativo do host',
      example: 'despachar o subagente talos-task-validator passando apenas <state_path>',
      registration: 'mecanismo nativo equivalente do host',
    },
    validator_dispatch: {
      dispatcher: 'orchestrator',
      join: {
        sync: 'must_report',
        confidence: 'reported_required',
        mechanism: 'indeterminado; host deve reportar',
      },
    },
    question_prompt: { mechanism: 'native_structured_question', mode: 'structured', max_questions: 4, options_per_question: 3, persistence: 'sprint_after_each_round' },
    todo_tool: null,
    hooks: { supported: false, mechanism: null },
    // generic EXIGE subagente+MCP do host (DEC-004); host MCP-only sem subagente
    // fica fora de escopo e é rejeitado no preflight, não degradado.
    capabilities_flags: { subagent_available: true, mcp_available: true, todo_available: false },
    // must_report: host desconhecido — o servidor não pode presumir subagente+MCP.
    // Fail-closed — exige report afirmativo de disponibilidade.
    prereq_policy: 'must_report',
    // dispatch_capability 'unknown' — host desconhecido, sem verificação possível.
    dispatch_capability: 'unknown',
  },
};

// Pré-requisitos de determinismo (DEC-004): essenciais → hard-fail no preflight;
// não-essenciais → seguem sem o recurso, registrando. Contrato consumido por S09.
const PREREQUISITES = {
  essential: ['subagent_available', 'mcp_available'],
  non_essential: ['todo_available'],
};
const PREREQUISITE_FLAGS = [...PREREQUISITES.essential, ...PREREQUISITES.non_essential];

// Versão do contrato talos_capabilities. Política: incremento aditivo (campos novos
// opcionais) mantém compat — consumidores DEVEM ignorar campos desconhecidos.
// Remoção/renomeação de campo ou mudança de semântica exige bump e nota de migração.
// v1 → v2: adiciona capabilities_flags, hooks, prerequisites, known_hosts,
//   required_deps, prereq_policy (aditivo).
// v2 → v3: adiciona validator_dispatch (quem despacha o validador frio G4 e como).
// v3 → v4 (DEC-SIB-001/003): sibling é a única topologia. validator_dispatch
//   colapsa para `{ dispatcher: 'orchestrator' }` em todos os hosts; os campos de
//   topologia legada (dispatcher por executor) foram REMOVIDOS do contrato
//   (mudança de semântica → bump consciente). Consumidores que liam o antigo
//   validator_dispatch.topology devem assumir sibling incondicionalmente. Estado antigo em disco com esses
//   campos é rollback-safe: campos extras são ignorados pelo spread/normalize.
// v4 → v5 (DEC-SIB-003, S06, SPEC_JOIN_CAPABILITY_S03 §2.2): adiciona
//   validator_dispatch.join { sync, confidence, mechanism } por host. Aditivo
//   (campo novo; nenhum campo removido nesta etapa). O input do preflight ganha
//   host_capabilities.join_sync_available (opcional, gate JOIN separado — NÃO é
//   flag de prereq). Consumidores que ignoram campos desconhecidos seguem compatíveis.
// v5 + DEC-008: adiciona campo aditivo dispatch_capability e input opcional
//   host_capabilities.dispatch_mutable para gate DISPATCH em modos de execução.
const CAPABILITIES_SCHEMA_VERSION = 5;

// Nomes de host derivados do registry — única fonte de verdade para enums de schema.
// Adicionar host em HOST_ADAPTERS propaga automaticamente (sem enum hardcoded).
const HOST_NAMES = Object.keys(HOST_ADAPTERS);

// Registry de detecção de host, data-driven e ordenado por precedência (DEC-003).
// Adicionar host = adicionar um detector aqui (env próprio/arquivo); sem ramo solto.
// `arg host` e `TALOS_HOST` (override explícito) têm prioridade sobre sinais de env.
// Cada detector retorna o nome do host se casar, ou null. Só hosts presentes em
// HOST_ADAPTERS são aceitos (perfil desconhecido cai em generic).
const HOST_DETECTORS = [
  { via: 'env:CLAUDE_PLUGIN_ROOT', detect: (env) => (env.CLAUDE_PLUGIN_ROOT ? 'claude' : null) },
  { via: 'env:CODEX', detect: (env) => (env.CODEX_HOME || env.CODEX_PLUGIN_ROOT ? 'codex' : null) },
  // ZCode (app Electron no Claude Agent SDK) injeta ZCODE_PLUGIN_ROOT ao spawnar o
  // subprocesso MCP do plugin (comprovado no bundle zcode.cjs: interpolação análoga a
  // CLAUDE_PLUGIN_ROOT). Sinal próprio e determinístico — precedência sobre TALOS_HOST.
  { via: 'env:ZCODE_PLUGIN_ROOT', detect: (env) => (env.ZCODE_PLUGIN_ROOT ? 'zcode' : null) },
  // opencode/pi não expõem env distintivo garantido no subprocesso MCP (S01).
  // Detecção determinística: o packaging injeta TALOS_HOST no env do MCP —
  //   opencode: opencode.json → mcp.<name>.environment.TALOS_HOST = "opencode"
  //   pi: mcp.json (pi-mcp-adapter) → env.TALOS_HOST = "pi"
  // Tratado pela branch TALOS_HOST acima; sem file-detection frágil.
];

function detectHost(args = {}, env = process.env) {
  if (args.host && HOST_ADAPTERS[args.host]) return { host: args.host, detected_via: 'arg' };
  const override = env.TALOS_HOST;
  if (override && HOST_ADAPTERS[override]) return { host: override, detected_via: 'env:TALOS_HOST' };
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
    validator_dispatch: adapter.validator_dispatch,
    question_prompt: adapter.question_prompt,
    todo_tool: adapter.todo_tool,
    hooks: adapter.hooks,
    capabilities_flags: adapter.capabilities_flags,
    required_deps: adapter.required_deps ?? [],
    prerequisites: PREREQUISITES,
    // 'must_report' avisa o orquestrador que DEVE apurar e reportar host_capabilities
    // (subagente/MCP reais) no preflight — sem isso, o gate PREREQ falha-fechado.
    prereq_policy: adapter.prereq_policy ?? 'self_evident',
    // dispatch_capability (DEC-008): 'mutable' (verificado), 'unknown' (exige report),
    // ou 'readonly' (hard-fail para modos de execução).
    dispatch_capability: adapter.dispatch_capability ?? 'unknown',
    plan_paths: {
      write: '.talos/plans/',
      read_order: ['.talos/plans/', '.cursor/plans/', '.codex/plans/'],
      deprecated_read: ['.cursor/plans/', '.codex/plans/'],
    },
    state_backend: 'talos_run_state',
    state_dir: RUN_DIR,
    known_hosts: Object.keys(HOST_ADAPTERS),
  };
}

// Hard-fail de pré-requisitos de determinismo (DEC-004). Mescla as flags do perfil
// do host com a disponibilidade real reportada pelo caller (`host_capabilities`).
//
// Política por host (`prereq_policy`):
//   - 'self_evident' (claude/codex/opencode/zcode, default): runtime nativo. Flag essencial
//     vem do report quando presente, senão do perfil (otimista justificado: MCP-vivo
//     prova-se no boot; subagente é nativo do host/plugin instalado).
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

// Gate JOIN (DEC-SIB-003, SPEC_JOIN_CAPABILITY_S03 §3/§5). Espelha checkPrerequisites:
// lê validator_dispatch.join do adapter e decide hard-fail por política.
//   - join.sync === 'self_evident' (claude/codex/opencode/zcode): host nativo conhecido;
//     o runtime presume join disponível e NÃO exige report. confidence 'presumed'
//     (claude/opencode) passa, mas é registrado para observabilidade (smoke S13).
//   - join.sync === 'must_report' (pi/generic): fail-closed. Só passa se o caller
//     reportar host_capabilities.join_sync_available === true. Ausente/não-bool ⇒ blocked.
// join_sync_available é gate SEPARADO — não entra em PREREQUISITE_FLAGS nem polui
// effective_flags de checkPrerequisites (o merge daquele loop ignora chaves desconhecidas).
function checkJoinCapability(args = {}) {
  const { host } = detectHost(args);
  const adapter = HOST_ADAPTERS[host];
  const join = adapter.validator_dispatch?.join ?? {};
  const reported = args.host_capabilities && typeof args.host_capabilities === 'object'
    ? args.host_capabilities
    : {};
  if (join.sync === 'must_report') {
    if (reported.join_sync_available === true) {
      return { status: 'passed', host, confidence: join.confidence };
    }
    return {
      status: 'blocked',
      host,
      error: `host '${host}' não reportou join síncrono; sibling exige join (DEC-SIB-003)`,
      cause: 'host_nao_reportou_join_sincrono',
      impact: 'sem_join_sincrono_o_slot_de_validacao_vaza_em_fire_and_forget',
      next_action: 'instalar_deps_de_subagente_sincrono_ou_usar_host_nativo_e_reportar_join_sync_available',
    };
  }
  // self_evident: passa sem report (host nativo). confidence preservado p/ observabilidade.
  return { status: 'passed', host, confidence: join.confidence };
}

// Gate DISPATCH_CAPABILITY (DEC-008). Valida se o sub-agent do host tem capacidade
// de mutação (Write/Edit/Bash) quando o modo exige execução de código.
//
// dispatch_capability por host (campo novo em HOST_ADAPTERS):
//   - 'mutable' (claude/codex/opencode): verificado em produção — passa direto.
//   - 'unknown' (zcode/antigravity/pi/generic): não verificado ou depende de dep
//     externa. Fail-closed para modos de execução: exige que o caller reporte
//     host_capabilities.dispatch_mutable === true.
//   - 'readonly' (nenhum host atual; reservado): hard-fail incondicional.
//
// Modos sem execução de código (audit, interview-only) são read-only por natureza
// e passam sem verificar dispatch_capability.
function checkDispatchCapability(args = {}, mode) {
  const { host } = detectHost(args);
  const adapter = HOST_ADAPTERS[host];
  const capability = adapter.dispatch_capability ?? 'unknown';

  // Modos read-only não exigem mutação — passam direto.
  const MUTATION_MODES = new Set(['full', 'direct', 'execute']);
  if (!MUTATION_MODES.has(mode)) {
    return { status: 'passed', host, capability, reason: 'modo_readonly_nao_exige_mutacao' };
  }

  if (capability === 'mutable') {
    return { status: 'passed', host, capability };
  }

  if (capability === 'readonly') {
    return {
      status: 'blocked',
      host,
      capability,
      error: `host '${host}' tem subagente readonly; modo '${mode}' exige mutação (Write/Edit/Bash)`,
      cause: 'dispatch_capability_readonly',
      impact: 'execucao_de_codigo_impossivel_sem_subagente_mutavel',
      next_action: 'usar_host_com_subagente_mutavel_ou_executar_modo_audit_ou_interview_only',
    };
  }

  // capability === 'unknown': fail-closed — exige report afirmativo.
  const reported = args.host_capabilities && typeof args.host_capabilities === 'object'
    ? args.host_capabilities
    : {};
  if (reported.dispatch_mutable === true) {
    return { status: 'passed', host, capability: 'reported_mutable', reported: true };
  }

  return {
    status: 'blocked',
    host,
    capability,
    error: `host '${host}' não verificou capacidade de mutação do subagente; modo '${mode}' exige Write/Edit/Bash no sub-agent`,
    cause: 'dispatch_capability_nao_verificada',
    impact: 'subagente_readonly_nao_consegue_executar_plano_ou_reparo',
    next_action: host === 'pi'
      ? 'verificar_pi-subagents_instalado_e_reportar_host_capabilities_com_dispatch_mutable_true'
      : 'verificar_se_subagente_do_host_tem_Write_Edit_Bash_e_reportar_host_capabilities_com_dispatch_mutable_true',
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
  if (explicitRoot && explicitRoot.trim() !== '') {
    return path.resolve(explicitRoot);
  }
  const cwd = process.cwd();
  if (cwd === '/' || cwd === '/var/folders') {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) return path.resolve(home);
  }
  return path.resolve(cwd);
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

function optionalInteger(args, key) {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) {
    throw rpcError(-32602, `Campo inválido: ${key} deve ser inteiro`);
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

function isoPlusMs(iso, ms) {
  const base = Date.parse(iso);
  return new Date((Number.isFinite(base) ? base : Date.now()) + ms).toISOString();
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) && !NON_SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redact(nested),
    ]),
  );
}

function logCall(entry, args = {}) {
  try {
    const line = JSON.stringify({ timestamp: nowIso(), ...entry }) + '\n';
    fs.appendFileSync(path.join(ensureRunDir(args), 'mcp.log'), line, { mode: 0o600 });
  } catch (error) {
    // Ignora silenciosamente falhas de gravação de log (ex: diretório somente-leitura)
  }
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
    // Fonte única da superfície de tools: derivado de toolsList() para nunca
    // divergir do dispatcher/schema. Lista manual paralela já omitiu
    // talos_classify_input no passado (drift silencioso) — o orquestrador
    // (Fase 0) aborta se uma capability exigida pelo modo não aparece aqui,
    // então a divergência travava run válida. Guard cruzado em server.test.js.
    capabilities: toolsList().tools.map((tool) => tool.name),
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
    // Atualização-simples: um run ANTIGO inativo (inclusive de versão anterior do
    // plugin) não pode travar um run NOVO. A varredura de conflito só importa pra
    // runs de OUTRO run_id que estejam com dispatch ATIVO. Por isso parseamos de
    // forma tolerante e ignoramos runs inativos/corrompidos/de versão velha — a
    // validação estrita de versão/shape do PRÓPRIO run continua em readState
    // (validateStateShape) no caminho que de fato opera sobre aquele estado.
    let state;
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // run alheio corrompido não é nosso conflito
    }
    if (!state || typeof state !== 'object' || state.run_id === runId) continue;
    const active = state.data?.dispatch?.active;
    if (active?.phase) {
      // Conflito real só quando o OUTRO run ativo é da versão atual; um run ativo
      // de versão antiga é resíduo de processo morto, não lock vivo.
      const stateVersion = state.data?.routing?.version;
      const currentVersion = readVersionInfo().version;
      if (stateVersion && stateVersion !== currentVersion) continue;
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
    // P2/S22: upsert parcial DEVE preservar chaves irmãs do estado (dispatch,
    // validator_cycle, routing, gates). O executor escreve o handoff via
    // talos_run_state(upsert) com um `data` parcial; um replace cego apagava
    // `data.dispatch.active={plan_execute}`, fazendo o lock_validator(start)
    // seguinte bloquear ("current_phase null"). Merge top-level: o caller adiciona
    // chaves novas sem derrubar as existentes. Sem `data` no payload → mantém o
    // estado anterior intacto (comportamento de no-op preservado).
    data: redact(data !== undefined ? { ...(previous?.data ?? {}), ...data } : (previous?.data ?? {})),
    created_at: previous?.created_at ?? timestamp,
    updated_at: timestamp,
    last_call: {
      tool: 'talos_run_state',
      action: 'upsert',
      timestamp,
    },
  };

  const target = statePath(runId, args);
  const tmp = `${target}.${process.pid}.tmp`;
  // Ledger MCP é leitura de máquina/context layer. JSON compacto preserva o
  // contrato e corta whitespace/token sem mudar semântica.
  fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
  return next;
}

const LEDGER_TEXT_LIMIT = 120;
const LEDGER_HISTORY_LIMIT = 8;
const LEDGER_APPLIED_LIMIT = 16;

function compactLedgerText(value) {
  if (typeof value !== 'string') return value;
  return value.length > LEDGER_TEXT_LIMIT ? `${value.slice(0, LEDGER_TEXT_LIMIT)}...` : value;
}

function compactLedgerArray(value) {
  if (!Array.isArray(value)) return value;
  return value.slice(0, 8).map((item) => (
    typeof item === 'string' ? compactLedgerText(item) : item
  ));
}

function compactLedgerEvent(event = {}) {
  const keys = [
    'gate', 'action', 'phase', 'status', 'timestamp', 'mode', 'artifact_kind',
    'event', 'applicable', 'current_phase', 'expected_phase', 'validator_status',
    'validator_attempt', 'validator_run_id', 'repair_run_id', 'state_path',
    'next_action', 'error', 'cause', 'block_kind', 'reason',
    'stale_discarded', 'challenge_verified', 'challenge_file',
    'challenge_failures', 'challenge_failures_max', 'applied_validator_status',
    'last_verdict', 'validator_output_path', 'repair_budget', 'pending_count',
  ];
  const arrayKeys = [
    'finding_ids', 'missing_finding_ids', 'unresolved_finding_ids',
    'boundary_violations', 'repair_violations',
  ];
  const compact = {};
  for (const key of keys) {
    if (event[key] !== undefined && event[key] !== null) {
      compact[key] = compactLedgerText(event[key]);
    }
  }
  for (const key of arrayKeys) {
    if (event[key] !== undefined && event[key] !== null) {
      compact[key] = compactLedgerArray(event[key]);
    }
  }
  return redact(compact);
}

function appendLedgerHistory(history, event) {
  return [...(Array.isArray(history) ? history : []), compactLedgerEvent(event)].slice(-LEDGER_HISTORY_LIMIT);
}

function compactFindingsPacket(packet) {
  if (!packet || typeof packet !== 'object') return packet;
  const findings = Array.isArray(packet.findings) ? packet.findings : [];
  const compactFindings = findings.map((finding) => ({
    id: finding?.id ?? null,
    severity: finding?.severity ?? null,
    file: finding?.file ?? null,
    line: finding?.line ?? null,
    failure_mode: compactLedgerText(finding?.failure_mode ?? null),
    evidence: compactLedgerText(finding?.evidence ?? null),
    recommendation: compactLedgerText(finding?.recommendation ?? null),
  }));
  return {
    findings: compactFindings,
    ...(Array.isArray(packet.repaired_finding_ids)
      ? { repaired_finding_ids: packet.repaired_finding_ids }
      : {}),
  };
}

function compactValidatorCycleForLedger(cycle) {
  if (!cycle || typeof cycle !== 'object') return cycle;
  if (cycle.findings_packet && VALIDATOR_PASSED_STATUSES.has(cycle.status)) {
    return { ...cycle, findings_packet: compactFindingsPacket(cycle.findings_packet) };
  }
  if (cycle.findings_packet && cycle.status === 'blocked') {
    return { ...cycle, findings_packet: compactFindingsPacket(cycle.findings_packet) };
  }
  return cycle;
}

function normalizeApplied(applied = {}) {
  const challengeFailures = applied.challenge_failures && typeof applied.challenge_failures === 'object'
    ? Object.fromEntries(
      Object.entries(applied.challenge_failures)
        .filter(([, count]) => Number.isInteger(count) && count >= 0)
        .slice(-LEDGER_APPLIED_LIMIT),
    )
    : {};
  return {
    validator_completions: Array.isArray(applied.validator_completions)
      ? applied.validator_completions.slice(-LEDGER_APPLIED_LIMIT)
      : [],
    repair_completions: Array.isArray(applied.repair_completions)
      ? applied.repair_completions.slice(-LEDGER_APPLIED_LIMIT)
      : [],
    challenge_failures: challengeFailures,
  };
}

function appendAppliedMarker(list, marker, key) {
  const current = Array.isArray(list) ? list : [];
  return [
    ...current.filter((item) => item?.[key] !== marker[key]),
    marker,
  ].slice(-LEDGER_APPLIED_LIMIT);
}

function appendAppliedValidatorCompletion(applied, marker) {
  const normalized = normalizeApplied(applied);
  return {
    ...normalized,
    validator_completions: appendAppliedMarker(
      normalized.validator_completions,
      marker,
      'validator_run_id',
    ),
  };
}

function appendAppliedRepairCompletion(applied, marker) {
  const normalized = normalizeApplied(applied);
  return {
    ...normalized,
    repair_completions: appendAppliedMarker(
      normalized.repair_completions,
      marker,
      'repair_run_id',
    ),
  };
}

function setAppliedChallengeFailures(applied, validatorRunId, count) {
  const normalized = normalizeApplied(applied);
  return {
    ...normalized,
    challenge_failures: {
      ...normalized.challenge_failures,
      [validatorRunId]: count,
    },
  };
}

function appliedValidatorCompletion(cycle, validatorRunId) {
  const normalized = normalizeApplied(cycle.applied);
  return normalized.validator_completions.find((event) => event.validator_run_id === validatorRunId)
    ?? cycle.history.find(
      (event) =>
        event.action === 'complete' &&
        event.status === 'passed' &&
        event.validator_run_id === validatorRunId,
    )
    ?? null;
}

function appliedRepairCompletion(cycle, repairRunIdValue) {
  const normalized = normalizeApplied(cycle.applied);
  return normalized.repair_completions.find((event) => event.repair_run_id === repairRunIdValue)
    ?? cycle.history.find(
      (event) =>
        event.action === 'repair_complete' &&
        event.status === 'passed' &&
        event.repair_run_id === repairRunIdValue,
    )
    ?? null;
}

function appliedChallengeFailures(cycle, validatorRunId) {
  const normalized = normalizeApplied(cycle.applied);
  if (Number.isInteger(normalized.challenge_failures[validatorRunId])) {
    return normalized.challenge_failures[validatorRunId];
  }
  return cycle.history.filter(
    (event) =>
      event.action === 'complete' &&
      event.validator_status === 'challenge_failed' &&
      event.validator_run_id === validatorRunId,
  ).length;
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
      [gate]: compactLedgerEvent(result),
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
      template_conformance: compactLedgerEvent(result),
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
      [result.gate ?? 'G10']: compactLedgerEvent(result),
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
  const history = appendLedgerHistory(currentDispatch.history, {
    timestamp: result.timestamp,
    phase: result.phase ?? null,
    action: result.action ?? null,
    event: result.event ?? null,
    status: result.status,
    next_action: result.next_action ?? null,
    error: result.error ?? null,
  });
  const data = {
    ...(previous.data ?? {}),
    dispatch: {
      ...currentDispatch,
      ...(result.dispatch ?? {}),
      history,
    },
    gates: {
      ...(previous.data?.gates ?? {}),
      [result.gate ?? 'G7']: compactLedgerEvent(result),
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

function normalizeValidatorCycle(cycle = {}) {
  return {
    // S04: token de dispatch monotônico explícito do slot de validação. Inteiro,
    // sempre crescente, nunca reusado; persiste no run.json e sobrevive a re-spun.
    dispatch_token: Number.isInteger(cycle.dispatch_token) ? cycle.dispatch_token : 0,
    // DEC-SIB-002: o teto de attempts é invariante de CONTRATO (enforcement por
    // tool MCP, não por estado/prosa). VALIDATOR_MAX_ATTEMPTS é o teto canônico e
    // NÃO é configurável via estado persistido. Um run.json adulterado/corrompido
    // com max_attempts inflado (ex.: 99) não pode elevar o teto e liberar um 3º+
    // validator. Por isso clampamos max_attempts: inteiro válido e ≥1 vira
    // min(estado, teto); qualquer 0/negativo/ausente/não-inteiro cai no default
    // canônico. O valor efetivo nunca excede VALIDATOR_MAX_ATTEMPTS, e como todos
    // os fluxos (start/complete/fail) leem o cycle por esta normalização, os
    // retornos que ecoam cycle.max_attempts já recebem o valor clampado.
    // Pela mesma razão, attempts_used recebe piso ≥0: um valor negativo adulterado
    // (ex.: -5) inflaria o teto efetivo (max_attempts - attempts_used) e permitiria
    // dispatches além do limite. Valor float/string/null cai em 0. Teto superior
    // NÃO é necessário — attempts_used=99 já cai no lado seguro (99>=2 → blocked).
    max_attempts: Number.isInteger(cycle.max_attempts) && cycle.max_attempts >= 1
      ? Math.min(cycle.max_attempts, VALIDATOR_MAX_ATTEMPTS)
      : VALIDATOR_MAX_ATTEMPTS,
    attempts_used: Number.isInteger(cycle.attempts_used) && cycle.attempts_used >= 0
      ? cycle.attempts_used
      : 0,
    status: typeof cycle.status === 'string' ? cycle.status : 'idle',
    active: cycle.active && typeof cycle.active === 'object' ? cycle.active : null,
    last_state_path: typeof cycle.last_state_path === 'string' ? cycle.last_state_path : null,
    last_verdict: typeof cycle.last_verdict === 'string' ? cycle.last_verdict : null,
    findings_packet: cycle.findings_packet && typeof cycle.findings_packet === 'object' ? cycle.findings_packet : null,
    repair: cycle.repair && typeof cycle.repair === 'object'
      ? {
        skill: typeof cycle.repair.skill === 'string' ? cycle.repair.skill : WORKFLOW_CONFIG.skills.findings_repair,
        status: typeof cycle.repair.status === 'string' ? cycle.repair.status : 'not_needed',
        required_from_attempt: Number.isInteger(cycle.repair.required_from_attempt) ? cycle.repair.required_from_attempt : null,
        requested_at: typeof cycle.repair.requested_at === 'string' ? cycle.repair.requested_at : null,
        completed_at: typeof cycle.repair.completed_at === 'string' ? cycle.repair.completed_at : null,
        active: cycle.repair.active && typeof cycle.repair.active === 'object' ? cycle.repair.active : null,
      }
      : {
        skill: WORKFLOW_CONFIG.skills.findings_repair,
        status: 'not_needed',
        required_from_attempt: null,
        requested_at: null,
        completed_at: null,
        active: null,
      },
    applied: normalizeApplied(cycle.applied),
    history: Array.isArray(cycle.history) ? cycle.history : [],
  };
}

function patchValidatorResult(runId, result, args = {}) {
  const previous = readState(runId, args);
  const current = normalizeValidatorCycle(previous.data?.validator_cycle ?? {});
  const history = appendLedgerHistory(current.history, {
    timestamp: result.timestamp,
    action: result.action,
    status: result.status,
    validator_status: result.validator_status ?? null,
    validator_attempt: result.validator_attempt ?? null,
    validator_run_id: result.validator_run_id ?? null,
    repair_run_id: result.repair_run_id ?? null,
    state_path: result.state_path ?? null,
    next_action: result.next_action ?? null,
    error: result.error ?? null,
  });
  const data = {
    ...(previous.data ?? {}),
    validator_cycle: compactValidatorCycleForLedger({
      ...current,
      ...(result.validator_cycle ?? {}),
      history,
    }),
    gates: {
      ...(previous.data?.gates ?? {}),
      [result.gate ?? 'G4']: compactLedgerEvent(result),
    },
  };

  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous.phase ?? 'dispatch',
    status: result.status === 'passed' ? 'validator_gate_ok' : 'validator_gate_blocked',
    summary: `${result.gate ?? 'G4'}: ${result.status}`,
    data,
  });
}

// S10: deriva o slot de recovery para um orquestrador re-spun reconhecer de forma
// determinística qual retorno aceitar. Aditivo, não-quebrante: campo top-level
// `validator_recovery` no retorno de leitura (null quando não há slot ativo).
// Construído na leitura (fora do caminho de persistência/redact), então
// `expected_dispatch_token` não é redigido — não reabre a chave genérica `token`.
function deriveValidatorRecovery(state) {
  const cycle = state?.data?.validator_cycle;
  const active = cycle && typeof cycle === 'object' ? cycle.active : null;
  if (!active || typeof active !== 'object') return null;
  return {
    expected_validator_run_id: typeof active.run_id === 'string' ? active.run_id : null,
    expected_dispatch_token: Number.isInteger(active.dispatch_token) ? active.dispatch_token : null,
    expected_state_path: typeof active.state_path === 'string' ? active.state_path : null,
    attempt: Number.isInteger(active.attempt) ? active.attempt : null,
    status: typeof cycle.status === 'string' ? cycle.status : null,
    // P1.1: challenge de proof-of-work do slot ativo (null se não emitido). O
    // validador irmão lê isto, computa sha256 do arquivo e devolve em challenge_response.
    challenge: active.challenge && typeof active.challenge === 'object' ? active.challenge : null,
  };
}

function runState(args = {}) {
  const action = args.action ?? 'get';
  if (action === 'get') {
    const state = readState(validateRunId(args.run_id), args);
    return { ...state, validator_recovery: deriveValidatorRecovery(state) };
  }
  if (action === 'recovery') {
    const runId = validateRunId(args.run_id);
    const state = readState(runId, args);
    return {
      run_id: runId,
      phase: state.phase ?? null,
      status: state.status ?? null,
      updated_at: state.updated_at ?? null,
      validator_recovery: deriveValidatorRecovery(state),
    };
  }
  if (action === 'upsert') return upsertState(args);
  throw rpcError(-32602, `Ação inválida para talos_run_state: ${action}`);
}

function validateJsonArtifactFile(absolutePath) {
  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(content);
    return { ok: true, parsed_type: Array.isArray(parsed) ? 'array' : typeof parsed };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function verifyArtifact(args = {}) {
  const runId = validateRunId(args.run_id);
  const artifactPath = requiredString(args, 'artifact_path');
  const absolutePath = resolveConsumerPath(artifactPath, args);
  const timestamp = nowIso();
  // Banner correto por tipo de artefato: verificar sprint/contrato não pode ecoar
  // "plano · validado". `artifact_kind` é opcional e aditivo — `sprint` → banner de
  // aceite; ausente/`plan` mantém o banner de plano (compat com callers antigos que
  // só verificavam plano).
  const artifactKind = optionalString(args, 'artifact_kind');
  const okBanner = artifactKind === 'sprint'
    ? renderBanner('aceite_ok', {})
    : artifactKind === 'json'
      ? renderBanner('validacao', { status: 'json_ok' })
      : renderBanner('plano', {});
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
      if (artifactKind === 'json') {
        const jsonCheck = validateJsonArtifactFile(absolutePath);
        if (!jsonCheck.ok) {
          result = {
            gate: 'G1',
            status: 'blocked',
            artifact_path: artifactPath,
            bytes: stat.size,
            timestamp,
            banner: renderBanner('preflight_fail', { motivo: `json inválido: ${artifactPath}` }),
            error: `Artefato JSON inválido: ${artifactPath}`,
            cause: jsonCheck.error,
            next_action: 'corrigir_json_ou_regenerar_por_serializer',
          };
        } else {
          result = {
            gate: 'G1',
            status: 'passed',
            artifact_path: artifactPath,
            bytes: stat.size,
            parsed_type: jsonCheck.parsed_type,
            timestamp,
            banner: okBanner,
            next_action: 'avançar',
          };
        }
      } else {
        result = {
          gate: 'G1',
          status: 'passed',
          artifact_path: artifactPath,
          bytes: stat.size,
          timestamp,
          banner: okBanner,
          next_action: 'avançar',
        };
      }
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

function splitAcceptanceSections(content) {
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

  // §7.3 acceptance: `behavior` de AC com ambiguidade bloqueante (AC-1.2.2).
  const acceptanceLines = sections.section_7_aceite ?? [];
  const acceptanceText = acceptanceLines.map((entry) => entry.text).join('\n');
  if (/```ya?ml\b/i.test(acceptanceText) && /^\s*-?\s*id:\s*["']?AC-\d+/m.test(acceptanceText)) {
    const ambiguousRe = /^\s*behavior:\s*["']?.*\b(?:TBD|a confirmar|a definir|incompleto)\b/im;
    if (ambiguousRe.test(acceptanceText)) {
      const offender = acceptanceLines.find((entry) => ambiguousRe.test(entry.text)) ?? acceptanceLines[0];
      matches.push({
        section: SECTION_LABELS.section_7_aceite,
        pattern: 'behavior ambíguo',
        line: offender?.line ?? null,
        excerpt: offender?.text.trim().slice(0, 240) ?? '',
        reason: 'AC com `behavior` ambíguo (TBD/a confirmar) bloqueia planejamento.',
      });
    }
  }

  for (const [sectionKey, patterns] of Object.entries(ACCEPTANCE_PATTERNS)) {
    const lines = sections[sectionKey] ?? [];
    const sectionText = lines.map((line) => line.text).join('\n').trim();

    if (sectionKey === 'section_7_decisions') {
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
      // Q- aberta no contrato §7 também é ambiguidade bloqueante.
      if (/\bQ-\d+\b/.test(text) && !/\b(fechada|resolvida|done)\b/i.test(text)) {
        matches.push({
          section: SECTION_LABELS[sectionKey],
          pattern: 'Q- aberta',
          line,
          excerpt: text.trim().slice(0, 240),
          reason: 'Pergunta em aberto no contrato de produto bloqueia avanço.',
        });
      }
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

function scanAcceptance(args = {}) {
  const runId = validateRunId(args.run_id);
  const sprintPath = optionalString(args, 'sprint_path');
  const sprintMarkdown = optionalString(args, 'sprint_markdown');
  const timestamp = nowIso();

  // CN1/D8 (v0.16.0): o scan também aceita o rascunho em memória
  // (`sprint_markdown`), antes de o artefato existir em disco. Os dois
  // parâmetros são mutuamente exclusivos: aceitar ambos criaria ambiguidade
  // sobre qual conteúdo foi escaneado (regressão provável declarada na task 02.2).
  if (sprintPath !== undefined && sprintMarkdown !== undefined) {
    const result = {
      gate: 'G5',
      status: 'blocked',
      sprint_path: null,
      timestamp,
      blocking_count: 1,
      banner: renderBanner('aceite_lacunas', { n: 1 }),
      blocking_matches: [{
        section: 'argumentos',
        pattern: '(sprint_path e sprint_markdown juntos)',
        line: null,
        excerpt: '',
        reason: 'sprint_path e sprint_markdown são mutuamente exclusivos — informe exatamente um.',
      }],
      next_action: 'usar_um_dos_dois',
      error: 'Use exatamente um dos parâmetros: sprint_path ou sprint_markdown.',
    };
    patchGateResult(runId, 'G5', result, args);
    return result;
  }
  // Erro de argumento obrigatório existente (nada mudou para chamadas antigas):
  // sem path e sem markdown, ou path em branco, segue lançando `sprint_path
  // obrigatório`. `sprint_markdown` explicitamente vazio NÃO é "argumento ausente":
  // é rascunho vazio, e cai no ramo de arquivo vazio (`blocking_count: 1`,
  // `source: 'draft'`) — comportamento declarado na task 02.2.
  if (sprintMarkdown === undefined && (!sprintPath || sprintPath.trim() === '')) {
    requiredString(args, 'sprint_path');
  }

  const source = sprintMarkdown !== undefined ? 'draft' : 'file';
  const reportedPath = sprintPath ?? null;
  let content = null;
  let readError = null;
  if (sprintMarkdown !== undefined) {
    content = sprintMarkdown; // rascunho em memória: nada é gravado nem lido do disco
  } else {
    try {
      content = fs.readFileSync(resolveConsumerPath(sprintPath, args), 'utf8');
    } catch (error) {
      readError = error;
    }
  }

  let result;
  if (readError) {
    result = {
      gate: 'G5',
      status: 'blocked',
      sprint_path: reportedPath,
      source,
      timestamp,
      blocking_count: 1,
      banner: renderBanner('aceite_lacunas', { n: 1 }),
      blocking_matches: [{
        section: 'documento',
        pattern: '(read error)',
        line: null,
        excerpt: '',
        reason: `Sprint file ilegível: ${sprintPath}`,
      }],
      error: `Sprint file ausente ou ilegível: ${sprintPath}`,
      cause: readError.message,
      next_action: 'entrevista',
    };
  } else if (content.trim() === '') {
    result = {
      gate: 'G5',
      status: 'blocked',
      sprint_path: reportedPath,
      source,
      timestamp,
      blocking_count: 1,
      banner: renderBanner('aceite_lacunas', { n: 1 }),
      blocking_matches: [{
        section: 'documento',
        pattern: '(empty file)',
        line: null,
        excerpt: '',
        reason: 'Sprint file vazio não pode avançar como contrato pronto.',
      }],
      next_action: 'entrevista',
    };
  } else {
    const blockingMatches = scanSectionPatterns(splitAcceptanceSections(content));
    result = {
      gate: 'G5',
      status: blockingMatches.length === 0 ? 'passed' : 'blocked',
      sprint_path: reportedPath,
      source,
      timestamp,
      blocking_count: blockingMatches.length,
      banner: blockingMatches.length === 0
        ? renderBanner('aceite_ok', {})
        : renderBanner('aceite_lacunas', { n: blockingMatches.length }),
      blocking_matches: blockingMatches,
      next_action: blockingMatches.length === 0 ? 'avançar' : 'entrevista',
      message: blockingMatches.length === 0
        ? 'Ambiguity scan: 0 padrões bloqueantes — entrevista pulada'
        : 'Ambiguity scan: padrões bloqueantes encontrados — entrevista obrigatória',
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

function verifyPlanConformance(content, { requireSprintFile = false } = {}) {
  // §7 Slices só é obrigatória em `execution_mode: orchestrated-per-slice` (template).
  // Em `sequencial` a seção é dispensável — não force "§7 Não aplicável" só para passar
  // o gate (S1). Verdade forte = presença do literal orchestrated-per-slice no cabeçalho.
  const orchestratedPerSlice = /orchestrated-per-slice/i.test(content);
  const requiredSections = orchestratedPerSlice
    ? REQUIRED_PLAN_SECTIONS
    : REQUIRED_PLAN_SECTIONS.filter(([number]) => number !== '7');
  const pendencies = verifyRequiredSections(collectHeadings(content), requiredSections);

  if (!/\|\s*\*\*Sprint file\*\*\s*\|/i.test(content)) {
    pendencies.push(conformancePending(
      'sprint_file',
      'Sprint file',
      null,
      'Plano sem link/campo Sprint file no cabeçalho.',
      'vincular_sprint_file',
    ));
  }

  if (requireSprintFile) {
    if (!/\bEval\/Policy\b/i.test(content)) {
      pendencies.push(conformancePending(
        'eval_policy',
        'Eval/Policy',
        null,
        'Plano sem campo Eval/Policy nas tasks.',
        'vincular_eval_policy_nas_tasks',
      ));
    }
    if (!/\bEVAL-\d+\b/.test(content)) {
      pendencies.push(conformancePending(
        'eval_manifest',
        'EVAL-*',
        null,
        'Plano sem referência a EVAL-* do sprint file.',
        'referenciar_eval_manifest',
      ));
    }
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

  if (!/BOUNDARY_SPRINT_PLAN\.md/.test(content)) {
    pendencies.push(conformancePending(
      'boundary',
      'BOUNDARY_SPRINT_PLAN.md',
      null,
      'Plano sem referência à fronteira Sprint/PLAN.',
      'vincular_boundary',
    ));
  }

  return pendencies;
}

function verifyTemplateConformance(args = {}) {
  const runId = validateRunId(args.run_id);
  const artifactPath = requiredString(args, 'artifact_path');
  const artifactType = requiredString(args, 'artifact_type');
  if (!['plan'].includes(artifactType)) {
    throw rpcError(-32602, 'artifact_type inválido: use plan');
  }

  const requiredStatus = optionalString(args, 'required_status');
  const requireSprintFile = args.require_sprint_file === true;
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
      const pendencies = verifyPlanConformance(content, { requireSprintFile });
      result = {
        gate: 'template_conformance',
        status: pendencies.length === 0 ? 'passed' : 'blocked',
        artifact_type: artifactType,
        artifact_path: artifactPath,
        required_status: requiredStatus ?? null,
        require_sprint_file: requireSprintFile,
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
    if (error?.code === -32602) throw error;
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

function verifySprintFile(args = {}) {
  const runId = validateRunId(args.run_id);
  const sprintPath = requiredString(args, 'sprint_path');
  const sprintId = optionalString(args, 'sprint_id');
  const backlogPath = optionalString(args, 'backlog_path');
  const absolutePath = resolveConsumerPath(sprintPath, args);
  const timestamp = nowIso();
  let result;

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const extraPendencies = [];
    let backlogMarkdown = null;
    if (backlogPath) {
      try {
        backlogMarkdown = fs.readFileSync(resolveConsumerPath(backlogPath, args), 'utf8');
      } catch (error) {
        extraPendencies.push(conformancePending(
          'backlog_link',
          backlogPath,
          null,
          `Backlog mestre ausente ou ilegível: ${backlogPath}`,
          'corrigir_backlog_path',
        ));
      }
    }
    const validation = content.trim() === ''
      ? {
        valid: false,
        pending_count: 1,
        premissa_count: 0,
        pendencies: [conformancePending('documento', 'arquivo_vazio', null, 'Sprint file vazio não pode passar.', 'preencher_sprint_file')],
      }
      : validateSprintFileConformance(content, {
        sprintPath,
        sprintId,
        backlogPath,
        backlogMarkdown,
        // D5 (v0.16.0): root do consumidor para resolver `derivado:<path>`.
        root: consumerRoot(args),
      });
    const pendencies = [...validation.pendencies, ...extraPendencies];
    result = {
      gate: 'sprint_file_conformance',
      status: pendencies.length === 0 ? 'passed' : 'blocked',
      sprint_path: sprintPath,
      sprint_id: sprintId ?? null,
      backlog_path: backlogPath ?? null,
      timestamp,
      pending_count: pendencies.length,
      // D6 (v0.16.0): contagem de `premissa` sempre presente, inclusive zero.
      premissa_count: validation.premissa_count ?? 0,
      banner: pendencies.length === 0
        ? renderBanner('plano', {})
        : renderBanner('preflight_fail', { motivo: `sprint file: ${pendencies.length} pendências` }),
      pendencies,
      next_action: pendencies.length === 0 ? 'avançar' : pendencies[0].next_action,
    };
  } catch (error) {
    result = {
      gate: 'sprint_file_conformance',
      status: 'blocked',
      sprint_path: sprintPath,
      sprint_id: sprintId ?? null,
      backlog_path: backlogPath ?? null,
      timestamp,
      pending_count: 1,
      banner: renderBanner('preflight_fail', { motivo: 'sprint file: artefato ilegível' }),
      pendencies: [conformancePending(
        'leitura',
        sprintPath,
        null,
        `Sprint file ausente ou ilegível: ${sprintPath}`,
        'corrigir_sprint_file_path',
      )],
      error: `Sprint file ausente ou ilegível: ${sprintPath}`,
      cause: error.message,
      next_action: 'corrigir_sprint_file_path',
    };
  }

  patchGateResult(runId, 'sprint_file_conformance', result, args);
  return result;
}

function cleanBacklogPathToken(value) {
  if (!value || value === '—') return '';
  const link = /\[[^\]]+\]\(([^)]+)\)/.exec(value);
  const raw = link ? link[1] : value;
  return raw.replace(/^["'`]+|["'`]+$/g, '').trim();
}

function pendingPathToken(value) {
  const cleaned = cleanBacklogPathToken(value);
  return !cleaned || /^\[/.test(cleaned) || /^pendente$/i.test(cleaned) || /^pending$/i.test(cleaned);
}

function sprintDeps(value) {
  if (!value || value === '—') return [];
  return [...new Set([...String(value).matchAll(SPRINT_DEP_RE)].map((match) => match[0]))];
}

function sprintMetadataValue(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'im').exec(markdown);
  return match ? match[1].trim() : null;
}

function sprintDorStatus(markdown) {
  const match = /^\*\*Status DoR:\*\*\s*\[?([^\]\n]+)\]?/im.exec(markdown);
  return match ? match[1].trim().toLowerCase() : null;
}

function detectBacklogCycle(rows) {
  const graph = new Map(rows.map((row) => [row.id, sprintDeps(row.dependencies)]));
  const visiting = new Set();
  const visited = new Set();
  const walk = (id, chain = []) => {
    if (visiting.has(id)) return [...chain.slice(chain.indexOf(id)), id];
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) {
      const cycle = walk(dep, [...chain, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };
  for (const id of graph.keys()) {
    const cycle = walk(id);
    if (cycle) return cycle;
  }
  return null;
}

function backlogIndexBasePendencies(markdown, rows) {
  const pendencies = [];
  if (!/^##\s+7\.\s+Registro de sprints\s*$/im.test(markdown)) {
    pendencies.push(conformancePending('seção_obrigatória', '§7 Registro de sprints', null, 'Backlog sem seção §7 Registro de sprints.', 'corrigir_backlog_index'));
  }
  if (rows.length === 0) {
    pendencies.push(conformancePending('registro_sprints', 'linhas', null, 'Backlog sem linhas de sprint válidas.', 'preencher_registro_sprints'));
    return pendencies;
  }
  const seen = new Set();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (seen.has(row.id)) {
      pendencies.push(conformancePending('registro_sprints', row.id, null, `Sprint duplicada no backlog: ${row.id}.`, 'corrigir_ids_sprint'));
    }
    seen.add(row.id);
    for (const [field, allowed] of [
      ['moscow', BACKLOG_MOSCOW],
      ['gain', BACKLOG_LEVEL],
      ['effort', BACKLOG_LEVEL],
      ['priority', BACKLOG_PRIORITY],
      ['state', BACKLOG_STATES],
    ]) {
      if (!allowed.has(row[field])) {
        pendencies.push(conformancePending('registro_sprints', `${row.id}.${field}`, null, `Enum inválido em ${row.id}.${field}: ${row[field] ?? '<ausente>'}.`, 'corrigir_backlog_index'));
      }
    }
    if (pendingPathToken(row.sprint_file)) {
      pendencies.push(conformancePending('sprint_file', row.id, null, `Linha ${row.id} não aponta Sprint file real.`, 'preencher_sprint_file_no_backlog'));
    }
    for (const dep of sprintDeps(row.dependencies)) {
      if (!byId.has(dep)) {
        pendencies.push(conformancePending('dependência', `${row.id}->${dep}`, null, `Dependência interna ausente: ${row.id} depende de ${dep}.`, 'corrigir_dependencias_backlog'));
      }
    }
  }
  const cycle = detectBacklogCycle(rows);
  if (cycle) {
    pendencies.push(conformancePending('dependência', cycle.join('>'), null, `Ciclo de dependência entre sprints: ${cycle.join(' > ')}.`, 'quebrar_ciclo_dependencias'));
  }
  if (/\[(?:NOME_|RESULTADO_|objetivo curto|slug)\]/i.test(markdown)) {
    pendencies.push(conformancePending('placeholder', 'template', null, 'Backlog contém placeholder estrutural não resolvido.', 'preencher_backlog_template'));
  }
  return pendencies;
}

function inspectBacklogIndex(args = {}) {
  const backlogPath = requiredString(args, 'backlog_path');
  const backlogMarkdown = fs.readFileSync(resolveConsumerPath(backlogPath, args), 'utf8');
  const rows = parseSprintRows(backlogMarkdown);
  const pendencies = backlogIndexBasePendencies(backlogMarkdown, rows);
  const sprints = [];
  for (const row of rows) {
    const sprintPath = cleanBacklogPathToken(row.sprint_file);
    const info = {
      id: row.id,
      state: row.state,
      moscow: row.moscow,
      gain: row.gain,
      effort: row.effort,
      priority: row.priority,
      dependencies: sprintDeps(row.dependencies),
      sprint_file: sprintPath || null,
      sprint_file_status: pendingPathToken(row.sprint_file) ? 'missing' : 'unread',
      dor_status: null,
      // prd: coluna legado posicional do backlog (compat); aceite mora no §7.
      prd: cleanBacklogPathToken(row.prd) || null,
      plan: cleanBacklogPathToken(row.plan) || null,
      state_file: cleanBacklogPathToken(row.state_file) || null,
      // D2/D20 (Plano 5): flag de revalidação (coluna 15) — projeção observável.
      revalidation_required: row.revalidation_required === true,
      contrato_status: null,
      contrato_sealed: false,
    };
    if (!pendingPathToken(row.sprint_file)) {
      try {
        const sprintMarkdown = fs.readFileSync(resolveConsumerPath(sprintPath, args), 'utf8');
        const validation = validateSprintFileConformance(sprintMarkdown, {
          sprintPath,
          sprintId: row.id,
          backlogPath,
          backlogMarkdown,
          // D5 (v0.16.0): root do consumidor — sem root, a resolução de
          // `derivado:<path>` ficaria inerte aqui e o gate de backlog daria
          // veredicto diferente do gate de sprint para o mesmo artefato.
          root: consumerRoot(args),
        });
        const sprintStatus = sprintMetadataValue(sprintMarkdown, 'Status');
        info.sprint_file_status = validation.valid ? 'valid' : 'invalid';
        info.pending_count = validation.pending_count;
        info.premissa_count = validation.premissa_count ?? 0;
        info.dor_status = sprintDorStatus(sprintMarkdown);
        info.contrato_status = sprintMetadataValue(sprintMarkdown, 'Contrato status');
        const seal = validateAcceptanceSeal(sprintMarkdown);
        info.contrato_sealed = seal.sealed && !seal.tampered;
        if (sprintStatus && sprintStatus !== row.state) {
          pendencies.push(conformancePending('status_drift', row.id, null, `Status divergente em ${row.id}: backlog=${row.state}, sprint_file=${sprintStatus}.`, 'sincronizar_status_backlog_sprint'));
        }
        for (const pendency of validation.pendencies ?? []) {
          pendencies.push(conformancePending('sprint_file', `${row.id}:${pendency.category}:${pendency.item}`, pendency.line ?? null, pendency.message, pendency.next_action));
        }
      } catch (error) {
        info.sprint_file_status = 'missing';
        pendencies.push(conformancePending('sprint_file', row.id, null, `Sprint file ausente ou ilegível para ${row.id}: ${sprintPath}.`, 'corrigir_sprint_file_path'));
      }
    }
    sprints.push(info);
  }
  const premissaCount = sprints.reduce((sum, info) => sum + (info.premissa_count ?? 0), 0);
  return { backlog_path: backlogPath, rows, sprints, pendencies, premissa_count: premissaCount };
}

function verifyBacklogIndex(args = {}) {
  const runId = validateRunId(args.run_id);
  const backlogPath = requiredString(args, 'backlog_path');
  const timestamp = nowIso();
  let result;
  try {
    const index = inspectBacklogIndex(args);
    // D6 (v0.16.0): `premissa_count` agrega as decisões do backlog (tabela
    // `### Decisões bloqueantes`) e as contagens por sprint do índice.
    const backlogMarkdown = fs.readFileSync(resolveConsumerPath(backlogPath, args), 'utf8');
    const backlogDecisionPremissas = parseDecisionRows(backlogMarkdown)
      .filter((row) => row.origin === 'premissa').length;
    result = {
      gate: 'backlog_index_conformance',
      status: index.pendencies.length === 0 ? 'passed' : 'blocked',
      backlog_path: backlogPath,
      timestamp,
      sprint_count: index.sprints.length,
      pending_count: index.pendencies.length,
      premissa_count: backlogDecisionPremissas + (index.premissa_count ?? 0),
      sprints: index.sprints,
      pendencies: index.pendencies,
      banner: index.pendencies.length === 0
        ? renderBanner('preflight_ok', { caps: 'backlog_index' })
        : renderBanner('preflight_fail', { motivo: `backlog index: ${index.pendencies.length} pendências` }),
      next_action: index.pendencies.length === 0 ? 'avançar' : index.pendencies[0].next_action,
    };
  } catch (error) {
    result = {
      gate: 'backlog_index_conformance',
      status: 'blocked',
      backlog_path: backlogPath,
      timestamp,
      sprint_count: 0,
      pending_count: 1,
      sprints: [],
      pendencies: [conformancePending('leitura', backlogPath, null, `Backlog mestre ausente ou ilegível: ${backlogPath}`, 'corrigir_backlog_path')],
      banner: renderBanner('preflight_fail', { motivo: 'backlog index: artefato ilegível' }),
      error: `Backlog mestre ausente ou ilegível: ${backlogPath}`,
      cause: error.message,
      next_action: 'corrigir_backlog_path',
    };
  }
  patchGateResult(runId, 'backlog_index', result, args);
  return result;
}

function depsSatisfied(row, byId) {
  const unmet = [];
  for (const dep of sprintDeps(row.dependencies)) {
    const depRow = byId.get(dep);
    // D5/D23: manual_validation_pending satisfaz DEP (só done não bloqueia a
    // cadeia — LEG3 morto). Flag de revalidação (Plano 5) é ignorada aqui.
    if (!depRow || (depRow.state !== 'done' && depRow.state !== 'manual_validation_pending')) {
      unmet.push({ id: dep, state: depRow?.state ?? 'missing' });
    }
  }
  return unmet;
}

// D2/D20 (Plano 5 / CN4): fecho transitivo de `Depende de` a partir das origens
// com `M` falho. Dependentes diretos e indiretos ganham a flag
// `revalidation_required` (coluna 15 do backlog); a origem fica `blocked` sem
// flag (CN4: só dependentes são marcados); sprints independentes não são
// tocadas (AC-5.2.1). Retorna o Set de ids flagados — a escrita da célula fica
// com o chamador via `replaceBacklogSprintRow` (escrita absoluta: montar a
// lista final completa com 16 células, preservando os índices 0–14).
function propagateRevalidation(rows, originIds) {
  const flagged = new Set();
  const queue = [...originIds];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const row of rows) {
      if (row.id !== current && !flagged.has(row.id) && sprintDeps(row.dependencies).includes(current)) {
        flagged.add(row.id);
        queue.push(row.id);
      }
    }
  }
  return flagged;
}

function sprintSortKey(info) {
  return [
    MOSCOW_RANK.get(info.moscow) ?? 99,
    PRIORITY_RANK.get(info.priority) ?? 99,
    GAIN_RANK.get(info.gain) ?? 99,
    EFFORT_RANK.get(info.effort) ?? 99,
    info.id,
  ];
}

function compareSprintCandidates(a, b) {
  const ak = sprintSortKey(a);
  const bk = sprintSortKey(b);
  for (let i = 0; i < ak.length; i += 1) {
    if (ak[i] < bk[i]) return -1;
    if (ak[i] > bk[i]) return 1;
  }
  return 0;
}

/**
 * Próxima ação canônica pós-seleção (pipeline 0.14+), mode-aware:
 * - §7 draft / sem selo → sprint_interview (qualquer modo)
 * - interview-only → sprint_interview (mesmo com §7 selado)
 * - direct + §7 selado → plan_execute (direct_execute; sem plan_handoff)
 * - full/execute + PLAN real → plan_execute
 * - full/execute + §7 selado sem PLAN → plan_handoff
 * Verbos alinhados a WORKFLOW_CONFIG / expectedNextPhase. Nunca `gerar_prd`.
 */
function nextActionForSelectedSprint(info, mode = 'full') {
  const sealed = /^aprovado$/i.test(info?.contrato_status ?? '') && info?.contrato_sealed === true;
  const hasPlan = Boolean(info?.plan && !pendingPathToken(info.plan));

  if (!sealed || mode === 'interview-only') return 'sprint_interview';
  if (mode === 'direct') return 'plan_execute';
  if (hasPlan) return 'plan_execute';
  return 'plan_handoff';
}

function derivedSprintGateStatus(status, validatorVerdict) {
  if (status === 'done') return `validator:${validatorVerdict}`;
  if (status === 'manual_validation_pending') return `validator:${validatorVerdict};manual_pending`;
  if (status === 'review') return 'validator:pending';
  if (status === 'doing') return 'exec:running';
  if (status === 'blocked') return validatorVerdict === 'fail' ? 'validator:fail' : 'blocked';
  if (status === 'ready') return 'ready';
  return '—';
}

function assertSprintStatusTransition(from, to, allowReopenDone = false) {
  if (!BACKLOG_STATES.has(to)) {
    return conformancePending('status', to, null, `Status inválido: ${to}.`, 'usar_status_valido');
  }
  if (from === 'done' && to !== 'done' && allowReopenDone !== true) {
    return conformancePending('status_transition', `${from}->${to}`, null, 'Sprint done não pode ser reaberta sem allow_reopen_done=true.', 'criar_nova_sprint_ou_autorizar_reabertura');
  }
  if (!SPRINT_STATUS_TRANSITIONS[from]?.has(to) && !(allowReopenDone === true && from === 'done')) {
    return conformancePending('status_transition', `${from}->${to}`, null, `Transição de status inválida: ${from} -> ${to}.`, 'corrigir_fluxo_status_sprint');
  }
  return null;
}

function replaceMarkdownTableValue(markdown, label, value) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(\\|\\s*${escaped}\\s*\\|\\s*)(.*?)(\\s*\\|\\s*)$`, 'im');
  if (!re.test(markdown)) return markdown;
  return markdown.replace(re, `$1${value}$3`);
}

function replaceBacklogSprintRow(markdown, sprintId, updater) {
  const lines = markdown.split(/\r?\n/);
  let updated = false;
  const next = lines.map((line) => {
    if (updated || !new RegExp(`^\\|\\s*${sprintId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`).test(line)) {
      return line;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const replaced = updater(cells);
    updated = true;
    return `| ${replaced.join(' | ')} |`;
  });
  return { markdown: next.join('\n'), updated };
}

function appendToMarkdownSectionTable(markdown, sectionRe, rowCells) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => sectionRe.test(line));
  if (start < 0) return markdown;
  let insertAt = start + 1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    if (/^\|.*\|\s*$/.test(lines[i])) insertAt = i + 1;
  }
  lines.splice(insertAt, 0, `| ${rowCells.join(' | ')} |`);
  return lines.join('\n');
}

function deriveHandoffSlugFromSprintPath(sprintFilePath) {
  const basename = path.basename(sprintFilePath, '.md');
  const withoutPrefix = basename.startsWith('SPRINT_') ? basename.slice('SPRINT_'.length) : basename;
  return withoutPrefix.toLowerCase();
}

function formatHandoffFileDate(timestamp) {
  return timestamp.slice(0, 10).replace(/-/g, '');
}

function emitMemoryHandoff({
  projectRoot,
  sprintId,
  sprintFilePath,
  validatorVerdict,
  statePath = null,
  planPath = null,
  timestamp = nowIso(),
}) {
  const templateRel = '.talos/memory/HANDOFF_TEMPLATE.md';
  const templateAbs = path.resolve(projectRoot, templateRel);
  if (!fs.existsSync(templateAbs)) {
    return { ok: false, reason: 'template_missing' };
  }

  const slug = deriveHandoffSlugFromSprintPath(sprintFilePath);
  const dateStr = timestamp.slice(0, 10);
  const handoffFileName = `HANDOFF_${slug}_${formatHandoffFileDate(timestamp)}.md`;
  const handoffRel = `.talos/memory/${handoffFileName}`;
  const handoffAbs = path.resolve(projectRoot, handoffRel);

  let content = fs.readFileSync(templateAbs, 'utf8');
  content = replaceMarkdownTableValue(content, 'sprint_id', sprintId);
  content = replaceMarkdownTableValue(content, 'data', dateStr);
  content = replaceMarkdownTableValue(content, 'status_pos_validator', validatorVerdict);
  content = replaceMarkdownTableValue(content, 'origem', 'talos_update_sprint_status');

  const contextBlock = [
    '## Contexto da entrega',
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| state_path | \`${statePath ?? '—'}\` |`,
    `| plan_path | \`${planPath ?? '—'}\` |`,
    '',
  ].join('\n');
  content = content.replace(
    /(\n---\n\n)(## Regras do filtro)/,
    `\n---\n\n${contextBlock}\n---\n\n$2`,
  );

  const candidatesText = '0 candidatos — nenhum fato durável promovido automaticamente. Sucesso.';
  content = content.replace(
    /## Candidatos \(0–3\)[\s\S]*?(?=\n## Exemplos)/,
    `## Candidatos (0–3)\n\n${candidatesText}\n\n`,
  );

  fs.mkdirSync(path.dirname(handoffAbs), { recursive: true });
  fs.writeFileSync(handoffAbs, content);
  return { ok: true, handoff_path: handoffRel };
}

function updatedSprintMarkdown(markdown, {
  status,
  planPath = null,
  statePath = null,
  evidence = null,
  validatorVerdict = 'not_run',
  timestamp,
  revalidation = null,
}) {
  let next = replaceMarkdownTableValue(markdown, 'Status', status);
  // prd_path não grava mais metadado no sprint (template 0.14 removeu campo PRD).
  if (planPath) next = replaceMarkdownTableValue(next, 'PLAN', planPath);
  if (statePath) next = replaceMarkdownTableValue(next, 'State / evidência', statePath);
  // D2 (Plano 5): metadado `Revalidação` sync no sprint file quando o MCP
  // escreve a flag (limpa na revalidação concluída). Sprint file legado sem o
  // campo: replace é no-op (sem drift).
  if (revalidation !== null) next = replaceMarkdownTableValue(next, 'Revalidação', revalidation ? 'true' : 'false');
  const evidenceText = evidence || statePath || validatorVerdict;
  next = appendToMarkdownSectionTable(next, /^##\s+14\.\s+Execução e validação\s*$/i, [
    'Sprint status update',
    derivedSprintGateStatus(status, validatorVerdict),
    evidenceText,
  ]);
  next = appendToMarkdownSectionTable(next, /^##\s+16\.\s+Histórico\s*$/i, [
    timestamp.slice(0, 10),
    'Talos MCP',
    `Status -> ${status}; validator=${validatorVerdict}; evidence=${evidenceText}`,
  ]);
  return next;
}

// D5/D23 + A6 (fechamento Plano F): lê acceptance_results do state v3 apontado
// por state_path. Retorno { results: array|null } — null quando ausente/ilegível
// ou quando o state não é v3 (LEG2: side-path do status não pode aceitar v1/v2).
// `done` e `manual_validation_pending` exigem o campo presente (SKILL
// SPRINT_STATUS_SYNC / objetivo da trilha: sem prova de AC não há done+handoff).
function readStateAcceptanceResults(statePath, args) {
  if (!statePath) return { results: null };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(resolveConsumerPath(statePath, args), 'utf8'));
  } catch {
    return { results: null };
  }
  const version = Number(state?.state_schema_version ?? 1);
  if (version !== 3) return { results: null };
  return { results: Array.isArray(state?.acceptance_results) ? state.acceptance_results : null };
}

function updateSprintStatus(args = {}) {
  const runId = validateRunId(args.run_id);
  const backlogPath = requiredString(args, 'backlog_path');
  const sprintId = requiredString(args, 'sprint_id');
  const status = requiredString(args, 'status');
  const validatorVerdict = args.validator_verdict ?? 'not_run';
  const timestamp = nowIso();
  let result;
  const pendencies = [];
  if (!/^S\d{2}(?:[a-z]|\.\d+)?$/.test(sprintId)) {
    pendencies.push(conformancePending('sprint_id', sprintId, null, `Sprint ID inválido: ${sprintId}.`, 'usar_sprint_id_valido'));
  }
  if (!BACKLOG_STATES.has(status)) {
    pendencies.push(conformancePending('status', status, null, `Status inválido: ${status}.`, 'usar_status_valido'));
  }
  if (!VALIDATOR_VERDICTS.has(validatorVerdict)) {
    pendencies.push(conformancePending('validator_verdict', validatorVerdict, null, `Veredito inválido: ${validatorVerdict}.`, 'usar_veredito_valido'));
  }
  if (status === 'done' && !TERMINAL_VALIDATOR_VERDICTS.has(validatorVerdict)) {
    pendencies.push(conformancePending('validator_verdict', 'done', null, 'Status done exige validator_verdict pass ou pass_with_observations.', 'rodar_validator_frio'));
  }
  if (status === 'done' && !args.state_path) {
    pendencies.push(conformancePending('state_path', 'done', null, 'Status done exige state_path como evidência.', 'informar_state_path'));
  }
  // D5/D23: manual_validation_pending é status terminal de validação (não done).
  // Exige veredito terminal do validator — o M aberto não dispensa a prova automática.
  if (status === 'manual_validation_pending' && !TERMINAL_VALIDATOR_VERDICTS.has(validatorVerdict)) {
    pendencies.push(conformancePending('validator_verdict', 'manual_validation_pending', null, 'Status manual_validation_pending exige validator_verdict pass ou pass_with_observations.', 'rodar_validator_frio'));
  }
  if (status === 'manual_validation_pending' && !args.state_path) {
    pendencies.push(conformancePending('state_path', 'manual_validation_pending', null, 'Status manual_validation_pending exige state_path como evidência.', 'informar_state_path'));
  }
  try {
    const backlogAbs = resolveConsumerPath(backlogPath, args);
    const backlogBefore = fs.readFileSync(backlogAbs, 'utf8');
    const rows = parseSprintRows(backlogBefore);
    const row = rows.find((entry) => entry.id === sprintId);
    if (!row) {
      pendencies.push(conformancePending('backlog_index', sprintId, null, `Backlog não contém sprint ${sprintId}.`, 'corrigir_backlog_index'));
    } else {
      const transitionPending = assertSprintStatusTransition(row.state, status, args.allow_reopen_done === true);
      if (transitionPending) pendencies.push(transitionPending);
      if (pendingPathToken(row.sprint_file)) {
        pendencies.push(conformancePending('sprint_file', sprintId, null, `Linha ${sprintId} não aponta Sprint file real.`, 'preencher_sprint_file_no_backlog'));
      }
    }
    // D5/D23 + A6 (fechamento Plano F): gate de aceite por estado.
    // acceptance_results moram no state v3 (eco do oráculo classifyAcceptanceResults —
    // VC5; o validator emite no packet e o MCP persiste o eco no complete).
    // `done` e `manual_validation_pending` exigem o campo presente — SKILL
    // SPRINT_STATUS_SYNC e o objetivo da trilha: sem prova de AC não há done+handoff.
    // (Plano 3 tinha "quando presentes" para done; o fechamento removeu o escape
    // porque a superfície declarativa e o runtime divergiam — A6 P1.)
    if (status === 'done' || status === 'manual_validation_pending') {
      const acceptance = readStateAcceptanceResults(args.state_path, args);
      // D2/D10/D20 (Plano 5): `revalidation_required` é flag, não status (INV4 —
      // AC-5.1.1). done fica bloqueado enquanto a flag estiver ligada e os AC-*
      // afetados não forem revalidados (state com acceptance_results todos
      // proved = revalidação concluída com provas verdes — AC-5.1.2). Sem state
      // de aceite legível, a flag bloqueia (fail-closed).
      if (status === 'done' && row?.revalidation_required) {
        const revalidated = Array.isArray(acceptance.results) && acceptance.results.length > 0
          && acceptance.results.every((item) => item?.status === 'proved');
        if (!revalidated) {
          pendencies.push(conformancePending(
            'revalidation_required',
            sprintId,
            null,
            'Sprint com Revalidação pendente (dependente de sprint com M falho): done exige revalidação dos AC-* afetados com provas verdes.',
            'revalidar_aceite_afetado',
          ));
        }
      }
      if (status === 'done') {
        if (!Array.isArray(acceptance.results)) {
          pendencies.push(conformancePending(
            'acceptance_results',
            sprintId,
            null,
            'Status done exige acceptance_results no state (todos AC proved; sem M/unproved/violated).',
            'emitir_acceptance_results_no_state',
          ));
        } else {
          const blockers = acceptance.results.filter((item) => item?.status !== 'proved');
          if (blockers.length > 0) {
            pendencies.push(conformancePending(
              'acceptance_results',
              sprintId,
              null,
              `Status done exige todos os AC proved; bloqueado por: ${blockers.map((b) => `${b.id}:${b.status}`).join(', ')} (M aberto ou prova pendente).`,
              'resolver_aceite_ou_avancar_manual_validation_pending',
            ));
          }
        }
      }
      if (status === 'manual_validation_pending') {
        if (!Array.isArray(acceptance.results)) {
          pendencies.push(conformancePending(
            'acceptance_results',
            sprintId,
            null,
            'Status manual_validation_pending exige acceptance_results no state (≥1 AC não provado, sem violated).',
            'emitir_acceptance_results_no_state',
          ));
        } else {
          const violated = acceptance.results.filter((item) => item?.status === 'violated');
          if (violated.length > 0) {
            pendencies.push(conformancePending(
              'acceptance_results',
              sprintId,
              null,
              `manual_validation_pending exige sem violated; bloqueado por: ${violated.map((b) => `${b.id}:${b.status}`).join(', ')}.`,
              'resolver_violacoes_de_aceite',
            ));
          }
          const pendingAcs = acceptance.results.filter((item) => item?.status === 'manual_pending' || item?.status === 'unproved');
          if (pendingAcs.length === 0) {
            pendencies.push(conformancePending(
              'acceptance_results',
              sprintId,
              null,
              'manual_validation_pending exige pelo menos 1 AC não-provado (manual_pending ou unproved).',
              'usar_done_quando_sem_validacao_manual',
            ));
          }
        }
      }
    }
    if (pendencies.length > 0) {
      throw new Error('update_sprint_status_precondition_failed');
    }

    const sprintPath = cleanBacklogPathToken(row.sprint_file);
    const sprintAbs = resolveConsumerPath(sprintPath, args);
    const sprintBefore = fs.readFileSync(sprintAbs, 'utf8');
    // D10 (Plano 5): done só avança com a flag ligada quando a revalidação foi
    // observada (todos os AC proved — gate acima); nesse caso a flag é limpa.
    const clearRevalidation = status === 'done' && row.revalidation_required === true;
    const nextBacklog = replaceBacklogSprintRow(backlogBefore, sprintId, (cells) => {
      const nextCells = [...cells];
      // Coluna PRD (índice 8): legado posicional — só atualiza se o caller passar prd_path.
      nextCells[8] = args.prd_path ?? nextCells[8];
      nextCells[10] = status;
      nextCells[11] = args.gate_status ?? derivedSprintGateStatus(status, validatorVerdict);
      nextCells[13] = args.plan_path ?? nextCells[13];
      nextCells[14] = args.state_path ?? nextCells[14];
      // D6 (Plano 5): `replaceBacklogSprintRow` é escrita absoluta — montar a
      // lista final completa com 16 células; Revalidação vive na coluna 15
      // (fim do índice), preservada ou limpa na revalidação concluída.
      while (nextCells.length < 16) nextCells.push('');
      if (clearRevalidation) nextCells[15] = '';
      return nextCells;
    });
    if (!nextBacklog.updated) {
      pendencies.push(conformancePending('backlog_index', sprintId, null, `Linha ${sprintId} não atualizada no backlog.`, 'corrigir_backlog_index'));
      throw new Error('update_sprint_status_row_not_updated');
    }
    const nextSprint = updatedSprintMarkdown(sprintBefore, {
      status,
      planPath: args.plan_path,
      statePath: args.state_path,
      evidence: args.evidence,
      validatorVerdict,
      timestamp,
      // D2: metadado sync no sprint file (flag limpa na revalidação concluída).
      revalidation: clearRevalidation ? false : null,
    });
    const sprintValidation = validateSprintFileConformance(nextSprint, {
      sprintPath,
      sprintId,
      backlogPath,
      backlogMarkdown: nextBacklog.markdown,
    });
    const backlogRowsAfter = parseSprintRows(nextBacklog.markdown);
    pendencies.push(...backlogIndexBasePendencies(nextBacklog.markdown, backlogRowsAfter));
    for (const pendency of sprintValidation.pendencies ?? []) {
      pendencies.push(conformancePending('sprint_file', `${sprintId}:${pendency.category}:${pendency.item}`, pendency.line ?? null, pendency.message, pendency.next_action));
    }
    if (pendencies.length > 0) {
      throw new Error('update_sprint_status_postcondition_failed');
    }

    const needsHandoff = status === 'done' && TERMINAL_VALIDATOR_VERDICTS.has(validatorVerdict);
    // Fail-fast: template ausente bloqueia ANTES de qualquer write (sem drift).
    if (needsHandoff) {
      const templateAbs = path.resolve(consumerRoot(args), '.talos/memory/HANDOFF_TEMPLATE.md');
      if (!fs.existsSync(templateAbs)) {
        pendencies.push(conformancePending(
          'handoff_emit',
          sprintId,
          null,
          'HANDOFF_TEMPLATE.md ausente — emit bloqueado.',
          'restaurar_handoff_template',
        ));
        throw new Error('update_sprint_status_handoff_emit_failed');
      }
    }

    // Escrita com rollback (P2): backlog primeiro; se o sprint file falhar (erro de
    // FS real — EACCES/ENOSPC), restaura o backlog ao estado original para não deixar
    // drift backlog↔sprint. Ou ambos escritos, ou nenhum efeito visível.
    // Handoff após writes: se emit falhar, restaura backlog+sprint (atomicidade P2).
    fs.writeFileSync(backlogAbs, nextBacklog.markdown);
    try {
      fs.writeFileSync(sprintAbs, nextSprint);
    } catch (writeError) {
      fs.writeFileSync(backlogAbs, backlogBefore);
      throw writeError;
    }

    let handoffPath = null;
    if (needsHandoff) {
      let handoff;
      try {
        handoff = emitMemoryHandoff({
          projectRoot: consumerRoot(args),
          sprintId,
          sprintFilePath: sprintPath,
          validatorVerdict,
          statePath: args.state_path ?? null,
          planPath: args.plan_path ?? null,
          timestamp,
        });
      } catch (emitError) {
        fs.writeFileSync(backlogAbs, backlogBefore);
        fs.writeFileSync(sprintAbs, sprintBefore);
        throw emitError;
      }
      if (!handoff.ok) {
        fs.writeFileSync(backlogAbs, backlogBefore);
        fs.writeFileSync(sprintAbs, sprintBefore);
        pendencies.push(conformancePending(
          'handoff_emit',
          sprintId,
          null,
          'HANDOFF_TEMPLATE.md ausente — emit bloqueado.',
          'restaurar_handoff_template',
        ));
        throw new Error('update_sprint_status_handoff_emit_failed');
      }
      handoffPath = handoff.handoff_path;
    }

    result = {
      gate: 'update_sprint_status',
      status: 'passed',
      backlog_path: backlogPath,
      sprint_id: sprintId,
      sprint_file_path: sprintPath,
      previous_status: row.state,
      next_status: status,
      validator_verdict: validatorVerdict,
      timestamp,
      pending_count: 0,
      pendencies: [],
      banner: renderBanner('preflight_ok', { caps: `sprint_status=${sprintId}:${status}` }),
      next_action: status === 'done'
        ? (handoffPath ? 'promover_handoff' : 'selecionar_proxima_sprint')
        : status === 'manual_validation_pending'
          ? 'aguardar_validacao_manual'
          : 'continuar_pipeline',
      ...(handoffPath ? { handoff_path: handoffPath } : {}),
    };
  } catch (error) {
    result = {
      gate: 'update_sprint_status',
      status: 'blocked',
      backlog_path: backlogPath,
      sprint_id: sprintId,
      next_status: status,
      validator_verdict: validatorVerdict,
      timestamp,
      pending_count: pendencies.length || 1,
      pendencies: pendencies.length > 0 ? pendencies : [
        conformancePending('leitura', sprintId, null, `Não foi possível atualizar status da sprint ${sprintId}: ${error.message}`, 'corrigir_backlog_ou_sprint_file'),
      ],
      banner: renderBanner('preflight_fail', { motivo: `update sprint status: ${pendencies.length || 1} pendências` }),
      error: `Não foi possível atualizar status da sprint ${sprintId}.`,
      cause: error.message,
      next_action: pendencies[0]?.next_action ?? 'corrigir_backlog_ou_sprint_file',
    };
  }
  patchGateResult(runId, 'update_sprint_status', result, args);
  return result;
}

function selectNextSprint(args = {}) {
  const runId = validateRunId(args.run_id);
  const backlogPath = requiredString(args, 'backlog_path');
  const mode = typeof args.mode === 'string' && args.mode.trim() ? args.mode.trim() : 'full';
  const timestamp = nowIso();
  let result;
  try {
    const index = inspectBacklogIndex(args);
    const rowsById = new Map(index.rows.map((row) => [row.id, row]));
    const candidates = [];
    const rejected = [];
    for (const info of index.sprints) {
      const row = rowsById.get(info.id);
      const unmet = depsSatisfied(row, rowsById);
      const reasons = [];
      if (info.state !== 'ready') reasons.push(`state=${info.state}`);
      if (unmet.length > 0) reasons.push(`unmet_dependencies=${unmet.map((dep) => `${dep.id}:${dep.state}`).join(',')}`);
      if (info.sprint_file_status !== 'valid') reasons.push(`sprint_file=${info.sprint_file_status}`);
      if (info.dor_status !== 'verde') reasons.push(`dor=${info.dor_status ?? 'ausente'}`);
      if (reasons.length === 0) candidates.push(info);
      else rejected.push({ id: info.id, reasons });
    }
    candidates.sort(compareSprintCandidates);
    const selected = candidates[0] ?? null;
    const structuralPendencies = index.pendencies.filter((p) => p.category !== 'status_drift');
    const blocked = structuralPendencies.length > 0 || !selected;
    result = {
      gate: 'select_next_sprint',
      status: blocked ? 'blocked' : 'passed',
      backlog_path: backlogPath,
      timestamp,
      selected: selected ? {
        sprint_id: selected.id,
        sprint_file_path: selected.sprint_file,
        // Legado posicional do backlog; null/`—` é o esperado pós-0.14. Aceite = §7.
        prd_path: selected.prd,
        plan_path: selected.plan,
        state_path: selected.state_file,
        contrato_status: selected.contrato_status,
        contrato_sealed: selected.contrato_sealed === true,
        reason: 'ready + deps done/manual_validation_pending + sprint file válido + DoR verde + maior prioridade determinística',
      } : null,
      candidates: candidates.map((item) => item.id),
      rejected,
      pending_count: blocked ? (structuralPendencies.length || 1) : 0,
      pendencies: structuralPendencies.length > 0 ? structuralPendencies : (selected ? [] : [
        conformancePending('seleção', 'next_sprint', null, 'Nenhuma sprint executável: exige state=ready, deps done ou manual_validation_pending, sprint file válido e DoR verde.', 'atualizar_sprint_file_ou_dependencias'),
      ]),
      banner: blocked
        ? renderBanner('preflight_fail', { motivo: selected ? `backlog index: ${structuralPendencies.length} pendências` : 'nenhuma sprint executável' })
        : renderBanner('preflight_ok', { caps: `next=${selected.id}` }),
      next_action: blocked
        ? (structuralPendencies[0]?.next_action ?? 'atualizar_sprint_file_ou_dependencias')
        : nextActionForSelectedSprint(selected, mode),
    };
  } catch (error) {
    result = {
      gate: 'select_next_sprint',
      status: 'blocked',
      backlog_path: backlogPath,
      timestamp,
      selected: null,
      candidates: [],
      rejected: [],
      pending_count: 1,
      pendencies: [conformancePending('leitura', backlogPath, null, `Backlog mestre ausente ou ilegível: ${backlogPath}`, 'corrigir_backlog_path')],
      banner: renderBanner('preflight_fail', { motivo: 'select next sprint: backlog ilegível' }),
      error: `Backlog mestre ausente ou ilegível: ${backlogPath}`,
      cause: error.message,
      next_action: 'corrigir_backlog_path',
    };
  }
  patchGateResult(runId, 'select_next_sprint', result, args);
  return result;
}

// ===== Plano 4 — relatório de validação manual e sync (CN3 / D11-D15, D24) =====

// D11: slug do backlog = nome do arquivo sem extensão, normalizado para o path
// `.talos/manual-validation/<slug>.md`. Backlogs nunca compartilham arquivo.
function manualValidationSlug(backlogPath) {
  return path.basename(backlogPath, '.md').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function manualValidationReportRel(backlogPath, reportPath = null) {
  if (reportPath) return reportPath;
  return path.join(MANUAL_VALIDATION_DIR, `${manualValidationSlug(backlogPath)}.md`);
}

// Parser determinístico do relatório: a tabela `## Pendências` (8 colunas) é o
// contrato; o restante do markdown é livre. Sem dependência externa (padrão do
// parser YAML próprio do Plano 1).
function parseManualValidationReport(markdown) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+Pendências\s*$/i.test(line.trim()));
  if (heading < 0) return { rows: [], error: 'Seção ## Pendências ausente no relatório.' };
  const rows = [];
  for (let i = heading + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    if (!/^\|.*\|\s*$/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length === 0 || cells.every((cell) => /^-+$/.test(cell))) continue;
    if (cells[0] === 'ID') continue;
    rows.push(cells);
  }
  return { rows, error: null };
}

// Regrava o relatório no formato canônico do template, com apenas as linhas
// restantes (pendências abertas — D12) e `Atualizado em` novo.
function renderManualValidationReport(slug, backlogPath, timestamp, rows) {
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [
    `# Validações manuais abertas — ${slug}`,
    '',
    '| Campo | Valor |',
    '|---|---|',
    `| Backlog | \`${backlogPath}\` |`,
    `| Atualizado em | ${timestamp} |`,
    '',
    '## Pendências',
    '',
    '| ID | Sprint / AC | Severidade | Status | Cenário | Ambiente | Evidência esperada | Resultado / justificativa |',
    '|---|---|---|---|---|---|---|---|',
    body,
    '',
  ].join('\n');
}

// Validação estrita de uma linha do relatório. Devolve o MV parseado ou uma
// pendência bloqueante (AC-4.1.1 waiver sem justificativa; formato/id/status).
function parseManualValidationRow(row) {
  if (row.length < 8) {
    return { mv: null, pendency: conformancePending('relatorio_manual', row[0] ?? '<sem id>', null, `Linha do relatório com ${row.length} colunas (esperado 8).`, 'fix_manual_validation_report') };
  }
  const mvId = row[0];
  const match = MANUAL_VALIDATION_MV_ID_RE.exec(mvId);
  if (!match) {
    return { mv: null, pendency: conformancePending('relatorio_manual', mvId, null, `ID MV inválido: ${mvId} (esperado MV-<Sprint>-<AC>).`, 'fix_manual_validation_report') };
  }
  const [, sprintId, acId] = match;
  const status = row[3];
  if (!MANUAL_VALIDATION_REPORT_STATUSES.has(status)) {
    return { mv: null, pendency: conformancePending('relatorio_manual', mvId, null, `Status inválido: ${status} (válidos: pending, in_progress, validated, waived, failed).`, 'fix_manual_validation_report') };
  }
  if (row[1] !== `${sprintId} / ${acId}`) {
    return { mv: null, pendency: conformancePending('relatorio_manual', mvId, null, `Coluna Sprint/AC (${row[1]}) não corresponde ao id ${mvId}.`, 'fix_manual_validation_report') };
  }
  const result = row[7];
  const resultEmpty = !result || result === '—' || result === '-';
  // D14: waiver exige justificativa; validated exige evidência humana (AC-4.2.1).
  if ((status === 'waived' || status === 'validated') && resultEmpty) {
    return { mv: null, pendency: conformancePending('relatorio_manual', mvId, null, status === 'waived'
      ? `Waiver sem justificativa em ${mvId}: preencha Resultado/justificativa.`
      : `Validated sem evidência em ${mvId}: preencha Resultado/justificativa.`, 'fix_manual_validation_report') };
  }
  return {
    mv: {
      mv_id: mvId,
      sprint_id: sprintId,
      ac_id: acId,
      status,
      severity: row[2],
      scenario: row[4],
      ambiente: row[5],
      expected_evidence: row[6],
      result,
      raw: row,
    },
    pendency: null,
  };
}

// Valida a sprint referenciada pelo relatório: linha no backlog, sprint file com
// `AC-*` declarando `evidence.manual` (item fantasma = AC-4.1.2) e state v3 com
// `acceptance_results` (alvo da sincronização D24). Devolve o plano da sprint ou
// null (pendências já registradas).
function planManualValidationSprint(sprintId, mvList, byId, args, pendencies) {
  const backlogRow = byId.get(sprintId);
  if (!backlogRow) {
    pendencies.push(conformancePending('backlog_index', sprintId, null, `Backlog não contém sprint ${sprintId} referenciada no relatório.`, 'fix_manual_validation_report'));
    return null;
  }
  if (pendingPathToken(backlogRow.sprint_file)) {
    pendencies.push(conformancePending('sprint_file', sprintId, null, `Linha ${sprintId} não aponta Sprint file real.`, 'preencher_sprint_file_no_backlog'));
    return null;
  }
  let sprintMarkdown;
  try {
    sprintMarkdown = fs.readFileSync(resolveConsumerPath(cleanBacklogPathToken(backlogRow.sprint_file), args), 'utf8');
  } catch {
    pendencies.push(conformancePending('sprint_file', sprintId, null, `Sprint file ilegível para ${sprintId}.`, 'corrigir_sprint_file_path'));
    return null;
  }
  const contract = parseAcceptanceContract(sprintMarkdown);
  const contractAcs = new Map();
  if (Array.isArray(contract)) {
    for (const item of contract) {
      if (item?.id) {
        contractAcs.set(item.id, item);
      }
    }
  }
  for (const mv of mvList) {
    if (!contractAcs.has(mv.ac_id)) {
      pendencies.push(conformancePending('relatorio_manual', mv.mv_id, null, `Item fantasma: ${mv.mv_id} sem AC correspondente no §7.3 de ${sprintId}.`, 'fix_manual_validation_report'));
    }
  }
  const stateRel = backlogRow.state_file ? cleanBacklogPathToken(backlogRow.state_file) : '';
  if (!stateRel) {
    pendencies.push(conformancePending('state_file', sprintId, null, `Linha ${sprintId} sem State file para sincronizar M.`, 'vincular_state_no_backlog'));
    return null;
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(resolveConsumerPath(stateRel, args), 'utf8'));
  } catch {
    pendencies.push(conformancePending('state_file', sprintId, null, `State ilegível para ${sprintId}: ${stateRel}.`, 'corrigir_state_path'));
    return null;
  }
  if (!Array.isArray(state.acceptance_results)) {
    pendencies.push(conformancePending('acceptance_results', sprintId, null, `State de ${sprintId} sem acceptance_results — sync manual não pode registrar M.`, 'revalidar_estado_com_acceptance_results'));
    return null;
  }
  const resultsById = new Map(state.acceptance_results.map((item) => [item?.id, item]));
  for (const mv of mvList) {
    if (!resultsById.has(mv.ac_id)) {
      pendencies.push(conformancePending('acceptance_results', `${sprintId}:${mv.ac_id}`, null, `AC ${mv.ac_id} ausente do acceptance_results do state de ${sprintId}.`, 'revalidar_estado_com_acceptance_results'));
    }
  }
  // Veredito terminal do validator que levou a sprint ao MVP (célula Gate do
  // backlog) — reutilizado na promoção a `done` (exigência do updateSprintStatus).
  const gateMatch = /^validator:(pass|pass_with_observations)/.exec(backlogRow.gate ?? '');
  return {
    sprintId,
    mvList,
    backlogRow,
    stateRel,
    state,
    resultsById,
    gateVerdict: gateMatch ? gateMatch[1] : null,
  };
}

// D24: ledger append-only da sync manual no run state (run.json). Re-run que
// sobrescreve o state de slice não apaga este histórico — o upsert faz merge
// top-level e o array só cresce.
function patchManualValidationLedger(runId, events, args) {
  let previous = null;
  try {
    previous = readState(runId, args);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }
  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous?.phase ?? 'manual_validation_sync',
    status: previous?.status ?? 'manual_validation_synced',
    summary: `manual_validation_sync: ${events.length} evento(s)`,
    data: {
      ...(previous?.data ?? {}),
      manual_validation: [...(previous?.data?.manual_validation ?? []), ...events],
    },
  });
}

// D15: sync humano do relatório `.talos/manual-validation/<slug>.md` com lock por
// backlog. Valida IDs MV-*, status e justificativa (AC-4.1.1/4.1.2); sincroniza
// state (acceptance_results) / sprint / ledger (D24); promove `done` quando todos
// os M validated/waived (CN3/AC-4.2.1) e `blocked` quando algum M falhou (o cone
// de revalidação é do Plano 5). Relatório inválido/dirty bloqueia sem drift.
function syncManualValidation(args = {}) {
  const runId = validateRunId(args.run_id);
  const backlogPath = requiredString(args, 'backlog_path');
  const timestamp = nowIso();
  const pendencies = [];
  let result;
  try {
    const slug = manualValidationSlug(backlogPath);
    const reportRel = manualValidationReportRel(backlogPath, args.report_path);
    const reportAbs = resolveConsumerPath(reportRel, args);
    const lockRel = path.join(MANUAL_VALIDATION_DIR, `${slug}.lock`);
    const lockAbs = resolveConsumerPath(lockRel, args);

    let lockHeld = false;
    try {
      fs.mkdirSync(path.dirname(lockAbs), { recursive: true });
      fs.writeFileSync(lockAbs, JSON.stringify(
        { run_id: runId, backlog_path: backlogPath, report_path: reportRel, acquired_at: timestamp },
        null,
        2,
      ), { flag: 'wx', mode: 0o600 });
      lockHeld = true;
    } catch {
      pendencies.push(conformancePending('lock', slug, null, `Sync já em andamento ou lock residual: ${lockRel}.`, 'aguardar_sync_anterior_ou_remover_lock_manual'));
    }
    if (pendencies.length > 0) throw new Error('manual_validation_sync_lock_held');

    try {
      // 1) Relatório: parse + validação estrita antes de qualquer write (sem drift).
      let reportMarkdown;
      try {
        reportMarkdown = fs.readFileSync(reportAbs, 'utf8');
      } catch {
        pendencies.push(conformancePending('relatorio_manual', reportRel, null, `Relatório ausente ou ilegível: ${reportRel}.`, 'criar_relatorio_manual'));
        throw new Error('manual_validation_sync_report_missing');
      }
      const parsed = parseManualValidationReport(reportMarkdown);
      if (parsed.error) {
        pendencies.push(conformancePending('relatorio_manual', reportRel, null, parsed.error, 'fix_manual_validation_report'));
        throw new Error('manual_validation_sync_invalid_report');
      }
      const rawRows = parsed.rows;
      if (rawRows.length === 0) {
        pendencies.push(conformancePending('relatorio_manual', reportRel, null, 'Relatório sem linhas MV-* em ## Pendências.', 'fix_manual_validation_report'));
        throw new Error('manual_validation_sync_invalid_report');
      }
      const mvRows = [];
      const seenMv = new Set();
      for (const row of rawRows) {
        const parsedMv = parseManualValidationRow(row);
        if (parsedMv.pendency) {
          pendencies.push(parsedMv.pendency);
        } else if (seenMv.has(parsedMv.mv.mv_id)) {
          pendencies.push(conformancePending('relatorio_manual', parsedMv.mv.mv_id, null, `MV duplicado: ${parsedMv.mv.mv_id}.`, 'fix_manual_validation_report'));
        } else {
          seenMv.add(parsedMv.mv.mv_id);
          mvRows.push(parsedMv.mv);
        }
      }
      if (pendencies.length > 0) throw new Error('manual_validation_sync_invalid_report');

      // 2) Backlog + contrato + state por sprint (item fantasma = AC-4.1.2).
      const backlogMarkdown = fs.readFileSync(resolveConsumerPath(backlogPath, args), 'utf8');
      const backlogRows = parseSprintRows(backlogMarkdown);
      const byId = new Map(backlogRows.map((row) => [row.id, row]));
      const bySprint = new Map();
      for (const mv of mvRows) {
        if (!bySprint.has(mv.sprint_id)) bySprint.set(mv.sprint_id, []);
        bySprint.get(mv.sprint_id).push(mv);
      }
      const sprintPlans = [];
      for (const [sprintId, mvList] of bySprint) {
        const plan = planManualValidationSprint(sprintId, mvList, byId, args, pendencies);
        if (plan) sprintPlans.push(plan);
      }
      if (pendencies.length > 0) throw new Error('manual_validation_sync_invalid_report');

      // Plano 5 / CN4: `M` falho na origem → origem `blocked` (promoção no loop
      // abaixo) e cone dependente com `revalidation_required=true` (fecho
      // transitivo de `Depende de` — AC-5.2.1). A flag não filtra seleção
      // (AC-5.2.2) e bloqueia `done` até revalidação (AC-5.1.2). Escrita antes
      // das promoções para o `updateSprintStatus` (que relê o backlog do disco)
      // enxergar a flag; dependente revalidado no mesmo sync (todos proved)
      // limpa a flag na própria promoção.
      const failedOrigins = sprintPlans
        .filter((plan) => plan.mvList.some((mv) => mv.status === 'failed'))
        .map((plan) => plan.sprintId);
      if (failedOrigins.length > 0) {
        const flagged = propagateRevalidation(backlogRows, failedOrigins);
        if (flagged.size > 0) {
          const backlogAbs = resolveConsumerPath(backlogPath, args);
          let nextBacklog = backlogMarkdown;
          for (const flaggedId of flagged) {
            const res = replaceBacklogSprintRow(nextBacklog, flaggedId, (cells) => {
              // Escrita absoluta: lista final completa com 16 células (índices
              // 0–14 preservados; Revalidação = coluna 15, fim do índice).
              const nextCells = [...cells];
              while (nextCells.length < 16) nextCells.push('');
              nextCells[15] = 'true';
              return nextCells;
            });
            nextBacklog = res.markdown;
          }
          fs.writeFileSync(backlogAbs, nextBacklog);
          // D2: metadado sync no sprint file dos dependentes flagados. Sprint
          // file ausente/ilegível: a flag permanece no backlog — o drift é
          // tratado a jusante (done exige revalidação via estado, fail-closed).
          for (const flaggedId of flagged) {
            const flaggedRow = byId.get(flaggedId);
            if (!flaggedRow || pendingPathToken(flaggedRow.sprint_file)) continue;
            try {
              const flaggedSprintAbs = resolveConsumerPath(cleanBacklogPathToken(flaggedRow.sprint_file), args);
              fs.writeFileSync(
                flaggedSprintAbs,
                replaceMarkdownTableValue(fs.readFileSync(flaggedSprintAbs, 'utf8'), 'Revalidação', 'true'),
              );
            } catch {}
          }
        }
      }

      // 3) Escritas: state (acceptance_results), promoção (done/blocked), relatório,
      // ledger. Promoção reusa a escrita atômica de status (mesmo caminho do CN1).
      const ledgerEvents = [];
      const sprintsOut = [];
      let handoffPath = null;
      let anyFailed = false;
      let anyPending = false;
      for (const plan of sprintPlans) {
        const stateUpdates = [];
        for (const mv of plan.mvList) {
          const mapped = MANUAL_VALIDATION_STATE_MAP[mv.status];
          if (!mapped) continue; // pending/in_progress: sem mudança de state
          stateUpdates.push({
            mv,
            from: plan.resultsById.get(mv.ac_id)?.status ?? null,
            to: mapped.to,
            proof: mapped.proof,
          });
        }
        if (stateUpdates.length > 0) {
          const nextState = JSON.parse(JSON.stringify(plan.state));
          nextState.acceptance_results = nextState.acceptance_results.map((item) => {
            const upd = stateUpdates.find((u) => u.mv.ac_id === item.id);
            if (!upd) return item;
            return {
              ...item,
              status: upd.to,
              proof_types: [...(Array.isArray(item.proof_types) ? item.proof_types : []).filter((t) => !/^M:/.test(t)), upd.proof],
            };
          });
          // D24: referência do relatório que sincronizou este state (append-only).
          nextState.manual_validation_report = reportRel;
          fs.writeFileSync(resolveConsumerPath(plan.stateRel, args), `${JSON.stringify(nextState, null, 2)}\n`);
          for (const upd of stateUpdates) {
            ledgerEvents.push({
              timestamp,
              backlog_path: backlogPath,
              report_path: reportRel,
              mv_id: upd.mv.mv_id,
              sprint_id: plan.sprintId,
              ac_id: upd.mv.ac_id,
              status: upd.mv.status,
              result: upd.mv.result,
              previous_status: upd.from,
              next_status: upd.to,
            });
          }
        }

        const closedByReport = plan.mvList
          .filter((mv) => mv.status === 'validated' || mv.status === 'waived')
          .map((mv) => mv.ac_id);
        const closedSet = new Set(closedByReport);
        // ACs que permanecem não provados após esta sync (status != 'proved' sem linha fechada no relatório).
        const nonProvedAfter = plan.state.acceptance_results.filter((item) => (
          item.status !== 'proved' && !closedSet.has(item.id)
        )).length;
        const sprintFailed = plan.mvList.some((mv) => mv.status === 'failed');
        const wantsPromotion = sprintFailed || (nonProvedAfter === 0 && closedByReport.length > 0);
        if (plan.backlogRow.state === 'manual_validation_pending' && wantsPromotion && !plan.gateVerdict) {
          pendencies.push(conformancePending('veredito', plan.sprintId, null, `Gate da linha ${plan.sprintId} sem veredito validator legível para promover (${plan.backlogRow.gate}).`, 'corrigir_gate_no_backlog'));
          throw new Error('manual_validation_sync_promotion_failed');
        }

        let promotedTo = null;
        let up = null;
        const canPromote = plan.backlogRow.state === 'manual_validation_pending' && plan.gateVerdict;
        if (canPromote && sprintFailed) {
          promotedTo = 'blocked';
          up = updateSprintStatus({
            run_id: runId,
            project_root: args.project_root,
            backlog_path: backlogPath,
            sprint_id: plan.sprintId,
            status: 'blocked',
            validator_verdict: plan.gateVerdict,
            state_path: plan.stateRel,
            evidence: `M failed: ${plan.mvList.filter((mv) => mv.status === 'failed').map((mv) => mv.mv_id).join(', ')}`,
          });
        } else if (canPromote && nonProvedAfter === 0 && closedByReport.length > 0) {
          promotedTo = 'done';
          up = updateSprintStatus({
            run_id: runId,
            project_root: args.project_root,
            backlog_path: backlogPath,
            sprint_id: plan.sprintId,
            status: 'done',
            validator_verdict: plan.gateVerdict,
            state_path: plan.stateRel,
            evidence: `sync manual: ${closedByReport.map((acId) => `MV-${plan.sprintId}-${acId}`).join(', ')}`,
          });
        }
        if (up) {
          if (up.status !== 'passed') {
            pendencies.push(...(up.pendencies ?? []));
            throw new Error('manual_validation_sync_promotion_failed');
          }
          handoffPath = up.handoff_path ?? handoffPath;
          ledgerEvents.push({
            timestamp,
            backlog_path: backlogPath,
            report_path: reportRel,
            mv_id: null,
            sprint_id: plan.sprintId,
            ac_id: null,
            status: 'sync',
            result: null,
            previous_status: plan.backlogRow.state,
            next_status: promotedTo,
          });
        }
        if (sprintFailed) anyFailed = true;
        if (plan.mvList.some((mv) => mv.status === 'pending' || mv.status === 'in_progress')) anyPending = true;
        // D24: histórico no sprint também — sprint sem promoção ganha linha §16 com
        // o resultado dos M sincronizados (promovidos já ganham via updateSprintStatus).
        if (!up && stateUpdates.length > 0) {
          const sprintAbs = resolveConsumerPath(cleanBacklogPathToken(plan.backlogRow.sprint_file), args);
          const sprintBefore = fs.readFileSync(sprintAbs, 'utf8');
          const mvSummary = stateUpdates.map((u) => `${u.mv.mv_id}:${u.mv.status}`).join(', ');
          fs.writeFileSync(sprintAbs, appendToMarkdownSectionTable(sprintBefore, /^##\s+16\.\s+Histórico\s*$/i, [
            timestamp.slice(0, 10),
            'Talos MCP sync manual',
            `MV sync: ${mvSummary}`,
          ]));
        }
        sprintsOut.push({
          sprint_id: plan.sprintId,
          state: promotedTo ?? plan.backlogRow.state,
          promoted: Boolean(promotedTo),
          handoff_path: up?.handoff_path ?? null,
          synced_rows: stateUpdates.length,
        });
      }
      if (pendencies.length > 0) throw new Error('manual_validation_sync_promotion_failed');

      // 4) Relatório reescrito só com pendências abertas; removido quando vazio (D12).
      const remainingRows = rawRows.filter((row) => {
        const status = row[3];
        return status === 'pending' || status === 'in_progress';
      });
      if (remainingRows.length === 0) {
        fs.rmSync(reportAbs, { force: true });
      } else {
        fs.writeFileSync(reportAbs, renderManualValidationReport(slug, backlogPath, timestamp, remainingRows));
      }

      // 5) Ledger append-only no run state (D24).
      if (ledgerEvents.length > 0) patchManualValidationLedger(runId, ledgerEvents, args);

      result = {
        gate: 'manual_validation_sync',
        status: 'passed',
        backlog_path: backlogPath,
        report_path: reportRel,
        slug,
        timestamp,
        synced_items: ledgerEvents.length,
        sprints: sprintsOut,
        handoff_path: handoffPath,
        pending_count: 0,
        pendencies: [],
        banner: renderBanner('preflight_ok', { caps: `manual_validation_sync=${slug}` }),
        next_action: handoffPath
          ? 'promover_handoff'
          : anyFailed
            ? 'corrigir_smoke_falho'
            : anyPending
              ? 'aguardar_validacao_manual'
              : 'avançar',
      };
    } finally {
      if (lockHeld) {
        try { fs.rmSync(lockAbs, { force: true }); } catch {}
      }
    }
  } catch (error) {
    result = {
      gate: 'manual_validation_sync',
      status: 'blocked',
      backlog_path: backlogPath,
      report_path: manualValidationReportRel(backlogPath, args.report_path),
      timestamp,
      pending_count: pendencies.length || 1,
      pendencies: pendencies.length > 0 ? pendencies : [
        conformancePending('leitura', backlogPath, null, `Não foi possível sincronizar o relatório: ${error.message}`, 'corrigir_relatorio_manual'),
      ],
      banner: renderBanner('preflight_fail', { motivo: `manual validation sync: ${pendencies.length || 1} pendências` }),
      error: 'Não foi possível sincronizar o relatório de validação manual.',
      cause: error.message,
      next_action: pendencies[0]?.next_action ?? 'corrigir_relatorio_manual',
    };
  }
  patchGateResult(runId, 'manual_validation_sync', result, args);
  return result;
}

// Detecta tipo de input para roteamento. Hierarquia de confiança:
//   (1) verdade forte: conformidade de template de plano passa → 'plan';
//   (2) dica: cabeçalho/frontmatter canônico de plano → 'plan';
//   (3) sprint file vivo (contrato §7) → 'backlog' (rota sprint_from_backlog);
//   (4) spec/PRD-ish (`# PRD:`) → 'idea' (D9: tipo prd removido);
//   (5) backlog por marcadores; (6) dica fraca PLAN_*.md; senão 'unknown'.
// Nome de arquivo nunca basta sozinho: só conta como dica fraca e cede para a
// verdade forte. Reusa verifyPlanConformance para (1).
function classifyArtifactContent(content, fileName = '') {
  const text = content ?? '';

  // (1) Verdade forte: plano conforme o template canônico (zero pendências).
  if (text.trim() !== '' && verifyPlanConformance(text).length === 0) {
    return { artifact_type: 'plan', signal: 'template_conformance' };
  }

  // (2) Dica de cabeçalho/frontmatter canônico de plano.
  const planHeaderHint = /\|\s*\*\*Sprint file\*\*\s*\|/i.test(text)
    || /^#\s+PLAN[\s_]/im.test(text)
    || /\bexecution_mode\b/.test(text);
  if (planHeaderHint && /####\s+T\d+\./.test(text)) {
    return { artifact_type: 'plan', signal: 'header_hint' };
  }

  // (3) Sprint file vivo: contrato absorvido — roteia como backlog (sprint_from_backlog).
  const sprintHint = /##\s+7\.\s+Contrato de produto/i.test(text)
    || /\|\s*Sprint ID\s*\|/i.test(text)
    || /^#\s+Sprint\b/im.test(text);
  if (sprintHint) {
    return { artifact_type: 'backlog', signal: 'sprint_file_markers' };
  }

  // (4) Spec/PRD-ish legado → idea (D9; tipo prd removido do vocabulário de entrada).
  const specHint = /^#\s+PRD[:\s]/im.test(text)
    || (/##\s+3\.\s+Decisões de produto/i.test(text) && /\|\s*D\d+\s*\|/.test(text));
  if (specHint) {
    return { artifact_type: 'idea', signal: 'spec_markers' };
  }

  // (5) Backlog: marcadores do template canônico de backlog/roadmap.
  const backlogHint = /\bBACKLOG[\s_]/i.test(text)
    || /\bSprint\s+S\d+/i.test(text)
    || /\bRoadmap\b/i.test(text);
  if (backlogHint) {
    return { artifact_type: 'backlog', signal: 'backlog_markers' };
  }

  // (6) Dica fraca: nome PLAN_*.md, só se nada mais classificou.
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

  // Input que não é arquivo existente = descrição livre (idea), não path. Heurística
  // determinística: parece path só se terminar em extensão de arquivo E não tiver espaço.
  // Idea NÃO é "input ilegível" — roteia para `direct` sem BLOCK falso-positivo (A6).
  // Path com cara de arquivo mas ausente/ilegível continua caindo no catch (erro real).
  const trimmedInput = inputPath.trim();
  const looksLikePath = /\.[a-z0-9]{1,6}$/i.test(trimmedInput) && !/\s/.test(trimmedInput);
  if (!looksLikePath && !fs.existsSync(absolutePath)) {
    return {
      gate: 'classify_input',
      status: 'not_a_file',
      input_path: inputPath,
      artifact_type: 'idea',
      routed_mode: ROUTED_MODE_BY_TYPE.idea,
      detection_signal: 'free_text_idea',
      timestamp,
      banner: renderBanner('roteia', { tipo: 'idea', modo: ROUTED_MODE_BY_TYPE.idea }),
      next_action: 'rotear_idea_para_direct',
    };
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf8');
    const { artifact_type, signal } = classifyArtifactContent(content, inputPath);
    // Modo-alvo por tipo de input: o fato manda. plan → execute;
    // backlog → full; idea/spec → direct. Data-driven; sem ramo solto.
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
  const join = checkJoinCapability(args);
  const dispatchCap = checkDispatchCapability(args, mode);
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
  } else if (join.status === 'blocked') {
    // Gate JOIN após PREREQ passar (ordem determinística: prereq → join → versão/lock).
    result = {
      gate: 'JOIN',
      status: 'blocked',
      timestamp,
      mode,
      host: join.host,
      error: join.error,
      cause: join.cause,
      impact: join.impact,
      next_action: join.next_action,
    };
  } else if (dispatchCap.status === 'blocked') {
    // Gate DISPATCH_CAPABILITY após JOIN (DEC-008). Bloqueia modos de execução quando
    // o subagente do host não tem capacidade de mutação verificada.
    result = {
      gate: 'DISPATCH',
      status: 'blocked',
      timestamp,
      mode,
      host: dispatchCap.host,
      dispatch_capability: dispatchCap.capability,
      error: dispatchCap.error,
      cause: dispatchCap.cause,
      impact: dispatchCap.impact,
      next_action: dispatchCap.next_action,
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
    const documentFlow = documentFlowForRouting(mode, args.input_type, args.artifact_type);
    // Campo OMITIDO quando o modo não declara garantia (interview-only → null).
    result = {
      gate: 'G10',
      status: 'passed',
      timestamp,
      mode,
      ...(guaranteeLevel ? { guarantee_level: guaranteeLevel } : {}),
      routing: {
        mode,
        ...(expectedExecutorSkill(mode) ? { executor_skill: expectedExecutorSkill(mode) } : {}),
        ...(guaranteeLevel ? { guarantee_level: guaranteeLevel } : {}),
        skills: config.skills,
        document_flow: documentFlow,
        version: version.version,
        locked_at: currentRouting?.locked_at ?? timestamp,
        config_path: config.path,
        supported_modes: config.modes,
        dispatch_capability: dispatchCap.capability,
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
    throw rpcError(-32011, 'Preflight não executado: execute talos_preflight antes do dispatch', {
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
  if (routing.mode === 'audit') return 'audit_report';
  return 'sprint_interview';
}

function initialExecutorLiveness(timestamp) {
  return {
    status: 'spawned',
    bootstrap_timeout_ms: EXECUTOR_BOOTSTRAP_TIMEOUT_MS,
    progress_timeout_ms: EXECUTOR_PROGRESS_TIMEOUT_MS,
    bootstrap_deadline_at: isoPlusMs(timestamp, EXECUTOR_BOOTSTRAP_TIMEOUT_MS),
    next_progress_deadline_at: null,
    required_first_checkpoint: null,
    last_checkpoint: null,
    last_progress_at: null,
    checkpoints: [],
  };
}

function checkpointStatus(event) {
  if (event === 'first_write') return 'executing';
  return 'booting';
}

function startDispatch(args, context) {
  const phase = requiredString(args, 'phase');
  if (Object.prototype.hasOwnProperty.call(args, LEGACY_ROUTE_KEY)) {
    throw rpcError(-32602, `unknown_property: ${LEGACY_ROUTE_KEY}`);
  }
  const timestamp = nowIso();
  let baseSha = null;
  if (phase === 'plan_execute') {
    // AC-1.2.1 / P2: âncora de base da slice gravada no ledger no start. O
    // commit NÃO infere branch nem omite base_sha (VC2). Best-effort: repo sem
    // commit inicial ainda pode iniciar; commit depois valida o boundary real.
    try {
      baseSha = gitOutput(consumerRoot(args), ['rev-parse', 'HEAD']).trim();
    } catch {
      baseSha = null;
    }
  }

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
      active: {
        phase,
        started_at: timestamp,
        ...(phase === 'plan_execute' ? { base_sha: baseSha, liveness: initialExecutorLiveness(timestamp) } : {}),
      },
      previous_phase: context.dispatch.previous_phase ?? null,
      next_phase: null,
      next_action: `complete_${phase}`,
    },
    next_action: `complete_${phase}`,
  };
}

function checkpointDispatch(args, context) {
  const phase = requiredString(args, 'phase');
  const event = requiredString(args, 'event');
  const timestamp = nowIso();
  const active = context.dispatch.active;

  if (phase !== 'plan_execute') {
    return {
      gate: 'G12',
      action: 'checkpoint',
      phase,
      event,
      status: 'blocked',
      timestamp,
      error: 'Checkpoint de liveness só se aplica a plan_execute',
      current_phase: active?.phase ?? null,
      expected_phase: 'plan_execute',
      next_action: 'corrigir_fase_do_checkpoint',
    };
  }
  if (!active || active.phase !== phase) {
    return {
      gate: 'G12',
      action: 'checkpoint',
      phase,
      event,
      status: 'blocked',
      timestamp,
      error: `Checkpoint fora de ordem: fase ativa ${active?.phase ?? 'nenhuma'}, recebido ${phase}`,
      current_phase: active?.phase ?? null,
      expected_phase: active?.phase ?? expectedNextPhase(context.routing, context.dispatch),
      next_action: active ? `checkpoint_${active.phase}` : `dispatch_${expectedNextPhase(context.routing, context.dispatch)}`,
    };
  }
  if (!EXECUTOR_CHECKPOINT_EVENTS.has(event)) {
    return {
      gate: 'G12',
      action: 'checkpoint',
      phase,
      event,
      status: 'blocked',
      timestamp,
      error: `Checkpoint desconhecido: ${event} (G12 público é só first_write; events antigos morreram)`,
      current_phase: phase,
      expected_phase: phase,
      next_action: 'emitir_first_write_ou_commitar_via_talos_commit_state',
    };
  }

  // AC-1.2.2: repair nunca emite checkpoint de executor (D9: role pelo lock).
  // O slot de repair aberto é do ciclo do validator; o executor/repair NÃO
  // pode escrever liveness nesse estado.
  const cycle = normalizeValidatorCycle(context.state.data?.validator_cycle ?? {});
  if (cycle.status === 'repair_required' || cycle.status === 'repair_running' || cycle.repair.active) {
    return {
      gate: 'G12',
      action: 'checkpoint',
      phase,
      event,
      status: 'blocked',
      timestamp,
      error: 'Checkpoint bloqueado: repair ativo não emite first_write (role repair não escreve liveness)',
      current_phase: phase,
      expected_phase: phase,
      next_action: 'reparar_via_talos_commit_state_repair',
    };
  }

  const liveness = active.liveness && typeof active.liveness === 'object'
    ? active.liveness
    : initialExecutorLiveness(active.started_at ?? timestamp);
  if (event === 'first_write' && Array.isArray(liveness.checkpoints) && liveness.checkpoints.some((entry) => entry?.event === 'first_write')) {
    return {
      gate: 'G12',
      action: 'checkpoint',
      phase,
      event,
      status: 'blocked',
      timestamp,
      error: 'first_write já emitido: baseline do worktree já está no ledger (G12 só uma vez)',
      current_phase: phase,
      expected_phase: phase,
      next_action: 'prosseguir_para_commit_state',
    };
  }
  const planPath = optionalString(args, 'plan_path');
  const statePathValue = optionalString(args, 'state_path');
  const detail = optionalString(args, 'detail');
  const checkpoint = {
    event,
    timestamp,
    ...(planPath ? { plan_path: planPath } : {}),
    ...(statePathValue ? { state_path: statePathValue } : {}),
    ...(detail ? { detail } : {}),
  };
  const baseline = event === 'first_write' ? captureWorktreeSnapshot(consumerRoot(args)) : null;
  const nextLiveness = {
    ...liveness,
    status: checkpointStatus(event),
    last_checkpoint: event,
    last_progress_at: timestamp,
    next_progress_deadline_at: isoPlusMs(timestamp, EXECUTOR_PROGRESS_TIMEOUT_MS),
    checkpoints: [
      ...(Array.isArray(liveness.checkpoints) ? liveness.checkpoints : []),
      checkpoint,
    ],
    ...(baseline ? { worktree_baseline: baseline } : {}),
  };

  return {
    gate: 'G12',
    action: 'checkpoint',
    phase,
    event,
    status: 'passed',
    timestamp,
    executor_liveness: nextLiveness.status,
    current_phase: phase,
    expected_phase: phase,
    dispatch: {
      active: {
        ...active,
        liveness: nextLiveness,
      },
      executor_liveness: nextLiveness,
      next_action: `complete_${phase}`,
    },
    next_action: `continue_${phase}`,
  };
}

function statusDispatch(args, context) {
  const phase = requiredString(args, 'phase');
  const timestamp = nowIso();
  const active = context.dispatch.active;

  if (!active || active.phase !== phase) {
    return {
      gate: 'G12',
      action: 'status',
      phase,
      status: 'blocked',
      timestamp,
      error: `Status fora de ordem: fase ativa ${active?.phase ?? 'nenhuma'}, recebido ${phase}`,
      current_phase: active?.phase ?? null,
      expected_phase: active?.phase ?? expectedNextPhase(context.routing, context.dispatch),
      next_action: active ? `status_${active.phase}` : `dispatch_${expectedNextPhase(context.routing, context.dispatch)}`,
    };
  }

  const liveness = active.liveness && typeof active.liveness === 'object'
    ? active.liveness
    : (phase === 'plan_execute' ? initialExecutorLiveness(active.started_at ?? timestamp) : null);
  const checkpoints = Array.isArray(liveness?.checkpoints) ? liveness.checkpoints : [];
  // D12 (bootstrap 120s): stalled só se o deadline passou e NÃO houve primeiro
  // gesto — nem `first_write` nem commit (`handoff_ready`/sha no ledger). No-op
  // que commita em 120s não stalled; `checkpoints.length === 0` sozinho não é
  // critério (no-op slice só commita, sem primeiro checkpoint público).
  const hasFirstWrite = checkpoints.some((entry) => entry?.event === 'first_write');
  const hasCommit = liveness?.status === 'handoff_ready' || typeof liveness?.slice_commit_sha256 === 'string';
  const deadline = Date.parse(liveness?.bootstrap_deadline_at ?? '');
  const now = Date.parse(timestamp);
  const bootstrapExpired = phase === 'plan_execute'
    && !hasFirstWrite
    && !hasCommit
    && Number.isFinite(deadline)
    && Number.isFinite(now)
    && now > deadline;
  const progressDeadline = Date.parse(liveness?.next_progress_deadline_at ?? '');
  const progressExpired = phase === 'plan_execute'
    && checkpoints.length > 0
    && liveness?.status !== 'handoff_ready'
    && Number.isFinite(progressDeadline)
    && Number.isFinite(now)
    && now > progressDeadline;

  if (bootstrapExpired || progressExpired) {
    const cause = bootstrapExpired ? 'executor_bootstrap_timeout' : 'executor_progress_timeout';
    const stalledLiveness = {
      ...liveness,
      status: 'stalled',
      stalled_at: timestamp,
      cause,
    };
    return {
      gate: 'G12',
      action: 'status',
      phase,
      status: 'blocked',
      timestamp,
      cause,
      error: bootstrapExpired
        ? `Executor sem checkpoint até ${liveness.bootstrap_deadline_at}`
        : `Executor sem progresso desde ${liveness.last_progress_at}`,
      current_phase: phase,
      expected_phase: phase,
      dispatch: {
        active: null,
        previous_phase: phase,
        next_phase: phase,
        next_action: `retry_${phase}`,
        executor_liveness: stalledLiveness,
      },
      next_action: `retry_${phase}`,
    };
  }

  return {
    gate: 'G12',
    action: 'status',
    phase,
    status: 'passed',
    timestamp,
    executor_liveness: liveness?.status ?? 'not_tracked',
    current_phase: phase,
    expected_phase: phase,
    dispatch: {
      active: liveness ? { ...active, liveness } : active,
      executor_liveness: liveness,
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
    if (!VALIDATOR_PASSED_STATUSES.has(validatorStatus)) {
      return {
        gate: 'G8',
        action: 'complete',
        phase,
        status: 'blocked',
        timestamp,
        error: `Execução não pode concluir sem validator terminal aprovado; recebido ${validatorStatus}`,
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
  if (!['start', 'checkpoint', 'status', 'complete', 'abort'].includes(action)) {
    throw rpcError(-32602, `Ação inválida para talos_lock_dispatch: ${action}`);
  }

  const context = getDispatchState(runId, args);
  const result =
    action === 'start' ? startDispatch(args, context) :
      action === 'checkpoint' ? checkpointDispatch(args, context) :
        action === 'status' ? statusDispatch(args, context) :
          action === 'complete' ? completeDispatch(args, context) :
            abortDispatch(args, context);

  result.banner = dispatchBanner(result);
  patchDispatchResult(runId, result, args);
  return result;
}

// Proof-of-work do validador irmão (P1.1 camada 1). Escopo HONESTO: não é prova
// criptográfica de isolamento (o MCP fala stdio com um único caller e não distingue
// orquestrador de subagente). É atestação mecânica de que o veredito tocou bytes
// reais do boundary — eleva o piso do atalho preguiçoso (afirmar `pass` sem ler
// código) e dá rastro de auditoria. Pegar 1 arquivo do `files_changed` do
// `state_path`; o validador reporta o sha256 dele; o MCP RECOMPUTA do disco no
// complete (nunca armazena o hash esperado em estado legível — senão o orquestrador
// só copiaria). Best-effort: sem arquivo legível ⇒ challenge null ⇒ sem enforcement
// (não quebra run válida). Seleção determinística por dispatch_token (reproduzível).
function pickValidatorChallenge(statePathValue, args, dispatchToken) {
  try {
    const sliceState = JSON.parse(fs.readFileSync(resolveConsumerPath(statePathValue, args), 'utf8'));
    const files = Array.isArray(sliceState.files_changed)
      ? sliceState.files_changed.filter((f) => typeof f === 'string' && f.trim() !== '')
      : [];
    if (files.length === 0) return null;
    const offset = ((dispatchToken % files.length) + files.length) % files.length;
    for (let i = 0; i < files.length; i += 1) {
      const rel = files[(offset + i) % files.length];
      try {
        const fabs = resolveConsumerPath(rel, args);
        if (!fs.statSync(fabs).isFile()) continue;
        fs.accessSync(fabs, fs.constants.R_OK);
        return { file: rel, algo: 'sha256' };
      } catch {
        // arquivo do boundary inexistente/ilegível (ex.: deletado na slice) — tenta o próximo.
      }
    }
    return null;
  } catch {
    // state_path ilegível aqui não bloqueia o start (o validador falha do lado dele
    // se não conseguir ler o boundary); proof-of-work é aditivo.
    return null;
  }
}

// Verifica o challenge_response no complete recomputando o hash do disco.
//   { ok: true }                         — sem challenge emitido OU hash confere
//   { ok: false, reason }                — resposta ausente, arquivo ilegível ou hash divergente
function verifyValidatorChallenge(challenge, response, args) {
  if (!challenge || typeof challenge.file !== 'string') return { ok: true };
  if (typeof response !== 'string' || response.trim() === '') {
    return { ok: false, reason: 'challenge_response_ausente' };
  }
  let actual;
  try {
    actual = crypto.createHash('sha256')
      .update(fs.readFileSync(resolveConsumerPath(challenge.file, args)))
      .digest('hex');
  } catch {
    return { ok: false, reason: 'challenge_file_unreadable' };
  }
  // Aceita hex puro ou saída de `shasum` (`<hash>  <arquivo>`): primeiro token.
  const submitted = response.trim().toLowerCase().split(/\s+/)[0];
  return submitted === actual ? { ok: true } : { ok: false, reason: 'challenge_hash_divergente' };
}

const STATE_REQUIRED_FIELDS = [
  'run_id', 'slice', 'tasks', 'files_changed', 'diff_stat', 'plan_path',
  'boundary_refs', 'executed_at', 'executor_skill',
];
const STATE_EXTENSION_ARRAYS = [
  'obligations', 'invariants', 'scenario_probes', 'risk_probes',
  'validation_map', 'task_evidence', 'worktree_baseline', 'worktree_final',
];
const STATE_COMPACT_SCHEMA_VERSION = 3;
const SPRINT_ID_PATTERN = /^S\d{2}(?:[a-z]|\.\d+)?$/;
const EVAL_ID_PATTERN = /^EVAL-\d+$/;
const EVAL_STATUSES = new Set(['passed', 'failed', 'blocked', 'not_applicable']);

function gitOutput(root, gitArgs) {
  return execFileSync('git', ['-C', root, ...gitArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitLines(root, gitArgs) {
  const output = gitOutput(root, gitArgs);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function stateEvidenceFiles(state) {
  const result = [];
  for (const item of [...(state.task_evidence ?? []), ...(state.repair_evidence ?? [])]) {
    if (!item || typeof item !== 'object') continue;
    for (const key of ['files', 'files_touched']) {
      if (Array.isArray(item[key])) result.push(...item[key]);
    }
    if (typeof item.file === 'string') result.push(item.file);
  }
  // proof_refs[AC].files são índices em files_changed (compacto v3): a evidência
  // de um AC cobre os arquivos que ele prova, mesmo sem task/repair associada.
  for (const ref of Object.values(state.proof_refs ?? {})) {
    if (ref && Array.isArray(ref.files)) {
      result.push(...ref.files.map((index) => (state.files_changed ?? [])[index]).filter((file) => typeof file === 'string'));
    }
  }
  return [...new Set(result.filter((item) => typeof item === 'string' && item.trim()))].sort();
}

// D22: Oráculo mecânico de prova (T-outcome). Padrões de assert determinam se
// um check indexado em check_table — ou o arquivo de teste que ele referencia —
// prova um outcome observável. Um comando/arquivo que só exercita o caminho
// (sem assert) não prova — é `unproved`.
// A regex casa CHAMADAS reais de assert — não palavras soltas em descrições ou
// comentários (ex.: `test('should return X', ...)` sem assert não é prova).
// Casa: assert(...) | assert.equal(...) | expect(x).toEqual(...) | x.should.equal(...)
//       ok(...) | fail(...) | .toEqual( .toBe( .deepEqual( .strictEqual( .notStrictEqual( .throws( .rejects(
const ASSERT_PATTERNS = /(?:\b(?:assert|expect)\s*(?:\(|\.\s*\w+\s*\()|(?:\.\s*)?\bshould\s*\.\s*\w+\s*\(|\b(?:ok|fail)\s*\(|(?:\.\s*|\b)(?:toEqual|toBe|deepEqual|strictEqual|notStrictEqual|throws|rejects)\s*\()/i;
const SOURCE_PATH_IN_COMMAND = /(?:\.\/|[A-Za-z0-9_@./-]+)\.(?:js|mjs|cjs|ts)\b/g;
const TEST_PATH_HINT = /\.(?:test|spec)\./i;
const TEST_DIR_HINT = /(?:^|\/)(?:tests?|__tests__)\//i;

const ACCEPTANCE_STATUSES = new Set(['proved', 'unproved', 'violated', 'manual_pending']);

function looksLikeTestPath(relPath) {
  return TEST_PATH_HINT.test(relPath) || TEST_DIR_HINT.test(relPath);
}

// Proposta §4.1: assert no comando OU no teste referenciado (conteúdo do arquivo).
// options.readText(relPath) → string; sem FS, só a string do comando conta.
function checkProvesOutcome(command, state, fileIndexes, options = {}) {
  if (ASSERT_PATTERNS.test(command)) return true;
  const candidates = new Set();
  for (const match of command.matchAll(SOURCE_PATH_IN_COMMAND)) {
    candidates.add(match[0]);
  }
  const filesChanged = Array.isArray(state?.files_changed) ? state.files_changed : [];
  for (const idx of fileIndexes) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= filesChanged.length) continue;
    const rel = filesChanged[idx];
    if (typeof rel === 'string' && rel.trim() && looksLikeTestPath(rel)) candidates.add(rel);
  }
  const readText = typeof options.readText === 'function' ? options.readText : null;
  if (!readText) return false;
  for (const rel of candidates) {
    try {
      const text = readText(rel);
      if (typeof text === 'string' && ASSERT_PATTERNS.test(text)) return true;
    } catch {
      // arquivo ausente/ilegível: não prova
    }
  }
  return false;
}

// Classifica acceptance_results[] a partir de proof_refs no state e do
// contrato AC-* do sprint file. Helper determinístico, sem LLM.
// options.readText opcional: lê arquivos referenciados pelo check/proof_refs.
// Retorna { results: [{id, status, proof_types}], violations: [] }.
function classifyAcceptanceResults(state, sprintAcceptance, options = {}) {
  const violations = [];
  const checkTable = Array.isArray(state?.check_table) ? state.check_table : [];
  const proofRefs = (state?.proof_refs && typeof state.proof_refs === 'object'
    && !Array.isArray(state.proof_refs)) ? state.proof_refs : {};
  const acItems = Array.isArray(sprintAcceptance) ? sprintAcceptance : [];

  const results = [];
  const seenIds = new Set();
  for (const ac of acItems) {
    if (!ac || typeof ac !== 'object') continue;
    const id = typeof ac.id === 'string' ? ac.id.trim() : null;
    if (!id) {
      violations.push('AC sem id em acceptance contract');
      continue;
    }
    if (seenIds.has(id)) {
      violations.push(`AC id duplicado: ${id}`);
      continue;
    }
    seenIds.add(id);

    const ref = proofRefs[id] ?? {};
    const checkIndexes = Array.isArray(ref.checks) ? ref.checks : [];
    const fileIndexes = Array.isArray(ref.files) ? ref.files : [];
    const required = Array.isArray(ac?.evidence?.required) ? ac.evidence.required : [];
    const hasManual = ac?.evidence?.manual !== null && ac?.evidence?.manual !== undefined;

    const proofTypes = [];
    // T-outcome: check referenciado deve ter assert (comando ou arquivo de teste).
    let tOutcomeProved = false;
    let tOutcomePresent = false;
    for (const idx of checkIndexes) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= checkTable.length) {
        violations.push(`proof_refs[${id}].checks índice inválido: ${idx}`);
        continue;
      }
      tOutcomePresent = true;
      const command = String(checkTable[idx] ?? '');
      if (checkProvesOutcome(command, state, fileIndexes, options)) {
        tOutcomeProved = true;
      }
    }
    if (required.includes('T-outcome')) {
      if (tOutcomePresent) proofTypes.push(tOutcomeProved ? 'T-outcome:proved' : 'T-outcome:unproved');
      else proofTypes.push('T-outcome:absent');
    }
    // I (implementation): files referenciados no boundary
    if (required.includes('I')) {
      if (fileIndexes.length > 0) proofTypes.push('I:present');
      else proofTypes.push('I:absent');
    }
    // W (wiring): tratado como I aqui (presença de files)
    if (required.includes('W')) {
      if (fileIndexes.length > 0) proofTypes.push('W:present');
      else proofTypes.push('W:absent');
    }
    // M (manual): não é provado automaticamente
    if (hasManual) proofTypes.push('M:pending');

    // Decisão de status (D22/§5.4):
    // - provas automáticas obrigatórias (I, T-outcome, W) todas proved/present
    //   e sem M aberto → proved
    // - provas automáticas provadas + M aberto → manual_pending
    // - alguma prova automática unproved/absent → unproved
    // - (violated é setado externamente por findings do validator)
    const autoRequired = required.filter((r) => r !== 'M');
    const autoFail = proofTypes.some((p) => p.endsWith(':unproved') || p.endsWith(':absent'));
    let status;
    if (autoFail) {
      status = 'unproved';
    } else if (hasManual) {
      status = 'manual_pending';
    } else {
      // Sem M: todas as provas automáticas obrigatórias precisam estar proved
      const allAutoProved = autoRequired.every((r) => {
        const match = proofTypes.find((p) => p.startsWith(`${r}:`));
        return match && (match.endsWith(':proved') || match.endsWith(':present'));
      });
      status = allAutoProved ? 'proved' : 'unproved';
    }
    results.push({ id, status, proof_types: proofTypes });
  }

  return { results, violations };
}

// Valida o shape de acceptance_results[] recebido pelo validatorComplete.
// Shape inválido → fail estrutural (como findings). Não classifica — só valida.
function validateAcceptanceResultsShape(packet, acIds) {
  const violations = [];
  const results = Array.isArray(packet?.acceptance_results) ? packet.acceptance_results : null;
  if (results === null) return { hasField: false, violations };
  const seen = new Set();
  for (const [index, item] of results.entries()) {
    const label = `acceptance_results[${index}]`;
    if (!item || typeof item !== 'object') {
      violations.push(`${label} deve ser objeto`);
      continue;
    }
    if (typeof item.id !== 'string' || !/^AC-\d+$/.test(item.id.trim())) {
      violations.push(`${label}.id deve ser AC-NNN`);
      continue;
    }
    if (seen.has(item.id.trim())) {
      violations.push(`${label}.id duplicado`);
    }
    seen.add(item.id.trim());
    if (!ACCEPTANCE_STATUSES.has(item.status)) {
      violations.push(`${label}.status deve ser proved|unproved|violated|manual_pending`);
    }
    if (item.proof_types !== undefined && !Array.isArray(item.proof_types)) {
      violations.push(`${label}.proof_types deve ser array quando presente`);
    }
  }
  // Se o state declara ACs, todo AC deve aparecer em acceptance_results
  if (Array.isArray(acIds) && acIds.length > 0) {
    for (const acId of acIds) {
      if (!seen.has(acId)) violations.push(`acceptance_results sem AC: ${acId}`);
    }
  }
  return { hasField: true, violations };
}

function stateSchemaVersion(state) {
  return Number(state?.state_schema_version ?? state?.schema ?? 1);
}

function isCompactStateSchema(state) {
  return stateSchemaVersion(state) === STATE_COMPACT_SCHEMA_VERSION;
}

function compactStateStrings(values, label, violations) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    violations.push(`${label} deve ser array no schema compacto`);
    return [];
  }
  return values.filter((value, index) => {
    const ok = typeof value === 'string' && value.trim();
    if (!ok) violations.push(`${label}[${index}] deve ser string não vazia`);
    return ok;
  });
}

function normalizeCompactStateContractIds(state, violations) {
  // Em state_schema_version 3, o writer pode usar forma compacta (contract_ids
  // com arrays de IDs) ou forma expandida (obligations/invariants como arrays
  // de objetos). contract_ids ausente preserva os arrays canônicos do state.
  const ids = state.contract_ids;
  if (ids === undefined) {
    return {
      obligations: Array.isArray(state.obligations) ? state.obligations : [],
      invariants: Array.isArray(state.invariants) ? state.invariants : [],
      scenario_probes: Array.isArray(state.scenario_probes) ? state.scenario_probes : [],
      risk_probes: Array.isArray(state.risk_probes) ? state.risk_probes : [],
    };
  }
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) {
    violations.push('contract_ids deve ser objeto no schema compacto');
    return {
      obligations: [], invariants: [], scenario_probes: [], risk_probes: [],
    };
  }
  const objects = (key) => compactStateStrings(ids[key], `contract_ids.${key}`, violations)
    .map((id) => ({ id }));
  return {
    obligations: objects('obligations'),
    invariants: objects('invariants'),
    scenario_probes: objects('scenarios'),
    risk_probes: objects('risks'),
  };
}

function normalizeCompactStateRefs(refs, table, label, violations) {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) {
    violations.push(`${label} deve ser array no schema compacto`);
    return [];
  }
  const out = [];
  for (const [index, ref] of refs.entries()) {
    if (Number.isInteger(ref)) {
      if (ref < 0 || ref >= table.length) violations.push(`${label}[${index}] índice inválido`);
      else out.push(table[ref]);
    } else if (typeof ref === 'string' && ref.trim()) {
      out.push(ref);
    } else {
      violations.push(`${label}[${index}] deve ser índice ou string`);
    }
  }
  return out;
}

function normalizeCompactStateSnapshot(snapshot, field, violations) {
  if (!Array.isArray(snapshot)) return snapshot;
  return snapshot.map((entry, index) => {
    if (!Array.isArray(entry)) return entry;
    if (entry.length !== 3) violations.push(`${field}[${index}] tupla deve ter 3 itens`);
    return { path: entry[0], status: entry[1], sha256: entry[2] };
  });
}

function normalizeCompactState(state, violations) {
  if (!isCompactStateSchema(state)) return state;
  const fileTable = Array.isArray(state.files_changed) ? state.files_changed : [];
  const checkTable = Array.isArray(state.check_table) ? state.check_table : [];
  if (state.check_table !== undefined && !Array.isArray(state.check_table)) {
    violations.push('check_table deve ser array no schema compacto');
  }
  for (const [index, value] of checkTable.entries()) {
    if (typeof value !== 'string' || !value.trim()) violations.push(`check_table[${index}] deve ser string não vazia`);
  }
  const contracts = normalizeCompactStateContractIds(state, violations);
  const checks = (refs, label) => normalizeCompactStateRefs(refs, checkTable, label, violations);
  const files = (refs, label) => normalizeCompactStateRefs(refs, fileTable, label, violations);
  const evalResults = Array.isArray(state.eval_results) ? state.eval_results.map((item, index) => ({
    ...item,
    checks: checks(item?.checks, `eval_results[${index}].checks`),
  })) : state.eval_results;

  return {
    ...state,
    state_schema_version: STATE_COMPACT_SCHEMA_VERSION,
    obligations: contracts.obligations,
    invariants: contracts.invariants,
    scenario_probes: contracts.scenario_probes,
    risk_probes: contracts.risk_probes,
    eval_results: evalResults,
    evidence_to_claim: Array.isArray(evalResults)
      ? evalResults.map((item) => ({
        claim_id: item?.id,
        evidence: Array.isArray(item?.evidence) ? item.evidence : [],
        status: item?.status,
      }))
      : state.evidence_to_claim,
    validation_map: Array.isArray(state.validation_map) ? state.validation_map.map((item, index) => ({
      ...item,
      checks: checks(item?.checks, `validation_map[${index}].checks`),
    })) : state.validation_map,
    task_evidence: Array.isArray(state.task_evidence) ? state.task_evidence.map((item, index) => ({
      ...item,
      files: files(item?.files, `task_evidence[${index}].files`),
      checks: checks(item?.checks, `task_evidence[${index}].checks`),
    })) : state.task_evidence,
    repair_evidence: Array.isArray(state.repair_evidence) ? state.repair_evidence.map((item, index) => ({
      ...item,
      files_touched: files(item?.files_touched ?? item?.files, `repair_evidence[${index}].files`),
      checks_run: checks(item?.checks_run ?? item?.checks, `repair_evidence[${index}].checks`),
    })) : state.repair_evidence,
    worktree_baseline: normalizeCompactStateSnapshot(state.worktree_baseline, 'worktree_baseline', violations),
    worktree_final: normalizeCompactStateSnapshot(state.worktree_final, 'worktree_final', violations),
  };
}

function extractEvalIdsFromSprint(markdown) {
  return [...new Set([...markdown.matchAll(/\bid\s*:\s*["']?(EVAL-\d+)["']?/g)].map((match) => match[1]))].sort();
}

function normalizeScopePrefix(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('[') || trimmed === '*' || trimmed === '.') return null;
  return path.posix.normalize(trimmed.replaceAll('\\', '/')).replace(/\/$/, '');
}

function pathMatchesScope(rel, scope) {
  const prefix = normalizeScopePrefix(scope);
  if (!prefix) return false;
  const normalized = path.posix.normalize(String(rel).replaceAll('\\', '/'));
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

function validateSprintEvidenceState(state, args, violations) {
  const compactSchema = isCompactStateSchema(state);
  // Declara sprint apenas quando o state aponta explicitamente para um sprint
  // (sprint_file_path/sprint_id). eval_results/policy_scope/evidence_to_claim
  // são campos do v3 base (sempre presentes no compacto, podendo ter conteúdo
  // de proofs EVAL mesmo sem sprint) e NÃO acionam o contrato de sprint — um
  // commit sem sprint_file_path não vira "state que declara sprint" por arrasto.
  const hasSprintContract = state.sprint_file_path !== undefined && state.sprint_file_path !== null
    || state.sprint_id !== undefined && state.sprint_id !== null;
  if (!hasSprintContract) return;

  if (typeof state.sprint_id !== 'string' || !SPRINT_ID_PATTERN.test(state.sprint_id)) {
    violations.push('sprint_id obrigatório/inválido quando state declara sprint');
  }
  if (typeof state.sprint_file_path !== 'string' || !state.sprint_file_path.trim()) {
    violations.push('sprint_file_path obrigatório quando state declara sprint');
    return;
  }

  let sprintMarkdown = '';
  try {
    sprintMarkdown = fs.readFileSync(resolveConsumerPath(state.sprint_file_path, args), 'utf8');
  } catch (error) {
    violations.push(`sprint_file_path inválido: ${error.message}`);
    return;
  }
  const sprintValidation = validateSprintFileConformance(sprintMarkdown, {
    sprintPath: state.sprint_file_path,
    sprintId: state.sprint_id,
  });
  for (const pendency of sprintValidation.pendencies ?? []) {
    violations.push(`sprint_file inválido: ${pendency.category}:${pendency.item}`);
  }

  const evalIds = extractEvalIdsFromSprint(sprintMarkdown);
  if (evalIds.length === 0) violations.push('sprint_file sem EVAL-* verificável');
  if (!Array.isArray(state.eval_results)) {
    violations.push('eval_results deve ser array quando state declara sprint');
  }
  if (!compactSchema && !Array.isArray(state.evidence_to_claim)) {
    violations.push('evidence_to_claim deve ser array quando state declara sprint');
  }

  const evalResults = Array.isArray(state.eval_results) ? state.eval_results : [];
  const seenEval = new Set();
  for (const [index, item] of evalResults.entries()) {
    const label = `eval_results[${index}]`;
    if (!item || typeof item !== 'object') {
      violations.push(`${label} deve ser objeto`);
      continue;
    }
    if (typeof item.id !== 'string' || !EVAL_ID_PATTERN.test(item.id)) violations.push(`${label}.id inválido`);
    else if (seenEval.has(item.id)) violations.push(`${label}.id duplicado`);
    else seenEval.add(item.id);
    if (!EVAL_STATUSES.has(item.status)) violations.push(`${label}.status inválido`);
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    if (item.status === 'passed' && evidence.filter((value) => typeof value === 'string' && value.trim()).length === 0) {
      violations.push(`${label}.evidence obrigatório para status passed`);
    }
  }

  const evidenceToClaim = Array.isArray(state.evidence_to_claim) ? state.evidence_to_claim : [];
  const claimIds = new Set(evidenceToClaim.map((item) => (
    item && typeof item === 'object' ? (item.claim_id ?? item.eval_id ?? item.id) : null
  )).filter((value) => typeof value === 'string'));
  for (const evalId of evalIds) {
    const result = evalResults.find((item) => item?.id === evalId);
    if (!result) violations.push(`EVAL sem resultado no state: ${evalId}`);
    else if (result.status !== 'passed') violations.push(`EVAL não comprovado como passed: ${evalId}:${result.status}`);
    if (!compactSchema && !claimIds.has(evalId)) violations.push(`EVAL sem evidence_to_claim: ${evalId}`);
  }

  if (!state.policy_scope || typeof state.policy_scope !== 'object' || Array.isArray(state.policy_scope)) {
    violations.push('policy_scope obrigatório quando state declara sprint');
    return;
  }
  for (const key of ['forbidden_scope', 'required_gates']) {
    if (!Array.isArray(state.policy_scope[key])) violations.push(`policy_scope.${key} deve ser array`);
  }
  if (state.policy_scope.allowed_scope !== undefined && !Array.isArray(state.policy_scope.allowed_scope)) {
    violations.push('policy_scope.allowed_scope deve ser array quando presente');
  }
  const forbidden = Array.isArray(state.policy_scope.forbidden_scope) ? state.policy_scope.forbidden_scope : [];
  for (const file of state.files_changed ?? []) {
    if (forbidden.some((scope) => pathMatchesScope(file, scope))) {
      violations.push(`arquivo alterado viola policy_scope.forbidden_scope: ${file}`);
    }
  }
}

function snapshotStatus(xy) {
  if (xy === '??') return 'A';
  for (const status of ['U', 'D', 'R', 'C', 'A', 'T', 'M']) {
    if (xy.includes(status)) return status;
  }
  return 'M';
}

function normalizeSnapshotPath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('path vazio');
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'));
  if (path.posix.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('path fora do projeto');
  }
  return normalized;
}

function snapshotHash(root, rel) {
  try {
    const normalized = normalizeSnapshotPath(rel);
    const abs = path.resolve(root, normalized);
    if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) throw new Error('path fora do projeto');
    const stat = fs.lstatSync(abs);
    const content = stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(abs))
      : fs.readFileSync(abs);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

function captureWorktreeSnapshot(root) {
  const raw = execFileSync('git', [
    '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ]);
  const records = raw.toString('utf8').split('\0').filter(Boolean);
  const snapshot = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const xy = record.slice(0, 2);
    const rel = normalizeSnapshotPath(record.slice(3));
    const status = snapshotStatus(xy);
    if (status === 'R' || status === 'C') {
      const previous = normalizeSnapshotPath(records[index + 1]);
      index += 1;
      // .talos/ é território do pipeline (ledger, slices, plans, sprint files);
      // o executor não deve vê-lo como sujeira do worktree de código.
      if (!previous.startsWith('.talos/')) {
        snapshot.push({ path: previous, status: 'D', sha256: null });
      }
    }
    if (!rel.startsWith('.talos/')) {
      snapshot.push({ path: rel, status, sha256: status === 'D' ? null : snapshotHash(root, rel) });
    }
  }
  return snapshot.sort((a, b) => a.path.localeCompare(b.path) || a.status.localeCompare(b.status));
}

function validateSnapshot(snapshot, field, violations) {
  if (!Array.isArray(snapshot)) return;
  const paths = new Set();
  const normalized = [];
  for (const [index, entry] of snapshot.entries()) {
    const label = `${field}[${index}]`;
    if (!entry || typeof entry !== 'object') {
      violations.push(`${label} deve ser objeto`);
      continue;
    }
    let rel;
    try {
      rel = normalizeSnapshotPath(entry.path);
    } catch {
      violations.push(`${label}.path inválido`);
      continue;
    }
    if (paths.has(rel)) violations.push(`${field} contém path duplicado: ${rel}`);
    paths.add(rel);
    if (!['A', 'M', 'D', 'R', 'C', 'T', 'U'].includes(entry.status)) {
      violations.push(`${label}.status inválido`);
    }
    if (entry.status === 'D') {
      if (entry.sha256 !== null) violations.push(`${label}.sha256 deve ser null para delete`);
    } else if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      violations.push(`${label}.sha256 inválido`);
    }
    normalized.push({ path: rel, status: entry.status, sha256: entry.sha256 });
  }
  const sorted = [...normalized].sort((a, b) => a.path.localeCompare(b.path) || a.status.localeCompare(b.status));
  if (JSON.stringify(normalized) !== JSON.stringify(sorted)) violations.push(`${field} deve estar ordenado por path/status`);
}

function snapshotDeltaFiles(baseline, finalSnapshot) {
  const before = new Map(baseline.map((entry) => [entry.path, JSON.stringify(entry)]));
  const after = new Map(finalSnapshot.map((entry) => [entry.path, JSON.stringify(entry)]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((rel) => before.get(rel) !== after.get(rel))
    .sort();
}

function validateStateBoundary(statePathValue, args = {}) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(resolveConsumerPath(statePathValue, args), 'utf8'));
  } catch (error) {
    return { ok: false, violations: [`state_path inválido: ${error.message}`] };
  }
  const violations = [];
  const schemaVersion = stateSchemaVersion(state);
  // D8/LEG2: em 0.15, state v3 é a única versão aceita. v1 (implícito, sem
  // state_schema_version) e v2 são hard-fail — sem reader de migração (D19).
  if (schemaVersion !== STATE_COMPACT_SCHEMA_VERSION) {
    violations.push(
      `state_schema_version deve ser ${STATE_COMPACT_SCHEMA_VERSION} (recebido ${schemaVersion}); artefatos pré-0.15 não são suportados`,
    );
    return { ok: false, legacy: false, state, violations };
  }
  state = normalizeCompactState(state, violations);
  for (const field of STATE_REQUIRED_FIELDS) {
    if (state[field] === undefined || state[field] === null) violations.push(`campo obrigatório ausente: ${field}`);
  }
  for (const field of ['tasks', 'files_changed', 'boundary_refs']) {
    if (!Array.isArray(state[field])) violations.push(`${field} deve ser array`);
  }
  const isDirect = state.executor_skill === 'talos-direct-execute';
  const hasExtension = state.contract_kind !== undefined;
  if (!hasExtension) violations.push('contract_kind obrigatório em state_schema_version 3 (legado pré-extensão removido)');
  if (isDirect && state.contract_kind !== 'direct') violations.push('talos-direct-execute exige contract_kind=direct');
  if (hasExtension && state.executor_skill === 'talos-plan-execute' && state.contract_kind !== 'plan') violations.push('talos-plan-execute exige contract_kind=plan');
  if (hasExtension && !['plan', 'direct'].includes(state.contract_kind)) violations.push('contract_kind deve ser plan ou direct');
  // Extensão (base_sha/head_sha/contract_kind/snapshots) agora obrigatória em todo
  // state v3: o caminho legacy mínimo de talos-plan-execute foi removido (D8/LEG2).
  for (const field of ['base_sha', 'head_sha']) {
    if (typeof state[field] !== 'string' || !state[field].trim()) violations.push(`${field} obrigatório em state_schema_version 3`);
  }
  for (const field of STATE_EXTENSION_ARRAYS) {
    if (!Array.isArray(state[field])) violations.push(`${field} deve ser array em state_schema_version 3`);
  }
  if (isDirect && Array.isArray(state.obligations) && state.obligations.length === 0) violations.push('direct exige obligations não vazio');
  validateSprintEvidenceState(state, args, violations);
  validateSnapshot(state.worktree_baseline, 'worktree_baseline', violations);
  validateSnapshot(state.worktree_final, 'worktree_final', violations);
  if (violations.length > 0) {
    return { ok: violations.length === 0, legacy: false, state, violations };
  }
  const root = consumerRoot(args);
  try {
    gitOutput(root, ['rev-parse', '--verify', `${state.base_sha}^{commit}`]);
    gitOutput(root, ['rev-parse', '--verify', `${state.head_sha}^{commit}`]);
    const currentHead = gitOutput(root, ['rev-parse', 'HEAD']);
    if (currentHead !== state.head_sha) violations.push(`head_sha stale: state=${state.head_sha}, real=${currentHead}`);
    const committed = gitLines(root, ['diff', '--name-only', `${state.base_sha}...${state.head_sha}`]);
    const actualFinal = captureWorktreeSnapshot(root);
    if (JSON.stringify(actualFinal) !== JSON.stringify(state.worktree_final)) {
      violations.push('worktree_final stale: snapshot diverge do working tree atual');
    }
    const worktreeDelta = snapshotDeltaFiles(state.worktree_baseline, state.worktree_final);
    const claimedEvidence = stateEvidenceFiles(state);
    const expectedFiles = [...new Set([...committed, ...worktreeDelta])].sort();
    const declaredFiles = [...new Set((state.files_changed ?? []).filter((f) => typeof f === 'string'))].sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(declaredFiles)) {
      violations.push(`files_changed diverge do boundary real: esperado=${JSON.stringify(expectedFiles)} recebido=${JSON.stringify(declaredFiles)}`);
    }
    if (JSON.stringify(expectedFiles) !== JSON.stringify(claimedEvidence)) {
      violations.push(`evidência diverge do boundary real: esperado=${JSON.stringify(expectedFiles)} recebido=${JSON.stringify(claimedEvidence)}`);
    }
    const statMatch = /^(\d+)\s+files?\b/.exec(String(state.diff_stat).trim());
    if (!statMatch || Number(statMatch[1]) !== expectedFiles.length) {
      violations.push(`diff_stat stale: esperado ${expectedFiles.length} files, recebido=${JSON.stringify(state.diff_stat)}`);
    }
  } catch (error) {
    violations.push(`boundary Git inválido: ${error.message}`);
  }
  return { ok: violations.length === 0, legacy: false, state, violations };
}

function structuredBlockingFindings(packet) {
  const findings = Array.isArray(packet?.findings) ? packet.findings : [];
  return findings.filter((finding) => finding && ['P0', 'P1'].includes(finding.severity));
}

function normalizeFindingsPacket(packet) {
  if (!packet || typeof packet !== 'object') {
    return { packet, violations: ['finding packet obrigatório'] };
  }
  if (!Array.isArray(packet.findings)) {
    return { packet, violations: ['findings deve ser array'] };
  }
  const violations = [];
  const ids = new Set();
  const findings = packet.findings.map((finding, index) => {
    if (!finding || typeof finding !== 'object') {
      violations.push(`finding ${index} deve ser objeto`);
      return finding;
    }
    const label = typeof finding.id === 'string' && finding.id.trim()
      ? finding.id.trim()
      : `finding ${index}`;
    if (typeof finding.id !== 'string' || !/^F-\d{3}$/.test(finding.id.trim())) {
      violations.push(`${label}: id obrigatório no formato F-NNN`);
    } else if (ids.has(finding.id.trim())) {
      violations.push(`${label}: id duplicado`);
    } else {
      ids.add(finding.id.trim());
    }
    if (!['P0', 'P1', 'P2', 'P3'].includes(finding.severity)) {
      violations.push(`${label}: severity deve ser P0|P1|P2|P3`);
    }
    for (const field of ['file', 'failure_mode', 'evidence', 'recommendation', 'fix_validation']) {
      if (typeof finding[field] !== 'string' || !finding[field].trim()) violations.push(`${label}: ${field} obrigatório`);
    }
    if (!Number.isInteger(finding.line) || finding.line < 1) violations.push(`${label}: line inválida`);
    return { ...finding, msg: `${finding.failure_mode ?? ''}: ${finding.evidence ?? ''}`.trim() };
  });
  return { packet: { ...packet, findings }, violations };
}

function validatorStart(args, context) {
  const runId = validateRunId(args.run_id);
  const statePathValue = requiredString(args, 'state_path');
  const timestamp = nowIso();
  const cycle = normalizeValidatorCycle(context.state.data?.validator_cycle ?? {});

  if (context.dispatch.active?.phase !== 'plan_execute') {
    return {
      gate: 'G4',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: 'Validator só pode iniciar com plan_execute ativo',
      current_phase: context.dispatch.active?.phase ?? null,
      next_action: 'manter_plan_execute_ativo_antes_da_validacao',
    };
  }

  const liveness = context.dispatch.active.liveness && typeof context.dispatch.active.liveness === 'object'
    ? context.dispatch.active.liveness
    : null;

  // INV1 / AC-1.3.2 (D5): o frio só abre por commit MCP com sha no ledger.
  // Exigimos handoff_ready (commitState marcou) E sha256(disco) ==
  // liveness.slice_commit_sha256 E o path é o do último commit. JSON parseável
  // escrito à mão (sem sha no ledger) ou com sha divergente → blocked órfão.
  // Não cai só em validateStateBoundary: o boundary pode estar ok e o arquivo
  // ainda assim ser órfão (dual-writer).
  const sliceAbs = resolveConsumerPath(statePathValue, args);
  let diskSha = null;
  try {
    if (fs.existsSync(sliceAbs)) diskSha = sha256HexFile(sliceAbs);
  } catch {
    diskSha = null;
  }
  const commitSha = liveness?.slice_commit_sha256 ?? null;
  const commitPath = liveness?.last_commit_state_path ?? null;
  if (
    liveness?.status !== 'handoff_ready'
    || typeof commitSha !== 'string'
    || diskSha === null
    || diskSha !== commitSha
    || commitPath !== statePathValue
  ) {
    const orphan = liveness?.status === 'handoff_ready' && typeof commitSha === 'string'
      && diskSha !== null && diskSha !== commitSha;
    return {
      gate: 'G12',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: orphan
        ? 'Validator bloqueado: sha do disco diverge do último commit MCP (órfão/dual-writer)'
        : 'Validator bloqueado: slice sem commit MCP com sha no ledger (JSON à mão não abre o frio)',
      current_phase: 'plan_execute',
      executor_liveness: liveness?.status ?? 'not_tracked',
      expected_commit: 'talos_commit_state',
      state_path: statePathValue,
      last_commit_state_path: commitPath,
      slice_commit_sha256: commitSha,
      next_action: orphan
        ? 'remover_ou_recommitar_slice_orfã'
        : 'commitar_via_talos_commit_state_antes_do_validator',
    };
  }

  const boundaryValidation = validateStateBoundary(statePathValue, args);
  if (!boundaryValidation.ok) {
    return {
      gate: 'G4', action: 'start', status: 'blocked', timestamp,
      state_path: statePathValue,
      boundary_violations: boundaryValidation.violations,
      error: `State/boundary inválido: ${boundaryValidation.violations.join('; ')}`,
      next_action: 'regerar_state_path_com_boundary_real',
    };
  }

  if (cycle.active) {
    return {
      gate: 'G4',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: `Validator já está ativo (attempt ${cycle.active.attempt})`,
      validator_attempt: cycle.active.attempt,
      next_action: 'aguardar_validator_ativo',
    };
  }

  // SPEC_FSM_SIBLING_S02 §1.3 / D-S02-2: `passed` e `passed_with_observations`
  // são terminais SEM transição de saída. A slice fechou com sucesso; um novo
  // validatorStart não pode reabri-la. Este guard DEVE preceder o HF-05
  // (attempts_used >= max_attempts) porque quando o terminal é atingido no
  // attempt 2 (último), attempts_used==max_attempts==2 — sem a prioridade
  // correta, HF-05 dispararia primeiro retornando causa enganosa
  // ("Terceiro validator proibido") em vez da causa real ("terminal não reabre").
  if (VALIDATOR_PASSED_STATUSES.has(cycle.status)) {
    return {
      gate: 'G4',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: `Ciclo do validator já concluído (${cycle.status}); terminal não reabre para novo dispatch`,
      validator_status: cycle.status,
      next_action: 'encerrar_slice_terminal_aprovada',
    };
  }

  // HF-05: teto de max_attempts atingido. Só chega aqui se o ciclo NÃO está
  // em estado terminal aprovado (guard acima já descartou esse caso).
  if (cycle.attempts_used >= cycle.max_attempts) {
    return {
      gate: 'G4',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: `Terceiro validator proibido: attempts=${cycle.attempts_used}, máximo=${cycle.max_attempts}`,
      validator_attempt: cycle.attempts_used,
      next_action: 'tratar_como_blocked_final_validator_failed',
    };
  }

  if (cycle.status === 'blocked') {
    return {
      gate: 'G4',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: 'Ciclo do validator já está bloqueado para esta slice',
      next_action: 'encerrar_run_ou_reiniciar_slice_com_decisao_explicita',
    };
  }

  if (cycle.status === 'repair_required' || cycle.status === 'repair_running') {
    return {
      gate: 'G4',
      action: 'start',
      status: 'blocked',
      timestamp,
      error: cycle.status === 'repair_running'
        ? 'Retry do validator exige o término do repair ativo antes de novo dispatch'
        : 'Retry do validator exige conclusão explícita do repair antes de novo dispatch',
      validator_attempt: cycle.attempts_used,
      next_action: 'complete_findings_repair',
    };
  }

  const attempt = cycle.attempts_used + 1;
  const activeValidatorRunId = validatorRunId(runId, attempt, timestamp);
  // S04: token de dispatch monotônico — incrementa a cada dispatch aceito
  // (status passed). Nunca decrementado nem reusado dentro da slice.
  const dispatchToken = cycle.dispatch_token + 1;
  // P1.1: challenge de proof-of-work amarrado a este attempt. null se o boundary
  // não tem arquivo legível (best-effort, não bloqueia). Vai ao validador via
  // validator_recovery.challenge (canal canônico) e também ecoa aqui pro log.
  const challenge = pickValidatorChallenge(statePathValue, args, dispatchToken);
  return {
    gate: 'G4',
    action: 'start',
    status: 'passed',
    timestamp,
    state_path: statePathValue,
    validator_attempt: attempt,
    validator_run_id: activeValidatorRunId,
    validator_status: 'running',
    dispatch_token: dispatchToken,
    challenge,
    next_action: 'await_validator_verdict',
    banner: renderBanner('validacao', { status: `running ${attempt}/${cycle.max_attempts}` }),
    validator_cycle: {
      dispatch_token: dispatchToken,
      max_attempts: cycle.max_attempts,
      attempts_used: attempt,
      status: 'running',
      active: {
        attempt,
        run_id: activeValidatorRunId,
        state_path: statePathValue,
        dispatch_token: dispatchToken,
        challenge,
        started_at: timestamp,
      },
      last_state_path: statePathValue,
      repair: {
        skill: WORKFLOW_CONFIG.skills.findings_repair,
        status: cycle.repair.status === 'completed' ? 'completed' : 'not_needed',
        required_from_attempt: cycle.repair.required_from_attempt,
        requested_at: cycle.repair.requested_at,
        completed_at: cycle.repair.completed_at,
        active: null,
      },
      // O retry precisa manter os findings originais: o complete do attempt 2
      // correlaciona `repaired_finding_ids` contra exatamente esse packet.
      findings_packet: attempt === 2 ? cycle.findings_packet : null,
    },
  };
}

function validatorComplete(args, context) {
  const timestamp = nowIso();
  const cycle = normalizeValidatorCycle(context.state.data?.validator_cycle ?? {});
  const statePathValue = requiredString(args, 'state_path');
  const activeValidatorRunId = requiredString(args, 'validator_run_id');
  const verdict = requiredString(args, 'verdict');
  const packetResult = normalizeFindingsPacket(optionalData(args));
  const packet = packetResult.packet;
  // S04/S16: token de dispatch é obrigatório para fechar o slot ativo. Ele vem
  // do validator_recovery lido pela folha fria e volta no output estruturado do
  // validator. Sem token não existe garantia anti-stale completa.
  const dispatchToken = optionalInteger(args, 'dispatch_token');
  const challengeResponse = optionalString(args, 'challenge_response');
  const validatorOutputPath = optionalString(args, 'validator_output_path');

  if (!cycle.active) {
    // S10: slot já fechado. Distinguir retorno duplicado já aplicado (idempotente
    // reconhecível) de payload sem nenhum slot conhecido. NUNCA reabrir o ciclo.
    // A idempotência vive em `applied`, não no history curto de observabilidade.
    const appliedCompleteEvent = appliedValidatorCompletion(cycle, activeValidatorRunId);
    if (appliedCompleteEvent) {
      return {
        gate: 'G4',
        action: 'complete',
        status: 'blocked',
        timestamp,
        validator_run_id: activeValidatorRunId,
        state_path: statePathValue,
        stale_discarded: true,
        reason: 'stale_duplicate_already_applied',
        last_verdict: cycle.last_verdict,
        // S10/P3-2: ecoa o veredito real que o complete casado produziu no history
        // (repair_required, passed, passed_with_observations,
        // blocked_final_validator_failed). last_verdict reflete só o ciclo atual e
        // pode divergir do estado real daquele evento — applied_validator_status
        // evita que o consumidor leia um fail→repair como conclusão bem-sucedida.
        applied_validator_status: appliedCompleteEvent.validator_status ?? null,
        error: `Retorno duplicado do validator já aplicado (run_id ${activeValidatorRunId}); descartado de forma idempotente`,
        next_action: 'descartar_retorno_duplicado_idempotente',
      };
    }
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      stale_discarded: true,
      error: 'Nenhum validator ativo para concluir',
      next_action: 'start_validator_primeiro',
    };
  }

  if (cycle.active.run_id !== activeValidatorRunId) {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      stale_discarded: true,
      error: `validator_run_id não corresponde ao validator ativo: recebido ${activeValidatorRunId}`,
      next_action: 'aguardar_ou_descartar_retorno_stale_do_validator',
    };
  }

  if (cycle.active.state_path !== statePathValue) {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      stale_discarded: true,
      error: `state_path do validator ativo diverge: esperado ${cycle.active.state_path}, recebido ${statePathValue}`,
      next_action: 'corrigir_payload_do_validator',
    };
  }

  if (dispatchToken === undefined) {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      stale_discarded: true,
      error: 'dispatch_token obrigatório para concluir validator ativo',
      next_action: 'reler_validator_recovery_e_reenviar_token',
    };
  }

  // S04: verificação idempotente do token de dispatch (anti-stale).
  // Divergência → blocked SEM fechar o slot (não retorna validator_cycle, então
  // active é preservado pelo merge).
  // S10: marca stale_discarded para o orquestrador distinguir stale de erro real.
  if (cycle.active.dispatch_token !== dispatchToken) {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      stale_discarded: true,
      error: `token de dispatch divergente: esperado ${cycle.active.dispatch_token}, recebido ${dispatchToken}`,
      next_action: 'aguardar_ou_descartar_retorno_stale_do_validator',
    };
  }

  // P1.1: proof-of-work. Só vale se o start emitiu challenge (cycle.active.challenge).
  // Falha (resposta ausente/hash divergente) NÃO fecha o slot — igual stale: active é
  // preservado (não retornamos validator_cycle), o orquestrador re-despacha o MESMO
  // validador (mesmo attempt) que lê o boundary e reenvia o hash correto. Não consome
  // attempt nem reabre terminal. Arquivo sumido/ilegível consome o mesmo orçamento bounded.
  const challengeCheck = verifyValidatorChallenge(cycle.active.challenge, challengeResponse, args);
  if (!challengeCheck.ok) {
    // P2-1: falhas de challenge são bounded por attempt. O contador vive em
    // `applied.challenge_failures`; history pode ser truncado sem reabrir loop.
    const priorChallengeFailures = appliedChallengeFailures(cycle, activeValidatorRunId);
    if (priorChallengeFailures >= VALIDATOR_CHALLENGE_MAX_FAILURES) {
      return {
        gate: 'G4',
        action: 'complete',
        status: 'blocked',
        timestamp,
        validator_attempt: cycle.active.attempt,
        validator_run_id: activeValidatorRunId,
        state_path: statePathValue,
        validator_status: 'challenge_exhausted',
        challenge_file: cycle.active.challenge.file,
        error: `Proof-of-work do validador falhou ${priorChallengeFailures + 1}x (máximo=${VALIDATOR_CHALLENGE_MAX_FAILURES}) para ${cycle.active.challenge.file}; re-dispatch encerrado`,
        cause: 'validator_proof_of_work_exhausted',
        impact: 'validador_nao_comprovou_leitura_do_boundary_apos_teto_de_tentativas',
        next_action: 'encerrar_com_blocked_e_investigar_resolucao_de_path_do_challenge_no_host',
        banner: renderBanner('validacao', { status: 'blocked_challenge_exhausted' }),
        validator_cycle: {
          dispatch_token: cycle.dispatch_token,
          status: 'blocked',
          active: null,
          last_state_path: statePathValue,
          last_verdict: cycle.last_verdict,
          findings_packet: cycle.findings_packet,
          repair: cycle.repair,
          applied: appendAppliedValidatorCompletion(cycle.applied, {
            validator_run_id: activeValidatorRunId,
            validator_status: 'challenge_exhausted',
            status: 'blocked',
            state_path: statePathValue,
            attempt: cycle.active.attempt,
            timestamp,
          }),
        },
      };
    }
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      validator_status: 'challenge_failed',
      challenge_file: cycle.active.challenge.file,
      challenge_failures: priorChallengeFailures + 1,
      challenge_failures_max: VALIDATOR_CHALLENGE_MAX_FAILURES,
      error: `Proof-of-work do validador falhou (${challengeCheck.reason}): o veredito não comprovou leitura de ${cycle.active.challenge.file}`,
      cause: 'validator_proof_of_work_failed',
      impact: 'sem_prova_de_leitura_do_boundary_o_veredito_pode_nao_ter_lido_o_codigo',
      next_action: 'redespachar_o_mesmo_validador_irmao_que_le_o_boundary_e_reenvia_challenge_response',
      validator_cycle: {
        applied: setAppliedChallengeFailures(cycle.applied, activeValidatorRunId, priorChallengeFailures + 1),
      },
    };
  }
  const challengeVerified = !cycle.active.challenge ? 'no_challenge' : 'verified';

  if (validatorOutputPath) {
    const outputPath = resolveConsumerPath(validatorOutputPath, args);
    const jsonCheck = validateJsonArtifactFile(outputPath);
    if (!jsonCheck.ok) {
      return {
        gate: 'G4',
        action: 'complete',
        status: 'blocked',
        timestamp,
        validator_attempt: cycle.active.attempt,
        validator_run_id: activeValidatorRunId,
        state_path: statePathValue,
        validator_output_path: validatorOutputPath,
        validator_status: 'invalid_validator_output_json',
        error: `Output JSON do validator inválido: ${validatorOutputPath}`,
        cause: jsonCheck.error,
        impact: 'relatorio_do_validador_nao_e_parseavel_como_json_confiavel',
        next_action: 'regenerar_validator_output_json_por_serializer_e_reenviar_complete',
      };
    }
  }

  if (packetResult.violations.length > 0) {
    return {
      gate: 'G4', action: 'complete', status: 'blocked', timestamp,
      validator_attempt: cycle.active.attempt, validator_run_id: activeValidatorRunId,
      state_path: statePathValue, validator_status: 'invalid_finding_shape',
      error: `Finding estruturado inválido: ${packetResult.violations.join('; ')}`,
      next_action: 'corrigir_shape_estruturado_do_finding',
    };
  }

  // D05/D22: quando o state declara sprint_file_path, o validator deve emitir
  // acceptance_results[] com shape estrito cobrindo todos os AC-* do §7.3.
  // Shape inválido ou cobertura incompleta → fail estrutural (como findings).
  // Classificação proved/unproved/manual_pending é do oráculo mecânico
  // (classifyAcceptanceResults); o packet do LLM deve ecoar o oráculo.
  // `violated` pode ser escalado pelo validator via findings (não pelo oráculo).
  let sprintAcIds = null;
  let boundaryStateForOracle = null;
  let sprintAcceptanceForOracle = null;
  try {
    boundaryStateForOracle = JSON.parse(fs.readFileSync(resolveConsumerPath(statePathValue, args), 'utf8'));
    if (typeof boundaryStateForOracle?.sprint_file_path === 'string' && boundaryStateForOracle.sprint_file_path.trim()) {
      const sprintMarkdown = fs.readFileSync(
        resolveConsumerPath(boundaryStateForOracle.sprint_file_path, args),
        'utf8',
      );
      sprintAcceptanceForOracle = parseAcceptanceContract(sprintMarkdown);
      sprintAcIds = sprintAcceptanceForOracle
        .map((ac) => ac.id)
        .filter((id) => typeof id === 'string' && id.trim());
    }
  } catch {
    // State/sprint ilegível: o boundary já foi validado no start; aqui apenas
    // não conseguimos derivar AC ids — a checagem de shape segue sem cobertura.
    sprintAcIds = null;
    boundaryStateForOracle = null;
    sprintAcceptanceForOracle = null;
  }
  const acceptanceCheck = validateAcceptanceResultsShape(packet, sprintAcIds);
  if (acceptanceCheck.hasField && acceptanceCheck.violations.length > 0) {
    return {
      gate: 'G4', action: 'complete', status: 'blocked', timestamp,
      validator_attempt: cycle.active.attempt, validator_run_id: activeValidatorRunId,
      state_path: statePathValue, validator_status: 'invalid_acceptance_shape',
      error: `acceptance_results com shape inválido: ${acceptanceCheck.violations.join('; ')}`,
      next_action: 'corrigir_shape_de_acceptance_results',
    };
  }
  if (sprintAcIds && sprintAcIds.length > 0 && !acceptanceCheck.hasField) {
    return {
      gate: 'G4', action: 'complete', status: 'blocked', timestamp,
      validator_attempt: cycle.active.attempt, validator_run_id: activeValidatorRunId,
      state_path: statePathValue, validator_status: 'missing_acceptance_results',
      error: `state declara sprint_file_path; validator deve emitir acceptance_results cobrindo ${sprintAcIds.join(', ')}`,
      next_action: 'emitir_acceptance_results_no_output_do_validator',
    };
  }
  if (acceptanceCheck.hasField && sprintAcceptanceForOracle && boundaryStateForOracle) {
    const root = consumerRoot(args);
    const oracle = classifyAcceptanceResults(
      boundaryStateForOracle,
      sprintAcceptanceForOracle,
      {
        readText: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
      },
    );
    const oracleById = new Map(oracle.results.map((item) => [item.id, item]));
    const mismatches = [];
    for (const item of packet.acceptance_results) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const expected = oracleById.get(id);
      if (!expected) continue;
      // Findings podem escalar para violated; demais status devem ecoar o oráculo.
      if (item.status === 'violated') continue;
      if (item.status !== expected.status) {
        mismatches.push(
          `${id}: packet=${item.status} oracle=${expected.status}`
          + ` [${(expected.proof_types ?? []).join(',')}]`,
        );
      }
    }
    if (mismatches.length > 0) {
      return {
        gate: 'G4', action: 'complete', status: 'blocked', timestamp,
        validator_attempt: cycle.active.attempt, validator_run_id: activeValidatorRunId,
        state_path: statePathValue, validator_status: 'acceptance_oracle_mismatch',
        error: `acceptance_results diverge do oráculo mecânico: ${mismatches.join('; ')}`,
        next_action: 'corrigir_acceptance_results_para_ecoar_oraculo',
      };
    }
  }

  // D05/D22 + CN2/VC1 (Plano 3) + A6 (fechamento Plano F): o eco validado do
  // oráculo é persistido no state em disco — fonte que o gate de status consome
  // (`readStateAcceptanceResults`). Sem esta escrita, MVP/done ficam inalcançáveis
  // (ambos exigem o campo). Falha de FS aqui é fail-closed no próprio complete:
  // não devolver passed com eco só no packet — o gate de done deixaria de mentir
  // só se o state tivesse sido gravado; se a gravação falhou, o complete bloqueia.
  if (acceptanceCheck.hasField && Array.isArray(packet.acceptance_results) && boundaryStateForOracle) {
    try {
      const stateAbs = resolveConsumerPath(statePathValue, args);
      boundaryStateForOracle.acceptance_results = packet.acceptance_results;
      fs.writeFileSync(stateAbs, `${JSON.stringify(boundaryStateForOracle, null, 2)}\n`);
    } catch (err) {
      return {
        gate: 'G4', action: 'complete', status: 'blocked', timestamp,
        validator_attempt: cycle.active.attempt, validator_run_id: activeValidatorRunId,
        state_path: statePathValue, validator_status: 'acceptance_results_persist_failed',
        error: `Falha ao persistir acceptance_results no state: ${err?.message ?? err}`,
        next_action: 'corrigir_gravacao_do_state_e_reemitir_complete',
      };
    }
  }

  const normalizedVerdict = verdict === 'pass'
    ? 'passed'
    : verdict === 'pass_with_observations'
      ? 'passed_with_observations'
      : verdict;

  const blockingFindings = structuredBlockingFindings(packet);
  if (VALIDATOR_PASSED_STATUSES.has(normalizedVerdict) && blockingFindings.length > 0) {
    return {
      gate: 'G4', action: 'complete', status: 'blocked', timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      validator_status: 'invalid_verdict_severity',
      finding_ids: blockingFindings.map((finding) => finding.id ?? null),
      error: `${blockingFindings[0].severity} exige verdict fail`,
      next_action: 'corrigir_veredito_estruturado_do_validator',
    };
  }

  if (cycle.active.attempt === 2
    && cycle.repair.status === 'completed'
    && VALIDATOR_PASSED_STATUSES.has(normalizedVerdict)) {
    const targetIds = structuredBlockingFindings(cycle.findings_packet)
      .map((finding) => finding.id)
      .filter((id) => typeof id === 'string' && id.trim());
    const correlated = new Set(Array.isArray(packet?.repaired_finding_ids) ? packet.repaired_finding_ids : []);
    const missingIds = targetIds.filter((id) => !correlated.has(id));
    if (missingIds.length > 0) {
      return {
        gate: 'G4', action: 'complete', status: 'blocked', timestamp,
        validator_attempt: cycle.active.attempt, validator_run_id: activeValidatorRunId,
        state_path: statePathValue, validator_status: 'repair_correlation_missing',
        missing_finding_ids: missingIds,
        error: 'Segundo validator não correlacionou todos os findings reparados',
        next_action: 'revalidar_repair_e_retornar_repaired_finding_ids',
      };
    }
  }

  if (VALIDATOR_PASSED_STATUSES.has(normalizedVerdict)) {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'passed',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      validator_status: normalizedVerdict,
      challenge_verified: challengeVerified,
      next_action: 'complete_plan_execute',
      banner: renderBanner('validacao', { status: normalizedVerdict }),
      validator_cycle: {
        dispatch_token: cycle.dispatch_token,
        status: normalizedVerdict,
        active: null,
        last_state_path: statePathValue,
        last_verdict: normalizedVerdict,
        findings_packet: packet ?? null,
        repair: {
          skill: WORKFLOW_CONFIG.skills.findings_repair,
          status: cycle.repair.status === 'completed' ? 'completed' : 'not_needed',
          required_from_attempt: cycle.repair.required_from_attempt,
          requested_at: cycle.repair.requested_at,
          completed_at: cycle.repair.completed_at,
          active: null,
        },
        applied: appendAppliedValidatorCompletion(cycle.applied, {
          validator_run_id: activeValidatorRunId,
          validator_status: normalizedVerdict,
          status: 'passed',
          state_path: statePathValue,
          attempt: cycle.active.attempt,
          timestamp,
        }),
      },
    };
  }

  if (normalizedVerdict !== 'fail') {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      error: `Veredito inválido do validator: ${verdict}`,
      validator_attempt: cycle.active.attempt,
      next_action: 'corrigir_output_do_validator',
    };
  }

  if (cycle.active.attempt >= cycle.max_attempts) {
    return {
      gate: 'G4',
      action: 'complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.active.attempt,
      validator_run_id: activeValidatorRunId,
      state_path: statePathValue,
      validator_status: 'blocked_final_validator_failed',
      challenge_verified: challengeVerified,
      error: `Segundo validator falhou; terceiro validator é proibido (máximo=${cycle.max_attempts})`,
      next_action: 'encerrar_com_blocked_final_validator_failed',
      banner: renderBanner('validacao', { status: 'blocked_final_validator_failed' }),
      validator_cycle: {
        dispatch_token: cycle.dispatch_token,
        status: 'blocked',
        active: null,
        last_state_path: statePathValue,
        last_verdict: 'fail',
        findings_packet: packet ?? null,
        repair: {
          skill: WORKFLOW_CONFIG.skills.findings_repair,
          status: 'exhausted',
          required_from_attempt: cycle.active.attempt,
          requested_at: cycle.repair.requested_at,
          completed_at: cycle.repair.completed_at,
          active: null,
        },
        applied: appendAppliedValidatorCompletion(cycle.applied, {
          validator_run_id: activeValidatorRunId,
          validator_status: 'blocked_final_validator_failed',
          status: 'blocked',
          state_path: statePathValue,
          attempt: cycle.active.attempt,
          timestamp,
        }),
      },
    };
  }

  return {
    gate: 'G4',
    action: 'complete',
    status: 'passed',
    timestamp,
    validator_attempt: cycle.active.attempt,
    validator_run_id: activeValidatorRunId,
    state_path: statePathValue,
    validator_status: 'repair_required',
    challenge_verified: challengeVerified,
    next_action: 'start_findings_repair_lock',
    banner: renderBanner('validacao', { status: 'repair_required' }),
    validator_cycle: {
      dispatch_token: cycle.dispatch_token,
      status: 'repair_required',
      active: null,
      last_state_path: statePathValue,
      last_verdict: 'fail',
      findings_packet: packet ?? null,
      repair: {
        skill: WORKFLOW_CONFIG.skills.findings_repair,
        status: 'required',
        required_from_attempt: cycle.active.attempt,
        requested_at: timestamp,
        completed_at: null,
        active: null,
      },
      applied: appendAppliedValidatorCompletion(cycle.applied, {
        validator_run_id: activeValidatorRunId,
        validator_status: 'repair_required',
        status: 'passed',
        state_path: statePathValue,
        attempt: cycle.active.attempt,
        timestamp,
      }),
    },
  };
}

function validatorRepairStart(args, context) {
  const runId = validateRunId(args.run_id);
  const timestamp = nowIso();
  const cycle = normalizeValidatorCycle(context.state.data?.validator_cycle ?? {});
  const statePathValue = requiredString(args, 'state_path');

  if (cycle.active) {
    return {
      gate: 'G4',
      action: 'repair_start',
      status: 'blocked',
      timestamp,
      error: 'Repair não pode iniciar enquanto há validator ativo',
      validator_attempt: cycle.active.attempt,
      next_action: 'aguardar_validator_ativo',
    };
  }

  if (cycle.repair.active) {
    return {
      gate: 'G4',
      action: 'repair_start',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.attempts_used,
      repair_run_id: cycle.repair.active.run_id ?? null,
      error: `Repair já está ativo para attempt ${cycle.attempts_used}`,
      next_action: 'aguardar_findings_repair_ativo',
    };
  }

  if (cycle.status !== 'repair_required') {
    return {
      gate: 'G4',
      action: 'repair_start',
      status: 'blocked',
      timestamp,
      error: `Repair fora de ordem: status atual ${cycle.status}`,
      next_action: 'completar_validator_fail_antes_do_repair',
    };
  }

  if (cycle.last_state_path && cycle.last_state_path !== statePathValue) {
    return {
      gate: 'G4',
      action: 'repair_start',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.attempts_used,
      state_path: statePathValue,
      error: `Repair deve partir do state_path do fail: esperado ${cycle.last_state_path}, recebido ${statePathValue}`,
      next_action: 'corrigir_state_path_do_repair',
    };
  }


  const boundaryBefore = validateStateBoundary(statePathValue, args);
  if (!boundaryBefore.ok) {
    return {
      gate: 'G4', action: 'repair_start', status: 'blocked', timestamp,
      state_path: statePathValue,
      boundary_violations: boundaryBefore.violations,
      error: `Repair bloqueado por state/boundary inválido: ${boundaryBefore.violations.join('; ')}`,
      next_action: 'corrigir_state_path_antes_do_repair',
    };
  }

  const activeRepairRunId = repairRunId(runId, cycle.attempts_used, timestamp);
  return {
    gate: 'G4',
    action: 'repair_start',
    status: 'passed',
    timestamp,
    validator_attempt: cycle.attempts_used,
    repair_run_id: activeRepairRunId,
    repair_budget: 1,
    findings: cycle.findings_packet?.findings ?? [],
    state_path: statePathValue,
    validator_status: 'repair_running',
    next_action: `dispatch_${WORKFLOW_CONFIG.skills.findings_repair}`,
    banner: renderBanner('validacao', { status: 'repair_running' }),
    validator_cycle: {
      status: 'repair_running',
      repair: {
        skill: WORKFLOW_CONFIG.skills.findings_repair,
        status: 'running',
        required_from_attempt: cycle.repair.required_from_attempt ?? cycle.attempts_used,
        requested_at: cycle.repair.requested_at ?? timestamp,
        completed_at: null,
        active: {
          run_id: activeRepairRunId,
          state_path: statePathValue,
          started_at: timestamp,
          boundary_before: {
            head_sha: boundaryBefore.state.head_sha ?? null,
            diff_stat: boundaryBefore.state.diff_stat,
            files_changed: boundaryBefore.state.files_changed,
            worktree_final: boundaryBefore.state.worktree_final ?? null,
          },
        },
      },
    },
  };
}

function validatorRepairComplete(args, context) {
  const timestamp = nowIso();
  const cycle = normalizeValidatorCycle(context.state.data?.validator_cycle ?? {});
  const statePathValue = requiredString(args, 'state_path');
  const activeRepairRunId = requiredString(args, 'repair_run_id');
  const repairData = optionalData(args);

  if (cycle.active) {
    return {
      gate: 'G4',
      action: 'repair_complete',
      status: 'blocked',
      timestamp,
      error: 'Repair não pode fechar enquanto há validator ativo',
      validator_attempt: cycle.active.attempt,
      next_action: 'aguardar_validator_ativo',
    };
  }

  // S10: idempotência reconhecível sem depender do history truncado.
  const appliedRepairEvent = appliedRepairCompletion(cycle, activeRepairRunId);

  if (cycle.status !== 'repair_running') {
    return {
      gate: 'G4',
      action: 'repair_complete',
      status: 'blocked',
      timestamp,
      repair_run_id: activeRepairRunId,
      stale_discarded: true,
      ...(appliedRepairEvent ? { reason: 'repair_duplicate_already_applied' } : {}),
      error: appliedRepairEvent
        ? `Repair duplicado já aplicado (run_id ${activeRepairRunId}); descartado de forma idempotente`
        : `Repair fora de ordem: status atual ${cycle.status}`,
      next_action: appliedRepairEvent
        ? 'descartar_retorno_duplicado_idempotente'
        : 'iniciar_findings_repair_antes_de_concluir',
    };
  }

  if (!cycle.repair.active) {
    return {
      gate: 'G4',
      action: 'repair_complete',
      status: 'blocked',
      timestamp,
      repair_run_id: activeRepairRunId,
      stale_discarded: true,
      ...(appliedRepairEvent ? { reason: 'repair_duplicate_already_applied' } : {}),
      error: appliedRepairEvent
        ? `Repair duplicado já aplicado (run_id ${activeRepairRunId}); descartado de forma idempotente`
        : 'Nenhum repair ativo para concluir',
      next_action: appliedRepairEvent
        ? 'descartar_retorno_duplicado_idempotente'
        : 'start_findings_repair_primeiro',
    };
  }

  if (cycle.repair.active.run_id !== activeRepairRunId) {
    return {
      gate: 'G4',
      action: 'repair_complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.attempts_used,
      repair_run_id: activeRepairRunId,
      stale_discarded: true,
      ...(appliedRepairEvent ? { reason: 'repair_duplicate_already_applied' } : {}),
      error: `repair_run_id não corresponde ao repair ativo: recebido ${activeRepairRunId}`,
      next_action: 'aguardar_ou_descartar_retorno_stale_do_repair',
    };
  }

  if (cycle.repair.active.state_path !== statePathValue) {
    return {
      gate: 'G4',
      action: 'repair_complete',
      status: 'blocked',
      timestamp,
      validator_attempt: cycle.attempts_used,
      repair_run_id: activeRepairRunId,
      state_path: statePathValue,
      stale_discarded: true,
      error: `state_path do repair ativo diverge: esperado ${cycle.repair.active.state_path}, recebido ${statePathValue}`,
      next_action: 'atualizar_o_state_path_original_sem_redirecionar_boundary',
    };
  }


  const boundaryAfter = validateStateBoundary(statePathValue, args);
  if (!boundaryAfter.ok) {
    return {
      gate: 'G4', action: 'repair_complete', status: 'blocked', timestamp,
      repair_run_id: activeRepairRunId, state_path: statePathValue,
      boundary_violations: boundaryAfter.violations,
      error: `Repair não atualizou state/boundary completo: ${boundaryAfter.violations.join('; ')}`,
      next_action: 'atualizar_head_stat_snapshots_files_e_evidencias_no_state_original',
    };
  }

  const targets = structuredBlockingFindings(cycle.findings_packet).filter(
    (finding) => typeof finding.id === 'string' && finding.id.trim(),
  );
  const findings = Array.isArray(cycle.findings_packet?.findings) ? cycle.findings_packet.findings : [];
  const receivedIds = new Set(findings.map((finding) => finding?.id).filter(Boolean));
  const repairs = Array.isArray(repairData?.repairs) ? repairData.repairs : [];
  const stateRepairs = Array.isArray(boundaryAfter.state.repair_evidence)
    ? boundaryAfter.state.repair_evidence
    : [];
  const repairViolations = [];
  for (const [label, entries] of [['output', repairs], ['state', stateRepairs]]) {
    const seen = new Set();
    for (const repair of entries) {
      const id = repair?.finding_id;
      if (!receivedIds.has(id)) repairViolations.push(`${label}: repair ID desconhecido ${id ?? '<ausente>'}`);
      if (seen.has(id)) repairViolations.push(`${label}: repair ID duplicado ${id}`);
      seen.add(id);
      if (!Array.isArray(repair?.files_touched) || repair.files_touched.length === 0) {
        repairViolations.push(`${label}: ${id ?? '<ausente>'} sem files_touched`);
      }
    }
  }
  const normalizeRepair = (repair) => ({
    finding_id: repair.finding_id,
    files_touched: [...repair.files_touched].sort(),
    checks_run: [...(repair.checks_run ?? [])].sort(),
    status: repair.status,
  });
  if (repairViolations.length === 0) {
    const outputNormalized = repairs.map(normalizeRepair).sort((a, b) => a.finding_id.localeCompare(b.finding_id));
    const stateNormalized = stateRepairs.map(normalizeRepair).sort((a, b) => a.finding_id.localeCompare(b.finding_id));
    if (JSON.stringify(outputNormalized) !== JSON.stringify(stateNormalized)) {
      repairViolations.push('output do repair diverge de repair_evidence persistido');
    }
  }
  const before = cycle.repair.active.boundary_before;
  if (Array.isArray(before?.worktree_final) && Array.isArray(boundaryAfter.state.worktree_final)) {
    let committedDuringRepair = [];
    if (before.head_sha && before.head_sha !== boundaryAfter.state.head_sha) {
      try {
        committedDuringRepair = gitLines(consumerRoot(args), [
          'diff', '--name-only', `${before.head_sha}...${boundaryAfter.state.head_sha}`,
        ]);
      } catch (error) {
        repairViolations.push(`não foi possível derivar commits do repair: ${error.message}`);
      }
    }
    const touchedReal = [...new Set([
      ...snapshotDeltaFiles(before.worktree_final, boundaryAfter.state.worktree_final),
      ...committedDuringRepair,
    ])].sort();
    const touchedClaimed = [...new Set(repairs.flatMap((repair) => repair?.files_touched ?? []))].sort();
    if (JSON.stringify(touchedReal) !== JSON.stringify(touchedClaimed)) {
      repairViolations.push(`arquivos do repair divergem do delta real: esperado=${JSON.stringify(touchedReal)} recebido=${JSON.stringify(touchedClaimed)}`);
    }
  }
  if (repairViolations.length > 0) {
    return {
      gate: 'G4', action: 'repair_complete', status: 'blocked', timestamp,
      repair_run_id: activeRepairRunId, state_path: statePathValue,
      repair_violations: repairViolations,
      error: `Repair fora do boundary recebido: ${repairViolations.join('; ')}`,
      next_action: 'corrigir_correlacao_ids_arquivos_e_state_do_repair',
    };
  }
  if (targets.length > 0) {
    const missing = targets.filter((target) => {
      const output = repairs.find((repair) => repair?.finding_id === target.id);
      const persisted = stateRepairs.find((repair) => repair?.finding_id === target.id);
      return output?.status !== 'resolved'
        || !Array.isArray(output.files_touched) || output.files_touched.length === 0
        || !Array.isArray(output.checks_run) || output.checks_run.length === 0
        || persisted?.status !== 'resolved'
        || !Array.isArray(persisted.files_touched) || persisted.files_touched.length === 0
        || !Array.isArray(persisted.checks_run) || persisted.checks_run.length === 0;
    });
    if (missing.length > 0) {
      return {
        gate: 'G4', action: 'repair_complete', status: 'blocked', timestamp,
        repair_run_id: activeRepairRunId, state_path: statePathValue,
        unresolved_finding_ids: missing.map((finding) => finding.id),
        error: 'Repair sem evidência de resolução para finding P0/P1 alvo',
        next_action: 'persistir_correlacao_finding_arquivo_check_status',
      };
    }
  }

  return {
    gate: 'G4',
    action: 'repair_complete',
    status: 'passed',
    timestamp,
    validator_attempt: cycle.attempts_used,
    repair_run_id: activeRepairRunId,
    validator_status: 'ready_for_retry',
    state_path: statePathValue,
    next_action: 'dispatch_task_validator_retry',
    banner: renderBanner('validacao', { status: 'ready_for_retry' }),
    validator_cycle: {
      status: 'ready_for_retry',
      active: null,
      last_state_path: statePathValue,
      repair: {
        skill: WORKFLOW_CONFIG.skills.findings_repair,
        status: 'completed',
        required_from_attempt: cycle.repair.required_from_attempt ?? cycle.attempts_used,
        requested_at: cycle.repair.requested_at,
        completed_at: timestamp,
        active: null,
      },
      applied: appendAppliedRepairCompletion(cycle.applied, {
        repair_run_id: activeRepairRunId,
        status: 'passed',
        state_path: statePathValue,
        validator_attempt: cycle.attempts_used,
        timestamp,
      }),
    },
  };
}

function lockValidator(args = {}) {
  const runId = validateRunId(args.run_id);
  const action = args.action ?? 'start';
  if (!['start', 'complete', 'repair_start', 'repair_complete'].includes(action)) {
    throw rpcError(-32602, `Ação inválida para talos_lock_validator: ${action}`);
  }
  const context = getDispatchState(runId, args);
  const result = action === 'start'
    ? validatorStart(args, context)
    : action === 'complete'
      ? validatorComplete(args, context)
      : action === 'repair_start'
        ? validatorRepairStart(args, context)
        : validatorRepairComplete(args, context);
  patchValidatorResult(runId, result, args);
  return result;
}

// ── G12/D1 (onda 1): `talos_commit_state` — writer MCP do JSON de slice ───────
// O executor/repair NUNCA monta nem escreve o state: envia julgamento curto e o
// MCP projeta o objeto v3 COMPLETO (escrita absoluta tmp+rename). O retorno
// carrega `state_path` + `state_sha256`; o ledger da run ganha
// `liveness.slice_commit_sha256` e `liveness.last_commit_state_path`, e o
// liveness passa a `handoff_ready` — SEM checkpoint público `state_path_created`
// (D4). Os campos projetados do payload são denylisted → `-32602` (D10/D9).

// Campos que o executor/repair não pode enviar: são projetados pelo MCP.
const COMMIT_STATE_DENYLIST = new Set([
  'acceptance_results', 'worktree_baseline', 'worktree_final', 'files_changed',
  'base_sha', 'head_sha', 'check_table', 'proof_refs', 'eval_results',
  'task_evidence', 'validation_map', 'policy_scope', 'executed_at',
  'state_schema_version', 'role',
]);

// Classe de escrita do mutador (GUIDE §0): commitState é ABSOLUTA no arquivo de
// slice — o objeto v3 projetado é gravado inteiro; nada do JSON antigo sobrevive.

function readSliceJsonForCommit(statePathValue, args = {}) {
  return JSON.parse(fs.readFileSync(resolveConsumerPath(statePathValue, args), 'utf8'));
}

function commitProofKind(kind) {
  if (kind === 'T') return 'task';
  return 'ac';
}

function collectCommitRepairEvidence(repairs) {
  const evidence = [];
  for (const item of repairs) {
    if (!item || typeof item !== 'object') continue;
    const findingId = typeof item.finding_id === 'string' ? item.finding_id.trim() : '';
    if (!findingId) continue;
    const files = Array.isArray(item.files) ? item.files.filter((f) => typeof f === 'string' && f.trim()) : [];
    const checks = Array.isArray(item.checks) ? item.checks.filter((c) => typeof c === 'string' && c.trim()) : [];
    const status = typeof item.status === 'string' && item.status.trim() ? item.status.trim() : 'resolved';
    evidence.push({ finding_id: findingId, files: [...new Set(files)].sort(), checks: [...new Set(checks)].sort(), status });
  }
  return evidence;
}

// Projeção v3 completa (ordem canônica de STATE_FILE_SCHEMA.md). Sink de VC1/VC2/
// VC3/VC4 e da invariante INV2: disco sempre state_schema_version 3.
function projectCommitStateV3(args, context) {
  const runId = validateRunId(args.run_id);
  const timestamp = nowIso();
  const root = consumerRoot(args);
  const baseSha = gitOutput(root, ['rev-parse', 'HEAD']).trim();
  const liveness = context.dispatch.active?.liveness && typeof context.dispatch.active.liveness === 'object'
    ? context.dispatch.active.liveness
    : null;
  const baseline = Array.isArray(liveness?.worktree_baseline)
    ? liveness.worktree_baseline
    : [];
  const hasMutated = snapshotDeltaFiles(baseline, captureWorktreeSnapshot(root)).length > 0;

  const planPath = optionalString(args, 'plan_path');
  const sprintFilePath = optionalString(args, 'sprint_file_path');
  const obligationIds = Array.isArray(args.obligation_ids)
    ? args.obligation_ids.filter((id) => typeof id === 'string' && id.trim())
    : [];
  const proofs = Array.isArray(args.proofs) ? args.proofs : [];
  const evalNa = Array.isArray(args.eval_na) ? args.eval_na.filter((id) => typeof id === 'string' && id.trim()) : [];

  const checkTable = [];
  const checkIndexFor = new Map();
  const checkIndexOf = (check) => {
    const trimmed = String(check ?? '').trim();
    if (!trimmed) return -1;
    if (!checkIndexFor.has(trimmed)) {
      checkIndexFor.set(trimmed, checkTable.length);
      checkTable.push(trimmed);
    }
    return checkIndexFor.get(trimmed);
  };

  const proofRefs = {};
  const evalResults = [];
  const taskEvidence = [];
  const taskOrder = [];
  for (const proof of proofs) {
    if (!proof || typeof proof !== 'object') continue;
    const kind = proof.kind;
    const id = typeof proof.id === 'string' ? proof.id.trim() : '';
    if (!id) continue;
    const check = String(proof.check ?? '').trim();
    if (!check) continue;
    const files = Array.isArray(proof.files)
      ? proof.files.filter((f) => typeof f === 'string' && f.trim())
      : [];
    const covers = Array.isArray(proof.covers)
      ? proof.covers.filter((c) => typeof c === 'string' && c.trim())
      : [];
    const checkIndex = checkIndexOf(check);
    if (kind === 'AC') {
      proofRefs[id] = {
        checks: [checkIndex],
        files: files.map((f) => f),
      };
    } else if (kind === 'EVAL') {
      evalResults.push({ id, status: evalNa.includes(id) ? 'not_applicable' : 'passed', evidence: [check], checks: [checkIndex] });
    } else if (kind === 'T') {
      taskOrder.push(id);
      taskEvidence.push({ task: id, files, checks: [checkIndex], result: 'passed' });
    }
  }

  const worktreeFinal = captureWorktreeSnapshot(root);
  const committed = gitLines(root, ['diff', '--name-only', `${baseSha}...HEAD`]);
  const worktreeDelta = snapshotDeltaFiles(baseline, worktreeFinal);
  const expectedFiles = [...new Set([...committed, ...worktreeDelta])].sort();
  const filesChanged = hasMutated
    ? [...new Set([...expectedFiles, ...taskEvidence.flatMap((item) => item.files), ...proofRefsFiles(proofRefs)])].sort()
    : [];
  const indexOfFile = (rel) => filesChanged.indexOf(rel);
  const proofRefsIndexed = Object.fromEntries(
    Object.entries(proofRefs).map(([id, ref]) => [
      id,
      { checks: ref.checks, files: ref.files.map(indexOfFile).filter((i) => i >= 0) },
    ]),
  );

  const policyScope = {
    forbidden_scope: [],
    required_gates: ['talos_verify_sprint_file', 'talos-task-validator'],
  };
  const repairEvidence = collectCommitRepairEvidence(args.repair ?? []);
  const state = {
    state_schema_version: STATE_COMPACT_SCHEMA_VERSION,
    run_id: runId,
    slice: args.slice,
    base_sha: baseSha,
    head_sha: baseSha,
    contract_kind: planPath ? 'plan' : 'direct',
    tasks: [...new Set(taskOrder)],
    files_changed: filesChanged,
    diff_stat: `${filesChanged.length} files, +${filesChanged.length} -0`,
    plan_path: planPath ?? '.talos/plans/direct.md',
    boundary_refs: [],
    sprint_id: sprintFilePath ? (optionalString(args, 'sprint_file_path') ? inferSprintId(sprintFilePath) : null) : null,
    sprint_file_path: sprintFilePath ?? null,
    prd_path: null,
    contract_ids: {
      obligations: [...new Set(obligationIds)],
      invariants: [],
      scenarios: [],
      risks: [],
    },
    eval_results: evalResults,
    proof_refs: proofRefsIndexed,
    policy_scope: policyScope,
    check_table: checkTable,
    validation_map: [],
    task_evidence: taskEvidence.map((item) => ({
      task: item.task,
      files: item.files.map(indexOfFile).filter((i) => i >= 0),
      checks: item.checks,
      result: item.result,
    })),
    repair_evidence: repairEvidence.map((item) => ({
      finding_id: item.finding_id,
      files: item.files.map(indexOfFile).filter((i) => i >= 0),
      checks: item.checks.map(checkIndexOf).filter((i) => i >= 0),
      status: item.status,
    })),
    worktree_baseline: baseline,
    worktree_final: worktreeFinal,
    executed_at: timestamp,
    executor_skill: context.routing.mode === 'direct'
      ? WORKFLOW_CONFIG.skills.direct_execute
      : WORKFLOW_CONFIG.skills.plan_execute,
  };
  return { state, worktreeDelta, filesChanged, hasMutated };
}

function proofRefsFiles(proofRefs) {
  const out = [];
  for (const ref of Object.values(proofRefs)) {
    if (ref && Array.isArray(ref.files)) out.push(...ref.files);
  }
  return out;
}

function inferSprintId(sprintFilePath) {
  const match = /SPRINT_(S\d{2}(?:[a-z]|\.\d+)?)_/i.exec(String(sprintFilePath));
  return match ? match[1] : null;
}

function inferCommitRole(args, context) {
  const dispatch = context.dispatch;
  const active = dispatch.active;
  const runId = validateRunId(args.run_id);
  const cycle = normalizeValidatorCycle(context.state.data?.validator_cycle ?? {});

  if (context.routing.mode === 'sprint_pref') {
    return { status: 'blocked', code: 'onda3_pref_fora_de_escopo', error: 'Commit bloqueado: fase sprint_pref é onda 3 (D8); fora do escopo desta release', next_action: 'nao_commitar_em_pref' };
  }
  if (active && active.phase === 'plan_execute') {
    if (cycle.active) {
      return { status: 'blocked', code: 'validator_ativo', error: 'Commit bloqueado: validator ativo para esta slice; complete o ciclo antes de novo commit', next_action: 'completar_ciclo_validator_antes_de_commit' };
    }
    if (active.liveness?.last_commit_state_path && active.liveness.last_commit_state_path !== slicePathForCommit(args)) {
      return { status: 'blocked', code: 'outro_path_commitado', error: `Commit bloqueado: último commit foi para ${active.liveness.last_commit_state_path}`, next_action: 'commit_apenas_no_path_da_slice_atual' };
    }
    const sliceRel = slicePathForCommit(args);
    const sliceAbs = resolveConsumerPath(sliceRel, args);
    const sliceExists = fs.existsSync(sliceAbs);
    const sliceSha = sliceExists ? sha256HexFile(sliceAbs) : null;
    if (cycle.status === 'repair_required' || cycle.status === 'repair_running') {
      // Commit repair é a continuação do ciclo: handoff_ready anterior não
      // bloqueia — o repair_start reabriu a slice para correção.
      if (cycle.last_state_path && cycle.last_state_path !== sliceRel) {
        return { status: 'blocked', code: 'repair_em_outro_path', error: `Commit repair bloqueado: repair ativo para ${cycle.last_state_path}`, next_action: 'reparar_o_path_original' };
      }
      if (!Array.isArray(args.repair) || args.repair.length === 0) {
        return { status: 'blocked', code: 'repair_sem_repairs', error: 'Commit repair exige repair[] não vazio', next_action: 'enviar_repair_com_findings' };
      }
      const lastCommitSha = active.liveness?.slice_commit_sha256 ?? null;
      if (!lastCommitSha || sliceSha === null || sliceSha !== lastCommitSha) {
        return { status: 'blocked', code: 'repair_sha_divergente', error: 'Commit repair bloqueado: sha do disco diverge do último commit MCP (repair deve partir do state commitado)', next_action: 'recommit_do_state_atual_antes_do_repair' };
      }
      return { role: 'repair', baseline: active.liveness?.worktree_baseline ?? [], baseSha: active.liveness?.base_sha ?? null, sliceSha };
    }
    if (active.liveness?.status === 'handoff_ready') {
      return { status: 'blocked', code: 'handoff_ja_pronto', error: 'Commit bloqueado: liveness já handoff_ready para este path', next_action: 'abrir_validator_ou_novo_dispatch' };
    }
    if (Array.isArray(args.repair) && args.repair.length > 0) {
      // AC-1.1.3 (D9): repair[] só é aceito com slot repair_start aberto.
      // Ciclo idle + repair[] no input = repair sem slot → blocked, sem escrita.
      return { status: 'blocked', code: 'repair_sem_slot', error: 'Commit bloqueado: repair[] sem slot repair_start aberto (role pelo lock)', next_action: 'abrir_slot_repair_antes_do_commit_repair' };
    }
    const hasBaseline = Array.isArray(active.liveness?.worktree_baseline) && active.liveness.worktree_baseline.length >= 0;
    if (active.liveness && active.liveness.worktree_baseline === undefined) {
      // AC-1.2.3: sem first_write, o commit só é válido se o worktree está limpo
      // (no-op slice). Diff real vs HEAD decide — não bloquear incondicionalmente.
      const rootNow = consumerRoot(args);
      const baseShaNow = active.liveness?.base_sha ?? gitOutput(rootNow, ['rev-parse', 'HEAD']).trim();
      const committedNow = gitLines(rootNow, ['diff', '--name-only', `${baseShaNow}...HEAD`]);
      const worktreeNow = snapshotDeltaFiles([], captureWorktreeSnapshot(rootNow));
      if (committedNow.length > 0 || worktreeNow.length > 0) {
        return { status: 'blocked', code: 'sem_first_write_dirty', error: 'Commit bloqueado: worktree sujo sem first_write (baseline ausente no ledger)', next_action: 'emitir_first_write_antes_do_commit' };
      }
      // No-op (worktree limpo, sem commits desde base_sha): passa sem baseline.
      return { role: 'execute', baseline: [], baseSha: active.liveness?.base_sha ?? null, sliceSha: null };
    }
    if (!sliceExists) {
      return { role: 'execute', baseline: active.liveness?.worktree_baseline ?? [], baseSha: active.liveness?.base_sha ?? null, sliceSha: null };
    }
    const diskSha = sha256HexFile(sliceAbs);
    const ledgerSha = active.liveness?.slice_commit_sha256 ?? null;
    if (ledgerSha !== null && diskSha === ledgerSha) {
      return { role: 'execute', baseline: active.liveness?.worktree_baseline ?? [], baseSha: active.liveness?.base_sha ?? null, sliceSha: diskSha };
    }
    return { status: 'blocked', code: 'slice_orfã', error: 'Commit bloqueado: state_path já existe em disco com sha divergente do ledger (órfão/dual-writer); commit é absoluto e não sobrescreve estado alheio', next_action: 'remover_ou_renomear_slice_orfã_antes_do_commit' };
  }
  return { status: 'blocked', code: 'sem_plan_execute', error: 'Commit só se aplica com plan_execute ativo (D9: role pelo lock)', next_action: 'dispatch_plan_execute_antes_do_commit' };
}

function slicePathForCommit(args) {
  return `.talos/state/${validateRunId(args.run_id)}/${args.slice}.json`;
}

function sha256HexFile(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function markCommitHandoff(runId, args, result, statePathValue, stateSha256) {
  const previous = readState(runId, args);
  const currentDispatch = previous.data?.dispatch ?? {};
  const history = appendLedgerHistory(currentDispatch.history, {
    timestamp: result.timestamp,
    phase: 'plan_execute',
    action: 'commit_state',
    event: 'commit_state',
    status: result.status,
    next_action: result.next_action ?? null,
    error: result.error ?? null,
  });
  const liveness = currentDispatch.active?.liveness && typeof currentDispatch.active.liveness === 'object'
    ? currentDispatch.active.liveness
    : null;
  const nextLiveness = liveness ? {
    ...liveness,
    status: 'handoff_ready',
    last_checkpoint: 'commit_state',
    last_progress_at: result.timestamp,
    slice_commit_sha256: stateSha256,
    last_commit_state_path: statePathValue,
    next_progress_deadline_at: null,
  } : null;
  const data = {
    ...(previous.data ?? {}),
    dispatch: {
      ...currentDispatch,
      ...(nextLiveness ? { active: { ...currentDispatch.active, liveness: nextLiveness } } : {}),
      history,
    },
    gates: {
      ...(previous.data?.gates ?? {}),
      G12: compactLedgerEvent(result),
    },
  };
  return upsertState({
    run_id: runId,
    project_root: args.project_root,
    phase: previous.phase ?? 'dispatch',
    status: 'dispatch_ok',
    summary: 'G12: commit_state',
    data,
  });
}

function commitState(args = {}) {
  const runId = validateRunId(args.run_id);
  if (Object.prototype.hasOwnProperty.call(args, LEGACY_ROUTE_KEY)) {
    throw rpcError(-32602, `unknown_property: ${LEGACY_ROUTE_KEY}`);
  }
  const denied = Object.keys(args).filter((key) => COMMIT_STATE_DENYLIST.has(key));
  if (denied.length > 0) {
    throw rpcError(-32602, `unknown_property: ${denied[0]} (campo projetado pelo MCP — executor não envia)`);
  }
  if (typeof args.slice !== 'string' || !args.slice.trim()) throw rpcError(-32602, 'slice obrigatório');
  if (!Array.isArray(args.proofs) || args.proofs.length === 0) {
    throw rpcError(-32602, 'proofs obrigatório (AC/EVAL/T)');
  }
  for (const [index, proof] of args.proofs.entries()) {
    if (!proof || typeof proof !== 'object') throw rpcError(-32602, `proofs[${index}] deve ser objeto`);
    if (!['AC', 'EVAL', 'T'].includes(proof.kind)) throw rpcError(-32602, `proofs[${index}].kind deve ser AC|EVAL|T`);
    if (typeof proof.id !== 'string' || !proof.id.trim()) throw rpcError(-32602, `proofs[${index}].id obrigatório`);
    if (typeof proof.check !== 'string' || !proof.check.trim()) throw rpcError(-32602, `proofs[${index}].check obrigatório`);
  }
  if (args.repair !== undefined && !Array.isArray(args.repair)) throw rpcError(-32602, 'repair deve ser array');

  const context = getDispatchState(runId, args);
  const inferred = inferCommitRole(args, context);
  if (inferred.status === 'blocked') {
    const timestamp = nowIso();
    return {
      gate: 'G12', action: 'commit_state', phase: 'plan_execute', status: 'blocked', timestamp,
      state_path: slicePathForCommit(args),
      error: inferred.error, code: inferred.code, next_action: inferred.next_action,
    };
  }
  const timestamp = nowIso();
  const statePathValue = slicePathForCommit(args);
  const stateAbs = resolveConsumerPath(statePathValue, args);

  let projected;
  try {
    projected = projectCommitStateV3(args, context);
  } catch (error) {
    return {
      gate: 'G12', action: 'commit_state', phase: 'plan_execute', status: 'blocked', timestamp,
      state_path: statePathValue, error: `Commit bloqueado: falha ao projetar state: ${error.message}`,
      next_action: 'corrigir_boundary_antes_do_commit',
    };
  }
  const { state, filesChanged } = projected;
  const liveness = context.dispatch.active?.liveness ?? {};
  const baseline = Array.isArray(liveness.worktree_baseline) ? liveness.worktree_baseline : [];
  const hasBaseline = liveness.worktree_baseline !== undefined;
  if (inferred.role === 'repair') {
    state.worktree_baseline = inferred.baseline;
    state.worktree_final = captureWorktreeSnapshot(consumerRoot(args));
  } else if (inferred.role === 'execute' && !hasBaseline && filesChanged.length > 0) {
    return {
      gate: 'G12', action: 'commit_state', phase: 'plan_execute', status: 'blocked', timestamp,
      state_path: statePathValue, error: 'Commit bloqueado: worktree sujo sem first_write (AC-1.2.3)',
      next_action: 'emitir_first_write_antes_do_commit',
    };
  }

  if (state.worktree_final === undefined) state.worktree_final = captureWorktreeSnapshot(consumerRoot(args));
  if (state.worktree_baseline === undefined) state.worktree_baseline = [];
  if (state.base_sha === undefined) state.base_sha = gitOutput(consumerRoot(args), ['rev-parse', 'HEAD']).trim();
  if (state.head_sha === undefined) state.head_sha = state.base_sha;

  const dir = path.dirname(stateAbs);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${stateAbs}.${process.pid}.tmp`;
  let writtenSha = null;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, stateAbs);
    writtenSha = sha256HexFile(stateAbs);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    return {
      gate: 'G12', action: 'commit_state', phase: 'plan_execute', status: 'blocked', timestamp,
      state_path: statePathValue, error: `Commit bloqueado: falha ao gravar slice: ${error.message}`,
      next_action: 'corrigir_gravacao_e_recommitar',
    };
  }

  const commitResult = {
    gate: 'G12',
    action: 'commit_state',
    phase: 'plan_execute',
    status: 'passed',
    timestamp,
    role: inferred.role,
    state_path: statePathValue,
    state_sha256: writtenSha,
    diff_stat: state.diff_stat,
    next_action: 'open_validator',
  };
  try {
    markCommitHandoff(runId, args, commitResult, statePathValue, writtenSha);
  } catch (error) {
    return {
      gate: 'G12', action: 'commit_state', phase: 'plan_execute', status: 'blocked', timestamp,
      state_path: statePathValue, state_sha256: writtenSha,
      error: `Commit gravou a slice mas falhou ao atualizar o ledger: ${error.message}`,
      next_action: 'corrigir_ledger_e_reemitir_status',
    };
  }
  return commitResult;
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
  // demais fases (sprint_interview etc.): exec genérico da fase em andamento.
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
        // block_kind diferencia "gate funcionando" de "erro de pipeline": este bloqueio é
        // o guard de conclusão prematura disparando como projetado (S3). Não é falha do
        // MCP nem estado corrompido — a ação correta é despachar plan_execute e seguir.
        block_kind: 'premature_completion_guard',
        timestamp,
        error: `Conclusão prematura bloqueada no full: ${attemptedAction}`,
        note: 'Gate G11 funcionando: o full não conclui só com handoff. Não é erro de pipeline — despache plan_execute (blocking) e prossiga.',
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
  // JSON compacto (sem indentação): o consumidor é o LLM orquestrador, que parseia
  // igual com ou sem whitespace. Pretty-print só gastava tokens em toda resposta MCP
  // (~10-13 por run). Mesmos campos/valores — zero impacto em determinismo/contrato.
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value),
      },
    ],
  };
}

function toolsList() {
  return {
    tools: [
      {
        name: 'talos_ping',
        description: 'Saúde/versão do MCP Talos.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
      },
      {
        name: 'talos_capabilities',
        description: 'Host adapter: subagente, todo e paths.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            host: { type: 'string', enum: HOST_NAMES },
          },
        },
      },
      {
        name: 'talos_run_state',
        description: 'Estado de run; use recovery para payload mínimo do validator.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id'],
          properties: {
            action: { type: 'string', enum: ['get', 'upsert', 'recovery'], default: 'get' },
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
        name: 'talos_verify_artifact',
        description: 'G1: artefato existe/legível.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'artifact_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            artifact_path: { type: 'string', minLength: 1 },
            artifact_kind: { enum: ['sprint', 'plan', 'json'] },
          },
        },
      },
      {
        name: 'talos_scan_acceptance',
        description: 'G5: ambiguidades bloqueantes no contrato §7 do sprint file — por sprint_path (arquivo salvo) ou sprint_markdown (rascunho em memória, antes de existir em disco). Exatamente um dos dois.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            sprint_path: { type: 'string', minLength: 1 },
            sprint_markdown: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'talos_verify_template_conformance',
        description: 'TC: plano contra template.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'artifact_path', 'artifact_type'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            artifact_path: { type: 'string', minLength: 1 },
            artifact_type: { type: 'string', enum: ['plan'] },
            required_status: { type: 'string' },
            require_sprint_file: { type: 'boolean' },
          },
        },
      },
      {
        name: 'talos_verify_sprint_file',
        description: 'Valida sprint file e backlink.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'sprint_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            sprint_path: { type: 'string', minLength: 1 },
            sprint_id: { type: 'string', pattern: '^S\\d{2}(?:[a-z]|\\.\\d+)?$' },
            backlog_path: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'talos_verify_backlog_index',
        description: 'Valida backlog: sprints, deps, links.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'backlog_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            backlog_path: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'talos_select_next_sprint',
        description: 'Seleciona próxima sprint executável. next_action é mode-aware (§7 + PLAN + mode).',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'backlog_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            backlog_path: { type: 'string', minLength: 1 },
            mode: {
              type: 'string',
              enum: ['full', 'direct', 'execute', 'interview-only', 'audit'],
              description: 'Modo do pipeline; altera next_action (ex.: direct nunca sugere plan_handoff). Default: full.',
            },
          },
        },
      },
      {
        name: 'talos_update_sprint_status',
        description: 'Sincroniza status backlog/sprint.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'backlog_path', 'sprint_id', 'status'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            backlog_path: { type: 'string', minLength: 1 },
            sprint_id: { type: 'string', pattern: '^S\\d{2}(?:[a-z]|\\.\\d+)?$' },
            status: { type: 'string', enum: [...BACKLOG_STATES] },
            validator_verdict: { type: 'string', enum: [...VALIDATOR_VERDICTS] },
            gate_status: { type: 'string', minLength: 1 },
            // Legado: só atualiza coluna PRD do backlog (compat posicional). Não gera artefato PRD.
            prd_path: { type: 'string', minLength: 1, description: 'Legado posicional do backlog; opcional. Aceite mora no §7 do sprint file.' },
            plan_path: { type: 'string', minLength: 1 },
            state_path: { type: 'string', minLength: 1 },
            evidence: { type: 'string', minLength: 1 },
            allow_reopen_done: { type: 'boolean' },
          },
        },
      },
      {
        name: 'talos_sync_manual_validation',
        description: 'Sync do relatório de validação manual (MV-*) com lock por backlog: valida IDs/status/waiver, sincroniza state/sprint/ledger; promove done quando todos M validated/waived (com handoff); failed bloqueia a origem. Relatório inválido → next_action=fix_manual_validation_report.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'backlog_path'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            backlog_path: { type: 'string', minLength: 1 },
            report_path: { type: 'string', minLength: 1, description: 'Path do relatório; default .talos/manual-validation/<slug>.md.' },
          },
        },
      },
      {
        name: 'talos_classify_input',
        description: 'Classifica input: backlog|plan|idea|unknown.',
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
        name: 'talos_preflight',
        description: 'PREREQ+G10: modo, host, versão, lock.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'mode'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            mode: { type: 'string', enum: WORKFLOW_CONFIG.modes },
            input_type: { type: 'string', enum: ['backlog-item', 'sprint', 'idea', 'briefing', 'roadmap', 'conversation', 'spec-macro', 'plan', 'brainstorm', 'target'] },
            artifact_type: { type: 'string', enum: ['backlog', 'plan', 'idea', 'unknown'] },
            expected_version: { type: 'string' },
            host: { type: 'string', enum: HOST_NAMES },
            // additionalProperties:false é enforçado pelo client MCP; o servidor ainda
            // delimita defensivamente o override a PREREQUISITE_FLAGS em checkPrerequisites.
            host_capabilities: {
              type: 'object',
              description: 'Flags reais do host.',
              additionalProperties: false,
              properties: {
                subagent_available: { type: 'boolean' },
                mcp_available: { type: 'boolean' },
                todo_available: { type: 'boolean' },
                // Gate JOIN separado (DEC-SIB-003): report afirmativo de join síncrono
                // para hosts must_report (pi/generic). NÃO entra em PREREQUISITE_FLAGS.
                join_sync_available: { type: 'boolean' },
                // Gate DISPATCH (DEC-008): report afirmativo de capacidade de mutação
                // do subagente. Exigido para hosts com dispatch_capability 'unknown'
                // em modos de execução (full/direct/execute).
                dispatch_mutable: { type: 'boolean' },
              },
            },
          },
        },
      },
      {
        name: 'talos_lock_dispatch',
        description: 'G7/G8/G12: dispatch e liveness.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'phase'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            action: { type: 'string', enum: ['start', 'checkpoint', 'status', 'complete', 'abort'], default: 'start' },
            phase: { type: 'string', enum: ['plan_handoff', 'plan_execute', 'slice_review'] },
            event: {
              type: 'string',
              enum: [...EXECUTOR_CHECKPOINT_EVENTS],
              description: 'Checkpoint G12.',
            },
            plan_path: { type: 'string' },
            state_path: { type: 'string' },
            detail: { type: 'string' },
            validator_status: { type: 'string' },
          },
        },
      },
      {
        name: 'talos_lock_validator',
        description: 'G4/G8: validator sibling, token, challenge, repair.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'action'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            action: { type: 'string', enum: ['start', 'complete', 'repair_start', 'repair_complete'] },
            state_path: { type: 'string' },
            validator_run_id: { type: 'string' },
            repair_run_id: { type: 'string' },
            dispatch_token: { type: 'integer' },
            challenge_response: { type: 'string' },
            validator_output_path: { type: 'string' },
            verdict: { type: 'string', enum: ['pass', 'pass_with_observations', 'fail'] },
            data: { type: 'object', additionalProperties: true },
            host: { type: 'string', enum: HOST_NAMES },
          },
        },
      },
      {
        name: 'talos_assert_after_plan',
        description: 'G11: bloqueia full antes da execução.',
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
      {
        name: 'talos_commit_state',
        description: 'G12/D1: writer do JSON de slice. Recebe julgamento curto do executor/repair e projeta o state v3 completo no disco (escrita absoluta via commitState); retorna state_path + state_sha256 e marca handoff_ready no ledger.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'slice', 'proofs'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            project_root: { type: 'string', minLength: 1 },
            slice: { type: 'string', minLength: 1 },
            plan_path: { type: 'string', minLength: 1 },
            sprint_file_path: { type: 'string', minLength: 1 },
            obligation_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
            proofs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'id', 'check'],
                properties: {
                  kind: { type: 'string', enum: ['AC', 'EVAL', 'T'] },
                  id: { type: 'string', minLength: 1 },
                  check: { type: 'string', minLength: 1 },
                  files: { type: 'array', items: { type: 'string', minLength: 1 } },
                  covers: { type: 'array', items: { type: 'string', minLength: 1 } },
                },
              },
            },
            eval_na: { type: 'array', items: { type: 'string', minLength: 1 } },
            repair: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['finding_id', 'files', 'checks', 'status'],
                properties: {
                  finding_id: { type: 'string', minLength: 1 },
                  files: { type: 'array', items: { type: 'string', minLength: 1 } },
                  checks: { type: 'array', items: { type: 'string', minLength: 1 } },
                  status: { type: 'string', minLength: 1 },
                },
              },
            },
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
        name === 'talos_ping' ? ping() :
          name === 'talos_capabilities' ? capabilities(args) :
            name === 'talos_run_state' ? runState(args) :
              name === 'talos_verify_artifact' ? verifyArtifact(args) :
                name === 'talos_scan_acceptance' ? scanAcceptance(args) :
                  name === 'talos_verify_template_conformance' ? verifyTemplateConformance(args) :
                    name === 'talos_verify_sprint_file' ? verifySprintFile(args) :
                      name === 'talos_verify_backlog_index' ? verifyBacklogIndex(args) :
                        name === 'talos_select_next_sprint' ? selectNextSprint(args) :
                          name === 'talos_update_sprint_status' ? updateSprintStatus(args) :
                            name === 'talos_sync_manual_validation' ? syncManualValidation(args) :
                              name === 'talos_classify_input' ? classifyInput(args) :
                              name === 'talos_preflight' ? preflight(args) :
                                name === 'talos_lock_dispatch' ? lockDispatch(args) :
                                  name === 'talos_lock_validator' ? lockValidator(args) :
                                    name === 'talos_assert_after_plan' ? assertAfterPlan(args) :
                                      name === 'talos_commit_state' ? commitState(args) :
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
              code: Number.isInteger(error.code) ? error.code : -32603,
              message: error.message,
              data: error.data || { original_code: error.code },
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
function isMainModule() {
  if (!process.argv[1]) return false;
  const entry = path.resolve(process.argv[1]);
  const modulePath = fileURLToPath(import.meta.url);
  if (entry === modulePath) return true;
  try {
    // Parall/Cursor: HOME pode ser symlink (Library/p2 → Application Support/Parall/N).
    // argv[1] fica no path lógico; import.meta.url no físico — sem realpath o stdio não sobe.
    return fs.realpathSync(entry) === fs.realpathSync(modulePath);
  } catch {
    return false;
  }
}
if (isMainModule()) startStdioLoop();

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
  lockValidator,
  captureWorktreeSnapshot,
  validateStateBoundary,
  classifyAcceptanceResults,
  assertAfterPlan,
  runState,
  ping,
  toolsList,
  commitState,
};
