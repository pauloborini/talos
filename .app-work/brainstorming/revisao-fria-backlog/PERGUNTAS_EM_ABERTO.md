# Perguntas em aberto — Talos / revisão fria de backlog

> **Função deste arquivo:** inventário do que ainda precisa de decisão sua (produto, operação, sequência), com foco no horizonte imediato do backlog.
> **O que NÃO vai aqui:** opções A/B/C, recomendações, raciocínio longo — isso nasce **na entrevista**, com backlog, código e docs relidos na hora (`open-questions-interview` ou pedido explícito de rodada).

---

## Como usar (dois modos)

| Modo | Quem | O que faz | Saída |
|------|------|-----------|--------|
| **Varredura** | Agente (ou você) | Cruza fontes do tema, INTENT §5 e código; abre/atualiza/fecha **entradas** no índice | Este arquivo (enxuto) |
| **Entrevista** | Você + agente | Escolhe **1–4 IDs** `aberta`; agente relê âncoras + repositório; pergunta com **AskQuestion** | Decisão no chat → linha no **Histórico** → INTENT §1 |

**Regra anti-desatualização:** antes de cada rodada de entrevista, o agente **revalida** as âncoras e o código dos IDs escolhidos. Se a evidência mudou, atualiza a lacuna no registro **antes** de perguntar.

**Formato de resposta na entrevista:** `Q-XXX → A` ou `Q-XXX → Outro: …`

**Legenda de severidade:** `❌` bloqueia handoff/implementação honesta · `⚠️` permite avançar com risco documentado

**Status:** `aberta` · `em entrevista` · `resolvida` · `adiada` · `obsoleta` (código/docs já fecharam o tema)

**Janela de análise:** modo scoped — recorte do tema `revisao-fria-backlog` (janela de sprints não se aplica).

---

## Meta

| Campo | Valor |
|-------|-------|
| **Última varredura** | 2026-08-06 |
| **Escopo da varredura** | `.app-work/guides/REVISAO_FRIA_BACKLOG_GUIDE/INTENT.md` §5 (A1–A5) + `BRAINSTORM.md` deste tema + código do plugin Talos `0.15.2` |
| **Próxima rodada sugerida** | IDs: `Q-CBR-01`, `Q-CBR-02`, `Q-CBR-03`, `Q-CBR-04` |

---

## Índice

| ID | Título curto | Severidade | Bloqueia | Status |
|----|--------------|------------|----------|--------|
| Q-CBR-01 | [sequencia] Boundary do dispatch do revisor frio | ✅ | — | `resolvida` |
| Q-CBR-02 | [governanca] Gatilho do revisor frio | ✅ | — | `resolvida` |
| Q-CBR-03 | [governanca] Quem repara os findings do revisor | ✅ | — | `resolvida` |
| Q-CBR-04 | [contrato] Onde vive o relatório do revisor | ✅ | — | `resolvida` |
| Q-CBR-05 | [sequencia] Alcance: sprint que não passa pelo backlog-generator | ✅ | — | `resolvida` |
| Q-CBR-06 | [governanca] O que resta de gate MCP sem artefato e sem lock | ✅ | — | `resolvida` |
| Q-CBR-07 | [sequencia] Revisão envelhecida pela entrevista posterior | ✅ | — | `resolvida` |
| Q-CBR-08 | [sequencia] Quem dispara a revisão quando a entrevista do orquestrador roda depois | ✅ | — | `resolvida` |

**Totais:** `aberta` 0 · `em entrevista` 0 · `adiada` 0 · `resolvida` 8

---

## Entradas

### Q-CBR-01 — [sequencia] Boundary do dispatch do revisor frio

