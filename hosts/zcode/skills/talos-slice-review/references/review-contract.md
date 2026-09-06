# Review Contract

This skill assumes the implementation was guided by a plan with task-level structure close to `talos-plan-handoff`.

## Minimum expected inputs

- the plan artifact
- the executed task ids or a clearly described slice
- the real changed files or diff

The plan should also expose execution metadata:

- `Plan prefix: talos`
- `Execution mode: sequencial (T01→TN)` or `orchestrated-per-slice`

## Minimum expected task fields

For each reviewed task, try to recover:

- `Objective`
- `Likely files/modules`
- `Expected change`
- `Invariants preserved`
- `Do not change`
- `Do not do`
- `Risks / pitfalls`
- `Done criteria`
- `Task-local validation`
- `Quality gates (recommended)`
- `Stop and ask if`

Recover these plan-level constraints when present:

- resolved source conflicts and chosen authority
- permission or responsibility matrices
- generated-file, localization, import, route, RPC, or schema constraints
- explicit final validation gates

## Review scope discipline

The review scope is the intersection of:

- what the plan asked for
- what the executor claims to have completed
- what the diff actually changed

If these three disagree, that disagreement is part of the review result.

If the implementation chose a path that the plan explicitly rejected, treat it as a contract violation even if the UI appears to work.

## Typical review outcomes

- the slice matches the plan and no material findings are present
- the slice works but missed scenarios, validations, or tests
- the slice violates a plan invariant or broadens scope incorrectly
- the slice ignores a resolved source conflict or permission matrix
- the slice introduced a regression outside the intended task boundary
- the slice appears correct but validation evidence is too weak to trust closure
