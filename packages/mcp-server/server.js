#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'atlas-workflow-orchestrator';
const RUN_DIR = '.atlas-run';
const SENSITIVE_KEY = /(authorization|credential|password|secret|token|api[_-]?key)/i;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

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
    capabilities: ['atlas_ping', 'atlas_run_state'],
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

function runState(args = {}) {
  const action = args.action ?? 'get';
  if (action === 'get') return readState(validateRunId(args.run_id));
  if (action === 'upsert') return upsertState(args);
  throw rpcError(-32602, `Ação inválida para atlas_run_state: ${action}`);
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
