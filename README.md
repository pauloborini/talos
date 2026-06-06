# Atlas Workflow

Plugin **Atlas Workflow Orchestrator** v0.5 — pipeline determinístico (PRD → plano → execução → validação) com skills `atlas-*`, templates e MCP. Um pacote, cinco hosts: **Claude Code**, **Cursor**, **Codex App**, **opencode** e **pi cli**.

**Versão:** [`VERSION`](VERSION) (`0.5.0`) · **Repo:** https://github.com/pauloborini/atlas-workflow

## Hosts

| Host | Instalação (recomendada) | Artefato release | Deps obrigatórias |
|------|--------------------------|------------------|-------------------|
| Claude Code | Marketplace GitHub | `atlas-workflow-claude.plugin` | — |
| Cursor | **Igual ao Claude Code** (ver nota abaixo) | `atlas-workflow-claude.plugin` | — |
| Codex App | Marketplace GitHub | `atlas-workflow-codex.plugin` | — |
| opencode | Catálogo from-source `hosts/opencode/` | `atlas-workflow-opencode.plugin` | — |
| pi cli | Catálogo from-source `hosts/pi/` | `atlas-workflow-pi.plugin` | **`pi-mcp-adapter` + `pi-subagents`** |

**Cursor:** não há pacote nem marketplace próprios — o plugin instalado via `claude plugin` no escopo do usuário já vale para o Cursor (mesmo manifest `.claude-plugin/`). Limitação de packaging, não do pipeline.

**Conceito:** todos são *hosts* (onde as skills rodam), não famílias de skills. O pipeline é o mesmo; diferenças nativas (subagente, todo, MCP) vivem em [`host-adapters.md`](packages/orchestrator/references/host-adapters.md) e na tool `atlas_capabilities` (contrato `schema_version: 2`). Host sem subagente+MCP é **rejeitado no preflight** (gate `PREREQ`, hard-fail) — determinismo > alcance.

**Pré-requisito:** Node.js no host. Após instalar, confirme o MCP com `atlas_ping`.

## Instalação rápida (1 comando, via npx)

> Referência rápida de todos os comandos (instalar/atualizar/remover por host): **[COMMANDS.md](COMMANDS.md)**.

Um instalador único cobre os quatro hosts — não precisa clonar o repo:

```bash
npx github:pauloborini/atlas-workflow init claudecode   # ou: cursor
npx github:pauloborini/atlas-workflow init codex
npx github:pauloborini/atlas-workflow init opencode      # no diretório do projeto
npx github:pauloborini/atlas-workflow init pi --yes      # --yes auto-instala as 2 deps
```

- **claudecode/cursor** e **codex**: o instalador roda o `marketplace add` + `install`/`add` nativos da CLI por você. Já são **globais** (registro da CLI vale em todos os projetos).
- **opencode**: coloca `.opencode/` + `opencode.json` no diretório atual (use `--dir <d>` para outro alvo).
- **pi**: coloca `.mcp.json` + `.pi/agents/` e checa/instala as deps `pi-mcp-adapter` + `pi-subagents`.

### Global vs por-projeto (opencode/pi)

claude/codex são sempre globais. opencode/pi instalam **por-projeto** por padrão (arquivos no diretório). Para valer em **todos os projetos**, use `--global`:

```bash
npx github:pauloborini/atlas-workflow init opencode --global       # → ~/.config/opencode/
npx github:pauloborini/atlas-workflow init pi --global --yes       # → ~/.pi/agent/ (honra PI_CODING_AGENT_DIR)
```

No modo `--global` o runtime vai para um local estável (`~/.config/opencode/atlas` ou `~/.pi/agent/atlas`) e o MCP é registrado com **caminho absoluto** (sem depender do cwd). opencode: agente em `~/.config/opencode/agents/`, skills em `~/.config/opencode/skills/`. pi: agente em `~/.agents/` (se existir) ou `~/.pi/agent/agents/`, MCP em `~/.pi/agent/mcp.json`. A config existente é **mesclada** (preserva outros MCP servers e chaves); se houver `opencode.jsonc` com comentários, ele é preservado e o Atlas é registrado no fallback `opencode.json`.