| Campo | Valor |
|-------|-------|
| **Status** | `resolvida` |
| **Severidade** | ✅ |
| **Bloqueia** | — (fechada em 2026-08-06) |
| **Âncoras** | `INTENT.md` §5 A1 · `BRAINSTORM.md` §3.3 · `packages/orchestrator/skills/talos/SKILL.md` gates `BACKLOG_INDEX` e `SELECT_NEXT_SPRINT` |
| **Lacuna** | Falta decidir o que o revisor recebe como boundary: apenas a sprint selecionada, ou também o backlog mestre inteiro. Quanto maior o boundary, mais caro o dispatch e maior a chance de findings fora do recorte executável; quanto menor, incoerências entre sprints (dependência circular semântica, duas sprints entregando a mesma capacidade) ficam invisíveis. |
| **Evidência (snapshot)** | `talos_select_next_sprint` devolve **uma** `selected.sprint_file_path`; `talos_verify_backlog_index` já cobre o macro apenas de forma mecânica (link ausente, sprint file ilegível, dep interna inválida/cíclica, status drift) — nenhum gate atual julga coerência semântica entre sprints. |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** O boundary é **todo o trabalho do backlog-generator naquela execução** — o backlog mestre e cada sprint file criado ou alterado, não apenas a sprint selecionada. O revisor audita o conjunto e corrige o que encontrar.
**Propagado em:** INTENT §1 D9/D10

---

### Q-CBR-02 — [governanca] Gatilho do revisor frio

| Campo | Valor |
|-------|-------|
| **Status** | `resolvida` |
| **Severidade** | ✅ |
| **Bloqueia** | — (fechada em 2026-08-06) |
| **Âncoras** | `INTENT.md` §5 A2 · `packages/templates/SPRINT_TEMPLATE.md` §10 `policy_manifest.critical_review` · `packages/orchestrator/skills/talos/SKILL.md` gate G8 |
| **Lacuna** | Falta decidir se o revisor roda em toda sprint que produz contrato §7, ou se o disparo é condicional a um sinal declarado (contagem de `premissa`, `critical_review.required`, origem `backlog_first`, standalone). "Sempre" é mais simples de auditar e não depende de heurística; condicional evita pagar dispatch em sprint trivial, mas cria um caminho em que a sprint chega ao executor sem nunca ter sido revisada. |
| **Evidência (snapshot)** | O projeto já tem os dois padrões em uso: `talos-task-validator` é obrigatório em toda slice (G4), enquanto `talos-slice-review` é condicional por flag `--review` ou por valor declarado `critical_review.required: true` com `reasons` em enum fixo (G8). |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** A revisão é **interna à skill `talos-backlog-generator`** e roda ao fim de toda criação/atualização de backlog. Não é fase do orquestrador, não é agente declarado no plugin e não é disparada em nenhum outro momento do pipeline. A skill despacha o **subagente genérico nativo do host** com o mandato canônico versionado junto da própria skill, como `create-guide` faz no passo 10 com `references/COLD_REVIEW_PROMPT.md`.
**Propagado em:** INTENT §1 D9/D13

---

### Q-CBR-03 — [governanca] Quem repara os findings do revisor

| Campo | Valor |
|-------|-------|
| **Status** | `resolvida` |
| **Severidade** | ✅ |
| **Bloqueia** | — (fechada em 2026-08-06) |
| **Âncoras** | `INTENT.md` §5 A3 · `packages/skills/talos-task-validator/SKILL.md` · `packages/skills/talos-findings-repair/SKILL.md` · `~/.claude/skills/create-guide/references/COLD_REVIEW_PROMPT.md` fase B |
| **Lacuna** | Os dois sistemas resolvem isso de formas opostas e falta escolher qual vale aqui. No Guide, o revisor frio aplica ele mesmo os findings reparáveis e devolve o pack corrigido. No Talos, quem valida nunca corrige: o reparo é de um ator separado, acionado pelo orquestrador com budget. Escolher "revisor repara" economiza um dispatch mas quebra a simetria com o padrão vigente; escolher "revisor só reporta" mantém a simetria e cria a necessidade de decidir quem corrige o documento. |
| **Evidência (snapshot)** | `talos-task-validator` declara "Não corrige código. Não propõe diff."; `talos-findings-repair` existe exclusivamente como caminho de recuperação pós-`fail`, com `repair_budget: 1`. O `COLD_REVIEW_PROMPT` do Guide instrui o oposto: "Aplique diretamente todos os findings REPARÁVEIS". |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** O revisor **audita e corrige**, mesmo procedimento do `create-guide`. Ele aplica as correções nos artefatos revisados e devolve ao chamador o que foi alterado; quem chamou confere o que passou batido, confirma e segue o fluxo até entregar backlog + sprint files prontos.
**Propagado em:** INTENT §1 D15 (revisado)

