---
name: talos-escalation-repair
description: Skill `talos-escalation-repair`. Sidecar serial de correção do loop de sprints (D7) - corrige residual P0/P1 que sobreviveu à verification da review dentro do boundary da slice - com slot `talos_lock_validator(action=repair_start, origin=escalation)` aberto pelo orquestrador, commit único via `talos_commit_state(repair[])` no mesmo `state_path` e retorno estruturado para o orquestrador disparar a verification sobre o delta. Executa também o drain de pendencias - recebe PDs de `talos_pendencies(list)`, corrige por `pd_id` e devolve resultado por PD - o `close` da PD é sempre via MCP, nunca Write do arquivo. Não se auto-valida e não despacha nada. Use quando o orquestrador tiver residual P0/P1 pós-verification (provenance `escalation`) ou PDs drenáveis delegadas pelo loop.
---

# Talos Escalation Repair

Sidecar serial de correção da esteira `--loop` (D7/D16). Esta skill **não** substitui `talos-plan-execute`, `talos-direct-execute` nem `talos-findings-repair`: é o executante do residual P0/P1 que a verification da review não resolveu in-loop e o executante do drain de PDs. O orquestrador é dono do ciclo: abre o slot, despacha este sidecar, faz join e só então avança (serial - D16).

## Finalidade

Corrigir, com o menor contexto possível e dentro do boundary já executado:

- residual P0/P1 declarado pela verification (`not_resolved`/`regression` em severidade P0/P1, e residual `violated` ⇒ P0 mecânico);
- pendências `PD-<sprint>-<NN>` delegadas pelo drain (`talos_pendencies(list)`).

Sem replanejar, sem carregar skill de execução, sem criar tasks, sem ampliar escopo, sem despachar validator/review/verification.

## Entrada obrigatória

Receba do orquestrador (que abriu o slot ANTES do dispatch):

- `state_path`
- packet do trabalho - um dos dois modos:
  - **modo residual (provenance `escalation`):** findings bloqueantes P0/P1 do packet de escalation (retorno do `talos_lock_validator(action=repair_start, origin=escalation)`);
  - **modo drain:** PDs `open` de `talos_pendencies(list)` (cada PD com `pd_id`, `severity`, `files`, `recommendation`, `fix_validation`);
- `repair_run_id` (do slot aberto pelo orquestrador)
- `repair_budget: 1`

`talos_run_state` é a fonte primária do estado da run; o `state_path` é a fronteira canônica da slice. A provenance (`escalation`) pertence ao slot aberto pelo orquestrador - a skill nunca declara provenance que o slot não carrega.

## Regras duras

**Fonte canônica das regras comuns:** `packages/skills/talos-findings-repair/SKILL.md` - as Regras duras 1–10 dela valem aqui integralmente (a origem do packet muda, o contrato não). Resumo não-canônico para hosts sem loader de skills: sem replanejar nem reabrir plano; sem ampliar boundary; sem tocar P3/observações por capricho; sem despachar validator, review ou qualquer subagente; sem iniciar ciclo de validação; mesmo `state_path` original; IDs somente do packet recebido, sem duplicatas; nunca editar o JSON de slice com editor/`JSON.stringify` - único writer do state é o MCP via `talos_commit_state`; sem checkpoint de executor (`first_write`).

Regras próprias do sidecar:

1. **Não se auto-validar.** Depois do commit `repair[]` a participação do sidecar TERMINA: o retorno estruturado vai ao orquestrador, que despacha a verification (fase da `talos-slice-review`) sobre o delta. É proibido despachar validator, review ou verification; proibido rodar a própria verification; proibido emitir veredito de fechamento ("resolvido", "aprovado", "fechado") sobre o próprio delta.
2. **Budget `escalation` = 1, sem retry.** `repair_start(origin=escalation)` devolvendo `blocked` (ex.: `repair_budget_exhausted`) encerra a participação do sidecar: reporte `blocked` com a causa e pare. Nenhuma reabertura de slot, nenhuma segunda tentativa, nenhuma troca de provenance.
3. **Nunca escrever `PENDENCIAS_<slug>.md`.** O `close` de PD é exclusivamente via MCP (`talos_pendencies(action=close, pd_id)`), decidido pelo orquestrador dono do ciclo - a skill devolve o resultado por `pd_id` e nunca edita o arquivo (writer único do PENDENCIAS = MCP).
4. **Não fingir proveniência.** O slot `repair_start(origin=escalation)` é aberto pelo orquestrador antes do dispatch; a skill roda só com o `repair_run_id` recebido e nunca abre lock por conta própria.

## Fluxo (modo residual)

### 1. Ler o boundary

