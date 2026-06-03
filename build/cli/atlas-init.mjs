#!/usr/bin/env node
// Atlas Workflow — instalador unificado por host.
//   npx github:pauloborini/atlas-workflow init <host> [dir] [flags]
//
// Hosts: claudecode|cursor (via `claude plugin`), codex (via `codex plugin`),
//        opencode (config + .opencode/), pi (config + .pi/agents/).
// Sem dependências externas (Node puro). Roda direto do checkout do repo (npx-from-GitHub).
//
// claude/codex: orquestra o instalador NATIVO da CLI (marketplace from-source no GitHub).
// opencode/pi: coloca o catálogo from-source committed (hosts/<host>/) no diretório alvo.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_SLUG = 'pauloborini/atlas-workflow';
const PLUGIN_ID = 'atlas-workflow-orchestrator@atlas-workflow';

const VERSION = (() => {
  try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); }
  catch { return 'desconhecida'; }
})();

const HOST_ALIASES = {
  claude: 'claude', claudecode: 'claude', 'claude-code': 'claude', cursor: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
};

function log(msg) { process.stdout.write(`${msg}\n`); }
function fail(msg, code = 1) { process.stderr.write(`erro: ${msg}\n`); process.exit(code); }

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

function run(cmd, args, { dryRun }) {
  log(`  $ ${cmd} ${args.join(' ')}`);
  if (dryRun) return 0;
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  return r.status ?? 1;
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
    catch { fail(`opencode.json existente é JSON inválido: ${dest}`); }
    log(`  opencode.json já existe — mesclando a chave mcp.atlas-workflow`);
  }
  cfg.$schema ??= srcCfg.$schema;
  cfg.mcp = { ...(cfg.mcp ?? {}), ...srcCfg.mcp };
  fs.writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n');
  return dest;
}

function installClaude(opts) {
  if (!which('claude')) fail('CLI `claude` não encontrada no PATH. Instale o Claude Code primeiro.');
  log(`instalando Atlas (claude/cursor) via marketplace from-source @ ${REPO_SLUG}`);
  if (run('claude', ['plugin', 'marketplace', 'add', REPO_SLUG], opts)) fail('falha no `claude plugin marketplace add`');
  if (run('claude', ['plugin', 'install', PLUGIN_ID], opts)) fail('falha no `claude plugin install`');
  log('ok — Claude Code/Cursor instalados (skills + subagente + MCP + hooks).');
  log('nota: o marketplace lê o branch default do GitHub; recursos multi-host valem após merge na main.');
}

function installCodex(opts) {
  if (!which('codex')) fail('CLI `codex` não encontrada no PATH. Instale o Codex primeiro.');
  log(`instalando Atlas (codex) via marketplace from-source @ ${REPO_SLUG}`);
  if (run('codex', ['plugin', 'marketplace', 'add', REPO_SLUG], opts)) fail('falha no `codex plugin marketplace add`');
  if (run('codex', ['plugin', 'add', PLUGIN_ID], opts)) fail('falha no `codex plugin add`');
  log('ok — Codex instalado (skills + subagente + MCP).');
  log('nota: o marketplace lê o branch default do GitHub; recursos multi-host valem após merge na main.');
}

function installOpencode(targetDir, opts) {
  log(`instalando Atlas (opencode v${VERSION}) em ${targetDir}`);
  if (opts.dryRun) { log('  [dry-run] copiaria .opencode/ + mesclaria opencode.json'); return; }
  fs.mkdirSync(targetDir, { recursive: true });
  copyInto('hosts/opencode/.opencode', targetDir);   // subagente + skills + runtime
  mergeOpencodeJson(targetDir);                       // MCP local (type:local, ATLAS_HOST=opencode)
  log('ok — opencode instalado (MCP + subagente + skills).');
  log(`próximo: cd ${targetDir} && opencode  → confirme com atlas_ping (host=opencode).`);
}

