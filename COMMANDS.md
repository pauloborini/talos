# Atlas Workflow — Comandos rápidos

Referência de 1 linha para instalar, atualizar e remover o Atlas em cada host.
Instalador único via **npx-from-GitHub** (não precisa clonar o repo).

---

## Atualizar

```bash
# Claude Code / Cursor
claude plugin marketplace update atlas-workflow
claude plugin update atlas-workflow-orchestrator@atlas-workflow

# Codex — recomendado: reinstala plugin + custom agents em CODEX_HOME/agents
npx github:pauloborini/atlas-workflow init codex

# Antigravity — reinstalar pega runtime novo (mesmo comando do init)
npx github:pauloborini/atlas-workflow init antigravity

# opencode / pi — reinstalar pega runtime novo (mesmo comando do init)
npx github:pauloborini/atlas-workflow init opencode --global
npx github:pauloborini/atlas-workflow init pi --global --yes

```

Smoke pós-update: `atlas_ping` → `version: 0.9.0`; `atlas_capabilities` → `schema_version: 5` (sibling-only).

---

## Instalar

```bash
# Claude Code / Cursor  (global por natureza — registro da CLI)
npx github:pauloborini/atlas-workflow init claudecode
npx github:pauloborini/atlas-workflow init cursor

# Codex  (global por natureza)
npx github:pauloborini/atlas-workflow init codex

# Antigravity (global por natureza)
npx github:pauloborini/atlas-workflow init antigravity

# opencode  — global (recomendado) ou por-projeto
npx github:pauloborini/atlas-workflow init opencode --global
npx github:pauloborini/atlas-workflow init opencode

# pi  — global (recomendado) ou por-projeto; --yes auto-instala as 2 deps obrigatórias
npx github:pauloborini/atlas-workflow init pi --global --yes
npx github:pauloborini/atlas-workflow init pi --yes
```

## Desinstalar

```bash
# Claude Code / Cursor / Codex / Antigravity (sempre globais)
npx github:pauloborini/atlas-workflow uninstall claudecode   
npx github:pauloborini/atlas-workflow uninstall codex
npx github:pauloborini/atlas-workflow uninstall antigravity

# opencode / pi — desinstalação global (recomendado)
npx github:pauloborini/atlas-workflow uninstall opencode --global
npx github:pauloborini/atlas-workflow uninstall pi --global

# opencode / pi — desinstalação por-projeto (caso não tenha usado --global)
npx github:pauloborini/atlas-workflow uninstall opencode
npx github:pauloborini/atlas-workflow uninstall pi
```

Remove **só** os artefatos do Atlas. Preserva config, skills e outros MCP servers do usuário.

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
| opencode | `~/.config/opencode/` (Win: `%APPDATA%\opencode`; honra `XDG_CONFIG_HOME`) | `opencode.json` |
| pi | `~/.pi/agent/` (honra `PI_CODING_AGENT_DIR`) | `mcp.json` |

---

## Smoke pós-install (em qualquer host)

Abra a CLI no host e chame as tools:

- `atlas_ping` → deve retornar `host=<claude|codex|antigravity|opencode|pi>`
- `atlas_capabilities` → descritores + `prereq_policy`

> **Não** dispare o `atlas-task-validator` à mão: ele roda automaticamente dentro do
> workflow, com um state file real (`.atlas/state/<run_id>/<slice>.json`).

---

## Instalação manual (equivalente, sem npx)

```bash
# Claude Code / Cursor
claude plugin marketplace add pauloborini/atlas-workflow
claude plugin install atlas-workflow-orchestrator@atlas-workflow

# Codex (garante agent_type atlas-* para spawn_agent)
npx github:pauloborini/atlas-workflow init codex
```

Atualizar (claude/codex):

```bash
# Claude Code / Cursor
claude plugin marketplace update atlas-workflow
claude plugin update atlas-workflow-orchestrator@atlas-workflow

# Codex (reinstala plugin + custom agents)
npx github:pauloborini/atlas-workflow init codex
```

Alternativa equivalente para qualquer host com npx: `npx github:pauloborini/atlas-workflow init <host>`.

---

## Plataformas

- **macOS / Linux** — suportados (mesmo caminho POSIX).
- **Windows** — suporte por código (spawn via shell; opencode em `%APPDATA%`, pi em `%USERPROFILE%\.pi\agent`); smoke real pendente. Defina `XDG_CONFIG_HOME` para forçar o caminho do opencode.
