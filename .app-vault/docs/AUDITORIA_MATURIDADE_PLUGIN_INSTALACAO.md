# Auditoria - maturidade do plugin e instalacao multi-host

Data: 2026-06-04
Atualizado: 2026-06-05
Repo: `atlas-workflow`
Versao auditada: `0.4.0`

## 0. Atualizacao 2026-06-05 (delta desde a auditoria base)

Maturidade revisada: **7.5/10 -> 8.0/10** (subida modesta, justificada por smoke real parcial; nao e 10/10 porque T07/T08 seguem abertos).

Evidencia real nova obtida nesta data (Windows, dentro do repo):

- **opencode real (Windows):** `atlas_ping` -> alive, v0.4.0, stdio, 9 capabilities; `atlas_capabilities(host=opencode)` -> host detectado, schema v2, flags corretas. Prova **boot do MCP + leitura de capabilities** no opencode real. (Ainda **nao** provado: descoberta/dispatch de agente e skills.)
- **pi real (Windows):** `atlas_ping` respondeu via tools **prefixadas** `atlas_workflow_*` -> prova o **`pi-mcp-adapter` vivo e proxiando**; `atlas_capabilities` retornou `host: pi` via `detected_via: env:ATLAS_HOST` -> deteccao deterministica confirmada no pi real. (Ainda **nao** provado: `pi-subagents` / dispatch de subagente.)
- **Windows (parcial):** os dois smokes acima rodaram em Windows (`state_dir: .atlas\state`) -> primeira evidencia real do **runtime MCP** funcionando no Windows. (Ainda **nao** provado no Windows: caminho do instalador `npx`, claude/codex, install/uninstall.)

Correcao de capability aplicada e verificada no host real:

- **opencode `todo_available`: `false` -> `true`** (`todo_tool: 'todowrite'`). O opencode expoe `todowrite` builtin (doc oficial; `todoread` fundido em `todowrite` em mar/2026). Confirmado por smoke real no opencode (`todo` agora aparece disponivel). Fonte canonica `packages/mcp-server/server.js` + 3 copias de host/plugin sincronizadas + teste + `host-adapters.md` atualizados. Guards verdes (testes 30/30, check-consistency, conformance, smoke-hosts).
- **pi `todo_available`: mantido `false` (correto por design).** Verificado contra doc oficial do pi: o core e minimalista e **nao tem todo nativo** ("intentionally does not include ... to-dos"); todo so existe via extensao externa (`pi-todotools`). Logo `todo_tool: null` esta certo, nao e stale.

O que ainda **nao** mudou (bloqueios principais seguem): smoke real de **dispatch** (validator no opencode, `subagent` no pi), smoke de **claude/codex** reais, matriz **OS** completa (macOS/Linux full + Windows do instalador), e os achados P1/P2 de instalacao (stale em update, `pi --yes` sem checar retorno, JSONC opencode, snippets Raycast).

## 1. Veredito executivo

Maturidade geral: **8.0/10** (era 7.5/10 na auditoria base 2026-06-04; ver secao 0).

Estado: **bom para uso controlado/dev**, ainda **nao perfeito para release publico cross-platform**.

O plugin evoluiu bem:

- bundle multi-host existe;
- instalador unico `npx github:pauloborini/atlas-workflow init <host>` existe;
- uninstall existe;
- opencode/pi tem modo por-projeto e global;
- MCP detecta `claude`, `codex`, `opencode`, `pi`, `generic`;
- gates de determinismo estao cobertos por testes locais;
- `build/test-all.sh` esta verde.

Mas a promessa "instala perfeito em Windows/macOS/Linux, em cada CLI" ainda nao esta fechada. Falta smoke real nas CLIs/OS, ha docs/snippets stale, e ha riscos de update parcial/stale em opencode/pi.

## 2. Evidencia rodada nesta auditoria

Comandos executados:

```bash
rtk node build/check-consistency.mjs
rtk node build/smoke-hosts.mjs
rtk node --test packages/mcp-server/server.test.js
rtk bash build/test-all.sh
rtk node build/cli/atlas-init.mjs init opencode --dry-run
rtk node build/cli/atlas-init.mjs init opencode --global --dry-run
rtk node build/cli/atlas-init.mjs init pi --dry-run
rtk node build/cli/atlas-init.mjs init pi --global --dry-run
rtk node build/cli/atlas-init.mjs init opencode --dir <tmp>/opencode
rtk node build/cli/atlas-init.mjs init pi --dir <tmp>/pi
rtk node build/cli/atlas-init.mjs uninstall opencode --dir <tmp>/opencode
rtk node build/cli/atlas-init.mjs uninstall pi --dir <tmp>/pi
```

Resultados:

