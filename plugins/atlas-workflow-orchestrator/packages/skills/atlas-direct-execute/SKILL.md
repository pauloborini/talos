---
name: atlas-direct-execute
description: Execute a scoped PRD, task, or implementation slice directly using a compact execution contract, PRD obligation tracking, finite task gates, bounded repair, and mandatory cold validation via atlas-task-validator. Use when the user provides a PRD/spec/path or a debated task and wants implementation now without first producing a separate planning artifact. Preserve evidence against acceptance criteria, dependencies, fixtures, and invariants.
---

# Atlas Direct Execute

## Purpose

Execute directly from a PRD/spec/task while preserving execution quality: explicit scope, obligations, invariants, task order, risks, and validation. Do not write a separate planning artifact unless the user asks.

This is not planless execution. Replace the visible markdown plan with a compact operational contract held in the current turn and passed to validation.

## Executor liveness checkpoints

Depois de carregar esta skill e antes de qualquer discovery longo, emita um checkpoint MCP:

```json
atlas_lock_dispatch({
  "action": "checkpoint",
  "phase": "plan_execute",
  "event": "executor_started"
})
```

Em seguida, emita checkpoints materiais conforme avança:

- `skill_loaded` — skill carregada e contrato reconhecido.
- `plan_loaded` — PRD/spec/task de entrada lido.
- `handoff_accepted` — boundary, obligations, `state_path` alvo e contrato direto aceitos.
- `task_started` — primeira task começou.
- `first_write` — primeira mutação de workspace feita.
- `state_path_created` — state file escrito antes de devolver `validator_handoff_required`.

Se não conseguir emitir checkpoint por MCP, retorne `blocked`: liveness não é comprovável. Sem `state_path_created` com o mesmo `state_path`, `atlas_lock_validator(start)` bloqueia em G12 e o orquestrador não pode despachar o validador frio.

## Use Criteria

Use when all are true:

- User wants implementation, not a planning artifact.
- Scope is a PRD/spec/path or a debated task with clear boundaries.
- Work fits one coherent slice or a bounded task sequence.
- Execution happens in the same chat/context.
- A compact contract can be materialized into the state file boundary required by `atlas-task-validator`.

Do not use when any are true:

- User asks only for planning, review, explanation, or handoff artifact.
- Product rules, permissions, backend contract, migrations, security, or data-loss risk are materially ambiguous.
- The PRD/spec conflicts with code or adjacent docs in a way that blocks implementation.

## Workflow

### 0. Triage

Before implementation, decide one exact path:

- `direct`: proceed with this skill.
- `blocked`: ask for the missing decision or environment.

Ask at most 1-3 blocking questions only when a reasonable assumption could change product behavior, contract, permissions, persistence, or user-visible outcome. Otherwise state assumptions and proceed.

### 1. Load inputs

First, emit `executor_started`, then `skill_loaded`, before doing any long scan.

Read the user-provided PRD/spec/task and any directly referenced files needed to resolve scope. If the input names repo artifacts, verify those artifacts exist before editing.

Extract only execution-relevant items:

- in scope / out of scope
- acceptance criteria and required deliverables
- accepted decisions
- invariants and "do not change" rules
- contracts, entities, routes, schemas, wrappers, generated files
- dependency contracts that must be consumed, bridged, or preserved
- fixture requirements and scenario language such as "weeks", "profiles", "matrix", "sequence", or "integration"
- validation requirements
- regression risks
- likely files/modules

If the PRD references another PRD or code contract as dependency, inspect enough to confirm the dependency shape and required bridge. Do not satisfy a dependency by creating parallel synthetic contracts unless the PRD explicitly allows it.

After the input is loaded, emit `plan_loaded`. After validating the execution boundary, obligations, and `state_path` target, emit `handoff_accepted`.

### 2. Build Compact Execution Contract

Before editing, write a compact contract in the working response or internal task state. Size follows complexity: terse for simple tasks, denser only where needed to preserve scope, invariants, and validator quality.

Required shape:

```text
Direct Execute Contract
- Goal:
- Boundary:
- In scope:
- Out of scope:
- Obligations:
- Invariants:
- Dependency bridges:
- Fixtures/scenarios:
- Scenario probes:
- Risk probes:
- Task order:
- Validation:
- Stop conditions:
```

Do not expand this into a separate planning artifact. The goal is execution guardrails, not transfer documentation. The contract may be terse in the user-visible response, but it must be concrete enough to materialize into `.atlas/state/<run_id>/<slice>.json` and referenced evidence for `atlas-task-validator`.

Obligations are mandatory. Convert every PRD acceptance criterion and explicit deliverable into one compact row:

```text
O1 <requirement> -> evidence: <file/test/check>
```

When the PRD asks for fixtures, profiles, weeks, matrices, bridges/adapters, immutability, determinism, or calendar semantics, name those explicitly in `Obligations`. Do not collapse them into generic "tests cover rules".

