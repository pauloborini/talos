#!/usr/bin/env node
/**
 * Adapter de sink para talos-memory-promote (S04).
 * detectSink / promoteCandidates são puros quanto a MCP — o agente host
 * executa `remember`; este módulo só descreve o contrato e aceita mock injetável.
 */
import { pathToFileURL } from 'node:url';

/** Sinks conhecidos. `atlas_memory_graph` é documental (nunca auto-selecionado aqui). */
export const SINKS = Object.freeze({
  ARGUS_REMEMBER: 'argus_remember',
  NONE: 'none',
  ATLAS_MEMORY_GRAPH: 'atlas_memory_graph',
});

const REMEMBER_TOOL_NAMES = new Set([
  'remember',
  'argus_remember',
  'argus_memory_remember',
  'memory_remember',
]);

function normalizeToolName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function collectToolNames(capabilities) {
  if (!capabilities) return [];
  if (Array.isArray(capabilities)) {
    return capabilities.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.name ?? item.tool ?? item.id ?? '';
      return '';
    });
  }
  if (typeof capabilities === 'object') {
    if (Array.isArray(capabilities.tools)) return collectToolNames(capabilities.tools);
    if (Array.isArray(capabilities.available_tools)) return collectToolNames(capabilities.available_tools);
    if (capabilities.remember === true || capabilities.argus_remember === true) {
      return ['remember'];
    }
    if (typeof capabilities.has_remember === 'boolean' && capabilities.has_remember) {
      return ['remember'];
    }
  }
  return [];
}

/**
 * @param {object|string[]|null|undefined} capabilities
 * @returns {'argus_remember'|'none'}
 */
export function detectSink(capabilities) {
  const names = collectToolNames(capabilities).map(normalizeToolName);
  const hasRemember = names.some((name) => {
    if (REMEMBER_TOOL_NAMES.has(name)) return true;
    // Argus MCP costuma expor `remember` ou `argus__remember` / server-prefixed
    return name === 'remember' || name.endsWith('_remember') || name.endsWith('remember');
  });
  return hasRemember ? SINKS.ARGUS_REMEMBER : SINKS.NONE;
}

/**
 * Shape nativa Argus `remember` por candidato (agente executa no host).
 * Sprint §7 D3 / PLAN §6.1: content/type/tags/links — sem claim/anchor_*.
 * @param {object} candidate
 */
export function rememberCallShape(candidate) {
  const claim = typeof candidate.claim === 'string' ? candidate.claim.trim() : '';
  const motivo = typeof candidate.motivo === 'string' ? candidate.motivo.trim() : '';
  const content = motivo ? `${claim} — ${motivo}` : claim;

  const tags = ['talos-handoff'];
  const anchorTipo = candidate.ancora?.tipo;
  const anchorValor = candidate.ancora?.valor;
  if (anchorTipo && anchorValor) {
    tags.push(`anchor:${anchorTipo}:${anchorValor}`);
  }

  /** @type {{ content: string, type: string, tags: string[], links?: string[] }} */
  const args = {
    content,
    type: 'decision',
    tags,
  };

  const ref = typeof candidate.ref === 'string' ? candidate.ref.trim() : candidate.ref;
  if (ref) {
    args.links = [ref];
  }

  return {
    tool: 'remember',
    args,
  };
}

function softFailNone(handoff_path, message) {
  return {
    ok: false,
    soft: true,
    sink: SINKS.NONE,
    handoff_path,
    message:
      message
      ?? [
        'Nenhum sink de memória disponível (Argus `remember` ausente).',
        'O HANDOFF permanece no disco para uso manual, instalação opcional do Argus, ou chat Atlas (porta Memory Graph).',
        'Não é hard-fail: o pipeline Talos já pode estar `done`.',
      ].join(' '),
    promoted_count: 0,
    next_steps: [
      'usar o MD do handoff manualmente',
      'instalar/ativar Argus (opcional) e rerodar $talos-memory-promote',
      'colar/anexar o HANDOFF no chat Atlas Agents (sink atlas_memory_graph — Core, fora deste plugin)',
    ],
  };
}

/**
 * Promove candidatos via adapter. Sem hard-fail quando sink=none.
 * Para `argus_remember`, `rememberFn` deve ser injetada nos testes; no host o
 * agente chama MCP `remember` usando `rememberCallShape` (este script puro
 * não invoca MCP por conta própria se rememberFn estiver ausente — retorna
 * shapes prontos).
 *
 * @param {{ sink: string, candidates: object[], handoff_path: string, rememberFn?: Function }} opts
 */
export async function promoteCandidates({
  sink,
  candidates = [],
  handoff_path,
  rememberFn = null,
} = {}) {
  if (!handoff_path || typeof handoff_path !== 'string') {
    throw new TypeError('promoteCandidates requires handoff_path string');
  }

  const list = Array.isArray(candidates) ? candidates.slice(0, 3) : [];

  if (sink === SINKS.NONE || sink == null) {
    if (list.length === 0) {
      return {
        ok: true,
        soft: false,
        sink: SINKS.NONE,
        handoff_path,
        promoted_count: 0,
        message: '0 candidatos — sucesso sem chamada a sink.',
        calls: [],
      };
    }
    return softFailNone(handoff_path);
  }

  if (sink === SINKS.ATLAS_MEMORY_GRAPH) {
    return {
      ok: false,
      soft: true,
      sink: SINKS.ATLAS_MEMORY_GRAPH,
      handoff_path,
      promoted_count: 0,
      message:
        'Sink atlas_memory_graph é porta documental do Core Atlas — não selecionado automaticamente neste plugin. Use o HANDOFF no chat Atlas.',
      calls: [],
    };
  }

  if (sink !== SINKS.ARGUS_REMEMBER) {
    return softFailNone(handoff_path, `Sink desconhecido '${sink}' — tratando como none.`);
  }

  if (list.length === 0) {
    return {
      ok: true,
      soft: false,
      sink: SINKS.ARGUS_REMEMBER,
      handoff_path,
      promoted_count: 0,
      message: '0 candidatos — sucesso sem chamada a sink.',
      calls: [],
    };
  }

  const calls = list.map(rememberCallShape);

  if (typeof rememberFn !== 'function') {
    // Contrato para o agente: shapes prontas; script puro não chama MCP.
    return {
      ok: true,
      soft: false,
      sink: SINKS.ARGUS_REMEMBER,
      handoff_path,
      promoted_count: 0,
      pending_agent_calls: true,
      calls,
      message: 'Shapes de remember prontas — agente deve executar remember por candidato.',
    };
  }

  let promoted_count = 0;
  const results = [];
  for (const call of calls) {
    // eslint-disable-next-line no-await-in-loop
    const result = await rememberFn(call.args);
    results.push(result);
    promoted_count += 1;
  }

  return {
    ok: true,
    soft: false,
    sink: SINKS.ARGUS_REMEMBER,
    handoff_path,
    promoted_count,
    calls,
    results,
    message: `Promovidos ${promoted_count} candidato(s) via argus_remember.`,
  };
}

export function run(argv = process.argv.slice(2)) {
  if (argv[0] === 'detect') {
    const caps = argv[1] ? JSON.parse(argv[1]) : {};
    process.stdout.write(`${JSON.stringify({ sink: detectSink(caps) })}\n`);
    return;
  }
  throw new Error('Usage: node sink_adapter.mjs detect [<capabilities-json>]');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
