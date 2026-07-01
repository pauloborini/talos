#!/usr/bin/env node
// Talos — instalador unificado por host.
//   npx github:pauloborini/talos init <host> [dir] [flags]
//
// Hosts: claudecode|cursor (via `claude plugin`), codex (via `codex plugin` +
//        custom agents globais),
//        opencode (config + .opencode/), pi (config + .pi/agents/).
// Sem dependências externas (Node puro). Roda direto do checkout do repo (npx-from-GitHub).
//
// claude: orquestra o instalador NATIVO da CLI (marketplace from-source no GitHub).
// codex: orquestra o instalador nativo + copia custom agents para CODEX_HOME/agents.
// opencode/pi: coloca o catálogo from-source committed (hosts/<host>/) no diretório alvo.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_SLUG = 'pauloborini/talos';
const PLUGIN_ID = 'talos@talos';


const VERSION = (() => {
  try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); }
  catch { return 'desconhecida'; }
})();

const HOST_ALIASES = {
  claude: 'claude', claudecode: 'claude', 'claude-code': 'claude', cursor: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
  zcode: 'zcode', zai: 'zcode',
  antigravity: 'antigravity', gemini: 'antigravity', antigravitycode: 'antigravity',
  all: 'all',
};

function log(msg) { process.stdout.write(`${msg}\n`); }
function fail(msg, code = 1) { process.stderr.write(`erro: ${msg}\n`); process.exit(code); }

// No Windows as CLIs instaladas por npm (claude/codex/pi/opencode) são shims .cmd,
// que o spawn só resolve com shell:true. POSIX dispensa (evita parsing extra).
const WIN = process.platform === 'win32';

function which(cmd) {
  const r = spawnSync(WIN ? 'where' : 'which', [cmd], { encoding: 'utf8', shell: WIN });
  return r.status === 0;
}

function run(cmd, args, { dryRun }) {
  log(`  $ ${cmd} ${args.join(' ')}`);
  if (dryRun) return 0;
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: WIN });
  return r.status ?? 1;
}

function rmPath(p, { dryRun }) {
  if (!fs.existsSync(p)) return false;
  log(`  rm ${p}`);
  if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
  return true;
}

// Prefixo legado (pré-rename) incluído só para que upgrade de instalações antigas
// limpe skills/agentes órfãos com o nome velho — novas cópias usam só 'talos-'.
const SKILL_PREFIXES = ['talos-', 'atlas-'];
function hasSkillPrefix(name) { return SKILL_PREFIXES.some((p) => name.startsWith(p)); }

function rmTalosSkillsQuiet(skillsDir, opts) {
  if (!fs.existsSync(skillsDir)) return;
  for (const name of fs.readdirSync(skillsDir)) {
    if (hasSkillPrefix(name)) rmPath(path.join(skillsDir, name), opts);
  }
}

// Remove todos os agentes Talos despachados (validator + executores + review), não só
// o validator — senão upgrade deixa órfãos e install global só copia o validator.
// Cobre o prefixo legado 'atlas-' para limpar agentes órfãos de instalações pré-rename.
function rmTalosAgentsQuiet(agentsDir, opts, exts = ['.md']) {
  if (!fs.existsSync(agentsDir)) return;
  for (const name of fs.readdirSync(agentsDir)) {
    if (hasSkillPrefix(name) && exts.some((ext) => name.endsWith(ext))) rmPath(path.join(agentsDir, name), opts);
  }
}

// Copia todos os agentes talos-*.md de srcDir para destDir (install global flatten).
function copyTalosAgents(srcDir, destDir, exts = ['.md']) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (hasSkillPrefix(name) && exts.some((ext) => name.endsWith(ext))) {
      fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    }
  }
}

function cleanOpencodeControlled(targetDir, opts) {
  rmPath(path.join(targetDir, '.opencode/talos'), opts);
  rmTalosAgentsQuiet(path.join(targetDir, '.opencode/agents'), opts);
  rmTalosSkillsQuiet(path.join(targetDir, '.opencode/skills'), opts);
}

function cleanPiControlled(targetDir, opts) {
  rmPath(path.join(targetDir, 'talos'), opts);
  rmTalosAgentsQuiet(path.join(targetDir, '.pi/agents'), opts);
  rmTalosSkillsQuiet(path.join(targetDir, 'skills'), opts);
}

// Falha-cedo: se o config do usuário existe mas é JSON inválido, aborta ANTES de
// copiar qualquer arquivo (não deixa instalação parcial nem sobrescreve config).
function assertConfigParseable(file) {
  if (!fs.existsSync(file)) return;
  try { JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { fail(`${path.basename(file)} existente é JSON inválido: ${file} (corrija antes de instalar; não sobrescrevo config do usuário)`); }
}

function parseJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isStrictJson(file) {
  if (!fs.existsSync(file)) return true;
  try { parseJsonFile(file); return true; }
  catch { return false; }
}

function copyInto(srcRel, destDir) {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) fail(`catálogo ausente no repo: ${srcRel} (rode build/build-plugins.sh e commite)`);
  const base = path.basename(srcRel);
  const dest = path.join(destDir, base);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

function mergeOpencodeJson(targetDir) {
  const srcCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'hosts/opencode/opencode.json'), 'utf8'));
  const dest = path.join(targetDir, 'opencode.json');
  let cfg = {};
  if (fs.existsSync(dest)) {
    try { cfg = JSON.parse(fs.readFileSync(dest, 'utf8')); }
    catch { fail(`opencode.json existente é JSON inválido: ${dest} (não sobrescrevo config do usuário)`); }
    log(`  opencode.json já existe — mesclando a chave mcp.talos (config do usuário preservada)`);
  }
  cfg.$schema ??= srcCfg.$schema;
  cfg.mcp = { ...(cfg.mcp ?? {}), ...srcCfg.mcp };
  fs.writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n');
  return dest;
}

