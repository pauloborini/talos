# Talos MCP Server

Servidor MCP do plugin Talos v0.21.0.

## Tools

- `talos_ping`: retorna saúde, identidade, versão e a superfície de tools (`capabilities` derivado de `toolsList()`).
- `talos_capabilities`: contrato de adapter por host (`schema_version: 5`); detecção de host, `validator_dispatch {dispatcher, join}`, flags e pré-requisitos.
- `talos_classify_input`: classifica o input em `backlog|plan|idea|unknown` para roteamento de modo (Fase 0).
- `talos_run_state`: cria, atualiza (merge top-level) ou consulta estado de run em `.talos/state/` no cwd do projeto consumidor; expõe `validator_recovery` do slot ativo.
- `talos_verify_artifact`: Gate G1; verifica se artefato obrigatório existe e é legível (`artifact_kind` opcional para banner correto).
- `talos_verify_template_conformance`: Gate TC; PLAN só avança com template conforme e `pending_count: 0`; em fluxo de sprint use `require_sprint_file:true` para exigir referências `EVAL-*`/`Eval/Policy`.
- `talos_verify_sprint_file`: Gate de sprint viva; valida `SPRINT_S<NN>_*.md`, `eval_manifest`, `policy_manifest`, evidence-to-claim, contrato §7 e vínculo com backlog quando fornecido.
- `talos_verify_backlog_index`: Gate de backlog enxuto; valida `BACKLOG_MESTRE_*.md` como índice macro, sprint files linkados, deps internas, ciclo e status espelhado backlog↔sprint.
- `talos_select_next_sprint`: Gate de seleção; por padrão escolhe a próxima sprint executável com `state=ready`, deps internas `done` **ou** `manual_validation_pending`, sprint file válido e DoR verde. O arg estritamente booleano `loop:true` é opt-in: antes de qualquer `ready`, prioriza somente uma sprint `backlog` maturável (deps satisfeitas, sprint file válido e DoR amarelo/verde) e devolve `next_action:sprint_interview`; só sem backlog maturável retorna à seleção normal. Nunca abre exceção para `blocked`, `detached_repair`, DoR vermelho/ausente ou dependência pendente. Sem a flag, o comportamento normal não muda. Arg opcional `mode` (`full`/`direct`/`execute`/`interview-only`). Em `passed`, `next_action` é mode-aware: §7 draft → `sprint_interview`; `direct` + §7 selado → `plan_execute`; `full` + §7 selado sem PLAN → `plan_handoff`; PLAN real → `plan_execute`. Campo `selected.prd_path` é legado posicional do backlog (null/`—` esperado).
- `talos_update_sprint_status`: Gate pós-validação; sincroniza status no `BACKLOG_MESTRE` e no `SPRINT_SNN`, exigindo `state_path` + veredito frio terminal para `done` **ou** `manual_validation_pending`. `done` exige `acceptance_results` com todos os `AC-*` `proved` (sem M aberto) e emite `HANDOFF_*`; MVP satisfaz DEP mas não emite handoff. Arg `prd_path` é legado (só coluna do backlog); não gera artefato PRD.
- `talos_sync_manual_validation`: Sync do relatório humano `.talos/manual-validation/<backlog-slug>.md` com lock por backlog (D15). Valida IDs `MV-<sprint>-<ac>`, status e justificativa de waiver (relatório inválido/dirty → `blocked` com `next_action=fix_manual_validation_report`); item fantasma (MV sem `AC.manual` no §7.3) bloqueia; sincroniza `acceptance_results` no state (D24), histórico no sprint e ledger append-only no run state; todos os M `validated`/`waived` → promove `done` com `HANDOFF_*` (CN3); algum `failed` → origem `blocked` (cone de revalidação no Plano 5). Relatório sem pendências é removido (D12).
- `talos_scan_acceptance`: Gate G5; escaneia o contrato §7 do sprint file por padrões determinísticos de ambiguidade bloqueante.
- `talos_preflight`: Gate G10; valida modo, versão, lock ativo e mapa oficial de skills talos-*; `guarantee_level` só aparece em modos com execução.
- `talos_lock_dispatch`: Gates G7/G8/G12; controla fase ativa, checkpoints de liveness do executor, ordem de dispatch e validator antes de review (`state_path_created` exige `state_path` legível).
- `talos_lock_validator`: Gate G4 sibling; um validator por vez, `dispatch_token` obrigatório, máximo de 2 attempts, repair obrigatório entre fail e retry, proof-of-work (challenge sha256 do boundary recomputado no complete; re-dispatch bounded → `challenge_exhausted`).
- `talos_assert_after_plan`: Gate G11; bloqueia encerramento prematuro do modo full após plano validado.

## Contratos

- Transporte: stdio.
- Sem porta de rede.
- Persistência: `.talos/state/<run_id>/run.json`.
- Log local: `.talos/state/mcp.log`.
- Gates: resultados persistidos em `data.gates`.
- Roteamento: lock persistido em `data.routing`.
- Dispatch: fase ativa, próxima ação e histórico persistidos em `data.dispatch`.
- Liveness: `plan_execute` persiste `data.dispatch.active.liveness`; antes do handoff, bootstrap vencido sem checkpoint ou checkpoint antigo sem progresso vira `executor_liveness.status = stalled` e `next_action: retry_plan_execute`; `state_path_created` põe `executor_liveness.status = handoff_ready` e não expira enquanto aguarda `talos_lock_validator(start)`, que só abre quando o checkpoint corresponde ao mesmo `state_path`.
- State de sprint: quando `.talos/state/<run_id>/<slice>.json` declara `sprint_file_path`, o boundary exige `eval_results`, `policy_scope` e `proof_refs`; em schema v3, `eval_results` é a fonte única e `evidence_to_claim` não é persistido. Todo `EVAL-*` do sprint file precisa estar `passed` com evidência, e `policy_scope.forbidden_scope` bloqueia arquivo tocado. O validator emit `acceptance_results[]` no complete quando `sprint_file_path` presente (shape estrito; v1/v2 hard-fail).
- Validação manual: `talos_sync_manual_validation` grava o resultado humano de `M` no state (`acceptance_results` com `M:validated`/`M:waived`/`M:failed` + `manual_validation_report`), no sprint (histórico) e no ledger `data.manual_validation` do run state (append-only; re-run não apaga). Relatório: `.talos/manual-validation/<slug>.md` (template `MANUAL_VALIDATION_REPORT_TEMPLATE.md`).
- Erro bloqueante: entradas inválidas, run inexistente ou falha de estado retornam erro JSON-RPC; gate bloqueado retorna `status: "blocked"` e `next_action`.
