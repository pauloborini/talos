#!/usr/bin/env node
// Smoke do instalador público. Não usa CLIs reais; materializa em tmp e mocka `pi`.
// Cobre: stale cleanup, merge preservando config, JSONC opencode, gate deps pi,
// local/global e parser de flags.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'build/cli/atlas-init.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-install-'));
const errors = [];

function fail(msg) { errors.push(msg); }
function assert(cond, msg) { if (!cond) fail(msg); }
function exists(p) { return fs.existsSync(p); }
function json(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function run(args, env = {}) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function makePiMock({ initial = [], failInstall = '' } = {}) {
  const bin = path.join(TMP, `bin-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(bin, { recursive: true });
  const state = path.join(bin, 'pi-state.txt');
  fs.writeFileSync(state, `${initial.join('\n')}\n`);
  const script = path.join(bin, 'pi');
  fs.writeFileSync(script, `#!/usr/bin/env sh
set -eu
STATE="${state}"
case "$1" in
  list)
    cat "$STATE"
    ;;
  install)
    dep="$2"
    dep="\${dep#npm:}"
    if [ "$dep" = "${failInstall}" ]; then
      exit 23
    fi
    grep -qx "$dep" "$STATE" 2>/dev/null || echo "$dep" >> "$STATE"
    ;;
  *)
    exit 2
    ;;
esac
`);
  fs.chmodSync(script, 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}`, PI_MOCK_STATE: state };
}

function makeCodexMock() {
  const bin = path.join(TMP, `bin-codex-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(bin, { recursive: true });
  const logFile = path.join(bin, 'codex-calls.txt');
  const script = path.join(bin, 'codex');
  fs.writeFileSync(script, `#!/usr/bin/env sh
set -eu
echo "$*" >> "${logFile}"
case "$1 $2" in
  "plugin marketplace"|"plugin add"|"plugin remove") exit 0 ;;
  *) exit 2 ;;
