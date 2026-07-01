# Talos — Comandos rápidos

Referência de 1 linha para instalar, atualizar e remover o Talos em cada host.
Instalador único via **npx-from-GitHub** (não precisa clonar o repo).

---

## Atualizar

```bash
# Claude Code / Cursor
claude plugin marketplace update talos
claude plugin update talos@talos

# Codex — recomendado: reinstala plugin + custom agents em CODEX_HOME/agents
npx github:pauloborini/talos init codex

# Antigravity — reinstalar pega runtime novo (mesmo comando do init)
npx github:pauloborini/talos init antigravity

# opencode / pi — reinstalar pega runtime novo (mesmo comando do init)
npx github:pauloborini/talos init opencode --global
npx github:pauloborini/talos init pi --global --yes

# zcode — reinstalar pega runtime novo (mesmo comando do init; /plugins enable no host)
npx github:pauloborini/talos init zcode

```

Smoke pós-update: `talos_ping` → `version: 0.12.0`; `talos_capabilities` → `schema_version: 5` (sibling-only).

---

## Instalar

```bash
# Todos os hosts de uma vez (detecta automaticamente quais estão instalados)
npx github:pauloborini/talos init all

# Claude Code / Cursor  (global por natureza — registro da CLI)
npx github:pauloborini/talos init claudecode
npx github:pauloborini/talos init cursor

# Codex  (global por natureza)
npx github:pauloborini/talos init codex

# Antigravity (global por natureza)
npx github:pauloborini/talos init antigravity

# ZCode (global por natureza — cache do host; ativar via /plugins enable talos)
npx github:pauloborini/talos init zcode

# opencode  — global (recomendado) ou por-projeto
npx github:pauloborini/talos init opencode --global
npx github:pauloborini/talos init opencode

# pi  — global (recomendado) ou por-projeto; --yes auto-instala as 2 deps obrigatórias
npx github:pauloborini/talos init pi --global --yes
npx github:pauloborini/talos init pi --yes
```

## Desinstalar

```bash
# Todos os hosts de uma vez (detecta automaticamente quais estão instalados)
npx github:pauloborini/talos uninstall all

# Claude Code / Cursor / Codex / Antigravity / ZCode (sempre globais)
npx github:pauloborini/talos uninstall claudecode   
npx github:pauloborini/talos uninstall codex
npx github:pauloborini/talos uninstall antigravity
npx github:pauloborini/talos uninstall zcode

# opencode / pi — desinstalação global (recomendado)
npx github:pauloborini/talos uninstall opencode --global
npx github:pauloborini/talos uninstall pi --global

# opencode / pi — desinstalação por-projeto (caso não tenha usado --global)
npx github:pauloborini/talos uninstall opencode
npx github:pauloborini/talos uninstall pi
```

Remove **só** os artefatos do Talos. Preserva config, skills e outros MCP servers do usuário.

---

## Flags

| Flag | Vale para | Efeito |
|------|-----------|--------|
| `--global`, `-g` | opencode, pi | instala em `~/.config/opencode/` / `~/.pi/agent/` (todos os projetos) |
| `--dir <d>` | opencode, pi (por-projeto) | diretório alvo; default = diretório atual |
| `--yes`, `-y` | pi (init) | auto-instala deps faltantes (`pi-mcp-adapter` + `pi-subagents`) |
| `--dry-run` | todos | mostra o que faria, sem alterar nada |
| `-h`, `--help` | — | ajuda |

---

## Onde cada host instala (global)

| Host | Local global | Config MCP |
|------|--------------|------------|
| claude/cursor | registro da CLI (`claude plugin`) | — |
| codex | registro da CLI (`codex plugin`) | — |
| antigravity | `~/.gemini/config/` | `mcp_config.json` |
| zcode | `~/.zcode/cli/plugins/cache/zcode-plugins-official/talos/<version>/` | `.zcode-plugin/plugin.json` (MCP via `${ZCODE_PLUGIN_ROOT}`; ativar via `/plugins enable`) |
| opencode | `~/.config/opencode/` (Win: `%APPDATA%\opencode`; honra `XDG_CONFIG_HOME`) | `opencode.json` |
| pi | `~/.pi/agent/` (honra `PI_CODING_AGENT_DIR`) | `mcp.json` |

---

## Smoke pós-install (em qualquer host)

Abra a CLI no host e chame as tools:

- `talos_ping` → deve retornar `host=<claude|codex|antigravity|zcode|opencode|pi>`
- `talos_capabilities` → descritores + `prereq_policy`

> **Não** dispare o `talos-task-validator` à mão: ele roda automaticamente dentro do
> workflow, com um state file real (`.talos/state/<run_id>/<slice>.json`).

---

## Instalação manual (equivalente, sem npx)

```bash
# Claude Code / Cursor
claude plugin marketplace add pauloborini/talos
claude plugin install talos@talos

# Codex (garante agent_type talos-* para spawn_agent)
npx github:pauloborini/talos init codex
```

Atualizar (claude/codex):

```bash
# Claude Code / Cursor
claude plugin marketplace update talos
claude plugin update talos@talos

# Codex (reinstala plugin + custom agents)
npx github:pauloborini/talos init codex
```

Alternativa equivalente para qualquer host com npx: `npx github:pauloborini/talos init <host>`.

---

## Plataformas

- **macOS / Linux** — suportados (mesmo caminho POSIX).
- **Windows** — suporte por código (spawn via shell; opencode em `%APPDATA%`, pi em `%USERPROFILE%\.pi\agent`); smoke real pendente. Defina `XDG_CONFIG_HOME` para forçar o caminho do opencode.
