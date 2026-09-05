# SPEC_INTENT_SATURATION_SDD — Saturação de intenção SDD (entrevista dual)

> **Documento canônico** da etapa de intenção/entrevista antes do plano. Não implementa código.
>
> **Produto:** Talos (plugin SDD).
> **Data:** 2026-09-05.
> **Aprovado em desenho:** conversa de produto (abordagem B).
> **Alimenta:** bump de contrato documental (skills `talos-backlog-generator`, `talos-sprint-interview`, `talos-plan-handoff`, orquestrador, `SPRINT_TEMPLATE`, gates `talos_verify_sprint_file` / DoR / `select_next` / `talos_assert_after_plan`); DECs 040–048.
> **Não altera:** schema MCP v5 (campos de capabilities); disco de slice v3; topologia sibling; artefato `INTENT.md` (proibido).

---

## Índice de decisões (D-INT-*)

| D-id | Decisão | Seção |
|------|---------|-------|
| D-INT-1 | Talos é SDD: entrevista, intenção e arquitetura-do-eixo são etapas, não atalho | §1 |
| D-INT-2 | Intenção mora na §2 do sprint file; sem artefato extra | §2 |
| D-INT-3 | §7–§10 não são renumeradas; selo de intenção é irmão do selo §7 | §2 |
| D-INT-4 | Duas entrevistas, dois oráculos: L1 recorte / L2 saturação do eixo depois §7 | §3 |
| D-INT-5 | Quantidade de sprints nunca é pergunta; LLM decompõe; usuário vence se sugerir | §3.1 |
| D-INT-6 | G5 lexical não substitui L2; `scan=0` não pula saturação | §3.2 |
| D-INT-7 | Ordem SDD: eixo → §2 saturada → §7 derivada → plano | §3.2 |
| D-INT-8 | Densidade Talos (não piso pack-intent de 10 Dx); pular só com recibo | §4 |
| D-INT-9 | Arquitetura não é 3ª skill: pack de perguntas do eixo `dados\|estrutura` | §5 |
| D-INT-10 | Usabilidade pack-intent (condensar, aferir, entrevistar até zerar `derivado:` no eixo) sem copiar artefatos do pack | §6 |
| D-INT-11 | Plano/direct não expandem anti-escopo da §2 | §7 |
| D-INT-12 | Sem atalho em voo: `doing`/`review` também exigem §2 saturada (ou entrevista) antes de plano/direct; sprint sem linhas de intenção na §1 é inválida | §8 |
| D-INT-13 | G11 intacto: `full` executa após PLAN; PLAN deve caber na §2 | §7 |
| D-INT-14 | Pergunta dirigida: tema da sprint ∩ eixo ∩ T* residual; pack genérico é defeito | §5 |
| D-INT-15 | Catálogo do inútil: o que L1/L2 nunca perguntam | §5.4 |
| D-INT-16 | `verify_sprint_file` tem limiar `stub` vs `plan_ready` | §9.1 |
| D-INT-17 | `select_next` matura stub (`sprint_interview`) também sem `--loop` | §9.2 |
| D-INT-18 | PLAN ⊆ §2 via IDs `SF-*`/`AS-*`/`R1` + `intent_refs` nas tasks; gate MCP | §9.3 |

---

## 1. Problema e postura SDD

O plano materializa recorte que nunca foi saturado no **eixo que a sprint ataca** (dados, UX, estrutura/componentes, contrato, regras do repo). `talos_scan_acceptance` (G5) caça forma (TBD, Q- aberta, D* vazio, `behavior` ambíguo). §7 selada pode ser o produto errado. `scan=0` hoje **pula** entrevista. Fire-and-continue promove silêncio a `premissa`. Entrevista ataca só §7.1–7.3. Classificação `feature|ui|contract|…` só no `plan-handoff`.

Talos é plugin de **spec-driven development**. Entrevista, intenção e arquitetura-do-eixo são o caminho padrão. Inferência do modelo não fecha intenção. Tempo gasto aqui é o mais barato do pipeline.

