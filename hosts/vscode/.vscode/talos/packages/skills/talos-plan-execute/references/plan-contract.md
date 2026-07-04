# Plan Contract

Input plans must follow `talos-plan-handoff` and align with `PLAN_TEMPLATE.md` / `BOUNDARY_PRD_PLAN.md` (compact template, sections 1–8). Locate both in the Talos plugin bundle at `packages/templates/`; do not use workspace-local templates as primary sources.

If `packages/templates/PLAN_TEMPLATE.md` or `packages/templates/BOUNDARY_PRD_PLAN.md` is absent from the bundle, stop with a clear `Template canônico ausente: <nome-do-template>` error. Do not fall back silently to old local, vault, or global copies.

Legacy 15-section plans (handoff prompt, architecture impact block in PRD, etc.) are **not** the target format.

## Required execution metadata

Near the top of the artifact:

- `Plan prefix: talos`
- `Execution mode: sequencial (T01→TN)` | `orchestrated-per-slice`
- `Executor skill: talos-plan-execute`
- `Internal validator: talos-task-validator`
- `External review: talos-slice-review` (optional)

## Required plan sections (match by meaning)

| § | Purpose |
|---|---------|
| 1 | Executive translation (`Tradução executiva`) — scope link to PRD, reference module, diffs vs mirror |
| 2 | Execution invariants (derived from `PRD §3` — cite D* IDs, do not paste full table) |
| 3 | Pitfalls (anti-pattern → fix) |
| 4 | State at sprint opening (3–6 bullets; not a global file inventory) |
| 5 | Execution tasks `#### T01.` … `TNN` |
| 6 | Technical contracts (only where PRD → code is ambiguous) |
| 8 | Validation and validator checklist (derived from `PRD §6` + §2 invariants) |

Section 7 (Slices) is required only when `execution_mode: orchestrated-per-slice`.

**Not required:** handoff prompt, planner readiness gate, full `project-rules` rules dump, full PRD scope copy, global touched-files inventory.

**Optional:** section 9 open questions / real blockers (executor must stop if active blockers remain).

## Minimum task shape (section 5)

Each `#### TNN.` should include when applicable:

- `Objetivo` / `Objective`
- `Referência` (module or pattern — not a long path laundry list)
- `Pré-condições` / `Preconditions`
- `Mudança esperada` / `Expected change`
- `Invariantes preservados`
- `Não mudar` / `Não fazer` / `Do not do`
- `Dependências` / `Dependencies`
- `Riscos` (if not obvious)
- `Critério de done` / `Done criteria`
- `Validação local` / `Task-local validation` (command with package path)
- `Quality gates` (optional on critical tasks)
- `Casos mínimos` (test tasks only)

Paths may appear in **Referência** or **Validação local**; prefer module-level pointers per boundary policy.

## Executor consumption map

| Contract need | Plan section |
|---------------|--------------|
| Translation, PRD links, reference module | §1 |
| Execution invariants | §2 |
| Pitfalls | §3 |
| Current codebase state | §4 |
| Tasks, done criteria, local validation | §5 |
| Technical contracts | §6 |
| Slice boundaries | §7 (orchestrated mode) |
| Validator checklist | §8 |
| Business acceptance (when §8 is thin) | PRD §4–6 (read PRD path from plan header) |

## Why this matters

Prefix and mode are part of the execution contract, not chat memory.

If `Plan prefix` or `Execution mode` is missing, stop — do not guess the chain.

Thin tasks (`refactor bootstrap` only) are not ready for gated execution; ask for a denser plan.

Pitfalls, contracts, and invariants are binding — not commentary.

## Parsing notes

The bundled `extract_plan_contract.py` uses heading heuristics:

- `#` … `####` headings
- task headings `#### T01. …`
- bullet lines `- …`

Normalize non-standard plans before execution or extend the parser aliases.
