---
name: atlas-plan-execute
description: Skill `atlas-plan-execute`. Executa planos produzidos por `atlas-plan-handoff` com gates finitos, self-repair limitado, validação interna obrigatória via subagente e paradas explícitas. Use quando o cliente precisar implementar um plano task-a-task sem derivar dos invariantes.
---

# Atlas Plan Execute

Use this skill to turn a `atlas-plan-handoff` artifact into a controlled execution loop.

Prefer finite, stage-based execution over continuous self-critique. The goal is to finish the task with high confidence, not to keep polishing indefinitely.

---

## Execution Model

Operate as a bounded state machine:
`ready` → `implementing` → `gating` → `repairing` → `task_done` → `slice_validating` → `slice_done` (or `blocked`).

## State persistence

Use `atlas_run_state` as the primary source of run state. Do not read or write run ledger files directly. If the MCP is unavailable, report the gate as unprovable and abort instead of continuing with a silent file fallback.

## Plan path resolution

Resolve plan paths in this order:

1. `.atlas/plans/`
2. `.cursor/plans/` with a deprecation warning
3. `.codex/plans/` with a deprecation warning

New or rewritten plan artifacts must use `.atlas/plans/`.

## Native todo mirror

When entering `implementing` for the first time in a slice, mirror the plan tasks into the native todo surface:

- Claude Code: `TodoWrite`
- Cursor: `todo_write`
- Codex App: `tasks`
- Other hosts: closest native task/todo surface

The plan is the SSoT. Map `ready` to `pending`, `implementing`/`gating` to `in_progress`, and `task_done` to `completed`. If todo state diverges, sync from the plan to todo, never from todo back to the plan. Do not create parallel todos that are not derived from plan task IDs.

## Review gate

`atlas-slice-review` is dispatched only when `--review` is present in the user command or executor arguments. Without `--review`, stop at `slice_done` after validator pass/pass_with_observations.

---

## Required Workflow

### 1. Load the plan as an execution contract
Read the `atlas-plan-handoff` artifact. Extract at minimum:
* **Execution metadata**: Prefix, mode, and validator options.
* **Executive translation and PRD links** (from Section 1 — include path to PRD; cite `PRD §5` D* IDs, do not paste the full D* table).
* **Execution invariants** (from Section 2).
* **Current state at sprint opening** (from Section 4 — not Section 2).
* **Pitfalls** (from Section 3).
* **All execution tasks TNN** (from Section 5).
* **Technical contracts** (from Section 6).
* **Slices of execution** (from Section 7).
* **Checklist for the validator** (from Section 8).

Treat headings as semantic. If the plan uses equivalent wording but carries the same contract, continue. If the plan is missing the substance, stop and report. 
The old Gate of Readiness (§15) and Handoff Prompt (§16) are **no longer required** in the compact template.
If optional Section 9 (open questions / real blockers — **not** PRD §13 References) has active blocking items, stop execution and request clarification.

When Section 8 checklist is thin, read **PRD §8–10** from the PRD path in the plan header for business acceptance.

### 2. Create a task-scoped execution contract
Before editing code, write a short task contract for the current task only (objective, files, invariants, local checks, and repair budget).

### 3. Implement in the smallest coherent slice
Do not implement the entire feature before validating anything. Prefer one task at a time. Follow closed decisions from the plan.

### 4. Run a focused quality gate after each task slice
Run only the checks that are relevant to the current diff and task risks (linter, analyze of the affected package, or tests).

### 5. Repair only what the current diff introduced
If the gate fails, classify the outcome as `fixable` (maximum 2 repair passes per task) or `blocked`.

### 6. Enforce hard stop conditions
Stop repair and move to `blocked` when budget is exhausted, the same failure repeats twice, or the fix requires reopening closed plan decisions.

### 7. Close the task with evidence
Mark a task complete and move to the next. Once all tasks are `completed`, move to `slice_validating`.

### 8. Run mandatory internal slice validation
After all tasks in the current slice are complete, write the state file boundary before invoking validation.

#### State file boundary

Create `.atlas/state/<run_id>/<slice>.json` following `packages/templates/STATE_FILE_SCHEMA.md`:

```json
{
  "run_id": "<run_id>",
  "slice": "<slice id>",
  "tasks": ["T01"],
  "files_changed": ["relative/path.ext"],
  "diff_stat": "N files, +X -Y",
  "plan_path": ".atlas/plans/<id>.plan.md",
  "boundary_refs": ["§2.I1", "§6.1", "§8"],
  "executed_at": "ISO8601",
  "executor_skill": "atlas-plan-execute"
}
```

Then spawn the validator as an isolated subagent. Use the host-native dispatch — the validator is registered as a real subagent on every host, so always invoke it deterministically, never inline its logic:

- **Claude Code:** `Agent(subagent_type: "atlas-task-validator", prompt: ".atlas/state/<run_id>/<slice>.json")` — registered via `agents/atlas-task-validator.md` at plugin root.
- **Codex App:** invoke `$atlas-task-validator` with the `state_path` as the only argument — registered via `agents/openai.yaml` (`allow_implicit_invocation`).
- **Generic / other hosts:** dispatch the `atlas-task-validator` subagent passing only `state_path`.

In every case the only input is `state_path`. Do not paste the contract, diff, or task list inline. The validator reads everything it needs from the state file and the plan it points to.

### 9. Consume validator output with a bounded loop
Parse validator output with `JSON.parse(output)`. Decide only from `verdict`:

```js
const result = JSON.parse(output);
if (result.verdict === 'pass') slice_done();
else if (result.verdict === 'pass_with_observations') slice_done({ observations: result.observations });
else if (result.verdict === 'fail') repair_or_block(result.findings, { max_cycles: 2 });
else blocked('validator_verdict_invalid');
```

Never decide by substring matching prose. Repair P1/P2 findings inside the current slice boundary and re-run up to a maximum of 2 cycles.

### 10. Report final outcome
At the end of execution, report completed tasks, validations run, validator outcome, and any residual gaps.
