#!/usr/bin/env node
/**
 * Fluxo de promote (scripts + fixtures) — sem MCP real.
 * Resolve path de HANDOFF, parseia, detecta sink e promove (mockável).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHandoffMarkdown } from './parse_handoff.mjs';
import { detectSink, promoteCandidates, SINKS } from './sink_adapter.mjs';

const HANDOFF_FILE_RE = /^HANDOFF_.+\.md$/i;

/**
 * Resolve path de handoff: arg explícito ou mais recente sob .talos/memory/.
 * @param {{ projectRoot: string, handoffPath?: string|null }} opts
 */
export function resolveHandoffPath({ projectRoot, handoffPath = null } = {}) {
  if (!projectRoot) throw new TypeError('projectRoot required');
  if (handoffPath) {
    const abs = path.isAbsolute(handoffPath)
      ? handoffPath
      : path.resolve(projectRoot, handoffPath);
    if (!fs.existsSync(abs)) {
      return {
        ok: false,
        soft: true,
        handoff_path: handoffPath,
        message: `Handoff ausente: ${handoffPath}`,
      };
    }
    return {
      ok: true,
      handoff_path: path.relative(projectRoot, abs).split(path.sep).join('/') || abs,
      handoff_abs: abs,
    };
  }

  const memoryDir = path.join(projectRoot, '.talos', 'memory');
  if (!fs.existsSync(memoryDir)) {
    return {
      ok: false,
      soft: true,
      handoff_path: null,
      message: 'Diretório .talos/memory/ ausente — nenhum HANDOFF para promover.',
    };
  }

  const entries = fs.readdirSync(memoryDir)
    .filter((name) => HANDOFF_FILE_RE.test(name) && name !== 'HANDOFF_TEMPLATE.md')
    .map((name) => {
      const abs = path.join(memoryDir, name);
      const stat = fs.statSync(abs);
      return { name, abs, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));

  if (entries.length === 0) {
    return {
      ok: false,
      soft: true,
      handoff_path: null,
      message: 'Nenhum HANDOFF_*.md em .talos/memory/ — soft-fail handoff ausente.',
    };
  }

  const latest = entries[0];
  return {
    ok: true,
    handoff_path: path.posix.join('.talos', 'memory', latest.name),
    handoff_abs: latest.abs,
  };
}

/**
 * @param {{
 *   projectRoot: string,
 *   handoffPath?: string|null,
 *   capabilities?: object|string[],
 *   rememberFn?: Function|null,
 *   markdown?: string|null,
 * }} opts
 */
export async function runPromoteFlow({
  projectRoot,
  handoffPath = null,
  capabilities = {},
  rememberFn = null,
  markdown = null,
} = {}) {
  let resolved;
  let md = markdown;

  if (md == null) {
    resolved = resolveHandoffPath({ projectRoot, handoffPath });
    if (!resolved.ok) {
      return {
        ok: false,
        soft: true,
        sink: SINKS.NONE,
        handoff_path: resolved.handoff_path,
        promoted_count: 0,
        message: resolved.message,
        parse: null,
      };
    }
    md = fs.readFileSync(resolved.handoff_abs, 'utf8');
  } else {
    resolved = {
      ok: true,
      handoff_path: handoffPath ?? '(inline)',
      handoff_abs: null,
    };
  }

  const parse = parseHandoffMarkdown(md);
  const sink = detectSink(capabilities);

  if (parse.zero_success || parse.candidates.length === 0) {
    const promote = await promoteCandidates({
      sink,
      candidates: [],
      handoff_path: resolved.handoff_path,
      rememberFn,
    });
    return {
      ok: true,
      soft: false,
      sink,
      handoff_path: resolved.handoff_path,
      promoted_count: 0,
      message: '0 candidatos — sucesso sem chamada a sink.',
      parse,
      promote,
    };
  }

  const promote = await promoteCandidates({
    sink,
    candidates: parse.candidates,
    handoff_path: resolved.handoff_path,
    rememberFn,
  });

  return {
    ok: promote.ok,
    soft: promote.soft === true,
    sink: promote.sink,
    handoff_path: resolved.handoff_path,
    promoted_count: promote.promoted_count ?? 0,
    message: promote.message,
    parse,
    promote,
  };
}

export function run(argv = process.argv.slice(2)) {
  throw new Error(
    'promote_flow.mjs é biblioteca de teste/fluxo; use a skill $talos-memory-promote no host.',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
