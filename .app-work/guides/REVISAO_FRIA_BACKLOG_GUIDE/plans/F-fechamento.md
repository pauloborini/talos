# Plano F - Fechamento da trilha

**Pack:** ../GUIDE.md

**Objetivo do plano:** auditar a trilha inteira contra o código, usando o `LEDGER.md` como mapa, e fechar o pack.

**Resultado esperado:** status global `CONCLUÍDO`, com 5.1, 5.2 e 5.3 preenchidos a partir das promoções já registradas por plano.

**Cenários servidos:** nenhum diretamente: verifica todos.

**Fronteira de entrada:** todas as obrigações do `LEDGER.md` em `PROVADO`.

**Fecha neste plano:** nenhuma obrigação nova. Este plano não implementa.

**Dependências:** Planos 01, 02, 03, 04 e 05.
**Natureza:** FECHAMENTO
**Ativação:** sempre, em pack com dois ou mais planos de execução.
**Risco:** baixo
**Status:** CONCLUÍDO (2026-08-06)

### Contrato do plano de fechamento

Este plano **não recebe executor** e **não roda dentro do loop de planos**. O fechamento é iniciado pelo usuário em **sessão nova**, com o modelo que ele escolher. Não existe task, não existe `Impl`, não existe mutação de entrega: a única escrita de código permitida é a correção de finding.

A verificação aqui é **integral**: toda linha do `LEDGER.md` re-verificada no código, inclusive as `PROVADO`.

### Obrigações do fechamento

1. Reconciliar `LEDGER.md` contra as promoções registradas em cada `Auditoria pós-implementação` dos planos em `plans/`.
2. Re-verificar integralmente, no código, toda linha do `LEDGER.md` — cenário, valor crítico, legado e invariante.
3. Verificar as invariantes transversais e as integrações entre planos, que nenhum plano isolado audita. Nesta trilha, especificamente: a procedência sobrevive ao ciclo completo entrevista → escrita → gate → revisão, e o boundary da revisão cobre o output inteiro de uma execução com mais de uma sprint.
4. Rodar os gates agregados: `bash build/test-all.sh` e `claude plugin validate ./ --strict`.
5. Preencher 5.1, 5.2 e 5.3 e decidir o status global no `GUIDE.md`.

Obrigação em qualquer estado diferente de `PROVADO` é dívida aberta e bloqueia o fechamento.

### Definition of done

- [x] Toda obrigação do `LEDGER.md` está `PROVADO` com promoção rastreável ao plano que a fechou.
- [x] Toda linha do `LEDGER.md` foi re-verificada no código nesta auditoria, sem amostragem.
- [x] Invariantes transversais e integrações entre planos verificadas.
- [x] Gates agregados passam ou o baseline está documentado.
- [x] 5.1, 5.2 e 5.3 preenchidos.
- [x] Nenhum `P0`/`P1`/`P2` aberto.

### Pré-F

**Data:** 2026-08-06
**Veredito:** PASS
**Skill:** pref-guide

| Campo | Conteúdo |
|-------|----------|
| Linhas de LEDGER re-verificadas | 16 (todas: CN1-CN6, VC1-VC3, LEG1-LEG2, INV1-INV5) |
| Linhas que divergiram do ledger | nenhuma |
| Promoções sem lastro | nenhuma (cada `Promovido por` bate com a `Auditoria pós-implementação` do plano nomeado em `Fecha em`; todos os testes citados existem e passam no runner real) |
| Gaps cross-plano encontrados | nenhum bloqueante. Verificados: (1) procedência sobrevive ao ciclo entrevista → escrita (`persistInterviewRound`/`applyDecisionRow` 3 colunas) → gate (`validateSprintFileConformance`) → revisão fria (mandato + passo 14 com regate pós-revisão); (2) boundary da revisão cobre backlog + todas as sprints da execução (passo 14, AC-04.2.1); (3) artefato corrigido pelo revisor volta aos gates (AC-04.2.5); (4) `derivado:<path>` reprova nos dois gates (`root: consumerRoot(args)` em `verifySprintFile` e `inspectBacklogIndex`; AC-01.4.3); (5) INV3: 16 tools, orquestrador sem diff de código; (6) INV5: 12 cópias de template byte-idênticas |
| Findings corrigidos (P0/P1/P2) | nenhum |
| Findings restantes (P0/P1/P2) | nenhum |
| Arquivos tocados | `.app-work/guides/REVISAO_FRIA_BACKLOG_GUIDE/plans/F-fechamento.md` (apenas a seção `### Pré-F`; 5.1/5.2/5.3 não preenchidos) |
| Gates / smoke | `bash build/test-all.sh` → "OK — suíte completa verde" (exit 0: 287/287 + 37/37 + smoke-hosts + conformance 6×10 + smoke-install + checksums 6/6); `node --test build/tests/etapa3.test.mjs` 27/27; `node --test packages/mcp-server/server.test.js` 287/287 (com fixture ambiental presente); `node build/check-consistency.mjs` ok; `git diff --check` limpo; `claude plugin validate ./ --strict` → "✔ Validation passed"; smoke manual em host real: NÃO executado (N/A documentado nos planos 03/04/05) |

