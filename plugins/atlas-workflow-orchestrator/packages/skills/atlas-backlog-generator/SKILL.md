---
name: atlas-backlog-generator
description: Skill `atlas-backlog-generator`. Use somente quando o usuário acionar explicitamente `$atlas-backlog-generator` ou pedir explicitamente para criar, gerar, montar, estruturar ou atualizar um backlog mestre Atlas a partir de uma conversa, prompt, ideia de feature, briefing, PRD macro, lista solta de requisitos, roadmap ou objetivo de produto, usando `BACKLOG_MESTRE_TEMPLATE.md` como template canônico e aplicando fases, sprints, dependências, MoSCoW e esforço x ganho. Não usar por inferência implícita em pedidos genéricos de planejamento, brainstorming, PRD ou implementação.
---

# Atlas Backlog Generator

Crie backlogs mestres Atlas em PT-BR, ancorados no template canônico, com decomposição gradual em fases e sprints pequenas, priorização MoSCoW, matriz esforço x ganho, dependências explícitas, gates, riscos e próxima sprint executável.

Esta skill é documental: ela cria ou atualiza o `BACKLOG_MESTRE*.md` no projeto consumidor. Ela não implementa código, não gera PRDs de sprint e não substitui `atlas-sprint-prd-generator`.

Acione esta skill apenas por pedido explícito. Se o usuário apenas pedir planejamento, brainstorming, PRD ou execução, não usar esta skill automaticamente.

---

## Entradas aceitas

- Conversa livre, ideia de feature, prompt exploratório ou briefing incompleto.
- PRD macro, roadmap, lista de requisitos, issue/backlog item ou texto colado pelo usuário.
- Opcional: nome do projeto/feature, path de saída, fontes canônicas, restrições técnicas, prioridade de negócio e escopo fora do ciclo.

Se faltar informação não bloqueante, gere o backlog com premissas marcadas e registre perguntas/riscos. Pergunte antes de salvar somente quando faltar uma das decisões bloqueantes: resultado final esperado, fronteira de escopo ou plataforma/produto alvo.

---

## Workflow obrigatório

1. **Resolver template canônico:** descubra a raiz do plugin/bundle e leia `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`. Se ausente, aborte com: `Template canônico ausente: BACKLOG_MESTRE_TEMPLATE.md`.
2. **Entender pedido:** extraia objetivo, usuários, resultado final esperado, fora de escopo, restrições, dependências, riscos, stakeholders e sinais de valor.
3. **Inspecionar contexto real:** quando houver repo/projeto ativo, busque documentos existentes (`BACKLOG_MESTRE*.md`, `PRD*.md`, `ROADMAP*.md`, specs, OpenAPI, docs de arquitetura) e código que influencie dependências. Não invente contrato técnico.
4. **Fechar ambiguidade crítica:** se uma decisão bloquear a decomposição segura, faça até 3 perguntas objetivas. Se o usuário não responder e houver caminho razoável, registre a premissa como risco/decisão pendente.
5. **Preencher o template:** mantenha todas as seções do template e substitua placeholders por conteúdo específico. Não apague seções; use `não aplicável` apenas com justificativa curta.
6. **Decompor em sprints:** transforme o objetivo em fatias verticais pequenas, cada uma com objetivo único, dependências e PRD futuro (`PRD_S<NN>_<slug>.md`).
7. **Priorizar:** para cada sprint, preencha MoSCoW, ganho, esforço e prioridade usando a regra da seção 8.3 do template.
8. **Selecionar próxima sprint:** escolha a primeira sprint executável respeitando dependências, DoR, MoSCoW, esforço x ganho e risco. Registre a justificativa na seção 20.
9. **Salvar artefato:** grave o backlog no path pedido ou, se não houver path, crie o diretório `.atlas/backlog/` no projeto consumidor e use `.atlas/backlog/BACKLOG_MESTRE_<slug>.md`.
10. **Validar antes de finalizar:** releia o arquivo salvo e confirme que não restaram placeholders acidentais, exceto campos conscientemente pendentes e marcados.

---

## Regras de decomposição

- Gere sprints como unidades de entrega, não períodos de tempo.
- Mantenha cada sprint com 6 a 8 tasks no máximo quando o PRD futuro for detalhado; se uma sprint tiver mais de um objetivo, quebre em `S<NN>a/b/c`.
- Comece com descoberta/contrato quando houver ambiguidade ou integração. Não pule para implementação quando o contrato ainda for desconhecido.
- Preserve a ordem natural: descoberta → especificação/contrato → backend/infra quando necessário → front/app → hardening → QA → rollout.
- Use dependências para permitir paralelismo seguro; não transforme fase em fila rígida se duas sprints independentes puderem avançar.
- Inclua estados de erro, loading, empty, permission, observabilidade, QA e rollout onde aplicável. Esses itens não são “extras”; são parte do produto pronto.

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
- Ter registro de sprints com MoSCoW, ganho, esforço, prioridade, PRD futuro, dependências, estado e gate.
- Ter grafo de dependência coerente com a tabela de sprints.
- Ter catálogo de fases preservado e adaptado apenas quando necessário.
- Ter riscos, decisões e próxima sprint executável preenchidos.
- Ser específico o bastante para gerar PRDs de sprint depois com `atlas-sprint-prd-generator`.

---

## Proibições

- Não entregar uma lista genérica de tarefas sem usar o template.
- Não remover gates, DoR/DoD, riscos, decisões ou trilhas transversais.
- Não inventar endpoints, tabelas, schemas, fornecedores, métricas ou responsabilidades como fatos. Quando forem hipóteses, marcar como premissa.
- Não transformar o backlog em plano técnico de implementação. Código, classes e comandos entram no plano/PRD quando apropriado, não no backlog mestre.
- Não deixar `[...]` ou placeholders óbvios no arquivo final, salvo quando o campo estiver deliberadamente pendente e explicado.