- `check-consistency`: **ok**
- `smoke-hosts`: **ok**
- `node --test`: **30/30 pass**
- `build/test-all.sh`: **ok**
- dry-run opencode/pi local/global: **ok**
- install/uninstall real em tmp para opencode/pi: **ok**

Validado depois da auditoria base (2026-06-05, ver secao 0):

- opencode real: MCP boot + `atlas_ping` + `atlas_capabilities` (ainda falta agente/skills/dispatch);
- pi real: `pi-mcp-adapter` vivo (tools prefixadas) + `atlas_ping` + `atlas_capabilities` deteccao por env (ainda falta `pi-subagents`/dispatch);
- Windows: runtime MCP de opencode e pi (ainda falta instalador `npx`, claude/codex, install/uninstall).

Nao validado nesta auditoria:

- Claude Code real instalando via `claude plugin`;
- Codex real instalando via `codex plugin`;
- opencode real lendo `.opencode/agents` e skills, e dispatch do validator;
- pi real carregando `pi-subagents` e disparando `subagent`;
- Windows real no caminho do instalador (`npx`, install/uninstall, claude/codex);
- Linux real;
- instalacao por `npx github:...` baixando do GitHub remoto;
- comportamento dos apps desktop quando CLI/plugin atualiza.

## 3. Matriz de maturidade por host

| Host | Instalador atual | Maturidade | Bloqueio para "perfeito" |
|---|---|---:|---|
| Claude Code | `npx ... init claudecode`; por baixo roda `claude plugin marketplace add` + `claude plugin install` | 8/10 | smoke real + confirmar Cursor/Desktop + atualizar docs de 1 comando nativo |
| Cursor | alias de Claude; mesmo plugin `.claude-plugin` | 7/10 | confirmar empiricamente que Cursor ve plugin apos install/reload |
| Codex | `npx ... init codex`; por baixo roda `codex plugin marketplace add` + `codex plugin add` | 8/10 | smoke real no Codex App/CLI + alinhar snippet Raycast stale |
| opencode | copia catalogo `hosts/opencode`; local/global; merge MCP | 7.5/10 | smoke real **parcial OK** (ping+capabilities, Windows); falta dispatch validator/skills + JSONC + update sem stale |
| pi | copia catalogo `hosts/pi`; local/global; deps externas | 7/10 | smoke real **parcial OK** (`pi-mcp-adapter` vivo, ping+capabilities, Windows); falta `pi-subagents`/dispatch + falha se `pi install` falhar + update sem stale |

## 4. Estado dos comandos de instalacao

### 4.1 Comando unico via npx

Existe e esta bem encaminhado:

```bash
npx github:pauloborini/atlas-workflow init claudecode
npx github:pauloborini/atlas-workflow init cursor
npx github:pauloborini/atlas-workflow init codex
npx github:pauloborini/atlas-workflow init opencode
npx github:pauloborini/atlas-workflow init pi --yes
```

Esse e o melhor caminho publico hoje.

Ponto honesto: isso e **um comando shell via npx**, nao necessariamente "um comando nativo dentro de cada CLI". Claude/Codex ainda exigem 2 chamadas nativas por baixo.

Se o requisito for "usuario cola uma linha e funciona", ok.
Se o requisito for "cada CLI tem comando nativo Atlas de 1 passo", ainda nao.

### 4.2 Claude Code / Cursor

Atual:

```bash
claude plugin marketplace add pauloborini/atlas-workflow
claude plugin install atlas-workflow-orchestrator@atlas-workflow
```

Wrapper:

```bash
npx github:pauloborini/atlas-workflow init claudecode
npx github:pauloborini/atlas-workflow init cursor
```

Risco:

- `cursor` e alias para Claude. Correto conceitualmente, mas precisa smoke real no Cursor.
- README diz Cursor usa mesmo plugin. Sem smoke real, ainda e premissa operacional.
- Instalador nao instala Claude Code/Claude Desktop/Cursor. Ele exige `claude` no PATH.

### 4.3 Codex

Atual:

```bash
codex plugin marketplace add pauloborini/atlas-workflow
codex plugin add atlas-workflow-orchestrator@atlas-workflow
```

Wrapper:

```bash
npx github:pauloborini/atlas-workflow init codex
```

Risco:

- `raycast/atlas-workflow-snippets.json` ainda tem snippet `!aw-codex` com apenas `codex plugin marketplace add ...`; falta `codex plugin add ...`.
- `!aw-install-all` tambem instala Codex parcialmente.
- Precisa smoke real no Codex App/CLI.

### 4.4 opencode

Atual:

```bash
npx github:pauloborini/atlas-workflow init opencode
npx github:pauloborini/atlas-workflow init opencode --global
```

Comportamento:

- por-projeto: copia `.opencode/`, gera/mescla `opencode.json`;
- global: copia runtime para config global e usa caminho absoluto no MCP;
- preserva outros MCPs;
- aborta se config existente for JSON invalido.