Add a closure analysis packet before implementation starts. Keep it compact, but concrete enough that a cold validator can hunt omissions instead of only confirming obvious files:

- `Invariant ledger`: each invariant or "do not change" rule, with expected code evidence.
- `Scenario probes`: negative, repeated, empty/null, out-of-order, partial failure, stale state, permission, and cleanup scenarios relevant to this slice.
- `Contract probes`: DTO/entity/schema/route/RPC/generated/localization/import boundaries that could drift.
- `Risk probes`: each regression risk translated into a specific question the validator must answer from code.
- `Validation map`: which checks prove which obligations, and which obligations remain only manually evidenced.

If a probe is irrelevant, omit it. Do not write generic probes such as "check edge cases"; name the exact state, actor, field, route, or failure mode.

### 3. Implement by finite tasks

Execute one task at a time. Prefer this order when applicable:

1. contracts/types/domain
2. dependency bridges/adapters from existing models or contracts
3. datasource/client boundary
4. repository/use case/state
5. UI/route wiring
6. fixtures/tests/generation/docs required for closure

For each task, keep a tiny task contract:

- objective
- files likely touched
- invariants at risk
- obligations satisfied
- focused check
- repair budget

Do not widen scope for opportunistic cleanup.

Before the first concrete task, emit `task_started`. After the first workspace mutation, emit `first_write`.

### 4. Gate each task

Run focused checks appropriate to the diff:

- targeted tests
- analyzer/typecheck/lint
- codegen/localization/schema checks when relevant
- diff scan for scope creep
- runtime/browser verification when UI changed

If a check fails, classify:

- `fixable`: caused by current diff and repairable inside budget
- `blocked`: missing env, upstream failure, ambiguous contract, or required decision
- `pre-existing`: outside slice; report, do not repair unless blocking closure

Repair only current-diff failures. Stop after repeated failure or budget exhaustion.

### 5. Mandatory cold validation

After tasks and local gates pass, write `.atlas/state/<run_id>/<slice>.json` following `packages/templates/STATE_FILE_SCHEMA.md`.

For direct execution, the state file is still the only validator input. Use the user-provided PRD/spec path as `plan_path` when no handoff plan exists, and include direct-contract anchors in `boundary_refs` such as `direct.O1`, `direct.invariant.permissions`, or `direct.risk.partial_failure`.

The state file is the only validator input. Validation is always **sibling**, on every host: this executor **never** dispatches `atlas-task-validator` itself and never validates its own work in the same context. After tasks and local gates pass and the state file is written, this executor **stops mutation** and returns `validator_handoff_required` with the `state_path`. The orchestrator then dispatches `atlas-task-validator` as the next isolated sibling phase, locks it via `atlas_lock_validator`, and — if the verdict is `fail` — dispatches `atlas-findings-repair` (not this executor) before the **2nd and last** validator.

After writing the state file and before returning, emit `state_path_created` with the same `state_path`.

Do not paste the compact contract, diff, obligation ledger, local checks, or closure analysis packet into the state file's handoff. Those belong in the state file and referenced artifacts.

**Finish all local work before the handoff — then stop idle.** Finish every local gate (lint, analyze, tests, `git diff --check`, diff-stat) and write the state file **before** returning the handoff. After returning `validator_handoff_required`, do nothing: no diff hygiene checks, no extra reads, no opportunistic edits, no parallel work. The orchestrator now owns the slice; any mutation here would change what the sibling validator reads and breaks determinism (same failure class as the orchestrator's G9).

The verdict is consumed by the **orchestrator**, not by this executor:

- `pass` / `pass_with_observations`: terminal — the orchestrator closes the slice (observations are reported residuals, never a trigger for another validator dispatch).
- `fail`: the orchestrator opens `repair_start`, dispatches `atlas-findings-repair`, closes with `repair_run_id`, and runs the **2nd and last** validator. This executor does not re-validate itself and is not reused for the repair retry.

This executor only re-engages if the orchestrator explicitly re-dispatches it for a new slice. It must not "fix" observations and reopen a closed slice; real follow-up from an observation goes to the final report or backlog, not into an extra in-slice change.

If isolated subagents are unavailable in the current environment, do not pretend the slice is validator-closed. Run a local self-check against the same contract, report `validator not run`, and mark residual risk explicitly.

## Stop Conditions

Stop and report instead of improvising when:

- code contradicts the PRD in product behavior, permissions, backend contract, or persistence shape
- required dependency PRD/contract is missing or unstable
- implementing would violate explicit out-of-scope
- deterministic checks cannot run and no equivalent evidence exists
- repair loops repeat the same failure twice
- validator cannot receive a valid `.atlas/state/<run_id>/<slice>.json` state path
- any PRD obligation lacks code/test/check evidence after implementation

## Final Report

Keep final report short:

- changed scope
- files touched
- validations run
- validator verdict/cycles
- blockers or residual risks

Do not include the full internal contract unless the user asks.
