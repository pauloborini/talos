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

*(vazio até o Pré-F)*

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
