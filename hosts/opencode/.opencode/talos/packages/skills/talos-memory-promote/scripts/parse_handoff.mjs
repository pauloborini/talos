#!/usr/bin/env node
/**
 * Parser/filtro puro de candidatos HANDOFF (S04).
 * Sem I/O de MCP; sem escrita de vault.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VALID_ANCHOR_TYPES = Object.freeze(['EVAL', 'finding', 'symbol', 'test', 'id']);
export const MAX_CANDIDATES = 3;

const ZERO_SUCCESS_RE = /0\s+candidatos[\s\S]*?Sucesso\.?/i;
const CANDIDATE_HEADING_RE = /^###\s+Candidato\s+(\d+)\s*$/gim;
const FIELD_RE = /^(claim|âncora\.tipo|âncora\.valor|ref|motivo)\s*:\s*(.*)$/i;

/** Path de sprint/backlog sozinho como âncora — inválido (filtro D4 / template). */
const SPRINT_OR_BACKLOG_PATH_RE =
  /(?:^|[\s/`])(?:\.?\/)?(?:[\w.-]+\/)*(?:SPRINT_[A-Za-z0-9_.-]+\.md|BACKLOG_MESTRE_[A-Za-z0-9_.-]+\.md|backlog\/[^\s`]+)(?:$|[\s/`])/i;

export function isSprintOrBacklogOnlyAnchor(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Aceita só se o valor inteiro (sem claim paralelo) for path de sprint/backlog.
  const bare = trimmed.replace(/^`+|`+$/g, '').trim();
  if (/^SPRINT_[A-Za-z0-9_.-]+\.md$/i.test(bare)) return true;
  if (/^BACKLOG_MESTRE_[A-Za-z0-9_.-]+\.md$/i.test(bare)) return true;
  if (/(^|\/)sprints\/SPRINT_[A-Za-z0-9_.-]+\.md$/i.test(bare)) return true;
  if (/(^|\/)\.talos\/backlog\/(?:sprints\/)?SPRINT_[A-Za-z0-9_.-]+\.md$/i.test(bare)) return true;
  if (/(^|\/)\.talos\/backlog\/BACKLOG_MESTRE_[A-Za-z0-9_.-]+\.md$/i.test(bare)) return true;
  if (/^backlog\//i.test(bare) && /\.md$/i.test(bare)) return true;
  return SPRINT_OR_BACKLOG_PATH_RE.test(bare) && !/\s/.test(bare);
}

function extractCandidatesSection(markdown) {
  const start = markdown.search(/^##\s+Candidatos\s*\(0[–-]3\)\s*$/im);
  if (start < 0) return markdown;
  const after = markdown.slice(start);
  const endMatch = after.search(/\n##\s+(?!Candidatos)/);
  return endMatch < 0 ? after : after.slice(0, endMatch);
}

function parseFields(block) {
  const fields = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(FIELD_RE);
    if (!m) continue;
    const key = m[1].toLowerCase();
    fields[key] = (m[2] ?? '').trim();
  }
  return fields;
}

function validateCandidate(fields, index) {
  const claim = fields.claim ?? '';
  const tipo = fields['âncora.tipo'] ?? '';
  const valor = fields['âncora.valor'] ?? '';
  const ref = fields.ref ?? '';
  const motivo = fields.motivo ?? '';

  if (!claim) {
    return { ok: false, reason: 'claim_empty', index };
  }
  if (!VALID_ANCHOR_TYPES.includes(tipo)) {
    return { ok: false, reason: 'anchor_type_invalid', index, tipo };
  }
  if (!valor) {
    return { ok: false, reason: 'anchor_value_empty', index };
  }
  if (isSprintOrBacklogOnlyAnchor(valor)) {
    return { ok: false, reason: 'anchor_sprint_path_only', index, valor };
  }
  if (!motivo) {
    return { ok: false, reason: 'motivo_empty', index };
  }

  const candidate = {
    index,
    claim,
    ancora: { tipo, valor },
    motivo,
  };
  // ref opcional; path ausente / placeholder não invalida
  if (ref && !/^\(ausente/i.test(ref) && ref !== '—') {
    candidate.ref = ref;
  }
  return { ok: true, candidate };
}

/**
 * @param {string} markdown
 * @returns {{ candidates: object[], discarded: object[], zero_success: boolean }}
 */
export function parseHandoffMarkdown(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('parseHandoffMarkdown expects a string');
  }

  const section = extractCandidatesSection(markdown);
  const zero_success = ZERO_SUCCESS_RE.test(section)
    && !/^###\s+Candidato\s+\d+\s*$/im.test(section);

  if (zero_success) {
    return { candidates: [], discarded: [], zero_success: true };
  }

  const headings = [...section.matchAll(CANDIDATE_HEADING_RE)];
  const discarded = [];
  const candidates = [];

  if (headings.length === 0) {
    // Sem blocos e sem marca explícita de zero → trata como zero sucesso vazio
    if (/0\s+candidatos/i.test(section)) {
      return { candidates: [], discarded: [], zero_success: true };
    }
    return { candidates: [], discarded: [{ reason: 'no_candidates_block' }], zero_success: false };
  }

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const index = Number(heading[1]);
    const start = heading.index + heading[0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : section.length;
    const block = section.slice(start, end);

    if (i >= MAX_CANDIDATES) {
      discarded.push({ reason: 'over_cap', index, claim: parseFields(block).claim ?? '' });
      continue;
    }

    const fields = parseFields(block);
    const result = validateCandidate(fields, index);
    if (result.ok) {
      candidates.push(result.candidate);
    } else {
      discarded.push(result);
    }
  }

  return {
    candidates,
    discarded,
    zero_success: candidates.length === 0 && discarded.length === 0,
  };
}

export function parseHandoffFile(filePath) {
  const markdown = fs.readFileSync(filePath, 'utf8');
  return parseHandoffMarkdown(markdown);
}

export function run(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Usage: node parse_handoff.mjs <handoff.md>');
  const result = parseHandoffFile(argv[0]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