**Notas para o Plano F (mapa de risco, não atestado):**
- **União dos `Fecha neste plano` cobre o LEDGER inteiro (16/16), sem órfãos**; fronteiras de entrada de 02 (VC1), 03 (VC1), 04 (CN1) e 05 (CN4+VC1) fechadas por planos anteriores; guia §4 espelha os status (01-05 CONCLUÍDO, F PENDENTE).
- **Risco 1 — estado verde depende de arquivo não versionado:** a suíte `packages/mcp-server/server.test.js` depende de `<repo>/.talos/memory/HANDOFF_TEMPLATE.md` (gitignored via `.talos/`, nunca versionado — `git log --all -- .talos` vazio). Sem ele, 22 testes falham por ENOENT (`writeHandoffTemplateFixture`). O fixture existe hoje no workspace (restaurado no Plano 05) e `test-all.sh` roda verde, mas um clone fresco/CI falha. Não afeta instaladores (é só teste), mas é dívida estrutural sem dono: decidir no F (versionar o template ou derivá-lo de fixture do repo).
- **Risco 2 — smoke manual nunca executado:** (a) veredito do subagente da revisão fria (CN4/VC2/VC3) é smoke por declaração do pack (2.1/2.9) — nunca rodou em host real com `subagent_dispatch`; o lado do contrato (mandato lido do disco, boundary, regate, relatório, sem tool name) está automatizado e verde; (b) release em host limpo (marketplace-from-source, `talos_ping` → 0.16.0) também N/A. Se o F tiver host MCP disponível, executar os smokes; senão, aceitar o N/A documentado.
- **P3 herdados (registrados, não corrigidos):** (1) Plano 02 F4 — falsificador registrado no Impl para AC-02.2.2 diverge do declarado no AC; o declarado (remover branch de `sprint_path`) foi o aplicado na auditoria com red reproduzido; mesma capacidade discriminante; (2) nomes de teste de 2.1 diferem dos reais (Plano 03: `persist_preserva_origem` → real `entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)`; Plano 04: mapeamento completo no Impl); sem impacto funcional; (3) linha `origem` de `applyItemField` fica na cadeia escalar fora do submapa `evidence` (comportamento requerido por AC-01.2.1).
- **Código confirma o LEDGER em todas as linhas re-verificadas** — nenhum ajuste de ledger foi necessário; nenhuma correção P0/P1/P2 foi feita nesta passada.

### 5.1 Cenários de aceite traçados