---

## 2. Casa da intenção (sprint file §2)

**Proibido** `INTENT.md` (ou equivalente pack). Casa única: sprint file.

**Proibido** renumerar §7–§10 (selo de aceite, MCP, parser).

Expandir **§2 Objetivo e valor** (já existe objetivo / valor / resultado observável / se não fizer). Campos novos no **corpo da §2** (bloco hasheado). Status e selo **não** moram na §2: vão na tabela §1, igual `Contrato status` / `Selo do contrato`.

| Campo | Onde | Obrigatório quando | Conteúdo |
|-------|------|--------------------|----------|
| `Intenção status` | §1 | sempre | `rascunho` \| `saturada` |
| `Selo da intenção` | §1 | `saturada` | `sha256:<hash>` do corpo §2 (`## 2.` até antes de `## 3.`), mesma normalização do selo §7; linha de selo/status fora do hash |
| Eixo do ataque | §2 | sempre, antes do plano | enum `dados` \| `ux` \| `estrutura` \| `contrato` \| `misto` |
| Superfícies | §2 | sempre | lista `SF-NN` + enunciado; pesquisa rasa; `path:symbol` só com `[não verificado]` |
| Anti-escopo tentador | §2 | sempre | lista `AS-NN` + item concreto; genérico (`melhorias futuras`) não conta |
| Recusa | §2 | sempre | um `R1` + frase «eu recuso a sprint se…» (efeito observável) |
| Regras do repo | §2 | se o eixo tocar código de produto | seguir X **ou** exceção `usuario` |

`Intenção status: saturada` é write-once enquanto o selo bater. Reeditar o corpo §2 exige voltar a `rascunho` (limpa o selo), igual §7.

§3 Escopo (em/fora / limite de tamanho) permanece. Anti-escopo tentador da §2 **complementa** o fora de escopo da §3: §3 lista adjacentes de produto; §2 lista tentações de implementação/eixo.

Procedência dos campos da §2: mesmo enum DEC-022 (`usuario` / `derivado:<path>` / `premissa`). `premissa` no eixo não sustenta `Intenção status: saturada`.

§7 continua aceite binário (DEC-013/014). Validador frio de **código** continua notando contra §7. Revisor frio de **artefato documental** (backlog/sprint) passa a cruzar §2 saturada ∪ §4 Discussão (DEC-025 permanece: Discussão obrigatória).

---

## 3. Entrevista dual

Mesmo mecanismo de host: `talos_capabilities.question_prompt` (`max_questions` / `options_per_question` do descritor). Persistência rodada a rodada (`persistInterviewRound` ou equivalente na §2). Decisão fechada não reaparece. Sem `question_prompt` → bloqueia a rodada (não degrada para pergunta livre). Sem `PERGUNTAS_EM_ABERTO.md` no consumidor Talos.

### 3.1 L1 — Backlog (`talos-backlog-generator`)

Oráculo: recorte do **ciclo**, não completude de AC YAML.

Pergunta: o que o ciclo entrega; o que fica fora deste ciclo; MoSCoW dos **temas**; sequência só se o eixo exige (ex. modelo de dados antes de UI).

**Proibido** perguntar «quantas sprints». Decomposição = objetivo único + limite de tamanho do `SPRINT_TEMPLATE` / princípios do backlog mestre. Contagem é efeito do escopo, não input de entrevista.

Se o usuário **sugerir** N sprints, nomear sprints, ou recortar IDs: gravar `Origem: usuario` e **não sobrescrever**. Silêncio do usuário → LLM decompõe; cada sprint nasce `state=backlog`, §1 `Intenção status: rascunho`, `Contrato status: draft`, §7 sem YAML `acceptance` (stub).

L1 **não** finge AC YAML completo no rascunho. Scan G5 em memória deixa de ser o gatilho único de pergunta no generator: gatilho L1 = ambiguidade de recorte/tema/MoSCoW, não TBD de `behavior`. Stubs nascem com §2 `rascunho` e §7 vazia/mínima — não inflar sprints «para parecer completo».

