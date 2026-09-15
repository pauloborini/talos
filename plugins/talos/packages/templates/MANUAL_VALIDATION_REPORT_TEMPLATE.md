# Open manual validations — <backlog-slug>

Human report of manual smoke (`M`) **per backlog** (D11). Backlogs never share a file.

**Path:** `.talos/manual-validation/<backlog-slug>.md`
**Creation:** only when open `M` exists (sprint in `manual_validation_pending` with ≥1 AC `manual_pending`).
**Retention:** only open pendencies (D12); `validated`/`waived`/`failed` items leave the report on sync and history remains in run state/sprint/ledger (D24).

The report is authoritative **only** for the human outcome of smoke. Does not change product, scope, `AC-*`, policy, PLAN, or automated evidence.

| Field | Value |
|---|---|
| Backlog | `<path of master backlog>` |
| Updated at | `<ISO-8601>` |

## Pending validations

| ID | Sprint / AC | Severity | Status | Scenario | Environment | Expected evidence | Result / justification |
|---|---|---|---|---|---|---|---|
| MV-S01-AC-002 | S01 / AC-002 | high | pending | [short] | [target] | [short] | — |

Rules of the `talos_sync_manual_validation` gate (D14/D15):

- Stable ID `MV-<sprint>-<ac>`; column `Sprint / AC` must mirror the ID.
- Status ∈ {`pending`, `in_progress`, `validated`, `waived`, `failed`}.
- `validated`/`waived` require non-empty `Result / justification` (human intervention; waiver requires justification).
- Each `MV-*` must correspond to an `AC-*` with `evidence.manual` in §7.3 of sprint file — phantom item blocks.
- `validated`/`waived` on all open `M` → sync promotes origin to `done` (with `HANDOFF_*`).
- `failed` → origin `blocked` (revalidation cone enters Plan 5).
- Invalid or dirty report outside gate → `blocked` with `next_action=fix_manual_validation_report`.
