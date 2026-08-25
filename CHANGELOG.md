# Changelog

## Unreleased

Tipo: **adapter-only**. **Sem breaking**. Schema MCP: v5 (inalterado). Disco: v3 (inalterado). Motor (gates, state machine, executor, validator, repair, skills): **intocado**.

Resumo: nono host do Talos — **Mavis (MiniMax Code)** — integrado como Plugin V1 do Mavis. Cada subagente Talos vira um custom agent Mavis (system_prompt derivado de `agents/<talos-*.md>`); MCP stdio injetado via `servers.mcp.json` com `TALOS_HOST=mavis`. Adição é puramente adapter: nova entrada `mavis` em `HOST_ADAPTERS`, linha na matriz de `host-adapters.md`, case no `smoke-hosts.mjs` e branch no `install-host.sh`. Sem mudança em `HOST_DETECTORS` (o override `env:TALOS_HOST` já cobria o caminho) nem em gates (PREREQ/JOIN/DISPATCH herdam do perfil `self_evident` + `dispatch_capability: "mutable"`, confirmados pelo smoke).

Mudanças:
- **`packages/mcp-server/server.js`** — entrada `mavis` em `HOST_ADAPTERS` (após `vscode`, antes de `generic`): `subagent_dispatch.mechanism = "task({ agent_name }) / mavis session send"`, `validator_dispatch.join.sync = "self_evident"` (task foreground bloqueante), `question_prompt.mechanism = "ask_user"` (1–4 steps), `todo_tool = "todowrite"`, `hooks.supported = false` (Plugin V1 do Mavis não suporta hooks), `capabilities_flags = { subagent_available: true, mcp_available: true, todo_available: true }`, `prereq_policy = "self_evident"`, `dispatch_capability = "mutable"`. Sem tocar no motor (gates, preflight, run state, slice ledger, validator lock, checkpoint state, schema de tools).
- **`packages/orchestrator/references/host-adapters.md`** — linha de detecção `env:TALOS_HOST=mavis`; nova coluna `mavis (MiniMax Code)` na matriz principal com todos os 12 concerns (disparo, registro, topologia, fallback, join, dispatch_capability, todo, interview, config MCP, deps, run state, plan paths); mecanismo `ask_user` listado na linha 61.
- **`build/smoke-hosts.mjs`** — case `mavis (TALOS_HOST via servers.mcp.json)` no array `CASES` (env `{ TALOS_HOST: 'mavis' }`, host `mavis`, via `env:TALOS_HOST`, join_sync `self_evident`).
- **`build/install-host.sh`** — case `mavis` no switch; novo bloco no final gera o Plugin V1 em `~/.minimax/plugins/talos/` (`.minimax-plugin/plugin.json` + `servers.mcp.json` + `skills/<talos-*>/SKILL.md` copiados de `packages/skills/`) e cria 5 custom agents em `~/.minimax/agents/talos-<name>/config.yaml` (system_prompt = corpo de `agents/<talos-<name>.md`).
- **`AGENTS.md`** — "Oito hosts" → "Nove hosts" com parágrafo sobre Mavis (Plugin V1 + 5 custom agents + `TALOS_HOST=mavis`).

Impacto:
- Demais hosts (claude, codex, cursor, antigravity, opencode, pi, zcode, vscode, generic) **sem mudança de comportamento** — a entrada nova é aditiva no objeto `HOST_ADAPTERS` e o `detectHost` continua resolvendo via `HOST_ADAPTERS[override]`.
- Quem instalar Mavis ganha um nono host: packager único (`build/install-host.sh mavis`) materializa Plugin V1 + 5 custom agents em `~/.minimax/`; re-scan do Mavis descobre o plugin automaticamente; `talos_ping` confirma boot; `talos_capabilities` lista `mavis` em `known_hosts`.
- Sem migração de disco/pipeline; state v3, schema MCP v5, gates G1–G12, topologia sibling, e conjunto de tools inalterados.

Arquivos/artefatos:
- `packages/mcp-server/server.js` (entrada `mavis` em `HOST_ADAPTERS`).
- `packages/orchestrator/references/host-adapters.md` (linha de detecção + coluna na matriz + linha 61).
- `build/smoke-hosts.mjs` (case novo no CASES).
- `build/install-host.sh` (case `mavis` + bloco do Plugin V1).
- `AGENTS.md` (parágrafo do nono host).
- `CHANGELOG.md` (esta entrada).

Validação:
- `node build/smoke-hosts.mjs` — ok (9 hosts × boot + detecção + capabilities + ping, incluindo Mavis).
- Bump `VERSION` + release do `0.18.2` pendente de validação end-to-end no Mavis (instalação real + dispatch de subagente + preflight reportando `dispatch_mutable: true`).

## 0.18.1 - 2026-08-24

Tipo: **packaging**. **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: corrige dois modos de instalação que ficavam com o plugin "instalado" e morto. (1) **zcode via npx**: `talos init zcode` copiava o pacote npm inteiro para `~/.zcode/cli/plugins/cache/talos/talos/<versão>/` e contava com `.claude-plugin/plugin.json` na raiz — mas o tarball npm exclui `.claude-plugin/` (`.npmignore`); o cache ficava sem NENHUM manifest e a descoberta do host não resolvia skill, agente ou MCP nenhum. Agora o cache é materializado do catálogo `hosts/zcode/` — mesmo layout de `dist/talos-zcode.plugin`: `.zcode-plugin/plugin.json` NA RAIZ + `agents/` + `skills/` + `packages/`, MCP via `${ZCODE_PLUGIN_ROOT}`. (2) **Cursor/Grok (manifesto Claude compartilhado)**: o bootstrap do MCP introduzido na 0.18.0 dependia de `CLAUDE_PLUGIN_ROOT` no ENV do spawn, que esses hosts não injetam (e nem expandem o placeholder no argv) — `talos-mcp: run.sh não encontrado` + `Connection closed` no log. O bootstrap agora varre os caches conhecidos do Talos (`~/.cursor`, `~/.zcode`, `~/.claude` — marketplace e cache — e os legados `/home/box`), escolhendo a instalação mais recente (`-nt`), e falha com mensagem acionável quando nada é encontrado. Sem mudança de runtime MCP, schema v5, gates ou topologia sibling.

Mudanças:
- **`build/cli/talos-init.mjs`** — `copyZcodePluginToCache` copia `hosts/zcode/` para o cache (fail-cedo se o catálogo não existe; assert pós-cópia exige `.zcode-plugin/plugin.json` na raiz) em vez de copiar ROOT inteiro; `ensureZcodeRootMarketplaceJson` loga aviso quando `.claude-plugin/marketplace.json` não está presente (modo npx — o host regenera o `marketplace.json` raiz no refresh do catálogo, source git).
- **`.claude-plugin/plugin.json` + `plugin-manifests/claude/plugin.json`** — bootstrap `-c` do MCP ganha varredura newest-wins pelos caches conhecidos (`$HOME/.cursor|zcode|claude/...`) após as sondas de env/PWD; mensagem de falha final diz o que fazer ("atualize/reinstale o Talos neste host").
- **`build/smoke-install.mjs`** — asserções zcode migradas para o contrato novo: manifest `.zcode-plugin/plugin.json` na raiz do cache, `skills === './skills/'`, args MCP referenciando `${ZCODE_PLUGIN_ROOT}`, e presença de `packages/mcp-server/server.js`, `skills/talos/SKILL.md` e `agents/talos-task-validator.md`.
- **`packages/mcp-server/run.test.mjs`** — 4 testes novos: bootstrap resolve `run.sh` do cache mais recente sem nenhuma env de plugin (para `.claude-plugin` e template) e falha com status 1 + mensagem acionável em HOME vazio.

Impacto:
- **zcode**: quem instalou/atualizou para a 0.18.0 via `npx ... init zcode` ficou com registros ok e componentes ausentes — reinstalar com `npx github:pauloborini/talos init zcode` (0.18.1) e reiniciar o host resolve; install por UI não exige ação além do upgrade.
- **Cursor/Grok**: com o plugin apontando para o repositório atualizado, recarregar o host sobe o MCP via cache existente; sem cache nenhum, a nova mensagem indica reinstall.
- Sem migração de disco/pipeline; state v3 e contrato das tools inalterados; demais hosts (claude, codex, antigravity, opencode, pi, vscode) sem mudança de comportamento.

Arquivos/artefatos:
- `VERSION` → `0.18.1`; `package.json`; `packages/mcp-server/package.json`; `.claude-plugin/plugin.json`; manifests/READMEs concretos; `CHANGELOG.md`; `packages/orchestrator/README.md`; `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin` + `SHA256SUMS`; catálogos `hosts/{opencode,pi,zcode,vscode}/` e `plugins/talos/`.

Validação:
- `node --test packages/mcp-server/server.test.js` — ok (311/311); `node --test packages/mcp-server/run.test.mjs` — ok (11/11, inclui os 4 novos).
- `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs` — ok (29/29); `node --test build/check-consistency.guard.test.mjs` — ok (6/6).
- `node build/smoke-install.mjs` — ok (contrato novo do cache zcode coberto); `node build/smoke-hosts.mjs` — ok; `node build/conformance-matrix.mjs` — ok (6 hosts × 10 cenários).
- `shasum -a 256 -c dist/SHA256SUMS` — ok (6 artefatos); `unzip -t` dos 6 `.plugin` — ok.
- `claude plugin validate ./ --strict` — ok.
- Simulação do spawn Cursor (cwd neutro + env sem `*PLUGIN_ROOT*`) contra os caches reais da máquina: server responde `initialize` via varredura de cache.
- §8 reforçado: `npm pack` + `init zcode` executado a partir do tarball extraído com HOME sandbox — cache com manifest na raiz.

## 0.18.0 - 2026-08-21

Tipo: **runtime**. **Com breaking de procedimento** (writer do JSON de slice deixa de ser a LLM). Schema MCP: v5 (inalterado). Disco do state: v3 (inalterado).

Resumo: onda 1 da trilha enxugar-state. O executor/repair deixa de montar e escrever `.talos/state/<run_id>/<slice>.json` — o único writer do slice vira o MCP via `talos_commit_state` (julgamento curto `proofs[]`/`repair[]`, projeção dos mapas v3, escrita atômica tmp+rename, sha no ledger). G12 público encolhe para `first_write` + commit (7 checkpoints mortos bloqueados). `talos_lock_validator(start)` passa a comparar o sha do disco com o último commit MCP daquele path — JSON de slice escrito à mão (órfão/dual-writer) é bloqueado. Skills `talos-plan-execute`/`talos-direct-execute`/`talos-findings-repair` e o orquestrador G12 reescritos para o fluxo onda 1. `build/check-consistency.mjs` ganha os guards DR01–04 (fail se skill de execução, canônica ou espelho `hosts/`/`plugins/`, reensinar schema/Write/checkpoints mortos/`acceptance_results`). Release `0.18.0` sincroniza `packages/` + `hosts/` + `plugins/talos/` no mesmo bump.

Mudanças:
- **`packages/mcp-server/server.js`** — tool nova `talos_commit_state` (G12/D1): valida payload (`additionalProperties: false`; campos projetados como `acceptance_results`, `worktree_*`, `role` → `-32602`), infere role pelo lock (execute/repair; pref = onda 3 bloqueado), projeta o state v3 completo a partir de proofs+git+ledger (`proof_refs`/`eval_results`/`task_evidence`/`check_table`/`validation_map`/`repair_evidence`, `files: []` sem `files`), escreve atômico e devolve `state_path` + `state_sha256`; `startDispatch` grava `base_sha = git rev-parse HEAD`; `checkpointDispatch` só aceita `first_write` (demais events → `checkpoint_desconhecido`); `statusDispatch` deixa de usar `checkpoints.length === 0` como único critério de stalled (bootstrap 120s: stalled só se nem `first_write` nem commit); `validatorStart` recusa órfão por sha.
- **`packages/mcp-server/server.test.js`** — suíte 308 testes (inclui commits, G12, órfão, DR*, superfície de tools); helper `lockValidator` deixa de forjar `state_path_created`.
- **`packages/skills/talos-plan-execute/SKILL.md`, `talos-direct-execute/SKILL.md`, `talos-findings-repair/SKILL.md`, `packages/orchestrator/skills/talos/SKILL.md`** — procedimento onda 1: `first_write` (se mutar) → trabalho → `talos_commit_state` → handoff com `state_path` do retorno; sem blob/7 events; repair/direct no mesmo verbo.
- **`build/check-consistency.mjs` + `build/dr-guard.mjs` (novo)** — guards DR01–04 (CN7) com allowlist do design spec §6.1; mensagem cita o DR*.
- **`build/check-consistency.guard.test.mjs` (novo)** — prova do guard com fixtures em temp + skills canônicas/espelhos reais (AC-3.1.1).
- **`build/bump-version.mjs` + `build/build-plugins.sh`** — bump `0.17.2 → 0.18.0` regenera `dist/` + `plugins/talos/` + `hosts/{opencode,pi,vscode,zcode}/` no mesmo comando; espelhos nunca editados à mão (D14).
- **`CHANGELOG.md`, `packages/orchestrator/README.md`** — entrada 0.18.0 e Novidades v0.18.0.

Impacto:
- Executor/repair em slice real: chamar `talos_commit_state` e usar `state_path` do retorno; sem Write/editor no JSON de slice; JSON escrito à mão não abre o validator frio.
- Guard `check-consistency` passa a falhar se qualquer skill de execução (ou espelho) reensinar âncoras mortas.
- Instalação 0.18 não serve skill 0.17 de Write+teatro; disco permanece v3 (sem v4).

Arquivos/artefatos:
- `VERSION` → `0.18.0`; `package.json`; `packages/mcp-server/package.json`; `.claude-plugin/plugin.json`; manifests/READMEs concretos; `CHANGELOG.md`; `packages/orchestrator/README.md`; `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin` + `SHA256SUMS`; catálogos `hosts/{opencode,pi,zcode,vscode}/` e `plugins/talos/`.

Validação:
- `node --test build/check-consistency.guard.test.mjs` — ok (6/6; red observado com glob não varrido).
- `node --test packages/mcp-server/server.test.js` — ok (308/308; red observado em AC-3.2.2 com pref no G12).
- `node build/check-consistency.mjs` — ok (falhava nos espelhos 0.17.2 antes do bump; verde pós-bump).
- `git diff --check` — ok.
- `claude plugin validate ./ --strict` — ok.

## 0.17.2 - 2026-08-17

Tipo: **packaging**. **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: corrige a instalação do plugin no host ZCode de verdade, migrando o `talos-init zcode` do caminho `zcode-plugins-official` (que não registra MCP de plugin — `mcpServerCount:0` em todas as sessões) para o **fluxo de marketplace** (`talos@talos`), reproduzindo exatamente o que o usuário fez manualmente na UI ("Add Marketplace + Install") e que funciona. O 0.17.1 materializava o data-dir no path `zcode-plugins-official`, o que não mudava o paradigma de instalação e o plugin continuava invisível. Agora `init zcode` instala via marketplace `talos` (git `pauloborini/talos`) e `uninstall zcode` reverte tudo + limpa o legado do caminho quebrado. Sem mudança de runtime MCP, schema v5, gates ou topologia sibling. Os outros 7 hosts não passam pelo problema (Claude/Cursor/Codex usam marketplace nativo do host; opencode/pi/antigravity/vscode escrevem em paths nativos).

Mudanças:
- **`build/cli/talos-init.mjs`** — reescrito o fluxo zcode:
  - **`installZcode` (marketplace-based)** — registra marketplace `talos` em `known_marketplaces.json` (`source:{source:"git",url:"https://github.com/pauloborini/talos.git"}`), copia o catálogo de `ROOT` para `~/.zcode/cli/plugins/marketplaces/talos/` (com `marketplace.json` na raiz gerado de `.claude-plugin/marketplace.json`), copia o plugin para `~/.zcode/cli/plugins/cache/talos/talos/<versão>/` (manifest `.claude-plugin/plugin.json`), grava o registro `talos@talos` em `installed_plugins.json`, cria `data/talos@talos/` vazio (como a UI) e habilita `enabledPlugins["talos@talos"]` no `config.json`.
  - **`uninstallZcode`** — reverte os registros/cache/catálogo/data-dir/enabledPlugins, e limpa o legado `zcode-plugins-official` (data-dir, cache, config entry, marketplace cache entry).
  - **Helpers novos** — `upsertZcodeMarketplace`, `upsertZcodeInstalledPlugin`, `copyZcodeMarketplaceDir`, `copyZcodePluginToCache`, `ensureZcodeRootMarketplaceJson`, `enableZcodePlugin`, `removeZcodeMarketplaceRecords`, `removeZcodeLegacyOfficial`. Sem referências inertes a `mcpServers` no `plugin.json` do zcode host.
- **`build/smoke-install.mjs`** — bloco zcode migrado para o fluxo marketplace: assere `cache/talos/talos/<v>/server.js`, `.claude-plugin/plugin.json`, `marketplaces/talos/marketplace.json`, marketplace `talos` em `known_marketplaces.json`, registro `talos@talos` em `installed_plugins.json`, `enabledPlugins["talos@talos"]`, idempotência (não duplica marketplace/registro) e uninstall + limpeza de legado.
- **`packages/orchestrator/README.md`** — seção "Novidades v0.17.2" documentando o novo fluxo marketplace; propagada aos catálogos `hosts/{opencode,pi,vscode,zcode}/`.