### 3.2 L2 — Sprint (`talos-sprint-interview`)

Duas fases na mesma skill, mesma sessão possível, ordem rígida:

1. **Saturação do eixo.** Classificar eixo (vocabulário alinhado ao handoff, cedo). Banco de perguntas por eixo (§5). Loop de densidade (§4) até `Intenção status: saturada` + selo §2.
2. **Contrato §7.** D* / cenários UX / `AC-*` **derivados** da §2 saturada. Completude G5 + regras atuais de `❌`. Selo §7.

`talos_scan_acceptance` com zero padrões **não** pula a fase 1. `--interview` continua forçando as duas fases. `interview-only` também sela §2 antes de declarar contrato pronto.

Standalone: critério `❌` elevado (já existe) aplica às duas fases.

Fire-and-continue: lacuna de intenção **não** vira `premissa` silenciosa na §2. Sem saturação, `next_action` permanece `sprint_interview`. Premissa na §7 continua DEC-023 (Must/P0).

---

## 4. Densidade decisória (Talos)

Herdar do pack-intent a **usabilidade** (aferir → entrevistar até zerar `derivado:` no eixo). **Não** herdar G1 «≥10 decisões `usuario:`». Sprint Talos é fatia pequena; piso 10 infla D* falsas.

Qualquer gatilho verdadeiro torna L2 fase 1 obrigatória:

| # | Gatilho |
|---|---------|
| T1 | Campo obrigatório da §2 vazio ou placeholder |
| T2 | `premissa` no eixo; ou `derivado:` que afirma **comportamento**. `derivado:<path>` só sobrevive sem pergunta se o path existe no disco **e** o enunciado é fato de existência (arquivo/símbolo), não efeito de produto |
| T3 | Superfície nomeada sem D* (ou linha de §2) que fixe o comportamento observável |
| T4 | Recusa ausente ou tautológica («se não ficar bom») |
| T5 | Anti-escopo só genérico |
| T6 | Eixo toca produto e regra aplicável do repo (AGENTS/design system/componentes) sem «seguir» ou «exceção `usuario`» |
| T7 | Eixo `misto` sem declarar qual fatia desta sprint é Must vs adiada |

Pular entrevista de intenção só com: zero gatilho T* **e** linha na §2 `Entrevista: dispensada: <motivo>` **e** todos os campos obrigatórios preenchidos com procedência `usuario` ou `derivado:<path>` verificado. Na prática, material bruto dispara ≥1 gatilho.

Registrar aferição na §2 (uma linha: gatilhos disparados / zerados).

---

## 5. Roteiro de pergunta (tema × eixo × T*)

Não criar `talos-architecture-interview`. Não existe quiz fixo «4 perguntas de UX em toda sprint».

Cada rodada escolhe a próxima pergunta pela **interseção**:

1. **Tema** — objetivo único da sprint (ou do ciclo, em L1). O stem cita o tema com substantivo do recorte («nesta sprint de modelagem do X», «neste ciclo de onboarding»), nunca «em geral».
2. **Eixo** — enum da §2 (`dados` \| `ux` \| `estrutura` \| `contrato` \| `misto`). Classificar cedo; `misto` declara pack primário Must (T7).
3. **T\* residual** — só pergunta o gatilho ainda aberto (§4). T4 aberto → uma pergunta de recusa. T6 aberto → uma pergunta de regra do repo. T* zerado → **parar**, mesmo se o host ainda permitir mais perguntas.

Saturação = T* = 0, não «N rodadas».

### 5.1 Camada: o que perguntar (L1 vs L2)

| | L1 ciclo | L2 sprint |
|--|----------|-----------|
| **Sobre** | o ciclo inteiro | só esta sprint (objetivo único) |
| **O que** | entra / fica fora / MoSCoW dos **temas** / sequência se um tema bloqueia o outro | recusa, anti-escopo tentador, efeito no eixo, regra do repo aplicável |
| **Não** | AC, loading/vazio, componente, path HTTP, quantas sprints | recorte de outra sprint, quantidade, «melhorias», gosto visual sem regra do repo |