| Cenário | Caminho real percorrido (`path:symbol` -> ... -> sink) | Prova executável | Evidência | Veredito |
|---------|--------------------------------------------------------|------------------|-----------|----------|
| CN1 | `talos-backlog-generator/SKILL.md` passo 4 → `server.js:scanAcceptance` (`sprint_markdown`) → `capabilities.question_prompt` → `applyInterviewRound`/`applyDecisionRow` com `Origem: usuario` (rascunho em memória ou `persistInterviewRound` se arquivo existir) | `server.test.js::talos_scan_acceptance: sprint_markdown... (AC-02.2.1)` + `etapa3::skill backlog: texto livre morto... (AC-03.1.1 / LEG1)` + `etapa3::entrevista: persistir rodada preserva Origem... (AC-01.3.1 / INV1)` | Passo 4 lido; 3 pernas verdes no runner; LEG1 morto nos dois sítios | CONFORME |
| CN2 | §1 `MoSCoW`/`Prioridade` + `origin: premissa` no AC → `document_quality.mjs:validateSprintFileConformance` → `server.js:verifySprintFile` `status:blocked` + `premissa_count` | `etapa3::procedência: premissa bloqueia... (AC-01.2.2)` + `server.test.js::talos_verify_sprint_file: premissa_count... (AC-01.4.2)` | Fixture standalone Must/P0; pendência `procedencia_premissa_em_prioridade`; gate blocked | CONFORME |
| CN3 | `derivado:<path>` → `validateOriginToken({ root })` → pendência `origem_path_inexistente` nos **dois** gates (`verifySprintFile` L2077 + `inspectBacklogIndex` L2259, ambos com `root: consumerRoot(args)`) | `etapa3::procedência: derivado:<path> inexistente... (AC-01.2.3)` + `server.test.js` resolve no backlog | tmpdir real; `(novo)` e path existente passam | CONFORME |
| CN4 | `SKILL.md` passo 14 → lê `references/COLD_BACKLOG_REVIEW_PROMPT.md` do disco → boundary = backlog + **cada** sprint escrito → `subagent_dispatch` → regate se alterou → relatório ao chamador (sem arquivo) | `etapa3::mandato revisão...` + `::skill_backlog_le_mandato` + `::skill_backlog_boundary_completo` + `::skill_backlog_regate_pos_revisao` + `::skill_backlog_relatorio_ao_chamador` | Contrato do mandato/boundary/regate verde; veredito do agente = smoke N/A (pack 2.1/2.9); host MCP instalado ainda em 0.15.1 (cache) | CONFORME |
| CN5 | §7.1 sem coluna `Origem` → `validateSprintFileConformance` → `procedencia_ausente` + `next_action: migrar_para_0_16` | `etapa3::procedência: §7.1 sem coluna Origem... (AC-01.2.4)` | Schema pré-0.16 rejeitado; D17 corte seco | CONFORME |
| CN6 | §4 linha `Discussão` vazia/placeholder → pendência `fonte_discussao_ausente` → `verifySprintFile` blocked | `etapa3::discussão: placeholder... (AC-02.1.1)` + `::discussão: sprint standalone... (AC-02.1.2)` | Placeholders e standalone sem linha recusados; path real passa | CONFORME |

### 5.2 Entregas

| Entrega final | Planos/ACs | Evidência | Status |
|---------------|------------|-----------|--------|
| Procedência por linha rotulada e gateada | 01 / AC-01.1.1 a AC-01.4.3 | Templates 3 colunas; `applyDecisionRow` 3 células; `validateOriginToken`; gates com `premissa_count` e `root`; etapa3+server.test verdes | ENTREGUE |
| Fonte de discussão obrigatória e scan sobre rascunho | 02 / AC-02.1.1 a AC-02.2.3 | `fonte_discussao_ausente`; `scanAcceptance` aceita `sprint_markdown` XOR `sprint_path` | ENTREGUE |
| Entrevista estruturada antes da escrita | 03 / AC-03.1.1 a AC-03.2.1 | Passo 4 via `question_prompt`; LEG1 morto; persistência `usuario` | ENTREGUE |
| Revisão fria interna à skill de backlog | 04 / AC-04.1.1 a AC-04.3.2 | Mandato canônico; passo 14; INV3=16 tools; INV4 sem tool hardcode | ENTREGUE |
| Release `0.16.0` com corte seco documentado | 05 / AC-05.1.1 a AC-05.3.1 | `VERSION`/`plugin.json` 0.16.0; 12 cópias byte-idênticas; CHANGELOG/docs; `test-all` verde | ENTREGUE |

### 5.3 Auditoria integrada da trilha

