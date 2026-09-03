---
name: talos-findings-repair
description: Skill `talos-findings-repair`. Corrige findings P0/P1/P2 retornados por `talos-task-validator` dentro do boundary já executado, sem reabrir o plano completo, e devolve a correção via `talos_commit_state` com `repair[]` no mesmo `state_path` — sem Write/editor no JSON de slice. Use quando o orquestrador receber `fail` do validator (topologia sibling, única em todos os hosts) e precisar de um reparo enxuto, bounded e sem reusar `talos-plan-execute`.
---

# Talos Findings Repair

Use esta skill apenas no caminho de recuperação pós-validator. Ela **não** substitui `talos-plan-execute` nem `talos-direct-execute`; serve só para corrigir findings bloqueantes já emitidos pelo `talos-task-validator`.

## Finalidade

Corrigir findings P0/P1/P2 dentro do boundary atual com o menor contexto possível:

- sem replanejar
- sem carregar skill de execução
- sem criar novas tasks
- sem ampliar o escopo
- sem despachar validator

O orquestrador é dono do ciclo sibling em todos os hosts:

1. executor inicial entrega `state_path` (via `talos_commit_state`)
2. orquestrador roda `talos-task-validator`
3. se `fail`, orquestrador trava o ciclo em `repair_required`
4. orquestrador chama `talos_lock_validator(action=repair_start, state_path=...)`
5. orquestrador despacha `talos-findings-repair` com o pacote retornado pelo lock
6. esta skill corrige e devolve `repair_complete` (após `talos_commit_state` com `repair[]`)
7. orquestrador fecha o lock com `repair_run_id`
8. orquestrador roda o **2º e último** validator

## Entrada obrigatória

Receba do orquestrador:

- `state_path`
- findings estruturados (packet do lock)
- `validator_attempt`
- `repair_run_id`
- `repair_budget: 1`

Origem do packet — **schema idêntico para as duas origens** (um único contrato de repair; os campos acima não mudam):

- `validator` — pós-`fail` do ciclo G4, fluxo atual (a skill opera entre o validator 1 e o 2º e último validator);
- `slice_review` — residual P0/P1 da verification da review (fora do ciclo G4 — o ramo da review não tem validator).

`repair_budget` e `repair_run_id` vêm do `talos_lock_validator(action=repair_start, origin=...)` correspondente e nunca são inventados pela skill; a provenance é a do slot aberto pelo orquestrador, não declarada pela skill.

Leia `talos_run_state` como fonte primária do estado da run. O `state_path` continua sendo a fronteira canônica da slice.

## Regras duras

1. **Não carregar `talos-plan-execute` nem `talos-direct-execute`.**
2. **Não reabrir o plano inteiro.** Corrija só o que os findings exigem.
3. **Não aumentar boundary** sem evidência estrita de dependência técnica inevitável.
4. **Não corrigir observações/P3 por capricho.** O foco é fechamento do `fail`.
5. **Não despachar validator, review ou qualquer subagente.** O orquestrador faz isso — vale para ambas as origens do packet (`validator` e `slice_review`); a verification do delta pós-repair é fase do orquestrador, não desta skill.
6. **Não iniciar terceiro ciclo.** Esta skill existe só entre validator 1 e validator 2.
7. **Não trocar o `state_path`.** O commit de repair usa o mesmo `state_path` original; redirecionar o boundary invalida a correlação do repair.
8. **Não inventar correlação.** IDs devem existir no packet recebido, sem duplicatas; todo arquivo tocado pertence a pelo menos um `repair_evidence` recebido e nenhum arquivo extra é permitido.
9. **Não editar o JSON de slice com editor/`JSON.stringify`.** O único writer do state é o MCP via `talos_commit_state` (role repair); campos projetados (evidências, hashes, snapshots de worktree) são recusados no payload com `-32602`.
10. **Não emitir checkpoint de executor (nem `first_write`).** Repair não escreve liveness (G12: role pelo lock); `talos_commit_state` com `repair[]` exige slot `repair_start` aberto.
11. **Repair é estritamente para código de produto (P0/P1).** Metadata (boundary, sha, `run_id`, `files_changed`) não é reparável por LLM; em caso de finding de metadata, o orquestrador deve rodar `reconcile_state` (D14/D19). Não tente inventar correção de metadata.
12. **`repair[].files` lista apenas paths mutados neste repair.** É terminantemente proibido re-listar arquivos alterados no execute original que não sofreram nova mutação neste repair (D15). O MCP recusa o commit (`repair_files_nao_mutados`) se `repair[].files` contiver paths não mutados neste repair.

