#!/usr/bin/env node
// Bump deterministico de versao. Sincroniza os arquivos com versao concreta,
// regenera bundles/catalogos e roda check-consistency. NAO cria tag, NAO commita,
// NAO publica — release é MANUAL via `gh` (ver PATCH_PROCEDURE.md §9). Nao ha
// workflow no GitHub Actions; a distribuicao oficial e via `npx github:`.
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
  ['plugins/talos/VERSION', () => `${next}\n`],
  ['hosts/pi/talos/VERSION', () => `${next}\n`],
  ['hosts/opencode/.opencode/talos/VERSION', () => `${next}\n`],
  ['package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'package.json')],
  ['packages/mcp-server/package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'mcp-server/package.json')],
  ['.claude-plugin/plugin.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, '.claude-plugin/plugin.json')],
  // Prosa de versão atual — replace-all é seguro (sem changelog embutido).
  ['README.md', (t) => replaceAll(t, esc, next, 'README.md')],
  ['README.pt-BR.md', (t) => replaceAll(t, esc, next, 'README.pt-BR.md')],
  ['COMMANDS.md', (t) => replaceAll(t, esc, next, 'COMMANDS.md')],
  ['COMMANDS.pt-BR.md', (t) => replaceAll(t, esc, next, 'COMMANDS.pt-BR.md')],
  ['packages/mcp-server/README.md', (t) => replaceAll(t, esc, next, 'mcp-server/README.md')],
  // Orchestrator README tem "Novidades vX" (histórico) — só a linha Plugin version.
  ['packages/orchestrator/README.md', (t) => replaceOnce(t, `**Plugin version:** ${current}`, `**Plugin version:** ${next}`, 'orchestrator/README.md (Plugin version)')],

  // --- Codex plugin bundle ---
  ['plugins/talos/.codex-plugin/plugin.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'codex-plugin/plugin.json')],
  ['plugins/talos/packages/mcp-server/package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'plugins mcp-server/package.json')],
  ['plugins/talos/packages/mcp-server/README.md', (t) => replaceAll(t, esc, next, 'plugins mcp-server/README.md')],
  ['plugins/talos/orchestrator/README.md', (t) => replaceOnce(t, `**Plugin version:** ${current}`, `**Plugin version:** ${next}`, 'plugins orchestrator/README.md (Plugin version)')],

  // --- Host: Pi ---
  ['hosts/pi/talos/packages/mcp-server/package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'hosts/pi mcp-server/package.json')],
  ['hosts/pi/talos/packages/mcp-server/README.md', (t) => replaceAll(t, esc, next, 'hosts/pi mcp-server/README.md')],
  ['hosts/pi/talos/orchestrator/README.md', (t) => replaceOnce(t, `**Plugin version:** ${current}`, `**Plugin version:** ${next}`, 'hosts/pi orchestrator/README.md (Plugin version)')],

  // --- Host: OpenCode ---
  ['hosts/opencode/.opencode/talos/packages/mcp-server/package.json', (t) => replaceOnce(t, `"version": "${current}"`, `"version": "${next}"`, 'hosts/opencode mcp-server/package.json')],
  ['hosts/opencode/.opencode/talos/packages/mcp-server/README.md', (t) => replaceAll(t, esc, next, 'hosts/opencode mcp-server/README.md')],
  ['hosts/opencode/.opencode/talos/orchestrator/README.md', (t) => replaceOnce(t, `**Plugin version:** ${current}`, `**Plugin version:** ${next}`, 'hosts/opencode orchestrator/README.md (Plugin version)')],

  // --- Docs com versão inline ---
  ['CLAUDE.md', (t) => replaceOnce(t, `Versão: \`${current}\``, `Versão: \`${next}\``, 'CLAUDE.md')],
  ['AGENTS.md', (t) => replaceOnce(t, `Versão: \`${current}\``, `Versão: \`${next}\``, 'AGENTS.md')],
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
  1. CHANGELOG.md — mover a seção "## Unreleased" para "## ${next} - YYYY-MM-DD"
     (ou criar nova entrada se não houver Unreleased). Criar nova seção
     "## Unreleased" vazia no topo se quiser acumular a próxima feature.
     Ver PATCH_PROCEDURE.md §5 para o convention completo.
  2. packages/orchestrator/README.md — adicionar seção "### Novidades v${next}" e
     atualizar "Last updated".
  3. Revisar 'git status', commitar o bump+catálogos e dar push.
     - Se main/develop são protected branches (caso comum), o push direto é
       rejeitado: abra PR com o bump como conteúdo, faça merge com --admin se
       necessário (ver PATCH_PROCEDURE.md §9). Back-merge main→develop ao final.
     - Release manual: tag v${next} + gh release create (ver §9). NUNCA criar
       tag antes do commit final estar em main.`);
