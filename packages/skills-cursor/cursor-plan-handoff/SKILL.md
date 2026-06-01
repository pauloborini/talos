---
name: cursor-plan-handoff
description: Produz planos handoff-grade no Cursor Plan Mode para execução em outro chat, modelo ou após reset de contexto. Ative SOMENTE com gatilho explícito ("handoff", "outro chat", "outra IA", etc.) ou invocação pelo nome; em pedidos grandes ambíguos, pergunte uma vez com AskQuestion; não auto-aplique em `/plan` genérico. Planos sob esta skill exigem verificar código antes de inferir, pitfalls ancorados em evidência, quality gates por tarefa e validação final explícita — alinhado ao repositório. Nome canónico cursor-plan-handoff (sufixo plan-handoff: codex-plan-handoff, claude-plan-handoff; sufixo plan-execute: cursor-plan-execute, codex-plan-execute, claude-plan-execute).
---

# Plan Handoff (Cursor)

Use esta skill no Cursor Plan Mode quando o objetivo principal é **planejar**, especialmente quando o plano resultante será executado em outro chat, por outro modelo, ou após reset de contexto. O plano resultante funciona como o guia definitivo de execução técnica, enxuto e prático.

Templates canônicos: `<raiz-do-plugin>/packages/templates/PLAN_TEMPLATE.md` e `<raiz-do-plugin>/packages/templates/BOUNDARY_PRD_PLAN.md`.

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Resolver `PLAN_TEMPLATE.md` e `BOUNDARY_PRD_PLAN.md` a partir da raiz do plugin/bundle, antes de olhar qualquer arquivo do repo consumidor.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PLAN_TEMPLATE.md` ou `packages/templates/BOUNDARY_PRD_PLAN.md` não existir, abortar com erro claro: `Template canônico ausente: <nome-do-template>`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Cadeia de Execução (Cursor)

```text
cursor-plan-handoff → cursor-plan-execute-orchestrated → cursor-slice-review
                        (+ cursor-task-validator nos gates)
```

---

## Fluxo Obrigatório

1. **Classificação da tarefa:** feature, ui, contract, navigation, shared, security, diagnostic, refactoring, testing. Leia `project-rules/index/<tipo>.md` e regras em `project-rules/rules/` (ou o equivalente declarado em `AGENTS.md` do repo ativo).
2. **Grounding no Código:** Explore o repo antes de supor. Confirme padrões, contratos e comandos locais de linter/testes com path do package.
3. **Decisões Estáveis:** Sanar dúvidas críticas com `AskQuestion`. Registre no plano (referenciar `PRD §5` D* — não recopiar a tabela inteira).
4. **Escrita do Plano:** Escreva em `.claude/plans/<nome-descritivo>.md` seguindo `PLAN_TEMPLATE.md` (seções 1–8).

---

## Estrutura do Plano (Output Contract)

Teto orientativo ~250–350 linhas (até ~450 com slices). Seções 1 a 8 na ordem do template:

### 1. Tradução executiva

* O que será implementado e qual o resultado observável técnico da entrega.
* Padrão de referência no monorepo a ser espelhado (ex.: "espelhar módulo X em ...").
* Diferenças obrigatórias vs referência (tabela ou lista contrastando referência com decisões `PRD §5` D*).
* Metadados de execução:
  * `plan_prefix: cursor` (fixo)
  * `execution_mode: orchestrated-per-slice`
* Link ao PRD no cabeçalho/tabela (path relativo).

### 2. Invariantes de execução (derivados do PRD)

* Invariantes técnicos inegociáveis (ex.: sem refetch ao alterar categoria, nulls-last).
* Referenciar IDs: `PRD §5 D12` — não recopiar a tabela D* inteira.

### 3. Pitfalls

* `anti-padrão observado` → `padrão canônico correto`.

### 4. Estado na abertura da sprint (pré-implementação)

* 3 a 6 bullets sobre a situação atual no código (comportamento/ausência — não inventário global de arquivos).

### 5. Tarefas de execução

* Tarefas `#### T01.` … `TNN` (agrupar por slice se `orchestrated-per-slice`).
* Cada task deve incluir, quando aplicável (schema do boundary):
  * **Objetivo**
  * **Referência** (módulo/padrão no monorepo — evite listas longas de paths)
  * **Pré-condições**
  * **Mudança esperada**
  * **Invariantes preservados**
  * **Não mudar** / **Não fazer**
  * **Dependências**
  * **Riscos** (se não óbvio)
  * **Critério de done**
  * **Validação local** (comando com path do package)
  * **Quality gates** (opcional em tasks críticas)
  * **Casos mínimos** (somente em tasks de teste)

### 6. Contratos técnicos (só ambiguidade PRD → código)

* Assinaturas, shapes e mapeamentos que evitam que o executor invente nomes incorretos.

### 7. Slices (somente se `execution_mode: orchestrated-per-slice`)

* Tabela: slice, tasks, objetivo, boundary de diff esperado.

### 8. Validação e checklist (validator)

* Critérios derivados de **PRD §10** + invariantes **§2** deste plano.
* Tag `(§14)` no título é **opcional** (compatibilidade com planos legados).
* Comandos globais `flutter analyze` / `flutter test` do package.

---

## Seções Opcionais de Planejamento

### 9. Perguntas em Aberto e Bloqueios Reais

* Bloqueios que travam execução segura. O executor recusa se houver pendências ativas.
* **Não** confundir com PRD §13 (Referências).

---

## O que este template NÃO inclui (propositalmente)

* Handoff prompt final (o executor lê o arquivo diretamente).
* Gate de prontidão do planejador (aprovação no chat).
* Lista de todas as regras do `project-rules` (o executor carrega via `AGENTS.md`).
* Cópia literal do escopo in/out do PRD.
* Inventário global de todos os arquivos tocados.

---

## Execução downstream

O executor (`cursor-plan-execute-orchestrated`) usa §2, §5, §6, §7, §8 e, se o §8 for fino, **PRD §8–10** do PRD linkado no plano.
