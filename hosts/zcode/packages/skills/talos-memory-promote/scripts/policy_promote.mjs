#!/usr/bin/env node
/**
 * Promote → policy_manifest (S10 / Q3 = candidata + OK).
 *
 * API pura, testável, sem acoplar a runPromoteFlow:
 * - resolvePolicyTarget — resolve sprint/PLAN vivo com fence policy_manifest
 * - proposePolicyCandidates — lista candidatas SEM mutar disco
 * - applyPolicyCandidate — grava só se confirmed === true
 *
 * Soft-fail em recusa / path inválido / alvo sem fence.
 * Nunca cria .talos/policy/ nem rules globais.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHandoffMarkdown } from './parse_handoff.mjs';

const META_ROW_RE = /^\|\s*([A-Za-z0-9_./-]+)\s*\|\s*(.+?)\s*\|\s*$/gm;
const FENCE_OPEN_RE = /^```(?:ya?ml)?\s*$/im;
const POLICY_KEY_RE = /^policy_manifest\s*:/m;

/**
 * Extrai sprint_id / plan_path da tabela de metadados do HANDOFF.
 * @param {string} markdown
 */
export function extractHandoffMeta(markdown) {
  if (typeof markdown !== 'string') return {};
  const meta = {};
  for (const m of markdown.matchAll(META_ROW_RE)) {
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'campo' || key === '---' || /^-+$/.test(key)) continue;
    if (key === 'sprint_id' || key === 'plan_path') {
      meta[key] = value;
    }
  }
  return meta;
}

function softFail(code, message, extra = {}) {
  return {
    ok: false,
    soft: true,
    code,
    message,
    ...extra,
  };
}

function toPosixRel(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/') || absPath;
}

