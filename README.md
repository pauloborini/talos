<p align="center">
  <img src="docs/assets/atlas-logo-header-darktheme.png" alt="Atlas Workflow" width="96" height="96">
</p>

# Atlas Workflow

Plugin **Atlas Workflow Orchestrator** v0.11.1 — pipeline determinístico (PRD → plano → execução → validação) com skills `atlas-*`, templates e MCP. Um pacote, sete hosts: **Claude Code**, **Cursor**, **Codex App**, **Antigravity (Gemini)**, **ZCode**, **OpenCode** e **Pi CLI**.

**Versão:** [`VERSION`](VERSION) (`0.11.1`) · **Repo:** https://github.com/pauloborini/atlas-workflow

## Hosts

| Host | Instalação (recomendada) | Artefato release | Deps obrigatórias |
|------|--------------------------|------------------|-------------------|
| Claude Code | Marketplace GitHub | `atlas-workflow-claude.plugin` | — |
| Cursor | **Igual ao Claude Code** (ver nota abaixo) | `atlas-workflow-claude.plugin` | — |
| Codex App | Marketplace GitHub | `atlas-workflow-codex.plugin` | — |
| Antigravity (Gemini) | Instalador from-source (`init antigravity`) → `~/.gemini/config/` | — (cópia direta, sem artefato `.plugin`) | — |
| ZCode | Instalador cache-based (`init zcode`) → `~/.zcode/cli/plugins/cache/` | `atlas-workflow-zcode.plugin` | — |
| Opencode | Catálogo from-source `hosts/opencode/` | `atlas-workflow-opencode.plugin` | — |
| Pi CLI | Catálogo from-source `hosts/pi/` | `atlas-workflow-pi.plugin` | **`pi-mcp-adapter` + `pi-subagents`** |

**Cursor:** não há pacote nem marketplace próprios — o plugin instalado via `claude plugin` no escopo do usuário já vale para o Cursor (mesmo manifest `.claude-plugin/`). Limitação de packaging, não do pipeline.

