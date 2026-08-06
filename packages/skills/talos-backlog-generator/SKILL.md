---
name: talos-backlog-generator
description: Skill `talos-backlog-generator`. Use quando o usuário acionar explicitamente `$talos-backlog-generator`, pedir explicitamente para criar/atualizar um backlog mestre Talos, ou quando o `talos` receber macro input em `full`/`direct` e o MCP declarar `routing.document_flow.priority = backlog_first`. Gera/atualiza `BACKLOG_MESTRE_*.md` como índice macro enxuto e cria/atualiza sprint files `SPRINT_S<NN>_*.md` via `SPRINT_TEMPLATE.md`.
---

# Talos Backlog Generator

Crie backlogs mestres Talos em PT-BR, ancorados nos templates canônicos, com decomposição gradual em fases e sprints pequenas, priorização MoSCoW, matriz esforço x ganho, dependências explícitas, gates, riscos e próxima sprint executável.

Esta skill é documental: ela cria ou atualiza o `BACKLOG_MESTRE*.md` e os sprint files vivos no projeto consumidor. Ela não implementa código e não gera plano/código.

Contrato atual:

- Backlog mestre = índice estratégico + estado consolidado.
- Sprint file = fonte primária viva da sprint **e** casa do contrato de produto (§7: D*, cenários UX, aceite binário).
- Aceite/produto mora na §7 do sprint file; não há PRD.
- PLAN nasce do sprint file (§7 + §9) + código real.
- Backlog não vira plano direto.

Acione esta skill em dois casos:

- pedido explícito do usuário para criar, gerar, montar, estruturar ou atualizar backlog mestre;
- fase `backlog_first` do `talos`, quando macro input ainda não tem backlog canônico e precisa ser decomposto antes de entrevista de contrato/plano/execução.

Não acione para `sprint`/`backlog-item`, plano já existente, `execute`, `interview-only` ou `audit`. Nesses casos o escopo já está recortado ou não há pipeline de backlog.

---

## Entradas aceitas

- Conversa livre, ideia de feature, prompt exploratório ou briefing incompleto.
- Spec macro, roadmap, lista de requisitos, issue/backlog item ou texto colado pelo usuário.
- Opcional: nome do projeto/feature, path de saída, fontes canônicas, restrições técnicas, prioridade de negócio e escopo fora do ciclo.

Se faltar informação não bloqueante, gere o backlog com premissas marcadas e registre perguntas/riscos. O gatilho de pergunta é o scan de ambiguidade do rascunho (passo 4), não uma lista fixa de assuntos: com padrão bloqueante, conduza rodadas estruturadas; sem padrão bloqueante, não pergunte.

---

## Workflow obrigatório