function assertUnderRoot(projectRoot, candidateAbs) {
  const root = path.resolve(projectRoot);
  const abs = path.resolve(candidateAbs);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * Localiza fence ```yaml … policy_manifest: … ``` no markdown.
 * @returns {{ start: number, end: number, body: string, full: string } | null}
 */
export function findPolicyManifestFence(markdown) {
  if (typeof markdown !== 'string') return null;
  let searchFrom = 0;
  while (searchFrom < markdown.length) {
    const openMatch = markdown.slice(searchFrom).match(FENCE_OPEN_RE);
    if (!openMatch || openMatch.index == null) return null;
    const openAbs = searchFrom + openMatch.index;
    const afterOpen = openAbs + openMatch[0].length;
    // skip leading newline after fence open
    const bodyStart = markdown[afterOpen] === '\n' ? afterOpen + 1 : afterOpen;
    const closeRel = markdown.slice(bodyStart).search(/^```\s*$/m);
    if (closeRel < 0) return null;
    const body = markdown.slice(bodyStart, bodyStart + closeRel);
    const closeAbs = bodyStart + closeRel;
    const fullEnd = closeAbs + markdown.slice(closeAbs).match(/^```[^\n]*/)?.[0].length;
    if (POLICY_KEY_RE.test(body)) {
      return {
        start: openAbs,
        end: fullEnd ?? closeAbs + 3,
        body,
        full: markdown.slice(openAbs, fullEnd ?? closeAbs + 3),
      };
    }
    searchFrom = closeAbs + 3;
  }
  return null;
}

function hasPolicyManifestFence(markdown) {
  return findPolicyManifestFence(markdown) != null;
}

/**
 * Resolve alvo de escrita: sprint file (preferência) ou PLAN com fence.
 * @param {{
 *   projectRoot: string,
 *   handoffMarkdown?: string|null,
 *   parse?: object|null,
 *   sprintId?: string|null,
 *   planPath?: string|null,
 * }} opts
 */
export function resolvePolicyTarget({
  projectRoot,
  handoffMarkdown = null,
  parse: _parse = null,
  sprintId = null,
  planPath = null,
} = {}) {
  if (!projectRoot) throw new TypeError('projectRoot required');

  const meta = handoffMarkdown ? extractHandoffMeta(handoffMarkdown) : {};
  const sid = (sprintId ?? meta.sprint_id ?? '').trim();
  const ppath = (planPath ?? meta.plan_path ?? '').trim();

  if (sid) {
    const sprintsDir = path.join(projectRoot, '.talos', 'backlog', 'sprints');
    if (!fs.existsSync(sprintsDir)) {
      return softFail('target_unresolved', `Diretório de sprints ausente para sprint_id=${sid}`, {
        target_path: null,
        kind: null,
      });
    }
    const prefix = `SPRINT_${sid}_`;
    const matches = fs.readdirSync(sprintsDir)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.md'));
    if (matches.length !== 1) {
      return softFail(
        'target_unresolved',
        matches.length === 0
          ? `Nenhum sprint file para sprint_id=${sid}`
          : `Ambíguo: ${matches.length} sprint files para sprint_id=${sid}`,
        { target_path: null, kind: null },
      );
    }
    const abs = path.join(sprintsDir, matches[0]);
    if (!assertUnderRoot(projectRoot, abs)) {
      return softFail('target_invalid', 'Path de sprint fora do project root', {
        target_path: null,
        kind: null,
      });
    }
    const md = fs.readFileSync(abs, 'utf8');
    if (!hasPolicyManifestFence(md)) {
      return softFail(
        'target_unresolved',
        `Sprint file sem fence policy_manifest: ${toPosixRel(projectRoot, abs)}`,
        { target_path: toPosixRel(projectRoot, abs), kind: null },
      );
    }
    return {
      ok: true,
      soft: false,
      target_path: toPosixRel(projectRoot, abs),
      target_abs: abs,
      kind: 'sprint',
    };
  }

  if (ppath) {
    const abs = path.isAbsolute(ppath) ? ppath : path.resolve(projectRoot, ppath);
    if (!assertUnderRoot(projectRoot, abs)) {
      return softFail('target_invalid', 'plan_path fora do project root', {
        target_path: null,
        kind: null,
      });
    }
    if (!fs.existsSync(abs)) {
      return softFail('target_unresolved', `PLAN ausente: ${ppath}`, {
        target_path: null,
        kind: null,
      });
    }
    const md = fs.readFileSync(abs, 'utf8');
    if (!hasPolicyManifestFence(md)) {
      return softFail(
        'target_unresolved',
        `PLAN sem fence policy_manifest: ${toPosixRel(projectRoot, abs)}`,
        { target_path: toPosixRel(projectRoot, abs), kind: null },
      );
    }
    return {
      ok: true,
      soft: false,
      target_path: toPosixRel(projectRoot, abs),
      target_abs: abs,
      kind: 'plan',
    };
  }

  return softFail('target_unresolved', 'Sem sprint_id nem plan_path resolvível', {
    target_path: null,
    kind: null,
  });
}

function candidateToPolicyShape(candidate) {
  const tipo = candidate?.ancora?.tipo ?? '';
  const valor = candidate?.ancora?.valor ?? '';
  return {
    claim: candidate.claim,
    anchor: `${tipo}:${valor}`,
    index: candidate.index,
    motivo: candidate.motivo,
    ref: candidate.ref,
  };
}

/**
 * Lista candidatas a policy_manifest sem mutar disco.
 * @param {{
 *   projectRoot: string,
 *   handoffMarkdown?: string|null,
 *   handoffPath?: string|null,
 *   parse?: object|null,
 *   sprintId?: string|null,
 *   planPath?: string|null,
 * }} opts
 */
export function proposePolicyCandidates({
  projectRoot,
  handoffMarkdown = null,
  handoffPath = null,
  parse: parseInput = null,
  sprintId = null,
  planPath = null,
} = {}) {
  if (!projectRoot) throw new TypeError('projectRoot required');

  let md = handoffMarkdown;
  if (md == null && handoffPath) {
    const abs = path.isAbsolute(handoffPath)
      ? handoffPath
      : path.resolve(projectRoot, handoffPath);
    if (!fs.existsSync(abs)) {
      return softFail('handoff_missing', `Handoff ausente: ${handoffPath}`, {
        candidates: [],
        target: null,
      });
    }
    md = fs.readFileSync(abs, 'utf8');
  }
  if (md == null && parseInput == null) {
    return softFail('handoff_missing', 'handoffMarkdown ou parse obrigatório', {
      candidates: [],
      target: null,
    });
  }

  const parse = parseInput ?? parseHandoffMarkdown(md);
  const target = resolvePolicyTarget({
    projectRoot,
    handoffMarkdown: md,
    parse,
    sprintId,
    planPath,
  });

  // 0 candidatas = sucesso sem write (mesmo se target soft-fail — não muta)
  if (parse.zero_success || (parse.candidates?.length ?? 0) === 0) {
    return {
      ok: true,
      soft: false,
      candidates: [],
      target: target.ok ? target : null,
      target_result: target,
      parse,
      message: '0 candidatas policy — sucesso sem write.',
    };
  }

  if (!target.ok) {
    return {
      ...target,
      candidates: [],
      target: null,
      parse,
    };
  }

  const candidates = parse.candidates.map(candidateToPolicyShape);
  return {
    ok: true,
    soft: false,
    candidates,
    target: {
      target_path: target.target_path,
      kind: target.kind,
    },
    target_result: target,
    parse,
    message: `${candidates.length} candidata(s) a policy_manifest — sem write (aguardando OK).`,
  };
}

function yamlQuote(value) {
  if (value == null) return '""';
  const s = String(value);
  if (/^[A-Za-z0-9_./:@+-]+$/.test(s) && !/^\d/.test(s)) return s;
  return JSON.stringify(s);
}

function formatPromotedItem(item) {
  const lines = [
    `  - claim: ${yamlQuote(item.claim)}`,
    `    anchor: ${yamlQuote(item.anchor)}`,
  ];
  if (item.source_handoff) {
    lines.push(`    source_handoff: ${yamlQuote(item.source_handoff)}`);
  }
  lines.push(`    confirmed_at: ${yamlQuote(item.confirmed_at)}`);
  return lines.join('\n');
}

/**
 * Detecta se claim+anchor já existe em promoted:.
 */
function alreadyPromoted(body, claim, anchor) {
  // Match list items under promoted
  const promotedIdx = body.search(/^ {2}promoted\s*:/m);
  if (promotedIdx < 0) return false;
  const after = body.slice(promotedIdx);
  // until next top-level key under policy_manifest (2 spaces + word + :)
  const nextKey = after.slice(1).search(/\n {2}[A-Za-z_][\w]*\s*:/);
  const section = nextKey < 0 ? after : after.slice(0, nextKey + 1);
  const claimEsc = claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchorEsc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `-\\s*claim:\\s*(?:${claimEsc}|"${claimEsc}"|'${claimEsc}')[\\s\\S]*?anchor:\\s*(?:${anchorEsc}|"${anchorEsc}"|'${anchorEsc}')`,
    'm',
  );
  return re.test(section);
}

