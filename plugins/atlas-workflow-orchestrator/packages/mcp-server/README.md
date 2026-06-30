# Atlas Workflow MCP Server

Servidor MCP do plugin Atlas Workflow v0.11.1.

## Tools

- `atlas_ping`: retorna saúde, identidade, versão e a superfície de tools (`capabilities` derivado de `toolsList()`).
- `atlas_capabilities`: contrato de adapter por host (`schema_version: 5`); detecção de host, `validator_dispatch {dispatcher, join}`, flags e pré-requisitos.
- `atlas_classify_input`: classifica o input em `backlog|prd|plan|unknown` para roteamento de modo (Fase 0).
- `atlas_run_state`: cria, atualiza (merge top-level) ou consulta estado de run em `.atlas/state/` no cwd do projeto consumidor; expõe `validator_recovery` do slot ativo.
- `atlas_verify_artifact`: Gate G1; verifica se artefato obrigatório existe e é legível (`artifact_kind` opcional para banner correto).
- `atlas_verify_template_conformance`: Gate TC; PRD/PLAN só avançam com template conforme e `pending_count: 0`; em fluxo de sprint use `require_sprint_file:true` para exigir link de sprint file e referências `EVAL-*`.
- `atlas_verify_sprint_file`: Gate de sprint viva; valida `SPRINT_S<NN>_*.md`, `eval_manifest`, `policy_manifest`, evidence-to-claim e vínculo com backlog quando fornecido.
- `atlas_verify_backlog_index`: Gate de backlog enxuto; valida `BACKLOG_MESTRE_*.md` como índice macro, sprint files linkados, deps internas, ciclo e status espelhado backlog↔sprint.
- `atlas_select_next_sprint`: Gate de seleção; escolhe a próxima sprint executável com `state=ready`, deps internas `done`, sprint file válido e DoR verde.
- `atlas_update_sprint_status`: Gate pós-validação; sincroniza status no `BACKLOG_MESTRE` e no `SPRINT_SNN`, exigindo `state_path` + veredito frio terminal para `done`.
- `atlas_scan_prd`: Gate G5; escaneia PRD por padrões determinísticos de ambiguidade bloqueante.
- `atlas_preflight`: Gate G10; valida modo, versão, lock ativo e mapa oficial de skills atlas-*; `guarantee_level` só aparece em modos com execução.
- `atlas_lock_dispatch`: Gates G7/G8/G12; controla fase ativa, checkpoints de liveness do executor, ordem de dispatch e validator antes de review (`state_path_created` exige `state_path` legível).
- `atlas_lock_validator`: Gate G4 sibling; um validator por vez, `dispatch_token` obrigatório, máximo de 2 attempts, repair obrigatório entre fail e retry, proof-of-work (challenge sha256 do boundary recomputado no complete; re-dispatch bounded → `challenge_exhausted`).
- `atlas_assert_after_plan`: Gate G11; bloqueia encerramento prematuro do modo full após plano validado.

## Contratos

- Transporte: stdio.
- Sem porta de rede.
- Persistência: `.atlas/state/<run_id>/run.json`.
- Log local: `.atlas/state/mcp.log`.
- Gates: resultados persistidos em `data.gates`.
- Roteamento: lock persistido em `data.routing`.
- Dispatch: fase ativa, próxima ação e histórico persistidos em `data.dispatch`.
- Liveness: `plan_execute` persiste `data.dispatch.active.liveness`; antes do handoff, bootstrap vencido sem checkpoint ou checkpoint antigo sem progresso vira `executor_liveness.status = stalled` e `next_action: retry_plan_execute`; `state_path_created` põe `executor_liveness.status = handoff_ready` e não expira enquanto aguarda `atlas_lock_validator(start)`, que só abre quando o checkpoint corresponde ao mesmo `state_path`.
- State de sprint: quando `.atlas/state/<run_id>/<slice>.json` declara `sprint_file_path`, o boundary exige `eval_results`, `evidence_to_claim` e `policy_scope`; todo `EVAL-*` do sprint file precisa estar `passed` com evidência, e `policy_scope.forbidden_scope` bloqueia arquivo tocado.
- Erro bloqueante: entradas inválidas, run inexistente ou falha de estado retornam erro JSON-RPC; gate bloqueado retorna `status: "blocked"` e `next_action`.