L2 fase 1 (intenção) **antes** de L2 fase 2 (AC). Pergunta de aceite (`behavior` observável) só na fase 2, derivada da recusa já gravada — não o contrário.

### 5.2 Como perguntar

- Mecanismo: `question_prompt` do host. `max_questions` / `options_per_question` do descritor, nunca constante da skill.
- 3 opções mutuamente exclusivas de **produto** (efeito observável). Proibido: Sim / Depois / Tanto faz; Proibido: A e B e C como «níveis de esforço».
- Primeira opção = recomendada. Default da recomendação: **seguir regra já escrita no repo** quando T6; senão a opção que **corta** escopo (anti-expansão), não a que adiciona.
- Uma decisão por pergunta. `decision_id` estável. Fechada não reaparece.
- Stem = tema + decisão em aberto. Ex.: «Nesta sprint de cadastro, o nome duplicado: recusa se não bloquear no submit, avisa e grava, ou fica fora?» — não «Como prefere tratar erros?»

### 5.3 Pack por eixo (mínimo, só o que o tema toca)

O eixo **filtra** o pack; o tema **instancia** (qual entidade, qual tela, qual módulo). Se o tema não toca o item, o item não vira pergunta — vai anti-escopo implícito ou sprint seguinte, sem perguntar.

| Eixo | SOBRE (tópico) | SÓ SE o tema desta sprint tocar |
|------|----------------|----------------------------------|
| `dados` | entidades/campos desta fatia; o que não modela; fonte de verdade; conflito/merge | modelagem / persistência / sync |
| `ux` | loading/vazio/erro/sucesso **do fluxo nomeado no objetivo**; padrão do design system vs tela nova; o que não redesenha | UI visível nesta fatia |
| `estrutura` | onde mora; componente/padrão do repo a reusar; o que **não** refatora | mudança de módulos/componentes |
| `contrato` | literais (path, bit, enum) copiados da fonte, sem unificar papéis | API/schema/evento desta fatia |
| `misto` | T7 primeiro; depois só o pack primário Must | — |

Arquitetura = perguntas do eixo `dados` ou `estrutura` quando o tema as exige. Não é 3ª entrevista. Não perguntar «componentizar?» numa sprint cujo objetivo é regra de negócio sem UI.

### 5.4 Catálogo do inútil (nunca perguntar)

L1 e L2:

- Quantas sprints / quebrar em S01a / estimativa de tasks.
- Confirmar o óbvio já gravado `usuario` («confirma que o objetivo é X?» se X já está na §2 com origem usuario).
- Opção que o modelo já pode ler no disco sem efeito de produto (existência de arquivo).
- Loading/vazio/erro se o eixo não é `ux` e o objetivo não nomeia fluxo de UI.
- Refator / componentizar / pasta se o eixo não é `estrutura` e o tema não move código de feature.
- Campos de entidade se o eixo não é `dados`.
- «Quer testes?» — evidência é §7/`eval_manifest`, não entrevista de intenção.
- Recusa tautológica como opção («recusar se não ficar bom»).
- Ampliar escopo «já que estamos aqui» (a recomendação corta, não acrescenta).
- Reabrir D* / recusa / anti-escopo fechados nesta sprint.

L1 só a mais:

- `behavior` de AC, EVAL, tipo de evidência I/T/W/M.
- Componente padrão vs tela nova.

L2 só a mais:

- MoSCoW de **outra** sprint; ordem do backlog inteiro (isso é L1).
- Inventar segundo objetivo para «aproveitar a entrevista».

Se a única pergunta que restaria está neste catálogo → **não perguntar**; gravar anti-escopo ou `derivado:<path>` de existência e re-aferir T*.

### 5.5 Riscos que este roteiro mata