function piDepsStatus() {
  if (!which('pi')) return { piPresent: false, missing: ['pi-mcp-adapter', 'pi-subagents'] };
  const r = spawnSync('pi', ['list'], { encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const missing = ['pi-mcp-adapter', 'pi-subagents'].filter((d) => !out.includes(d));
  return { piPresent: true, missing };
}

function installPi(targetDir, opts) {
  log(`instalando Atlas (pi v${VERSION}) em ${targetDir}`);
  if (opts.dryRun) { log('  [dry-run] copiaria atlas/ skills/ .pi/agents/ + .mcp.json'); }
  else {
    fs.mkdirSync(targetDir, { recursive: true });
    copyInto('hosts/pi/atlas', targetDir);
    copyInto('hosts/pi/skills', targetDir);
    copyInto('hosts/pi/.pi', targetDir);                 // .pi/agents/<name>.md (descoberta pi-subagents)
    fs.copyFileSync(path.join(ROOT, 'hosts/pi/.mcp.json'), path.join(targetDir, '.mcp.json')); // pi-mcp-adapter
    log('ok — arquivos do pi instalados (.mcp.json + .pi/agents/ + atlas/ + skills/).');
  }
  const { piPresent, missing } = piDepsStatus();
  if (!piPresent) {
    log('aviso: CLI `pi` não encontrada — instale o pi e as 2 deps obrigatórias (DEC-005):');
    log('  pi install npm:pi-mcp-adapter && pi install npm:pi-subagents');
  } else if (missing.length) {
    log(`deps obrigatórias ausentes: ${missing.join(', ')} (DEC-005)`);
    if (opts.yes && !opts.dryRun) {
      for (const dep of missing) run('pi', ['install', `npm:${dep}`], opts);
    } else {
      log('instale com:');
      for (const dep of missing) log(`  pi install npm:${dep}`);
      log('(ou re-rode com --yes para instalar automaticamente)');
    }
  } else {
    log('deps obrigatórias presentes: pi-mcp-adapter + pi-subagents ✓');
  }
  log(`próximo: cd ${targetDir} && pi  → atlas_ping (host=pi); dispare o validator via`);
  log('  subagent({ agent: "atlas-task-validator", task: "<state_path>", context: "fresh" })');
}

// --- uninstall ---------------------------------------------------------------

function rmIfExists(p, { dryRun }) {
  if (!fs.existsSync(p)) return false;
  log(`  rm ${path.relative(process.cwd(), p) || p}`);
  if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
  return true;
}

// Remove apenas subdirs com prefixo atlas- (não toca skills do usuário).
function rmAtlasSkills(skillsDir, opts) {
  if (!fs.existsSync(skillsDir)) return;
  for (const name of fs.readdirSync(skillsDir)) {
    if (name.startsWith('atlas-')) rmIfExists(path.join(skillsDir, name), opts);
  }
}

// Remove uma chave de server MCP de um config JSON; reescreve. Remove o arquivo só
// se ficou totalmente vazio (era exclusivo do Atlas). Preserva outros servers.
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
  log('removendo Atlas (claude/cursor)');
  run('claude', ['plugin', 'uninstall', PLUGIN_ID], opts);
  run('claude', ['plugin', 'marketplace', 'remove', 'atlas-workflow'], opts);
  log('ok — removido do Claude Code/Cursor.');
}

function uninstallCodex(opts) {
  if (!which('codex')) fail('CLI `codex` não encontrada no PATH.');
  log('removendo Atlas (codex)');
  run('codex', ['plugin', 'remove', PLUGIN_ID], opts);
  run('codex', ['plugin', 'marketplace', 'remove', 'atlas-workflow'], opts);
  log('ok — removido do Codex.');
}

function uninstallOpencode(targetDir, opts) {
  log(`removendo Atlas (opencode) de ${targetDir}`);
  rmIfExists(path.join(targetDir, '.opencode/atlas'), opts);
  rmIfExists(path.join(targetDir, '.opencode/agents/atlas-task-validator.md'), opts);
  rmAtlasSkills(path.join(targetDir, '.opencode/skills'), opts);
  dropMcpKey(path.join(targetDir, 'opencode.json'), 'mcp', 'atlas-workflow', opts);
  log('ok — artefatos do Atlas removidos (config/skills do usuário preservados).');
}

function uninstallPi(targetDir, opts) {
  log(`removendo Atlas (pi) de ${targetDir}`);
  rmIfExists(path.join(targetDir, 'atlas'), opts);
  rmIfExists(path.join(targetDir, '.pi/agents/atlas-task-validator.md'), opts);
  rmAtlasSkills(path.join(targetDir, 'skills'), opts);
  dropMcpKey(path.join(targetDir, '.mcp.json'), 'mcpServers', 'atlas-workflow', opts);
  log('ok — artefatos do Atlas removidos. As deps pi-mcp-adapter/pi-subagents ficam (uso geral);');
  log('  remova manualmente se quiser: pi remove pi-mcp-adapter && pi remove pi-subagents');
}

function usage() {
  log(`atlas-workflow v${VERSION} — instalador multi-host

uso:
  npx github:${REPO_SLUG} init <host> [dir] [flags]
  npx github:${REPO_SLUG} uninstall <host> [dir] [flags]

hosts:
  claudecode | cursor   via \`claude plugin\` (marketplace from-source)
  codex                 via \`codex plugin\` (marketplace from-source)
  opencode              .opencode/ + opencode.json no [dir] (default: cwd)
  pi                    .mcp.json + .pi/agents/ no [dir] (default: cwd) + deps

flags:
  --dir <d>    diretório alvo (opencode/pi); default: diretório atual
  --global,-g  (reservado) instalação global — ainda não implementado
  --yes,-y     auto-instala deps faltantes (pi, no init)
  --dry-run    mostra o que faria, sem alterar nada
  -h,--help    esta ajuda

exemplos:
  npx github:${REPO_SLUG} init claudecode
  npx github:${REPO_SLUG} init opencode
  npx github:${REPO_SLUG} init pi --yes
  npx github:${REPO_SLUG} uninstall opencode
  npx github:${REPO_SLUG} uninstall pi --dry-run`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) { usage(); process.exit(0); }

  const cmd = argv[0];
  if (cmd !== 'init' && cmd !== 'uninstall') {
    fail(`comando desconhecido: ${cmd} (use \`init <host>\` ou \`uninstall <host>\`)`, 2);
  }

  const positional = argv.slice(1).filter((a) => !a.startsWith('-'));
  const rawHost = positional[0];
  if (!rawHost) fail('informe o host: claudecode | cursor | codex | opencode | pi', 2);
  const host = HOST_ALIASES[rawHost.toLowerCase()];
  if (!host) fail(`host inválido: ${rawHost} (use claudecode|cursor|codex|opencode|pi)`, 2);

  const dirFlagIdx = argv.findIndex((a) => a === '--dir');
  const dirFromFlag = dirFlagIdx !== -1 ? argv[dirFlagIdx + 1] : undefined;
  const targetDir = path.resolve(dirFromFlag || positional[1] || process.cwd());

  const opts = {
    dryRun: argv.includes('--dry-run'),
    yes: argv.includes('--yes') || argv.includes('-y'),
    global: argv.includes('--global') || argv.includes('-g'),
  };
  if (opts.global) log('aviso: --global ainda não implementado; usando instalação por diretório.');

  const actions = {
    init: { claude: installClaude, codex: installCodex, opencode: installOpencode, pi: installPi },
    uninstall: { claude: uninstallClaude, codex: uninstallCodex, opencode: uninstallOpencode, pi: uninstallPi },
  };
  const fn = actions[cmd][host];
  if (host === 'claude' || host === 'codex') fn(opts);
  else fn(targetDir, opts);
}

main();
