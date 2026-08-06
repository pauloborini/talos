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
**Status:** PENDENTE

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

- [ ] Toda obrigação do `LEDGER.md` está `PROVADO` com promoção rastreável ao plano que a fechou.
- [ ] Toda linha do `LEDGER.md` foi re-verificada no código nesta auditoria, sem amostragem.
- [ ] Invariantes transversais e integrações entre planos verificadas.
- [ ] Gates agregados passam ou o baseline está documentado.
- [ ] 5.1, 5.2 e 5.3 preenchidos.
- [ ] Nenhum `P0`/`P1`/`P2` aberto.

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
| CN1 | PENDENTE: ainda não auditado | PENDENTE | PENDENTE | PENDENTE |
| CN2 | PENDENTE: ainda não auditado | PENDENTE | PENDENTE | PENDENTE |
| CN3 | PENDENTE: ainda não auditado | PENDENTE | PENDENTE | PENDENTE |
| CN4 | PENDENTE: ainda não auditado | PENDENTE | PENDENTE | PENDENTE |
| CN5 | PENDENTE: ainda não auditado | PENDENTE | PENDENTE | PENDENTE |
| CN6 | PENDENTE: ainda não auditado | PENDENTE | PENDENTE | PENDENTE |

### 5.2 Entregas

| Entrega final | Planos/ACs | Evidência | Status |
|---------------|------------|-----------|--------|
| Procedência por linha rotulada e gateada | 01 / AC-01.1.1 a AC-01.4.3 | PENDENTE | PENDENTE |
| Fonte de discussão obrigatória e scan sobre rascunho | 02 / AC-02.1.1 a AC-02.2.3 | PENDENTE | PENDENTE |
| Entrevista estruturada antes da escrita | 03 / AC-03.1.1 a AC-03.2.1 | PENDENTE | PENDENTE |
| Revisão fria interna à skill de backlog | 04 / AC-04.1.1 a AC-04.3.2 | PENDENTE | PENDENTE |
| Release `0.16.0` com corte seco documentado | 05 / AC-05.1.1 a AC-05.3.1 | PENDENTE | PENDENTE |

### 5.3 Auditoria integrada da trilha

| Obrigação global | Planos/ACs confrontados | Evidência independente | Veredito |
|------------------|-------------------------|------------------------|----------|
| Procedência sobrevive ao ciclo completo (entrevista → escrita → gate → revisão) | 01, 03, 04 | PENDENTE | PENDENTE |
| Boundary da revisão cobre backlog + todas as sprints da execução | 04 | PENDENTE | PENDENTE |
| Artefato corrigido pelo revisor volta a passar pelos gates antes da entrega | 04 / AC-04.2.5 | PENDENTE | PENDENTE |
| `derivado:<path>` reprova nos **dois** gates (sprint e backlog índice) | 01 / AC-01.2.3, AC-01.4.3 | PENDENTE | PENDENTE |
| Nenhuma tool MCP nova e nenhuma fase nova de orquestrador | 04 / INV3 | PENDENTE | PENDENTE |
| Cópias por host sincronizadas com a fonte | 05 / INV5 | PENDENTE | PENDENTE |

O pack só recebe `CONCLUÍDO` quando todos os planos obrigatórios estão concluídos e esta matriz, junto com 5.1, comprova a Definition of Done da trilha.