// pi: mesclar a chave mcpServers.talos no .mcp.json existente em vez de
// sobrescrever o arquivo. Preserva outros servers MCP e demais chaves do usuário.
function mergePiMcpJson(targetDir) {
  const srcCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'hosts/pi/.mcp.json'), 'utf8'));
  const dest = path.join(targetDir, '.mcp.json');
  let cfg = {};
  if (fs.existsSync(dest)) {
    try { cfg = JSON.parse(fs.readFileSync(dest, 'utf8')); }
    catch { fail(`.mcp.json existente é JSON inválido: ${dest} (não sobrescrevo config do usuário)`); }
    log(`  .mcp.json já existe — mesclando mcpServers.talos (config do usuário preservada)`);
  }
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), ...srcCfg.mcpServers };
  fs.writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n');
  return dest;
}

// --- paths globais (verificados no source das deps / empiricamente nas CLIs) -----
// opencode: config global em $XDG_CONFIG_HOME/opencode (default ~/.config/opencode);
//   agentes em <root>/agents/*.md e skills em <root>/skills/* (confirmado por
//   `opencode agent list` com HOME sandbox).
function opencodeGlobalRoot() {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, 'opencode');          // override determinístico (todo SO)
  if (WIN) {
    // Windows: opencode usa %APPDATA%\opencode (não ~/.config). Fallback p/ ~/.config
    // só se APPDATA ausente. Setar XDG_CONFIG_HOME força o caminho POSIX se preferir.
    const appData = process.env.APPDATA?.trim();
    if (appData) return path.join(appData, 'opencode');
  }
  return path.join(homedir(), '.config', 'opencode');
}
// prefere o arquivo existente (.jsonc tem precedência se já existir); senão .json.
function opencodeConfigFile(root) {
  for (const name of ['opencode.jsonc', 'opencode.json']) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(root, 'opencode.json');
}

function opencodeWritableConfigFile(root) {
  const jsonc = path.join(root, 'opencode.jsonc');
  if (fs.existsSync(jsonc) && !isStrictJson(jsonc)) {
    log(`  opencode.jsonc contém JSONC/comentários — preservando arquivo e mesclando Talos em ${path.join(root, 'opencode.json')}`);
    return path.join(root, 'opencode.json');
  }
  return opencodeConfigFile(root);
}
// pi: getAgentDir() honra PI_CODING_AGENT_DIR (igual ao pi-mcp-adapter/agent-dir.ts).
function piAgentDir() {
  const c = process.env.PI_CODING_AGENT_DIR?.trim();
  if (!c) return path.join(homedir(), '.pi', 'agent');
  if (c === '~') return homedir();
  if (c.startsWith('~/')) return path.resolve(homedir(), c.slice(2));
  return path.resolve(c);
}
// pi-subagents (agents.ts): com PI_CODING_AGENT_DIR setado usa <agentDir>/agents;
// senão ~/.agents se existir, senão <agentDir>/agents. Replicamos a mesma escolha
// para escrever onde o pi REALMENTE lê.
function piGlobalAgentsDir() {
  const agentDir = piAgentDir();
  if (process.env.PI_CODING_AGENT_DIR?.trim()) return path.join(agentDir, 'agents');
  const dotAgents = path.join(homedir(), '.agents');
  return fs.existsSync(dotAgents) ? dotAgents : path.join(agentDir, 'agents');
}

// Lê a entry de server 'talos' do catálogo bundled e reescreve o path do
// server.js para ABSOLUTO (instalação global não tem cwd de projeto). Mantém shape
// e env em sincronia com o bundle (mudou lá, muda aqui).
function absServerEntry(host, talosRootAbs) {
  const absServer = path.join(talosRootAbs, 'packages/mcp-server/server.js');
  if (host === 'opencode') {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'hosts/opencode/opencode.json'), 'utf8'));
    return { schema: c.$schema, entry: { ...c.mcp['talos'], command: ['node', absServer] } };
  }
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'hosts/pi/.mcp.json'), 'utf8'));
  return { entry: { ...c.mcpServers['talos'], args: [absServer] } };
}

