# INTENT — Âncora de intenção do pack

> Canônico deste Guide Pack. `GUIDE.md` **aponta** para cá (índice fino); não duplica a prosa.
> Consumido por `$create-guide` e pelo revisor frio (`COLD_REVIEW_PROMPT`).
> Perguntas em aberto **não** vivem aqui — ficam em `.app-work/brainstorming/revisao-fria-backlog/PERGUNTAS_EM_ABERTO.md`.

**Pack:** `.app-work/guides/REVISAO_FRIA_BACKLOG_GUIDE/`
**Tema / brainstorm:** `.app-work/brainstorming/revisao-fria-backlog/BRAINSTORM.md`
**SSOT de produto (se houver):** `N/A` — Talos não mantém `DECISOES_*.md`; contrato do produto vive em `CLAUDE.md` (invariantes) e nos templates de `packages/templates/`
**Registro de Qs do tema (se houver):** `.app-work/brainstorming/revisao-fria-backlog/PERGUNTAS_EM_ABERTO.md`

**Status:** `PRONTO PARA CREATE-GUIDE`

**Criado em:** 2026-08-06
**Última propagação:** 2026-08-06 | fonte: entrevista (Q-CBR-01 a Q-CBR-08)

---

## 0. Escopo deste pack

**Entra neste pack:**
- Procedência por linha (`Origem`) em decisões do backlog mestre e em §7.1/§7.3 do sprint file, com validação mecânica nos gates MCP já existentes.
- Entrevista estruturada obrigatória dentro de `talos-backlog-generator`, usando o mecanismo de pergunta do host (`talos_capabilities.question_prompt`).
- Scan de aceite (`talos_scan_acceptance`) rodando também sobre backlog/sprint em rascunho, antes de salvar.
- Revisão fria interna à skill `talos-backlog-generator`: mandato canônico versionado na própria skill, despachado ao subagente genérico do host como último passo, auditando e corrigindo todo o output daquela execução.
- Release `0.16.0` BREAKING de contrato documental, em corte seco, com migração documentada (iniciar backlog/sprint novo).

**Fica para pack seguinte / fora:**
- Reconciliação de ciclo pós-`done` (análogo ao `pref-guide` do sistema Guide).
- Qualquer mudança em `talos-task-validator` / `talos-slice-review` (revisão pós-execução já existente).
- Artefato de intenção próprio no Talos (descartado — ver §4).
- Gate MCP, lock e selo dedicados à revisão (descartados — ver §4).

**Critério de pack bem planejado (efeito observável):**
1. Uma decisão inferida pelo modelo (não confirmada por humano nem lida do código) não consegue sustentar aceite de sprint `Must`/`P0` — o gate bloqueia com causa.
2. Todo backlog e todo sprint file produzidos por uma execução do `talos-backlog-generator` são auditados e corrigidos por um agente que nunca viu a conversa que os originou, antes de a skill entregar.
3. Quem chamou a skill recebe, junto do backlog pronto, o relato do que o revisor corrigiu — e pode discordar antes de seguir.
4. Nenhum artefato no formato anterior a `0.16.0` é aceito silenciosamente: o gate falha com instrução de reinício, sem caminho de degradação.

---

## 1. Decisões fechadas

Cada linha é obrigação de cobertura no `GUIDE.md`: CN que cobre **ou** marca explícita `fora` / `P#`.

