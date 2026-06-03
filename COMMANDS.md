# Atlas Workflow — Comandos rápidos

Referência de 1 linha para instalar, atualizar e remover o Atlas em cada host.
Instalador único via **npx-from-GitHub** (não precisa clonar o repo).

> **Pré-merge:** enquanto o multi-host não estiver na branch default, fixe a branch
> em todos os comandos npx:
> `npx github:pauloborini/atlas-workflow#feature/multihost-expansion <cmd>`
> Depois do merge na `main`, use sem `#branch` (como abaixo).

---

## Instalar

```bash
# Claude Code / Cursor  (global por natureza — registro da CLI)
npx github:pauloborini/atlas-workflow init claudecode
npx github:pauloborini/atlas-workflow init cursor

# Codex  (global por natureza)
npx github:pauloborini/atlas-workflow init codex

# opencode  — por-projeto (cwd) ou global
npx github:pauloborini/atlas-workflow init opencode
npx github:pauloborini/atlas-workflow init opencode --global

# pi  — por-projeto (cwd) ou global; --yes auto-instala as 2 deps obrigatórias
npx github:pauloborini/atlas-workflow init pi --yes
npx github:pauloborini/atlas-workflow init pi --global --yes
```

## Desinstalar

```bash
npx github:pauloborini/atlas-workflow uninstall claudecode    # ou cursor
npx github:pauloborini/atlas-workflow uninstall codex
npx github:pauloborini/atlas-workflow uninstall opencode      # --global se instalou global
npx github:pauloborini/atlas-workflow uninstall pi            # --global se instalou global
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
| opencode | `~/.config/opencode/` (Win: `%APPDATA%\opencode`; honra `XDG_CONFIG_HOME`) | `opencode.json` |
| pi | `~/.pi/agent/` (honra `PI_CODING_AGENT_DIR`) | `mcp.json` |

---

## Smoke pós-install (em qualquer host)

Abra a CLI no host e chame as tools:

- `atlas_ping` → deve retornar `host=<claude|codex|opencode|pi>`
- `atlas_capabilities` → descritores + `prereq_policy`

> **Não** dispare o `atlas-task-validator` à mão: ele roda automaticamente dentro do
> workflow, com um state file real (`.atlas/state/<run_id>/<slice>.json`).

---

## Instalação manual (equivalente, sem npx)

```bash
# Claude Code / Cursor
claude plugin marketplace add pauloborini/atlas-workflow
claude plugin install atlas-workflow-orchestrator@atlas-workflow

# Codex
codex plugin marketplace add pauloborini/atlas-workflow
codex plugin add atlas-workflow-orchestrator@atlas-workflow
```

Atualizar (claude/codex):

```bash
claude plugin marketplace update atlas-workflow
claude plugin update atlas-workflow-orchestrator@atlas-workflow
```

---

## Plataformas

- **macOS / Linux** — suportados (mesmo caminho POSIX).
- **Windows** — suporte por código (spawn via shell; opencode em `%APPDATA%`, pi em `%USERPROFILE%\.pi\agent`); smoke real pendente. Defina `XDG_CONFIG_HOME` para forçar o caminho do opencode.