Impacto:
- `npx github:pauloborini/talos init zcode` instala o plugin de forma que o host realmente descobre skills + MCP (id `talos@talos`), como confirmado em instalação real no host zcode.
- `npx github:pauloborini/talos uninstall zcode` remove também o legado do caminho antigo `zcode-plugins-official`, não deixando estado órfão.
- A instalação **sempre** vem do GitHub via `npx` (o comando roda no checkout baixado; o checkout local só serve para dev/validação).

Arquivos/artefatos:
- `VERSION` → `0.17.2`; `package.json`; `.claude-plugin/plugin.json`; `packages/mcp-server/package.json`; manifests/READMEs concretos; `CHANGELOG.md`; `packages/orchestrator/README.md`; `build/cli/talos-init.mjs`; `build/smoke-install.mjs`; `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin` + `SHA256SUMS`; catálogos `hosts/{opencode,pi,zcode,vscode}/` e `plugins/talos/`.

Validação:
- `node build/bump-version.mjs 0.17.2` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node build/smoke-install.mjs` — ok (asserções zcode migradas p/ marketplace; idempotência; uninstall + legado).
- Validação de fim a fim em HOME sandbox (`init zcode` produz estado `talos@talos`; `uninstall zcode` limpa tudo + legado `zcode-plugins-official`).

## 0.17.1 - 2026-08-17

Tipo: **packaging**. **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: instalador zcode agora materializa o data-dir em `init` e o remove em `uninstall`. Corrige o caso em que o host zcode pula a materialização do data-dir (vê a pasta vazia órfã de instalação anterior abortada e considera "já materializado"), deixando o plugin invisível — skills Talos não carregam, MCP `mcp__talos__*` não sobe. O sintoma persistia mesmo após `uninstall zcode` + `init zcode`, porque o uninstall não tocava o data-dir e o install subsequente pulava a cópia. Sem mudança de runtime MCP, schema v5, gates ou topologia sibling. Os outros 7 hosts não passam pelo problema (Claude/Cursor/Codex usam marketplace nativo do host; opencode/pi/antigravity/vscode escrevem em paths nativos sem data-dir separado).

Mudanças:
- **`build/cli/talos-init.mjs` — `materializeZcodeDataDir`** — função nova chamada em `installZcode` após popular o cache. Copia `cache/.../0.17.1/` → `~/.zcode/cli/plugins/data/talos@zcode-plugins-official/` via `fs.cpSync`. Idempotente: pula se o `plugin.json` canônico já existe no data-dir (caso de `init zcode` rodando 2 vezes sem uninstall). Defesa contra tampering: se o data-dir é symlink, resolve o alvo e exige que seja descendente de `~/.zcode/cli/plugins/data/` — fora disso, aborta com mensagem clara.
- **`build/cli/talos-init.mjs` — `removeZcodeDataDir`** — função nova chamada em `uninstallZcode` antes de remover o cache. Espelha a defesa contra symlink. Idempotente (no-op se data-dir ausente).
- **`build/cli/talos-init.mjs` — `zcodeDataDir`** — constante única do path do data-dir (`~/.zcode/cli/plugins/data/talos@zcode-plugins-official/`), compartilhada pelas duas funções acima.
- **`build/smoke-install.mjs`** — 3 asserts novos no bloco "zcode regressão crítica": data-dir populado após init (com `.zcode-plugin/plugin.json` e `packages/mcp-server/server.js`), data-dir populado após 2ª init (idempotência não destrói), data-dir removido após uninstall.

Impacto:
- `npx github:pauloborini/talos init zcode` (e `init all` que detecta zcode) deixa de deixar o plugin invisível em hosts cujo data-dir ficou órfão vazio. Em hosts "limpos" o comportamento é idêntico ao anterior (cache populado, data-dir criado e preenchido, enabledPlugins OK).
- `npx github:pauloborini/talos uninstall zcode` agora remove também o data-dir — uninstall + init subsequente garante estado limpo.
- Defesa contra tampering: symlinks para fora do escopo `~/.zcode/cli/plugins/data/` são rejeitados (não sobrescreve paths arbitrários do usuário).

Arquivos/artefatos:
- `VERSION` → `0.17.1`; `package.json`; `.claude-plugin/plugin.json`; `packages/mcp-server/package.json`; manifests/READMEs concretos regenerados em 26 arquivos; `CHANGELOG.md`; `packages/orchestrator/README.md` (Novidades + Last updated); `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin` + `SHA256SUMS`; catálogos `hosts/{opencode,pi,zcode,vscode}/` e `plugins/talos/` sincronizados.

Validação:
- `node build/bump-version.mjs 0.17.1` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node --test packages/mcp-server/server.test.js` — ok.
- `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs` — ok.
- `node build/smoke-install.mjs` — ok (inclui os 3 asserts novos do data-dir zcode).
- `node build/smoke-hosts.mjs` — ok.
- `node build/conformance-matrix.mjs` — ok.
- `shasum -a 256 -c SHA256SUMS` em `dist/` — ok.
- `unzip -t dist/talos-{claude,codex,opencode,pi}.plugin` — ok.

## 0.17.0 - 2026-08-08

Tipo: **release** (marco). **Sem breaking** no contrato do plugin (schema MCP v5, topologia sibling, gates PREREQ/DISPATCH/JOIN inalterados). **Breaking no histórico do Git**: reescrita via `git filter-repo` mudou todos os hashes de commits e tags. Clones existentes precisam refazer `git clone`.

Resumo: marca a primeira release **pública** do Talos no GitHub. Pré-publicação removeu PII, conteúdo interno, e rastros de versão antiga (archive/v0.1.10, .atlas, .app-work, .argus, atlas-workflow-orchestrator) de todos os commits; o HEAD do main agora é um snapshot limpo de `talos` apenas, sem referências a projetos paralelos ou domínios de email privados.

Mudanças:
- **Higiene pré-publicação (4 commits)**: `git rm --cached` em 75 `references/` órfãos que casavam com `.gitignore`; `git rm` em 2 relatórios internos de smoke (`reports/RELATORIO_PIPELINE_TALOS_S27_PAYTRAINER_2026-06-08.md`, `…S30_S32_…`) com paths absolutos do disco; `git rm -r archive/v0.1.10/` (168 KB, redundante); rename da logo `docs/assets/atlas-logo.png` → `talos-logo.png` (asset binário preservado, nome coerente com a marca).
- **Redaction de PII**: `packages/orchestrator/references/qa_s13_matrix.md` (linha 29: email de conta anterior → `cursor-agent@local`; paths absolutos do disco → `<install>/…`); `NAMING.md:39` (path de disco do autor → `<repo-local-path>/atlas`); `raycast/talos-snippets.json` (6 snippets: path de disco do autor → `<repo-local-path>`).
- **Reescrita de histórico (`git filter-repo`)**: remove de TODOS os commits `references/`, `archive/`, `.app-work/`, `.atlas/`, `.argus/`, `atlas-workflow-orchestrator/`, e cópias legadas de skills (`atlas-*`, `talos-prd-interview`, `talos-sprint-prd-generator`). Tags reescritas (28 tags), pushes via `--force --tags`. `main` atualizado via PR com merge `--admin`. Clone público validado: zero PII no HEAD, zero paths internos.
- **Restauração**: `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` (mandato canônico da revisão fria do backlog, VC2) recuperado e commitado — a exceção do `.gitignore` o cobre.

Impacto:
- Repo agora está pronto para virar público (`gh repo edit --visibility public`).
- Hashes de commits e tags mudaram — quem clonou antes precisa refazer `git clone` (a branch `main` antiga fica acessível via tags anteriores, mas seu conteúdo inclui o que foi removido).
- Distribuição dos bundles: `bump-version 0.16.1 → 0.17.0` regenera `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin` e `dist/SHA256SUMS`; `check-consistency` ok; catálogos `hosts/{opencode,pi,zcode,vscode}/` sincronizados.

Validação:
- `node build/check-consistency.mjs` — ok.
- `claude plugin validate ./ --strict` — passed.
- `git grep` por padrões de PII conhecida (lista de strings fora do escopo deste changelog) no HEAD — zero hits fora deste arquivo. Ver nota 1.

**Nota 1 — redação também no CHANGELOG:** esta release documenta as redações aplicadas; os padrões auditados podem coincidir com este texto. Auditoria final contra o HEAD público deve excluir `CHANGELOG.md` da busca.
- `git ls-tree -r HEAD archive/` e `.atlas/`, `atlas-workflow-orchestrator/` — zero entries.
- Clone em `/tmp/talos-test-clone` (teste de aceitação): 9.3 MB, HEAD limpo, 28 tags.

## 0.16.1 - 2026-08-08

Tipo: **docs** (artefato distribuído). **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: fecha a lacuna de documentação do contrato de adapters — a matriz de `host-adapters.md` passa a listar o 8º host (VS Code), o campo `question_prompt` (entrevista estruturada da v0.16) entra no contrato `talos_capabilities` documentado, e o estado atual de `AGENTS.md`/`CLAUDE.md` ganha a data do release vigente.

Mudanças:
- **`packages/orchestrator/references/host-adapters.md`** — coluna `vscode` na matriz de adapters (`runSubagent`, `manage_todo_list`, perfil `self_evident`, `dispatch_capability: 'mutable'`, config MCP via `.vscode/mcp.json`/`settings.json` com `TALOS_HOST=vscode`); linha de detecção `TALOS_HOST=vscode`; linha de concern "Entrevista estruturada (`question_prompt`)" com o mechanism por host; campo `question_prompt` documentado na tabela do contrato (schema v5 — `{mechanism, mode, max_questions, options_per_question, persistence, resume_after_interview?}`); nota de instalação do vscode; "Status multi-host" com o 8º host. Corrige também a contagem de colunas das linhas finais da matriz (6 → 8 células).
- **`AGENTS.md` / `CLAUDE.md`** — "Estado atual (2026-07)" → "(2026-08)" (release vigente é 0.16.0, de 2026-08-06).
- **Catálogos** — `plugins/talos/**` e `hosts/{opencode,pi,zcode,vscode}/**` regenerados em `0.16.1`; `dist/**` + `SHA256SUMS` regenerados.

Impacto:
- A doc pública de adapters deixa de omitir o host VS Code e o contrato de entrevista estruturada — sem mudança de runtime MCP, gates ou topologia sibling.

Arquivos/artefatos:
- `VERSION` → `0.16.1`; `package.json`; `.claude-plugin/plugin.json`; `packages/mcp-server/package.json`; manifests/READMEs concretos regenerados; `CHANGELOG.md`; `packages/orchestrator/references/host-adapters.md`; `AGENTS.md`; `CLAUDE.md`; `packages/orchestrator/README.md`.