| ID | Decisão (enunciado) | Consequência observável | Fonte | Cobertura no GUIDE |
|----|---------------------|-------------------------|-------|--------------------|
| D1 | Talos não ganha artefato de intenção próprio; decisões seguem no backlog mestre e em §6/§7.1 do sprint file | Nenhum arquivo novo é criado no fluxo; a contagem de artefatos do pipeline não muda | brainstorm §2 | GUIDE §1 D1 (sem artefato novo; §4 carrega a origem) |
| D2 | A linha `Discussão` da §4 do `SPRINT_TEMPLATE.md` vira obrigatória quando a sprint nasce de brainstorm/chat, e é o oráculo de intenção do revisor frio | Sprint file sem fonte de discussão preenchida, tendo origem em brainstorm, é reprovada por `talos_verify_sprint_file` | brainstorm §2 | CN6 · GUIDE §1 D2 · Plano 02 / AC-02.1.1, AC-02.1.2 |
| D3 | Procedência por linha: campo `Origem` com enum fechado `usuario` \| `derivado:<path>` \| `premissa`, em decisões do backlog e em §7.1 (`D*`) e §7.3 (`AC-*`, campo `origin:`) do sprint file | Toda decisão e todo critério de aceite exibe de onde veio; valor fora do enum é rejeitado pelo gate | brainstorm §3.1 | CN2, CN3, CN5 · Plano 01 / AC-01.1.1, AC-01.1.2, AC-01.2.1, AC-01.2.5 |
| D4 | `Origem: premissa` não pode sustentar aceite de sprint `Must`/`P0` | O gate bloqueia a sprint com causa; só passa após virar `usuario` (entrevista) ou `derivado:<path>` | brainstorm §3.1 | CN2 · Plano 01 / AC-01.2.2 |
| D5 | `derivado:<path>` é resolvido contra o disco; arquivo ainda inexistente exige marca explícita `(novo)` | Path inventado reprova o gate na hora, sem chegar ao executor | brainstorm §3.1 | CN3 · Plano 01 / AC-01.2.3, AC-01.4.3 |
| D6 | Os gates de backlog/sprint devolvem a contagem de linhas `premissa` no resultado | O revisor frio entra sabendo quantas e quais linhas atacar primeiro | brainstorm §3.1 | Plano 01 / AC-01.4.2, AC-01.4.3 (`premissa_count` nos dois gates) |
| D7 | `talos-backlog-generator` fecha ambiguidade por entrevista estruturada via `talos_capabilities.question_prompt` (3 opções, recomendada explícita, `decision_id` estável), não por perguntas em texto livre | Cada resposta do usuário é persistida com `Origem: usuario` e `decision_id` rastreável | brainstorm §3.2 | CN1 · Plano 03 / AC-03.1.1, AC-03.1.2 |
| D8 | `talos_scan_acceptance` roda também sobre backlog/sprint em rascunho, antes de salvar | Ambiguidade é detectada antes do artefato existir em disco, não só depois | brainstorm §3.2 | CN1 · Plano 02 / AC-02.2.1 — **parcial e declarado**: o scan é estrutural de §7, então cobre o rascunho de sprint, não o de backlog (GUIDE 2.4 passo 1) |
| D9 | A revisão fria é interna à skill `talos-backlog-generator` e usa o **subagente genérico do host**, com o mandato canônico versionado junto da skill (padrão do passo 10 do `create-guide`). Não há agente declarado no plugin, não há fase de orquestrador, e a revisão não é disparada em nenhum outro ponto do pipeline | Instalar o release não adiciona subagente novo ao host nem fase nova ao orquestrador; a obrigação vive inteira dentro da skill | Q-CBR-02 | CN4, VC2, VC3, INV4 · Plano 04 / AC-04.1.1, AC-04.2.2, AC-04.3.2 |
| D10 | Boundary da revisão = todo o output daquela execução do generator (backlog mestre + cada sprint file criado ou alterado). A revisão é o **último passo** da skill: entrevista estruturada → escrita dos artefatos → revisão → entrega | Um lote de sprints criado de uma vez é auditado como conjunto, não sprint a sprint; nada é revisado antes de estar escrito | Q-CBR-01, Q-CBR-07 | CN4 · Plano 04 / AC-04.2.1 |
| D14 | O relatório do revisor é estruturado (findings com severidade, classificação e veredito), mas destinado ao chamador — não é consumido por MCP nem por gate | Quem chamou lê findings ordenados por severidade, não prosa livre | Q-CBR-04 | CN4 · Plano 04 / AC-04.2.4 |
| D15 | O revisor nunca muta código do produto, em nenhuma circunstância | Boundary de escrita exclui código; violação é falha, não trade-off | brainstorm §3.3 | Plano 04 / AC-04.1.1 (código read-only no mandato) |
| D16 | Entrega em release único, não faseada | O usuário testa a diferença entre estado atual e estado desejado de uma vez | brainstorm §4 | GUIDE §1 D16 (cinco planos, uma versão) |
| D17 | Corte seco: sem retrocompat, sem detecção de schema antigo, sem modo legacy | Artefato no formato anterior falha no gate com instrução de reinício; não existe caminho de degradação | brainstorm §4 | CN5 · Plano 01 / AC-01.2.4 · Plano 05 / AC-05.1.2 |
| D18 | Versão `0.16.0` (minor com BREAKING de contrato documental), seguindo o precedente do `0.15.0`/D19 | `VERSION` e `.claude-plugin/plugin.json` sobem juntos; `CHANGELOG` registra o BREAKING e a migração | brainstorm §4 | Plano 05 / AC-05.1.1 |
| D19 | O revisor **audita e corrige**: aplica as correções nos artefatos revisados e devolve ao chamador o que alterou, mesmo procedimento do `create-guide` | Quem chamou recebe backlog e sprint files já corrigidos, com o relato do que passou batido na primeira escrita | Q-CBR-03 | CN4 · Plano 04 / AC-04.1.3 |
| D20 | O resultado da revisão não vira arquivo em disco; existe como relatório de saída do subagente para o chamador | Nenhum diretório de relatório é criado; a superfície documental do projeto não cresce | Q-CBR-04 | Plano 04 / AC-04.2.4 |
| D21 | A `talos-sprint-interview` no momento da execução é o **mecanismo previsto de atualização da §7**: absorve mudanças de estado ocorridas entre a criação do backlog e a execução daquela sprint. Por isso **não** re-dispara revisão fria — a revisão pertence à criação do lote, não ao ajuste pontual | Uma sprint executada muito depois da criação do backlog tem sua §7 realinhada ao código real sem custo de re-revisar o lote inteiro | Q-CBR-08 | GUIDE §1 D21 — sem AC: nenhuma mudança de código decorre dela (regra de não-disparo) |

