#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VALID = Object.freeze({
  moscow: new Set(['Must', 'Should', 'Could', "Won't now"]),
  gain: new Set(['alto', 'médio', 'baixo']),
  effort: new Set(['alto', 'médio', 'baixo']),
  priority: new Set(['P0', 'P1', 'P2', 'P3']),
  state: new Set(['backlog', 'ready', 'doing', 'review', 'manual_validation_pending', 'done', 'blocked']),
});
const SPRINT_ID_SOURCE = 'S\\d{2}(?:[a-z]|\\.\\d+)?';
const SPRINT_ID_REGEX = new RegExp(`^${SPRINT_ID_SOURCE}$`);

const STACK_MANIFESTS = [
  'package.json', 'tsconfig.json', 'pubspec.yaml', 'pyproject.toml', 'requirements.txt', 'setup.py',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  'firebase.json', '.firebaserc', 'openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.yaml', 'swagger.yml', 'swagger.json',
];

function boundaryRoot(projectRoot, boundary) {
  const project = path.resolve(projectRoot);
  let current = path.resolve(project, boundary ?? '.');
  const relative = path.relative(project, current);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`BOUNDARY_OUTSIDE_PROJECT:${boundary}`);
  }
  if (fs.existsSync(current) && fs.statSync(current).isFile()) current = path.dirname(current);
  while (current === project || current.startsWith(`${project}${path.sep}`)) {
    if (STACK_MANIFESTS.some((name) => fs.existsSync(path.join(current, name)))) return current;
    if (current === project) break;
    current = path.dirname(current);
  }
  return path.resolve(project, boundary ?? '.');
}

function containsGetxImport(root) {
  const queue = ['lib', 'test'].map((name) => path.join(root, name)).filter((dir) => fs.existsSync(dir));
  let inspected = 0;
  while (queue.length > 0 && inspected < 5000) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile() && entry.name.endsWith('.dart')) {
        inspected += 1;
        if (/package:get\/get(?:_core)?\.dart/.test(fs.readFileSync(target, 'utf8'))) return true;
      }
    }
  }
  return false;
}

