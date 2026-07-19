# Fronteira Backlog × Sprint × PLAN

Política documental para backlog, sprint files e handoff de execução.

## Papéis

| Artefato | Dono mental | Pergunta que responde |
|----------|-------------|------------------------|
| **Backlog mestre** | Produto / coordenação | Qual é a sequência macro, prioridade, estado e dependência entre sprints? |
| **Sprint file** | Produto + engenharia | Qual é o recorte vivo desta sprint, o contrato de produto (§7: o quê/por quê/aceite), gates, riscos, evidências e links? |
| **PLAN** | Engenharia / executor | Como entregar no código, em que ordem, com que invariantes técnicos? |
| **State file** | Executor / validator | O que foi executado, validado e provado em disco? |

## Backlog mestre — o que entra

- Objetivo macro, fases, dependências e prioridade.
- Registro de sprints na seção `## 7. Registro de sprints`.
- Links para `SPRINT_S<NN>_<slug>.md`, PLAN e state quando existirem.
- Próxima sprint executável e motivo.
- Decisões e riscos macro.

## Backlog mestre — o que NÃO entra

- Critérios completos de aceite da sprint.
- Tasks técnicas do PLAN.
- Logs detalhados de execução.
- Evidências granulares que pertencem ao sprint file ou state.

## Sprint file — o que entra

- Objetivo único, escopo/fora de escopo e limite de tamanho.
- Links bidirecionais com backlog, PLAN e state.
- Dependências, bloqueios e decisões locais.
- **Contrato de produto congelado (§7):** decisões D*, cenários UX (loading/vazio/erro) e aceite binário — responde "o quê / por quê / o que não pode quebrar".
- `Selo do contrato` (sha256 write-once após aprovação).
- `eval_manifest`, `policy_manifest`, sensores de drift e evidence-to-claim.
- DoR/DoD vivo da sprint.

## Sprint file — o que NÃO entra

- Implementação task-a-task.
- Código, classes, imports, migrations ou comandos detalhados.
- Cópia integral do PLAN.
- Roadmap macro que pertence ao backlog.

> **Regra anti-repetição:** cada verdade tem uma casa; as demais seções referenciam por `§`/`D-id`, não re-enumeram.

O contrato §7 é a casa de produto. Variante standalone: `Backlog mestre: Não aplicável (standalone)`.

## PLAN — o que entra

- Link ao sprint file + referência `Sprint §7` (não recopiar tabela D* inteira).
- `eval_manifest` usado (quando `sprint-bound`).
- Tradução executiva (padrão de referência no monorepo + diffs vs módulo espelho).
- Invariantes de **execução** derivados do contrato §7.
- Pitfalls (anti-padrão → correto).
- Estado na **abertura da sprint** (3–6 bullets); se já implementado, checklist de verificação.
- **Tarefas T01…** no schema abaixo (detalhadas).
- Contratos técnicos só onde o sprint deixa ambiguidade.
- Validação única + checklist do validator.
- **Slices** (opcional) se `execution_mode: orchestrated-per-slice`.

## PLAN — o que NÃO entra

- Handoff prompt no final (“leia o plano e execute…”).
- Gate de prontidão do autor do plano.
- Lista §3 com todas as rules do `project-rules` (o executor carrega AGENTS).
- Cópia integral do escopo/fora de escopo do sprint.
- Inventário global de todos os arquivos tocados (o executor descobre no repo).
- Duplicar três checklists idênticas.
- Transformar `eval_manifest` em checklist paralelo desconectado do Sprint §7 e PLAN §8.

**Teto orientativo:** ~250–350 linhas (M); até ~450 (L com slices).

## Herança entre documentos

```text
Backlog §7    ──seleção──►    Sprint file SNN
Sprint §7     ──contrato──►   PLAN §2 invariantes + §1 diffs + §5/§8
Sprint §9/§10 ──gates──►      PLAN §2/§8
PLAN/state    ──evidência──►  Sprint §12 + backlog §7 status
```

## Schema de task (PLAN §5)

Cada `#### TNN.` deve ter, quando aplicável:

- **Objetivo**
- **Referência** (módulo/padrão no monorepo — não lista de 10 arquivos)
- **Pré-condições**
- **Mudança esperada**
- **Invariantes preservados** / **Não mudar** / **Não fazer**
- **Dependências**
- **Riscos** (se não óbvio)
- **Critério de done**
- **Validação local** (comando — na task de teste ou na final)
- **Quality gates** (opcional em tasks críticas)
- **Casos mínimos** (tasks de teste)

## Templates

- [PLAN_TEMPLATE.md](./PLAN_TEMPLATE.md)
- [BACKLOG_MESTRE_TEMPLATE.md](./BACKLOG_MESTRE_TEMPLATE.md)
- [SPRINT_TEMPLATE.md](./SPRINT_TEMPLATE.md)

## Pipeline

1. Backlog seleciona próxima sprint.
2. Sprint file fecha recorte vivo, DoR e contrato §7 (aprovado + selo).
3. PLAN deriva de contrato §7 + sprint file + código real.
4. Execução: `talos-plan-execute` lê PLAN + Sprint §7; `project-rules` via AGENTS.
5. Validator frio nota código contra o contrato congelado §7; state alimenta sprint file e backlog.

Geradores (`talos-backlog-generator`, `talos-sprint-interview`, `talos-plan-handoff`) devem seguir estes templates.