---

## 2. Inventário de superfícies

Toda superfície observável do produto neste pack. Sem linha aqui, o create-guide não pode omitir em silêncio.

| Superfície | App | O que o usuário vê/faz | Dx relacionada | Cobertura |
|------------|-----|------------------------|----------------|-----------|
| Entrevista do backlog-generator | Talos CLI | Recebe perguntas de múltipla escolha com recomendação antes de o backlog ser salvo, em vez de ver o modelo assumir | D7, D8 | CN1 · Plano 03 / AC-03.1.1 a AC-03.1.3 |
| Bloco de decisões do backlog mestre | Artefato `BACKLOG_MESTRE_*.md` | Cada decisão exibe coluna `Origem` | D3 | Plano 01 / AC-01.1.2, AC-01.2.5 (sem CN próprio: o observável do usuário é o gate, coberto por CN2/CN3) |
| §7.1 do sprint file (`D*`) | Artefato `SPRINT_S<NN>_*.md` | Cada decisão de produto exibe coluna `Origem` | D3 | Plano 01 / AC-01.1.1, AC-01.3.1, AC-01.3.2 · VC1 |
| §7.3 do sprint file (`AC-*`) | Artefato `SPRINT_S<NN>_*.md` | Cada critério de aceite carrega campo `origin:` no YAML | D3 | Plano 01 / AC-01.1.1, AC-01.2.1 |
| §4 "Contexto e fontes" do sprint file | Artefato `SPRINT_S<NN>_*.md` | Linha `Discussão` preenchida com a fonte real do brainstorm | D2 | CN6 · Plano 02 / AC-02.1.1, AC-02.1.2 |
| Bloqueio de premissa em Must/P0 | Saída do gate MCP | Mensagem de bloqueio nomeando a linha `premissa` e a próxima ação | D4, D6 | CN2 · Plano 01 / AC-01.2.2, AC-01.4.2 |
| Bloqueio de path inventado | Saída do gate MCP | Mensagem nomeando o `derivado:<path>` que não existe em disco | D5 | CN3 · Plano 01 / AC-01.2.3, AC-01.4.3 |
| Mandato canônico da revisão | Arquivo de referência da skill | Prompt versionado, lido e despachado sem reescrita de memória | D9 | VC2 · Plano 04 / AC-04.1.1 a AC-04.1.3 |
| Passo de revisão dentro da skill | Talos CLI | Após escrever os artefatos, a skill despacha o revisor e aguarda antes de entregar | D9, D10 | CN4 · Plano 04 / AC-04.2.1 a AC-04.2.3, AC-04.2.5 |
| Relatório da revisão ao chamador | Saída da skill | Lista do que foi corrigido, findings por severidade e veredito, sem arquivo gerado | D14, D19, D20 | CN4 · Plano 04 / AC-04.1.3, AC-04.2.4 |
| Rejeição de artefato pré-`0.16.0` | Saída do gate MCP | Mensagem de corte seco instruindo a iniciar backlog/sprint novo | D17 | CN5 · Plano 01 / AC-01.2.4 |

