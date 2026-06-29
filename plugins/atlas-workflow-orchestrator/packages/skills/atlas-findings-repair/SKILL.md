---
name: atlas-findings-repair
description: Skill `atlas-findings-repair`. Corrige findings P0/P1/P2 retornados por `atlas-task-validator` dentro do boundary já executado, sem reabrir o plano completo. Use quando o orquestrador receber `fail` do validator (topologia sibling, única em todos os hosts) e precisar de um reparo enxuto, bounded e sem reusar `atlas-plan-execute`.
---

# Atlas Findings Repair

Use esta skill apenas no caminho de recuperação pós-validator. Ela **não** substitui `atlas-plan-execute` nem `atlas-direct-execute`; serve só para corrigir findings bloqueantes já emitidos pelo `atlas-task-validator`.

## Finalidade

Corrigir findings P0/P1/P2 dentro do boundary atual com o menor contexto possível:

- sem replanejar
- sem carregar skill de execução
- sem criar novas tasks
- sem ampliar o escopo
- sem despachar validator

O orquestrador é dono do ciclo sibling em todos os hosts:

1. executor inicial entrega `state_path`
2. orquestrador roda `atlas-task-validator`
3. se `fail`, orquestrador trava o ciclo em `repair_required`
4. orquestrador chama `atlas_lock_validator(action=repair_start, state_path=...)`
5. orquestrador despacha `atlas-findings-repair` com o pacote retornado pelo lock
6. esta skill corrige e devolve `repair_complete`
7. orquestrador fecha o lock com `repair_run_id`
8. orquestrador roda o **2º e último** validator

## Entrada obrigatória

Receba do orquestrador:

- `state_path`
- findings estruturados do validator
- `validator_attempt`
- `repair_run_id`
- `repair_budget: 1`

Leia `atlas_run_state` como fonte primária do estado da run. O `state_path` continua sendo a fronteira canônica da slice.

## Regras duras

1. **Não carregar `atlas-plan-execute` nem `atlas-direct-execute`.**
2. **Não reabrir o plano inteiro.** Corrija só o que os findings exigem.
3. **Não aumentar boundary** sem evidência estrita de dependência técnica inevitável.
4. **Não corrigir observações/P3 por capricho.** O foco é fechamento do `fail`.
5. **Não despachar validator, review ou qualquer subagente.** O orquestrador faz isso.
6. **Não iniciar terceiro ciclo.** Esta skill existe só entre validator 1 e validator 2.
7. **Não trocar o `state_path`.** Atualize o arquivo original em lugar; redirecionar o boundary invalida a correlação do repair.
8. **Não inventar correlação.** IDs devem existir no packet recebido, sem duplicatas; todo arquivo tocado pertence a pelo menos um `repair_evidence` recebido e nenhum arquivo extra é permitido.

## Fluxo

### 1. Ler o boundary

Abra o `state_path` e extraia:

- `files_changed`
- `diff_stat`
- `plan_path`
- `boundary_refs`

Leia do plano apenas o mínimo necessário:

- Section 2 — invariantes
- Section 6 — contratos técnicos
- Section 8 — checklist

Capture também `base_sha`, `head_sha`, `task_evidence`, `repair_evidence`, `worktree_baseline` e `worktree_final` do state.

Se o state declarar sprint (`sprint_id`/`sprint_file_path`), leia também `eval_results`, `evidence_to_claim` e `policy_scope`. O reparo não pode tocar `policy_scope.forbidden_scope`; se o finding exigir isso, pare em `blocked` com causa explícita.

### 2. Ler os findings recebidos

Trabalhe somente com findings de severidade:

- `P0`
- `P1`
- `P2`

Cada finding novo deve ter `id`, `failure_mode`, `evidence`, `recommendation` e `fix_validation`. `msg` é compatibilidade deprecated e não substitui esses campos.

Se o pacote vier vazio, inconsistente ou sem finding reparável, pare em `blocked`.

### 3. Montar contrato mínimo de reparo

Antes de editar, reduza o trabalho a:

- finding alvo
- arquivos a tocar
- invariante em risco
- check focado
- budget de reparo

### 4. Corrigir de forma bounded

Permissões:

- corrigir arquivos do boundary
- tocar arquivo adjacente apenas quando necessário para satisfazer contrato/invariante

Proibições:

- cleanup oportunista
- refactor largo
- nova feature
- mudança fora da causa do finding

### 5. Rodar gates focados

Rode só validações coerentes com o diff:

- teste alvo
- lint/analyze/typecheck do pacote afetado
- `git diff --check`

Se o finding persistir por falta de decisão de produto, dependência externa ou widening de escopo, pare em `blocked`.

### 6. Atualizar evidência

Ao terminar:

- atualize `files_changed` com todo arquivo tocado, inclusive novo/adjacente
- recompute `head_sha` (`git rev-parse HEAD`) e `diff_stat`; preserve `base_sha`
- preserve `worktree_baseline` e recapture `worktree_final` após o repair; derive o boundary completo do delta entre snapshots
- acrescente `repair_evidence[]` no shape `{finding_id, files_touched, checks_run, status}`
- atualize `eval_results`/`evidence_to_claim` somente quando o reparo mudar a prova de um `EVAL-*`; não marque claim como `passed` sem evidência nova
- garanta que cada `repair_evidence.files_touched` esteja em `files_changed`
- mantenha a mesma slice
- não invente novo run state paralelo

### 7. Devolver resultado ao orquestrador

Retorne saída curta e estruturada com:

- `status: repair_complete | blocked`
- `repair_run_id`
- `state_path`
- `files_touched`
- `checks_run`
- `repairs`: array `{finding_id, files_touched, checks_run, status: resolved|blocked}`
- `residual_risk` (se houver)

O orquestrador chamará `atlas_lock_validator(action=repair_complete, repair_run_id=..., state_path=<mesmo path original>)` e só então poderá despachar o validator final.
Antes disso, ele deve ter aberto o slot com `atlas_lock_validator(action=repair_start, state_path=...)`; `repair_run_id` é obrigatório no fechamento.

## Stop conditions

Pare e reporte `blocked` quando:

- finding exige reabrir decisão fechada
- finding exige ampliar escopo além da slice
- mesmo erro repete sem sinal novo
- correção depende de ambiente ausente
- pacote de findings não é confiável

## Resultado esperado

Esta skill deve ser menor e mais barata que um executor completo, mas ainda disciplinada. Ela repara findings; ela **não** “continua a execução”.
