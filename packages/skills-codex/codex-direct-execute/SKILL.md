---
name: codex-direct-execute
description: Execute a scoped PRD, task, or implementation slice directly using a compact execution contract, PRD obligation tracking, finite task gates, bounded repair, and mandatory cold validation via codex-task-validator. Use when the user provides a PRD/spec/path or a debated task and wants implementation now without first producing a separate planning artifact. Preserve evidence against acceptance criteria, dependencies, fixtures, and invariants.
---

# Codex Direct Execute

## Purpose

Execute directly from a PRD/spec/task while preserving execution quality: explicit scope, obligations, invariants, task order, risks, and validation. Do not write a separate planning artifact unless the user asks.

This is not planless execution. Replace the visible markdown plan with a compact operational contract held in the current turn and passed to validation.

## Use Criteria

Use when all are true:

- User wants implementation, not a planning artifact.
- Scope is a PRD/spec/path or a debated task with clear boundaries.
- Work fits one coherent slice or a bounded task sequence.
- Execution happens in the same chat/context.
- A compact contract is enough for `codex-task-validator`.

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

Do not expand this into a separate planning artifact. The goal is execution guardrails, not transfer documentation. The contract may be terse in the user-visible response, but it must be concrete enough to pass unchanged to `codex-task-validator`.

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

After tasks and local gates pass, invoke an isolated subagent using `codex-task-validator`.

Use this prompt shape:

```text
Use codex-task-validator.

Inputs:
1. Slice boundary: <changed files + diff summary>
2. Compact execution contract: <contract>
3. Executed tasks: <ids/titles>
4. Cold-review note: you did not observe implementation; read current code only.
5. Local checks run: <commands/results>
6. Obligation ledger: <O1..ON with claimed evidence>
7. Closure analysis packet:
   - Invariant ledger
   - Scenario probes
   - Contract probes
   - Risk probes
   - Validation map
8. Validator depth: apply slice-review-style scenario lenses only inside this slice; findings still must map to PRD obligations, invariants, risks, dependency contracts, or the universal validator baseline.

Return only the validator output shape.
```

Pass:

- changed-file list and diff summary
- compact execution contract
- executed task ids/titles
- note that validator did not observe implementation and must read current code only
- local checks run and results
- obligation ledger with claimed evidence for each item
- closure analysis packet with invariant, scenario, contract, risk, and validation probes
- explicit instruction to search for missing scenarios and weak validation before returning `pass`

The validator must not patch files. Consume its verdict:

- `pass`: close slice
- `fail-com-P1`: repair P1 and any local P2, then rerun validator
- `fail-com-P2-only`: repair local P2 findings when they map to PRD obligations, invariants, determinism, dependencies, or fixtures; rerun validator after material repair

Stop validator repair only when the same finding repeats without new signal, repair would violate scope, or a user/product decision is needed. Do not final-report a repaired validator finding as "ready" without either a subsequent `pass` or an explicit residual-risk note.

If isolated subagents are unavailable in the current environment, do not pretend the slice is validator-closed. Run a local self-check against the same contract, report `validator not run`, and mark residual risk explicitly.

## Stop Conditions

Stop and report instead of improvising when:

- code contradicts the PRD in product behavior, permissions, backend contract, or persistence shape
- required dependency PRD/contract is missing or unstable
- implementing would violate explicit out-of-scope
- deterministic checks cannot run and no equivalent evidence exists
- repair loops repeat the same failure twice
- validator cannot receive the slice boundary, contract, task list, cold-review note, and closure analysis packet
- any PRD obligation lacks code/test/check evidence after implementation

## Final Report

Keep final report short:

- changed scope
- files touched
- validations run
- validator verdict/cycles
- blockers or residual risks

Do not include the full internal contract unless the user asks.
