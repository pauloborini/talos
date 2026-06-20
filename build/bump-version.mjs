#!/usr/bin/env node
// Bump determinístico de versão. Sincroniza os arquivos com versão concreta,
// regenera bundles/catálogos e roda check-consistency. NÃO cria tag nem commita
// — quem publica é o workflow Release ao detectar VERSION novo na main.
//
// Uso: node build/bump-version.mjs <nova-versao>   (ex.: 0.8.3)
//
// Não toca CHANGELOG.md nem PATCH_PROCEDURE.md (prosa/exemplos históricos), nem
// a seção "Novidades vX" do orchestrator README (changelog embutido). Esses são
// passos narrativos manuais, listados no final.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const next = (process.argv[2] || '').trim();

function die(msg) { console.error(`bump-version: ${msg}`); process.exit(1); }

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  die(`versão inválida "${process.argv[2] || ''}" — use SemVer X.Y.Z (ex.: 0.8.3)`);
}

const versionPath = path.join(ROOT, 'VERSION');
const current = fs.readFileSync(versionPath, 'utf8').trim();
if (current === next) die(`VERSION já é ${next} — nada a bumpar`);

const esc = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// [arquivo, transform]. transform recebe o conteúdo e devolve o novo.
const edits = [
  ['VERSION', () => `${next}\n`],
  ['package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'package.json')],
  ['packages/mcp-server/package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'mcp-server/package.json')],
  ['.claude-plugin/plugin.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, '.claude-plugin/plugin.json')],
  // Prosa de versão atual — replace-all é seguro (sem changelog embutido).
  ['README.md', (t) => replaceAll(t, esc, next, 'README.md')],
  ['COMMANDS.md', (t) => replaceAll(t, esc, next, 'COMMANDS.md')],
  ['packages/mcp-server/README.md', (t) => replaceAll(t, esc, next, 'mcp-server/README.md')],
  // Orchestrator README tem "Novidades vX" (histórico) — só a linha Plugin version.
  ['packages/orchestrator/README.md', (t) => replaceOnce(t, `**Plugin version:** ${current}`, `**Plugin version:** ${next}`, 'orchestrator/README.md (Plugin version)')],
];

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) die(`âncora não encontrada em ${label}: "${from}"`);
  return text.replace(from, to);
}
function replaceAll(text, escFrom, to, label) {
  const re = new RegExp(escFrom, 'g');
  if (!re.test(text)) die(`versão ${current} não encontrada em ${label}`);
  return text.replace(new RegExp(escFrom, 'g'), to);
}

for (const [rel, fn] of edits) {
  const p = path.join(ROOT, rel);
  const before = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, fn(before));
  console.log(`  bump  ${rel}  ${current} -> ${next}`);
}

console.log(`\nRegenerando bundles/catálogos (build-plugins.sh)…`);
execFileSync('bash', [path.join(ROOT, 'build', 'build-plugins.sh')], { cwd: ROOT, stdio: 'inherit' });

console.log(`Rodando check-consistency…`);
execFileSync('node', [path.join(ROOT, 'build', 'check-consistency.mjs')], { cwd: ROOT, stdio: 'inherit' });

console.log(`\nbump-version: ${current} -> ${next} OK.

Passos narrativos manuais (não automatizáveis):
  1. CHANGELOG.md — adicionar entrada "## ${next} - YYYY-MM-DD".
  2. packages/orchestrator/README.md — adicionar seção "### Novidades v${next}" e "Last updated".
  3. Revisar 'git status', commitar e dar push na main.
     => VERSION novo na main dispara Release (tag + npm + GitHub release) sozinho.`);