| Risco | Defesa |
|-------|--------|
| Interrogatório genérico (4 UX + 4 dados em toda sprint) | §5.3: item só se o tema toca; §5.4 |
| L1 inflar stubs / AC fantasma | §3.1: §7 vazia no stub; G5 não dispara L1 |
| Recusa tautológica | T4 + §5.4; opções devem nomear efeito observável |
| Selo §2 virar checklist | T* = 0 é o gate, não campos preenchidos com prosa vazia |

---

## 6. Fronteira pack-intent × Talos

| Pack-intent | Talos (esta spec) |
|-------------|-------------------|
| `INTENT.md` | §2 do sprint file |
| generate + interview em `PERGUNTAS_EM_ABERTO.md` | `question_prompt` in-band |
| piso 10 `usuario:` | gatilhos T1–T7 |
| §8 fatias / GUIDE | backlog mestre + sprint files (DEC-021) |
| `PRONTO PARA CONTRACT` | `Intenção saturada` + §7 aprovada → `plan_handoff` / `direct_execute` |

Default do modelo em silêncio = `premissa` / `derivado:`, nunca `usuario:`.

---

## 7. Downstream (plano, direct, review)

`talos-plan-handoff` e `talos-direct-execute` exigem `Intenção status: saturada` com selo íntegro. Leem §2+§7+código. **Proibido** acrescentar task cujo único lastro é inferência e que contradiz anti-escopo/recusa da §2.

**G11 permanece:** `full` executa depois do PLAN válido (`talos_assert_after_plan` → `plan_execute`). Não parar no plano. Recorte PLAN ⊆ §2 é o gate §9.3 (IDs + `intent_refs`), não matching de prosa.

DoR: `amarelo` no stub (§9.1). `verde` só com os dois selos íntegros. Checkbox «Intenção saturada (selo §1)».

Cold review do generator: mandato passa a confrontar §2 (intenção) + §4 (Discussão) + código. §2 `rascunho` com gatilho T* → `interview_required`, não «reparar» inventando recusa.

---

## 8. Migração e breaking

Comportamento novo: **não pular L2** quando G5=0. Isso quebra o atalho atual («Ambiguity scan: 0 padrões — entrevista pulada»). Bump consciente (DEC-009) + feature branch (DEC-010). Disco v3 e schema MCP v5 podem permanecer se o gate couber em `talos_verify_sprint_file` (markdown) sem campo novo de capabilities.

Sprint com `Contrato status: aprovado` já em `doing` / `review` **migra** o sprint file para o template 0.23 (linhas de intenção na §1 + L2 até `saturada`) antes do próximo plano/direct. Não existe `legacy_sealed`. Sprint `done` não é reaberta. Sprint `backlog`/`ready`/`draft` no pipeline novo: exige `plan_ready` antes de plano/direct. Arquivo sem `Intenção status` / `Selo da intenção` falha até `require: stub`.

Standalone `interview-only`: sela intenção + §7; execução posterior re-gateia os dois selos.

---

## 9. Três furos de contrato (fechados)

### 9.1 `talos_verify_sprint_file` — limiar duplo

A tool continua uma. O retorno declara `maturity`:

| `maturity` | Quando | §7 AC YAML | Selos | DoR esperado |
|------------|--------|------------|-------|--------------|
| `stub` | L1 acabou de criar / intenção ainda `rascunho` | **ausente ok** | linhas §1 obrigatórias: intenção `rascunho` + selo `pendente até saturação`; contrato `draft` | amarelo |
| `plan_ready` | antes de `plan_handoff` / `direct_execute` | obrigatório, G5=0 | intenção `saturada` + contrato `aprovado`, ambos íntegros | verde |

Sempre (os dois limiares): seções mínimas atuais, §4 Discussão não-placeholder, IDs, `Backlog mestre` explícito, **`Intenção status` e `Selo da intenção` presentes** (não placeholder). `stub` **não** exige eixo/SF/AS/R1 preenchidos — isso é L2. `plan_ready` exige corpo §2 com ≥1 `SF-NN`, ≥1 `AS-NN`, `R1`, eixo no enum, selo da intenção íntegro, selo §7 íntegro.

