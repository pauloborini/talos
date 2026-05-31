---
name: codex-plan-execute
description: Skill `codex-plan-execute` (par com `cursor-plan-execute` / `claude-plan-execute`). Executa planos produzidos por `codex-plan-handoff` com gates finitos, self-repair limitado, validação interna obrigatória via subagente e paradas explícitas. Use quando o Codex precisar implementar um plano task-a-task sem derivar dos invariantes.
---

# Codex Plan Execute

Use this skill to turn a `codex-plan-handoff` artifact into a controlled execution loop.

Prefer finite, stage-based execution over continuous self-critique. The goal is to finish the task with high confidence, not to keep polishing indefinitely.

---

## Execution Model

Operate as a bounded state machine:
`ready` → `implementing` → `gating` → `repairing` → `task_done` → `slice_validating` → `slice_done` (or `blocked`).

---

## Required Workflow

### 1. Load the plan as an execution contract
Read the `codex-plan-handoff` artifact. Extract at minimum:
* **Execution metadata**: Prefix, mode, and validator options.
* **Executive translation and PRD links** (from Section 1 — include path to PRD; cite `PRD §5` D* IDs, do not paste the full D* table).
* **Execution invariants** (from Section 2).
* **Current state at sprint opening** (from Section 4 — not Section 2).
* **Pitfalls** (from Section 3).
* **All execution tasks TNN** (from Section 5).
* **Technical contracts** (from Section 6).
* **Slices of execution** (from Section 7).
* **Checklist for the validator** (from Section 8 containing the tag `(§14)`).

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
After all tasks are complete, spawn the `codex-task-validator` as an isolated subagent. 
Provide the validator with: the changed-file list, the diff stat, the plan (Section 2, Section 6, and Section 8/§14), and the executed tasks list.

### 9. Consume validator output with a bounded loop
Handle verdicts (`pass`, `fail-com-P1`, `fail-com-P2-only`). Repair P1 findings and re-run up to a maximum of 2 cycles.

### 10. Report final outcome
At the end of execution, report completed tasks, validations run, validator outcome, and any residual gaps.