---

### Q-CBR-04 — [contrato] Onde vive o relatório do revisor

| Campo | Valor |
|-------|-------|
| **Status** | `resolvida` |
| **Severidade** | ✅ |
| **Bloqueia** | — (fechada em 2026-08-06) |
| **Âncoras** | `INTENT.md` §5 A4 · `packages/orchestrator/skills/talos/SKILL.md` gates G1 e `SPRINT_STATUS_SYNC` · `packages/skills/talos-slice-review/SKILL.md` |
| **Lacuna** | Falta decidir se o resultado do revisor vira arquivo próprio em disco, se vive só como campos no sprint file (veredito + selo + histórico), ou ambos. O gate duro G1 do Talos trata fase sem arquivo verificável como fase que não aconteceu, o que empurra para arquivo próprio; por outro lado, um relatório a mais por sprint aumenta a superfície documental que o usuário pediu para não inflar. |
| **Evidência (snapshot)** | Os únicos diretórios de artefato que o orquestrador nomeia hoje são `.talos/plans/` e `.talos/manual-validation/`; `talos-slice-review` não grava nada em disco (não há path de escrita na skill) — seu resultado existe só como saída do subagente, validada pelo gate `scripts/classify_findings.mjs`. |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** O resultado da revisão **não vira arquivo em lugar nenhum**. É relatório de saída do subagente para quem o chamou; o chamador lê o que foi corrigido, confirma e segue. Sem `.talos/reviews/`, sem campo novo de veredito persistido.
**Propagado em:** INTENT §1 D12/D14 (revisados)

---

### Q-CBR-05 — [sequencia] Alcance: sprint que não passa pelo backlog-generator

| Campo | Valor |
|-------|-------|
| **Status** | `aberta` |
| **Severidade** | ❌ |
| **Bloqueia** | cobertura real da revisão; sprint criada fora do generator fica sem revisão fria |
| **Âncoras** | `INTENT.md` §5 A5 · `packages/orchestrator/skills/talos/SKILL.md` seções "Interview-only mode" e "Full mode" · `packages/skills/talos-sprint-interview/SKILL.md` seção standalone |
| **Lacuna** | Com a revisão presa à skill de geração de backlog (Q-CBR-02), sprint que nasce fora dela não é revisada. Falta decidir se isso é aceito como escopo, ou se o caminho standalone precisa de tratamento próprio. |
| **Evidência (snapshot)** | `interview-only` cria o sprint file direto do `SPRINT_TEMPLATE.md` com `Backlog mestre: Não aplicável (standalone)`, sem passar por `talos-backlog-generator`; `talos-sprint-interview` declara "autoria é livre, execução é gateada", com re-gate por `talos_verify_sprint_file` só na entrada da execução. |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** Fora de escopo, documentado. Sprint standalone criada por `interview-only` segue sem revisão fria neste release; o limite é registrado explicitamente. Coerente com "autoria é livre, execução é gateada" — o sprint file continua re-gateado por `talos_verify_sprint_file` na entrada da execução.
**Propagado em:** INTENT §4 (fora de escopo)

---

### Q-CBR-06 — [governanca] O que resta de gate MCP sem artefato e sem lock

