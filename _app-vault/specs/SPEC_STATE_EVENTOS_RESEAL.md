# SPEC — Eventos de run e re-selo do contrato (ondas 2 do desenho de state)

**Status:** contrato a implementar — nenhuma fatia deste spec existe no produto hoje (verificado: `talos_run_event`, `talos_consume_reseal`, `talos_slice_view` e o campo `falseia_se` têm zero ocorrências em `packages/mcp-server/server.js`).
**Origem:** desenho "Enxugar colo da LLM e absorver o Guide no Talos" (2026-08-19, revisão de contrato 2026-08-21), onda 2. A onda 1 (`talos_commit_state`, G12, reparo) foi entregue em 0.18.x.
**Regra associada:** o writer do state é o MCP e a FSM congela no fechamento — ver as cláusulas de determinismo em `_app-vault/docs/decisions/determinismo.md` e `pipeline.md`. Este spec descreve o **como implementar**; não duplica valor de decisão.

## Princípio

A LLM julga em slots curtos; o MCP grava forma, git e índices. Os quatro itens abaixo fecham o que ficou fora da onda 1: o registro de desvio durante a slice, o re-selo controlado do contrato, a leitura enxuta da slice pelo executor e a checagem de falseabilidade do aceite.

## Fatia 5 — `talos_run_event`

Verbo novo (não é `upsert`). Payload:

```json
{ "run_id": "...", "kind": "descoberta|lacuna|renegociacao|note|lacuna_resolvida", "subject": "T01|AC-001|§7", "facts": "máx 200 chars" }
```

- O MCP infere `actor` (pela fase do lock), `at`, `eid` monotônico e hash. **Proibido no input:** `at`, `eid`, `actor`.
- `descoberta` e `note`: só ledger.
- `lacuna`: append em `run.data.blockers`; `talos_update_sprint_status` para `done` e `manual_validation_pending` fica bloqueado enquanto houver blocker aberto.
- `lacuna_resolvida`: fecha o blocker do mesmo `subject`; sem subject aberto → blocked.
- `renegociacao`: **não** destampa o §7. Retorna `{ token, status: "pending_user" }`. Token de uso único, TTL de 24h, preso ao `sprint_file_path` do run.

## Fatia 6 — `talos_consume_reseal`

- Args: `token`, `sprint_file_path`.
- Efeito: `Contrato status` → `draft` e `Selo` → pendente (o mesmo procedimento que a entrevista já usa para reeditar a §7).
- Falha em: segundo consume do mesmo token, token expirado, `sprint_file_path` diferente do preso, ou tentativa de destampar sem token gasto — este último fecha o "reabrir frouxo".
- Quem re-aprova e sela continua sendo a entrevista.

## Fatia 7 — `talos_slice_view`

- Args: `plan_path` e/ou `sprint_file_path`, `slice` opcional.
- Retorno: `{ tasks, ac, evals, forbidden_scope, required_gates, invariants }`.
- Parser do disco, cache por `mtime`.
- **O validator não lê a view** — ele lê sprint e PLAN. A view existe para o executor da onda 2 citar o recorte em vez de reler o sprint inteiro.

## Fatia 8 — `falseia_se`

- Campo **opcional** string ≤200 caracteres em cada `AC-*` do §7.3 do sprint file.
- `talos_verify_sprint_file` aceita ausência; se presente, exige string não vazia.
- **Zero regex no MCP**: o julgamento é da skill do validator — se o campo existe, julgar se o check citado em `proof_refs` falharia com aquela mutação; se não falharia, finding P2.

## Fluxo alvo (contexto das fatias)

```text
orquestrador   lock_dispatch(start, phase=plan_execute)  [grava base_sha = HEAD]
executor       first_write? -> baseline · implementa · gates locais
               talos_commit_state(proofs, ...) -> { validator_handoff_required, state_path }
orquestrador   lock_validator(start) [sha == commit do MCP] -> sibling validator
               fail -> repair_start -> commit_state(role=repair, repair[]) -> 2º validator (teto da slice)
               pass | pass_with_observations -> slice fechada
```

## Compatibilidade

- Disco permanece v3 canônico: consumidores que só leem o JSON não quebram.
- `talos_run_state` no modo `upsert` segue servindo apenas o ledger da run; commit de slice nunca passa por `upsert`.
