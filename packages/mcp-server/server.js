#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'atlas-workflow-orchestrator';
const RUN_DIR = '.atlas-run';
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
const REQUIRED_SKILL_ROLES = [
  'prd_generator',
  'prd_interview',
  'plan_handoff',
  'plan_execute',
  'slice_review',
  'task_validator',
];
const CONFIG_CANDIDATES = [
  path.resolve(SERVER_DIR, '../orchestrator/atlas_workflows_config.md'),
  path.resolve(SERVER_DIR, '../../orchestrator/atlas_workflows_config.md'),
];

function readVersion() {
  const candidates = [
    path.resolve(SERVER_DIR, '../../VERSION'),
    path.resolve(SERVER_DIR, 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      if (candidate.endsWith('package.json')) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8')).version || 'unknown';
      }
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value) return value;
    } catch {
      // Fall through to stable unknown version; ping still exposes identity.
    }
  }
  return 'unknown';
}

function readWorkflowConfigText() {
  for (const candidate of CONFIG_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return {
        path: candidate,
        content: fs.readFileSync(candidate, 'utf8'),
      };
    }
  }
  throw rpcError(-32010, 'Config empacotada ausente: atlas_workflows_config.md', {
    expected_paths: CONFIG_CANDIDATES,
  });
}

function parseWorkflowConfig() {
  const source = readWorkflowConfigText();
  const families = {};
  const familyRegex = /^```yaml\n(claude|cursor|codex):\n([\s\S]*?)^```/gm;
  let match;

  while ((match = familyRegex.exec(source.content)) !== null) {
    const family = match[1];
    const body = match[2];
    families[family] = {};
    for (const line of body.split(/\r?\n/)) {
      const roleMatch = /^\s{2}([a-z_]+):\s*([a-z-]+)/.exec(line);
      if (roleMatch) families[family][roleMatch[1]] = roleMatch[2];
    }
  }

  const modes = [];
  if (/^### Full Mode$/m.test(source.content)) modes.push('full');
  if (/^### Direct Mode$/m.test(source.content)) modes.push('direct');
  if (/^### Interview-Only Mode$/m.test(source.content)) modes.push('interview-only', 'interview_only');

  return { ...source, families, modes };
}

function runRoot() {
  return path.resolve(process.cwd(), RUN_DIR);
}

function ensureRunDir() {
  const dir = runRoot();
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

function resolveConsumerPath(inputPath) {
  const value = requiredString({ value: inputPath }, 'value');
  return path.resolve(process.cwd(), value);
}

function statePath(runId) {
  return path.join(ensureRunDir(), `${validateRunId(runId)}.json`);
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

function logCall(entry) {
  const line = JSON.stringify({ timestamp: nowIso(), ...entry }) + '\n';
  fs.appendFileSync(path.join(ensureRunDir(), 'mcp.log'), line, { mode: 0o600 });
}

function rpcError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  error.data = data;
  return error;
}

function ping() {
  return {
    status: 'alive',
    name: SERVER_NAME,
    version: readVersion(),
    transport: 'stdio',
    capabilities: [
      'atlas_ping',
      'atlas_run_state',
      'atlas_verify_artifact',
      'atlas_scan_prd',
      'atlas_preflight',
      'atlas_lock_family',
    ],
    state_dir: RUN_DIR,
  };
}

function readState(runId) {
  const file = statePath(runId);
  if (!fs.existsSync(file)) {
    throw rpcError(-32004, `Run inexistente: ${runId}`, { run_id: runId });
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    throw rpcError(-32003, `Estado inválido para run: ${runId}`, {
      run_id: runId,
      cause: cause.message,
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
    previous = readState(runId);
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

  const target = statePath(runId);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
  return next;
}

function patchGateResult(runId, gate, result) {
  let previous = null;
  try {
    previous = readState(runId);
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
    phase: previous?.phase ?? 'gates',
    status: result.status === 'passed' ? 'gate_passed' : 'gate_blocked',
    summary: `${gate}: ${result.status}`,
    data,
  });
}

function patchRoutingResult(runId, result) {
  let previous = null;
  try {
    previous = readState(runId);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const data = {
    ...(previous?.data ?? {}),
    routing: result.routing ?? previous?.data?.routing ?? null,
    gates: {
      ...(previous?.data?.gates ?? {}),
      G10: redact(result),
    },
  };

  return upsertState({
    run_id: runId,
    phase: previous?.phase ?? 'preflight',
    status: result.status === 'passed' ? 'preflight_passed' : 'preflight_blocked',
    summary: `G10: ${result.status}`,
    data,
  });
}

function runState(args = {}) {
  const action = args.action ?? 'get';
  if (action === 'get') return readState(validateRunId(args.run_id));
  if (action === 'upsert') return upsertState(args);
  throw rpcError(-32602, `Ação inválida para atlas_run_state: ${action}`);
}

function verifyArtifact(args = {}) {
  const runId = validateRunId(args.run_id);
  const artifactPath = requiredString(args, 'artifact_path');
  const absolutePath = resolveConsumerPath(artifactPath);
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

  patchGateResult(runId, 'G1', result);
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
  const absolutePath = resolveConsumerPath(prdPath);
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

  patchGateResult(runId, 'G5', result);
  return result;
}

function validateFamilyConfig(config, family) {
  const skills = config.families[family];
  if (!skills) {
    return {
      ok: false,
      message: `Família inválida: ${family}`,
      supported_families: Object.keys(config.families),
    };
  }

  const missing = REQUIRED_SKILL_ROLES.filter((role) => !skills[role]);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Skill ausente na família ${family}: ${missing[0]}`,
      missing_role: missing[0],
      expected_roles: REQUIRED_SKILL_ROLES,
    };
  }

  return { ok: true, skills };
}

function preflight(args = {}) {
  const runId = validateRunId(args.run_id);
  const family = requiredString(args, 'family');
  const mode = requiredString(args, 'mode');
  const config = parseWorkflowConfig();
  const timestamp = nowIso();
  let previous = null;

  try {
    previous = readState(runId);
  } catch (error) {
    if (error.code !== -32004) throw error;
  }

  const currentRouting = previous?.data?.routing;
  let result;

  if (!config.modes.includes(mode)) {
    result = {
      gate: 'G10',
      status: 'blocked',
      timestamp,
      family,
      mode,
      error: `Modo inválido: ${mode}`,
      supported_modes: config.modes,
      next_action: 'corrigir_rota',
    };
  } else {
    const familyCheck = validateFamilyConfig(config, family);
    if (!familyCheck.ok) {
      result = {
        gate: 'G10',
        status: 'blocked',
        timestamp,
        family,
        mode,
        error: familyCheck.message,
        supported_families: familyCheck.supported_families,
        missing_role: familyCheck.missing_role,
        expected_roles: familyCheck.expected_roles,
        next_action: 'corrigir_rota',
      };
    } else if (currentRouting && currentRouting.family !== family) {
      result = {
        gate: 'G10',
        status: 'blocked',
        timestamp,
        family,
        mode,
        locked_family: currentRouting.family,
        error: `Troca de família bloqueada: ${currentRouting.family} -> ${family}`,
        next_action: 'encerrar_run_ou_usar_familia_travada',
      };
    } else if (currentRouting && currentRouting.mode !== mode) {
      result = {
        gate: 'G10',
        status: 'blocked',
        timestamp,
        family,
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
        family,
        mode,
        routing: {
          family,
          mode,
          skills: familyCheck.skills,
          locked_at: currentRouting?.locked_at ?? timestamp,
          config_path: config.path,
          supported_families: Object.keys(config.families),
          supported_modes: config.modes,
        },
        next_action: 'avançar',
      };
    }
  }

  patchRoutingResult(runId, result);
  return result;
}

function lockFamily(args = {}) {
  const runId = validateRunId(args.run_id);
  const family = requiredString(args, 'family');
  const role = optionalString(args, 'role');
  const expectedSkill = optionalString(args, 'expected_skill');
  const timestamp = nowIso();
  const state = readState(runId);
  const routing = state.data?.routing;

  if (!routing) {
    const result = {
      gate: 'G10',
      status: 'blocked',
      timestamp,
      family,
      error: 'Família ainda não travada: execute atlas_preflight antes de avançar',
      next_action: 'executar_preflight',
    };
    patchRoutingResult(runId, result);
    return result;
  }

  let result;
  if (routing.family !== family) {
    result = {
      gate: 'G10',
      status: 'blocked',
      timestamp,
      family,
      locked_family: routing.family,
      error: `Troca de família bloqueada: ${routing.family} -> ${family}`,
      next_action: 'usar_familia_travada',
    };
  } else if (role && !routing.skills?.[role]) {
    result = {
      gate: 'G10',
      status: 'blocked',
      timestamp,
      family,
      role,
      error: `Skill ausente para papel ${role} na família ${family}`,
      next_action: 'corrigir_config',
    };
  } else if (expectedSkill && role && routing.skills?.[role] !== expectedSkill) {
    result = {
      gate: 'G10',
      status: 'blocked',
      timestamp,
      family,
      role,
      expected_skill: routing.skills[role],
      received_skill: expectedSkill,
      error: `Skill esperada divergente para ${role}: ${routing.skills[role]} != ${expectedSkill}`,
      next_action: 'usar_skill_oficial',
    };
  } else {
    result = {
      gate: 'G10',
      status: 'passed',
      timestamp,
      family,
      mode: routing.mode,
      role: role ?? null,
      expected_skill: role ? routing.skills[role] : null,
      routing,
      next_action: 'avançar',
    };
  }

  patchRoutingResult(runId, result);
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
        name: 'atlas_run_state',
        description: 'Cria, atualiza ou consulta estado de run em .atlas-run/ no cwd do projeto consumidor.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id'],
          properties: {
            action: { type: 'string', enum: ['get', 'upsert'], default: 'get' },
            run_id: { type: 'string', minLength: 1 },
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
            prd_path: { type: 'string', minLength: 1 },
          },
        },
      },
      {
        name: 'atlas_preflight',
        description: 'Gate G10: valida família, modo e skills oficiais pela config empacotada, travando a rota da run.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'family', 'mode'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            family: { type: 'string', enum: ['claude', 'cursor', 'codex'] },
            mode: { type: 'string', enum: ['full', 'direct', 'interview-only', 'interview_only'] },
          },
        },
      },
      {
        name: 'atlas_lock_family',
        description: 'Gate G10: confirma que fase posterior respeita família travada e skill oficial.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['run_id', 'family'],
          properties: {
            run_id: { type: 'string', minLength: 1 },
            family: { type: 'string', enum: ['claude', 'cursor', 'codex'] },
            role: { type: 'string' },
            expected_skill: { type: 'string' },
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
        name === 'atlas_run_state' ? runState(args) :
        name === 'atlas_verify_artifact' ? verifyArtifact(args) :
        name === 'atlas_scan_prd' ? scanPrd(args) :
        name === 'atlas_preflight' ? preflight(args) :
        name === 'atlas_lock_family' ? lockFamily(args) :
        (() => { throw rpcError(-32601, `Tool desconhecida: ${name}`); })();
      logCall({ tool: name, run: args.run_id ?? null, status: 'ok' });
      return { id, result: toolResult(value) };
    } catch (error) {
      logCall({ tool: name, run: args.run_id ?? null, status: 'error', error: error.message });
      throw error;
    }
  }
  if (method === 'notifications/initialized') return null;
  throw rpcError(-32601, `Método desconhecido: ${method}`);
}

function send(message) {
  if (message === null || message.id === undefined) return;
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function parseMessages(buffer) {
  const messages = [];
  let rest = buffer;

  while (true) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = rest.slice(0, headerEnd);
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) break;
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (rest.length < bodyEnd) break;
    messages.push(JSON.parse(rest.slice(bodyStart, bodyEnd)));
    rest = rest.slice(bodyEnd);
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