Abra o `state_path` (**leitura**) e extraia `files_changed`, `diff_stat`, `plan_path`, `boundary_refs`. Leia do plano o mínimo (invariantes, contratos técnicos, checklist). Capture `state_schema_version`, `repair_evidence`, `check_table` e snapshots de worktree para contexto - a atualização desses campos é do MCP. Trabalhe somente com os findings P0/P1 do packet recebido (regra 4 do findings-repair: P3/observações não são alvo aqui - o residual escalado é P0/P1). Packet vazio, inconsistente ou sem finding reparável ⇒ `blocked`.

### 2. Corrigir de forma bounded

Permissões: arquivos do boundary; arquivo adjacente só para satisfazer contrato/invariante. Proibições: cleanup oportunista, refactor largo, nova feature, mudança fora da causa do finding, editar o JSON de slice à mão.

### 3. Rodar checks focados

Rode só validações coerentes com o diff: teste alvo, lint/typecheck do pacote afetado, `git diff --check`. Falha por falta de decisão de produto, dependência externa ou widening de escopo ⇒ `blocked`.

### 4. Commitar o repair via MCP

Chame `talos_commit_state` com `repair[]` no **mesmo `state_path`** - o MCP valida o slot `repair_start` aberto (provenance `escalation`), projeta `repair_evidence`/`files_changed`/`head_sha`/`worktree_final`, regrava o state v3 e devolve `state_path` + `state_sha256`:

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

Sem packet no ciclo (fluxo in-loop), a fonte de IDs válidos é o próprio delta do repair (`repair_evidence` do state + `repair[]` do payload) - `status` por item: `resolved` ou `blocked`. Campos projetados pelo MCP são recusados com `-32602` - não os envie. `talos_commit_state` bloqueando (sem slot, sha divergente, `repair[]` vazio) ⇒ `blocked` sem retry (regra própria 2).

### 5. Retorno estruturado (fim da participação)

Saída curta e estruturada para o orquestrador:

- `status: repair_complete | blocked`
- `repair_origin: escalation`
- `repair_run_id`
- `state_path` (o mesmo path original)
- `files_touched`
- `checks_run`
- `repairs`: array `{finding_id, files_touched, checks_run, status: resolved|blocked}`
- `residual_risk` (se houver)

NÃO despache verification, validator nem review. NÃO chame `talos_lock_validator(action=repair_complete)` - o `repair_complete` com o eco da verification é do orquestrador (D21). O próximo passo (`verification` sobre o delta; residual persistente ⇒ `detached_repair`) é decisão do orquestrador (D8).

## Modo drain (PDs)

Entrada alternativa: lista de PDs `open` de `talos_pendencies(list)` como packet de trabalho (delegada pelo drain da esteira - `drain_required`).

1. Para cada PD, corrigir de forma bounded conforme `recommendation`, dentro do boundary declarado; `repair[].finding_id` carrega o `pd_id` (a fonte de IDs sem packet é o próprio delta do repair).
2. Rodar o check declarado em `fix_validation` da PD como check focado do commit.
3. Commitar via `talos_commit_state(repair[])` no mesmo `state_path` (único writer do JSON).
4. Devolver **obrigatoriamente** este JSON (campos extras permitidos; estes três são o contrato do drain):

```json
{
  "pd_ids_fixed": ["PD-S03-01"],
  "commit_state": { "state_path": "<mesmo path>", "state_sha256": "<sha do commit>" },
  "do_not_request_validator_retry": true
}
```

Também devolver resultado **por `pd_id`**: `{pd_id, status: resolved|blocked, files_touched, checks_run}` (alimenta `pd_ids_fixed` = ids `resolved`).
5. **Proibido** pedir ou ecoar `dispatch_task_validator_retry`. Drain não reabre G4. O `close` de cada PD é SEMPRE via MCP (`talos_pendencies(action=close, pd_id)`), decisão do orquestrador após o sidecar — nunca Write/Edit de `PENDENCIAS_<slug>.md`.

Mesmas regras duras do modo residual: mesmo `state_path`, commit único via MCP, sem auto-validação, budget `escalation` = 1 sem retry.

## Stop conditions

Pare e reporte `blocked` com causa quando:

- correção exige reabrir decisão fechada ou decisão de produto;
- correção exige ampliar escopo além do boundary da slice;
- ambiente necessário está ausente;
- packet/PDs não são confiáveis (vazio, IDs incoerentes, `files` fora do boundary);
- `repair_start` ou `talos_commit_state` devolvem `blocked` (budget esgotado, slot ausente, sha divergente) - sem retry (regra própria 2).

`blocked` do sidecar é insumo do orquestrador para estacionar a sprint em `detached_repair` (D8) - a skill não decide estacionamento, não grava status e não escreve backlog.

## Resultado esperado

Este sidecar é menor e mais barato que um executor completo e mais estreito que o `talos-findings-repair`: corrige o residual escalado ou a PD delegada, comita via MCP e devolve o resultado. Ele **não** valida o próprio trabalho, **não** fecha o ciclo da sprint e **não** decide o destino do residual - isso é do orquestrador com a verification.