Flags úteis: `--global`/`-g` (opencode/pi), `--dir <d>` (alvo por-projeto), `--yes` (auto-deps pi), `--dry-run` (mostra sem alterar), `-h`.

> **Plataformas:** macOS e Linux são suportados (mesmo caminho POSIX). Windows tem suporte por código (spawn das CLIs via shell; root global do opencode em `%APPDATA%\opencode`, ou `XDG_CONFIG_HOME` se definido; pi em `%USERPROFILE%\.pi\agent`) — smoke real do runtime MCP parcialmente validado no Windows; smoke do instalador automatizado (`build/smoke-install.mjs`) roda em Unix. No Windows, defina `XDG_CONFIG_HOME` para forçar o caminho do opencode de forma determinística.

Os fluxos manuais por host seguem abaixo (equivalentes ao que o instalador faz).

## Instalação manual (marketplace GitHub)

### Claude Code e Cursor

Uma instalação só (escopo `user`); o Cursor enxerga o mesmo plugin sem segundo `install`.

```bash
claude plugin marketplace add pauloborini/atlas-workflow
claude plugin install atlas-workflow-orchestrator@atlas-workflow
```

Atualizar após novo release:

```bash
claude plugin marketplace update atlas-workflow
claude plugin update atlas-workflow-orchestrator@atlas-workflow
```

Se skills não aparecerem no Cursor, reinicie o IDE ou use `/reload-plugins` no Claude Code.

### Codex App

```bash
codex plugin marketplace add pauloborini/atlas-workflow
codex plugin add atlas-workflow-orchestrator@atlas-workflow
```

Atualizar snapshot e plugin:

```bash
codex plugin marketplace upgrade atlas-workflow
codex plugin add atlas-workflow-orchestrator@atlas-workflow
```

(O Codex não tem `plugin update` — após o `upgrade` do marketplace, rode `add` de novo para pegar o snapshot novo.)

Clone local: troque a URL por `"/caminho/para/atlas-workflow"`.

### opencode

Modelo de install é por config (não há marketplace CLI). A partir de um clone do repo, use o helper (1 comando, idempotente — rode de novo para **atualizar**):

```bash
/caminho/para/atlas-workflow/build/install-host.sh opencode .   # instala/atualiza na raiz do projeto
```

Ou manualmente, copiando o catálogo from-source [`hosts/opencode/`](hosts/opencode/):

```bash
cp -R /caminho/para/atlas-workflow/hosts/opencode/.opencode ./.opencode
cp /caminho/para/atlas-workflow/hosts/opencode/opencode.json ./opencode.json   # ou mescle no seu opencode.json
```

O `opencode.json` registra o MCP `atlas-workflow` (`type:"local"`, `ATLAS_HOST=opencode`) e o subagente fica em `.opencode/agents/atlas-task-validator.md`. O comando do MCP é **relativo** (`.opencode/atlas/packages/mcp-server/server.js`), então o opencode deve iniciar com o **cwd na raiz** onde `.opencode/` foi copiado. Reinicie o opencode; confirme com `atlas_ping`.

### pi cli

**Pré-requisito obrigatório (DEC-005/DEC-010):** instale as duas extensões antes — sem qualquer uma o pipeline não é determinístico e o instalador/preflight aborta. Com `npx ... init pi --yes`, o instalador tenta instalar e revalidar as duas deps:

```bash
npm i -g @mariozechner/pi-coding-agent
# extensões obrigatórias:
#   pi-mcp-adapter   → https://github.com/nicobailon/pi-mcp-adapter (MCP)
#   pi-subagents     → subagentes isolados
```

Depois instale o catálogo from-source [`hosts/pi/`](hosts/pi/) com o helper (1 comando; idempotente para **atualizar**):

```bash
/caminho/para/atlas-workflow/build/install-host.sh pi .   # instala/atualiza na raiz do projeto
# ou manual (inclui dotfiles .mcp.json e .pi/):
cp -R /caminho/para/atlas-workflow/hosts/pi/. ./
```