Riscos:

- `opencode.jsonc` com comentarios aborta, porque o parser usa `JSON.parse`. Como opencode aceita JSONC, isso pode virar friccao real.
- update por `fs.cpSync(..., recursive: true)` nao remove arquivos antigos removidos do bundle; pode deixar stale.
- smoke atual simula MCP por env; nao prova que opencode descobre agente/skills.

### 4.5 pi

Atual:

```bash
npx github:pauloborini/atlas-workflow init pi --yes
npx github:pauloborini/atlas-workflow init pi --global --yes
```

Comportamento:

- por-projeto: copia `atlas/`, `skills/`, `.pi/agents/`, mescla `.mcp.json`;
- global: copia runtime para `~/.pi/agent/atlas`, agente em `~/.agents` ou `~/.pi/agent/agents`, MCP em `~/.pi/agent/mcp.json`;
- detecta deps `pi-mcp-adapter` e `pi-subagents`;
- com `--yes`, tenta instalar deps faltantes.

Riscos:

- se `pi install npm:<dep>` falhar, o instalador nao checa retorno. Pode imprimir fluxo como se tivesse avancado.
- update pode deixar stale.
- pi e host `must_report`; sem smoke real das extensoes, nao da para declarar determinismo ponta-a-ponta.

## 5. Matriz por sistema operacional

| OS | Estado por codigo | Estado validado | Risco |
|---|---|---|---|
| macOS | suportado | parcialmente validado nesta maquina | baixo/medio |
| Linux | suportado por paths POSIX | nao validado nesta auditoria | medio |
| Windows | suporte implementado (`shell:true`, `%APPDATA%`, `%USERPROFILE%`) | runtime MCP parcialmente validado (opencode+pi: ping+capabilities); instalador `npx`/claude/codex nao validado | medio/alto |

Windows precisa matriz real:

- PowerShell;
- `cmd.exe`;
- path com espaco;
- `APPDATA` definido;
- `XDG_CONFIG_HOME` definido;
- CLI npm shims `.cmd`;
- `npx github:...`;
- opencode global;
- pi global;
- uninstall.

## 6. Achados

### P1 - Windows ainda nao pode ser declarado perfeito

Codigo tem suporte, mas sem smoke real. Para release publico, "suporte por codigo" nao basta.

Impacto: instalador pode quebrar em shell quoting, path com espaco, shims `.cmd`, permissao de config.

Correcao: criar CI/manual matrix Windows antes do release.

### P1 - opencode/pi update pode deixar arquivos stale

`fs.cpSync(..., recursive: true)` sobre destino existente atualiza/adiciona, mas nao garante remocao de arquivos removidos do bundle.

Impacto: skill/agente antigo pode continuar existindo e contaminar comportamento.

Correcao: em update, remover apenas areas Atlas controladas antes de copiar:

- opencode: `.opencode/atlas`, `.opencode/agents/atlas-task-validator.md`, `.opencode/skills/atlas-*`;
- pi: `atlas`, `.pi/agents/atlas-task-validator.md`, `skills/atlas-*`;
- global equivalente.

### P1 - `pi --yes` nao falha se instalacao de dep falhar

Instalador chama `run('pi', ['install', ...])`, mas nao valida status.

Impacto: usuario acha que deps foram instaladas; preflight depois falha.

Correcao: checar retorno e abortar com erro acionavel.

### P1 - opencode JSONC real pode bloquear instalacao

Global escolhe `opencode.jsonc` se existir, mas parser e `JSON.parse`.

Impacto: config valida para opencode pode ser tratada como invalida pelo Atlas.

Correcao: suportar JSONC com parser leve ou gravar/mesclar em `opencode.json` quando `.jsonc` tiver comentarios, sem tocar no `.jsonc`.

### P2 - Snippets Raycast estao parcialmente stale

`!aw-codex` so faz marketplace add; nao faz `codex plugin add`.
`!aw-install-all` tambem deixa Codex incompleto.

Impacto: usuario instala "meio plugin".

Correcao: atualizar snippets ou remover ate estabilizar.

### P2 - `build/install-host.sh` esta virando legado/documento misto

README favorece `npx`; `build/install-host.sh` ainda existe para opencode/pi, mas comentario/header tem drift (`agents/`, `mcp.json` vs `.pi/`, `.mcp.json`).

Impacto: confusao em troubleshooting.

Correcao: marcar como legacy/dev helper ou alinhar texto.

### P2 - `--dir` sem valor nao falha explicitamente

Se `--dir` vier sem argumento, o target cai para cwd.

Impacto: instalacao no lugar errado.

Correcao: validar `--dir` exige valor e que valor nao seja outra flag.