| Campo | Valor |
|-------|-------|
| **Status** | `resolvida` |
| **Severidade** | ✅ |
| **Bloqueia** | INTENT D11 (gate `COLD_BACKLOG`), D12 (selo de revisão) e D13 (lock MCP) |
| **Âncoras** | `INTENT.md` §1 D11–D13 · `packages/orchestrator/skills/talos/SKILL.md` gates G1 e G4 · `CLAUDE.md` invariante 1 e 4 |
| **Lacuna** | As decisões Q-CBR-02 e Q-CBR-04 removem a base dos três mecanismos que o INTENT tinha fechado: sem fase de orquestrador não há gate, sem arquivo não há o que G1 verifique, sem lock não há `run_id` para o selo nem prova de que o subagente rodou. Falta decidir se esses três caem por completo — a revisão passa a valer pela disciplina da skill, como no `create-guide` — ou se fica algum vestígio mecânico. |
| **Evidência (snapshot)** | `CLAUDE.md` declara "o pipeline decide por contrato (JSON, gates MCP, veredito estruturado), nunca por prosa ou improviso" e "Warning não substitui garantia"; o revisor frio do `create-guide` não tem nenhum gate mecânico equivalente — vale pela obrigação escrita na skill. |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** Caem os três. Sem gate `COLD_BACKLOG`, sem selo de revisão sha256, sem lock MCP. A revisão vale pela obrigação escrita na skill, como no `create-guide`. Nenhuma tool MCP nova entra neste release por conta da revisão.
**Propagado em:** INTENT §1 D11/D12/D13 (removidas) e §4

---

### Q-CBR-07 — [sequencia] Revisão envelhecida pela entrevista posterior

| Campo | Valor |
|-------|-------|
| **Status** | `resolvida` |
| **Severidade** | ✅ |
| **Bloqueia** | ordem entre revisão fria, `talos-sprint-interview` e selo do contrato §7 |
| **Âncoras** | `packages/skills/talos-backlog-generator/SKILL.md` passo 6 · `packages/skills/talos-sprint-interview/SKILL.md` passo 7 · `packages/templates/SPRINT_TEMPLATE.md` §7 |
| **Lacuna** | O generator entrega a §7 em `draft`; a revisão fria acontece logo depois, ainda em `draft`. Só mais tarde a `talos-sprint-interview` matura a §7 e a sela. Ou seja, o texto que a entrevista escreve entra em execução **sem ter sido revisado a frio**. Falta decidir se isso é aceito, se a entrevista também dispara uma revisão ao fechar, ou se o revisor roda depois da entrevista em vez de dentro do generator. |
| **Evidência (snapshot)** | `talos-backlog-generator` cria sprint file com "§7 contrato de produto em `draft`"; `talos-sprint-interview` grava `Contrato status: aprovado` + `Selo do contrato: sha256:<hash do §7>` no passo 7, depois da revisão do generator ter acontecido. |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** A revisão fria é o **último passo** do fluxo de autoria da skill de backlog: entrevista estruturada primeiro, escrita dos artefatos depois, revisão fria fechando. Não se revisa texto que ainda será alterado dentro do mesmo fluxo. Alcance da regra delimitado por Q-CBR-08.
**Propagado em:** INTENT §1 D10 (revisada)

---

### Q-CBR-08 — [sequencia] Quem dispara a revisão quando a entrevista do orquestrador roda depois

| Campo | Valor |
|-------|-------|
| **Status** | `em entrevista` |
| **Severidade** | ❌ |
| **Bloqueia** | ponto exato de disparo do mandato canônico; consequência direta de Q-CBR-07 |
| **Âncoras** | `packages/orchestrator/skills/talos/SKILL.md` Full mode passos 1a→3 · `packages/skills/talos-backlog-generator/SKILL.md` passo 4 · `packages/skills/talos-sprint-interview/SKILL.md` passo 7 |
| **Lacuna** | Q-CBR-02 prendeu a revisão à skill do generator; Q-CBR-07 diz que a revisão é o último passo. Os dois só coexistem se toda a entrevista acontecer dentro do generator. Mas o orquestrador tem uma segunda entrevista (fase 3 do full mode), disparada por `talos_scan_acceptance`, que edita a §7 **depois** do generator terminar. Falta decidir onde o mandato é disparado nesse caminho. |
| **Evidência (snapshot)** | No Full mode, o passo 1a roda o generator e o passo 3 roda `talos-sprint-interview` condicionalmente, persistindo respostas na §7 e gravando o selo — depois de o generator já ter encerrado. |
| **Última verificação em entrevista** | 2026-08-06 |

