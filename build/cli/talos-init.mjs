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
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fs.realpathSync(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.dirname(SELF), '../..');
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
  vscode: 'vscode', 'visual-studio-code': 'vscode', 'vs-code': 'vscode',
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

// Cache de marketplace from-source (Claude/Codex) precisa ser apagável pelo usuário.
// Se uma instalação anterior rodou com sudo, o dir fica owned por root e o
// `plugin marketplace add` falha com EACCES ao finalizar o cache — mensagem
// opaca da CLI. Fail-cedo com remédio explícito.
function assertMarketplaceCacheWritable(cacheDir, hostLabel) {
  if (!fs.existsSync(cacheDir)) return;
  const parent = path.dirname(cacheDir);
  try {
    fs.accessSync(cacheDir, fs.constants.W_OK);
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    let ownerHint = '';
    try {
      const st = fs.statSync(cacheDir);
      const uid = typeof process.getuid === 'function' ? process.getuid() : null;
      if (uid != null && typeof st.uid === 'number' && st.uid !== uid) {
        ownerHint = ` (owner uid=${st.uid}, seu uid=${uid})`;
      }
    } catch { /* ignore */ }
    fail(
      `cache marketplace ${hostLabel} não é gravável${ownerHint}: ${cacheDir}\n` +
      `provável causa: instalação anterior com sudo.\n` +
      `corrija (NÃO rode o Talos com sudo):\n` +
      `  sudo rm -rf '${cacheDir}'\n` +
      `depois rode de novo o init sem sudo.`
    );
  }
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

// JSONC (JSON with Comments) — VS Code settings.json e outros arquivos de config
// que suportam comentários // e trailing commas. Tolerante: se o JSON já é estrito,
// parse normal funciona; senão, strip de comentários antes do parse.
function parseJsoncFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  // Tenta parse estrito primeiro (mais seguro)
  try { return JSON.parse(raw); } catch { }
  // Strip de comentários de linha (//) — preserva strings com // dentro
  let stripped = raw.replace(/(["'])(?:(?=(\\?))\2.)*?\1|\/\/.*$/gm, (m, q) => q ? m : '');
  // Strip de trailing commas antes de } ou ] (comuns em JSONC/VS Code settings)
  stripped = stripped.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
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
// jsonc: true → tolera comentários // (VS Code settings.json).
function mergeServerInto(file, containerKey, serverName, entry, { dryRun, schema, jsonc } = {}) {
  if (!jsonc) { assertConfigParseable(file); }
  else if (fs.existsSync(file)) {
    try { parseJsoncFile(file); } catch { fail(`${path.basename(file)} existente é JSON/JSONC inválido: ${file} (corrija antes de instalar; não sobrescrevo config do usuário)`); }
  }
  let cfg = {};
  if (fs.existsSync(file)) {
    cfg = jsonc ? parseJsoncFile(file) : parseJsonFile(file);
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
  const cacheDir = path.join(homedir(), '.claude', 'plugins', 'marketplaces', 'talos');
  if (!opts.dryRun) assertMarketplaceCacheWritable(cacheDir, 'Claude/Cursor');
  log(`instalando Talos (claude/cursor) via marketplace from-source @ ${REPO_SLUG}`);
  if (run('claude', ['plugin', 'marketplace', 'add', REPO_SLUG], opts)) {
    fail(
      'falha no `claude plugin marketplace add`\n' +
      `se a CLI pediu para apagar ${cacheDir} e falhou com EACCES/permission denied,\n` +
      `rode: sudo rm -rf '${cacheDir}'  e tente de novo sem sudo.`
    );
  }
  // Atualiza snapshot do marketplace (add é idempotente mas não faz pull de commits novos).
  run('claude', ['plugin', 'marketplace', 'update'], opts);
  if (run('claude', ['plugin', 'install', PLUGIN_ID], opts)) fail('falha no `claude plugin install`');
  log('ok — Claude Code/Cursor instalados (skills + subagente + MCP + hooks).');
}

function installCodex(opts) {
  if (!which('codex')) fail('CLI `codex` não encontrada no PATH. Instale o Codex primeiro.');
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');
  const cacheDir = path.join(codexHome, 'plugins', 'marketplaces', 'talos');
  if (!opts.dryRun) assertMarketplaceCacheWritable(cacheDir, 'Codex');
  log(`instalando Talos (codex) via marketplace from-source @ ${REPO_SLUG}`);
  if (run('codex', ['plugin', 'marketplace', 'add', REPO_SLUG], opts)) {
    fail(
      'falha no `codex plugin marketplace add`\n' +
      `se falhou com EACCES/permission denied no cache, rode: sudo rm -rf '${cacheDir}'  e tente de novo sem sudo.`
    );
  }
  // Atualiza snapshot do marketplace (add é idempotente mas não faz pull de commits novos).
  run('codex', ['plugin', 'marketplace', 'upgrade'], opts);
  if (run('codex', ['plugin', 'add', PLUGIN_ID], opts)) fail('falha no `codex plugin add`');
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
  log('  o talos-task-validator roda automaticamente dentro do pipeline, com um state');
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
  const jsonc = opts.jsonc === true;
  try { cfg = jsonc ? parseJsoncFile(file) : JSON.parse(fs.readFileSync(file, 'utf8')); }
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

// --- ZCode (marketplace install) ----------------------------------------------
// O host ZCode NÃO tem CLI headless para marketplace (`zcode plugins les|enable|
// disable|uninstall <id>` só, sem por-URL). O fluxo "Add Marketplace + Install"
// que funciona é o de marketplace: o usuário adiciona o repo GitHub e instala —
// isso produz o id `talos@talos`, skills e MCP ok. Para automatizar (npx init
// zcode), reproduzimos em arquivos exatamente o estado que a UI grava:
//   - known_marketplaces.json    → marketplace `talos` (source git → repo)
//   - marketplaces/talos/        → clone do catálogo (manifest marketplace.json raiz)
//   - cache/talos/talos/<VERSÃO> → plugin instalado (manifest .claude-plugin/plugin.json)
//   - installed_plugins.json     → registro `talos@talos`
//   - data/talos@talos/          → data-dir (vazio, como a UI cria)
//   - config.json                → enabledPlugins["talos@talos"]=true
// Além disso, o uninstall limpa o legado do caminho quebrado `zcode-plugins-official`
// (data-dir, cache, config entry, marketplace cache entry) para não deixar rastro.

const ZCODE_MARKETPLACE = 'talos';                       // id do marketplace no ZCode
const ZCODE_PLUGIN_NAME = 'talos';
const ZCODE_PLUGIN_ID = `${ZCODE_PLUGIN_NAME}@${ZCODE_MARKETPLACE}`;  // talos@talos
const ZCODE_PLUGIN_ID_LEGACY = 'talos@zcode-plugins-official';
// Nomes pré-rebrand (v0.12.0). Mantidos para remover entry órfã em enabledPlugins.
const ZCODE_LEGACY_PLUGIN_NAMES = ['atlas-workflow-orchestrator', 'atlas-workflow'];

// URL git do repo — a instalação SEMPRE vem do GitHub (npx); o checkout local só
// serve para dev/validação. O host usa esta URL quando o usuário abre o marketplace.
const ZCODE_MARKETPLACE_URL = `https://github.com/${REPO_SLUG}.git`;

function zcodePluginPath(...rest) {
  return path.join(homedir(), '.zcode', 'cli', 'plugins', ...rest);
}

// cache/talos/talos/<VERSION>/ — onde o plugin instalado fica.
function zcodeCacheDir() {
  return zcodePluginPath('cache', ZCODE_MARKETPLACE, ZCODE_PLUGIN_NAME, VERSION);
}

// marketplaces/talos/ — clone do catálogo do marketplace.
function zcodeMarketplaceDir() {
  return zcodePluginPath('marketplaces', ZCODE_MARKETPLACE);
}

// data/talos@talos/ — data-dir do plugin (rede no runtime; a UI cria vazio).
function zcodeDataDir() {
  return zcodePluginPath('data', ZCODE_PLUGIN_ID);
}

function zcodeConfigFile() {
  return zcodePluginPath('..', 'config.json');
}

function zcodeKnownMarketplacesFile() {
  return zcodePluginPath('known_marketplaces.json');
}

function zcodeInstalledPluginsFile() {
  return zcodePluginPath('installed_plugins.json');
}

// Cria o data-dir vazio (como a UI faz). Idempotente; defesa contra symlink malicioso.
function materializeZcodeDataDir(opts) {
  const dataDir = zcodeDataDir();
  if (opts.dryRun) {
    log(`  [dry-run] criaria ${dataDir}/ (vazio)`);
    return dataDir;
  }
  if (fs.existsSync(dataDir)) {
    const lst = fs.lstatSync(dataDir);
    if (lst.isSymbolicLink()) {
      const target = path.resolve(path.dirname(dataDir), fs.readlinkSync(dataDir));
      const allowed = path.resolve(zcodePluginPath('data')) + path.sep;
      if (!target.startsWith(allowed)) {
        fail(`${dataDir} é symlink para fora de ~/.zcode/cli/plugins/data/ (${target}) — remova manualmente e rode de novo.`);
      }
    }
    if (fs.readdirSync(dataDir).length === 0) { log(`  ${dataDir} já existe (vazio) — mantendo`); return dataDir; }
    log(`  ${dataDir} já existe com conteúdo — mantendo (não sobrescrevo presets)`);
    return dataDir;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  log(`  ${dataDir} criado`);
  return dataDir;
}

// Remove o data-dir com a mesma defesa contra symlink malicioso. Idempotente.
function removeZcodeDataDir(allowedParent, dir, opts) {
  if (!fs.existsSync(dir)) return;
  const lst = fs.lstatSync(dir);
  if (lst.isSymbolicLink()) {
    const target = path.resolve(path.dirname(dir), fs.readlinkSync(dir));
    const allowed = path.resolve(allowedParent) + path.sep;
    if (!target.startsWith(allowed)) {
      fail(`${dir} é symlink para fora de ${allowedParent} (${target}) — remova manualmente e rode de novo.`);
    }
  }
  rmIfExists(dir, opts);
}


// marketplace.json no destino do clone — o ZCode lê o da raiz do marketplace. O repo
// não commita marketplace.json na raiz (só .claude-plugin/marketplace.json); a UI gera
// a cópia raiz no add. Facamos o mesmo: garante dest/marketplace.json a partir de ROOT.
// É chamado SEMPRE (dry-run guarda fora): só copia ROOT→dest; nunca escreve no ROOT.
function ensureZcodeRootMarketplaceJson(dest) {
  const rootManifest = path.join(dest, 'marketplace.json');
  if (fs.existsSync(rootManifest)) return rootManifest;
  const src = path.join(ROOT, '.claude-plugin', 'marketplace.json');
  if (!fs.existsSync(src)) return null;
  fs.copyFileSync(src, rootManifest);
  log(`  ${path.relative(ROOT, rootManifest)} gerado a partir de .claude-plugin/marketplace.json`);
  return rootManifest;
}

// Abre conhecido `known_marketplaces.json` (ou schema default). Falha-cedo em JSON inválido.
function loadZcodeKnownMarketplaces() {
  const file = zcodeKnownMarketplacesFile();
  if (!fs.existsSync(file)) return { version: 1, marketplaces: [] };
  assertConfigParseable(file);
  return parseJsonFile(file);
}

// Merge idempotente do marketplace `talos` em known_marketplaces.json. Preserva demais.
function upsertZcodeMarketplace(opts) {
  const file = zcodeKnownMarketplacesFile();
  if (opts.dryRun) { log(`  [dry-run] adicionaria marketplace ${ZCODE_PLUGIN_ID} em ${path.basename(file)}`); return; }
  const cfg = loadZcodeKnownMarketplaces();
  const now = new Date().toISOString();
  let entry = (cfg.marketplaces ?? []).find((m) => m.id === ZCODE_MARKETPLACE);
  const base = {
    id: ZCODE_MARKETPLACE,
    source: { source: 'git', url: ZCODE_MARKETPLACE_URL },
    name: ZCODE_MARKETPLACE,
    description: 'Marketplace do Talos: plugin único de orquestração de pipeline determinístico (sprint §7 → plano → execução → validação) para Claude Code, Cursor, Codex, Antigravity, ZCode, opencode e pi cli.',
  };
  if (entry) {
    Object.assign(entry, base, { lastUpdated: now });
    if (!entry.addedAt) entry.addedAt = now;
    if (!entry.pluginCount) entry.pluginCount = 1;
    log(`  marketplace ${ZCODE_MARKETPLACE} já registrado — atualizado`);
  } else {
    cfg.marketplaces ??= [];
    cfg.marketplaces.push({ ...base, addedAt: now, lastUpdated: now, pluginCount: 1 });
    log(`  marketplace ${ZCODE_MARKETPLACE} registrado em ${path.basename(file)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

// Abre o registro `installed_plugins.json` (ou schema default). Falha-cedo em JSON inválido.
function loadZcodeInstalledPlugins() {
  const file = zcodeInstalledPluginsFile();
  if (!fs.existsSync(file)) return { version: 1, plugins: [] };
  assertConfigParseable(file);
  return parseJsonFile(file);
}

// Grava/atualiza o registro `talos@talos` em installed_plugins.json. Preserva demais.
function upsertZcodeInstalledPlugin(cacheDir, opts) {
  const file = zcodeInstalledPluginsFile();
  if (opts.dryRun) { log(`  [dry-run] registraria ${ZCODE_PLUGIN_ID} em ${path.basename(file)}`); return; }
  const cfg = loadZcodeInstalledPlugins();
  const now = new Date().toISOString();
  const id = ZCODE_PLUGIN_ID;
  let rec = (cfg.plugins ?? []).find((p) => p.id === id);
  if (rec) {
    Object.assign(rec, {
      name: ZCODE_PLUGIN_NAME, marketplace: ZCODE_MARKETPLACE, version: VERSION,
      installPath: cacheDir, updatedAt: now, scope: rec.scope ?? 'user', source: rec.source ?? './',
    });
    log(`  registro ${id} já existe — atualizado`);
  } else {
    cfg.plugins ??= [];
    cfg.plugins.push({
      id, name: ZCODE_PLUGIN_NAME, marketplace: ZCODE_MARKETPLACE, version: VERSION,
      installPath: cacheDir, installedAt: now, updatedAt: now, scope: 'user', source: './',
      cacheTransactionId: randomUUID(),
    });
    log(`  ${id} registrado em ${path.basename(file)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

// Copia o catálogo (conteúdo de ROOT, sem .git) para marketplaces/<marketplace>/.
// Este é o "clone" que a UI faz no add-marketplace.
function copyZcodeMarketplaceDir(opts) {
  const dest = zcodeMarketplaceDir();
  const parent = path.dirname(dest);
  if (opts.dryRun) { log(`  [dry-run] copiaria ${ROOT} → ${dest}`); return; }
  if (fs.existsSync(dest)) {
    const lst = fs.lstatSync(dest);
    if (lst.isSymbolicLink()) {
      const allowed = path.resolve(zcodePluginPath('marketplaces')) + path.sep;
      const target = path.resolve(path.dirname(dest), fs.readlinkSync(dest));
      if (!target.startsWith(allowed)) fail(`${dest} é symlink para fora de ~/.zcode/cli/plugins/marketplaces/ — remova manualmente`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(ROOT, dest, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git${path.sep}`) && !s.endsWith(`${path.sep}.git`) });
  log(`  ${dest} materializado (catálogo do marketplace)`);
}

// Copia o plugin instalado para cache/<marketplace>/<plugin>/<VERSION>/. É o que a UI
// faz no "Install": copia o repo para o cache e lê o manifest .claude-plugin/plugin.json.
function copyZcodePluginToCache(opts) {
  const cacheDir = zcodeCacheDir();
  const parent = path.dirname(cacheDir);
  if (opts.dryRun) { log(`  [dry-run] copiaria ${ROOT} → ${cacheDir}`); return; }
  if (fs.existsSync(parent)) {
    const lst = fs.lstatSync(parent);
    if (lst.isSymbolicLink()) {
      const allowed = path.resolve(zcodePluginPath('cache')) + path.sep;
      const target = path.resolve(path.dirname(parent), fs.readlinkSync(parent));
      if (!target.startsWith(allowed)) fail(`${parent} é symlink para fora de ~/.zcode/cli/plugins/cache/ — remova manualmente`);
    }
    fs.rmSync(parent, { recursive: true, force: true });
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.cpSync(ROOT, cacheDir, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git${path.sep}`) && !s.endsWith(`${path.sep}.git`) });
  log(`  ${cacheDir} materializado (plugin instalado)`);
}

// Habilita talos@talos e remove órfãos em enabledPlugins. Preserva demais. Fail-closed.
function enableZcodePlugin(opts) {
  const file = zcodeConfigFile();
  assertConfigParseable(file);
  const cfg = fs.existsSync(file) ? parseJsonFile(file) : {};
  cfg.plugins ??= {};
  cfg.plugins.enabledPlugins ??= {};
  const enabled = cfg.plugins.enabledPlugins;
  const changes = [];
  const legacyKeys = ZCODE_LEGACY_PLUGIN_NAMES.flatMap((n) => [`${n}@zcode-plugins-official`, `${n}@user`]);
  for (const key of legacyKeys) {
    if (enabled[key] !== undefined) { changes.push(`- entry órfã pré-rebrand ${key}`); delete enabled[key]; }
  }
  // Limpeza do legado do caminho antigo (talos@zcode-plugins-official) que não tem mais root.
  if (enabled[ZCODE_PLUGIN_ID_LEGACY] !== undefined) {
    changes.push(`- entry órfã do caminho antigo ${ZCODE_PLUGIN_ID_LEGACY}`);
    delete enabled[ZCODE_PLUGIN_ID_LEGACY];
  }
  if (enabled[ZCODE_PLUGIN_ID] !== true) {
    changes.push(`+ habilitado ${ZCODE_PLUGIN_ID}`);
    enabled[ZCODE_PLUGIN_ID] = true;
  }
  if (!changes.length) return changes;
  if (opts.dryRun) {
    log(`  [dry-run] migraria ${path.basename(file)}:`);
    changes.forEach((c) => log(`    ${c}`));
    return changes;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  log(`  ${path.basename(file)} migrado:`);
  changes.forEach((c) => log(`    ${c}`));
  return changes;
}

// O invérso do install para os quatro registros + cache + data. Preserva demais plugins.
function removeZcodeMarketplaceRecords(opts) {
  // known_marketplaces.json — remove o marketplace talos
  const knownFile = zcodeKnownMarketplacesFile();
  if (fs.existsSync(knownFile)) {
    assertConfigParseable(knownFile);
    const cfg = parseJsonFile(knownFile);
    const before = cfg.marketplaces?.length ?? 0;
    cfg.marketplaces = (cfg.marketplaces ?? []).filter((m) => m.id !== ZCODE_MARKETPLACE);
    if (cfg.marketplaces.length !== before) {
      // evita gravar um arquivo totalmente esvaziado caso fosse só do talos
      if (cfg.marketplaces.length === 0) {
        log(`  marketplace ${ZCODE_MARKETPLACE} removido — arquivo ficaria vazio; ${opts.dryRun ? 'removeria' : 'removido'}`);
      } else {
        log(`  marketplace ${ZCODE_MARKETPLACE} removido de ${path.basename(knownFile)}`);
      }
      if (!opts.dryRun) fs.writeFileSync(knownFile, JSON.stringify(cfg, null, 2) + '\n');
    }
  }

  // installed_plugins.json — remove o registro talos@talos
  const instFile = zcodeInstalledPluginsFile();
  if (fs.existsSync(instFile)) {
    assertConfigParseable(instFile);
    const cfg = parseJsonFile(instFile);
    const before = cfg.plugins?.length ?? 0;
    cfg.plugins = (cfg.plugins ?? []).filter((p) => p.id !== ZCODE_PLUGIN_ID);
    if (cfg.plugins.length !== before) {
      log(`  registro ${ZCODE_PLUGIN_ID} removido de ${path.basename(instFile)}`);
      if (!opts.dryRun) fs.writeFileSync(instFile, JSON.stringify(cfg, null, 2) + '\n');
    }
  }
}

// Remove a entry talos@talos (e o legado talos@zcode-plugins-official) de enabledPlugins.
function removeZcodeEnabledPluginEntries(opts) {
  const file = zcodeConfigFile();
  if (!fs.existsSync(file)) return;
  assertConfigParseable(file);
  const cfg = parseJsonFile(file);
  const enabled = cfg?.plugins?.enabledPlugins;
  if (!enabled) return;
  let changed = false;
  for (const key of [ZCODE_PLUGIN_ID, ZCODE_PLUGIN_ID_LEGACY]) {
    if (enabled[key] !== undefined) {
      changed = true;
      log(`  ${key} ${opts.dryRun ? 'seria removido' : 'removido'} de ${path.basename(file)}`);
      if (!opts.dryRun) delete enabled[key];
    }
  }
  if (changed && !opts.dryRun) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

// Limpa o legado do caminho quebrado `zcode-plugins-official` (de instalações 0.15-0.17.1):
// data-dir, cache, config entry e entry no marketplace cache oficial.
function removeZcodeLegacyOfficial(opts) {
  const data = zcodePluginPath('data', 'talos@zcode-plugins-official');
  const cache = zcodePluginPath('cache', 'zcode-plugins-official', 'talos');
  removeZcodeDataDir(zcodePluginPath('data'), data, opts);
  rmIfExists(cache, opts);
  // entry no marketplaces/zcode-plugins-official/marketplace.json (cache de visualização)
  const mktCache = zcodePluginPath('marketplaces', 'zcode-plugins-official', 'marketplace.json');
  if (fs.existsSync(mktCache)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(mktCache, 'utf8'));
      const before = cfg.plugins?.length ?? 0;
      cfg.plugins = (cfg.plugins ?? []).filter((p) => p.name !== ZCODE_PLUGIN_NAME);
      if (cfg.plugins.length !== before) {
        log(`  entry ${ZCODE_PLUGIN_NAME} removida de ${path.relative(zcodePluginPath('marketplaces'), mktCache)}`);
        if (!opts.dryRun) fs.writeFileSync(mktCache, JSON.stringify(cfg, null, 2) + '\n');
      }
    } catch { log(`  aviso: ${path.basename(mktCache)} é JSON inválido — não mexi`); }
  }
}

function installZcode(opts) {
  log(`instalando Talos (zcode v${VERSION}) GLOBAL via marketplace ${ZCODE_MARKETPLACE}`);
  // A instalação SEMPRE vem do GitHub (npx). Em dev, ROOT é o checkout local; sob
  // npx, ROOT é o conteúdo publicado. Garantimos marketplace.json na raiz (fonte do manifest).
  if (opts.dryRun) {
    log(`  [dry-run] copiaria ${ROOT} → ${zcodeMarketplaceDir()} e ${zcodeCacheDir()}`);
    log(`  [dry-run] registraria marketplace + plugin, habilitaria ${ZCODE_PLUGIN_ID}`);
    enableZcodePlugin(opts);
    return;
  }
  copyZcodeMarketplaceDir(opts);
  ensureZcodeRootMarketplaceJson(zcodeMarketplaceDir());
  copyZcodePluginToCache(opts);
  materializeZcodeDataDir(opts);
  upsertZcodeMarketplace(opts);
  upsertZcodeInstalledPlugin(zcodeCacheDir(), opts);
  enableZcodePlugin(opts);
  log('ok — ZCode instalado via marketplace (talos@talos) e habilitado.');
  log('reinicie o ZCode para carregar skills + MCP; confirme com a tool');
  log('  talos_ping (deve retornar host=zcode, status=alive).');
}

function uninstallZcode(opts) {
  log(`removendo Talos (zcode) GLOBAL (marketplace ${ZCODE_MARKETPLACE})`);
  // Reverte o install: registros, cache, data-dir, enabledPlugins.
  rmIfExists(zcodeCacheDir(), opts);
  rmIfExists(zcodeMarketplaceDir(), opts);
  removeZcodeDataDir(zcodePluginPath('data'), zcodeDataDir(), opts);
  removeZcodeMarketplaceRecords(opts);
  removeZcodeEnabledPluginEntries(opts);
  // Limpa o legado do caminho quebrado `zcode-plugins-official`.
  removeZcodeLegacyOfficial(opts);
  log('ok — ZCode: marketplace, cache, data-dir, registros e enabledPlugins removidos.');
}

// --- VS Code (Copilot Chat) ---------------------------------------------------
// Workspace: .vscode/talos/ (runtime) + .vscode/mcp.json (MCP local, TALOS_HOST=vscode).
// Global: ~/.vscode-talos/ (runtime) + user settings MCP + agents/skills no prompt folder.

function vscodeUserDir() {
  if (WIN) {
    const appData = process.env.APPDATA?.trim();
    if (appData) return path.join(appData, 'Code', 'User');
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, 'Code', 'User');
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Code', 'User');
  return path.join(homedir(), '.config', 'Code', 'User');
}

function vscodePromptsDir() { return path.join(vscodeUserDir(), 'prompts'); }
function vscodeSettingsFile() { return path.join(vscodeUserDir(), 'settings.json'); }

function vscodeGlobalRoot() { return path.join(homedir(), '.vscode-talos'); }

function cleanVscodeControlled(targetDir, opts) {
  rmPath(path.join(targetDir, '.vscode/talos'), opts);
  rmTalosAgentsQuiet(path.join(targetDir, '.vscode/agents'), opts);
  rmTalosSkillsQuiet(path.join(targetDir, '.vscode/skills'), opts);
}

// Mescla a entry MCP do Talos no .vscode/mcp.json do projeto. Preserva outros
// servers e chaves do usuário. Falha-cedo em JSON inválido.
function mergeVscodeMcpJson(targetDir, opts) {
  const srcCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin-manifests/vscode/mcp.json'), 'utf8'));
  const dest = path.join(targetDir, '.vscode', 'mcp.json');
  assertConfigParseable(dest);
  let cfg = {};
  if (fs.existsSync(dest)) {
    cfg = parseJsonFile(dest);
    log(`  .vscode/mcp.json já existe — mesclando mcpServers.talos (config do usuário preservada)`);
  }
  cfg.mcpServers = { ...(cfg.mcpServers ?? {}), ...srcCfg.mcpServers };
  if (opts.dryRun) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n');
  return dest;
}

function installVscode(targetDir, opts) {
  log(`instalando Talos (vscode v${VERSION}) em ${targetDir}`);
  assertConfigParseable(path.join(targetDir, '.vscode', 'mcp.json'));
  if (opts.dryRun) { log('  [dry-run] copiaria .vscode/talos/ + .vscode/mcp.json'); return; }
  fs.mkdirSync(targetDir, { recursive: true });
  cleanVscodeControlled(targetDir, opts);
  copyInto('hosts/vscode/.vscode', targetDir);
  mergeVscodeMcpJson(targetDir, opts);
  log('ok — VS Code instalado no projeto (MCP + runtime em .vscode/).');
  log('próximo: recarregue a janela do VS Code (Cmd+Shift+P → Reload Window)');
  log('  e confirme com talos_ping (deve retornar host=vscode).');
}

// VS Code global: runtime em ~/.vscode-talos/, MCP no user settings.json,
// agents + skills no prompt folder (~/Library/Application Support/Code/User/prompts/).
function installVscodeGlobal(opts) {
  const talosRoot = vscodeGlobalRoot();
  const promptsDir = vscodePromptsDir();
  const settingsFile = vscodeSettingsFile();
  const absServer = path.join(talosRoot, 'packages', 'mcp-server', 'server.js');

  log(`instalando Talos (vscode v${VERSION}) GLOBAL`);
  log(`  runtime: ${talosRoot}`);
  log(`  prompts: ${promptsDir}`);
  // VS Code settings.json usa JSONC (comentários //) — validação tolerante.
  if (fs.existsSync(settingsFile)) {
    try { parseJsoncFile(settingsFile); } catch { fail(`settings.json existente é JSON/JSONC inválido: ${settingsFile} (corrija antes de instalar; não sobrescrevo config do usuário)`); }
  }

  const entry = {
    command: process.execPath,
    args: [absServer],
    env: { TALOS_HOST: 'vscode' },
  };

  if (opts.dryRun) {
    log(`  [dry-run] copiaria runtime → ${talosRoot}`);
    log(`  [dry-run] copiaria agents + skills → ${promptsDir}`);
    log(`  [dry-run] mesclaria mcpServers.talos em ${settingsFile}`);
    return;
  }

  // Runtime
  rmPath(talosRoot, opts);
  fs.cpSync(path.join(ROOT, 'hosts/vscode/.vscode/talos'), talosRoot, { recursive: true });

  // Agents + skills no prompt folder
  fs.mkdirSync(promptsDir, { recursive: true });
  rmTalosAgentsQuiet(promptsDir, opts);
  copyTalosAgents(path.join(ROOT, 'hosts/vscode/agents'), promptsDir);
  const skillsSrc = path.join(ROOT, 'hosts/vscode/skills');
  if (fs.existsSync(skillsSrc)) {
    for (const name of fs.readdirSync(skillsSrc)) {
      if (hasSkillPrefix(name)) {
        const dest = path.join(promptsDir, name);
        rmPath(dest, opts);
        fs.cpSync(path.join(skillsSrc, name), dest, { recursive: true });
      }
    }
  }

  // MCP no user settings (github.copilot.chat.mcpServers)
  mergeServerInto(settingsFile, 'github.copilot.chat.mcpServers', 'talos', entry, { ...opts, jsonc: true });

  log('ok — VS Code GLOBAL instalado (runtime + agents + skills + MCP no user settings).');
  log('próximo: recarregue a janela do VS Code (Cmd+Shift+P → Reload Window)');
  log('  e confirme com talos_ping (deve retornar host=vscode, status=alive).');
}

function uninstallVscode(targetDir, opts) {
  log(`removendo Talos (vscode) de ${targetDir}`);
  rmIfExists(path.join(targetDir, '.vscode/talos'), opts);
  rmTalosAgentsQuiet(path.join(targetDir, '.vscode/agents'), opts);
  rmTalosSkills(path.join(targetDir, '.vscode/skills'), opts);
  dropMcpKey(path.join(targetDir, '.vscode', 'mcp.json'), 'mcpServers', 'talos', opts);
  log('ok — artefatos do Talos removidos (.vscode/mcp.json preservado se tiver outros servers).');
}

function uninstallVscodeGlobal(opts) {
  const talosRoot = vscodeGlobalRoot();
  const promptsDir = vscodePromptsDir();
  const settingsFile = vscodeSettingsFile();

  log(`removendo Talos (vscode) GLOBAL`);
  log(`  runtime: ${talosRoot}`);
  log(`  prompts: ${promptsDir}`);

  rmIfExists(talosRoot, opts);
  rmTalosAgentsQuiet(promptsDir, opts);
  rmTalosSkills(promptsDir, opts);
  dropMcpKey(settingsFile, 'github.copilot.chat.mcpServers', 'talos', { ...opts, jsonc: true });
  log('ok — artefatos globais do Talos para VS Code removidos.');
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
    {
      host: 'vscode',
      label: 'VS Code (global)',
      // VS Code está sempre presente quando rodamos o npx via terminal — não
      // precisa de CLI. Detecta pela existência do prompt folder padrão.
      detect: () => fs.existsSync(vscodeUserDir()),
      install: (o) => installVscodeGlobal(o),
      uninstall: (o) => uninstallVscodeGlobal(o),
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
  zcode                 via cache ~/.zcode/cli/plugins/cache/ (já global; installer habilita em config.json)
  opencode              por-projeto: .opencode/ + opencode.json no [dir]
                        --global: ~/.config/opencode/ (vale em todos os projetos)
  pi                    por-projeto: .mcp.json + .pi/agents/ no [dir] + deps
                        --global: ~/.pi/agent/ (vale em todos os projetos)
  vscode                por-projeto: .vscode/talos/ + .vscode/mcp.json no [dir]
                        --global: ~/.vscode-talos/ + user settings MCP + agents/skills no prompt folder

flags:
  --dir <d>    diretório alvo (opencode/pi/vscode por-projeto); default: diretório atual
  --global,-g  instalação global (opencode/pi/vscode); claude/codex/antigravity já são globais
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
  npx github:${REPO_SLUG} init vscode               # projeto atual
  npx github:${REPO_SLUG} init vscode --global       # todos os projetos
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

  if (!rawHost) fail('informe o host: all | claudecode | cursor | codex | antigravity | zcode | opencode | pi | vscode', 2);
  if (extra.length) fail(`argumentos extras não suportados: ${extra.join(' ')}`, 2);
  const host = HOST_ALIASES[rawHost.toLowerCase()];
  if (!host) fail(`host inválido: ${rawHost} (use all|claudecode|cursor|codex|antigravity|zcode|opencode|pi|vscode)`, 2);

  const opts = parsed.opts;

  // Host virtual `all`: detecta e opera em todos os hosts presentes no sistema.
  if (host === 'all') {
    if (rawDir) fail('host `all` não suporta [dir] posicional (opencode/pi usam --global)', 2);
    runAll(cmd, opts);
    return;
  }

  const targetDir = path.resolve(opts.dir || rawDir || process.cwd());
  const actions = {
    init: { claude: installClaude, codex: installCodex, antigravity: installAntigravity, zcode: installZcode, opencode: installOpencode, pi: installPi, vscode: installVscode },
    uninstall: { claude: uninstallClaude, codex: uninstallCodex, antigravity: uninstallAntigravity, zcode: uninstallZcode, opencode: uninstallOpencode, pi: uninstallPi, vscode: uninstallVscode },
  };
  const globalActions = {
    init: { opencode: installOpencodeGlobal, pi: installPiGlobal, vscode: installVscodeGlobal },
    uninstall: { opencode: uninstallOpencodeGlobal, pi: uninstallPiGlobal, vscode: uninstallVscodeGlobal },
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