### P2 - Promessa "apps instalam junto" precisa linguagem precisa

Atlas nao instala Claude Desktop, Claude Code, Cursor, Codex App, opencode ou pi. Ele chama CLIs existentes.

Impacto: expectativa errada do usuario final.

Correcao: docs: "pre-requisito: CLI/app ja instalado e no PATH"; "o plugin pode ficar disponivel no app que compartilha o registro da CLI".

## 7. Plano de fechamento para release-grade

## Metadados de execucao

- Plan prefix: `atlas`
- Execution mode: `sequencial (T01->T08)`
- Executor skill: `atlas-plan-execute`
- Internal validator: `atlas-task-validator`
- External review: `atlas-slice-review` opcional

#### T01. Endurecer update idempotente

- Objetivo: remover stale controlado antes de copiar bundle.
- Arquivos-alvo: `build/cli/atlas-init.mjs`, `build/install-host.sh`.
- Done: update reexecutado nao deixa arquivo Atlas antigo.
- Validacao: install vA fake -> update vB fake -> `find` sem stale.

#### T02. Falhar `pi --yes` quando dep falhar

- Objetivo: erro real se `pi install npm:<dep>` retornar != 0.
- Arquivo-alvo: `build/cli/atlas-init.mjs`.
- Done: falha aborta com mensagem e exit != 0.
- Validacao: teste com `PATH` sandbox/mock `pi`.

#### T03. Suportar ou contornar JSONC do opencode

- Objetivo: nao bloquear config valida do opencode.
- Arquivo-alvo: `build/cli/atlas-init.mjs`.
- Done: `.jsonc` com comentario nao e corrompido; MCP Atlas fica registravel.
- Validacao: fixture `.jsonc` com comentarios.

#### T04. Corrigir docs/snippets

- Objetivo: nenhum comando incompleto.
- Arquivos-alvo: `README.md`, `COMMANDS.md`, `raycast/atlas-workflow-snippets.json`, `build/install-host.sh`.
- Done: Codex sempre inclui `plugin add`; texto de app/CLI preciso.
- Validacao: grep por comandos antigos incompletos.

#### T05. Testar parser de argumentos

- Objetivo: `--dir` sem valor, flag desconhecida e host invalido falham limpo.
- Arquivo-alvo: `build/cli/atlas-init.mjs`.
- Done: CLI nao instala no cwd por acidente.
- Validacao: testes Node com subprocesso.

#### T06. Criar matriz de smoke local automatizada

- Objetivo: validar install/uninstall em tmp para opencode/pi, local/global com HOME sandbox.
- Arquivos-alvo: `build/smoke-install.mjs` ou extender `build/test-all.sh`.
- Done: `build/test-all.sh` cobre materializacao real, nao so MCP.
- Validacao: suite verde.

#### T07. Smoke real por host (parcial - 2026-06-05)

- Objetivo: provar runtime em CLIs reais.
- Alvos:
  - Claude Code: install + `atlas_ping` + validator dispatch; **[pendente]**
  - Cursor: reload/visibilidade; **[pendente]**
  - Codex: install + MCP + skill; **[pendente]**
  - opencode: agent list/tool MCP; **[parcial: `atlas_ping` + `atlas_capabilities` OK no Windows; falta agent list + dispatch validator]**
  - pi: tools prefixadas + `subagent`. **[parcial: tools prefixadas `atlas_workflow_*` + `atlas_ping` + `atlas_capabilities` OK no Windows (prova `pi-mcp-adapter`); falta `subagent` via `pi-subagents`]**
- Done: evidence log por host.

#### T08. Smoke OS

- Objetivo: macOS/Linux/Windows.
- Done: matriz preenchida com versao de Node, CLI, shell e resultado.
- Gate: nao declarar "Windows suportado" sem Windows real.

## 8. Go/No-Go

Go para uso interno controlado: **sim**.

Go para publicar como "instalacao perfeita cross-platform": **nao ainda**.

Go para publicar como beta publico honesto: **sim**, se docs disserem:

- macOS validado parcialmente;
- Linux/Windows pendentes de smoke real;
- opencode/pi dependem de extensoes/host real;
- `npx` e caminho recomendado;
- `atlas_ping` e gate obrigatorios pos-install.

## 9. Criterio objetivo de maturidade 10/10

So declarar 10/10 quando:

- `build/test-all.sh` incluir install/uninstall tmp local/global;
- Claude/Codex/opencode/pi tiverem smoke real documentado;
- Windows/macOS/Linux tiverem smoke real;
- snippets e docs sem comando incompleto;
- update nao deixar stale;
- `pi --yes` falhar corretamente;
- JSONC opencode tratado sem corromper config;
- release tag publica instalada via `npx github:pauloborini/atlas-workflow` sem branch fix.