Caller: generator e `select_next` aceitam `stub`. `plan_handoff`, `direct_execute`, `assert_after_plan` exigem `plan_ready`. Passar `require: stub | plan_ready` (default `plan_ready` para não afrouxar callers antigos). Generator chama `require: stub`.

`maturity` só `stub` | `plan_ready`. Sprint `aprovado` em `doing`/`review` sem saturação §2 **bloqueia** `plan_ready` (DEC-049). `backlog`/`ready`/`draft` idem. Sem `legacy_sealed`.

### 9.2 `talos_select_next_sprint` — maturar stub sem `--loop`

Hoje, sem `loop:true`, só `state=ready` + DoR verde. Stub L1 nunca entra → `full idea` morre após o generator.

Regra nova, **sem** ligar a esteira `--loop` (CN7: loop continua = execução serial + review sempre + drain):

- Candidata de **maturação**: `state=backlog`, sprint file `valid` no limiar `stub`, deps `done`/`manual_validation_pending`, DoR `amarelo` ou `verde`.
- Sem `loop`: a fila de maturação **precede** as `ready` (mesmo ranking MoSCoW dentro de cada fila). `next_action: sprint_interview`.
- Com `loop`: comportamento atual de maturação + esteira de execução; não misturar as semânticas.

`--loop` não é mais o único jeito de entrevistar um `backlog`. É o jeito de **executar** a fila depois de selar.

DoR vermelho / file inválido: nunca candidata.

### 9.3 PLAN ⊆ §2 — IDs, não prosa

Proibido matching de título de task contra frase de anti-escopo.

Corpo §2 (hasheado) usa IDs estáveis:

- `SF-NN` — superfície que **entra**
- `AS-NN` — tentação que **não entra**
- `R1` — recusa (um por sprint)

Cada task do PLAN (`#### Tnn.`) declara uma linha:

`intent_refs: [SF-01, R1]`

Gate MCP (`talos_assert_after_plan` e TC de plano, `require_sprint_file=true`):

1. Toda task tem `intent_refs` não vazio.
2. Todo ID em `intent_refs` existe na §2 saturada e é `SF-*` ou `R1`.
3. Nenhum `AS-*` em `intent_refs`.
4. Todo `SF-*` da §2 aparece em ≥1 task (superfície sem lastro = plano incompleto).
5. `R1` aparece em ≥1 task (a prova da recusa tem dono).

Falha = `blocked`, não «o executor ajeita». Skill de handoff **escreve** os refs; o MCP **julga**. Sem refs no template = plano inválido nesta versão (não há v1 «só na skill»).

---

## 10. Fora de escopo desta spec

- Implementação (skills, parser, testes, bump `VERSION`).
- Rastreabilidade v1 (DEC-028) intacta.
- Copiar validador Python do pack-intent; o gate Talos é MCP + skill.
- Entrevista de quantidade de sprints (proibida, D-INT-5).
- Ranking MoSCoW *dentro* da fila (inalterado). A **precedência** fila de maturação → fila `ready` é D-INT-17.

---

## 11. Critério de spec bem implementada (efeito observável)

1. Usuário não é perguntado quantas sprints; sugestão dele no recorte é respeitada.
2. Pipeline `full`/`direct` não chega em `plan_handoff`/`direct_execute` com intenção `rascunho`.
3. G5=0 sozinho não imprime «entrevista pulada» para intenção.
4. Não existe `INTENT.md` na cadeia Talos.
5. AC da §7 referencia o eixo/`R1` da §2; nenhuma task tem `AS-*` em `intent_refs`; todo `SF-*` tem lastro.
6. Entrevista L2 não faz pergunta do catálogo §5.4; stem cita o tema da sprint; para quando T*=0.
7. Generator passa `verify_sprint_file` com `require: stub`; `full idea` recebe `next_action: sprint_interview` sem `--loop`.
8. Caller antigo sem `require` continua exigindo `plan_ready`.
