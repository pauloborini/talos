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

Se faltar informação não bloqueante, gere o backlog com premissas marcadas e registre perguntas/riscos. Pergunte antes de salvar somente quando faltar uma das decisões bloqueantes: resultado final esperado, fronteira de escopo ou plataforma/produto alvo.

---

## Workflow obrigatório

1. **Resolver templates canônicos:** descubra a raiz do plugin/bundle e leia `packages/templates/BACKLOG_MESTRE_TEMPLATE.md` e `packages/templates/SPRINT_TEMPLATE.md`. Se algum estiver ausente, aborte com: `Template canônico ausente: <nome>`.
2. **Entender pedido:** extraia objetivo, usuários, resultado final esperado, fora de escopo, restrições, dependências, riscos, stakeholders e sinais de valor.
3. **Inspecionar contexto real:** quando houver repo/projeto ativo, busque documentos existentes (`BACKLOG_MESTRE*.md`, `ROADMAP*.md`, specs, OpenAPI, docs de arquitetura) e código que influencie dependências. Não invente contrato técnico.
4. **Fechar ambiguidade crítica:** se uma decisão bloquear a decomposição segura, faça até 3 perguntas objetivas. Se o usuário não responder e houver caminho razoável, registre a premissa como risco/decisão pendente.
5. **Preencher o backlog mestre:** mantenha todas as seções de `BACKLOG_MESTRE_TEMPLATE.md`. A seção `## 7. Registro de sprints` é índice macro: uma linha por sprint, com links/estado para Sprint file, PLAN e State. Não copie critérios completos, tasks ou evidência granular no backlog.
6. **Criar/atualizar sprint files:** para cada sprint nova ou alterada, preencha `SPRINT_TEMPLATE.md` em `.talos/backlog/sprints/SPRINT_S<NN>_<slug>.md` (ou path pedido). O sprint file deve conter objetivo único, escopo/fora de escopo, DoR/DoD, dependências, decisões locais, **§7 contrato de produto em `draft`**, `eval_manifest`, `policy_manifest` e evidence-to-claim.
7. **Decompor em sprints:** transforme o objetivo em fatias verticais pequenas. Cada sprint deve ter objetivo único, dependências, sprint file e PLAN/State marcados como `pendente` até existirem.
8. **Priorizar:** para cada sprint, preencha MoSCoW, ganho, esforço e prioridade usando `## 8.1 Regra determinística` do template.
9. **Selecionar próxima sprint:** após salvar backlog + sprint files, chame `talos_verify_backlog_index` e depois `talos_select_next_sprint`. A sprint escolhida deve vir do resultado MCP (`selected.sprint_id`/`selected.sprint_file_path`), não de julgamento narrativo. Registre a justificativa em `## 8.2 Próxima sprint executável`.
10. **Atualização não destrutiva:** se o arquivo já existe, compare antes/depois com `validateBacklogUpdate(before, after, { authorizedIds })` de `../_shared/scripts/document_quality.mjs`. `authorizedIds` contém somente IDs cuja mudança foi explicitamente decidida pelo usuário. Preserve demais IDs, linhas `done`, decisões `decidido|fechado|aprovado`, itens/sprints e ordem histórica.
11. **Registrar alterações:** toda atualização acrescenta `## Registro de alterações` (data, IDs afetados, motivo e fonte) ou atualiza seção equivalente existente. Não reescreva histórico anterior.
12. **Salvar artefatos:** grave o backlog no path pedido ou, se não houver path, crie `.talos/backlog/BACKLOG_MESTRE_<slug>.md`; grave sprint files no diretório recomendado pelo template.
13. **Validar antes de finalizar:** bloqueie se `validateBacklogUpdate` apontar sprint/decisão removida, sprint `done` alterada, enum inválido, ciclo de dependência, placeholder acidental ou falta de registro. Confirme também que dependências referenciam IDs existentes, todo sprint do backlog aponta para sprint file e todo sprint file aponta de volta para o backlog. Chame `talos_verify_sprint_file` para sprint files criados/alterados, `talos_verify_backlog_index` para o backlog final e `talos_select_next_sprint` para a próxima sprint. Se qualquer gate bloquear ou estiver indisponível, não declare a sprint pronta para entrevista/plano.

Quando chamada pelo orquestrador em `backlog_first`, finalize retornando dados estruturados mínimos:

```json
{
  "backlog_path": ".talos/backlog/BACKLOG_MESTRE_<slug>.md",
  "sprint_id": "S<NN>",
  "sprint_file_path": ".talos/backlog/sprints/SPRINT_S<NN>_<slug>.md",
  "plan_path": "pendente",
  "state_path": "pendente"
}
```

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
- Não transformar o backlog em plano técnico de implementação. Código, classes e comandos entram no PLAN quando apropriado, não no backlog mestre.
- Não deixar `[...]` ou placeholders óbvios no arquivo final, salvo quando o campo estiver deliberadamente pendente e explicado.
- Não renumerar IDs, reabrir/editar sprint `done`, alterar decisão fechada ou remover item não relacionado por conveniência editorial.
- Não gerar plano/código. Em `backlog_first`, sua saída é backlog + sprint file + próxima sprint executável; a próxima fase pertence a `talos-sprint-interview` / `talos-plan-handoff`.