1. **Resolver templates canônicos:** descubra a raiz do plugin/bundle e leia `packages/templates/BACKLOG_MESTRE_TEMPLATE.md` e `packages/templates/SPRINT_TEMPLATE.md`. Se algum estiver ausente, aborte com: `Template canônico ausente: <nome>`.
2. **Entender pedido:** extraia objetivo, usuários, resultado final esperado, fora de escopo, restrições, dependências, riscos, stakeholders e sinais de valor.
3. **Inspecionar contexto real:** quando houver repo/projeto ativo, busque documentos existentes (`BACKLOG_MESTRE*.md`, `ROADMAP*.md`, specs, OpenAPI, docs de arquitetura) e código que influencie dependências. Não invente contrato técnico.
4. **Fechar ambiguidade por entrevista estruturada:** antes de gravar qualquer artefato, escaneie o rascunho em memória — chame `talos_scan_acceptance` com `sprint_markdown` (o markdown de cada sprint do rascunho, ainda sem arquivo em disco) e leia os padrões bloqueantes. Enquanto houver padrão bloqueante (`blocking_count > 0`): (a) chame `talos_capabilities` e leia `question_prompt` — o número máximo de perguntas e de opções por rodada vem do descritor do host (`max_questions`, `options_per_question`), nunca de constante da skill; (b) conduza a rodada com `decision_id` `D<n>` estável e recomendação explícita, excluindo decisões já fechadas com `pendingInterviewQuestions` de `../_shared/scripts/document_quality.mjs` — decisão fechada não reaparece em rodada posterior; (c) aplique cada resposta com `Origem: usuario` ao fim da rodada em que foi dada, antes de abrir a rodada seguinte: enquanto a sprint só existe como rascunho, edite o markdown em memória e grave os artefatos quando as rodadas fecharem (`persistInterviewRound` lê o arquivo antes de aplicar e, sobre path inexistente, lança `INTERVIEW_PERSISTENCE_FAILED`); quando a rodada roda sobre sprint file já existente em disco, use `persistInterviewRound(sprint_path, answers)` de `../_shared/scripts/document_quality.mjs` rodada a rodada — nunca acumule respostas de várias rodadas para materializar tudo no fim; (d) reindexe o rascunho e recalcule os padrões pendentes. Decisão que o usuário não fechar vira premissa **registrada** (`Origem: premissa`), não pergunta repetida: premissa declarada não trava o fluxo — a consequência de seguir com premissa é o bloqueio de `premissa` em sprint `Must`/`P0` instalado pelo gate de procedência. Se `question_prompt` estiver ausente do descritor do host, bloqueie a rodada: não degrade para pergunta livre.
5. **Preencher o backlog mestre:** mantenha todas as seções de `BACKLOG_MESTRE_TEMPLATE.md`. A seção `## 7. Registro de sprints` é índice macro: uma linha por sprint, com links/estado para Sprint file, PLAN e State. Não copie critérios completos, tasks ou evidência granular no backlog.
6. **Criar/atualizar sprint files:** para cada sprint nova ou alterada, preencha `SPRINT_TEMPLATE.md` em `.talos/backlog/sprints/SPRINT_S<NN>_<slug>.md` (ou path pedido). O sprint file deve conter objetivo único, escopo/fora de escopo, DoR/DoD, dependências, decisões locais, **§7 contrato de produto em `draft`**, `eval_manifest`, `policy_manifest` e evidence-to-claim.
7. **Decompor em sprints:** transforme o objetivo em fatias verticais pequenas. Cada sprint deve ter objetivo único, dependências, sprint file e PLAN/State marcados como `pendente` até existirem.
8. **Priorizar:** para cada sprint, preencha MoSCoW, ganho, esforço e prioridade usando `## 8.1 Regra determinística` do template.
9. **Selecionar próxima sprint:** após salvar backlog + sprint files, chame `talos_verify_backlog_index` e depois `talos_select_next_sprint`. A sprint escolhida deve vir do resultado MCP (`selected.sprint_id`/`selected.sprint_file_path`), não de julgamento narrativo. Registre a justificativa em `## 8.2 Próxima sprint executável`.
10. **Atualização não destrutiva:** se o arquivo já existe, compare antes/depois com `validateBacklogUpdate(before, after, { authorizedIds })` de `../_shared/scripts/document_quality.mjs`. `authorizedIds` contém somente IDs cuja mudança foi explicitamente decidida pelo usuário. Preserve demais IDs, linhas `done`, decisões `decidido|fechado|aprovado`, itens/sprints e ordem histórica.
11. **Registrar alterações:** toda atualização acrescenta `## Registro de alterações` (data, IDs afetados, motivo e fonte) ou atualiza seção equivalente existente. Não reescreva histórico anterior.
12. **Salvar artefatos:** grave o backlog no path pedido ou, se não houver path, crie `.talos/backlog/BACKLOG_MESTRE_<slug>.md`; grave sprint files no diretório recomendado pelo template.
13. **Validar antes de finalizar:** bloqueie se `validateBacklogUpdate` apontar sprint/decisão removida, sprint `done` alterada, enum inválido, ciclo de dependência, placeholder acidental ou falta de registro. Confirme também que dependências referenciam IDs existentes, todo sprint do backlog aponta para sprint file e todo sprint file aponta de volta para o backlog. Chame `talos_verify_sprint_file` para sprint files criados/alterados, `talos_verify_backlog_index` para o backlog final e `talos_select_next_sprint` para a próxima sprint. Se qualquer gate bloquear ou estiver indisponível, não declare a sprint pronta para entrevista/plano.
14. **Revisar a frio e entregar:** depois dos gates do passo 13, a skill encerra despachando um revisor-corretor em contexto novo, sem acesso à conversa que originou os artefatos — quem escreveu não revisa o que escreveu. (1) Monte a lista de paths efetivamente escritos nesta execução: o backlog mestre e **cada** sprint file criado ou alterado — não apenas a sprint selecionada; (2) colete as fontes de discussão da linha `Discussão` da §4 desses sprint files; (3) leia do disco `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` (raiz do bundle, como no passo 1) e substitua apenas os parâmetros `<BACKLOG_PATH>`, `<SPRINT_PATHS>`, `<FONTES_DE_DISCUSSAO>` e `<RAIZ_DO_REPO>` — nunca reescreva o mandato de memória nem o resuma: mandato improvisado varia de rigor a cada execução e não deixa rastro do que foi confrontado; (4) resolva `talos_capabilities.subagent_dispatch` e despache pelo verbo declarado ali um único subagente genérico/default do host (não um agente registrado `talos-*`), em foreground, aguardando o retorno — dispatch incondicional, sem branch por host e sem leitura de `dispatch_capability`; (5) receba o relatório, repasse ao chamador os findings por severidade, o que foi alterado com path e o veredito, e só então entregue o backlog — o relatório nunca é materializado em arquivo (nenhum diretório novo sob `.talos/`). Falha de dispatch **bloqueia a entrega** com causa e próxima ação: não existe caminho de degradação nem revisão inline pelo próprio autor. Veredito `fail` ou `interview_required`: repasse ao chamador sem declarar o backlog pronto. Havendo artefato alterado pelo revisor, reexecute `talos_verify_sprint_file` sobre os sprint files tocados e `talos_verify_backlog_index` sobre o backlog antes de entregar — artefato corrigido e não regateado é artefato não verificado. Se o revisor não alterou nada (`findings_applied: 0`), entregue sem regatear: o artefato é byte-idêntico ao que os gates do passo 13 já aprovaram.

