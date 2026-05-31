---
name: codex-plan-handoff
description: Skill `codex-plan-handoff`. Produz um handoff executável da família Codex, fechando prefixo, modo de execução e gates no próprio artefato para consumo por `codex-plan-execute`, `codex-plan-execute-orchestrated` e `codex-slice-review`.
---

# Codex Plan Handoff

Use esta skill quando o usuário pedir um plano executável da cadeia `codex-*`.

O artefato segue `PLAN_TEMPLATE.md` e `BOUNDARY_PRD_PLAN.md` — **localize ambos via `Glob **/PLAN_TEMPLATE*.md` e `**/BOUNDARY_PRD_PLAN.md` no repo ativo** (não dependa de paths fixos do vault). O plano **não** depende de memória do chat para prefixo, modo ou executor.

## Cadeia de execução

```text
codex-plan-handoff → codex-plan-execute | codex-plan-execute-orchestrated → codex-task-validator → codex-slice-review (opcional)
```

---

## Fluxo obrigatório

1. **Classificação da tarefa:** feature, ui, contract, navigation, shared, security, diagnostic, refactoring, testing. Leia `project-rules/index/<tipo>.md` e regras em `project-rules/rules/` (ou equivalente do repo ativo).
2. **Grounding no código:** confirme padrões, contratos e comandos locais (`flutter analyze` / `flutter test` com path do package) antes de inferir.
3. **Decisões estáveis:** sanar bloqueios com perguntas ao usuário; registrar no plano (não recopiar tabela D* do PRD — referenciar `PRD §5`).
4. **Escrita:** artefato markdown no path acordado (ex.: `.codex/plans/` ou padrão do repo). Teto orientativo ~250–350 linhas (até ~450 com slices).

---

## Metadados obrigatórios (topo do artefato)

```md
## Metadados de execução
- Plan prefix: `codex`
- Execution mode: `sequencial (T01→TN)` | `orchestrated-per-slice`
- Executor skill: `codex-plan-execute` | `codex-plan-execute-orchestrated`
- Internal validator: `codex-task-validator`
- External review: `codex-slice-review` (optional)
```

Regras:

- `Plan prefix` é sempre `codex`.
- Se o modo não estiver decidido, o plano **não** está pronto para execução.
- Deixe explícito por que o modo escolhido é adequado, checks por task vs fechamento de slice e quando parar em `blocked`.

---

## Estrutura do plano (seções 1 a 8)

### 1. Tradução executiva

- O que será implementado e o resultado observável técnico.
- Padrão de referência no monorepo e tabela **referência vs esta entrega** (ligar a `PRD §5` D*, não recopiar a tabela).
- Link ao PRD: `PRD §4` escopo, `PRD §5` decisões.

### 2. Invariantes de execução (derivados do PRD)

- Invariantes técnicos inegociáveis (ex.: sem refetch ao filtrar).
- Referenciar IDs: `PRD §5 D12` — não colar a tabela D* inteira.

### 3. Pitfalls

- `anti-padrão observado` → `padrão canônico correto` (ancorado no repo).

### 4. Estado na abertura da sprint (pré-implementação)

- 3–6 bullets sobre o código hoje (comportamento/ausência — não inventário global de arquivos).
- Se já implementado: tratar como checklist de verificação.

### 5. Tarefas de execução

Tarefas `#### T01.` … `#### TNN.` com schema de `BOUNDARY_PRD_PLAN.md` (localizado via `Glob` no repo ativo):

- **Objetivo**
- **Referência** (módulo/padrão no monorepo — evite listas longas de paths; o executor descobre no repo)
- **Pré-condições**
- **Mudança esperada**
- **Invariantes preservados**
- **Não mudar** / **Não fazer**
- **Dependências**
- **Riscos** (se não óbvio)
- **Critério de done**
- **Validação local** (comando com path do package)
- **Quality gates** (opcional em tasks críticas)
- **Casos mínimos** (somente em tasks de teste)

Última task típica: **Validação final** (`flutter analyze`, `flutter test`, passos manuais alinhados a **PRD §8–10**).

### 6. Contratos técnicos (só ambiguidade PRD → código)

- Assinaturas, shapes e mapeamentos onde o PRD §9 não fecha implementação.

### 7. Slices (somente se `execution_mode: orchestrated-per-slice`)

- Tabela: slice, tasks, objetivo, boundary de diff esperado.

### 8. Validação e checklist (validator)

- Critérios derivados de **PRD §10** + invariantes **§2** deste plano.
- Título recomendado: `## 8. Validação e checklist (validator)` (tag `(§14)` opcional — legado do plano antigo).
- Comandos globais de analyze/test do package.

---

## Seção opcional

### 9. Perguntas em aberto e bloqueios reais

- Só bloqueios que impedem execução segura. O executor **para** se houver itens ativos aqui.
- **Não** confundir com PRD §13 (Referências).

---

## O que NÃO incluir (propositalmente)

- Handoff prompt final no artefato (o executor lê o arquivo; ver `BOUNDARY_PRD_PLAN.md` no repo ativo).
- Gate de prontidão do autor do plano.
- Lista integral de rules do `project-rules` (o executor carrega via `AGENTS.md`).
- Cópia integral do escopo/fora de escopo do PRD.
- Inventário global de todos os arquivos tocados.

---

## Consistência da cadeia

O próximo agente, só lendo o artefato, deve saber:

- usar apenas skills `codex-*` declaradas nos metadados;
- respeitar `execution_mode`;
- rodar `codex-task-validator` antes de fechar a slice;
- usar `codex-slice-review` como segunda camada fria, não substituto do validator interno;
- cruzar aceite de negócio com **PRD §8–10** quando o checklist do §8 for fino.