**Conceito:** todos são *hosts* (onde as skills rodam). O pipeline é o mesmo; diferenças nativas (subagente, todo, MCP, dispatch do validador frio) vivem em [`host-adapters.md`](packages/orchestrator/references/host-adapters.md) e na tool `atlas_capabilities` (contrato `schema_version: 5` — `validator_dispatch` declara `dispatcher` + `join` por host; ver [Topologia do validador frio (G4)](#topologia-do-validador-frio-g4)). Host sem subagente+MCP é **rejeitado no preflight** (gate `PREREQ`, hard-fail); host sem join síncrono do validador é **rejeitado no preflight** (gate `JOIN`, hard-fail) — determinismo > alcance.

**Pré-requisito:** Node.js no host. Após instalar, confirme o MCP com `atlas_ping`.

## Instalação rápida (1 comando, via npx)

> Referência rápida de todos os comandos (instalar/atualizar/remover por host): **[COMMANDS.md](COMMANDS.md)**.

Um instalador único cobre os hosts de forma **global** (recomendado para valer em todos os projetos) — não precisa clonar o repo:

```bash
npx github:pauloborini/atlas-workflow init claudecode   # ou: cursor
npx github:pauloborini/atlas-workflow init codex
npx github:pauloborini/atlas-workflow init antigravity
npx github:pauloborini/atlas-workflow init zcode
npx github:pauloborini/atlas-workflow init opencode --global
npx github:pauloborini/atlas-workflow init pi --global --yes  # --yes auto-instala as 2 deps
```

- **claudecode/cursor**: o instalador roda o `marketplace add` + `install` nativos da CLI por você. Já são globais por natureza.
- **codex**: o instalador roda `marketplace add` + `plugin add` e também copia os custom agents Atlas para `CODEX_HOME/agents` (`~/.codex/agents` se `CODEX_HOME` não estiver definido). Este é o caminho garantido para `spawn_agent(agent_type: "atlas-*")`.
- **antigravity**: o instalador registra o Atlas como um plugin em `~/.gemini/config/plugins/` e adiciona o MCP correspondente em `mcp_config.json`.
- **zcode**: o instalador copia o catálogo from-source `hosts/zcode/` para `~/.zcode/cli/plugins/cache/zcode-plugins-official/atlas-workflow-orchestrator/<version>/` e atualiza o `marketplace.json` cache. Ative no host via `/plugins enable atlas-workflow-orchestrator`. ZCode é Claude Agent SDK (clone estrutural do Claude Code): `Agent(subagent_type)` + `TodoWrite` + MCP stdio nativos — perfil `self_evident`, sem dependências externas.
- **opencode**: com `--global`, instala globalmente em `~/.config/opencode/` (o MCP é registrado com caminho absoluto, funcionando em todos os projetos).
- **pi**: com `--global`, instala globalmente em `~/.pi/agent/` (honra `PI_CODING_AGENT_DIR`), registra o MCP em `mcp.json` global e checa/instala as deps `pi-mcp-adapter` + `pi-subagents`.

No modo `--global` o runtime vai para um local estável (`~/.config/opencode/atlas` ou `~/.pi/agent/atlas`) e o MCP é registrado com **caminho absoluto** (sem depender do cwd). opencode: agente em `~/.config/opencode/agents/`, skills em `~/.config/opencode/skills/`. pi: agente em `~/.agents/` (se existir) ou `~/.pi/agent/agents/`, MCP em `~/.pi/agent/mcp.json`. A config existente é **mesclada** (preserva outros MCP servers e chaves); se houver `opencode.jsonc` com comentários, ele é preservado e o Atlas é registrado no fallback `opencode.json`.

### Instalação por-projeto (opcional / escopo restrito)

Caso prefira limitar a instalação de `opencode` ou `pi` a apenas um projeto específico, execute omitindo a flag `--global`:

```bash
npx github:pauloborini/atlas-workflow init opencode      # no diretório do projeto (.opencode/ + opencode.json)
npx github:pauloborini/atlas-workflow init pi --yes      # no diretório do projeto (.mcp.json + .pi/)
```

Neste caso, os caminhos serão salvos de forma relativa, exigindo que você execute a CLI a partir do diretório raiz onde o Atlas foi inicializado.

Flags úteis: `--global`/`-g` (opencode/pi), `--dir <d>` (alvo por-projeto), `--yes` (auto-deps pi), `--dry-run` (mostra sem alterar), `-h`.

> **Plataformas:** macOS e Linux são suportados (mesmo caminho POSIX). Windows tem suporte por código (spawn das CLIs via shell; root global do opencode em `%APPDATA%\opencode`, ou `XDG_CONFIG_HOME` se definido; pi em `%USERPROFILE%\.pi\agent`) — smoke real do runtime MCP parcialmente validado no Windows; smoke do instalador automatizado (`build/smoke-install.mjs`) roda em Unix. No Windows, defina `XDG_CONFIG_HOME` para forçar o caminho do opencode de forma determinística.
## Instalação manual (alternativa)

Se preferir não usar o `npx` ou necessitar de instalação offline, você pode utilizar os comandos manuais oficiais dos gerenciadores de pacotes nativos de cada host.

### Claude Code e Cursor

```bash
claude plugin marketplace add pauloborini/atlas-workflow
claude plugin install atlas-workflow-orchestrator@atlas-workflow
```

### Codex App

```bash
npx github:pauloborini/atlas-workflow init codex
```

Evite instalar Codex só com `codex plugin add`: o plugin expõe skills/MCP, mas custom agents podem não ser registrados como `agent_type` pelo host. O `init codex` instala ambos.

> Para instruções de instalação manual e de baixo nível em hosts como **opencode** e **pi cli**, consulte o **[COMMANDS.md](COMMANDS.md)**.

### Desinstalar

O desinstalador via `npx` remove apenas os artefatos e agentes do Atlas, preservando as configurações e skills locais do usuário.

Se a instalação foi **global** (padrão recomendado):
```bash
npx github:pauloborini/atlas-workflow uninstall claudecode   # ou: cursor
npx github:pauloborini/atlas-workflow uninstall codex
npx github:pauloborini/atlas-workflow uninstall antigravity
npx github:pauloborini/atlas-workflow uninstall zcode
npx github:pauloborini/atlas-workflow uninstall opencode --global
npx github:pauloborini/atlas-workflow uninstall pi --global
```

Se a instalação foi local **por-projeto**:
```bash
npx github:pauloborini/atlas-workflow uninstall opencode
npx github:pauloborini/atlas-workflow uninstall pi
```

> Para realizar a desinstalação manual (nativa de cada CLI) ou para entender os diretórios afetados, consulte o **[COMMANDS.md](COMMANDS.md)**.

## Artefato `.plugin` (opcional)

Alternativa à instalação via GitHub: baixar o `.plugin` do host (`claude`, `codex`, `opencode`, `pi` ou `zcode`) na [release](https://github.com/pauloborini/atlas-workflow/releases) (tags `v*`), validar com `shasum -a 256 -c SHA256SUMS` e instalar pelo fluxo do host. Cursor usa o artefato Claude.

## Como usar

Comando (Claude Code / Cursor): `/workflow <mode> <input-type> [input] [flags]`

No Codex, Antigravity, opencode, pi e zcode, invoque a skill do orquestrador com o mesmo padrão de argumentos (ex.: `workflow full sprint S05`). O verbo de dispatch do subagente é resolvido por `atlas_capabilities` (host-agnóstico).

Se você quiser começar fora do fluxo principal, as skills listadas abaixo são os atalhos explícitos para backlog, PRD, auditoria, plano, execução e revisão.

### Modos

| Modo | Quando usar | O que faz |
|------|-------------|-----------|
| **`full`** | Sprint/backlog novo ou feature do zero | Gera PRD → valida/entrevista se preciso → **plano** (`.atlas/plans/`) → **executa** o plano → review opcional |
| **`direct`** | PRD já existe e está maduro | Valida PRD → entrevista só se houver gap → **executa direto** (sem fase de plan handoff) → review opcional |
| **`execute`** | Já tenho um `PLAN_*.md` pronto | Reverifica o plano (artefato + conformidade) → **executa o plano existente** → review opcional. **Não regera plano.** Único modo que aceita plano `Source mode: standalone` (sem sprint) — `full`/`direct` exigem sprint na entrada e rejeitam esse plano. |
| `interview-only` | Só fechar decisões / brainstorm | Entrevista; não implementa |
| **`audit`** | Quero diagnóstico sem patch | Audita target/boundary contra regras locais + stack detectada + Ponytail pass; `--handoff` grava `.atlas/plans/PLAN_AUDIT_*.md` sem executar |

**Dica:** `full` = “quero PRD + plano + código”. `direct` = “já tenho PRD aprovado, implementa”. `execute` = “já tenho o plano, só executa”. `audit` = “diagnostica, não corrige”.

> **Roteamento por tipo de input (v0.4.1+):** o tipo do arquivo que você passa **prevalece** sobre o modo digitado. Apontar um `PLAN_*.md` em `direct`/`full` (mesmo renomeado) auto-roteia para `execute` com um aviso de uma linha — nunca gera “plano de plano”. Pedir `execute` sobre um backlog/PRD roteia de volta para `full`/`direct`.

### Input types

- `sprint` — ID de sprint já ancorado no backlog e em sprint file vivo (ex.: `S05`)
- `backlog-item` — alias legado de `sprint`
- `idea` — indicação curta em texto
- `prd` — caminho para `PRD_*.md` existente (principal em **`direct`**)
- `plan` — caminho para `PLAN_*.md` existente (principal em **`execute`**)
- `target` — arquivo/diretório/feature/módulo auditável (só em **`audit`**)
- `brainstorm` — texto livre (só com `interview-only`)

### Flags

- `--review` — roda `atlas-slice-review` no final
- `--interview` — força entrevista de PRD mesmo sem ambiguidades detectadas
- `--help` — sintaxe completa

### Exemplos

Feature nova a partir do sprint (pipeline completo):

```
/workflow full sprint "S05"
```

Sprint já recortada; implementar direto sem gerar plano separado:

```
/workflow direct sprint "S05"
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

Só alinhar decisões antes de planejar:

```
/workflow interview-only brainstorm "dark mode só no web ou mobile também?"
```

PRD avulso (sem sprint/backlog) até execução, sem passar por `full`/`direct`:

```
/workflow interview-only brainstorm "ideia direto de conversa"
→ matura o PRD; campo Sprint file fica "Não aplicável (standalone)"

atlas-plan-handoff (uso direto, fora do /workflow)
→ lê o PRD, detecta source_mode: standalone, escreve PLAN_*.md com Source mode: standalone

/workflow execute plan "./.atlas/plans/PLAN_<ID>_<slug>.md"
→ único modo que aceita plano standalone; full/direct exigem sprint e rejeitam esse plano na entrada
```

### Dicas práticas

1. Confirme o MCP antes de começar (`atlas_ping`); sem MCP o orquestrador para no pré-flight.
2. Artefatos ficam no projeto consumidor: planos em `.atlas/plans/`, estado em `.atlas/state/<run_id>/`.
3. Em `full`, não espere código antes do `PLAN_*.md` validado — é gate explícito.
4. Ambiguidades no PRD disparam entrevista automaticamente; use `--interview` se quiser forçar.
5. Toda execução passa pelo validador frio (`atlas-task-validator`) antes de declarar a slice pronta.

### Skills da cadeia

Cadeia automática de execução: `atlas-sprint-prd-generator` → `atlas-prd-interview` → `atlas-plan-handoff` → `atlas-plan-execute` (full) ou `atlas-direct-execute` (direct) → `atlas-task-validator` → `atlas-findings-repair` (só após `fail`, em qualquer host) → `atlas-slice-review` (opcional)

Modo sem execução: `atlas-audit` roda no fio principal, não altera código, não chama executor e pode gravar handoff Atlas-style em `.atlas/plans/` com `--handoff`.

No modo `full`, as etapas documentais (`PRD`, entrevista, `PLAN_*.md`) ficam no agente principal/orquestrador. O primeiro sub-agent obrigatório nasce só na fase de execução (`atlas-plan-execute`).

### Skills com uso direto

Além da cadeia automática, estas skills também podem ser chamadas diretamente para tarefas específicas. Algumas delas aparecem no fluxo principal em outro contexto, mas vale saber quando usar cada uma:

- `atlas-backlog-generator` — cria `BACKLOG_MESTRE_*.md` a partir de uma conversa, briefing, roadmap ou lista solta de requisitos. Use quando o objetivo for organizar demanda antes de virar PRD.
- `atlas-sprint-prd-generator` — transforma um sprint ID como `S01`/`S02` em PRD de sprint. Use quando o escopo já está amarrado ao roadmap e você quer o PRD da rodada.
- `atlas-prd-interview` — valida e amadurece um PRD antes de planejar. Use quando você quer fechar ambiguidades, dependências ou decisões de produto.
- `atlas-audit` — audita arquivo, diretório, pacote, módulo, feature ou boundary localizável sem corrigir código. Lê regras locais reais, detecta stack por manifests/configs, analisa arquitetura/contratos/erros/segurança/testes/observabilidade, faz Ponytail pass final e só promove achado com evidência `arquivo:linha`. Com `--handoff`, grava `.atlas/plans/PLAN_AUDIT_*.md` TC-conforme para correção posterior; não chama executor.
- `atlas-plan-handoff` — converte um PRD validado em plano executável. Use quando a intenção é preparar a execução, não ainda codar. Aceita PRD `sprint-bound` (com sprint file) ou `standalone` (PRD declara explicitamente `Sprint file: Não aplicável (standalone)`); plano `standalone` só é executável via modo `execute` — `full`/`direct` exigem sprint na entrada.
- `atlas-direct-execute` — executa diretamente quando o PRD já está maduro. Use quando você quer pular a fase de plan handoff.
- `atlas-task-validator` — faz a validação fria da slice executada. Use como veredito final de conformidade, nunca como ação manual de rotina.
- `atlas-findings-repair` — corrige findings P0/P1/P2 depois de um `fail` do validator sem reabrir a execução completa. Use só no caminho de retry.
- `atlas-slice-review` — faz a revisão fria opcional depois da execução. Use quando quiser uma segunda passada focada em riscos e regressões.

### Topologia do validador frio (G4)

O validador frio (`atlas-task-validator`) **sempre** roda isolado e **sempre** como sub-agent irmão (sibling) despachado pelo orquestrador — em todos os hosts, sem exceção. O orquestrador lê `atlas_capabilities.validator_dispatch` em runtime; o `dispatcher` é sempre `orchestrator`. Fluxo único: orquestrador → executor escreve `state_path` e encerra → **validator irmão** lê `state_path` → veredito → orquestrador consome. Você não escolhe à mão.

**Por que sibling em todos os hosts:** o executor sub-agent **não** despacha o validador (evita validar o próprio trabalho e evita depender de o host permitir um sub-agent disparar um neto). Em vez disso, o executor termina ao escrever o `state_path`, e o orquestrador dispara o validator como **irmão isolado**. Hosts sem join síncrono confiável do validador são **rejeitados no preflight** (gate `JOIN`, hard-fail) — não há degradação. Os dois invariantes seguem firmes:

- **G9 (mutação só em sub-agent isolado):** todo código muda dentro do executor isolado — o fio principal nunca edita.
- **G4 (validação fria separada):** o validator é um sub-agent **frio e isolado**, com contexto próprio, irmão do executor e coordenado pelo orquestrador — nunca filho do executor.

**Loop de reparo (sibling):** se o validator retorna `fail` com P0/P1/P2, o orquestrador abre o lock de reparo (`repair_start`), dispara `atlas-findings-repair` com os findings estruturados, fecha com `repair_run_id` e só então roda o **2º e último** validator. `validator_run_id` e `repair_run_id` existem para descartar retornos stale/duplicados. Se o 2º validator ainda falhar, a slice termina em `blocked` — **3º validator é proibido**.

**Proof-of-work (R20, v0.8.0):** ao abrir o slot, `atlas_lock_validator(start)` emite um `challenge` (sha256 de um arquivo do boundary do `state_path`); o validator irmão computa o hash desse arquivo e devolve em `challenge_response`. No `complete`, o MCP recomputa o hash do disco e bloqueia (`challenge_failed`) em divergência/ausência, sem fechar o slot — re-despacho do mesmo validator, **bounded** por attempt (esgotado o teto, fecha terminal `challenge_exhausted`, fail-closed). É atestação **mecânica** de que o veredito leu o boundary; o hash esperado nunca é persistido em estado legível. Não é prova de isolamento não-forjável (o MCP fala stdio com um único caller) — fecha o atalho preguiçoso de afirmar `pass` sem ler código.

**Smoke G9 — critério PASS:** o smoke do Gate G9 exige validator irmão disparado pelo orquestrador (sibling) em todos os hosts. Exigir que o executor dispare o validador (validador aninhado) é leitura errada do contrato.

## Estrutura do repo

| Caminho | Conteúdo |
|---------|----------|
| [`packages/`](packages/) | Skills, templates, MCP |
| [`agents/`](agents/) | Subagentes despachados (Claude): `atlas-task-validator`, `atlas-plan-execute`, `atlas-direct-execute`, `atlas-slice-review` |
| [`plugins/atlas-workflow-orchestrator/`](plugins/atlas-workflow-orchestrator/) | Catálogo Codex from-source (marketplace) |
| [`hosts/opencode/`](hosts/opencode/) · [`hosts/pi/`](hosts/pi/) · [`hosts/zcode/`](hosts/zcode/) | Catálogos from-source opencode/pi/zcode |
| [`plugin-manifests/`](plugin-manifests/) | Manifests/configs por host (claude, codex, opencode, pi, zcode; Antigravity é gerado pelo instalador) |
| [`build/`](build/) | Gera `.plugin` em `dist/`, sincroniza catálogos, testes/smoke/conformance |
| [`CHANGELOG.md`](CHANGELOG.md) · [`PATCH_PROCEDURE.md`](PATCH_PROCEDURE.md) | Release e manutenção |

Templates canônicos em [`packages/templates/`](packages/templates/) — fonte única no bundle; sem fallback silencioso se faltar arquivo.

## Referências

- Adapters de host: [`host-adapters.md`](packages/orchestrator/references/host-adapters.md)
- MCP: [`packages/mcp-server/`](packages/mcp-server/) (`atlas_ping`, `atlas_run_state`, `atlas_capabilities`)