function detectBoundaryProfile(root, declaredCommands) {
  const exists = (name) => fs.existsSync(path.join(root, name));
  const readIfExists = (name) => {
    try { return exists(name) ? fs.readFileSync(path.join(root, name), 'utf8') : ''; } catch { return ''; }
  };
  const commands = declaredCommands.filter((v) => typeof v === 'string');
  let packageJson = null;
  if (exists('package.json')) {
    try { packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
  }
  let pubspec = '';
  if (exists('pubspec.yaml')) {
    try { pubspec = fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8'); } catch {}
  }
  const packageCommands = Object.values(packageJson?.scripts ?? {}).filter((v) => typeof v === 'string');
  const packageDeps = Object.keys({
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
    ...(packageJson?.peerDependencies ?? {}),
    ...(packageJson?.optionalDependencies ?? {}),
  });
  const cargo = readIfExists('Cargo.toml');
  const pom = readIfExists('pom.xml');
  const gradle = `${readIfExists('build.gradle')}\n${readIfExists('build.gradle.kts')}\n${readIfExists('settings.gradle')}\n${readIfExists('settings.gradle.kts')}`;
  const allCommands = [...commands, ...packageCommands];
  const hasCommand = (re) => allCommands.some((command) => re.test(command));
  const hasPackageDep = (re) => packageDeps.some((dep) => re.test(dep));
  const javaKotlinSignal = exists('pom.xml') || exists('build.gradle') || exists('build.gradle.kts')
    || exists('settings.gradle') || exists('settings.gradle.kts') || hasCommand(/\b(gradle|mvn|java|javac|kotlinc)\b/);
  const restSignal = exists('openapi.yaml') || exists('openapi.yml') || exists('openapi.json')
    || exists('swagger.yaml') || exists('swagger.yml') || exists('swagger.json')
    || hasPackageDep(/\b(openapi|swagger|express|fastify|koa|hono|axios|ky)\b/i)
    || /openapi|swagger|spring-boot-starter-web|ktor|retrofit/i.test(`${pom}\n${gradle}\n${pubspec}`);
  return {
    universal: true,
    flutter_dart: exists('pubspec.yaml') || hasCommand(/\b(flutter|dart)\b/),
    node_typescript: exists('package.json') || exists('tsconfig.json') || hasCommand(/\b(node|npm|pnpm|yarn|bun|tsc)\b/),
    python: exists('pyproject.toml') || exists('requirements.txt') || exists('setup.py') || hasCommand(/\b(python3?|pytest|ruff|mypy)\b/),
    go: exists('go.mod') || hasCommand(/\bgo\s+(test|build|run|vet|fmt)\b/),
    rust: exists('Cargo.toml') || hasCommand(/\bcargo\s+(test|build|run|check|clippy|fmt)\b/) || /^\s*\[package\]/m.test(cargo),
    java_kotlin: javaKotlinSignal,
    firebase: exists('firebase.json') || exists('.firebaserc') || hasPackageDep(/^firebase$|^@firebase\/|firebase-admin/i)
      || /firebase_core|cloud_firestore|firebase_auth|firebase_messaging|firebase_storage/i.test(pubspec),
    supabase: hasPackageDep(/^@supabase\/|supabase-js/i) || /supabase_flutter|supabase|postgrest/i.test(pubspec),
    rest_openapi: restSignal,
    getx: /^\s{0,4}get\s*:/m.test(pubspec) || containsGetxImport(root),
  };
}

export function detectStackProfiles(root, declaredCommands = [], boundaryPaths = ['.']) {
  const project = path.resolve(root);
  const requested = boundaryPaths.length > 0 ? boundaryPaths : ['.'];
  const boundaries = [...new Set(requested.map((boundary) => boundaryRoot(project, boundary)))].map((dir) => ({
    boundary: path.relative(project, dir).replaceAll('\\', '/') || '.',
    ...detectBoundaryProfile(dir, declaredCommands),
  }));
  return {
    universal: true,
    flutter_dart: boundaries.some((profile) => profile.flutter_dart),
    node_typescript: boundaries.some((profile) => profile.node_typescript),
    python: boundaries.some((profile) => profile.python),
    go: boundaries.some((profile) => profile.go),
    rust: boundaries.some((profile) => profile.rust),
    java_kotlin: boundaries.some((profile) => profile.java_kotlin),
    firebase: boundaries.some((profile) => profile.firebase),
    supabase: boundaries.some((profile) => profile.supabase),
    rest_openapi: boundaries.some((profile) => profile.rest_openapi),
    getx: boundaries.some((profile) => profile.getx),
    boundaries,
  };
}

function parseTable(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return [];
  const tail = markdown.slice(start + heading.length);
  const end = tail.search(/\n##?\s/);
  return (end < 0 ? tail : tail.slice(0, end)).split('\n')
    .filter((line) => /^\|.*\|\s*$/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length && !cells.every((cell) => /^-+$/.test(cell)));
}

export function parseSprintRows(markdown) {
  const rows = parseTable(markdown, '## 7. Registro de sprints');
  const header = rows.findIndex((row) => row[0] === 'ID');
  if (header < 0) return [];
  return rows.slice(header + 1).filter((row) => SPRINT_ID_REGEX.test(row[0])).map((row) => ({
    id: row[0], name: row[1], phase: row[2], objective: row[3], moscow: row[4], gain: (row[5] ?? '').toLowerCase(),
    effort: (row[6] ?? '').toLowerCase(), priority: row[7], prd: row[8], dependencies: row[9], state: row[10], gate: row[11],
    sprint_file: row[12] ?? null, plan: row[13] ?? null, state_file: row[14] ?? null,
    // D2/D6 (v0.15.0): flag de revalidação na coluna 15 (fim do índice, após
    // State). Célula ausente em artefato pré-coluna = vazia → false (sem quebrar
    // linhas legadas com 15 células). Flag ≠ status (INV4): não entra em enums.
    revalidation_required: /^(true|yes|1)$/i.test(row[15] ?? ''),
    raw: row,
  }));
}

function lineOf(markdown, pattern) {
  const lines = markdown.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  return index < 0 ? null : index + 1;
}

function tableValue(markdown, label) {
  const re = new RegExp(`^\\|\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'im');
  const match = re.exec(markdown);
  return match ? match[1].trim() : null;
}

function fencedYamlBlock(markdown, key) {
  const re = new RegExp('```ya?ml\\s*([\\s\\S]*?\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:[\\s\\S]*?)```', 'i');
  const match = re.exec(markdown);
  return match ? match[1] : null;
}

function unquoteYaml(value) {
  const v = (value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function parseInlineYamlList(value) {
  const v = (value ?? '').trim();
  const match = /^\[(.*)\]$/.exec(v);
  if (!match) return null;
  if (!match[1].trim()) return [];
  return match[1].split(',').map((token) => unquoteYaml(token.trim())).filter(Boolean);
}

function applyItemField(item, text) {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(text);
  if (!match) return;
  const [, key, raw] = match;
  const val = raw.trim();
  if (key === 'id') item.id = unquoteYaml(val);
  else if (key === 'behavior') item.behavior = unquoteYaml(val);
  else if (key === 'scenario') item.scenario = unquoteYaml(val);
  else if (key === 'origin') item.origin = unquoteYaml(val);
  else if (key === 'decisions') item.decisions = parseInlineYamlList(val) ?? [];
  else if (key === 'evals') item.evals = parseInlineYamlList(val) ?? [];
}

function applyManualField(manual, text) {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(text);
  if (!match) return;
  const [, key, raw] = match;
  const val = raw.trim();
  if (val.startsWith('[')) manual[key] = parseInlineYamlList(val) ?? [];
  else manual[key] = unquoteYaml(val);
}

/**
 * Parser minimalista do subset `acceptance` do contrato §7.3.
 * Determinístico para o formato definido em PROPOSTA_V0_15_0 §4: lista de maps
 * com campos escalares, listas inline `[...]` e submapa `evidence` (required + manual).
 * Não é parser YAML geral. Retorna `null` se não houver bloco `acceptance`; `[]` se vazio.
 */
function parseAcceptanceItems(blockText) {
  const lines = blockText.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*acceptance\s*:\s*$/.test(lines[i])) { start = i + 1; break; }
    if (/^\s*acceptance\s*:\s*\[\]\s*$/.test(lines[i])) return [];
  }
  if (start < 0) return null;

  const items = [];
  let item = null;
  let baseIndent = -1;
  let evidenceIndent = -1;
  let manualIndent = -1;

  const flush = () => {
    if (item) {
      if (!item.evidence) item.evidence = { required: [], manual: null };
      items.push(item);
    }
    item = null; evidenceIndent = -1; manualIndent = -1;
  };

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (indent === 0 && /^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(trimmed)) { flush(); break; }

    if (/^- /.test(trimmed)) {
      flush();
      item = {};
      baseIndent = indent;
      applyItemField(item, trimmed.replace(/^-\s+/, ''));
      continue;
    }
    if (!item) continue;

    if (manualIndent >= 0 && indent > manualIndent) {
      if (item.evidence && item.evidence.manual) applyManualField(item.evidence.manual, trimmed);
      continue;
    }
    if (manualIndent >= 0 && indent <= manualIndent) manualIndent = -1;

    if (evidenceIndent >= 0 && indent > evidenceIndent) {
      if (trimmed.startsWith('manual:')) {
        const val = trimmed.replace(/^manual:\s*/, '').trim();
        if (val === 'null' || val === '') {
          item.evidence.manual = val === '' ? {} : null;
          if (val === '') manualIndent = indent;
        } else {
          item.evidence.manual = null;
        }
      } else if (trimmed.startsWith('required:')) {
        const val = trimmed.replace(/^required:\s*/, '');
        item.evidence.required = parseInlineYamlList(val);
        if (!item.evidence.required) {
          item.evidence.required = (val.trim() && val.trim() !== 'null') ? [unquoteYaml(val)] : [];
        }
      }
      continue;
    }
    if (evidenceIndent >= 0 && indent <= evidenceIndent) evidenceIndent = -1;

    if (trimmed.startsWith('evidence:')) {
      item.evidence = { required: [], manual: null };
      evidenceIndent = indent;
    } else {
      applyItemField(item, trimmed);
    }
  }
  flush();
  return items;
}

/** Extrai e parseia o bloco `acceptance` (AC-*) do §7.3. `null` se ausente; `[]` se vazio. */
export function parseAcceptanceContract(markdown) {
  const section7 = extractSectionMarkdown(markdown, 7) ?? '';
  const fenceRe = /```ya?ml\s*\n([\s\S]*?)```/gi;
  let blockText = null;
  let match;
  while ((match = fenceRe.exec(section7)) !== null) {
    if (/^\s*acceptance\s*:/m.test(match[1])) { blockText = match[1]; break; }
  }
  if (blockText == null) return null;
  return parseAcceptanceItems(blockText);
}

/** Conjunto de ids `EVAL-*` declarados no `eval_manifest` do §9. */
export function extractEvalIds(markdown) {
  const block = fencedYamlBlock(markdown, 'eval_manifest');
  if (!block) return new Set();
  return new Set([...block.matchAll(/id:\s*["']?(EVAL-\d+)["']?/g)].map((m) => m[1]));
}

/** Enum fixo de reasons da review crítica (D06/D09 — sem inferência por prosa). */
export const CRITICAL_REVIEW_REASONS = Object.freeze([
  'authorization', 'payment', 'data_migration', 'public_contract', 'host_adapter_dispatch',
]);

/**
 * Parseia o subbloco `critical_review` do `policy_manifest` (subset determinístico,
 * mesmo padrão do parser de acceptance — sem js-yaml).
 * Retorna `null` quando `critical_review` está ausente; senão
 * `{ required, reasons }` — `required` preserva o valor cru (true/false/outro,
 * para a conformance julgar boolean) e `reasons` é array (vazio se ausente).
 */
export function parseCriticalReview(policyBlock) {
  if (!policyBlock) return null;
  const lines = policyBlock.split(/\r?\n/);
  let found = false;
  let required = null;
  let reasons = null;
  let collectingList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.search(/\S/);
    if (!found) {
      if (/^critical_review\s*:\s*$/.test(trimmed)) found = true;
      continue;
    }
    // Indent <= 2 com chave = volta ao topo do policy_manifest (fim do subbloco).
    if (indent <= 2 && /^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(trimmed)) break;
    if (collectingList && indent > 4 && /^-\s+/.test(trimmed)) {
      reasons.push(unquoteYaml(trimmed.replace(/^-\s+/, '')));
      continue;
    }
    collectingList = false;
    const field = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!field) continue;
    if (field[1] === 'required') {
      const raw = field[2].trim();
      required = /^true$/i.test(raw) ? true : /^false$/i.test(raw) ? false : raw;
    } else if (field[1] === 'reasons') {
      const inline = parseInlineYamlList(field[2]);
      if (inline !== null) {
        reasons = inline;
      } else if (field[2].trim() === '') {
        reasons = [];
        collectingList = true;
      } else {
        reasons = [unquoteYaml(field[2])];
      }
    }
  }
  if (!found) return null;
  return { required, reasons: reasons ?? [] };
}

/** D06/D09: review crítica só se `policy_manifest.critical_review.required === true`. */
export function requiresCriticalReview(policyBlock) {
  const critical = parseCriticalReview(policyBlock);
  return critical !== null && critical.required === true;
}

function cleanPathToken(value) {
  if (!value || value === '—') return '';
  const link = /\[[^\]]+\]\(([^)]+)\)/.exec(value);
  const raw = link ? link[1] : value;
  return raw.replace(/^["'`]+|["'`]+$/g, '').trim();
}

function normalizedPathToken(value) {
  return cleanPathToken(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function sprintFilePending(value) {
  return !value || /^\[/.test(value) || /pendente|pending/i.test(value);
}

function sprintConformancePending(category, item, line, message, nextAction = 'corrigir_sprint_file') {
  return { category, item, line, message, next_action: nextAction };
}

function isStandaloneBacklog(value) {
  return typeof value === 'string' && /^Não aplicável \(standalone\)$/i.test(value.trim());
}

/**
 * Procedência por linha (v0.16.0, D3/D5). Enum: `usuario` | `premissa` |
 * `derivado:<path>`. Para `derivado:` sem sufixo ` (novo)`, resolve o path
 * contra `root` com `fs.existsSync` quando `root` é fornecido; sem `root`,
 * pula a resolução e devolve `kind: 'derivado'` sem julgar existência
 * (parse puro sem acesso a disco). Erro de leitura no path conta como
 * inexistente, com o motivo em `reason`.
 */
export function validateOriginToken(raw, { root = null } = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, kind: null, path: null, reason: 'origem ausente' };
  }
  const token = raw.trim();
  if (token === 'usuario') return { valid: true, kind: 'usuario', path: null, reason: null };
  if (token === 'premissa') return { valid: true, kind: 'premissa', path: null, reason: null };
  if (token.startsWith('derivado:')) {
    let target = token.slice('derivado:'.length).trim();
    const isNew = target.endsWith('(novo)');
    if (isNew) target = target.slice(0, -(('(novo)').length)).trim();
    if (!target) return { valid: false, kind: 'derivado', path: null, reason: 'derivado sem path' };
    if (isNew || !root) return { valid: true, kind: 'derivado', path: target, reason: null };
    const normalized = target.replaceAll('\\', '/').replace(/^\.\//, '');
    const absolute = path.resolve(root, normalized);
    let exists = false;
    let failure = null;
    try {
      exists = fs.existsSync(absolute);
    } catch (error) {
      failure = error.message;
    }
    if (!exists) {
      return {
        valid: false,
        kind: 'derivado',
        path: target,
        reason: failure ? `erro de leitura no path: ${failure}` : 'path não existe no root do consumidor',
      };
    }
    return { valid: true, kind: 'derivado', path: target, reason: null };
  }
  return { valid: false, kind: null, path: null, reason: `fora do enum (usuario | derivado:<path> | premissa): ${token}` };
}

/** Linhas `D<n>` da §7.1 com célula `Origem` resolvida pela posição do cabeçalho. */
function contractDecisionRows(markdown) {
  const section7 = extractSectionMarkdown(markdown, 7);
  if (!section7) return { hasOriginColumn: false, rows: [] };
  const headingMatch = /^###\s+7\.1\b[^\n]*$/im.exec(section7);
  if (!headingMatch) return { hasOriginColumn: false, rows: [] };
  const tail = section7.slice(headingMatch.index + headingMatch[0].length);
  const end = tail.search(/\n#{2,3}\s/);
  const body = end < 0 ? tail : tail.slice(0, end);
  const tableRows = body.split('\n')
    .filter((line) => /^\|.*\|\s*$/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length > 0 && !cells.every((cell) => /^:?-+:?$/.test(cell)));
  const headerIndex = tableRows.findIndex((cells) => cells[0] === 'ID');
  if (headerIndex < 0) return { hasOriginColumn: false, rows: [] };
  const header = tableRows[headerIndex];
  const originIndex = header.findIndex((cell) => /^Origem$/i.test(cell));
  const rows = tableRows.slice(headerIndex + 1)
    .filter((cells) => /^D\d+$/.test(cells[0]))
    .map((cells) => ({
      id: cells[0],
      origin: originIndex >= 0 && originIndex < cells.length ? cells[originIndex] : null,
    }));
  return { hasOriginColumn: originIndex >= 0, rows };
}

function extractSectionMarkdown(markdown, sectionNumber) {
  const start = new RegExp(`^##\\s+${sectionNumber}\\.\\s`, 'im').exec(markdown);
  if (!start) return null;
  const from = start.index;
  const tail = markdown.slice(from + start[0].length);
  const next = /\n##\s+\d+\./.exec(tail);
  return next ? markdown.slice(from, from + start[0].length + next.index) : markdown.slice(from);
}

function normalizeAcceptanceBlock(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** Extrai o bloco §7 (contrato) normalizado — mesma normalização na gravação e na verificação. */
export function extractAcceptanceBlock(markdown) {
  const start = /^##\s+7\.\s/im.exec(markdown);
  if (!start) return null;
  const from = start.index;
  const tail = markdown.slice(from);
  const afterHeading = tail.slice(start[0].length);
  const next = /\n##\s/.exec(afterHeading);
  const raw = next ? tail.slice(0, start[0].length + next.index) : tail;
  return normalizeAcceptanceBlock(raw);
}

/** Retorna `sha256:<hex>` do bloco §7, ou null se §7 ausente. */
export function computeAcceptanceSeal(markdown) {
  const block = extractAcceptanceBlock(markdown);
  if (block == null) return null;
  const hash = crypto.createHash('sha256').update(block, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Selo write-once do contrato de produto.
 * - draft (ou status ≠ aprovado): selo ignorado → { sealed:false, tampered:false }
 * - aprovado sem selo válido: { sealed:false, tampered:true }
 * - aprovado com selo: compara sha256 do §7 → tampered se divergir
 */
export function validateAcceptanceSeal(markdown) {
  const status = tableValue(markdown, 'Contrato status');
  if (!status || !/^aprovado$/i.test(status.trim())) {
    return { sealed: false, tampered: false };
  }
  const sealRaw = tableValue(markdown, 'Selo do contrato');
  if (!sealRaw || !/^sha256:[a-f0-9]{64}$/i.test(sealRaw.trim())) {
    return { sealed: false, tampered: true };
  }
  const expected = computeAcceptanceSeal(markdown);
  if (!expected) {
    return { sealed: false, tampered: true };
  }
  return {
    sealed: true,
    tampered: expected.toLowerCase() !== sealRaw.trim().toLowerCase(),
  };
}

export function validateSprintFileConformance(markdown, {
  sprintPath = null,
  sprintId = null,
  backlogPath = null,
  backlogMarkdown = null,
  root = null,
} = {}) {
  const pendencies = [];
  let premissaCount = 0;
  const moscowValue = tableValue(markdown, 'MoSCoW');
  const prioridadeValue = tableValue(markdown, 'Prioridade');
  const prioridadeSprint = moscowValue === 'Must' || prioridadeValue === 'P0';
  const requiredSections = [
    '1. Metadados',
    '2. Objetivo e valor',
    '3. Escopo da sprint',
    '4. Contexto e fontes',
    '5. Dependências e bloqueios',
    '6. Decisões da sprint',
    '7. Contrato de produto (congelado)',
    '8. Definition of Ready',
    '9. Eval manifest',
    '10. Policy manifest',
    '11. Guia e sensores',
    '12. Evidence-to-claim',
    '13. PLAN',
    '14. Execução e validação',
    '15. Aprendizados e handoff para próximas sprints',
    '16. Histórico',
  ];
  for (const section of requiredSections) {
    if (!new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(markdown)) {
      pendencies.push(sprintConformancePending('seção_obrigatória', section, null, `Seção obrigatória ausente: ${section}`));
    }
  }

  const titleSprint = new RegExp(`^#\\s+Sprint viva\\s+—\\s+(${SPRINT_ID_SOURCE})\\b`, 'im').exec(markdown)?.[1] ?? null;
  const metadataSprint = tableValue(markdown, 'Sprint ID');
  const expectedSprintId = sprintId ?? metadataSprint ?? titleSprint;
  if (!metadataSprint || !SPRINT_ID_REGEX.test(metadataSprint)) {
    pendencies.push(sprintConformancePending('metadados', 'Sprint ID', lineOf(markdown, /^\|\s*Sprint ID\s*\|/i), 'Sprint ID ausente ou inválido.', 'corrigir_sprint_id'));
  }
  if (sprintId && metadataSprint && sprintId !== metadataSprint) {
    pendencies.push(sprintConformancePending('metadados', 'Sprint ID', lineOf(markdown, /^\|\s*Sprint ID\s*\|/i), `Sprint ID divergente: esperado ${sprintId}, recebido ${metadataSprint}.`, 'alinhar_sprint_id'));
  }
  if (titleSprint && metadataSprint && titleSprint !== metadataSprint) {
    pendencies.push(sprintConformancePending('metadados', 'título', 1, `Sprint ID do título (${titleSprint}) diverge dos metadados (${metadataSprint}).`, 'alinhar_sprint_id'));
  }

  const status = tableValue(markdown, 'Status');
  if (!VALID.state.has(status)) {
    pendencies.push(sprintConformancePending('metadados', 'Status', lineOf(markdown, /^\|\s*Status\s*\|/i), `Status inválido: ${status ?? '<ausente>'}.`, 'corrigir_status'));
  }

  const backlog = tableValue(markdown, 'Backlog mestre');
  const standalone = isStandaloneBacklog(backlog);
  if (!standalone && (!backlog || sprintFilePending(backlog))) {
    pendencies.push(sprintConformancePending('metadados', 'Backlog mestre', lineOf(markdown, /^\|\s*Backlog mestre\s*\|/i), 'Backlog mestre ausente no sprint file.', 'vincular_backlog_mestre'));
  }

  const contratoStatus = tableValue(markdown, 'Contrato status');
  if (!contratoStatus || !/^(draft|aprovado)$/i.test(contratoStatus)) {
    pendencies.push(sprintConformancePending(
      'contrato_produto',
      'Contrato status',
      lineOf(markdown, /^\|\s*Contrato status\s*\|/i),
      `Contrato status inválido ou ausente: ${contratoStatus ?? '<ausente>'} (esperado draft|aprovado).`,
      'preencher_contrato_status',
    ));
  }

  const section7 = extractSectionMarkdown(markdown, 7) ?? '';
  if (!/\|\s*D\d+\s*\|/.test(section7)) {
    pendencies.push(sprintConformancePending(
      'contrato_produto',
      'decisoes',
      lineOf(markdown, /^##\s+7\./i),
      'Contrato §7 sem decisão de produto D* (| D<n> |).',
      'preencher_decisoes_produto',
    ));
  }
  // LEG1: validação de aceite substitui os 4 grupos checkbox por AC-* (YAML acceptance).
  const acceptanceItems = parseAcceptanceContract(markdown);
  if (acceptanceItems == null) {
    pendencies.push(sprintConformancePending(
      'contrato_produto',
      'aceite',
      lineOf(markdown, /^##\s+7\./i),
      'Contrato §7 sem bloco `acceptance` (YAML com AC-*).',
      'preencher_aceite_binario',
    ));
  } else {
    const VALID_EVIDENCE = new Set(['I', 'T-outcome', 'W', 'M']);
    const seenIds = new Set();
    const evalIds = extractEvalIds(markdown);
    for (const item of acceptanceItems) {
      if (!item.id || !/^AC-\d+$/.test(item.id)) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `AC com id inválido/ausente: ${item.id ?? '<ausente>'} (esperado AC-\\d+).`,
          'corrigir_aceite_id',
        ));
        continue;
      }
      if (seenIds.has(item.id)) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `AC duplicado: ${item.id}.`,
          'corrigir_aceite_duplicado',
        ));
      }
      seenIds.add(item.id);
      // Procedência por linha (v0.16.0, D3/D5/D17): todo AC declara `origin`.
      if (item.origin === undefined || item.origin === null || String(item.origin).trim() === '') {
        pendencies.push(sprintConformancePending(
          'procedencia_ausente',
          item.id,
          lineOf(markdown, /^##\s+7\./i),
          `AC ${item.id} sem \`origin\` (procedência obrigatória no schema 0.16.0).`,
          'migrar_para_0_16',
        ));
      } else {
        const originCheck = validateOriginToken(item.origin, { root });
        if (!originCheck.valid) {
          if (originCheck.kind === 'derivado' && originCheck.path) {
            pendencies.push(sprintConformancePending(
              'origem_path_inexistente',
              item.id,
              lineOf(markdown, /^##\s+7\./i),
              `AC ${item.id} com origem inexistente: ${item.origin} (${originCheck.reason}).`,
              'corrigir_origem_path',
            ));
          } else {
            pendencies.push(sprintConformancePending(
              'procedencia_invalida',
              item.id,
              lineOf(markdown, /^##\s+7\./i),
              `AC ${item.id} com origem inválida: ${item.origin} (${originCheck.reason}).`,
              'corrigir_origem',
            ));
          }
        } else if (originCheck.kind === 'premissa') {
          premissaCount += 1;
          if (prioridadeSprint) {
            pendencies.push(sprintConformancePending(
              'procedencia_premissa_em_prioridade',
              item.id,
              lineOf(markdown, /^##\s+7\./i),
              `AC ${item.id} apoiado em \`origin: premissa\` em sprint ${moscowValue === 'Must' ? 'MoSCoW Must' : 'Prioridade P0'} — fechar em entrevista antes de sustentar aceite.`,
              'fechar_premissa_em_entrevista',
            ));
          }
        }
      }
      if (!item.behavior || !item.behavior.trim()) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `AC ${item.id} sem behavior observável.`,
          'preencher_aceite_behavior',
        ));
      }
      const evidence = item.evidence ?? { required: [], manual: null };
      const required = Array.isArray(evidence.required) ? evidence.required : [];
      if (required.length === 0) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `AC ${item.id} sem evidence.required.`,
          'preencher_aceite_evidence',
        ));
      } else {
        const invalid = required.filter((t) => !VALID_EVIDENCE.has(t));
        if (invalid.length > 0) {
          pendencies.push(sprintConformancePending(
            'contrato_produto',
            'aceite',
            lineOf(markdown, /^##\s+7\./i),
            `AC ${item.id} com evidence.required inválido: ${invalid.join(', ')} (válidos: I, T-outcome, W, M).`,
            'corrigir_aceite_evidence',
          ));
        }
      }
      // AC sem M exige provas automáticas; com M, `manual` deve ser objeto (não vazio) ou null.
      const hasManual = !!required.includes('M');
      const manualObj = evidence.manual && typeof evidence.manual === 'object' ? evidence.manual : null;
      if (hasManual && !manualObj) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `AC ${item.id} declara evidence M mas sem objeto manual.`,
          'preencher_aceite_manual',
        ));
      }
      if (!hasManual && manualObj) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `AC ${item.id} tem objeto manual sem evidence M em required.`,
          'corrigir_aceite_manual_sem_M',
        ));
      }
      // D3/D21: hierarquia AC ⊃ EVAL. Todo EVAL referenciado deve existir no §9.
      for (const evalId of (item.evals ?? [])) {
        if (!/^EVAL-\d+$/.test(evalId)) {
          pendencies.push(sprintConformancePending(
            'contrato_produto',
            'aceite',
            lineOf(markdown, /^##\s+7\./i),
            `AC ${item.id} referencia EVAL inválido: ${evalId}.`,
            'corrigir_aceite_evals',
          ));
        } else if (evalIds.size > 0 && !evalIds.has(evalId)) {
          pendencies.push(sprintConformancePending(
            'contrato_produto',
            'aceite',
            lineOf(markdown, /^##\s+7\./i),
            `AC ${item.id} referencia EVAL órfão: ${evalId} não declarado no eval_manifest (§9).`,
            'corrigir_aceite_evals',
          ));
        }
      }
    }
    // D21: todo EVAL do must_prove deve aparecer em ≥1 AC.
    for (const evalId of evalIds) {
      const referenced = acceptanceItems.some((item) => (item.evals ?? []).includes(evalId));
      if (!referenced) {
        pendencies.push(sprintConformancePending(
          'contrato_produto',
          'aceite',
          lineOf(markdown, /^##\s+7\./i),
          `EVAL órfão: ${evalId} declarado no §9 mas não referenciado por nenhum AC.`,
          'vincular_eval_a_ac',
        ));
      }
    }
  }

  // Procedência por linha nas decisões D* da §7.1 (v0.16.0, D3/D5/D17).
  const contractDecisions = contractDecisionRows(markdown);
  if (/\|\s*D\d+\s*\|/.test(extractSectionMarkdown(markdown, 7) ?? '')) {
    if (!contractDecisions.hasOriginColumn) {
      pendencies.push(sprintConformancePending(
        'procedencia_ausente',
        '§7.1',
        lineOf(markdown, /^###\s+7\.1/i),
        '§7.1 sem coluna `Origem` — schema anterior a 0.16.0; migrar (reinicio do artefato).',
        'migrar_para_0_16',
      ));
    }
    for (const decision of contractDecisions.rows) {
      if (decision.origin === null || decision.origin === undefined || decision.origin.trim() === '') {
        pendencies.push(sprintConformancePending(
          'procedencia_ausente',
          decision.id,
          lineOf(markdown, new RegExp(`^\\|\\s*${decision.id}\\s*\\|`, 'm')),
          `Decisão ${decision.id} da §7.1 sem \`Origem\`.`,
          'migrar_para_0_16',
        ));
        continue;
      }
      const originCheck = validateOriginToken(decision.origin, { root });
      if (!originCheck.valid) {
        if (originCheck.kind === 'derivado' && originCheck.path) {
          pendencies.push(sprintConformancePending(
            'origem_path_inexistente',
            decision.id,
            lineOf(markdown, new RegExp(`^\\|\\s*${decision.id}\\s*\\|`, 'm')),
            `Decisão ${decision.id} da §7.1 com origem inexistente: ${decision.origin} (${originCheck.reason}).`,
            'corrigir_origem_path',
          ));
        } else {
          pendencies.push(sprintConformancePending(
            'procedencia_invalida',
            decision.id,
            lineOf(markdown, new RegExp(`^\\|\\s*${decision.id}\\s*\\|`, 'm')),
            `Decisão ${decision.id} da §7.1 com origem inválida: ${decision.origin} (${originCheck.reason}).`,
            'corrigir_origem',
          ));
        }
      } else if (originCheck.kind === 'premissa') {
        premissaCount += 1;
        if (prioridadeSprint) {
          pendencies.push(sprintConformancePending(
            'procedencia_premissa_em_prioridade',
            decision.id,
            lineOf(markdown, new RegExp(`^\\|\\s*${decision.id}\\s*\\|`, 'm')),
            `Decisão ${decision.id} da §7.1 apoiada em \`Origem: premissa\` em sprint ${moscowValue === 'Must' ? 'MoSCoW Must' : 'Prioridade P0'} — fechar em entrevista.`,
            'fechar_premissa_em_entrevista',
          ));
        }
      }
    }
  }

  const sealResult = validateAcceptanceSeal(markdown);
  if (sealResult.tampered) {
    pendencies.push(sprintConformancePending(
      'contrato_congelado',
      'FROZEN_ACCEPTANCE_TAMPERED',
      lineOf(markdown, /^##\s+7\./i),
      'Contrato aprovado foi alterado sem re-aprovação (selo divergente).',
      'reaprovar_contrato',
    ));
  }

  for (const [label, nextAction] of [
    ['PLAN', 'informar_plan_ou_pendente'],
    ['State / evidência', 'informar_state_ou_pendente'],
  ]) {
    const value = tableValue(markdown, label);
    if (!value || /^\[/.test(value)) {
      pendencies.push(sprintConformancePending('metadados', label, lineOf(markdown, new RegExp(`^\\|\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`, 'i')), `${label} deve conter path real ou 'pendente'.`, nextAction));
    }
  }

  const evalBlock = fencedYamlBlock(markdown, 'eval_manifest');
  if (!evalBlock) {
    pendencies.push(sprintConformancePending('eval_manifest', 'eval_manifest', lineOf(markdown, /^##\s+9\./i), 'eval_manifest ausente.', 'preencher_eval_manifest'));
  } else {
    const evalSprint = new RegExp(`^\\s*sprint_id\\s*:\\s*["']?(${SPRINT_ID_SOURCE})["']?\\s*$`, 'im').exec(evalBlock)?.[1] ?? null;
    if (!evalSprint) {
      pendencies.push(sprintConformancePending('eval_manifest', 'sprint_id', lineOf(markdown, /^\s*sprint_id\s*:/im), 'eval_manifest sem sprint_id.', 'preencher_eval_manifest_sprint_id'));
    } else if (expectedSprintId && evalSprint !== expectedSprintId) {
      pendencies.push(sprintConformancePending('eval_manifest', 'sprint_id', lineOf(markdown, /^\s*sprint_id\s*:/im), `eval_manifest.sprint_id (${evalSprint}) diverge de ${expectedSprintId}.`, 'alinhar_eval_manifest'));
    }
    for (const token of ['must_prove:', 'regression_guards:', 'negative_paths:']) {
      if (!evalBlock.includes(token)) {
        pendencies.push(sprintConformancePending('eval_manifest', token, null, `eval_manifest sem ${token}`, 'completar_eval_manifest'));
      }
    }
  }

  const policyBlock = fencedYamlBlock(markdown, 'policy_manifest');
  if (!policyBlock) {
    pendencies.push(sprintConformancePending('policy_manifest', 'policy_manifest', lineOf(markdown, /^##\s+10\./i), 'policy_manifest ausente.', 'preencher_policy_manifest'));
  } else {
    for (const token of ['forbidden_scope:', 'required_gates:']) {
      if (!policyBlock.includes(token)) {
        pendencies.push(sprintConformancePending('policy_manifest', token, null, `policy_manifest sem ${token}`, 'completar_policy_manifest'));
      }
    }
    // Plano 6 (D06/D09): `critical_review` é opcional no policy_manifest; quando
    // presente, o shape é estrito — required booleano e reasons ⊆ enum fixo.
    // Proibido inferir reasons por prosa/diff: required:true sem reasons = pendência.
    const critical = parseCriticalReview(policyBlock);
    if (critical !== null) {
      if (typeof critical.required !== 'boolean') {
        pendencies.push(sprintConformancePending('policy_manifest', 'critical_review.required', null,
          'critical_review.required deve ser true ou false.', 'corrigir_policy_manifest'));
      }
      const invalidReasons = critical.reasons.filter((reason) => !CRITICAL_REVIEW_REASONS.includes(reason));
      if (invalidReasons.length > 0) {
        pendencies.push(sprintConformancePending('policy_manifest', 'critical_review.reasons', null,
          `critical_review.reasons contém valor fora do enum fixo: ${invalidReasons.join(', ')}.`,
          'corrigir_policy_manifest'));
      }
      if (critical.required === true && critical.reasons.length === 0) {
        pendencies.push(sprintConformancePending('policy_manifest', 'critical_review.reasons', null,
          'critical_review.required:true exige reasons não vazio (sem inferência por prosa — D09).',
          'corrigir_policy_manifest'));
      }
    }
  }

  const evidenceLine = lineOf(markdown, /^\|\s*Claim\s*\|\s*Onde foi prometido\s*\|\s*Evidência esperada\s*\|\s*Evidência real\s*\|\s*Status\s*\|/i);
  if (!evidenceLine) {
    pendencies.push(sprintConformancePending('evidence_to_claim', 'tabela', lineOf(markdown, /^##\s+12\./i), 'Tabela Evidence-to-claim ausente ou inválida.', 'criar_evidence_to_claim'));
  }

  if (!standalone && backlogPath && backlogMarkdown != null) {
    const rows = parseSprintRows(backlogMarkdown);
    const row = rows.find((entry) => entry.id === expectedSprintId);
    if (!row) {
      pendencies.push(sprintConformancePending('backlog_link', expectedSprintId ?? '<ausente>', null, `Backlog ${backlogPath} não contém linha da sprint ${expectedSprintId ?? '<ausente>'}.`, 'atualizar_backlog_mestre'));
    } else if (sprintPath && row.sprint_file && !sprintFilePending(row.sprint_file)) {
      const rowPath = normalizedPathToken(row.sprint_file);
      const sprintToken = normalizedPathToken(sprintPath);
      if (rowPath && sprintToken && rowPath !== sprintToken && !sprintToken.endsWith(rowPath) && !rowPath.endsWith(sprintToken)) {
        pendencies.push(sprintConformancePending('backlog_link', row.id, null, `Linha ${row.id} aponta Sprint file ${row.sprint_file}, não ${sprintPath}.`, 'sincronizar_backlog_e_sprint_file'));
      }
    } else {
      pendencies.push(sprintConformancePending('backlog_link', row.id, null, `Linha ${row.id} não aponta Sprint file real.`, 'preencher_sprint_file_no_backlog'));
    }
  }

  return {
    valid: pendencies.length === 0,
    pending_count: pendencies.length,
    pendencies,
    premissa_count: premissaCount,
  };
}

export function parseDecisionRows(markdown) {
  const rows = parseTable(markdown, '### Decisões bloqueantes');
  const header = rows.findIndex((row) => row[0] === 'ID');
  if (header < 0) return [];
  // v0.16.0: coluna `Origem` resolvida pela posição do cabeçalho, não por
  // índice fixo; ausência da coluna deixa `origin: null` (pendência na validação).
  const headerCells = rows[header];
  const originIndex = headerCells.findIndex((cell) => /^Origem$/i.test(cell));
  const statusIndex = headerCells.findIndex((cell) => /^Status$/i.test(cell));
  return rows.slice(header + 1).filter((row) => /^D\d+$/.test(row[0])).map((row) => ({
    id: row[0],
    decision: row[1],
    blocks: row[2],
    owner: row[3],
    origin: originIndex >= 0 && originIndex < row.length ? row[originIndex] : null,
    status: statusIndex >= 0 && statusIndex < row.length ? row[statusIndex] : (row[4] ?? ''),
    raw: row,
  }));
}

function dependencyIds(value) {
  if (!value || value === '—') return [];
  return [...value.matchAll(new RegExp(SPRINT_ID_SOURCE, 'g'))].map((match) => match[0]);
}

function findCycle(rows) {
  const graph = new Map(rows.map((row) => [row.id, dependencyIds(row.dependencies)]));
  const visiting = new Set(); const visited = new Set();
  const walk = (id, chain = []) => {
    if (visiting.has(id)) return [...chain.slice(chain.indexOf(id)), id];
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) {
      const cycle = walk(dep, [...chain, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id); visited.add(id); return null;
  };
  for (const id of graph.keys()) { const cycle = walk(id); if (cycle) return cycle; }
  return null;
}

function changeLogBody(markdown) {
  const match = /^##\s+(?:Registro de alterações|Histórico de alterações)\s*$/im.exec(markdown);
  if (!match) return null;
  const tail = markdown.slice(match.index + match[0].length);
  const end = tail.search(/\n##\s+/);
  return (end < 0 ? tail : tail.slice(0, end)).trim();
}

export function validateBacklogUpdate(before, after, { authorizedIds = [] } = {}) {
  const errors = [];
  const authorized = new Set(authorizedIds);
  const oldRows = parseSprintRows(before); const newRows = parseSprintRows(after);
  const oldById = new Map(oldRows.map((row) => [row.id, row]));
  const newById = new Map(newRows.map((row) => [row.id, row]));
  if (oldById.size !== oldRows.length) errors.push('DUPLICATE_SPRINT_ID_BEFORE');
  if (newById.size !== newRows.length) errors.push('DUPLICATE_SPRINT_ID_AFTER');
  for (const [id, oldRow] of oldById) {
    const next = newById.get(id);
    if (!next) errors.push(`SPRINT_REMOVED:${id}`);
    else if (JSON.stringify(oldRow.raw) !== JSON.stringify(next.raw) && !authorized.has(id)) {
      errors.push(oldRow.state === 'done' ? `DONE_SPRINT_CHANGED:${id}` : `UNAUTHORIZED_SPRINT_CHANGED:${id}`);
    }
  }
  const oldDecisions = new Map(parseDecisionRows(before).map((row) => [row.id, row]));
  const newDecisions = new Map(parseDecisionRows(after).map((row) => [row.id, row]));
  for (const [id, row] of oldDecisions) {
    const next = newDecisions.get(id);
    if (!next) errors.push(`DECISION_REMOVED:${id}`);
    else if (/^(decidido|fechado|aprovado)$/i.test(row.status)
      && JSON.stringify(row.raw) !== JSON.stringify(next.raw) && !authorized.has(id)) errors.push(`CLOSED_DECISION_CHANGED:${id}`);
  }
  // v0.16.0 (D3/D17): toda decisão do backlog declara `Origem` dentro do enum.
  for (const [id, row] of newDecisions) {
    const originCheck = validateOriginToken(row.origin);
    if (!originCheck.valid) errors.push(`INVALID_ORIGIN:${id}:${row.origin ?? '<ausente>'}`);
  }
  for (const row of newRows) {
    for (const [field, values] of Object.entries(VALID)) if (!values.has(row[field])) errors.push(`INVALID_ENUM:${row.id}:${field}:${row[field]}`);
    for (const dependency of dependencyIds(row.dependencies)) {
      if (!newById.has(dependency)) errors.push(`DEPENDENCY_NOT_FOUND:${row.id}:${dependency}`);
    }
  }
  const cycle = findCycle(newRows); if (cycle) errors.push(`DEPENDENCY_CYCLE:${cycle.join('>')}`);
  if (/\[(?:NOME_|RESULTADO_|observação|decisão|slug|pendente\])/i.test(after)) errors.push('UNRESOLVED_PLACEHOLDER');
  if (before !== after) {
    const oldLog = changeLogBody(before);
    const newLog = changeLogBody(after);
    if (newLog === null) errors.push('CHANGELOG_REQUIRED');
    else if (oldLog !== null && !newLog.startsWith(oldLog)) errors.push('CHANGELOG_REWRITTEN');
    else if (newLog === oldLog) errors.push('CHANGELOG_ENTRY_REQUIRED');
  }
  return { valid: errors.length === 0, errors };
}

export function resolveSprintAuthority({ sprintId, explicitPath, canonicalPath, candidates }) {
  const normalized = candidates.map((candidate) => ({ ...candidate, path: path.resolve(candidate.path) }));
  const byPath = (target) => normalized.find((candidate) => candidate.path === path.resolve(target));
  if (explicitPath) {
    const match = byPath(explicitPath); if (!match?.sprints.includes(sprintId)) throw new Error(`SPRINT_NOT_FOUND_IN_EXPLICIT_PATH:${sprintId}`); return match;
  }
  if (canonicalPath) {
    const match = byPath(canonicalPath); if (!match?.sprints.includes(sprintId)) throw new Error(`SPRINT_NOT_FOUND_IN_CANONICAL_BACKLOG:${sprintId}`); return match;
  }
  const matches = normalized.filter((candidate) => candidate.sprints.includes(sprintId));
  if (matches.length !== 1) throw new Error(matches.length ? `AMBIGUOUS_BACKLOG_AUTHORITY:${matches.map((m) => m.path).join(',')}` : `SPRINT_NOT_FOUND:${sprintId}`);
  return matches[0];
}

function setTableValue(markdown, label, value) {
  const re = new RegExp(
    `^(\\|\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*)(.*?)(\\s*\\|\\s*)$`,
    'im',
  );
  if (re.test(markdown)) return markdown.replace(re, `$1${value}$3`);
  const contratoStatus = /^\|\s*Contrato status\s*\|.*$/im;
  if (contratoStatus.test(markdown)) {
    return markdown.replace(contratoStatus, (row) => `${row}\n| ${label} | ${value} |`);
  }
  return `${markdown.trimEnd()}\n| ${label} | ${value} |\n`;
}

/** Prefer §7 (contrato) quando presente; senão varre o documento inteiro. */
export function closedDecisionIds(markdown) {
  const scope = extractSectionMarkdown(markdown, 7) ?? markdown;
  return new Set([...scope.matchAll(/^\|\s*(D\d+)\s*\|\s*(?!<|\[)(.+?)\s*\|\s*$/gm)].map((match) => match[1]));
}

export function pendingInterviewQuestions(markdown, questions) {
  const closed = closedDecisionIds(markdown);
  return questions.filter((question) => !closed.has(question.decision_id));
}

/**
 * Aprova o contrato §7: `Contrato status: aprovado` + `Selo do contrato` (sha256 do §7).
 * Status/selo vivem no §1 — fora do bloco hasheado — mesma normalização de `validateAcceptanceSeal`.
 */
export function approveAcceptanceContract(markdown) {
  let updated = setTableValue(markdown, 'Contrato status', 'aprovado');
  const seal = computeAcceptanceSeal(updated);
  if (!seal) throw new Error('ACCEPTANCE_BLOCK_MISSING');
  updated = setTableValue(updated, 'Selo do contrato', seal);
  return updated;
}

/**
 * Upsert da linha `D<n>` na §7.1 (v0.16.0: três colunas `| ID | Decisão | Origem |`).
 * A lista final montada é sempre completa — nunca subconjunto de colunas:
 * - linha existente: preserva a célula `Origem` atual quando a linha já tem a
 *   terceira coluna; se o chamador informar `origin` explícito, ela vence;
 *   linha legada de duas colunas ganha `origin` (entrevista = usuário).
 * - linha nova: insert com as três células, sob o cabeçalho de três colunas.
 *   Cabeçalho de duas colunas é schema pré-0.16.0 (corte seco D17): continua
 *   lançando `DECISION_TABLE_MISSING:<id>`.
 */
function applyDecisionRow(markdown, decisionId, value, origin = null) {
  const section7 = extractSectionMarkdown(markdown, 7);
  const scope = section7 ?? markdown;
  const rowRe = new RegExp(`^\\|\\s*${decisionId}\\s*\\|.*$`, 'm');
  let nextScope;
  if (rowRe.test(scope)) {
    const existing = rowRe.exec(scope)[0];
    const cells = existing.split('|').slice(1, -1).map((cell) => cell.trim());
    const resolvedOrigin = origin ?? (cells.length >= 3 && cells[2] !== '' ? cells[2] : 'usuario');
    const replacement = `| ${decisionId} | ${value} | ${resolvedOrigin} |`;
    nextScope = scope.replace(rowRe, replacement);
  } else if (/(\| ID \| Decisão \| Origem \|\n\|[-| ]+\|)/.test(scope)) {
    const resolvedOrigin = origin ?? 'usuario';
    const replacement = `| ${decisionId} | ${value} | ${resolvedOrigin} |`;
    nextScope = scope.replace(/(\| ID \| Decisão \| Origem \|\n\|[-| ]+\|)/, `$1\n${replacement}`);
  } else {
    throw new Error(`DECISION_TABLE_MISSING:${decisionId}`);
  }
  if (section7 == null) return nextScope;
  return markdown.slice(0, markdown.indexOf(section7)) + nextScope + markdown.slice(markdown.indexOf(section7) + section7.length);
}

/**
 * Persiste respostas D* no markdown do sprint file (§7.1).
 * Se o contrato estava `aprovado`, volta a `draft` e limpa o selo antes de editar.
 * Com `{ approve: true }`, fecha com `approveAcceptanceContract` (selo byte-idêntico ao Plano 2).
 */
export function applyInterviewRound(markdown, answers, date = new Date().toISOString().slice(0, 10), options = {}) {
  const { approve = false } = options;
  const ids = new Set();
  for (const answer of answers) {
    if (!answer || typeof answer.decision_id !== 'string' || !/^D\d+$/.test(answer.decision_id)) throw new Error('INVALID_DECISION_ID');
    if (ids.has(answer.decision_id)) throw new Error(`DUPLICATE_DECISION_ID:${answer.decision_id}`);
    if (typeof answer.value !== 'string' || !answer.value.trim()) throw new Error(`EMPTY_DECISION_VALUE:${answer.decision_id}`);
    ids.add(answer.decision_id);
  }
  let updated = markdown;
  const status = tableValue(updated, 'Contrato status');
  if (status && /^aprovado$/i.test(status.trim())) {
    updated = setTableValue(updated, 'Contrato status', 'draft');
    updated = setTableValue(updated, 'Selo do contrato', 'pendente até aprovação');
  }
  for (const answer of answers) {
    // Toda resposta de entrevista é resposta do usuário: procedência `usuario`.
    updated = applyDecisionRow(updated, answer.decision_id, answer.value, 'usuario');
  }
  const log = `${date} — entrevista: ${answers.map((answer) => answer.decision_id).join(', ')} persistida(s)`;
  updated = /\*\*Histórico:\*\*/.test(updated)
    ? updated.replace(/(\*\*Histórico:\*\*[^\n]*)/, `$1 · ${log}`)
    : `${updated.trimEnd()}\n\n**Histórico:** ${log}\n`;
  if (approve) updated = approveAcceptanceContract(updated);
  return updated;
}

export function persistInterviewRound(sprintPath, answers, date = new Date().toISOString().slice(0, 10), options = {}) {
  const absolute = path.resolve(sprintPath);
  const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const current = fs.readFileSync(absolute, 'utf8');
    const updated = applyInterviewRound(current, answers, date, options);
    const materialized = closedDecisionIds(updated);
    const missingBeforeWrite = answers.filter((answer) => !materialized.has(answer.decision_id));
    if (missingBeforeWrite.length > 0) {
      throw new Error(`DECISION_NOT_MATERIALIZED:${missingBeforeWrite.map((answer) => answer.decision_id).join(',')}`);
    }
    const mode = fs.statSync(absolute).mode;
    fs.writeFileSync(temporary, updated, { encoding: 'utf8', mode });
    fs.renameSync(temporary, absolute);
    const readback = fs.readFileSync(absolute, 'utf8');
    if (readback !== updated) throw new Error('READBACK_DIVERGENT');
    return readback;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw new Error(`INTERVIEW_PERSISTENCE_FAILED:${error.message}`);
  }
}