Validação:
- `node build/bump-version.mjs 0.16.1` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node --test packages/mcp-server/server.test.js` — ok (0 fail).
- `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs` — ok (0 fail).
- `node build/smoke-hosts.mjs` — ok (7 hosts + override).
- `node build/conformance-matrix.mjs` — ok (hosts × 10 cenários).
- `shasum -a 256 -c dist/SHA256SUMS` — 6/6 OK; `unzip -t` nos `.plugin` — ok.
- `claude plugin validate ./ --strict` — ok.

## 0.16.0 - 2026-08-06

Tipo: **BREAKING release** (procedência por linha e revisão fria do backlog). Schema MCP: v5 (inalterado). Contrato de execução (G4/DISPATCH/PREREQ/JOIN): preservado.

Resumo: toda decisão e todo critério de aceite passam a declarar **de onde vieram** (`Origem`), a ambiguidade é fechada por entrevista estruturada **antes** de o backlog existir em disco, e a skill de geração de backlog encerra despachando um revisor frio que audita e corrige o que ela própria escreveu. **Artefatos anteriores a 0.16.0 não são suportados (corte seco): iniciar backlog/sprint novo.**

Mudanças (contrato documental):
- **Coluna `Origem` obrigatória na §7.1** do sprint file (`| ID | Decisão | Origem |`) e nas decisões do backlog (`| ID | Decisão | Bloqueia | Dono | Origem | Status |`); schema anterior é recusado com `next_action: 'migrar_para_0_16'`.
- **Campo `origin` obrigatório em cada `AC-*`** do §7.3 (enum `usuario` \| `derivado:<path>` \| `premissa`); ausência é pendência de schema.
- **`premissa` proibida em sprint `Must`/`P0`** — o gate `talos_verify_sprint_file` bloqueia nomeando o `AC-*` e a linha.
- **`derivado:<path>` resolvido contra o disco** — path inexistente recusa a sprint/backlog antes da execução.
- **§4 `Discussão` obrigatória** (sempre, sem detectar origem) — a fonte que o revisor frio usa como oráculo de intenção deixa de ser opcional.
- **Entrevista estruturada no `talos-backlog-generator`** — substitui o texto livre ("até 3 perguntas objetivas"); o rascunho é escaneado em memória (`talos_scan_acceptance` com `sprint_markdown`) e cada resposta vira decisão com `Origem: usuario`.
- **Revisão fria interna à skill** — o passo final lê o mandato de `references/COLD_BACKLOG_REVIEW_PROMPT.md`, despacha um subagente genérico do host por `capabilities.subagent_dispatch` (incondicional, em foreground) e entrega o relatório ao chamador; artefatos corrigidos pelo revisor são regateados pelos gates antes da entrega.

Não entrou (para não gerar expectativa):
- Nenhuma tool MCP nova (16 tools, conjunto inalterado).
- Nenhum gate novo de orquestrador (nenhuma fase nova).
- Nenhum selo de revisão no artefato.

Migração (0.15.x → 0.16.0):
- **Corte seco, sem retrocompatibilidade.** Sprint files sem a coluna `Origem` na §7.1, AC sem `origin` ou §4 sem `Discussão` são rejeitados pelos gates com instrução explícita de reinício (`migrar_para_0_16`). Iniciar backlog e sprint files novos no padrão 0.16.

Impacto:
- Backlog/sprint pré-0.16 são recusados em vez de passarem despercebidos; o gate nomeia a linha que falta.
- O artefato que alimenta o pipeline deixa de ser o único que ninguém revisa: o output da execução é auditado e corrigido por contexto novo.

Arquivos/artefatos:
- `VERSION` → `0.16.0`; `.claude-plugin/plugin.json`; `package.json`; `packages/mcp-server/package.json`; `CHANGELOG.md`; `AGENTS.md`; `CLAUDE.md`; `README.md`; `COMMANDS.md`; `packages/mcp-server/README.md`; `packages/orchestrator/README.md`.
- Templates: `packages/templates/SPRINT_TEMPLATE.md`, `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`.
- `packages/skills/_shared/scripts/document_quality.mjs`, `packages/skills/talos-backlog-generator/` (SKILL.md + `references/COLD_BACKLOG_REVIEW_PROMPT.md`), `packages/mcp-server/server.js`.
- Catálogos: `plugins/talos/**` e `hosts/{opencode,pi,zcode,vscode}/**` regenerados em `0.16.0`; `dist/**` + `SHA256SUMS` regenerados.

Validação:
- `node build/bump-version.mjs 0.16.0` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `bash build/test-all.sh` — OK (287/287 MCP, etapa3 + fixtures §9, smoke-hosts, conformance multi-host, smoke-install, checksums 6/6).
- `claude plugin validate ./ --strict` — ok.

## 0.15.2 - 2026-08-04

Tipo: **docs** (artefato distribuído). **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: alinha a documentação de usuário e do orquestrador ao contrato operacional 0.15 (AC-*, validação manual, critical review, 16 tools MCP); remove copy obsoleto (menu A/B/C, “15 tools”, DEP só-done, G8/G9 invertidos).

Mudanças:
- **`README.md`** — seção “Aceite 0.15 e validação manual”; tabela MCP com `talos_sync_manual_validation`; DEP aceita `manual_validation_pending`; gates G8/G9 alinhados à SKILL; flags audit/`critical_review`; estrutura com `hosts/vscode` e `talos-findings-repair`.
- **`packages/orchestrator/README.md`** — remove lógica A/B/C; fluxos full/direct com review antes do status e fechamento M; skill `talos-memory-promote`.
- **`COMMANDS.md`**, **`commands/talos.md`**, **MCP README** — smoke/sync M; deps `done`|MVP no select/update.
- **Catálogos** — `plugins/talos/**` e `hosts/{opencode,pi,zcode,vscode}/**` regenerados em `0.15.2`.

Impacto:
- Usuário/orquestrador deixam de seguir caminhos pré-0.15 (PRD/checkbox/A-B-C) descritos na doc pública.
- Sem mudança de runtime MCP, gates ou topologia sibling.

Arquivos/artefatos:
- `VERSION` → `0.15.2`; manifests/bundles regenerados; `CHANGELOG.md`; docs listadas acima.

Validação:
- `node build/bump-version.mjs 0.15.2` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node --test packages/mcp-server/server.test.js` — 281/281.
- `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs` — 11/11.
- `node build/smoke-hosts.mjs` — ok.
- `node build/conformance-matrix.mjs` — ok (hosts × 10).
- `shasum -a 256 -c dist/SHA256SUMS` + `unzip -t` nos 6 `.plugin` — ok.
- `npm pack` + `npm exec` tarball (`talos --help` → v0.15.2; `init opencode/codex --dry-run`) — ok.
- `claude plugin validate ./ --strict` — ok.
- `codex plugin validate` — CLI sem subcomando `validate` (registrado).

## 0.15.1 - 2026-08-02

Tipo: **packaging**. **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: instalador detecta cache de marketplace owned por root (EACCES no `claude plugin marketplace add`) e falha cedo com remédio explícito; publica na `main` o linha 0.15.x (origin ainda estava em 0.14.2).

Mudanças:
- **`talos-init`** — `assertMarketplaceCacheWritable` antes de `marketplace add` (Claude/Cursor e Codex); mensagem de falha aponta `sudo rm -rf ~/.claude/plugins/marketplaces/talos` (sem rodar o init com sudo).
- **`COMMANDS.md`** — seção Troubleshooting para o sintoma `Failed to finalize marketplace cache` / EACCES.

Impacto:
- `npx github:pauloborini/talos init …` deixa de falhar com erro opaco da CLI quando o cache está root-owned; usuário recebe o comando de correção.
- Inclui o conteúdo BREAKING de 0.15.0 para quem ainda estava em 0.14.2 via `origin/main`.

Arquivos/artefatos:
- `build/cli/talos-init.mjs`, `COMMANDS.md`, `VERSION` → `0.15.1`, manifests/bundles regenerados.

Validação:
- `node build/bump-version.mjs 0.15.1` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node --test packages/mcp-server/server.test.js` — 281/281.
- `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs` — 11/11.
- `node build/smoke-hosts.mjs` — ok.
- `node build/conformance-matrix.mjs` — ok (7 hosts × 10).
- `shasum -a 256 -c dist/SHA256SUMS` + `unzip -t` nos 6 `.plugin` — ok.
- `npm pack` + `npm exec` tarball (`talos --help` → v0.15.1; `init opencode/codex --dry-run`) — ok.
- `claude plugin validate ./ --strict` — ok.
- `codex plugin validate` — CLI sem subcomando `validate` (registrado).

## 0.15.0 - 2026-08-02

Tipo: **BREAKING release** (contrato de aceite atômico e validação manual não bloqueante).

Resumo: aceite de produto vira atômico (`AC-*`), prova automática tipada (oráculo mecânico T-outcome) e smoke manual não bloqueante: sprint sem `M` fecha em `done` com `HANDOFF_*` só quando todos os `AC-*` estão `proved`; sprint com `M` aberto fica `manual_validation_pending` (libera DEP, não emite handoff); `M` falho bloqueia a origem e liga a flag `revalidation_required` no cone de dependentes sem impedir execução. **Artefatos pré-v0.15 não são suportados (D19): iniciar backlog/sprint novo.**

Mudanças:
- **Contrato §7 (Plano 1)** — §7.3 com YAML `acceptance`/`AC-*` + hierarquia AC⊃EVAL; selo §7 cobre o bloco; scan bloqueia `behavior` TBD; checkbox dos 4 grupos (LEG1) e `manual_checks` como SSoT de smoke (LEG4) removidos.
- **State v3 + oráculo (Plano 2)** — `state_schema_version:3` obrigatório (v1/v2 hard-fail — LEG2); `acceptance_results`/`proof_refs` por AC; `classifyAcceptanceResults` (oráculo determinístico T-outcome) exigido no `talos_lock_validator` quando sprint presente.
- **Status/DEP/handoff (Plano 3)** — `manual_validation_pending` no enum e transições; `depsSatisfied` aceita `done` | `manual_validation_pending` (LEG3); `done` exige `acceptance_results` no state com todos os `AC-*` `proved` (fechamento: removeu escape “quando presentes”); handoff só em `done`.
- **Relatório M (Plano 4)** — `MANUAL_VALIDATION_REPORT_TEMPLATE.md` + `talos_sync_manual_validation` (lock por backlog; `validated`/`waived` com justificativa; `failed` bloqueia a origem; todos `validated` → `done` com handoff).
- **Flag revalidação (Plano 5)** — coluna `Revalidação` (índice 15) no backlog; `propagateRevalidation` no fecho de `Depende de`; `done` bloqueado com flag até revalidação; select não filtra.
- **Review crítica (Plano 6)** — `policy_manifest.critical_review` (§10, reasons enum fixo); slice-review obrigatória antes de `talos_update_sprint_status` quando `required:true` (G8).
- **Memória pós-validação** — emit de `HANDOFF_*.md` no `done` + skill `talos-memory-promote` (sink Argus opcional, soft-fail sem sink).
- **Fixtures §9 + release (Plano 7)** — gate `build/tests/fixtures-s9.test.mjs` (itens 1–8 red/green na suíte); bump `0.15.0`; `plugins/talos/**`, `hosts/{opencode,pi,zcode,vscode}/**` e `dist/**` regenerados.
- **Fechamento (Plano F)** — `done` sem `acceptance_results` bloqueia (A6 vs SKILL); persist do eco no `validatorComplete` fail-closed; `readStateAcceptanceResults` rejeita schema ≠ 3; guard `check-consistency` cobre `hosts/vscode` e `plugins/talos/VERSION`.

Migração (0.14.x → 0.15.0):
- **Não há migração de artefatos antigos (D19).** Sprint files com §7.3 checkbox e state v1/v2 são rejeitados (hard-fail). Iniciar backlog/sprint novo no padrão 0.15.

Impacto:
- `done` só com todos os `AC-*` provados (sem `M`) ou `M` resolvido por sync; sem `acceptance_results` no state → `done` blocked (sem handoff); `manual_validation_pending` nunca emite `HANDOFF_*`.
- State v3-only: qualquer state antigo falha no boundary (e no side-path do status).
- Schema MCP v5 e topologia sibling/G4/G12 intactos.

Arquivos/artefatos:
- `VERSION` → `0.15.0`; `.claude-plugin/plugin.json`; `package.json`; `packages/mcp-server/package.json`; `plugins/talos/**`; `hosts/{opencode,pi,zcode,vscode}/**`; `dist/**`.
- Templates: `SPRINT_TEMPLATE.md`, `STATE_FILE_SCHEMA.md`, `MANUAL_VALIDATION_REPORT_TEMPLATE.md`, `BACKLOG_MESTRE_TEMPLATE.md`.
- `packages/mcp-server/server.js` + `server.test.js`, `packages/skills/_shared/scripts/document_quality.mjs`, skills orquestrador/validator/executores/interview, `build/tests/fixtures-s9.test.mjs`, `build/check-consistency.mjs`.

Validação:
- `node build/bump-version.mjs 0.15.0` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `bash build/test-all.sh` — OK (inclui fixtures §9 itens 1–8).
- `node --test packages/mcp-server/server.test.js` — 281/281.
- `git diff --check` — exit 0.
- `claude plugin validate ./ --strict` — ok.

## 0.14.2 - 2026-07-20

Tipo: **packaging**. **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: corrige spawn do MCP em paths com espaço (ex.: `Application Support` no Parallels/macOS) e cita `description` dos agents no frontmatter YAML para parse estável.

Mudanças:
- **MCP spawn** — manifests Claude passam a usar `command: "/bin/bash"` + `args: ["${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/run.sh"]` em vez de colocar o path do script em `command` (ENOENT quando o path contém espaços).
- **`run.sh`** — comentário documentando a regra de spawn para hosts/Parallels.
- **Agents** — `description` entre aspas no frontmatter dos 5 agents da família (`talos-direct-execute`, `talos-plan-execute`, `talos-findings-repair`, `talos-slice-review`, `talos-task-validator`) e espelhos em `plugins/` + `hosts/`.

Impacto:
- Instalação/atualização em diretórios com espaço deixa de quebrar o MCP stdio.
- Sem mudança de contrato MCP, gates ou topologia sibling.

Arquivos/artefatos:
- `.claude-plugin/plugin.json`, `plugin-manifests/claude/plugin.json`, `packages/mcp-server/run.sh`
- `agents/*.md`, `plugins/talos/agents/*.md`, `hosts/{opencode,pi,zcode,vscode}/**/agents/*.md`
- `VERSION`, bundles `dist/**`, catálogos regenerados

Validação:
- `node build/bump-version.mjs 0.14.2` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node --test packages/mcp-server/server.test.js` — 230/230.
- `node build/smoke-hosts.mjs` — ok.
- `node build/conformance-matrix.mjs` — ok (7 hosts × 10).
- `shasum -a 256 -c dist/SHA256SUMS` + `unzip -t` nos 6 `.plugin` — ok.
- `npm pack` + `npm exec` tarball (`talos --help`, `init opencode/codex --dry-run`) — ok.
- `claude plugin validate ./ --strict` — ok.
- `codex plugin validate` — CLI sem subcomando `validate` (registrado).

## 0.14.1 - 2026-07-19

Tipo: **patch de confiabilidade de contrato** (MCP + orquestrador + entry points; schema v5 intacto).

Resumo: remove o resíduo `next_action: "gerar_prd"` pós-remoção do PRD e fecha desalinhamentos de entry point/orquestrador que ainda ensinavam ou ignoravam a cadeia §7.

Mudanças:
- **`talos_select_next_sprint`** — `next_action` canônico e **mode-aware** (`mode` opcional): §7 draft → `sprint_interview`; `direct` + §7 selado → `plan_execute` (nunca `plan_handoff`); `full` + §7 selado sem PLAN → `plan_handoff`; PLAN real → `plan_execute`. Nunca `gerar_prd`.
- **Orquestrador** — gate `SELECT_NEXT_SPRINT` obriga consumir `next_action` + passar `mode`; fluxos `full`/`direct` ramificam pelo verbo MCP.
- **Payload `selected`** — adiciona `contrato_status` / `contrato_sealed`; `prd_path` permanece como legado posicional do backlog (documentado).
- **`talos_update_sprint_status`** — `prd_path` só atualiza a coluna legado do backlog; não grava campo PRD no sprint file.
- **Capabilities** — `question_prompt.persistence`: `prd_after_each_round` → `sprint_after_each_round`.
- **Entry points** — README (`talos_scan_acceptance`, G5 §7); manifests Claude/Codex/ZCode (sem `direct prd` / copy PRD); shim `talos-direct-execute` + `openai.yaml` retargetados a §7; Raycast snippets sem `direct prd`/família legada.
- **Docs** — MCP README, `STATE_FILE_SCHEMA`, `SPRINT_TEMPLATE`, `subagent_dispatch`, missão CLAUDE/AGENTS alinhados a §7.

Impacto:
- Orquestradores/consumidores que seguiam `gerar_prd` ou `/talos direct prd` ao pé da letra passam ao verbo/caminho corretos.
- Nenhuma skill/artefato PRD reintroduzido.

## 0.14.0 - 2026-07-19

> ⚠️ **BREAKING (contrato documental):** o artefato `PRD_*.md` deixa de ser etapa do pipeline. O sprint file absorve o contrato de produto (§7 congelado + selo sha256). Schema MCP `talos_capabilities` permanece v5; topologia sibling (G4), dispatch e locks intactos. Bump minor pré-1.0 é proposital (SemVer 0.y.z permite breaking sem major).

Tipo: **breaking de contrato documental** + packaging multi-host. Schema MCP: v5 (inalterado). Contrato de execução (G4/DISPATCH/PREREQ/JOIN): preservado.

Resumo: corta o PRD como artefato e etapa. `full`/`direct`/`execute` completam sem gerar nem exigir `PRD_*.md`; o sprint file carrega decisões D*, cenários UX e aceite binário na §7 write-once; o validador frio nota código contra esse contrato selado.

Mudanças:
- **Sprint file = contrato de produto** — `SPRINT_TEMPLATE.md` §7 "Contrato de produto (congelado)"; `validateSprintFileConformance` exige D* + UX + aceite binário + `Contrato status`; `validateAcceptanceSeal` bloqueia tamper (`FROZEN_ACCEPTANCE_TAMPERED`).
- **Roteamento sem PRD** — `documentFlowForRouting` não emite `prd_generator`/`PRD_*.md`; `sprint_interview` no lugar de `prd_interview`; tipo de input `prd` removido.
- **Gates MCP retargetados** — `talos_verify_template_conformance` aceita só `plan`; `verifyPlanConformance` exige `**Sprint file**`; `talos_scan_prd` → `talos_scan_acceptance` (escaneia §7).
- **Skills** — `talos-prd-interview` → `talos-sprint-interview`; `talos-sprint-prd-generator` removido; plan-handoff/direct-execute/task-validator/backlog retargetados para §7.
- **Orquestrador/templates** — fases sem PRD; `BOUNDARY_PRD_PLAN.md` → `BOUNDARY_SPRINT_PLAN.md`; `PRD_TEMPLATE.md` removido; interview-only cria sprint file standalone.
- **Bundles regenerados** — `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin`, `SHA256SUMS`, `plugins/talos/**` e `hosts/{opencode,pi,zcode,vscode}/**` em `0.14.0`.

Impacto:
- Consumidores/docs que assumiam etapa PRD devem migrar para o contrato §7 do sprint file.
- Nenhum adapter `HOST_ADAPTERS` muda; 8 hosts mantêm join/dispatch/prereq.

**Nota de migração (BREAKING):**
1. Sprint files legados com §7 "Critérios candidatos para PRD" → reescrever §7 "Contrato de produto (congelado)" (usar PRD legado como insumo, se houver).
2. Aprovar contrato → `Contrato status: aprovado` + `Selo do contrato: sha256:<hash>` (via `talos-sprint-interview`).
3. Planos novos linkam `**Sprint file**` (não `**PRD**`).
4. PRDs existentes viram insumo manual e saem do pipeline (arquivar fora; não usamos `archive/` automaticamente).
5. Input `prd` removido — trate como ideia/spec livre.
6. Standalone vive no sprint file (`Backlog link: Não aplicável (standalone)`), não em PRD.

Arquivos/artefatos:
- `VERSION`, `.claude-plugin/plugin.json`, `package.json`, `packages/mcp-server/package.json`
- `CLAUDE.md`, `AGENTS.md`, `README.md`, `COMMANDS.md`, `packages/orchestrator/README.md`
- `packages/mcp-server/server.js`, `packages/skills/**`, `packages/templates/**`, `packages/orchestrator/**`
- `hosts/**`, `plugins/talos/**`, `dist/**` (espelhos regenerados por `build/build-plugins.sh`)

Validação:
- `node build/bump-version.mjs 0.14.0` + `bash build/build-plugins.sh` — ok.
- `node build/check-consistency.mjs` — ok.
- `node build/smoke-hosts.mjs` — ok (claude/cursor/codex/zcode/opencode/pi + generic).
- `node build/conformance-matrix.mjs` — ok (claude/codex/opencode/pi/zcode/vscode/generic × 10).
- `bash build/test-all.sh` — ok (incl. smoke-install + checksums 6 plugins).
- `claude plugin validate ./ --strict` — ok.
- Smoke ponta a ponta Claude Code (`/talos direct`) — pendente (ambiente Cursor; ver Impl Plano 6).

## 0.13.0 - 2026-07-03

Tipo: **runtime + packaging**. **Sem breaking**. Schema MCP: v5 (inalterado). Contrato de execução: preservado.

Resumo: Adiciona **VS Code** como 8º host oficial, com instalador `init vscode` (workspace + global), adapter `self_evident`/`mutable` no MCP, e suporte a JSONC (`settings.json` com comentários).

Mudanças:
- **Host VS Code** — entrada `vscode` em `HOST_ADAPTERS` (`packages/mcp-server/server.js`) com perfil `self_evident`, `dispatch_capability: 'mutable'`, `todo_tool: 'manage_todo_list'`. Detecção via `TALOS_HOST=vscode` injetado no MCP config. Subagente: `runSubagent(agentName)`, bloqueante. Join do validador: `self_evident`, `confidence: 'high'`.
- **Instalador `init vscode`** — workspace: `.vscode/talos/` + `.vscode/mcp.json`; global: `~/.vscode-talos/` (runtime) + prompt folder `~/Library/Application Support/Code/User/prompts/` (agents/skills) + `settings.json` (`github.copilot.chat.mcpServers`). `uninstall vscode` limpo preservando config do usuário.
- **Suporte JSONC** — parser tolerante a comentários `//` e trailing commas (`parseJsoncFile`), usado no merge do `settings.json` do VS Code e no `dropMcpKey` (uninstall).
- **Build do host VS Code** — `build_vscode()` em `build-plugins.sh`, artefato `dist/talos-vscode.plugin`, catálogo from-source `hosts/vscode/`.
- **Matriz de conformance** — host `vscode` adicionado, 10 cenários verdes (70/70 cross-host, zero regressões).
- **Docs atualizados** — `README.md`, `COMMANDS.md`, `AGENTS.md`, `CLAUDE.md`, `plugin-manifests/README.md`, `packages/orchestrator/README.md` refletem 8 hosts.
- **`install-host.sh`** — caso `vscode` com instruções de ativação no VS Code.
- **Bundles regenerados** — `dist/talos-{claude,codex,opencode,pi,zcode,vscode}.plugin`, `SHA256SUMS`, `plugins/talos/**` e `hosts/{opencode,pi,zcode,vscode}/**` em `0.13.0`.

Impacto:
- VS Code Copilot Chat é o oitavo host oficial; usa `npx github:pauloborini/talos init vscode --global` ou `npx github:pauloborini/talos init vscode`.
- Nenhum adapter de host existente foi alterado; 7 hosts originais mantêm mesmos valores de `join`, `dispatch` e `prereq`.

Arquivos/artefatos:
- `packages/mcp-server/server.js` (adapter `vscode`)
- `build/cli/talos-init.mjs` (install/uninstall vscode + JSONC parser)
- `build/build-plugins.sh` (`build_vscode`)
- `build/install-host.sh` (caso `vscode`)
- `build/conformance-matrix.mjs` (host `vscode`)
- `plugin-manifests/vscode/mcp.json`
- `hosts/vscode/` (catálogo from-source)
- `dist/talos-vscode.plugin`

Validação:
- `node build/bump-version.mjs 0.13.0` — ok.
- `build/check-consistency.mjs` — ok.
- `build/conformance-matrix.mjs` — 70/70 (7 hosts × 10 cenários), zero regressões.
- `talos_ping` + `talos_capabilities` com `TALOS_HOST=vscode`: `host=vscode`, `self_evident`, `mutable`, schema v5.
- Dry-run `init vscode` (workspace + global), `uninstall vscode` (workspace + global): 4/4 cenários passando.
- JSONC `settings.json` real do VS Code (comentários + trailing commas): parse OK.

## 0.12.2 - 2026-07-02

Tipo: **runtime**. **Sem breaking**. Schema MCP: v5 (inalterado). Contrato de execução: preservado.

Resumo: Otimiza consumo de tokens e performance no MCP e no state file de handoff executor→validator, sem alterar gates determinísticos nem nomes/schemas de tools.

Mudanças:
- **State file schema v2 compacto** — writers passam a emitir `state_schema_version:2` em JSON compacto; `contract_ids` referencia obrigações/invariantes/cenários/riscos por ID (sem copiar texto do PRD/plano); `eval_results` é a única fonte de claims; evidências de task/repair usam índices em vez de paths completos repetidos. Readers aceitam v1 e v2.
- **`talos_run_state` action `recovery`** — expõe payload mínimo (`validator_recovery`) para o validador frio em orquestrador re-spun; `get` permanece para debug/legado.
- **Descrições MCP encurtadas** — tool descriptions mais curtas no `tools/list`, reduzindo overhead de contexto sem mudar nomes, schemas ou comportamento dos gates.
- **Skills de execução/validação alinhadas** — `talos-plan-execute`, `talos-direct-execute`, `talos-task-validator` e `talos-findings-repair` atualizados para o contrato v2 e recovery.
- **Testes MCP ampliados** — cobertura de normalização v2, action `recovery` e compatibilidade de leitura.
- **Bundles regenerados** — `dist/talos-{claude,codex,opencode,pi,zcode}.plugin`, `SHA256SUMS`, `plugins/talos/**` e `hosts/{opencode,pi,zcode}/**` em `0.12.2`.

Impacto:
- Menor custo de token em handoff validator e listagem de tools MCP; comportamento de pipeline e gates inalterados.
- Executores devem escrever state v2; validador continua lendo boundary via `state_path` + MCP.

Arquivos/artefatos:
- `packages/mcp-server/server.js`, `packages/mcp-server/server.test.js`
- `packages/templates/STATE_FILE_SCHEMA.md`
- `packages/skills/talos-{plan-execute,direct-execute,task-validator,findings-repair}/SKILL.md`
- `dist/talos-*.plugin`, `dist/SHA256SUMS`

Validação:
- `node build/bump-version.mjs 0.12.2` — ok.
- `build/check-consistency.mjs` — ok.
- `node --test packages/mcp-server/server.test.js` — ok.
- `build/smoke-hosts.mjs` — ok.
- `build/conformance-matrix.mjs` — ok.

## 0.12.1 - 2026-07-01

Tipo: **runtime + packaging + docs**. **Sem breaking**. Schema MCP: v5 (inalterado). Contrato de execução: preservado.

Resumo: Corrige resíduos do método antigo após o rebranding para Talos. A superfície pública passa a apontar consistentemente para `/talos`, com bundles e catálogos regenerados.

Mudanças:
- **Slash command canônico** — o arquivo de comando legado foi removido e substituído por `packages/orchestrator/commands/talos.md`, propagado para `plugins/` e hosts gerados.
- **Docs e prompts alinhados** — `README.md`, `COMMANDS.md`, skill orquestradora, prompts Codex e snippets Raycast passam a usar `/talos ...` nos exemplos.
- **Instalador npx/tarball corrigido** — `talos --help` via tarball agora resolve `VERSION` mesmo quando executado pelo symlink `.bin/talos`.
- **Npm registry desativado** — release workflow não publica mais no npm; `package.json` mantém `private: true`. Distribuição oficial fica em `npx github:pauloborini/talos` + GitHub Release.
- **Fix — regressão de upgrade zcode (`enabledPlugins` órfão)** — o rebrand v0.12.0 (`atlas-workflow-orchestrator` → `talos`) foi uma breaking change de identidade do plugin, mas o `installZcode()` não migrava `~/.zcode/cli/config.json`: instalações antigas ficavam com `enabledPlugins` apontando para o nome morto (`atlas-workflow-orchestrator@zcode-plugins-official`), e o host zcode nunca carregava o `talos` renomeado (skills/MCP invisíveis). Agora `installZcode` migra automaticamente: remove entradas órfãs pré-rebrand e habilita `talos@zcode-plugins-official: true` (idempotente, fail-closed em JSON inválido — preserva config do usuário). `uninstall zcode` remove a entrada de forma limpa. O passo manual `/plugins enable` deixa de ser necessário em upgrade.
- **Bundles regenerados** — `dist/talos-{claude,codex,opencode,pi,zcode}.plugin`, `SHA256SUMS`, `plugins/talos/**` e `hosts/{opencode,pi,zcode}/**` sincronizados em `0.12.1`.

Impacto:
- Usuários devem invocar `/talos <mode> ...`; o comando legado não é mais distribuído pelo plugin.
- Limpeza de instalações antigas com prefixo `atlas-*` permanece suportada pelo instalador.

Arquivos/artefatos:
- `packages/orchestrator/commands/talos.md`
- `packages/orchestrator/skills/talos/SKILL.md`
- `build/cli/talos-init.mjs`
- `.github/workflows/release.yml`
- `package.json`
- `plugin-manifests/*`, `.claude-plugin/plugin.json`, `plugins/talos/**`, `hosts/**`
- `dist/talos-*.plugin`, `dist/SHA256SUMS`

Validação:
- `node build/bump-version.mjs 0.12.1` — ok.
- `build/check-consistency.mjs` — ok.
- Varredura textual: zero ocorrência do comando legado em superfícies distribuídas, exceto referências legítimas a GitHub Actions.
- Suíte local completa e validações de pacote devem ser executadas antes do merge/release conforme `PATCH_PROCEDURE.md`.

## 0.12.0 - 2026-07-01

Tipo: **major (rebranding completo)**. **BREAKING**: renomeação de `atlas-workflow` → `Talos`. Schema MCP: v5 (inalterado). Contrato de execução: preservado.

Resumo: Lançamento público do **Talos** como pipeline determinístico independente. Renomeação completa do produto, skills e artefatos — de `atlas-workflow`/`atlas-*` para `talos`/`talos-*`. É a mesma pipeline, agora com identidade própria e instalável por qualquer pessoa.

Mudanças:
- **Rebranding integral** — 632 arquivos alterados: todas as skills renomeadas de `atlas-*` para `talos-*` (10 skills + orquestradora), CLI `atlas-init.mjs` → `talos-init.mjs`, MCP server, agentes, templates, bundles e documentação.
- **Identidade visual** — Logo Talos, README, metadados de marketplace e plugin.json atualizados para o nome definitivo.
- **Compatibilidade com legado** — `SKILL_PREFIXES` no instalador agora cobre `['talos-', 'atlas-']`: instalações antigas com prefixo `atlas-` são limpas automaticamente no upgrade.
- **Correção de smoke test** — Testes de install/uninstall atualizados para validar tanto a limpeza do prefixo legado `atlas-` quanto a instalação correta do prefixo atual `talos-`.
- **Docs** — `NAMING.md` registra a decisão de ecossistema (Atlas Agents como produto; Talos/Argus/Athena como módulos). `AGENTS.md` e `README.md` refletem a nova marca.

Breaking changes:
- **Paths e nomes** — Todos os caminhos `atlas-*` (skills, agentes, CLI, bundles) foram renomeados para `talos-*`. Scripts e automações que referenciem os nomes antigos precisam ser atualizados.
- **Instalador** — O comando `npx github:pauloborini/atlas-workflow init ...` passa a ser `npx github:pauloborini/talos init ...`.

Migração:
- Para instalações existentes: `talos init <host>` detecta e limpa automaticamente artefatos com prefixo legado `atlas-*`.
- Para scripts e CI: atualize referências de `atlas-workflow` para `talos` e de `atlas-*` para `talos-*`.

Validação:
- `build/check-consistency.mjs` — ok (validator sincronizado cross-host; catálogos presentes+versão; skills sem hardcode; sem regressão A1/A2).
- `claude plugin validate ./ --strict` — ok.
- `bash build/test-all.sh` — todos os testes verdes (11/11 unit, smoke hosts, conformance matrix 6×10, smoke install/uninstall, checksums 5/5).

## 0.11.1 - 2026-06-30

Tipo: **packaging**. **Sem breaking**. Schema MCP: v5 (inalterado).

Resumo: Corrige a instalação global do host Antigravity (Gemini) no instalador unificado. O instalador agora copia recursivamente o diretório `packages/` inteiro (incluindo `skills` e `templates`), resolvendo a ausência de scripts internos compartilhados (como `document_quality.mjs`) e templates canônicos de execução.

Mudanças:
- **Instalador unificado** — `build/cli/atlas-init.mjs`: alterada a função `installAntigravity` para fazer a cópia recursiva de `SRC/packages` para `packagesDir` em vez de criar e copiar apenas a subpasta `mcp-server`.
- **Correção de drifts** — Sincronizadas as referências estáticas de versão (que haviam restado em `0.10.1` nos READMEs, `COMMANDS.md`, `CLAUDE.md` e `AGENTS.md`) para `0.11.0` antes de rodar o bump determinístico para `0.11.1`.
- **Versionamento** — `VERSION`, `package.json`, manifests e catálogos regenerados e sincronizados na versão `0.11.1`.

Validação:
- Execução local do instalador corrigido para o host Antigravity confirmando presença de `packages/skills` e `packages/templates`.
- Execução bem-sucedida de `bash build/test-all.sh` (todos os testes verdes, consistência de versão e integridade dos plugins em dia).

## 0.11.0 - 2026-06-30

Tipo: **feature de compatibilidade (não-breaking, schema aditivo)** — workaround para a limitação do host ZCode onde sub-agentes de plugin não herdam conexões MCP, mesmo com `mcp__...` declarado no frontmatter `tools:`. Confirmado empiricamente (v0.10.1) para os 5 sub-agentes Atlas. Bug do host (ZCode), não do plugin.

Resumo: O adapter zcode ganha `subagent_dispatch.fallback` (campo aditivo, `schema_version` segue **v5**). Quando `fallback.enabled:true`, o orquestrador despacha `general-purpose` (subagente nativo, que herda MCP + tools nativas) em vez de `atlas-*` (plugin), passando um prompt que aponta o `agents/<name>.md` canônico como system prompt. O contrato continua sendo a fonte única `agents/<name>.md`; mudou quem carrega (nativo vs plugin), não a topologia. Isolamento sibling (Gate G4) preservado — ainda é um subagente irmão isolado, despachado blocking, com `dispatch_token`/`challenge_response` ecoados do output do irmão. Aplica-se aos 5 dispatches (validator, findings-repair, slice-review, plan-execute, direct-execute). Hosts sem `fallback` (claude/codex/opencode/pi/antigravity/generic) seguem o verbo nominal exato — zero mudança de comportamento.

Mudanças:
- **Adapter zcode** — `packages/mcp-server/server.js`: adicionado `subagent_dispatch.fallback { enabled, reason, subagent_type, prompt_template }` ao perfil zcode, com comentário documentando a limitação do host.
- **Skill orquestradora** — `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`: nova seção "Fallback de subagente" com o branch condicional (`fallback.enabled === true` → despachar `general-purpose`).
- **Doc de dispatch** — `packages/orchestrator/references/subagent_dispatch.md`: seção ZCode reescrita documentando a limitação (sub-agentes de plugin não herdam MCP) e o workaround, com justificativa de por que o Gate G4/sibling permanece válido.
- **Matriz de adapters** — `packages/orchestrator/references/host-adapters.md`: nova linha "Fallback de subagente" (zcode) e campo `fallback?` documentado no schema `subagent_dispatch`.
- **AGENTS.md** — parágrafo zcode atualizado com a limitação e o workaround (registrado como limitação do host).
- **Versionamento sincronizado** — `VERSION`, `package.json`, `packages/mcp-server/package.json`, `.claude-plugin/plugin.json` e os bundles host em `0.11.0`.

Não incluído: mudança de `dispatch_capability` do zcode (continua `unknown` — o gate DISPATCH ainda exige `dispatch_mutable:true`, correto e seguro) ou "validador inline no fio do orquestrador" (violaria G9/R17; o fallback preserva o isolamento sibling).

Validação:
- `build/check-consistency.mjs` e `build/build-plugins.sh` a regenerar bundles/católogos.
- Teste em `packages/mcp-server/server.test.js`: asserção de `capabilities({host:'zcode'}).subagent_dispatch.fallback.enabled === true` e ausência de `fallback` em claude/pi.
- Validação empírica: despachar `general-purpose` com o `prompt_template` e confirmar MCP disponível dentro do subagente.

## 0.10.1 - 2026-06-29

Tipo: **patch de contrato e distribuição** — `sprint` vira alias canônico para `backlog-item` em `full`/`direct`, com docs, bundles e launchers alinhados. **Sem breaking** (`CAPABILITIES_SCHEMA_VERSION` segue **v5** e o comportamento legado continua aceito).

Resumo: O fluxo Atlas passa a preferir `/workflow full sprint "SNN"` e `/workflow direct sprint "SNN"` como entrada pública, mantendo `backlog-item` apenas como compatibilidade. A documentação, os bundles dos hosts e os comandos Raycast foram ajustados para refletir o contrato novo sem alterar o runtime do orquestrador.

Mudanças:
- **Alias `sprint` canônico** — `packages/mcp-server/server.js` e os artefatos gerados passam a tratar `sprint` como input oficial para `full` e `direct`; `backlog-item` permanece como alias legado.
- **Docs alinhadas** — `README.md`, `COMMANDS.md`, `packages/orchestrator/README.md`, `packages/orchestrator/commands/workflow.md` e as cópias empacotadas foram atualizadas para o novo comando `/workflow ... sprint`.
- **Raycast atualizado** — os snippets/launchers locais passam a expor `workflow full sprint` como comando padrão.
- **Versionamento sincronizado** — `VERSION`, `package.json`, `packages/mcp-server/package.json`, `.claude-plugin/plugin.json` e os bundles host foram regenerados em `0.10.1`.

Validação:
- `build/bump-version.mjs` regenerou bundles e `build/check-consistency.mjs` passou.
- A suíte completa e a validação de plugin continuam válidas após o bump.

## 0.10.0 - 2026-06-29

Tipo: **minor aditivo** — backlog em 2 camadas (mestre enxuto + sprint files vivos) + 4 gates MCP novos. **Sem breaking** (`CAPABILITIES_SCHEMA_VERSION` segue **v5**, modos públicos `full`/`direct`/`execute`/`interview-only`/`audit` intactos).

Resumo: O Atlas adota arquitetura de backlog em duas camadas: o backlog mestre passa a ser índice estratégico enxuto (fases, tabela de sprints, dependências, MoSCoW, prioridade, links), e cada sprint ganha um arquivo vivo dedicado (`sprints/SNN_<slug>.md`) como fonte de verdade contextual. Quatro gates MCP novos tornam a seleção e a atualização de sprints determinísticas. Skills atualizadas para priorizar o arquivo vivo de sprint como fonte primária.

Mudanças:
- **4 novos gates MCP** (`packages/mcp-server/server.js`):
  - `atlas_verify_sprint_file` — valida conformidade do arquivo vivo de sprint contra `SPRINT_TEMPLATE.md`: seções obrigatórias, link bidirecional ao backlog, DoR, eval_manifest, status espelhado. Fail-closed (artefato ausente ou vazio = blocked).
  - `atlas_verify_backlog_index` — valida o backlog mestre como índice: §7 Registro de sprints presente, enums MoSCoW/prioridade/status válidos, links para sprint files reais, sem sprint duplicada, detecção de ciclo de dependência, status drift backlog↔sprint file bloqueante.
  - `atlas_select_next_sprint` — seleção determinística da próxima sprint executável: filtra por `state=ready` + deps done + sprint file válido + DoR verde; ordena por MoSCoW→prioridade→ganho→esforço→ID. Resultado único, sem ambiguidade.
  - `atlas_update_sprint_status` — atualiza status de sprint em backlog e sprint file atomicamente: pré-condição (enum, transição FSM, `done` exige validator terminal + `state_path`), escrita com rollback (se o write do sprint file falhar após o backlog ser escrito, backlog é restaurado ao estado original — sem drift), pós-validação antes de retornar `passed`.
- **`SPRINT_TEMPLATE.md`** — template canônico do arquivo vivo de sprint com 16 seções (ID imutável, links bidirecionais, objetivo, DoR/DoD, `eval_manifest` com `acceptance_criteria`/`regression_cases`/`thresholds`, `policy_manifest`, §14 Execução e validação, §16 Histórico).
- **`BACKLOG_MESTRE_TEMPLATE.md` refatorado** — índice enxuto: sem critérios completos por sprint, sem plano técnico, sem tasks detalhadas. Aponta para sprint files. Tabela §7 com colunas `sprint_file`, `prd`, `plan`, `state_file` como links rastreáveis.
- **`STATE_FILE_SCHEMA.md`** adicionado — schema formal do arquivo de state da execução.
- **`document_quality.mjs`** estendido — validação de conformidade de sprint file (`validateSprintFileConformance`), parsing de rows do backlog (`parseSprintRows`), enums MoSCoW/prioridade/status/veredito exportados.
- **Skills atualizadas**: `atlas-backlog-generator` (cria sprint files + links bidirecionais), `atlas-sprint-prd-generator` (prioriza arquivo vivo de sprint, backlog mestre só para deps/ordem), `atlas-plan-handoff` (gate `atlas_verify_sprint_file` obrigatório), `atlas-plan-execute`/`atlas-direct-execute` (verificam sprint file antes de iniciar), `atlas-task-validator` (critérios de aceite do sprint file como fonte adicional).
- **`BOUNDARY_PRD_PLAN.md`** atualizado — instrução de sprint file como fonte de contexto de execução.
- **Codex agent handling** — tratamento de agente Codex atualizado no orquestrador; doc Codex alinhada.
- **Rollback P2** (`updateSprintStatus`) — fix de confiabilidade: write do sprint file dentro de try/catch com restauração do backlog em caso de erro de FS.

Impacto:
- Sprint pequena continua sendo a unidade de execução; o backlog mestre deixa de carregar contexto completo e passa a ser índice navegável.
- `atlas_select_next_sprint` elimina seleção manual/ambígua de próxima sprint — determinismo por gate, não por prosa.
- `atlas_update_sprint_status` fecha o loop de atualização: status espelhado backlog↔sprint file, rastreável e validado antes de qualquer write.
- Skill `atlas-sprint-prd-generator` lê o arquivo vivo de sprint como fonte primária — contexto menor, foco correto, sem carregar backlog inteiro.

Arquivos/artefatos:
- `packages/mcp-server/server.js`, `packages/mcp-server/server.test.js` (190 testes, +1 caso rollback P2), `packages/templates/SPRINT_TEMPLATE.md`, `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`, `packages/templates/BOUNDARY_PRD_PLAN.md`, `packages/templates/PLAN_TEMPLATE.md`, `packages/templates/PRD_TEMPLATE.md`, `packages/templates/STATE_FILE_SCHEMA.md`, `packages/skills/_shared/scripts/document_quality.mjs`, `packages/skills/atlas-backlog-generator/SKILL.md`, `packages/skills/atlas-sprint-prd-generator/SKILL.md`, `packages/skills/atlas-plan-handoff/SKILL.md`, `packages/skills/atlas-plan-execute/SKILL.md`, `packages/skills/atlas-direct-execute/SKILL.md`, `packages/skills/atlas-task-validator/SKILL.md`, `packages/skills/atlas-findings-repair/SKILL.md`, `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`, `packages/orchestrator/README.md`, `packages/orchestrator/commands/workflow.md`, `packages/orchestrator/references/host-adapters.md`, `packages/orchestrator/references/subagent_dispatch.md` — replicados em `plugins/` e `hosts/{opencode,pi,zcode}/` via build.

Validação:
- `packages/mcp-server/server.test.js`: 190/190 pass (189 existentes + 1 novo caso rollback P2).
- `build/check-consistency.mjs`: ok (validator sincronizado cross-host; catálogos presentes+versão; sem hardcode; sem regressão A1/A2).
- `build/conformance-matrix.mjs`: ok (6 hosts × 10 cenários verdes).
- `claude plugin validate ./ --strict`: passed.
- Sincronização cross-host: 5 cópias de `server.js` com hash idêntico.

## 0.9.4 - 2026-06-27

Tipo: **runtime** (sem breaking; `CAPABILITIES_SCHEMA_VERSION` segue **v5**, modos públicos `full`/`direct`/`execute`/`interview-only`/`audit` intactos). Endurecimento do modo `audit` e expansão dos perfis de stack das skills.

Resumo: `/workflow audit --handoff` passa a emitir um plano **conforme ao `PLAN_TEMPLATE.md`** (passa no gate TC e é de fato consumível por `/workflow execute plan`), e os perfis de stack ganham 6 novas linguagens/plataformas detectáveis no validador frio e no baseline universal.

Mudanças:
- **Audit handoff TC-conforme** (`packages/skills/atlas-audit/SKILL.md`, replicado nos bundles) — a "Estrutura mínima" anterior (`Scope boundary`/`Non-goals`/`Stop conditions` + tasks soltas) era anunciada como consumível por `/workflow execute plan`/`atlas-plan-execute`, mas **falharia o gate TC** (`verifyPlanConformance` exige 8 seções nomeadas + linha `| **PRD** |` + ref a `BOUNDARY_PRD_PLAN.md` + tarefas `#### T01.`) e seria rejeitada pelo executor por substância ausente. Agora o `--handoff` escreve `.atlas/plans/PLAN_AUDIT_<slug>.md` espelhando o template canônico (cabeçalho com `| **PRD** | N/A — origem auditoria |` para declarar proveniência sem inventar PRD, `execution_mode: sequencial` que dispensa §7, §1–§6/§8 reancoradas em achados/regras locais, tasks `#### T01.` com `Referência ao achado: AUDIT-NNN — arquivo:linha`). Passo 5 do `atlas-workflow-orchestrator/SKILL.md` e `workflow.md` alinhados.
- **6 novos perfis de stack** (`packages/skills/_shared/scripts/document_quality.mjs`, `_shared/references/stack-profiles.md`, `atlas-task-validator/SKILL.md`) — `go`, `rust`, `java_kotlin`, `firebase`, `supabase`, `rest_openapi`. Detecção determinística por manifests (`go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle*`, `firebase.json`/`.firebaserc`, `openapi*`/`swagger*`), deps de `package.json`/`pubspec.yaml` reais e comandos declarados. Regra de perfil só ativa no boundary onde o sinal aparece; nada de finding fora do boundary.
- **`audit`/`interview-only` sem `guarantee_level`** — descrição do `atlas_preflight` (`packages/mcp-server/server.js`, README) endurecida: o campo só aparece em modos com execução de código. Bate com a impl (`guaranteeLevelForMode('audit') → null`, campo omitido). Sem mudança de comportamento.

Impacto:
- Plano gerado por `audit --handoff` agora passa de fato pelo gate TC e entra em `/workflow execute plan` sem hard-fail — fecha promessa quebrada de consumibilidade.
- Auditoria/validação cobrem stacks Go/Rust/Java-Kotlin/Firebase/Supabase/REST-OpenAPI sem regredir Flutter/Node/Python (perfis aditivos, gated por sinal real).

Arquivos/artefatos:
- `packages/skills/atlas-audit/SKILL.md`, `packages/skills/atlas-task-validator/SKILL.md`, `packages/skills/_shared/scripts/document_quality.mjs`, `packages/skills/_shared/references/stack-profiles.md`, `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`, `packages/orchestrator/commands/workflow.md`, `packages/mcp-server/server.js` (+README) — replicados em `plugins/` e `hosts/{opencode,pi,zcode}/` via build; 4 `.plugin` + `SHA256SUMS` regenerados.

Validação:
- `build/check-consistency.mjs`: ok (cross-host sincronizado).
- `build/tests/etapa3.test.mjs`: 11/11 (3 casos novos para os perfis adicionais).
- `claude plugin validate ./ --strict`: passed.

## 0.9.3 - 2026-06-27

Tipo: **adição de host tier-1** (sem breaking; `CAPABILITIES_SCHEMA_VERSION` segue **v5**, modos públicos intactos). Integração do ZCode como novo host suportado do pipeline.

Mudanças:
- **Novo host: ZCode** — adicionada entrada `zcode` em `HOST_ADAPTERS` (`packages/mcp-server/server.js`) com perfil `self_evident` (subagente + MCP + TodoWrite nativos via Claude Agent SDK). Detector por env `ZCODE_PLUGIN_ROOT` injetado pelo host em `HOST_DETECTORS`. `validator_dispatch.join.sync: 'self_evident'`, `confidence: 'presumed'`. ZCode é clone estrutural do Claude Code (mesmo `Agent(subagent_type)` + mesmo formato `agents/<name>.md` no plugin root) — reusa o agente canônico sem geração extra. Smoke real (`build/smoke-hosts.mjs` + boot MCP com `ZCODE_PLUGIN_ROOT`) confirma `host=zcode`, `schema_version=5`, `atlas_ping status=alive` em v0.9.3.
- **Installer `init zcode`** (`build/cli/atlas-init.mjs`) — copia o catálogo from-source `hosts/zcode/` para `~/.zcode/cli/plugins/cache/pauloborini/atlas-workflow-orchestrator/<version>/` e registra o plugin no `marketplace.json` do ZCode. Alias `zai` aceito. Ativação no host via `/plugins enable atlas-workflow-orchestrator`. `uninstall zcode` reversível.
- **Packaging** — `build-plugins.sh`: nova função `build_zcode()` (cria `.zcode-plugin/plugin.json` com `${ZCODE_PLUGIN_ROOT}` injetado, copia `agents/`, `skills/`, `packages/`); `HOSTS`/dist include `zcode`. `install-host.sh`: case `zcode` adicionado. Novo manifest `plugin-manifests/zcode/plugin.json` (template com `__VERSION__`).
- **Consistência** — `check-consistency.mjs`: checagens para `hosts/zcode/.zcode-plugin/plugin.json`, `hosts/zcode/agents/<despachados>`, `hosts/zcode/packages/mcp-server/{server.js,VERSION}`. `AGENT_DIRS` inclui zcode. Bloco de veredito M3 (sibling) cross-host agora cobre `hosts/zcode/agents/atlas-task-validator.md`.
- **Smoke** — `build/smoke-hosts.mjs`: novo caso `zcode (ZCODE_PLUGIN_ROOT) → host=zcode sv=5 ping=ok`; env `ZCODE_PLUGIN_ROOT` adicionado à lista de variáveis limpas no boot do caso.
- **Doc** — `host-adapters.md` (linha de detecção, coluna na matriz, checklist "adicionar host" + status multi-host) e `AGENTS.md` (cinco → seis hosts) atualizados. `README.md` ganha a 6ª linha de host + comando de instalação + nota de "Claude Agent SDK compat".

Nota sobre o modelo de distribuição: ZCode não expõe uma CLI `zcode plugin marketplace add` no shell — o app Electron é o ponto de instalação. O caminho de install é cache-based (drop em `~/.zcode/cli/plugins/cache/` + registro no `marketplace.json`), análogo ao `init antigravity`. O `init zcode` é o `npx` wrapper que automatiza esse drop. Distribuição da release segue via catálogo from-source commitado em `hosts/zcode/` (DEC-008), e o artefato `.plugin` é gerado em `dist/` pelo build.

## 0.9.2 - 2026-06-22

Tipo: **hardening contratual, determinismo e portabilidade** (sem breaking; `CAPABILITIES_SCHEMA_VERSION` segue **v5**, modos públicos `full`/`direct`/`execute`/`interview-only` intactos). Três frentes de melhoria das skills.

Mudanças:
- **Routing/ownership** — matriz modo→executor fechada: `full`/`execute`→`atlas-plan-execute`, `direct`→`atlas-direct-execute`, todos preservando `phase: plan_execute`. `atlas-direct-execute` deixa de degradar para self-check quando subagente/MCP ausente → retorna `blocked` (alinhado ao gate PREREQ hard-fail). `interview-only` materializa PRD real via template antes de invocar `atlas-prd-interview`.
- **Evidência determinística / validator / repair** — state schema estendido de forma aditiva (`base_sha`/`head_sha`, `contract_kind`, `obligations[]`, `invariants[]`, `scenario_probes[]`/`risk_probes[]`, `validation_map[]`, `task_evidence[]`). MCP valida boundary real (`base_sha...head_sha` + delta de worktree vs `files_changed`); findings estruturados (`id/failure_mode/evidence/recommendation/fix_validation`) com rejeição de incoerência severidade×verdict; repair correlaciona finding→arquivo→check→status e recomputa boundary.
- **Portabilidade e qualidade documental** — gate da slice review portado de Python para Node (`classify_findings.mjs` canônico; wrapper `.py` legado por uma release, sem virar requisito). Baseline universal + perfis de stack (Flutter/Node/Python) — regras Flutter/GetX só ativam com sinal real do repo. Backlog update não-destrutivo (preserva IDs/sprints done/decisões). Sprint PRD com autoridade de fonte explícita. Interview host-agnostic via `atlas_capabilities` + persistência por rodada.
- **Testes/CI** — +20 testes no núcleo MCP (148 no total) + suíte de helpers (`classify-findings`, `etapa3`); job cross-OS prova gate documental sem Python em Linux/macOS/Windows.

## 0.9.1 - 2026-06-21

Tipo: **patch de distribuição** (sem mudança de schema/runtime; `CAPABILITIES_SCHEMA_VERSION` segue **v5**). Corrige o instalador do host Antigravity introduzido em 0.9.0.

Mudanças:
- **Fix — `init antigravity` via npx-from-GitHub** (`build/cli/atlas-init.mjs`). O instalador copiava skills e mcp-server de `ROOT/packages/` (`packages/skills`, `packages/orchestrator/...`, `packages/mcp-server`), mas `/packages/` é excluído do tarball npm por `.npmignore` — então `npx github:pauloborini/atlas-workflow init antigravity` abortava com `ENOENT` em `packages/skills`. Passa a copiar do bundle shipado `plugins/atlas-workflow-orchestrator/` (`skills/` já inclui a skill `atlas-workflow-orchestrator`; `packages/mcp-server/`), mesmo padrão de fonte dos demais hosts. Bug não pegava em testes locais porque o checkout do repo tem `/packages/`; só o caminho de instalação real (npx) era afetado.

## 0.9.0 - 2026-06-21

Tipo: **minor aditivo** — novo host **Antigravity (Gemini)**, sexto host suportado. **Sem breaking** (`CAPABILITIES_SCHEMA_VERSION` segue **v5**); comportamento dos hosts existentes preservado.

Mudanças:
- **Novo adapter `antigravity`** em `HOST_ADAPTERS` (`packages/mcp-server/server.js`, replicado nas 4 cópias de bundle). Subagente nativo via `define_subagent(name, system_prompt)` + `invoke_subagent(Subagents)`; `validator_dispatch.join.sync = self_evident` (`invoke_subagent` bloqueante por design do host); MCP nativo; sem todo nativo. `prereq_policy` default `self_evident` — host nativo, não exige `host_capabilities` (igual claude/codex/opencode).
- **Detecção** via `ATLAS_HOST=antigravity` (injetado no `mcp_config.json` pelo instalador) ou `arg host`. Mesmo padrão de injeção de opencode/pi; sem file-detection.
- **Instalador** (`build/cli/atlas-init.mjs`): `installAntigravity`/`uninstallAntigravity` instalam globalmente em `~/.gemini/config/` (plugin em `plugins/atlas-workflow-orchestrator/` + merge do MCP em `mcp_config.json`). Aliases `antigravity`/`gemini`/`antigravitycode`. `--global` é no-op (já global por natureza).
- **Robustez de runtime** (beneficia Antigravity, sem regredir os demais): (1) `cwd` igual a `/` ou `/var/folders` sem root explícito cai para `$HOME`; (2) gravação do `mcp.log` em `try/catch` (tolera diretório somente-leitura); (3) código de erro JSON-RPC sanitizado para inteiro (`Number.isInteger(code) ? code : -32603`, `original_code` preservado em `data`) — conformidade com clients estritos.
- **Docs**: `host-adapters.md` (matriz de adapters, 5 cópias), `README.md`, `COMMANDS.md` atualizados com o sexto host. Correção: Antigravity não gera artefato `.plugin` (instalação from-source por cópia direta).
- **Testes**: 4 testes novos cobrindo detecção, perfil de capabilities, prereq self_evident e presença em `HOST_NAMES` (`packages/mcp-server/server.test.js`).

## 0.8.3 - 2026-06-16

Tipo: **patch de confiabilidade runtime**. **Sem mudança de schema** (`CAPABILITIES_SCHEMA_VERSION` segue **v5**). Origem: post-mortem de travamento repetido em `plan_execute` (`atlas-plan-execute` despachado, sem `state_path`, sem progresso material e sem erro terminal), mesmo padrão já observado em S30/S32.

Mudanças:
- **Gate G12 — liveness do executor.** `atlas_lock_dispatch(action=start, phase=plan_execute)` passa a criar estado de liveness com deadline de bootstrap. O executor precisa emitir checkpoints via `atlas_lock_dispatch(action=checkpoint, phase=plan_execute, event=...)`.
- **Checkpoints materiais.** Eventos aceitos: `executor_started`, `skill_loaded`, `plan_loaded`, `handoff_accepted`, `task_started`, `first_write`, `state_path_created`.
- **Detecção de stall.** `atlas_lock_dispatch(action=status, phase=plan_execute)` transforma bootstrap vencido sem checkpoint em `blocked` com `cause: executor_bootstrap_timeout`; checkpoint antigo sem progresso novo vira `executor_progress_timeout`. Em ambos os casos persiste `executor_liveness.status = stalled`, libera o lock e aponta `next_action: retry_plan_execute`.
- **Checkpoint final enforçado.** `state_path_created` exige `state_path` legível/parseável. `atlas_lock_validator(start)` bloqueia em G12 se o executor não tiver emitido `state_path_created` para exatamente o mesmo `state_path`.
- **Contrato dos executores endurecido.** `atlas-plan-execute` e `atlas-direct-execute` agora devem emitir checkpoint antes de discovery/preflight interno longo; se MCP/checkpoint não for possível, retornam `blocked` em vez de ficar vivos sem progresso.
- **Contrato do orquestrador endurecido.** `atlas-workflow-orchestrator` documenta G12: sem retorno/progresso do sub-agent, consultar `status`; `stalled` nunca conta como execução em andamento nem permite `completed`.

Eficiência de token (sem mudança de contrato/determinismo):
- **Respostas MCP compactas.** `toolResult()` serializa com `JSON.stringify(value)` (sem `null, 2`). O consumidor é o LLM orquestrador, que parseia igual — pretty-print só gastava ~15% de tokens por resposta aninhada, em ~10-13 chamadas/run. Mesmos campos/valores. 125 testes intactos.
- **SKILL do orquestrador enxuto (−16%, 6441→5421 palavras).** Só prosa redundante: changelog embutido removido (CHANGELOG.md é canônico); regra de mutação-de-código/host-dispatch/decisão-em-aberto deduplicada (afirmada 1× + ponteiro, não 3-4×); bloco execução+validação fatorado num passo `[EXEC]` referenciado por `full`/`direct`/`execute` em vez de repetido verbatim; lista de padrões de ambiguidade §1-§5 apontada ao MCP (`atlas_scan_prd` aplica, orquestrador só consome). Tabela de gates, schema v5, banners e fluxos de decisão intactos; guards de prosa (`host_capabilities`/`atlas_preflight`/`dispatch_token`/`repair_run_id`/`repair_budget: 1`/`challenge_response`) preservados.

Impacto:
- Pipeline `full/direct/execute` mantém topologia sibling-only e schema v5.
- Hosts/callers antigos que só usam `start`/`complete` continuam compatíveis.
- Falha "executor spawned but not making progress" deixa de ser limbo silencioso e vira estado determinístico/retryável.

Arquivos/artefatos:
- `packages/mcp-server/server.js`
- `packages/mcp-server/server.test.js`
- `packages/skills/atlas-plan-execute/SKILL.md`
- `packages/skills/atlas-direct-execute/SKILL.md`
- `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`
- `VERSION`, manifests, catálogos `plugins/`, `hosts/opencode/`, `hosts/pi/`, `dist/`

Validação:
- `node --test packages/mcp-server/server.test.js` (125 testes)
- `node build/bump-version.mjs 0.8.3` (inclui `build/build-plugins.sh` + `node build/check-consistency.mjs`)

## 0.8.2 - 2026-06-16

Tipo: **packaging + docs + tooling**. **Sem mudança de schema** (`CAPABILITIES_SCHEMA_VERSION` segue **v5**) e **sem mudança de contrato runtime do MCP**.

Resumo: fecha o ciclo de release público da linha 0.8.x: bump correto pós-0.8.1, publicação npm preparada, CI de release mais seguro e documentação operacional de bump/release para IA.

Mudanças:
- **Bump para 0.8.2.** `VERSION`, `package.json`, `packages/mcp-server/package.json`, README, comandos e manifests/catálogos gerados passam a apontar para `0.8.2`.
- **Release npm.** `.npmignore` mantém o tarball pequeno e inclui só o instalador, `hosts/` e `plugins/` necessários para `npx`/`npm exec`; o workflow de release publica `atlas-workflow` com provenance e pula publish se a versão já existir.
- **CI de release endurecido.** `release.yml` valida tag `vX.Y.Z` contra `VERSION`, extrai release notes de `CHANGELOG.md` aceitando cabeçalho `## X.Y.Z` ou `## vX.Y.Z`, confere `package.json.version` antes de publicar e mantém assets `.plugin` + `SHA256SUMS` na GitHub Release.
- **Procedimento de bump para IA.** `PATCH_PROCEDURE.md` foi atualizado com passo a passo completo: preflight, classificação, arquivos obrigatórios, regeneração, validação local, validação npm, tag/push e verificação pós-release.
- **Doc drift corrigido.** `packages/orchestrator/README.md` e cópias empacotadas deixam de reportar `Plugin version: 0.8.0`.

Impacto:
- Instalação via `npx github:pauloborini/atlas-workflow init <host>` continua igual.
- Após tag `v0.8.2`, o release workflow deve publicar GitHub Release e pacote npm `atlas-workflow@0.8.2`.

Arquivos/artefatos:
- `VERSION`, `package.json`, `packages/mcp-server/package.json`
- `README.md`, `COMMANDS.md`, `PATCH_PROCEDURE.md`, `CHANGELOG.md`
- `.github/workflows/release.yml`, `.npmignore`
- `packages/orchestrator/README.md`
- `plugins/atlas-workflow-orchestrator/**`, `hosts/opencode/**`, `hosts/pi/**`
- `dist/atlas-workflow-{claude,codex,opencode,pi}.plugin`, `dist/SHA256SUMS`

Validação:
- `build/build-plugins.sh`
- `node build/check-consistency.mjs`
- `node --test packages/mcp-server/server.test.js`
- `node build/smoke-hosts.mjs`
- `node build/conformance-matrix.mjs`
- `(cd dist && shasum -a 256 -c SHA256SUMS)`
- `npm pack --dry-run --json`
- `npm exec --yes --package /tmp/atlas-npm-pack/atlas-workflow-0.8.2.tgz -- atlas-workflow --help`
- `npm exec --yes --package /tmp/atlas-npm-pack/atlas-workflow-0.8.2.tgz -- atlas-workflow init opencode --dry-run --dir /tmp/atlas-opencode-target`
- `npm exec --yes --package /tmp/atlas-npm-pack/atlas-workflow-0.8.2.tgz -- atlas-workflow init codex --dry-run`

## 0.8.1 - 2026-06-15

Tipo: **patch de confiabilidade de contrato** (só SKILL do orquestrador + command `/workflow`). **Sem código MCP**, **sem mudança de schema** (`CAPABILITIES_SCHEMA_VERSION` segue **v5**), **sem novos testes** (mudança documental/contratual). Origem: relato de **pausa indevida** no pipeline — o orquestrador parava pra pedir confirmação ("Quer que eu gere o PRD?", "Modo Discussão — sem alterar código") que o contrato não exige; em hosts com modelo diferente (ex.: Cursor) o mesmo plugin não parava. Causa-raiz: o SKILL definia **onde parar** (gates) mas nunca o default **"não parar"**, e um modelo de raciocínio alto preenchia o silêncio com confirmação educada.

Contrato (SKILL `atlas-workflow-orchestrator`):
- **Nova seção "Princípio de continuação automática (não-parada)".** Pipeline é **fire-and-continue**: uma vez iniciado, avança fase a fase sem pedir permissão entre gates. A única parada é **gate duro `blocked`** (PREREQ/DEP/G1–G11/TC) ou **blockage de ambiente real** (MCP morto, sub-agent não despachável, lock conflict, artefato corrompido). Proíbe explicitamente: confirmação discricionária ("posso seguir?", "continuo?", "quer que eu gere?"), inventar modo fora do contrato (**"Modo Discussão"/"modo análise"/"dry-run" não existem**), e parar por decisão em aberto. PRD ausente em `full`/`direct` **gera automático**. Pós-entrevista **retoma** plano→execução sem nova confirmação.
- **"Decisão em aberto ≠ parada" (reescreve "Lógica de decisão").** Decisão pendente de **qualquer fonte** (scan de PRD, entrevista, `PERGUNTAS_EM_ABERTO.md`, doc de discussão/decisões `DISCUSSAO_*.md`, ou o próprio backlog) **não bloqueia**: dispara `atlas-prd-interview`, propaga ao PRD/plano/DEC/registro de origem e **continua**. **Sequência travada:** em `full`/`direct`, se não há PRD, gera o PRD draft **primeiro** (entrevista é PRD-scoped, roda **sobre** o PRD — detectar decisão não antecipa nem pula a geração). Removido o menu "A) resolver / B) seguir com TBD / C) adiar" e o "responda só: seguir com recomendação ou D=..." como pontos de parada — default é gerar PRD, resolver via entrevista e seguir; adiar só por pedido explícito do usuário. Origem do refino: repro real em 0.8.0 (Codex full backlog-item S40) parou com menu de decisões `DISCUSSAO_ENDPOINT_JORNADA.md` sem puxar a entrevista.
- **`PERGUNTAS_EM_ABERTO.md` deixou de ser parada.** Q- aberta relacionada à sprint **não é blockage** — vira entrevista + propagação + continuação (antes: "informa ao usuário e para/aguarda decisão").
- **Novo Gate DEP** (tabela de gates duros + check na Fase 0): se o input é `backlog-item` e uma `Dependência` declarada não está `done` no backlog/registro de origem, **hard-fail determinístico** em `ready` (`unmet_dependencies`, causa, `next_action`) — sem pergunta, sem improviso. Distinto de decisão em aberto (que não bloqueia).

Command `/workflow`: reforça fire-and-continue e proíbe "Modo Discussão"/pedido de permissão; aponta para "Princípio de continuação automática".

Sincronização: edição no canônico `packages/orchestrator/{skills,commands}`; `build/build-plugins.sh` regenera `plugins/atlas-workflow-orchestrator/`, `hosts/opencode/` e `hosts/pi/`. `check-consistency` ok, `plugin validate --strict` ok.

## 0.8.0 - 2026-06-15

Tipo: **feature de determinismo** (novo mecanismo de gate). **Sem breaking de contrato `atlas_capabilities`** (`CAPABILITIES_SCHEMA_VERSION` segue **v5**); adiciona enforcement novo ao Gate G4. Origem: P1.1 camada 1 do relatório de melhorias.

Proof-of-work do validador frio (Gate G4, R20):
- **`atlas_lock_validator(action=start)`** lê o `state_path`, escolhe 1 arquivo do `files_changed` do boundary e emite um `challenge` `{ file, algo: "sha256" }`. O challenge vai ao validador irmão via `validator_recovery.challenge` (canal canônico) e é ecoado na resposta do start.
- **O validador irmão** computa o sha256 dos bytes crus do arquivo e devolve em `challenge_response` no output (mesma proveniência do `dispatch_token`: vem do validador, nunca é preenchido pelo orquestrador).
- **`atlas_lock_validator(action=complete)`** recomputa o hash do disco e compara. Divergência ou ausência de `challenge_response` quando um challenge foi emitido → `blocked` com `validator_status: "challenge_failed"`, **sem fechar o slot** (igual stale): o orquestrador re-despacha o mesmo validador, que lê o boundary e reenvia o hash. O hash esperado **nunca** é armazenado em estado legível — é recomputado on-demand, então o orquestrador não consegue copiá-lo.
- **Re-dispatch bounded (fail-closed):** o re-despacho de `challenge_failed` tem teto por attempt (`VALIDATOR_CHALLENGE_MAX_FAILURES`). Esgotado, o slot fecha terminal com `validator_status: "challenge_exhausted"` (`cause: validator_proof_of_work_exhausted`) em vez de loopar — protege contra mismatch sistemático (ex.: validador resolvendo o path do challenge com CWD diferente do consumer root do MCP).
- **Best-effort, não-quebrante:** boundary sem arquivo legível (ou `files_changed` vazio) → `challenge: null` → sem enforcement (compat com validações sem boundary materializado). Arquivo que some entre start e complete → `unverifiable`, não bloqueia.

Escopo honesto (mantido de 0.7.1): proof-of-work é **atestação mecânica** de que o veredito tocou bytes reais do boundary — eleva o piso do atalho preguiçoso (afirmar `pass` sem ler código) e dá rastro de auditoria (`challenge_verified` no retorno). **Não** é prova de isolamento criptograficamente não-forjável: o MCP fala stdio com um único caller e não distingue orquestrador de subagente. A prova forte depende de identidade por-caller do host (camada 2 / S22).

Skill enxugada (P2.3): o changelog embutido na SKILL do orquestrador foi reduzido às 4 versões recentes + ponteiro para este `CHANGELOG.md` (fonte canônica). Tabela de gates G1–G11 e contrato de execução intactos.

Testes: 120 (era 111) — +9 cobrindo emissão de challenge, hash correto, hash errado/ausente (block sem fechar slot), saída do `shasum`, boundary sem arquivo, challenge re-emitido e enforçado no attempt 2 (fail→repair→retry), arquivo que some entre start e complete (`unverifiable`) e teto de re-dispatch (`challenge_exhausted`, fail-closed). `check-consistency` (guards de challenge_response no validador e no orquestrador) ok, `plugin validate --strict` ok.

## 0.7.2 - 2026-06-15

Tipo: **patch de confiabilidade** (correção de bug + cobertura de CI + doc). **Sem breaking**, **sem mudança de comportamento de pipeline**, `CAPABILITIES_SCHEMA_VERSION` segue **v5**. Origem: análise consistente do MCP/orquestrador/skills/build.

Correções:
- **Drift `ping().capabilities` × `toolsList()` (P0 — bug latente de contrato).** A lista de capabilities do `atlas_ping` era mantida à mão em paralelo ao dispatcher e à `toolsList()`, e já omitia `atlas_classify_input`: o orquestrador (Fase 0) aborta se uma capability exigida pelo modo não aparece no ping, então a divergência podia travar run válida. Agora `ping().capabilities` é **derivado de `toolsList().tools`** — fonte única, sem lista paralela. Guard cruzado novo em `server.test.js` (`ping` cobre exatamente a superfície de tools). (`server.js` `ping`.)

Cobertura/CI:
- **Smoke runtime em Windows/macOS.** Novo job `cross-os` no CI roda núcleo MCP + `smoke-hosts` + `conformance-matrix` em `windows-latest` e `macos-latest` (só Node puro; build bash/checksums seguem no job ubuntu). Fecha parte de T07/T08 da auditoria de maturidade (runtime MCP cross-OS não provado por CI).

Documentação:
- **Proveniência do `dispatch_token` no validator SKILL.** Nota cruzada com G4/R19: quem lê `validator_recovery` e ecoa `expected_dispatch_token` é o próprio validador irmão; o orquestrador nunca preenche o token por conta própria. Remove leitura ambígua da regra de cópia do token.
- **`.gitattributes`.** Marca `hosts/`, `plugins/`, `.agents/`, `archive/`, `dist/` como `linguist-generated` (colapsa diffs no GitHub, sinaliza que são cópias geradas por `build/build-plugins.sh`).

Limite conhecido (mantido de 0.7.1): R17/R19 não são prova de isolamento criptograficamente não-forjável — o MCP fala stdio com um único cliente e não distingue caller. Prova de isolamento mais forte segue para sprint futura (S22).

Testes: 111 (era 110) — +1 guard cruzado ping/tools. `check-consistency` ok, `plugin validate --strict` ok.

## 0.7.1 - 2026-06-14

Tipo: **patch de confiabilidade** (correção de bugs + endurecimento de skill). **Sem breaking**, **sem mudança de comportamento de pipeline**, `CAPABILITIES_SCHEMA_VERSION` segue **v5**. Origem: smoke S18 multi-host real (Claude Code, Codex, Cursor, opencode) — 4 de 5 hosts PASS em tarefas reais, com 3 bugs e 2 furos de contrato identificados pelos relatórios de execução.

Correções:
- **State drift `dispatch.active` (P2 — Codex + opencode).** `atlas_run_state(action=upsert)` com `data` parcial fazia **replace cego** do `data` inteiro, apagando `data.dispatch.active={plan_execute}` quando o executor persistia o handoff. O `atlas_lock_validator(start)` seguinte bloqueava ("plan_execute não ativo") e o orquestrador precisava reabrir a fase na mão. Agora o upsert faz **merge top-level**: chaves novas entram sem derrubar `dispatch`/`routing`/`validator_cycle`/`gates`. (`server.js` `upsertState`.)
- **Version-conflict travava todo run novo.** `findActiveRunConflict` dava hard-fail de versão em **qualquer** `run.json` do diretório, inclusive runs antigos **inativos** — quem atualizava de 0.6.x ficava com todo run novo bloqueado até limpar `.atlas/state/` na mão (viola "atualização simples"). Agora só bloqueia em conflito de lock **real**: outro run com `dispatch.active` **e** versão atual. Run inativo/de versão anterior é resíduo, ignorado. (`server.js` `findActiveRunConflict`.)
- **Banner cosmético na verificação de PRD.** `atlas_verify_artifact` sempre ecoava `▸ atlas: plano · validado` mesmo verificando um PRD. Adicionado param opcional aditivo `artifact_kind` (`prd`|`plan`): `prd` → banner de PRD; ausente/`plan` mantém o banner de plano (compat com callers antigos).

Endurecimento (skill do orquestrador, Gate G4):
- **R17 — falha de dispatch do validador em runtime = `blocked`, nunca inline.** Cláusula explícita: se o despacho do `task_validator` errar ou não retornar (sub-agent que falha, host sem sub-agent vivo), a slice **bloqueia** com causa — proibido validar inline ou relatar veredito que o irmão frio não produziu. Não há caminho de degradação.
- **R19 — proveniência do `dispatch_token`.** O token submetido no `lock_validator(complete)` tem que ser o que **o próprio validador irmão devolveu no output** — não um valor lido de `validator_recovery` e repassado sem o irmão ter rodado. `validator_recovery` serve para reconhecer/descartar stale, não para fabricar token de validador que não executou.

Limite conhecido (honesto): R17/R19 **não** são prova de isolamento criptograficamente não-forjável. O MCP fala stdio com um único cliente e não distingue orquestrador de sub-agente; um token sempre é tecnicamente reproduzível pelo orquestrador. O endurecimento acima fecha o atalho preguiçoso (o threat model real: LLM tomando atalho), não um adversário com acesso ao código. Prova de isolamento mais forte fica para sprint futura (S22).

Testes: 110 (era 107) — +3 regressões cobrindo merge de upsert parcial, version-conflict de run inativo e banner por `artifact_kind`. `check-consistency` ok, `plugin validate --strict` ok.

## 0.7.0 - 2026-06-11

> ⚠️ **BREAKING (consumidores MCP):** `validator_dispatch` agora expõe apenas `{ dispatcher, join }`. Quem lia `validator_dispatch.topology`, `nested_subagent_available` ou `repair_loop` **DEVE migrar** para `validator_dispatch.join` e assumir sibling incondicionalmente. `CAPABILITIES_SCHEMA_VERSION` salta 3 → 5. **Comportamento de execução do pipeline: inalterado.** Bump minor pré-1.0 é proposital (SemVer 0.y.z permite breaking sem major).

Tipo: **breaking de contrato `atlas_capabilities`** (schema v3 → v5; topologia única). Pré-1.0 → bump minor consciente; **sem mudança de comportamento de execução** e **sem mudança na superfície de instalação do usuário**.

Resumo: purga total do conceito `nested` do produto. A topologia do validador frio (Gate G4) passa a ser **sibling em todos os hosts**: o executor escreve `state_path` e encerra, e o orquestrador despacha `atlas-task-validator` como sub-agent irmão isolado. Consolida as decisões DEC-SIB-001/002/003/004.

Mudancas:
- **`nested` removido por completo** de runtime, skills e docs vivas (README, SKILL.md do orquestrador, comentários do MCP). `CHANGELOG.md`, `reports/*` e `archive/*` preservam o termo como histórico.
- **Sibling é a única topologia** (DEC-SIB-001/003): o executor nunca despacha o validador; o orquestrador é sempre o `dispatcher`. Acaba a variante em que o executor disparava um validador aninhado.
- **Gate JOIN no preflight** (DEC-SIB-003): host sem join síncrono confiável do validador é **rejeitado no preflight (hard-fail)**, não degradado. `validator_dispatch.join { sync, confidence, mechanism }` declarado por host.
- **`dispatch_token` monotônico** e **máximo de 2 validators inviolável por contrato** (DEC-SIB-002): o 3º validator é proibido; 2º `fail` termina a slice em `blocked`.
- **Correlação obrigatória no retorno:** `atlas-task-validator` devolve `dispatch_token`; `atlas_lock_validator(action=complete)` rejeita retorno sem token ou divergente sem fechar o slot.
- **Repair correlacionado:** `repair_start` retorna `repair_budget: 1`; `atlas-findings-repair` recebe `repair_run_id` e atualiza o mesmo `state_path` em lugar. Redirecionar boundary no `repair_complete` é bloqueado.
- **Recovery de orquestrador re-spun** via `validator_recovery`: retornos de validator divergentes do slot ativo voltam `stale_discarded: true` e são descartados (idempotente, slot não reabre).
- **`CAPABILITIES_SCHEMA_VERSION`** evoluiu de v3 → v5: v4 colapsa `validator_dispatch` para `{ dispatcher: 'orchestrator' }` (remove os campos de topologia legada); v5 adiciona `validator_dispatch.join` por host (gate JOIN).
- **Guard de contrato reforçado** em `server.test.js`: assert de forma `Object.keys(validator_dispatch) === ['dispatcher','join']`, provando que os campos de topologia legada sumiram sem nomeá-los.

Impacto:
- Comportamento de execução do pipeline é idêntico (Codex já era sibling); os demais hosts convergem para o mesmo modelo determinístico.
- Consumidores que liam `validator_dispatch.topology`/`nested_subagent_available`/`repair_loop` devem assumir sibling incondicionalmente; estado antigo em disco é rollback-safe (campos extras ignorados).

**Nota de migração (BREAKING):**
- Consumidores do MCP que liam `validator_dispatch.topology` (ou `nested_subagent_available`/`repair_loop`) devem migrar para `validator_dispatch.join` — o objeto agora expõe apenas `{ dispatcher, join }`, sem campos de topologia legada.
- A topologia é **sempre sibling**: o orquestrador é o único `dispatcher` do validador; nenhum executor despacha validador aninhado.
- **Host sem join síncrono confiável do validador é rejeitado no preflight (hard-fail)** — não há degradação. Hosts devem declarar `validator_dispatch.join { sync, confidence, mechanism }`.
- `CAPABILITIES_SCHEMA_VERSION` salta de 3 → 5. Estado antigo em disco é rollback-safe (campos extras ignorados), mas leitores devem reconhecer schema 5.

Arquivos/artefatos:
- `VERSION`, `.claude-plugin/plugin.json`, `package.json`, `packages/mcp-server/package.json`
- `README.md`, `COMMANDS.md`, `packages/orchestrator/README.md`
- `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`
- `packages/mcp-server/server.js`, `packages/mcp-server/server.test.js`
- `hosts/**`, `plugins/**` (espelhos regenerados por `build/build-plugins.sh`)

Validacao:
- `grep -rni "nested" packages/ agents/ README.md hosts/ plugins/` (vazio, exceto falso-positivo `redact()`)
- `bash build/build-plugins.sh` (`check-consistency: ok`)
- `claude plugin validate ./ --strict`
- `bash build/test-all.sh`

## v0.6.2 - 2026-06-08

Tipo: **runtime + packaging + docs** (sem breaking).

Resumo: adiciona a skill explícita `atlas-backlog-generator` para criar backlog mestre Atlas a partir de ideia, prompt ou conversa, usando o template canônico com MoSCoW e esforço x ganho.

Mudancas:
- **Nova skill documental explícita:** `atlas-backlog-generator` cria ou atualiza `BACKLOG_MESTRE_*.md` somente quando o usuário aciona a skill explicitamente; não há `allow_implicit_invocation` e não entra na cadeia automática do workflow.
- **Destino padrão Atlas:** quando o usuário não especifica path, o backlog é salvo em `.atlas/backlog/BACKLOG_MESTRE_<slug>.md` no projeto consumidor.
- **Template de backlog priorizável:** `BACKLOG_MESTRE_TEMPLATE.md` passa a incluir MoSCoW, ganho, esforço, prioridade, regra de escolha da próxima sprint e justificativa de priorização.
- **Mapa oficial e distribuição:** `atlas-backlog-generator` entra no mapa de skills do MCP e é empacotada para Codex, Claude/Cursor, opencode e pi via build.
- **Docs alinhadas:** README, boundary de templates, manifestos e documentação do orquestrador deixam claro que backlog é uso preparatório explícito, fora da cadeia automática.

Impacto:
- Usuários podem criar backlog mestre pronto para alimentar `atlas-sprint-prd-generator`, com fases, sprints, dependências, riscos, gates e priorização objetiva.
- O pipeline automático existente permanece igual: PRD → entrevista → plano → execução → validação fria → review opcional.
- Hosts continuam instaláveis por marketplace/from-source; o patch exige rebuild dos bundles por alterar `packages/`, manifests e catálogos host.

Arquivos/artefatos:
- `packages/skills/atlas-backlog-generator/**`
- `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`
- `packages/mcp-server/server.js`
- `packages/templates/BOUNDARY_PRD_PLAN.md`
- `packages/orchestrator/**`, `README.md`, `plugin-manifests/**`
- `plugins/atlas-workflow-orchestrator/**`, `hosts/opencode/**`, `hosts/pi/**`
- `dist/atlas-workflow-{claude,codex,opencode,pi}.plugin`, `dist/SHA256SUMS`

Validacao:
- `build/build-plugins.sh`
- `node build/check-consistency.mjs`
- `node --test packages/mcp-server/server.test.js`
- `(cd dist && shasum -a 256 -c SHA256SUMS)`
- `unzip -t dist/atlas-workflow-{claude,codex,opencode,pi}.plugin`
- `unzip -p dist/atlas-workflow-claude.plugin .claude-plugin/plugin.json`
- `unzip -p dist/atlas-workflow-codex.plugin .codex-plugin/plugin.json`
- Observação: `Codex plugin validate ./ --strict` não está disponível neste CLI local (`codex plugin` não possui subcomando `validate`).

## v0.6.1 - 2026-06-08

Tipo: **patch** (sem breaking).

Resumo: alinha o contrato multi-host do pipeline para que **toda autoria documental fique no orquestrador** e os **únicos sub-agents** sejam execução, validação fria e review.

Destaques:

- **Fronteira do orquestrador clarificada:** `prd_generator`, `atlas-prd-interview` e `atlas-plan-handoff` passam a ser documentados explicitamente como fases conduzidas no fio principal/orquestrador. O primeiro sub-agent obrigatório do modo `full` nasce só em `atlas-plan-execute`.
- **Topologia nested esclarecida sem ambiguidade:** em hosts `nested`, o feedback do `atlas-task-validator` é consumido dentro do próprio executor; findings intermediários não sobem ao avô/orquestrador. Em Codex (`sibling`), o loop continua `executor → validator irmão → novo executor` apenas em `fail`.
- **Checklist de preflight do orquestrador ajustado:** o passo de verificação de despachabilidade no SKILL do orquestrador (G10) agora distingue skills **documentais** (basta invocabilidade no fio principal) de skills de **execução/validação/review** (precisam ser despacháveis como sub-agent no host). Sem mudança de código no tool `atlas_preflight` — apenas bump de versão no `mcp-server`.
- **Docs cross-host sincronizadas:** README principal, skill do orquestrador, executores, READMEs auxiliares e cópias espelhadas (`packages/`, `plugins/`, `hosts/pi/`) foram alinhadas para o mesmo contrato operacional.
- **Versionamento/documentação atualizados:** bump para `0.6.1`, smoke examples e metadados de release atualizados.

Validação: `build/check-consistency.mjs` verde após sincronização cross-host. Sem mudança de `schema_version` (permanece **3**).

## v0.6.0 - 2026-06-07

Tipo: **breaking de UX** (remove alias ambíguo).

Resumo: remove o alias `/workflow plan <PLAN.md>` do modo `execute`.

Destaques:

- **Modo único para plano existente:** executar um `PLAN_*.md` pronto agora deve usar somente `/workflow execute plan <PLAN.md>`.
- **`plan` deixa de ser aceito como modo/alias:** o termo é ambíguo com planejamento documental e gerava leitura errada na landing/UX ("plan" parecia planejar, mas executava mutação de código).
- **Contrato preservado:** `plan` continua válido como `input-type`/`artifact_type` para arquivos `PLAN_*.md`; a remoção afeta apenas o modo/atalho `/workflow plan`.
- **Guard de teste:** `WORKFLOW_CONFIG.modes` agora afirma explicitamente que `plan` não é modo válido.

Migração: trocar `/workflow plan <PLAN.md>` por `/workflow execute plan <PLAN.md>`.

## v0.5.5 - 2026-06-06

Tipo: **breaking aditivo** (schema_version 2 → 3 em `atlas_capabilities`; novo campo `validator_dispatch`). Campos v2 permanecem; consumidores antigos seguem funcionando, mas o contrato G4 muda no Codex.

Resumo: corrige duas violações de isolamento descobertas em smoke G9 multi-host real (cobre v0.5.3 + v0.5.4 + v0.5.5 acumulados):

- **Codex — validador frio agora é `sibling`, não `nested`.** No Codex atual, sub-agents não recebem `spawn_agent` → executor sub-agent não consegue disparar neto (validator aninhado). Em vez de degradar (rodar validator no fio principal = violação de G4/G9), o pipeline troca a **topologia**: executor termina ao escrever `state_path`; orquestrador despacha `atlas-task-validator` como **sub-agent irmão** isolado e re-despacha executor só em `fail` (loop de reparo P1/P2 fora do executor original). Topology resolvida via novo `atlas_capabilities.validator_dispatch.{topology,nested_subagent_available,dispatcher,repair_loop}`. Hosts `nested` (Claude/Cursor/opencode/pi) seguem inalterados; `generic` = `host_defined`. Remove `agents.max_depth=2` do gerador Codex (promessa falsa neste runtime). G9 e G4 preservados semanticamente (validator sempre frio e isolado, com contexto próprio).
- **pi — executores agora carregam o contrato.** pi não tem skill loader no contexto de sub-agente: os shims finos (`atlas-plan-execute`, `atlas-direct-execute`, `atlas-slice-review`) falhavam antes do G4 ao tentar carregar `SKILL.md`. `build/gen-host-agent.mjs` agora **embute** o contrato canônico de `packages/skills/<name>/SKILL.md` no agente pi gerado (mesmo padrão auto-contido que o validator já usa). Fonte única segue o `SKILL.md`; o agente pi é cópia gerada (regenerável, nunca editada à mão). Demais hosts (Claude com tool `Skill`, Codex, opencode com loader) mantêm shim fino.
- **Install global do pi — agora copia `skills/`.** `installPiGlobal` no `atlas-init.mjs` esquecia de copiar `<repo>/hosts/pi/skills/` (omissão vs install de projeto e vs `installOpencodeGlobal`). Agora copia para `<agentDir>/skills` mantendo o mesmo offset relativo do server; `uninstallPiGlobal` remove. Bug independente da versão.
- **Dispatch host-agnóstico (consolidado de v0.5.3).** Prosa do orquestrador deixa de mandar "Agent tool" (verbo Claude) e passa a ler `atlas_capabilities.subagent_dispatch.mechanism` para o verbo nativo do host (resolve `generalPurpose` improvisado em Cursor/Codex/generic). Autoria inline de PRD estampa `Status: Aprovado para implementação`. `atlas_classify_input` trata input livre (idea) com status `not_a_file`/`direct` em vez de BLOCK genérico.
- **Documentação explícita.** README ganha seção "Topologia do validador frio (G4) por host" com tabela `nested`/`sibling`/`host_defined` e critério PASS do smoke G9 por topologia. Adapter `host-adapters.md` espelha as topologias por host.

Migração: ler `validator_dispatch.topology` antes de dispatch — `nested` (filho do executor) ou `sibling` (irmão pelo orquestrador). Schema v2 segue válido (campos preservados); consumidor que ignorar `validator_dispatch` continua no comportamento `nested` legado, mas não funciona no Codex. Smoke G9: aceitar a topologia correta do host como PASS — "validator aninhado literal" no Codex é leitura errada do contrato (host suporta só filho/irmão, não neto). Validação: 57/57 testes · conformance 5×9 · `smoke-hosts` (sv=3) · `smoke-install` · `claude plugin validate ./ --strict` — tudo verde.

## v0.5.0 - 2026-06-05

Tipo: **breaking** (contrato de conformância de PRD). Sem dual-format — corte limpo.

Resumo: **enxuga o template de PRD de 14 → 6 seções + apêndice opcional**, atacando a causa real de PRDs inchados (repetição entre seções) com a regra **"fonte única + referência"**. O MCP passa a aceitar **somente o formato canônico novo**; PRDs no formato antigo (14 seções) deixam de conformar (`atlas_verify_template_conformance`). Sem fallback (alinhado a "Determinismo > alcance").

Destaques:

- **Novo modelo de PRD (6 seções + §7 apêndice opcional):** §1 Contexto e objetivo · §2 Escopo · §3 Decisões (D*) · §4 Fluxos e cenários UX · §5 Contrato funcional e invariantes · §6 Critérios de aceite. Colapsa §1+§2+§3 (contexto), funde §6 regras em §5 contrato, remove §7 antes/depois, e move §11–§14 para o apêndice. "Não objetivos" sai de §4 (Em/Fora de escopo bastam).
- **Regra anti-repetição:** cada verdade tem uma casa; demais seções referenciam por `§`/`D-id`. Medido num PRD real (S26): 261 → ~135 linhas, sem perder nada que os gates consomem.
- **Demarcação preservada como requisito** (separadores, `**Label:**`, subcabeçalhos `### N.x`, headers de tabela, grupos de aceite) — guia leitura humana e padroniza output da LLM geradora.
- **MCP renumera os âncoras do scan** (`PRD_PATTERNS`/`SECTION_HEADING`/`SECTION_LABELS`/`REQUIRED_PRD_SECTIONS`): objetivo→§1, escopo→§2, decisões→§3, fluxos→§4, contrato→§5; conformância exige §1–§6 + 4 grupos de aceite + ≥1 checkbox + status.
- **Cross-refs remapeados** em `atlas-plan-handoff`, `atlas-task-validator`, `atlas-plan-execute` (+`plan-contract.md`), `atlas-prd-interview`, orquestrador (scan), `BOUNDARY_PRD_PLAN.md`, `PLAN_TEMPLATE.md`: `PRD §5→§3`, `§8–10→§4–6`, `§9→§5`, `§13→§7`.
- **Disciplina do executor + validador** (do mesmo ciclo de trabalho): `pass`/`pass_with_observations` estritamente terminais (só `fail` reabre o loop); dispatch do validador é blocking — gates locais antes, espera ociosa depois.
- **Rigor determinístico do `atlas-task-validator`:** severidade alinhada com `atlas-slice-review` (`P0/P1/P2/P3`) e regra mecânica de veredito (`P0/P1 => fail`, `P2 => pass_with_observations`, `P3 => pass`). Fecha falso-verde em que o modelo podia devolver `pass` com finding bloqueante no array.

Migração: **corte limpo, sem período de tolerância.** PRDs antigos precisam ser reescritos no modelo novo (este CHANGELOG + `PRD_TEMPLATE.md` são o guia). Conformance: 54 testes verdes; `check-consistency`, build dos 4 bundles e `plugin validate --strict` verdes.

## v0.4.1 - 2026-06-05

Tipo: aditivo (sem breaking; preserva `full`/`direct`/`interview-only` da v0.4.0).

Resumo: adiciona o modo de execução **`execute`** (executa um `PLAN_*.md` pronto sem regerar plano), **roteamento por tipo de input** com guardrail anti "plano-de-plano", **protocolo de banner de fase** de linha única (fonte única no MCP) e firma o **princípio standalone pela mutação de código**.

Destaques:

- **Modo `execute`** (+ alias `/workflow plan <PLAN.md>`): recebe um plano pronto, reverifica artefato + conformidade de template na entrada e despacha `plan_execute` direto. Não replaneja. `atlas_assert_after_plan` não se aplica (o plano é o input).
- **Roteamento por tipo de input** (`atlas_classify_input`): classifica `backlog|prd|plan|unknown`; o tipo de input prevalece sobre o modo pedido. `PLAN_*.md` em `direct`/`full` (mesmo renomeado) auto-roteia para `execute` com aviso; `execute` sobre backlog/PRD roteia para `full`/`direct`; `unknown` pede esclarecimento. Verdade-forte = conformidade de template de plano.
- **Banner de fase**: comunicação de progresso só por linha única `▸ atlas: <fase> · <ação>` em pt-BR; banco canônico de 11 templates no MCP; cada gate de tool devolve o campo `banner` pronto e o orquestrador só ecoa.
- **`guarantee_level`** (enum `full_pipeline` | `reduced_standalone`) declarado no output das pipelines; modos sem execução (interview-only) omitem o campo.
- **Fronteira documental-no-agente-principal** (G3/G7/G9): autoria de PRD/entrevista/plano livre no fio principal antes do plano validado; mãos atadas fortes depois. Execução de código continua sempre em sub-agent + validador frio — não afrouxa.
- **Princípio standalone** nas skills documentais/leitura + invariante de re-validação ("autoria é livre, execução é gateada"); `atlas-slice-review` standalone com rótulo de garantia reduzida obrigatório.

Conformance: `build/conformance-matrix.mjs` cobre o modo `execute` nos 5 hosts. Sem regressão (53→54 testes verdes); `build/check-consistency.mjs`, `smoke-hosts`, `smoke-install`, checksums e `unzip -t` dos 4 bundles verdes.

## v0.4.0 - 2026-06-02

Tipo: multi-host (aditivo; sem breaking para Claude/Cursor/Codex)

Resumo: expande o Atlas para arquitetura multi-host por adapter data-driven, adicionando **opencode** e **pi cli** além de Claude Code, Cursor e Codex, com determinismo garantido por hard-fail no preflight.

Hosts suportados: `claude`, `cursor` (carona no manifest claude), `codex`, `opencode`, `pi`, `generic`.

`atlas_capabilities` schema_version: **2** (aditivo — `capabilities_flags`, `hooks`, `prerequisites`, `required_deps`, `prereq_policy`; consumidores devem ignorar campos desconhecidos).

Mudancas:
- contrato `HostAdapter` data-driven em `HOST_ADAPTERS` (`capabilities_flags`, `hooks`, `prerequisites`) — adicionar host = adicionar entrada, sem ramo `if host==` (DEC-007);
- gate `PREREQ` no `atlas_preflight`: pré-requisito essencial (subagente/MCP) ausente → hard-fail, qualquer tamanho, sem degradação/inline (DEC-004); `todo` não-essencial segue sem mirror;
- **determinism hardening (fail-closed):** hosts `must_report` (pi/generic) só passam o PREREQ com `host_capabilities` afirmativo — sem report, falha-fechado (a garantia vira contrato, não otimismo do perfil). Nativos (claude/codex/opencode) são `self_evident`. `atlas_capabilities` expõe `prereq_policy`; override de `host_capabilities` delimitado às flags conhecidas no servidor; guard de prosa garante que o SKILL do orquestrador preserve o passo de report;
- conformance com asserts reais: veredito do validator validado por `JSON.parse` (não só regex); célula de preflight PASS exige `status:passed`+`gate:G10`;
- helper `build/install-host.sh <opencode|pi> <target>` (1 comando, idempotente) para install/update dos hosts sem marketplace CLI;
- **fix de packaging pi (validado no pi real `@earendil-works/pi-coding-agent` + `pi-mcp-adapter`/`pi-subagents`):** MCP em `.mcp.json` no root (não `mcp.json`, que o pi-mcp-adapter não descobre); subagente em `.pi/agents/` (não `agents/`, fora da descoberta do pi-subagents); dispatch real via tool `subagent({ agent, task })` (não `@name` nem MCP) registrado em `HOST_ADAPTERS.pi`; frontmatter do agente pi com `tools: read, grep, find, ls, bash` (read-only, casa com o contrato do validator). opencode validado ponta-a-ponta no opencode real (MCP + subagente + veredito);
- conformance documenta escopo honesto: exercita só a lógica do MCP server (env `ATLAS_HOST`), não a integração das extensões de host (cobertas por teste manual no host real);
- CI endurecida: catálogos `plugins/`/`hosts/` checados via `git status --porcelain` (pega arquivo untracked, não só diff de rastreado);
- **instalador unificado via npx-from-GitHub** (`build/cli/atlas-init.mjs`, bin `atlas-workflow` no `package.json` raiz): `npx github:pauloborini/atlas-workflow init|uninstall <claudecode|cursor|codex|opencode|pi>` — 1 comando por host, sem clonar o repo. claude/codex orquestram o instalador nativo da CLI; opencode/pi colocam (init) ou removem cirurgicamente (uninstall) o catálogo from-source no diretório alvo, preservando config/skills do usuário e outros servers MCP. Flags `--dir`, `--yes` (auto-deps pi), `--dry-run`. Versão do `package.json` raiz entra no guard de drift;
- **install não-destrutivo (pi):** `init pi` passou a **mesclar** a chave `mcpServers.atlas-workflow` no `.mcp.json` existente em vez de sobrescrever o arquivo (preserva outros MCP servers do usuário) — espelha o merge do opencode. Guard `assertConfigParseable`: se o config do usuário existir mas for JSON inválido, aborta **antes** de copiar qualquer arquivo (sem install parcial, sem tocar a config). Dica pós-install corrigida (não manda mais disparar o validator com `<state_path>` literal, que gerava P1);
- **instalação `--global` para opencode/pi** (paridade com claude/codex, que já são globais): `init|uninstall <opencode|pi> --global` instala em `~/.config/opencode/` / `~/.pi/agent/` (honra `XDG_CONFIG_HOME` e `PI_CODING_AGENT_DIR`), valendo em todos os projetos. Runtime vai para local estável e o MCP é registrado com **caminho absoluto** (independe de cwd); agente do opencode em `~/.config/opencode/agents/` (descoberta confirmada via `opencode agent list`), do pi em `~/.agents/` se existir senão `~/.pi/agent/agents/` (replicando a escolha do pi-subagents). Config mesclada de forma cirúrgica; uninstall remove só os artefatos do Atlas, preservando dirs compartilhados (`~/.agents`) e demais servers/skills;
- detecção de host data-driven (`HOST_DETECTORS`); enum dos schemas derivado de `HOST_ADAPTERS` (sem hardcode);
- adapter **opencode**: perfil + `.opencode/` (agents/skills) + `opencode.json` (MCP local, `ATLAS_HOST=opencode`) + bundle + catálogo from-source `hosts/opencode/`; **`todo_tool: 'todowrite'`, `todo_available: true`** (todo nativo confirmado no opencode real; perfil estava desatualizado com `false`);
- adapter **pi**: perfil + 2 deps obrigatórias (`pi-mcp-adapter` + `pi-subagents`, DEC-005) + `mcp.json` + bundle + catálogo `hosts/pi/`;
- guards estendidos: existência+versão dos catálogos, veredito do validator cross-host, skills sem hardcode de host;
- testes do núcleo (`node --test`), smoke por host e matriz de conformance (5 hosts × 5 cenários);
- CI multi-host (`.github/workflows/ci.yml`); release publica os 4 bundles.

Distribuição: install primário marketplace-from-source preservado para Claude/Cursor/Codex (sem regressão); opencode/pi instaláveis via catálogo from-source commitado (DEC-008).

## v0.3.0 - 2026-06-01

Tipo: runtime

Resumo: refatora o Atlas Workflow Orchestrator para família única `atlas-*`, validator subagent e paths canônicos `.atlas/`.

Mudancas:
- colapsa a cadeia para 7 skills `atlas-*`;
- remove o lock MCP de família e o parâmetro de família de `atlas_preflight`/`atlas_lock_dispatch`;
- registra `atlas-task-validator` como subagent e define boundary `.atlas/state/<run_id>/<slice>.json`;
- troca o veredito do validator para JSON estruturado;
- promove `.atlas/plans/` e `.atlas/state/` como paths canônicos;
- restringe `atlas-slice-review` à flag explícita `--review`;
- atualiza README, manifests e docs operacionais para v0.3.

Impacto:
- breaking change para clientes v0.2 que ainda enviam parâmetro de família;
- planos novos devem ser gravados em `.atlas/plans/`;
- estado de run passa por `atlas_run_state` e fica em `.atlas/state/<run_id>/run.json`;
- validator passa a decidir por JSON parseável, não por prosa;
- subagente `atlas-task-validator` é registrado por host distinto: Claude via `agents/atlas-task-validator.md` (raiz), Codex via `agents/openai.yaml` por skill.

Camada de adapter de host (maturidade cross-host):
- nova tool MCP `atlas_capabilities`: detecta o host (Claude/Codex/genérico via env) e retorna descritores canônicos de disparo de subagente, todo nativo e paths de plano. Skills consultam isto em vez de hardcodar nome de host;
- novo doc canônico `packages/orchestrator/references/host-adapters.md` (matriz de adapters + como adicionar host novo);
- guard de build `build/check-consistency.mjs`: falha o build em drift do contrato do validator (bloco JSON de veredito) entre `agents/atlas-task-validator.md` e `SKILL.md`, e em regressão de `subagent_type: true` (A1) ou `display_name: "Codex"` (A2). Resolve a dívida de sincronização cross-host de forma enforced em vez de manual.

Arquivos/artefatos:
- `agents/atlas-task-validator.md` (novo — registro de subagente Claude);
- `packages/mcp-server/server.js` (nova tool `atlas_capabilities` + `HOST_ADAPTERS`);
- `packages/orchestrator/references/host-adapters.md` (novo — matriz de adapters);
- `build/check-consistency.mjs` (novo — guard de drift do validator + A1/A2);
- `VERSION`;
- `README.md`;
- `CHANGELOG.md`;
- `packages/mcp-server/server.js`;
- `packages/skills/atlas-*/`;
- `packages/templates/STATE_FILE_SCHEMA.md`;
- `packages/orchestrator/`;
- `hooks/claude/atlas-workflow-hook.js`;
- `plugin-manifests/*/plugin.json`.

Validacao:
- `node -e "import('./packages/mcp-server/server.js')"`;
- smoke MCP `tools/list`;
- smoke MCP `atlas_run_state`;
- greps finais de refs legadas, `§14`, variante orchestrated e lock MCP de família;
- `git diff --check`.

## v0.2.0 - 2026-06-01

Tipo: release

Resumo: publica a linha v0.2 do Atlas Workflow Orchestrator como plugin operacional reproduzivel.

Mudancas:
- consolida as skills da linha v0.2, templates canonicos, orquestrador e MCP server em dois artefatos `.plugin`;
- define `atlas-workflow-claude.plugin` como artefato para Claude Code e Cursor;
- define `atlas-workflow-codex.plugin` como artefato para Codex;
- adiciona checksums `SHA256SUMS` gerados pelo build;
- adiciona workflow GitHub Actions para build e publicacao em tags `v*`;
- atualiza README com pre-requisitos, instalacao por host e resultado esperado;
- atualiza PATCH_PROCEDURE para manutencao da linha v0.2.

Impacto:
- usuarios podem identificar a versao publica unica `0.2.0`;
- instalacao passa a ter artefato e checksum inequivocos por host;
- Cursor consome o pacote Claude Code na v0.2, sem artefato proprio;
- skills standalone, marketplace publico, migracao local e remocao de skills nativas ficam fora da S14.

Arquivos/artefatos:
- `VERSION`;
- `.github/workflows/release.yml`;
- `build/build-plugins.sh`;
- `dist/atlas-workflow-claude.plugin`;
- `dist/atlas-workflow-codex.plugin`;
- `dist/SHA256SUMS`;
- `README.md`;
- `PATCH_PROCEDURE.md`;
- `CHANGELOG.md`.

Validacao:
- `build/build-plugins.sh`;
- `(cd dist && shasum -a 256 -c SHA256SUMS)`;
- `unzip -t dist/atlas-workflow-claude.plugin`;
- `unzip -t dist/atlas-workflow-codex.plugin`;
- `unzip -p ... plugin.json` para manifests Claude e Codex.

## v0.1.10 - 2026-05-31

Tipo: runtime

Resumo: torna o workflow autocontido no pacote, exige skill real no sub-agent e remove referências a executor inexistente.

Mudancas:
- adiciona `defaults/paths.md` e `references/subagent_dispatch.md` nas duas cópias versionadas;
- atualiza G3 para exigir carregamento do `SKILL.md` real pelo sub-agent;
- ajusta G5 com exclusão estreita para falso positivo `depende de plano`;
- remove menções ao executor inexistente e mantém `plan_execute` exato por família;
- atualiza versão para `0.1.10`.

Impacto:
- o workflow não depende de config na raiz do repositório usuário;
- sub-agent por fase passa a ter contrato verificável de skill carregada;
- ambiguidades reais continuam bloqueando entrevista, com exceção configurada e logada.

Arquivos/artefatos:
- `atlas-workflow-orchestrator/**`;
- `plugins/atlas-workflow-orchestrator/**`;
- `README.md`, `PATCH_PROCEDURE.md`, `CHANGELOG.md`;
- `atlas-workflow-orchestrator.plugin`.

Validacao:
- `rtk rg -n "Sem config|usa defaults|0\\.1\\.9" .`;
- diffs espelhados entre fonte e cópia Codex;
- validação JSON dos manifests;
- validação do pacote `.plugin`.

## 2026-05-30 - patch-procedure

Tipo: docs

Resumo: cria procedimento obrigatorio para patches/versionamento do Atlas Workflow Orchestrator.

Mudancas:
- adiciona `PATCH_PROCEDURE.md`;
- define pontos obrigatorios de versionamento;
- define regra de changelog para todo patch;
- define sincronizacao fonte Claude/copia Codex;
- define validacoes minimas e stop conditions.

Impacto:
- nao altera contrato runtime do plugin;
- torna rastreabilidade obrigatoria antes de patches maiores.

Arquivos/artefatos:
- `PATCH_PROCEDURE.md`;
- `CHANGELOG.md`;
- `README.md`.

Validacao:
- `rtk rg -n "version|Plugin version|Novidades|Changelog|v0\\.|0\\.1\\.9|Last updated|marketplace|plugin\\.json|atlas-workflow-orchestrator\\.plugin|README|codex-plugin|claude-plugin" .`;
- `rtk find . -maxdepth 4 -type f`;
- `rtk git status --short`.
