# Changelog

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
