# Changelog

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
- **instalador unificado via npx-from-GitHub** (`build/cli/atlas-init.mjs`, bin `atlas-workflow` no `package.json` raiz): `npx github:pauloborini/atlas-workflow init <claudecode|cursor|codex|opencode|pi>` — 1 comando por host, sem clonar o repo. claude/codex orquestram o instalador nativo da CLI; opencode/pi colocam o catálogo from-source no diretório alvo. Flags `--dir`, `--yes` (auto-deps pi), `--dry-run`. Versão do `package.json` raiz entra no guard de drift;
- detecção de host data-driven (`HOST_DETECTORS`); enum dos schemas derivado de `HOST_ADAPTERS` (sem hardcode);
- adapter **opencode**: perfil + `.opencode/` (agents/skills) + `opencode.json` (MCP local, `ATLAS_HOST=opencode`) + bundle + catálogo from-source `hosts/opencode/`;
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