Quando chamada pelo orquestrador em `backlog_first`, finalize retornando dados estruturados mínimos:

```json
{
  "backlog_path": ".talos/backlog/BACKLOG_MESTRE_<slug>.md",
  "sprint_id": "S<NN>",
  "sprint_file_path": ".talos/backlog/sprints/SPRINT_S<NN>_<slug>.md",
  "plan_path": "pendente",
  "state_path": "pendente",
  "cold_review": {
    "dispatched": true,
    "verdict": "pass | pass_with_observations | fail | interview_required",
    "findings_applied": 0
  }
}
```

O orquestrador ecoa `cold_review` no ledger como informação da execução — não é gate novo, não bloqueia nada por si só: o bloqueio de `premissa`/path/schema já é feito pelos gates de procedência da etapa anterior.

O orquestrador deve passar `sprint_id` + `sprint_file_path` à próxima fase (`talos-sprint-interview` se ambiguidade / `talos-plan-handoff`). Macro fica no backlog mestre; entrevista/plano/executor recebem apenas a sprint selecionada.

---

## Regras de decomposição

- Gere sprints como unidades de entrega, não períodos de tempo.
- Mantenha cada sprint com 6 a 8 tasks no máximo quando o contrato §7 for detalhado; se uma sprint tiver mais de um objetivo, quebre em `S<NN>a/b/c`.
- Comece com descoberta/contrato quando houver ambiguidade ou integração. Não pule para implementação quando o contrato ainda for desconhecido.
- Preserve a ordem natural: descoberta → especificação/contrato → backend/infra quando necessário → front/app → hardening → QA → rollout.
- Use dependências para permitir paralelismo seguro; não transforme fase em fila rígida se duas sprints independentes puderem avançar.
- Inclua estados de erro, loading, empty, permission, observabilidade, QA e rollout onde aplicável. Esses itens não são “extras”; são parte do produto pronto e devem aparecer na §7.2/§7.3 do sprint file.