O **`.mcp.json`** (no root, descoberto pelo `pi-mcp-adapter`) registra o server `atlas-workflow` (`env.ATLAS_HOST=pi`); o subagente `atlas-task-validator` fica em **`.pi/agents/`** (descoberto pelo `pi-subagents`). O `args` do server é **relativo** (`atlas/packages/mcp-server/server.js`) — o `pi-mcp-adapter` deve lançar `node` com **cwd na raiz**. As tools chegam **proxiadas e prefixadas** (`atlas_workflow_atlas_ping`, etc.). Confirme a instalação chamando `atlas_ping` (deve retornar `host=pi`) e `atlas_capabilities` — **não** dispare o `atlas-task-validator` à mão: ele roda automaticamente dentro do workflow, com um state file real (`.atlas/state/<run_id>/<slice>.json`), via a tool `subagent({ agent: "atlas-task-validator", task: "<state_path>" })`. Disparar com `<state_path>` literal retorna P1 (input insuficiente).

> **Determinismo (DEC-004):** pi e generic são hosts `must_report` — o orquestrador apura a disponibilidade real de subagente+MCP e a reporta em `host_capabilities` no preflight. Sem report afirmativo, o gate PREREQ falha-fechado (nunca degrada). `atlas_capabilities` expõe `prereq_policy` para o orquestrador saber disso.

### Desinstalar

Rápido (1 comando, via npx — remove só os artefatos do Atlas, preserva config/skills do usuário):

```bash
npx github:pauloborini/atlas-workflow uninstall claudecode   # ou: cursor
npx github:pauloborini/atlas-workflow uninstall codex
npx github:pauloborini/atlas-workflow uninstall opencode      # use --dir <d> se instalou fora do cwd
npx github:pauloborini/atlas-workflow uninstall pi
```

Se instalou com `--global`, desinstale com `--global` (remove de `~/.config/opencode/` ou `~/.pi/agent/`):

```bash
npx github:pauloborini/atlas-workflow uninstall opencode --global
npx github:pauloborini/atlas-workflow uninstall pi --global
```

Manual (equivalente):

```bash
claude plugin uninstall atlas-workflow-orchestrator@atlas-workflow
claude plugin marketplace remove atlas-workflow

codex plugin remove atlas-workflow-orchestrator@atlas-workflow
codex plugin marketplace remove atlas-workflow
```

opencode/pi: o `uninstall` remove `.opencode/atlas` + `agents/atlas-task-validator.md` + skills `atlas-*` + a chave MCP `atlas-workflow` (pi: `atlas/`, `.pi/agents/`, skills `atlas-*`, `.mcp.json`). As deps `pi-mcp-adapter`/`pi-subagents` ficam (uso geral).

## Artefato `.plugin` (opcional)

