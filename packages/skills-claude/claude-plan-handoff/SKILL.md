---
name: claude-plan-handoff
description: Use when the user invokes /plan-handoff or asks for a handoff-grade plan that will be executed in another chat or session. Produces a self-sufficient, prescriptive, execution-ready plan artifact that a future executor can implement with minimal inference — even a less capable model. Skill id claude-plan-handoff (sufixo plan-handoff: cursor-plan-handoff, codex-plan-handoff; sufixo plan-execute: cursor-plan-execute, codex-plan-execute, claude-plan-execute).
---

# Plan Handoff (Claude)

Use esta skill quando o objetivo principal é **planejar**, especialmente quando o plano resultante será executado em outro chat, por outro modelo, ou após reset de contexto. 

O plano resultante deve ser extremamente focado na engenharia física da solução, evitando repetir dados subjetivos de produto ou recriar o PRD, mas fornecendo todo o contexto técnico (como contratos, caminhos de arquivos e comandos de teste) para que o executor o implemente sem adivinhar.

---

## Fluxo Obrigatório

### Fase 1 — Classificação da tarefa
Classifique a tarefa em um destes tipos primários:
* `feature` (nova funcionalidade, store, DI)
* `ui` (página, layout, componente visual)
* `contract` (DTO, Entity, Mapper, schemas)
* `navigation` (rotas, guards)
* `shared` (Enums, VOs compartilhados)
* `security` (permissões, segredos, logs)
* `diagnostic` (bugs, investigações)
* `refactoring` (otimizações internas)
* `testing` (criação e execução de testes)

Ação: Leia `project-rules/index/<tipo>.md` e as regras associadas para carregar as restrições obrigatórias da tarefa.

### Fase 2 — Grounding e Inspecção no Código
Inspecione diretamente o codebase real antes de redigir o plano. Confirme:
* Presença/ausência de classes, métodos e contratos afetados.
* Padrões de design e shapes de código já existentes no projeto para servirem de molde.
* Convenções de imports e nomes de arquivos.
* Comandos exatos de linter/testes locais incluindo o path do package afetado no monorepo.

### Fase 3 — Resolução de Dúvidas
Use `AskUserQuestion` para sanar questões críticas que afetam diretamente o escopo ou arquitetura técnica. Salve as respostas como decisões fechadas no plano.

### Fase 4 — Escrita do Plano
Escreva o artefato em `.claude/plans/<nome-descritivo>.md` seguindo `PLAN_TEMPLATE.md` e `BOUNDARY_PRD_PLAN.md` — **localize ambos via `Glob **/PLAN_TEMPLATE*.md` e `**/BOUNDARY_PRD_PLAN.md` no repo ativo** (não dependa de paths fixos do vault).

---

## Metadados obrigatórios (topo do artefato)

```md
## Metadados de execução
- Plan prefix: `claude`
- Execution mode: `sequencial (T01→TN)` | `orchestrated-per-slice`
- Executor skill: `claude-plan-execute`
- Internal validator: `claude-task-validator`
- External review: `claude-slice-review` (optional)
```

Regras:

- `Plan prefix` é sempre `claude`.
- Se o `Execution mode` não estiver decidido, o plano **não** está pronto para execução.
- O artefato deve ser autossuficiente: o executor decide prefixo, modo e cadeia lendo só o plano, sem depender da memória do chat.

---

## Estrutura do Plano (Output Contract)

O plano final gerado deve ser compacto (teto orientativo de ~250-350 linhas, até ~450 para slices grandes) e conter as seguintes seções na ordem sequencial limpa de 1 a 8:

### 1. Tradução executiva
* O que será implementado e qual o resultado observável técnico da entrega.
* Padrão de referência no monorepo a ser espelhado (ex.: "espelhar módulo X em ...").
* Diferenças obrigatórias vs referência (tabela ou lista contrastando referências com a decisão D* do PRD).

### 2. Invariantes de execução (derivados do PRD)
* Invariantes e decisões técnicas inegociáveis derivadas do PRD (ex: sem refetch ao alterar categoria, nulls-last, etc.).
* Não recopie a tabela inteira do PRD; apenas aponte os IDs como referência (ex.: `PRD §5 D12`).

### 3. Pitfalls
* Mapeamento de anti-padrões comuns no codebase que devem ser evitados na entrega (Formato: `anti-padrão observado` → `padrão canônico correto`).

### 4. Estado na abertura da sprint (pré-implementação)
* 3 a 6 bullets pontuais sobre a situação atual no código (ex: "classe X existe mas não possui campo Y"). Não colar trechos longos de código aqui.

### 5. Tarefas de execução
* As tarefas T01...TNN numeradas e sequenciadas logicamente. Se `execution_mode: orchestrated-per-slice`, agrupe-as em Slices.
* Cada tarefa `#### TNN.` deve detalhar, conforme o schema de `BOUNDARY_PRD_PLAN.md` (localizado via `Glob` no repo ativo), quando aplicável:
  * **Objetivo:** resultado específico e observável.
  * **Referência:** padrão de pasta/módulo no repo (evite listas longas de paths).
  * **Pré-condições:** o que deve ser verdade antes de iniciar.
  * **Mudança esperada:** o que concretamente muda.
  * **Invariantes preservados:** regras e comportamentos intocáveis.
  * **Não fazer / Não mudar:** atalhos a evitar.
  * **Dependências:** nenhuma ou T0X.
  * **Riscos:** somente quando não óbvio.
  * **Critério de done:** sinal objetivo de conclusão.
  * **Validação local:** comando exato de teste ou linter com path do package (ex: `cd packages/módulo && flutter test ...`).
  * **Quality gates:** opcional em tasks críticas.
  * **Casos mínimos:** somente em tasks de teste (lista numerada).
* Última task típica: **Validação final** (`flutter analyze`, `flutter test`, passos manuais alinhados a **PRD §8–10**).

### 6. Contratos técnicos (só ambiguidade PRD -> código)
* Assinaturas de classes, métodos, estruturas Dart/JSON/SQL, schemas ou mapeamentos que evitam que o executor invente nomes incorretos.

### 7. Slices (somente se `execution_mode: orchestrated-per-slice`)
* Tabela ou mapeamento das slices contendo: ID da slice, lista de tasks (T01, T02), e boundary de diff esperado no git.

### 8. Validação e checklist (validator)
* Critérios derivados de **PRD §10** + invariantes **§2** deste plano.
* Lista que guia o executor e o `claude-task-validator`.
* Tag `(§14)` no título é **opcional** (compatibilidade com planos legados).

---

## Seções Opcionais de Planejamento

Caso existam bloqueios ou dúvidas na fase de rascunho, adicione:
### 9. Perguntas em Aberto e Bloqueios Reais
* Bloqueios que travam a implementação segura. O executor recusará o plano se houver pendências ativas.
* **Não** confundir com PRD §13 (Referências).

---

## O que este template NÃO inclui (propositalmente):
* Handoff prompt final (redundante, pois o executor lê o arquivo diretamente).
* Gate de prontidão do planejador (a aprovação do plano é feita no chat).
* Lista repetitiva de todas as regras do `project-rules` (o executor já as carrega via workflow).
* Cópia literal do escopo in/out do PRD.
* Inventário de todos os arquivos tocados.

---

## Execução downstream

O executor (`claude-plan-execute`) consome §2, §5, §6, §7, §8 e, se o §8 for fino, **PRD §8–10** do PRD linkado no plano.