/**
 * Insere ou estende `promoted:` preservando demais chaves do fence.
 */
export function appendPromotedToFenceBody(body, item) {
  if (alreadyPromoted(body, item.claim, item.anchor)) {
    return { body, idempotent: true };
  }

  const itemBlock = formatPromotedItem(item);
  const promotedMatch = body.match(/^ {2}promoted\s*:\s*$/m);
  if (promotedMatch && promotedMatch.index != null) {
    // Append after existing promoted list — find end of promoted section
    const start = promotedMatch.index + promotedMatch[0].length;
    const rest = body.slice(start);
    // next sibling key at 2-space indent (not list item)
    const nextRel = rest.search(/\n {2}[A-Za-z_][\w]*\s*:/);
    if (nextRel < 0) {
      const trimmed = body.replace(/\s*$/, '');
      return { body: `${trimmed}\n${itemBlock}\n`, idempotent: false };
    }
    const insertAt = start + nextRel;
    return {
      body: `${body.slice(0, insertAt)}\n${itemBlock}${body.slice(insertAt)}`,
      idempotent: false,
    };
  }

  // Inline empty promoted: []
  const emptyInline = body.match(/^ {2}promoted\s*:\s*\[\s*\]\s*$/m);
  if (emptyInline && emptyInline.index != null) {
    const lineEnd = emptyInline.index + emptyInline[0].length;
    return {
      body: `${body.slice(0, emptyInline.index)}  promoted:\n${itemBlock}${body.slice(lineEnd)}`,
      idempotent: false,
    };
  }

  // Create promoted: before closing — prefer after required_gates / data_safety / end of body
  const trimmed = body.replace(/\s*$/, '');
  const addition = `\n  promoted:\n${itemBlock}\n`;
  return { body: `${trimmed}${addition}`, idempotent: false };
}