---

## 3. Regras de negócio / invariantes de produto

Linguagem de efeito (não de DTO). Viram INV/CN no GUIDE.

| ID | Regra | Falseia se (efeito) | Fonte |
|----|-------|---------------------|-------|
| R1 | O revisor frio não escreve código do produto | Um diff de código aparece atribuído ao revisor | D15 |
| R2 | O revisor nunca recebe a conversa que originou backlog/sprint | O revisor cita raciocínio que só existe no chat de criação | D9 |
| R3 | §7 já aprovada e selada é somente-leitura para o revisor | Uma atualização de backlog faz o revisor editar contrato selado de sprint anterior | Q-CBR-03 |
| R4 | O mandato da revisão é lido do arquivo canônico, nunca improvisado de memória | O rigor da revisão varia entre execuções e não deixa rastro do que foi confrontado | D9 |
| R5 | A revisão acontece depois de os artefatos estarem escritos e antes de a skill entregar | A skill entrega backlog ao chamador sem ter despachado o revisor | D10 |
| R6 | O revisor corrige o que comprovou e relata; não devolve finding reparável para o chamador consertar | O chamador recebe lista de defeitos em vez de artefato corrigido | D19 |
| R7 | A decisão do revisor é sustentada por evidência de código ou de fonte, nunca por formatação do artefato | Uma tabela bem preenchida é aceita como prova | brainstorm §3.3 |
| R8 | Artefato anterior a `0.16.0` não é migrado automaticamente nem aceito | Um sprint file antigo passa no gate por tolerância | D17 |
| R9 | Ajuste da §7 na entrevista de sprint é atualização deliberada de contrato contra o estado atual do código, com humano no loop — não é lacuna de revisão | Alguém trata a §7 revisada na criação como congelada até a execução, ou dispara revisão do lote inteiro por causa de um ajuste pontual de sprint | D21 |

---

## 4. Fora de escopo (explícito)

| Item | Motivo | Referência |
|------|--------|------------|
| Artefato `INTENT.md` dentro do Talos | Duplicaria o bloco de decisões que já existe no backlog e na §7.1 | D1 / brainstorm §2 |
| Gate `COLD_BACKLOG` no orquestrador | Sem fase de orquestrador e sem artefato, não há o que gatear | Q-CBR-06 |
| `Selo de revisão: sha256` no sprint file | Sem lock não há `run_id`; sem arquivo não há veredito persistido a selar | Q-CBR-06 |
| Tool MCP `talos_lock_backlog_review` | A revisão vale pela obrigação escrita na skill, como no `create-guide` | Q-CBR-06 |
| Revisão fria de sprint standalone (`interview-only`) | Não passa pelo `talos-backlog-generator`; limite conhecido deste release | Q-CBR-05 |
| Camada de compatibilidade com artefatos pré-`0.16.0` | Corte seco decidido pelo usuário | D17 |
| Reconciliação de ciclo pós-`done` (análogo ao `pref-guide`) | Pack seguinte | brainstorm §3 |
| Mudanças em `talos-task-validator` e `talos-slice-review` | Revisão pós-execução já existe e não é o buraco atacado | brainstorm §1 |
| Entrega faseada em múltiplas versões | Dificulta perceber o resultado no teste | D16 |

---

## 5. Ainda aberto