**Decisão registrada:** O generator revisa o que ele próprio criou e encerra. A `talos-sprint-interview` no momento da execução **não** re-dispara a revisão — **por design, não por concessão**: essa fase existe justamente para atualizar a §7 quando o estado do projeto mudou entre a criação do backlog e a execução daquela sprint (que pode ser a 1ª ou a 25ª). É ajuste pontual de contrato contra o código atual, com humano no loop. Re-revisar o lote inteiro por causa dele confrontaria os artefatos com um estado que já não existe.
**Propagado em:** INTENT §1 D21 e §3 R9

---

## Histórico de resoluções

| Data | ID | Decisão (resumo) | Onde propagado |
|------|-----|------------------|----------------|
| 2026-08-06 | Q-CBR-01 | Boundary = todo o output do generator na execução (backlog + todos os sprint files tocados) | INTENT §1 D9/D10 |
| 2026-08-06 | Q-CBR-02 | Revisão é interna à skill do backlog-generator, via subagente genérico do host com mandato canônico versionado na skill | INTENT §1 D9/D13 |
| 2026-08-06 | Q-CBR-03 | Revisor audita **e corrige**, padrão `create-guide`; devolve ao chamador o que alterou | INTENT §1 D15 |
| 2026-08-06 | Q-CBR-04 | Relatório não vira arquivo; é saída do subagente para o chamador | INTENT §1 D12/D14 |
| 2026-08-06 | Q-CBR-05 | Standalone (`interview-only`) fora de escopo, documentado | INTENT §4 |
| 2026-08-06 | Q-CBR-06 | Caem gate `COLD_BACKLOG`, selo de revisão e lock MCP; nenhuma tool MCP nova | INTENT §4 |
| 2026-08-06 | Q-CBR-07 | Revisão fria é o último passo do fluxo de autoria da skill de backlog | INTENT §1 D10 |
| 2026-08-06 | Q-CBR-08 | Entrevista posterior do orquestrador não re-dispara revisão (ressalva registrada) | INTENT §1 D21, §3 R9 |

---

## Evidências da última varredura

- `.app-work/guides/REVISAO_FRIA_BACKLOG_GUIDE/INTENT.md` — §5 A1–A5 bloqueantes; A6–A8 adiadas com default
- `.app-work/brainstorming/revisao-fria-backlog/BRAINSTORM.md` — decisões de processo e racional
- `packages/orchestrator/skills/talos/SKILL.md` — gates G1, G4, G8, `BACKLOG_INDEX`, `SELECT_NEXT_SPRINT`, `SPRINT_STATUS_SYNC`; modos `full`/`direct`/`execute`/`interview-only`
- `packages/skills/talos-task-validator/SKILL.md` — validador não corrige código nem propõe diff
- `packages/skills/talos-findings-repair/SKILL.md` — reparo é ator separado, bounded
- `packages/skills/talos-slice-review/SKILL.md` — disparo condicional; **ausência verificável** de path de escrita em disco
- `packages/skills/talos-sprint-interview/SKILL.md` — invariante "autoria é livre, execução é gateada"
- `packages/templates/SPRINT_TEMPLATE.md` — §4 fontes, §7 contrato + selo, §10 `policy_manifest.critical_review`
- `~/.claude/skills/create-guide/references/COLD_REVIEW_PROMPT.md` — revisor do Guide aplica findings reparáveis
- **Ausência verificável:** `.talos/backlog/` vazio; nenhum diretório de relatório de revisão existe hoje no projeto