/**
 * Aplica uma candidata no policy_manifest do alvo — só se confirmed === true.
 * @param {{
 *   projectRoot: string,
 *   target_path: string,
 *   candidate: { claim: string, anchor: string, source_handoff?: string },
 *   confirmed: boolean,
 * }} opts
 */
export function applyPolicyCandidate({
  projectRoot,
  target_path,
  candidate,
  confirmed,
} = {}) {
  if (!projectRoot) throw new TypeError('projectRoot required');
  if (!target_path) {
    return softFail('target_invalid', 'target_path ausente', { wrote: false });
  }
  if (confirmed !== true) {
    return softFail(
      'not_confirmed',
      'Recusa ou confirmed!==true — soft-fail sem write no policy_manifest.',
      { wrote: false, target_path },
    );
  }
  if (!candidate?.claim || !candidate?.anchor) {
    return softFail('candidate_invalid', 'candidate exige claim e anchor', {
      wrote: false,
      target_path,
    });
  }

  const abs = path.isAbsolute(target_path)
    ? target_path
    : path.resolve(projectRoot, target_path);
  if (!assertUnderRoot(projectRoot, abs)) {
    return softFail('target_invalid', 'target_path fora do project root', {
      wrote: false,
      target_path,
    });
  }
  // Bloqueia policy permanente de repo / paths proibidos
  const rel = toPosixRel(projectRoot, abs);
  if (
    rel.startsWith('.talos/policy/')
    || rel === '.talos/policy'
    || /(^|\/)(AGENTS\.md|CLAUDE\.md|\.cursor\/rules\/)/.test(rel)
  ) {
    return softFail('target_forbidden', 'Alvo proibido (policy de repo / rules globais)', {
      wrote: false,
      target_path: rel,
    });
  }
  if (!fs.existsSync(abs)) {
    return softFail('target_unresolved', `Alvo ausente: ${rel}`, {
      wrote: false,
      target_path: rel,
    });
  }

  const markdown = fs.readFileSync(abs, 'utf8');
  const fence = findPolicyManifestFence(markdown);
  if (!fence) {
    return softFail('target_unresolved', `Sem fence policy_manifest em ${rel}`, {
      wrote: false,
      target_path: rel,
    });
  }

  const item = {
    claim: candidate.claim,
    anchor: candidate.anchor,
    source_handoff: candidate.source_handoff,
    confirmed_at: candidate.confirmed_at
      ?? new Date().toISOString().slice(0, 10),
  };

  const { body: newBody, idempotent } = appendPromotedToFenceBody(fence.body, item);
  if (idempotent) {
    return {
      ok: true,
      soft: false,
      wrote: false,
      idempotent: true,
      target_path: rel,
      message: 'claim+anchor já em promoted — no-op sucesso.',
      item,
    };
  }

  // Preserve open fence language tag
  const openLine = markdown.slice(fence.start).match(/^```[^\n]*/)?.[0] ?? '```yaml';
  const newFence = `${openLine}\n${newBody.replace(/\s*$/, '\n')}\`\`\``;
  const next = `${markdown.slice(0, fence.start)}${newFence}${markdown.slice(fence.end)}`;
  fs.writeFileSync(abs, next, 'utf8');

  return {
    ok: true,
    soft: false,
    wrote: true,
    idempotent: false,
    target_path: rel,
    message: `promoted anexado em ${rel}`,
    item,
  };
}

export function run() {
  throw new Error(
    'policy_promote.mjs é biblioteca; use proposePolicyCandidates / applyPolicyCandidate via skill.',
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
