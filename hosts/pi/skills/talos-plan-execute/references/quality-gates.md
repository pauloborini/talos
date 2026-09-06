# Quality Gates

Choose the lightest gate that still protects the current task.

## Gate selection order

1. Prove the task with deterministic checks.
2. Add semantic review against plan invariants.
3. Add targeted runtime verification only when behavior changed in a way static checks cannot prove.
4. Escalate to broader validation only when the task blast radius justifies it.

## Common gate matrix

### Pure refactor

- targeted tests for touched modules
- typecheck or analyze for touched package
- diff scan for forbidden scope expansion

### Contract or DTO change

- compilation or typecheck
- serialization or mapper tests if available
- search for all consumers of renamed or reshaped fields
- compare with plan constraints and declared contract
- verify generated artifacts or localization files named by the plan before wiring consumers

### UI-only change

- component, widget, or snapshot tests when available
- targeted runtime verification for changed flow
- search for accessibility or localization regressions if the repo has such rules
- verify role/permission gating when the plan distinguishes who can see or mutate related resources

### State management or orchestration change

- focused tests around the changed store, controller, or service
- validation of loading, error, and success transitions
- explicit invariant review so closed architectural decisions are not violated
- rapid repeat-action or stale async check when the slice changes user-triggered operations

### Data migration or cleanup

- migration-specific validation
- idempotency or rollback reasoning
- stronger stop conditions if external systems are involved

## What not to do

- Do not run every available check after every edit.
- Do not promote unrelated warnings into mandatory work.
- Do not claim semantic safety from lint alone.
- Do not keep retrying the same failing check with no code or environment change.
- Do not repair by weakening a permission matrix, source-of-truth decision, or explicit negative scope.

## Failure classification

- `pass`: checks passed and no unresolved high-severity invariant break remains
- `fixable`: a current-diff issue is clear and repair budget remains
- `blocked`: repair would require scope change, external dependency, environment fix, or repeated speculative retries