---

## Regras de priorização

- `Must`: obrigatório para resultado final, segurança, compliance, contrato ou desbloqueio.
- `Should`: importante para qualidade/adoção, mas contornável por um ciclo.
- `Could`: refinamento ou melhoria desejável que não bloqueia entrega.
- `Won't now`: fora do ciclo atual; registre para reduzir reabertura de discussão.
- `P0`: alto ganho com baixo/médio esforço ou Must desbloqueador.
- `P1`: alto ganho com alto esforço, ou médio ganho com baixo esforço.
- `P2`: médio ganho/médio esforço, ou baixo ganho/baixo esforço.
- `P3`: baixo ganho com médio/alto esforço, candidato a adiar.

Se MoSCoW e esforço x ganho conflitarem, MoSCoW vence; uma sprint `Must` de esforço alto deve ser quebrada, não rebaixada silenciosamente.

---

## Qualidade esperada do backlog

O backlog final deve:

- Declarar precedência documental e fontes canônicas.
- Ter `Origem` preenchida em cada decisão do backlog e `origin` em cada `AC-*` da §7.3 dos sprint files, com o valor derivado da fonte real: resposta de entrevista → `usuario`; leitura de código/contrato → `derivado:<path>` com o path verificado contra o disco; o resto → `premissa`, declarado como tal em vez de disfarçado.
- Explicitar resultado esperado e fora do escopo.
- Ter dependências internas/externas e decisões bloqueantes com dono/status.
- Ter registro de sprints com MoSCoW, ganho, esforço, prioridade, Sprint file, PLAN, State, dependências, estado e gate.
- Ter sprint files vivos para sprints criadas/alteradas, com §7 draft, `eval_manifest`, `policy_manifest` e evidence-to-claim.
- Ter grafo de dependência coerente com a tabela de sprints.
- Ter `Fase-fonte` coerente com o template e usada só como metadado de índice, não como fonte primária de escopo.
- Ter riscos, decisões e próxima sprint executável preenchidos.
- Ser específico o bastante para orientar sprint files; o aceite de produto deve nascer/maturar na §7 via `talos-sprint-interview`.
- Preservar histórico/IDs em update e passar validação de ciclos/enums/placeholders.

---

## Proibições

- Não entregar uma lista genérica de tarefas sem usar o template.
- Não remover gates, DoR/DoD, riscos, decisões ou trilhas transversais.
- Não inventar endpoints, tabelas, schemas, fornecedores, métricas ou responsabilidades como fatos. Quando forem hipóteses, marcar como premissa.
- Não falsificar procedência: marcar como `usuario` ou `derivado:<path>` o que o modelo inferiu desarma o gate de procedência deste release — o que não veio de resposta do usuário nem de leitura verificada de código/contrato é `premissa`, declarado como tal.
- Não transformar o backlog em plano técnico de implementação. Código, classes e comandos entram no PLAN quando apropriado, não no backlog mestre.
- Não deixar `[...]` ou placeholders óbvios no arquivo final, salvo quando o campo estiver deliberadamente pendente e explicado.
- Não renumerar IDs, reabrir/editar sprint `done`, alterar decisão fechada ou remover item não relacionado por conveniência editorial.
- Não gerar plano/código. Em `backlog_first`, sua saída é backlog + sprint file + próxima sprint executável; a próxima fase pertence a `talos-sprint-interview` / `talos-plan-handoff`.