esac
`);
  fs.chmodSync(script, 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_MOCK_LOG: logFile };
}

// codex: plugin install não basta para garantir agent_type; init também copia os
// custom agents Atlas para CODEX_HOME/agents, que é o caminho nativo do Codex.
{
  const codexHome = path.join(TMP, 'codex-home');
  const env = { ...makeCodexMock(), CODEX_HOME: codexHome };
  const r = run(['init', 'codex'], env);
  assert(r.status === 0, `codex init falhou: ${r.stderr || r.stdout}`);
  assert(exists(path.join(codexHome, 'agents/atlas-task-validator.toml')), 'codex não instalou atlas-task-validator.toml em CODEX_HOME/agents');
  assert(exists(path.join(codexHome, 'agents/atlas-plan-execute.toml')), 'codex não instalou atlas-plan-execute.toml em CODEX_HOME/agents');
  assert(exists(path.join(codexHome, 'agents/atlas-findings-repair.toml')), 'codex não instalou atlas-findings-repair.toml em CODEX_HOME/agents');
  const validator = fs.readFileSync(path.join(codexHome, 'agents/atlas-task-validator.toml'), 'utf8');
  assert(validator.includes('name = "atlas-task-validator"'), 'codex validator sem name correto');
  assert(!/^\s*model\s*=/.test(validator), 'codex validator deve ficar sem model pinado');
  assert(!/^\s*model_reasoning_effort\s*=/.test(validator), 'codex validator deve ficar sem reasoning pinado');
  assert(validator.includes('developer_instructions'), 'codex validator sem developer_instructions; sem model pinado ele ainda precisa carregar o shim');
  const u = run(['uninstall', 'codex'], env);
  assert(u.status === 0, `codex uninstall falhou: ${u.stderr || u.stdout}`);
  assert(!exists(path.join(codexHome, 'agents/atlas-task-validator.toml')), 'codex uninstall manteve validator');
  assert(!exists(path.join(codexHome, 'agents/atlas-plan-execute.toml')), 'codex uninstall manteve executor');
}

// opencode local: update remove stale Atlas e preserva config/skills do usuário.
{
  const dir = path.join(TMP, 'opencode-local');
  fs.mkdirSync(path.join(dir, '.opencode/atlas'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.opencode/agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.opencode/skills/atlas-old'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.opencode/skills/user-skill'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.opencode/atlas/old.txt'), 'stale');
  fs.writeFileSync(path.join(dir, '.opencode/agents/atlas-task-validator.md'), 'stale');
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ mcp: { other: { type: 'local', command: ['node', 'x'] } } }));
  const r = run(['init', 'opencode', '--dir', dir]);
  assert(r.status === 0, `opencode local init falhou: ${r.stderr || r.stdout}`);
  assert(!exists(path.join(dir, '.opencode/atlas/old.txt')), 'opencode local manteve stale em .opencode/atlas');
  assert(!exists(path.join(dir, '.opencode/skills/atlas-old')), 'opencode local manteve skill atlas-* stale');
  assert(exists(path.join(dir, '.opencode/skills/user-skill')), 'opencode local removeu skill do usuário');
  assert(json(path.join(dir, 'opencode.json')).mcp.other, 'opencode local perdeu mcp do usuário');
  assert(json(path.join(dir, 'opencode.json')).mcp['atlas-workflow'], 'opencode local não registrou MCP Atlas');
  // Sub-agents executores/review devem instalar junto (não só o validator) — senão G9.
  assert(exists(path.join(dir, '.opencode/agents/atlas-plan-execute.md')), 'opencode local não instalou agente executor atlas-plan-execute');
  assert(exists(path.join(dir, '.opencode/agents/atlas-slice-review.md')), 'opencode local não instalou agente atlas-slice-review');
  const u = run(['uninstall', 'opencode', '--dir', dir]);
  assert(u.status === 0, `opencode local uninstall falhou: ${u.stderr || u.stdout}`);
  assert(!exists(path.join(dir, '.opencode/agents/atlas-plan-execute.md')), 'opencode uninstall manteve agente executor');
  assert(exists(path.join(dir, '.opencode/skills/user-skill')), 'opencode uninstall removeu skill do usuário');
  assert(json(path.join(dir, 'opencode.json')).mcp.other, 'opencode uninstall perdeu mcp do usuário');
}

// opencode global: JSONC com comentário é preservado; Atlas vai para opencode.json.
{
  const xdg = path.join(TMP, 'xdg-jsonc');
  const root = path.join(xdg, 'opencode');
  fs.mkdirSync(root, { recursive: true });
  const jsonc = path.join(root, 'opencode.jsonc');
  fs.writeFileSync(jsonc, '{\n  // user comment\n  "mcp": {}\n}\n');
  const r = run(['init', 'opencode', '--global'], { XDG_CONFIG_HOME: xdg });
  assert(r.status === 0, `opencode global JSONC init falhou: ${r.stderr || r.stdout}`);
  assert(fs.readFileSync(jsonc, 'utf8').includes('// user comment'), 'opencode jsonc foi alterado/corrompido');
  assert(json(path.join(root, 'opencode.json')).mcp['atlas-workflow'], 'opencode global não escreveu opencode.json fallback');
  const u = run(['uninstall', 'opencode', '--global'], { XDG_CONFIG_HOME: xdg });
  assert(u.status === 0, `opencode global JSONC uninstall falhou: ${u.stderr || u.stdout}`);
  assert(fs.readFileSync(jsonc, 'utf8').includes('// user comment'), 'opencode jsonc foi alterado/corrompido no uninstall');
  assert(!exists(path.join(root, 'opencode.json')) || !json(path.join(root, 'opencode.json')).mcp?.['atlas-workflow'], 'opencode global uninstall manteve MCP Atlas no fallback JSON');
}

// pi sem deps e sem --yes: falha antes de copiar.
{
  const dir = path.join(TMP, 'pi-missing');
  const env = makePiMock();
  const r = run(['init', 'pi', '--dir', dir], env);
  assert(r.status !== 0, 'pi sem deps e sem --yes deveria falhar');
  assert(!exists(path.join(dir, 'atlas')), 'pi copiou arquivos mesmo sem deps obrigatórias');
}

// pi --yes: instala deps, revalida, remove stale e preserva config.
{
  const dir = path.join(TMP, 'pi-local');
  fs.mkdirSync(path.join(dir, 'atlas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills/atlas-old'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills/user-skill'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'atlas/old.txt'), 'stale');
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'node', args: ['x'] } } }));
  const env = makePiMock();
  const r = run(['init', 'pi', '--dir', dir, '--yes'], env);
  assert(r.status === 0, `pi --yes init falhou: ${r.stderr || r.stdout}`);
  assert(!exists(path.join(dir, 'atlas/old.txt')), 'pi local manteve stale em atlas/');
  assert(!exists(path.join(dir, 'skills/atlas-old')), 'pi local manteve skill atlas-* stale');
  assert(exists(path.join(dir, 'skills/user-skill')), 'pi local removeu skill do usuário');
  assert(json(path.join(dir, '.mcp.json')).mcpServers.other, 'pi local perdeu mcp do usuário');
  assert(json(path.join(dir, '.mcp.json')).mcpServers['atlas-workflow'], 'pi local não registrou MCP Atlas');
  const state = fs.readFileSync(env.PI_MOCK_STATE, 'utf8');
  assert(state.includes('pi-mcp-adapter') && state.includes('pi-subagents'), 'pi --yes não instalou/revalidou deps');
  const u = run(['uninstall', 'pi', '--dir', dir], env);
  assert(u.status === 0, `pi uninstall falhou: ${u.stderr || u.stdout}`);
  assert(json(path.join(dir, '.mcp.json')).mcpServers.other, 'pi uninstall perdeu mcp do usuário');
}

// pi --yes: falha se dep falhar.
{
  const dir = path.join(TMP, 'pi-fail');
  const env = makePiMock({ failInstall: 'pi-subagents' });
  const r = run(['init', 'pi', '--dir', dir, '--yes'], env);
  assert(r.status !== 0, 'pi --yes deveria falhar quando dep falha');
  assert(!exists(path.join(dir, 'atlas')), 'pi copiou arquivos após falha de dep');
}

// pi global com sandbox.
{
  const agentDir = path.join(TMP, 'pi-agent');
  const env = { ...makePiMock({ initial: ['pi-mcp-adapter', 'pi-subagents'] }), PI_CODING_AGENT_DIR: agentDir };
  const r = run(['init', 'pi', '--global', '--yes'], env);
  assert(r.status === 0, `pi global init falhou: ${r.stderr || r.stdout}`);
  assert(exists(path.join(agentDir, 'atlas/packages/mcp-server/server.js')), 'pi global não copiou runtime');
  assert(exists(path.join(agentDir, 'agents/atlas-task-validator.md')), 'pi global não copiou agente');
  assert(exists(path.join(agentDir, 'agents/atlas-plan-execute.md')), 'pi global não copiou agente executor atlas-plan-execute');
  assert(exists(path.join(agentDir, 'agents/atlas-direct-execute.md')), 'pi global não copiou agente executor atlas-direct-execute');
  assert(json(path.join(agentDir, 'mcp.json')).mcpServers['atlas-workflow'], 'pi global não registrou MCP');
  const u = run(['uninstall', 'pi', '--global'], env);
  assert(u.status === 0, `pi global uninstall falhou: ${u.stderr || u.stdout}`);
  assert(!exists(path.join(agentDir, 'atlas')), 'pi global uninstall manteve runtime');
  assert(!exists(path.join(agentDir, 'agents/atlas-plan-execute.md')), 'pi global uninstall manteve agente executor');
}

// Parser de flags.
{
  assert(run(['init', 'opencode', '--dir']).status !== 0, '--dir sem valor deveria falhar');
  assert(run(['init', 'opencode', '--wat']).status !== 0, 'flag desconhecida deveria falhar');
}

fs.rmSync(TMP, { recursive: true, force: true });

if (errors.length) {
  console.error('smoke-install: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('smoke-install: ok (install/uninstall tmp, stale cleanup, pi deps, JSONC e flags)');