| Obrigação global | Planos/ACs confrontados | Evidência independente | Veredito |
|------------------|-------------------------|------------------------|----------|
| Procedência sobrevive ao ciclo completo (entrevista → escrita → gate → revisão) | 01, 03, 04 | `applyDecisionRow` L1116-1136 monta 3 colunas; `applyInterviewRound` força `'usuario'`; sink `validateSprintFileConformance` consome `origin`; mandato §7 aprovada read-only; regate pós-revisão no passo 14; provas AC-01.3.1 + AC-04.2.5 verdes | CONFORME |
| Boundary da revisão cobre backlog + todas as sprints da execução | 04 | Passo 14: "backlog mestre e **cada** sprint file criado ou alterado — não apenas a sprint selecionada"; `etapa3::skill_backlog_boundary_completo` | CONFORME |
| Artefato corrigido pelo revisor volta a passar pelos gates antes da entrega | 04 / AC-04.2.5 | Passo 14 exige reexecução de `talos_verify_sprint_file`/`talos_verify_backlog_index` quando houve alteração; teste ancora a instrução | CONFORME |
| `derivado:<path>` reprova nos **dois** gates (sprint e backlog índice) | 01 / AC-01.2.3, AC-01.4.3 | `root: consumerRoot(args)` em `verifySprintFile` L2077 e `inspectBacklogIndex` L2259; testes nos dois caminhos | CONFORME |
| Nenhuma tool MCP nova e nenhuma fase nova de orquestrador | 04 / INV3 | 16 `name: 'talos_'` em `server.js`; `server.test.js::tools: conjunto registrado...`; orquestrador só ecoa `talos_scan_acceptance` já existente | CONFORME |
| Cópias por host sincronizadas com a fonte | 05 / INV5 | 6×SPRINT + 6×BACKLOG `diff -q` idênticos à fonte com coluna `Origem` | CONFORME |

### Auditoria integrada (Plano F) — 2026-08-06

**Modo:** Plano F (fechamento). Sessão nova. Pré-F: **presente** (mapa de risco; cobertura R1–R5 integral mantida).

**R0:** Pré-F PASS usado só como prioridade. Risco 1 (HANDOFF gitignored) confirmado e **corrigido nesta auditoria** (P2). Risco 2 (smoke host) aceito N/A conforme pack. P3 herdados registrados, sem elevação.

**R1:** 16/16 linhas do LEDGER batem com `Promoção de ledger` dos planos 01–05; evidência concreta em cada promoção; nenhuma promoção sem lastro.

**R2:** 16/16 linhas re-verificadas no código (sem amostragem). Divergências vs estado do ledger: **0**. LEDGER permanece íntegro (nenhuma linha rebaixada).

**R3:** Integrações da matriz 5.3 todas CONFORME. DoD marcada.

**R4:** `bash build/test-all.sh` → OK suíte completa verde (287/287 + 37/37 + smoke-hosts + conformance 6×10 + smoke-install + checksums 6/6); `claude plugin validate ./ --strict` → ✔; `node build/check-consistency.mjs` ok; `git diff --check` limpo. Prova do fix HANDOFF: 287/287 **com** `.talos/memory/HANDOFF_TEMPLATE.md` removido temporariamente.

**R5 / Fase C:** Finding P2 corrigido; conformidade OK (fixture versionada; runtime do consumidor inalterado). Worktree alheio: só o fix desta auditoria (`server.test.js` + `fixtures/HANDOFF_TEMPLATE.md`) + artefatos do pack.

**Além do Pré-F:** (1) corrigiu Risco 1 — `writeHandoffTemplateFixture` agora copia de `packages/mcp-server/fixtures/HANDOFF_TEMPLATE.md` (versionado); (2) confirmou MCP instalado no host Cursor ainda em `0.15.1` (cache) enquanto o repo está `0.16.0` — smoke de reinstall N/A, lado do contrato automatizado verde; (3) nenhuma outra divergência de ledger ou gap cross-plano além do mapa Pré-F.

**Findings desta auditoria:**

| Sev | Finding | Correção | Validação |
|-----|---------|----------|-----------|
| P2 | Suíte `server.test.js` lia HANDOFF de path gitignored (Risco 1 Pré-F) | Fixture versionado em `packages/mcp-server/fixtures/HANDOFF_TEMPLATE.md` + helper atualizado | 287/287 com `.talos/memory/HANDOFF_TEMPLATE.md` ausente; `test-all` verde |

**P0/P1/P2 abertos:** nenhum.
**P3 residual:** herdados do Pré-F (falsificador F4 nome divergente; nomes de teste em 2.1 vs reais) — observação, não bloqueiam DoD.

**Status:** `plans/F-fechamento.md` → CONCLUÍDO (2026-08-06); GUIDE.md global → CONCLUÍDO (2026-08-06); §4 espelhado.