## Fluxo

### 1. Ler o boundary

Abra o `state_path` (**leitura**) e extraia:

- `files_changed`
- `diff_stat`
- `plan_path`
- `boundary_refs`

Leia do plano apenas o mínimo necessário:

- Section 2 — invariantes
- Section 6 — contratos técnicos
- Section 8 — checklist

Capture também `state_schema_version`, `base_sha`, `head_sha`, `check_table`, `task_evidence`, `repair_evidence`, `worktree_baseline` e `worktree_final` do state (leitura para contexto — a atualização desses campos é do MCP).

Se o state declarar sprint (`sprint_id`/`sprint_file_path`), leia também `eval_results`, `proof_refs` e `policy_scope`. Em schema v3, `evidence_to_claim` não existe; não recrie. O reparo não pode tocar `policy_scope.forbidden_scope`; se o finding exigir isso, pare em `blocked` com causa explícita.

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
- editar o JSON de slice à mão

### 5. Rodar gates focados

Rode só validações coerentes com o diff:

- teste alvo
- lint/analyze/typecheck do pacote afetado
- `git diff --check`

Se o finding persistir por falta de decisão de produto, dependência externa ou widening de escopo, pare em `blocked`.

### 6. Commitar o repair via MCP

Ao terminar, chame `talos_commit_state` com `repair[]` no **mesmo `state_path`** — o MCP valida o slot `repair_start` aberto, projeta `repair_evidence`, `files_changed`, `head_sha` e `worktree_final`, regrava o state v3 e devolve `state_path` + `state_sha256`:

```json
talos_commit_state({
  "run_id": "<run_id>",
  "slice": "<slice id>",
  "repair": [
    {
      "finding_id": "<id do finding>",
      "files": ["relative/path.ext"],
      "checks": ["<comando do check focado>"],
      "status": "resolved"
    }
  ]
})
```

Regras do payload de repair:

- `repair[]` é **obrigatório** e não vazio; cada item com `finding_id` existente no packet recebido.
- `files` referencia **estritamente os arquivos mutados neste repair** (não re-liste os arquivos do execute que não mudaram; o MCP computa a união mecânica em `files_changed`). `checks` referencia os checks rodados — o MCP os projeta em `repair_evidence[]` com índices de `files_changed`/`check_table`.
- `status` por item: `resolved` (ou `blocked`, se o finding ficou sem resolução).
- Campos projetados pelo MCP (denylist do GUIDE §2.5) são recusados com `-32602` — não os envie; o MCP projeta tudo, preservando `base_sha` e baseline de worktree do commit original (o repair não sobrescreve baseline).
- `eval_results` só muda se o reparo alterar a prova de um `EVAL-*`; inclua um proof `EVAL` no commit nesse caso.

Mantenha a mesma slice e o mesmo run state — não invente run state paralelo.

### 7. Devolver resultado ao orquestrador

Retorne saída curta e estruturada com:

- `status: repair_complete | blocked`
- `repair_run_id`
- `state_path` (o mesmo path original)
- `files_touched`
- `checks_run`
- `repairs`: array `{finding_id, files_touched, checks_run, status: resolved|blocked}`
- `residual_risk` (se houver)

O orquestrador chamará `talos_lock_validator(action=repair_complete, repair_run_id=..., state_path=<mesmo path original>)` e só então poderá despachar o validator final.
Antes disso, ele deve ter aberto o slot com `talos_lock_validator(action=repair_start, state_path=...)`; `repair_run_id` é obrigatório no fechamento.

## Stop conditions

Pare e reporte `blocked` quando:

- finding exige reabrir decisão fechada
- finding exige ampliar escopo além da slice
- mesmo erro repete sem sinal novo
- correção depende de ambiente ausente
- pacote de findings não é confiável
- `talos_commit_state` bloquear o repair (ex.: sem slot `repair_start`, sha divergente, `repair[]` vazio)

## Resultado esperado

Esta skill deve ser menor e mais barata que um executor completo, mas ainda disciplinada. Ela repara findings; ela **não** “continua a execução”.