Só entra o que ainda depende de humano. Bloqueante impede `PRONTO PARA CREATE-GUIDE`.

| ID | Lacuna | Bloqueia create-guide? | Default (se houver) | Estado |
|----|--------|------------------------|---------------------|--------|
| A1 | Boundary do dispatch do revisor | sim | — | resolvida (Q-CBR-01) |
| A2 | Gatilho e forma de disparo do revisor | sim | — | resolvida (Q-CBR-02) |
| A3 | Quem repara os findings | sim | — | resolvida (Q-CBR-03) |
| A4 | Onde vive o relatório do revisor | sim | — | resolvida (Q-CBR-04) |
| A5 | Alcance em sprint standalone | sim | — | resolvida (Q-CBR-05, fora de escopo) |
| A7 | Budget de passagens internas de reparo do revisor | não | 2, espelhando o revisor frio do `create-guide` | adiada |

---

## 6. Matriz de propagação (recibo do pre-guide)

Preenchida na última propagação. Não é contrato de execução.

| Origem | ID origem | → INTENT | Notas |
|--------|-----------|----------|-------|
| brainstorm | §2 | D1, D2, fora de escopo | INTENT no Talos descartado; §4 `Discussão` assume o papel de oráculo |
| brainstorm | §3.1 | D3, D4, D5, D6 | procedência por linha |
| brainstorm | §3.2 | D7, D8 | entrevista como gate de primeira classe |
| brainstorm | §4 | D16, D17, D18 | release único, corte seco, versão |
| PERGUNTAS | Q-CBR-01 | D10 | boundary = todo o output do generator |
| PERGUNTAS | Q-CBR-02 | D9 | subagente genérico do host, mandato na skill |
| PERGUNTAS | Q-CBR-03 | D19, R3, R6 | audita e corrige |
| PERGUNTAS | Q-CBR-04 | D14, D20 | relatório sem arquivo |
| PERGUNTAS | Q-CBR-05 | §4 fora de escopo | standalone descoberto por decisão |
| PERGUNTAS | Q-CBR-06 | §4 fora de escopo | gate, selo e lock removidos (D11–D13 revogadas) |
| PERGUNTAS | Q-CBR-07 | D10, R5 | revisão é o último passo da skill |
| PERGUNTAS | Q-CBR-08 | D21, R9 | entrevista posterior não re-revisa (ressalva) |

---

## 7. Histórico

| Data | Evento |
|------|--------|
| 2026-08-06 | INTENT criado a partir de `.app-work/brainstorming/revisao-fria-backlog/BRAINSTORM.md` |
| 2026-08-06 | Status → AGUARDANDO ENTREVISTA (5 lacunas bloqueantes em §5) |
| 2026-08-06 | Entrevista Q-CBR-01 a Q-CBR-04 → D9, D10, D14, D19, D20 |
| 2026-08-06 | Entrevista Q-CBR-05 a Q-CBR-08 → D21, R9; D11 (gate `COLD_BACKLOG`), D12 (selo de revisão) e D13 (lock MCP) revogadas e movidas para §4; IDs não reusados |
| 2026-08-06 | A6 e A8 encerradas sem virar decisão (dependiam do lock e do agente declarado, ambos removidos) |
| 2026-08-06 | Status → PRONTO PARA CREATE-GUIDE |
| 2026-08-06 | D21/R9 reenquadradas: a entrevista de sprint na execução é atualização prevista da §7 contra drift de estado, não lacuna de revisão (esclarecimento do usuário) |
| 2026-08-06 | Revisão fria do pack: colunas `Cobertura` de §1 e §2 preenchidas contra `GUIDE.md`/`plans/`. Nenhuma decisão, escopo ou fora de escopo foi alterado. D8 marcada como cobertura **parcial declarada** (o scan é estrutural de §7; rascunho de backlog não passa por ele). As duas perguntas que a revisão abriu (dispatch em host não-verificado; identidade do subagente genérico) foram fechadas pelo usuário em 2026-08-06 confirmando D9 e D22 como estavam: mandato em `references/` despachado ao subagente genérico do host, sem tool, sem gate, sem campo novo no adapter |