Alternativa à instalação via GitHub: baixar o `.plugin` do host (`claude`, `codex`, `opencode` ou `pi`) na [release](https://github.com/pauloborini/atlas-workflow/releases) (tags `v*`), validar com `shasum -a 256 -c SHA256SUMS` e instalar pelo fluxo do host. Cursor usa o artefato Claude.

## Como usar

Comando (Claude Code / Cursor): `/workflow <mode> <input-type> [input] [flags]`

No Codex, opencode e pi, invoque a skill do orquestrador com o mesmo padrão de argumentos (ex.: `workflow full backlog-item S05`). O verbo de dispatch do subagente é resolvido por `atlas_capabilities` (host-agnóstico).

### Modos

| Modo | Quando usar | O que faz |
|------|-------------|-----------|
| **`full`** | Sprint/backlog novo ou feature do zero | Gera PRD → valida/entrevista se preciso → **plano** (`.atlas/plans/`) → **executa** o plano → review opcional |
| **`direct`** | PRD já existe e está maduro | Valida PRD → entrevista só se houver gap → **executa direto** (sem fase de plan handoff) → review opcional |
| **`execute`** | Já tenho um `PLAN_*.md` pronto | Reverifica o plano (artefato + conformidade) → **executa o plano existente** → review opcional. **Não regera plano.** Alias: `/workflow plan <PLAN.md>` |
| `interview-only` | Só fechar decisões / brainstorm | Entrevista; não implementa |

**Dica:** `full` = “quero PRD + plano + código”. `direct` = “já tenho PRD aprovado, implementa”. `execute` = “já tenho o plano, só executa”.

> **Roteamento por tipo de input (v0.4.1+):** o tipo do arquivo que você passa **prevalece** sobre o modo digitado. Apontar um `PLAN_*.md` em `direct`/`full` (mesmo renomeado) auto-roteia para `execute` com um aviso de uma linha — nunca gera “plano de plano”. Pedir `execute` sobre um backlog/PRD roteia de volta para `full`/`direct`.

### Input types

- `backlog-item` — ID de sprint ou item (ex.: `S05`)
- `idea` — indicação curta em texto
- `prd` — caminho para `PRD_*.md` existente (principal em **`direct`**)
- `plan` — caminho para `PLAN_*.md` existente (principal em **`execute`**)
- `brainstorm` — texto livre (só com `interview-only`)

### Flags

- `--review` — roda `atlas-slice-review` no final
- `--interview` — força entrevista de PRD mesmo sem ambiguidades detectadas
- `--help` — sintaxe completa

### Exemplos

Feature nova a partir do sprint (pipeline completo):

```
/workflow full backlog-item "S05"
```

PRD já escrito no repo; implementar sem gerar plano separado:

```
/workflow direct prd "./docs/PRD_S05_login.md"
```

Mesmo PRD, com review fria da slice no final:

```
/workflow direct prd "./docs/PRD_S05_login.md" --review
```

Ideia solta, ainda sem PRD formal (gera PRD e segue o fluxo completo):

```
/workflow full idea "cache de sessão com TTL configurável"
```

Plano já escrito; executar direto sem regerar (modo `execute`):

```
/workflow execute plan "./.atlas/plans/PLAN_S05_login.md"
```

Mesma coisa, forma curta (alias de `execute`):

```
/workflow plan "./.atlas/plans/PLAN_S05_login.md"
```

Só alinhar decisões antes de planejar:

```
/workflow interview-only brainstorm "dark mode só no web ou mobile também?"
```

### Dicas práticas

1. Confirme o MCP antes de começar (`atlas_ping`); sem MCP o orquestrador para no pré-flight.
2. Artefatos ficam no projeto consumidor: planos em `.atlas/plans/`, estado em `.atlas/state/<run_id>/`.
3. Em `full`, não espere código antes do `PLAN_*.md` validado — é gate explícito.
4. Ambiguidades no PRD disparam entrevista automaticamente; use `--interview` se quiser forçar.
5. Toda execução passa pelo validador frio (`atlas-task-validator`) antes de declarar a slice pronta.

### Skills da cadeia

`atlas-sprint-prd-generator` → `atlas-prd-interview` → `atlas-plan-handoff` → `atlas-plan-execute` (full) ou `atlas-direct-execute` (direct) → `atlas-task-validator` → `atlas-slice-review` (opcional)

## Estrutura do repo

| Caminho | Conteúdo |
|---------|----------|
| [`packages/`](packages/) | Skills, templates, MCP |
| [`agents/`](agents/) | Subagente `atlas-task-validator` (Claude) |
| [`plugins/atlas-workflow-orchestrator/`](plugins/atlas-workflow-orchestrator/) | Catálogo Codex from-source (marketplace) |
| [`hosts/opencode/`](hosts/opencode/) · [`hosts/pi/`](hosts/pi/) | Catálogos from-source opencode/pi |
| [`plugin-manifests/`](plugin-manifests/) | Manifests/configs por host (claude, codex, opencode, pi) |
| [`build/`](build/) | Gera `.plugin` em `dist/`, sincroniza catálogos, testes/smoke/conformance |
| [`CHANGELOG.md`](CHANGELOG.md) · [`PATCH_PROCEDURE.md`](PATCH_PROCEDURE.md) | Release e manutenção |

Templates canônicos em [`packages/templates/`](packages/templates/) — fonte única no bundle; sem fallback silencioso se faltar arquivo.

## Referências

- Adapters de host: [`host-adapters.md`](packages/orchestrator/references/host-adapters.md)
- MCP: [`packages/mcp-server/`](packages/mcp-server/) (`atlas_ping`, `atlas_run_state`, `atlas_capabilities`)
- Plugin v0.1.10 (rollback): [`archive/v0.1.10/`](archive/v0.1.10/)