// Merge genérico de uma entry de server num config JSON. Falha-cedo se o arquivo
// existente for JSON inválido (não sobrescreve). Preserva outros servers e chaves.
function mergeServerInto(file, containerKey, serverName, entry, { dryRun, schema } = {}) {
  assertConfigParseable(file);
  let cfg = {};
  if (fs.existsSync(file)) {
    cfg = parseJsonFile(file);
    log(`  ${path.basename(file)} já existe — mesclando ${containerKey}.${serverName} (config do usuário preservada)`);
  }
  if (schema) cfg.$schema ??= schema;
  const container = { ...(cfg[containerKey] ?? {}) };
  container[serverName] = entry;
  cfg[containerKey] = container;
  if (dryRun) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

function installClaude(opts) {
  if (!which('claude')) fail('CLI `claude` não encontrada no PATH. Instale o Claude Code primeiro.');
  log(`instalando Talos (claude/cursor) via marketplace from-source @ ${REPO_SLUG}`);
  if (run('claude', ['plugin', 'marketplace', 'add', REPO_SLUG], opts)) fail('falha no `claude plugin marketplace add`');
  // Atualiza snapshot do marketplace (add é idempotente mas não faz pull de commits novos).
  run('claude', ['plugin', 'marketplace', 'update'], opts);
  if (run('claude', ['plugin', 'install', PLUGIN_ID], opts)) fail('falha no `claude plugin install`');
  log('ok — Claude Code/Cursor instalados (skills + subagente + MCP + hooks).');
}

function installCodex(opts) {
  if (!which('codex')) fail('CLI `codex` não encontrada no PATH. Instale o Codex primeiro.');
  log(`instalando Talos (codex) via marketplace from-source @ ${REPO_SLUG}`);
  if (run('codex', ['plugin', 'marketplace', 'add', REPO_SLUG], opts)) fail('falha no `codex plugin marketplace add`');
  // Atualiza snapshot do marketplace (add é idempotente mas não faz pull de commits novos).
  run('codex', ['plugin', 'marketplace', 'upgrade'], opts);
  if (run('codex', ['plugin', 'add', PLUGIN_ID], opts)) fail('falha no `codex plugin add`');
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
  const agentsDir = path.join(codexHome, 'agents');
  const srcAgents = path.join(ROOT, 'plugins/talos/.codex/agents');
  if (!fs.existsSync(srcAgents)) fail('agentes Codex ausentes no catálogo: plugins/talos/.codex/agents (rode build/build-plugins.sh)');
  if (opts.dryRun) {
    log(`  [dry-run] copiaria custom agents Codex → ${agentsDir}`);
  } else {
    rmTalosAgentsQuiet(agentsDir, opts, ['.toml']);
    copyTalosAgents(srcAgents, agentsDir, ['.toml']);
  }
  log(`ok — Codex instalado (skills + MCP + custom agents em ${agentsDir}).`);
}

function installOpencode(targetDir, opts) {
  log(`instalando Talos (opencode v${VERSION}) em ${targetDir}`);
  assertConfigParseable(path.join(targetDir, 'opencode.json'));
  if (opts.dryRun) { log('  [dry-run] copiaria .opencode/ + mesclaria opencode.json'); return; }
  fs.mkdirSync(targetDir, { recursive: true });
  cleanOpencodeControlled(targetDir, opts);
  copyInto('hosts/opencode/.opencode', targetDir);   // subagente + skills + runtime
  mergeOpencodeJson(targetDir);                       // MCP local (type:local, TALOS_HOST=opencode)
  log('ok — opencode instalado (MCP + subagente + skills).');
  log(`próximo: cd ${targetDir} && opencode  → confirme com as tools talos_ping`);
  log('  (deve retornar host=opencode) e talos_capabilities.');
}

function piDepsStatus() {
  if (!which('pi')) return { piPresent: false, missing: ['pi-mcp-adapter', 'pi-subagents'] };
  const r = spawnSync('pi', ['list'], { encoding: 'utf8', shell: WIN });
  if (r.status !== 0) return { piPresent: true, missing: ['pi-mcp-adapter', 'pi-subagents'], listFailed: true };
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const missing = ['pi-mcp-adapter', 'pi-subagents'].filter((d) => !out.includes(d));
  return { piPresent: true, missing };
}

function printPiDepsHelp() {
  log('instale com:');
  log('  pi install npm:pi-mcp-adapter');
  log('  pi install npm:pi-subagents');
}

function ensurePiDeps(opts) {
  let status = piDepsStatus();
  if (!status.piPresent) {
    printPiDepsHelp();
    fail('CLI `pi` não encontrada no PATH. Instale o pi antes de instalar o Talos para pi.');
  }
  if (status.listFailed) {
    fail('`pi list` falhou; não consigo validar deps obrigatórias do pi.');
  }
  if (!status.missing.length) {
    log('deps obrigatórias presentes: pi-mcp-adapter + pi-subagents ✓');
    return;
  }

  log(`deps obrigatórias ausentes: ${status.missing.join(', ')} (DEC-010)`);
  if (!opts.yes) {
    printPiDepsHelp();
    fail('deps obrigatórias ausentes; re-rode com --yes para instalar automaticamente.');
  }
  if (opts.dryRun) {
    for (const dep of status.missing) log(`  [dry-run] pi install npm:${dep}`);
    return;
  }
  for (const dep of status.missing) {
    const code = run('pi', ['install', `npm:${dep}`], opts);
    if (code !== 0) fail(`falha ao instalar dep obrigatória do pi: ${dep}`);
  }
  status = piDepsStatus();
  if (status.listFailed) fail('`pi list` falhou após instalar deps obrigatórias.');
  if (status.missing.length) {
    fail(`deps obrigatórias ainda ausentes após instalação: ${status.missing.join(', ')}`);
  }
  log('deps obrigatórias instaladas e revalidadas: pi-mcp-adapter + pi-subagents ✓');
}

function installPi(targetDir, opts) {
  log(`instalando Talos (pi v${VERSION}) em ${targetDir}`);
  assertConfigParseable(path.join(targetDir, '.mcp.json'));
  ensurePiDeps(opts);
  if (opts.dryRun) { log('  [dry-run] copiaria talos/ skills/ .pi/agents/ + .mcp.json'); }
  else {
    fs.mkdirSync(targetDir, { recursive: true });
    cleanPiControlled(targetDir, opts);
    copyInto('hosts/pi/talos', targetDir);
    copyInto('hosts/pi/skills', targetDir);
    copyInto('hosts/pi/.pi', targetDir);                 // .pi/agents/<name>.md (descoberta pi-subagents)
    mergePiMcpJson(targetDir);                            // mescla mcpServers.talos (pi-mcp-adapter)
    log('ok — arquivos do pi instalados (.mcp.json + .pi/agents/ + talos/ + skills/).');
  }
  log(`próximo: cd ${targetDir} && pi  → confirme a instalação com as tools talos_ping`);
  log('  (deve retornar host=pi) e talos_capabilities. NÃO dispare o validator à mão:');
  log('  o talos-task-validator roda automaticamente dentro do workflow, com um state');
  log('  file real (.talos/state/<run_id>/<slice>.json) — não com placeholder.');
}

// --- install global ----------------------------------------------------------

function installOpencodeGlobal(opts) {
  const root = opencodeGlobalRoot();
  const talosRoot = path.join(root, 'talos');
  const cfgFile = opencodeWritableConfigFile(root);
  log(`instalando Talos (opencode v${VERSION}) GLOBAL em ${root}`);
  assertConfigParseable(cfgFile);
  const { schema, entry } = absServerEntry('opencode', talosRoot);
  if (opts.dryRun) {
    log(`  [dry-run] copiaria runtime → ${talosRoot}, agente → ${path.join(root, 'agents')}, skills → ${path.join(root, 'skills')}`);
    log(`  [dry-run] mesclaria mcp.talos em ${cfgFile} (command absoluto)`);
    return;
  }
  fs.mkdirSync(root, { recursive: true });
  rmPath(talosRoot, opts);
  rmTalosAgentsQuiet(path.join(root, 'agents'), opts);
  rmTalosSkillsQuiet(path.join(root, 'skills'), opts);
  fs.cpSync(path.join(ROOT, 'hosts/opencode/.opencode/talos'), talosRoot, { recursive: true });
  copyTalosAgents(path.join(ROOT, 'hosts/opencode/.opencode/agents'), path.join(root, 'agents'));
  const skillsSrc = path.join(ROOT, 'hosts/opencode/.opencode/skills');
  for (const name of fs.readdirSync(skillsSrc)) {
    if (name.startsWith('talos-')) fs.cpSync(path.join(skillsSrc, name), path.join(root, 'skills', name), { recursive: true });
  }
  mergeServerInto(cfgFile, 'mcp', 'talos', entry, { schema });
  log('ok — opencode GLOBAL instalado (vale em todos os projetos).');
  log('próximo: abra `opencode` em qualquer pasta  → talos_ping (host=opencode) + talos_capabilities.');
}

function installPiGlobal(opts) {
  const agentDir = piAgentDir();
  const talosRoot = path.join(agentDir, 'talos');
  const agentsDir = piGlobalAgentsDir();
  const mcpFile = path.join(agentDir, 'mcp.json');
  log(`instalando Talos (pi v${VERSION}) GLOBAL em ${agentDir}`);
  assertConfigParseable(mcpFile);
  ensurePiDeps(opts);
  const skillsDir = path.join(agentDir, 'skills'); // irmão de talos/ — mantém o mesmo
  // offset relativo (../../../skills a partir do server) do install de projeto.
  const { entry } = absServerEntry('pi', talosRoot);
  if (opts.dryRun) {
    log(`  [dry-run] copiaria runtime → ${talosRoot}, skills → ${skillsDir}, agente → ${path.join(agentsDir, 'talos-task-validator.md')}`);
    log(`  [dry-run] mesclaria mcpServers.talos em ${mcpFile} (args absoluto)`);
  } else {
    fs.mkdirSync(agentDir, { recursive: true });
    rmPath(talosRoot, opts);
    rmTalosAgentsQuiet(agentsDir, opts);
    rmTalosSkillsQuiet(skillsDir, opts);
    fs.cpSync(path.join(ROOT, 'hosts/pi/talos'), talosRoot, { recursive: true });
    // skills/ canônicas (paridade com install de projeto e com opencode global): copia
    // só os subdirs talos-* para não tocar skills do usuário.
    const skillsSrc = path.join(ROOT, 'hosts/pi/skills');
    for (const name of fs.readdirSync(skillsSrc)) {
      if (name.startsWith('talos-')) fs.cpSync(path.join(skillsSrc, name), path.join(skillsDir, name), { recursive: true });
    }
    copyTalosAgents(path.join(ROOT, 'hosts/pi/.pi/agents'), agentsDir);
    mergeServerInto(mcpFile, 'mcpServers', 'talos', entry);
    log(`ok — pi GLOBAL instalado (runtime + skills + agente em ${agentsDir} + mcp.json).`);
  }
  log('próximo: abra `pi` em qualquer pasta  → talos_ping (host=pi) + talos_capabilities.');
}

function installAntigravity(opts) {
  const geminiConfig = path.join(homedir(), '.gemini', 'config');
  const pluginDir = path.join(geminiConfig, 'plugins', 'talos');
  const mcpFile = path.join(geminiConfig, 'mcp_config.json');
  const absServer = path.join(pluginDir, 'packages', 'mcp-server', 'server.js');

  log(`instalando Talos (antigravity v${VERSION}) GLOBAL em ${pluginDir}`);
  assertConfigParseable(mcpFile);

  const entry = {
    command: process.execPath,
    args: [absServer],
    env: {
      TALOS_HOST: 'antigravity'
    }
  };

  if (opts.dryRun) {
    log(`  [dry-run] criaria pasta do plugin → ${pluginDir}`);
    log(`  [dry-run] copiaria skills e mcp-server para a pasta do plugin`);
    log(`  [dry-run] criaria plugin.json na raiz do plugin`);
    log(`  [dry-run] mesclaria mcpServers.talos em ${mcpFile} (args absoluto)`);
  } else {
    fs.mkdirSync(pluginDir, { recursive: true });

    // Fonte: bundle shipado `plugins/talos/`. A cópia raiz
    // `/packages/` NÃO entra no tarball npm (ver .npmignore) — usá-la quebra o
    // install via npx-from-GitHub (ENOENT). O bundle já traz skills/ completo
    // (inclui a skill talos) + packages/mcp-server.
    const SRC = path.join(ROOT, 'plugins/talos');

    // Limpeza de instalações anteriores controladas por nós
    const skillsDir = path.join(pluginDir, 'skills');
    const packagesDir = path.join(pluginDir, 'packages');
    rmPath(skillsDir, opts);
    rmPath(packagesDir, opts);

    // Copia as skills (inclui a orquestradora talos)
    fs.cpSync(path.join(SRC, 'skills'), skillsDir, { recursive: true });

    // Copia a pasta packages inteira (que contém mcp-server, skills e templates)
    fs.cpSync(path.join(SRC, 'packages'), packagesDir, { recursive: true });

    // Remove testes do mcp-server no bundle (defensivo; bundle shipado já não os traz)
    fs.rmSync(path.join(packagesDir, 'mcp-server', 'server.test.js'), { force: true });

    // Cria o plugin.json
    const pluginJson = { name: 'talos' };
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2) + '\n');

    // Mescla o MCP
    mergeServerInto(mcpFile, 'mcpServers', 'talos', entry);
    log('ok — Antigravity GLOBAL instalado (skills + MCP server).');
  }
}

