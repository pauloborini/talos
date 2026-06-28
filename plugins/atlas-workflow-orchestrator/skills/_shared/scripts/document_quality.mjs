#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VALID = Object.freeze({
  moscow: new Set(['Must', 'Should', 'Could', "Won't now"]),
  gain: new Set(['alto', 'médio', 'baixo']),
  effort: new Set(['alto', 'médio', 'baixo']),
  priority: new Set(['P0', 'P1', 'P2', 'P3']),
  state: new Set(['backlog', 'ready', 'doing', 'review', 'done', 'blocked']),
});

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
  return rows.slice(header + 1).filter((row) => /^S\d{2}[a-z]?$/.test(row[0])).map((row) => ({
    id: row[0], name: row[1], phase: row[2], objective: row[3], moscow: row[4], gain: row[5].toLowerCase(),
    effort: row[6].toLowerCase(), priority: row[7], prd: row[8], dependencies: row[9], state: row[10], gate: row[11], raw: row,
  }));
}

export function parseDecisionRows(markdown) {
  const rows = parseTable(markdown, '### Decisões bloqueantes');
  const header = rows.findIndex((row) => row[0] === 'ID');
  return rows.slice(header + 1).filter((row) => /^D\d+$/.test(row[0])).map((row) => ({
    id: row[0], decision: row[1], blocks: row[2], owner: row[3], status: row[4], raw: row,
  }));
}

function dependencyIds(value) {
  if (!value || value === '—') return [];
  return [...value.matchAll(/S\d{2}[a-z]?/g)].map((match) => match[0]);
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

export function closedDecisionIds(prd) {
  return new Set([...prd.matchAll(/^\|\s*(D\d+)\s*\|\s*(?!<|\[)(.+?)\s*\|\s*$/gm)].map((match) => match[1]));
}

export function pendingInterviewQuestions(prd, questions) {
  const closed = closedDecisionIds(prd);
  return questions.filter((question) => !closed.has(question.decision_id));
}

export function applyInterviewRound(prd, answers, date = new Date().toISOString().slice(0, 10)) {
  const ids = new Set();
  for (const answer of answers) {
    if (!answer || typeof answer.decision_id !== 'string' || !/^D\d+$/.test(answer.decision_id)) throw new Error('INVALID_DECISION_ID');
    if (ids.has(answer.decision_id)) throw new Error(`DUPLICATE_DECISION_ID:${answer.decision_id}`);
    if (typeof answer.value !== 'string' || !answer.value.trim()) throw new Error(`EMPTY_DECISION_VALUE:${answer.decision_id}`);
    ids.add(answer.decision_id);
  }
  let updated = prd;
  for (const answer of answers) {
    const row = new RegExp(`^\\|\\s*${answer.decision_id}\\s*\\|.*$`, 'm');
    const replacement = `| ${answer.decision_id} | ${answer.value} |`;
    updated = row.test(updated) ? updated.replace(row, replacement) : updated.replace(/(\| ID \| Decisão \|\n\|[-| ]+\|)/, `$1\n${replacement}`);
  }
  const log = `${date} — entrevista: ${answers.map((answer) => answer.decision_id).join(', ')} persistida(s)`;
  updated = /\*\*Histórico:\*\*/.test(updated)
    ? updated.replace(/(\*\*Histórico:\*\*[^\n]*)/, `$1 · ${log}`)
    : `${updated.trimEnd()}\n\n**Histórico:** ${log}\n`;
  return updated;
}

export function persistInterviewRound(prdPath, answers, date = new Date().toISOString().slice(0, 10)) {
  const absolute = path.resolve(prdPath);
  const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const current = fs.readFileSync(absolute, 'utf8');
    const updated = applyInterviewRound(current, answers, date);
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