// --- uninstall ---------------------------------------------------------------

function rmIfExists(p, { dryRun }) {
  if (!fs.existsSync(p)) return false;
  log(`  rm ${path.relative(process.cwd(), p) || p}`);
  if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
  return true;
}

// Remove apenas subdirs com prefixo talos-/talos- (não toca skills do usuário).
// Cobre o prefixo legado 'atlas-' para uninstall limpo de instalações pré-rename.
function rmTalosSkills(skillsDir, opts) {
  if (!fs.existsSync(skillsDir)) return;
  for (const name of fs.readdirSync(skillsDir)) {
    if (hasSkillPrefix(name)) rmIfExists(path.join(skillsDir, name), opts);
  }
}

// Remove uma chave de server MCP de um config JSON; reescreve. Remove o arquivo só
// se ficou totalmente vazio (era exclusivo do Talos). Preserva outros servers.
function dropMcpKey(file, containerKey, serverName, opts) {
  if (!fs.existsSync(file)) return;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { log(`  aviso: ${path.basename(file)} é JSON inválido — não mexi`); return; }
  const container = cfg[containerKey];
  if (!container || !(serverName in container)) return;
  log(`  ${path.basename(file)}: removendo ${containerKey}.${serverName}`);
  if (opts.dryRun) return;
  delete container[serverName];
  const onlyOurs = Object.keys(container).length === 0
    && Object.keys(cfg).every((k) => k === containerKey || k === '$schema');
  if (onlyOurs) { fs.rmSync(file, { force: true }); log(`  ${path.basename(file)} ficou vazio — removido`); }
  else fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

function uninstallClaude(opts) {
  if (!which('claude')) fail('CLI `claude` não encontrada no PATH.');
  log('removendo Talos (claude/cursor)');
  run('claude', ['plugin', 'uninstall', PLUGIN_ID], opts);
  run('claude', ['plugin', 'marketplace', 'remove', 'talos'], opts);
  log('ok — removido do Claude Code/Cursor.');
}

function uninstallCodex(opts) {
  if (!which('codex')) fail('CLI `codex` não encontrada no PATH.');
  log('removendo Talos (codex)');
  run('codex', ['plugin', 'remove', PLUGIN_ID], opts);
  run('codex', ['plugin', 'marketplace', 'remove', 'talos'], opts);
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
  rmTalosAgentsQuiet(path.join(codexHome, 'agents'), opts, ['.toml']);
  log('ok — removido do Codex.');
}

function uninstallOpencode(targetDir, opts) {
  log(`removendo Talos (opencode) de ${targetDir}`);
  rmIfExists(path.join(targetDir, '.opencode/talos'), opts);
  rmTalosAgentsQuiet(path.join(targetDir, '.opencode/agents'), opts);
  rmTalosSkills(path.join(targetDir, '.opencode/skills'), opts);
  dropMcpKey(path.join(targetDir, 'opencode.json'), 'mcp', 'talos', opts);
  log('ok — artefatos do Talos removidos (config/skills do usuário preservados).');
}

function uninstallPi(targetDir, opts) {
  log(`removendo Talos (pi) de ${targetDir}`);
  rmIfExists(path.join(targetDir, 'talos'), opts);
  rmTalosAgentsQuiet(path.join(targetDir, '.pi/agents'), opts);
  rmTalosSkills(path.join(targetDir, 'skills'), opts);
  dropMcpKey(path.join(targetDir, '.mcp.json'), 'mcpServers', 'talos', opts);
  log('ok — artefatos do Talos removidos. As deps pi-mcp-adapter/pi-subagents ficam (uso geral);');
  log('  remova manualmente se quiser: pi remove pi-mcp-adapter && pi remove pi-subagents');
}

function uninstallOpencodeGlobal(opts) {
  const root = opencodeGlobalRoot();
  log(`removendo Talos (opencode) GLOBAL de ${root}`);
  rmIfExists(path.join(root, 'talos'), opts);
  rmTalosAgentsQuiet(path.join(root, 'agents'), opts);
  rmTalosSkills(path.join(root, 'skills'), opts);
  dropMcpKey(opencodeWritableConfigFile(root), 'mcp', 'talos', opts);
  log('ok — artefatos globais do Talos removidos (config/skills do usuário preservados).');
}

function uninstallPiGlobal(opts) {
  const agentDir = piAgentDir();
  log(`removendo Talos (pi) GLOBAL de ${agentDir}`);
  rmIfExists(path.join(agentDir, 'talos'), opts);
  rmTalosAgentsQuiet(piGlobalAgentsDir(), opts);
  rmTalosSkills(path.join(agentDir, 'skills'), opts);
  dropMcpKey(path.join(agentDir, 'mcp.json'), 'mcpServers', 'talos', opts);
  log('ok — artefatos globais do Talos removidos. As deps pi-mcp-adapter/pi-subagents ficam (uso geral).');
}

function uninstallAntigravity(opts) {
  const geminiConfig = path.join(homedir(), '.gemini', 'config');
  const pluginDir = path.join(geminiConfig, 'plugins', 'talos');
  const mcpFile = path.join(geminiConfig, 'mcp_config.json');

  log(`removendo Talos (antigravity) GLOBAL de ${pluginDir}`);
  rmIfExists(pluginDir, opts);
  dropMcpKey(mcpFile, 'mcpServers', 'talos', opts);
  log('ok — artefatos globais do Talos para Antigravity removidos.');
}

// --- ZCode (cache-based install) ----------------------------------------------
// ZCode só descobre plugins no escopo `zcode-plugins-official` (verificado
// empiricamente no bundle zcode.cjs: `G2="zcode-plugins-official"` é hardcoded e o
// scan de cache é restrito a `cache/zcode-plugins-official/<plugin>/<version>/`).
// Por isso o installer copia para esse path — não para um marketplace custom.
// O ZCode também regenera `marketplaces/zcode-plugins-official/marketplace.json` no
// boot a partir do scan; mantemos essa entry sincronizada para visualização imediata.

const ZCODE_MARKETPLACE = 'zcode-plugins-official';
const ZCODE_PLUGIN_NAME = 'talos';

function zcodeCacheDir() {
  return path.join(homedir(), '.zcode', 'cli', 'plugins', 'cache', ZCODE_MARKETPLACE, ZCODE_PLUGIN_NAME, VERSION);
}

function zcodeMarketplaceCacheFile() {
  return path.join(homedir(), '.zcode', 'cli', 'plugins', 'marketplaces', ZCODE_MARKETPLACE, 'marketplace.json');
}

function updateZcodeMarketplaceCacheEntry(cacheDir) {
  const file = zcodeMarketplaceCacheFile();
  let cfg = { name: ZCODE_MARKETPLACE, plugins: [], version: 1 };
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { log(`  aviso: ${path.basename(file)} é JSON inválido — reescrevendo do zero`); }
  }
  cfg.name = ZCODE_MARKETPLACE;
  cfg.plugins = (cfg.plugins ?? []).filter((p) => p.name !== ZCODE_PLUGIN_NAME);
  cfg.plugins.push({ cachePath: cacheDir, name: ZCODE_PLUGIN_NAME, source: 'filesystem', version: VERSION });
  cfg.version = 1;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

function removeZcodeMarketplaceCacheEntry() {
  const file = zcodeMarketplaceCacheFile();
  if (!fs.existsSync(file)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.plugins = (cfg.plugins ?? []).filter((p) => p.name !== ZCODE_PLUGIN_NAME);
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  } catch { log(`  aviso: ${path.basename(file)} é JSON inválido — não mexi`); }
}

function installZcode(opts) {
  const cacheDir = zcodeCacheDir();
  const catalogSrc = path.join(ROOT, 'hosts/zcode');
  log(`instalando Talos (zcode v${VERSION}) GLOBAL em ${cacheDir}`);
  if (!fs.existsSync(catalogSrc)) fail(`catálogo zcode ausente: hosts/zcode/ (rode build/build-plugins.sh)`);
  if (opts.dryRun) {
    log(`  [dry-run] copiaria hosts/zcode/ → ${cacheDir}`);
    log(`  [dry-run] atualizaria ${zcodeMarketplaceCacheFile()}`);
    return;
  }
  // Limpa instalação anterior (pode haver versão stale)
  const parentDir = path.dirname(cacheDir);
  if (fs.existsSync(parentDir)) fs.rmSync(parentDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.cpSync(catalogSrc, cacheDir, { recursive: true });
  // Gera o seed file no formato que o ZCode espera
  const seed = {
    hash: '',
    marketplace: ZCODE_MARKETPLACE,
    plugin: ZCODE_PLUGIN_NAME,
    pluginVersion: VERSION,
    source: 'filesystem',
    version: 1,
  };
  fs.writeFileSync(path.join(cacheDir, '.zcode-plugin-seed.json'), JSON.stringify(seed, null, 2) + '\n');
  // Sincroniza a entry do marketplace cache (o ZCode regenera no boot, mas
  // mantemos sincronizado para visualização imediata no `/plugins`).
  updateZcodeMarketplaceCacheEntry(cacheDir);
  log('ok — ZCode instalado no cache oficial.');
  log('próximo: abra o ZCode e ative via /plugins enable talos');
  log('  confirme com a tool MCP talos_ping (host=zcode, status=alive).');
}

function uninstallZcode(opts) {
  const cacheParent = path.join(homedir(), '.zcode', 'cli', 'plugins', 'cache', ZCODE_MARKETPLACE, ZCODE_PLUGIN_NAME);
  log(`removendo Talos (zcode) GLOBAL de ${cacheParent}`);
  rmIfExists(cacheParent, opts);
  removeZcodeMarketplaceCacheEntry();
  log('ok — ZCode: cache e registry removidos.');
}

// --- host virtual `all` -------------------------------------------------------
// Detecta automaticamente quais hosts estão presentes no sistema e retorna
// uma lista de descritores para `runAll()`. Cada entrada tem:
//   { host, label, detect: fn→bool, install: fn(opts), uninstall: fn(opts) }
// `detect` é chamado em runtime; resultado false → skip com aviso.
function allHostDescriptors(opts) {
  return [
    {
      host: 'claude',
      label: 'Claude Code / Cursor',
      detect: () => which('claude'),
      install: (o) => installClaude(o),
      uninstall: (o) => uninstallClaude(o),
    },
    {
      host: 'codex',
      label: 'Codex',
      detect: () => which('codex'),
      install: (o) => installCodex(o),
      uninstall: (o) => uninstallCodex(o),
    },
    {
      host: 'antigravity',
      label: 'Antigravity (Gemini)',
      // Antigravity não precisa de CLI — sempre detectado.
      detect: () => true,
      install: (o) => installAntigravity(o),
      uninstall: (o) => uninstallAntigravity(o),
    },
    {
      host: 'zcode',
      label: 'ZCode',
      // ZCode não tem CLI no PATH — detecta pela pasta do cache.
      detect: () => fs.existsSync(path.join(homedir(), '.zcode', 'cli')),
      install: (o) => installZcode(o),
      uninstall: (o) => uninstallZcode(o),
    },
    {
      host: 'opencode',
      label: 'opencode (global)',
      detect: () => which('opencode') || fs.existsSync(opencodeGlobalRoot()),
      install: (o) => installOpencodeGlobal(o),
      uninstall: (o) => uninstallOpencodeGlobal(o),
    },
    {
      host: 'pi',
      label: 'pi CLI (global)',
      detect: () => which('pi'),
      // `--yes` é sempre propagado no `all` para não bloquear a instalação em lote.
      install: (o) => installPiGlobal({ ...o, yes: true }),
      uninstall: (o) => uninstallPiGlobal(o),
    },
  ];
}

function runAll(cmd, opts) {
  const descriptors = allHostDescriptors(opts);
  const results = [];

  log(`\n== ${cmd} all — detectando hosts ==`);
  for (const d of descriptors) {
    if (!d.detect()) {
      log(`  [skip] ${d.label}: não detectado`);
      results.push({ label: d.label, status: 'skip' });
      continue;
    }
    log(`\n-- ${d.label} --`);
    try {
      if (cmd === 'init') d.install(opts);
      else d.uninstall(opts);
      results.push({ label: d.label, status: 'ok' });
    } catch (err) {
      const msg = err?.message ?? String(err);
      process.stderr.write(`  [erro] ${d.label}: ${msg}\n`);
      results.push({ label: d.label, status: 'erro', msg });
    }
  }

  // Resumo final
  log(`\n== ${cmd} all — resumo ==`);
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'skip' ? '-' : '✗';
    const detail = r.status === 'erro' ? `: ${r.msg}` : r.status === 'skip' ? ' (não detectado)' : '';
    log(`  ${icon} ${r.label}${detail}`);
  }

  const failed = results.filter((r) => r.status === 'erro');
  if (failed.length) {
    process.stderr.write(`\n${failed.length} host(s) falharam. Veja mensagens acima.\n`);
    process.exit(1);
  }
}

function usage() {
  log(`talos v${VERSION} — instalador multi-host

uso:
  npx github:${REPO_SLUG} init <host> [dir] [flags]
  npx github:${REPO_SLUG} uninstall <host> [dir] [flags]

hosts:
  all                   detecta e opera em TODOS os hosts presentes no sistema
  claudecode | cursor   via \`claude plugin\` (marketplace from-source; já global)
  codex                 via \`codex plugin\` + custom agents em CODEX_HOME/agents
  antigravity           via plugin nativo em ~/.gemini/config/ (já global)
  zcode                 via cache ~/.zcode/cli/plugins/cache/ (já global; /plugins enable)
  opencode              por-projeto: .opencode/ + opencode.json no [dir]
                        --global: ~/.config/opencode/ (vale em todos os projetos)
  pi                    por-projeto: .mcp.json + .pi/agents/ no [dir] + deps
                        --global: ~/.pi/agent/ (vale em todos os projetos)

flags:
  --dir <d>    diretório alvo (opencode/pi por-projeto); default: diretório atual
  --global,-g  instalação global (opencode/pi); claude/codex/antigravity já são globais
  --yes,-y     auto-instala deps faltantes (pi, no init); sempre ativo com host=all
  --dry-run    mostra o que faria, sem alterar nada
  -h,--help    esta ajuda

exemplos:
  npx github:${REPO_SLUG} init all                    # instala em todos os hosts detectados
  npx github:${REPO_SLUG} init all --dry-run          # simulação sem alterar nada
  npx github:${REPO_SLUG} uninstall all               # remove de todos os hosts detectados
  npx github:${REPO_SLUG} init claudecode
  npx github:${REPO_SLUG} init antigravity
  npx github:${REPO_SLUG} init opencode               # projeto atual
  npx github:${REPO_SLUG} init opencode --global      # todos os projetos
  npx github:${REPO_SLUG} init pi --global --yes
  npx github:${REPO_SLUG} uninstall opencode --global
  npx github:${REPO_SLUG} uninstall pi --global --dry-run`);
}

function parseArgs(argv) {
  if (argv.length === 0) return { help: true };
  const opts = { dryRun: false, yes: false, global: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--yes' || a === '-y') { opts.yes = true; continue; }
    if (a === '--global' || a === '-g') { opts.global = true; continue; }
    if (a === '--dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) fail('--dir exige um diretório', 2);
      opts.dir = value;
      i += 1;
      continue;
    }
    if (a.startsWith('-')) fail(`flag desconhecida: ${a}`, 2);
    positional.push(a);
  }
  return { positional, opts };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) { usage(); process.exit(0); }

  const [cmd, rawHost, rawDir, ...extra] = parsed.positional;
  if (cmd !== 'init' && cmd !== 'uninstall') {
    fail(`comando desconhecido: ${cmd} (use \`init <host>\` ou \`uninstall <host>\`)`, 2);
  }

  if (!rawHost) fail('informe o host: all | claudecode | cursor | codex | antigravity | zcode | opencode | pi', 2);
  if (extra.length) fail(`argumentos extras não suportados: ${extra.join(' ')}`, 2);
  const host = HOST_ALIASES[rawHost.toLowerCase()];
  if (!host) fail(`host inválido: ${rawHost} (use all|claudecode|cursor|codex|antigravity|zcode|opencode|pi)`, 2);

  const opts = parsed.opts;

  // Host virtual `all`: detecta e opera em todos os hosts presentes no sistema.
  if (host === 'all') {
    if (rawDir) fail('host `all` não suporta [dir] posicional (opencode/pi usam --global)', 2);
    runAll(cmd, opts);
    return;
  }

  const targetDir = path.resolve(opts.dir || rawDir || process.cwd());
  const actions = {
    init: { claude: installClaude, codex: installCodex, antigravity: installAntigravity, zcode: installZcode, opencode: installOpencode, pi: installPi },
    uninstall: { claude: uninstallClaude, codex: uninstallCodex, antigravity: uninstallAntigravity, zcode: uninstallZcode, opencode: uninstallOpencode, pi: uninstallPi },
  };
  const globalActions = {
    init: { opencode: installOpencodeGlobal, pi: installPiGlobal },
    uninstall: { opencode: uninstallOpencodeGlobal, pi: uninstallPiGlobal },
  };

  if (host === 'claude' || host === 'codex' || host === 'antigravity' || host === 'zcode') {
    if (opts.global && (host === 'claude' || host === 'codex')) log('nota: claude/codex já são globais por natureza (registro da CLI) — --global ignorado.');
    actions[cmd][host](opts);
  } else if (opts.global) {
    globalActions[cmd][host](opts);
  } else {
    actions[cmd][host](targetDir, opts);
  }
}

main();
