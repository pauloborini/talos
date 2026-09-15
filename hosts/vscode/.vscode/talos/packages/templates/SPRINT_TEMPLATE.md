# Live sprint — S<NN> — [SPRINT_NAME]

Live sprint file for **S<NN>**. This document connects the macro backlog to the PLAN without bloating either.

Rule: this file stores **scope, state, local decisions, dependencies, gates, evidence, and sprint learnings**, and the **frozen product contract** (§7: D* decisions, UX scenarios, and binary acceptance). The PLAN stores technical execution. Standalone variant: `Master backlog: Not applicable (standalone)`.

---

## 1. Metadata

| Field | Value |
|---|---|
| Sprint ID | S<NN> |
| Name | [short name] |
| Status | [backlog / ready / doing / review / manual_validation_pending / done / blocked] |
| Master backlog | [path + anchor of line S<NN> — or `Not applicable (standalone)`] |
| Contract status | [draft / approved] |
| Contract seal | [pending until approval] |
| Intent status | [draft / saturated] |
| Intent seal | [pending until saturation] |
| PLAN | [pending or path] |
| State / evidence | [pending or path] |
| Revalidation | [false — flag `true` enabled by MCP when `M` failed in a sprint this depends on (revalidation cone, D2/D20)] |
| Traceability | [legacy — default; `v1` (opt-in) requires `source_refs` in every AC of §7.3 and consistent peer in ledger `.talos/traceability/<slug>.json`] |
| Phase | [F0/F1/F2/F3/F4/F5] |
| MoSCoW | [Must / Should / Could / Won't now] |
| Priority | [P0/P1/P2/P3] |
| Owner | [role/name] |
| Created at | [YYYY-MM-DD] |
| Last updated | [YYYY-MM-DD] |

---

## 2. Goal and value

**Single goal:** [one sentence]

**Expected value:** [product, operational, risk, or unlock benefit]

**Observable outcome:** [what will be demonstrably different at the end]

**If not done:** [impact of postponing]

**Attack axis:** `data` \| `ux` \| `structure` \| `contract` \| `mixed` — [assumption / user / derived:<path>]

**T* verification:** [T1–T7 triggered / cleared — one line]

**Interview:** [pending | waived: <reason>]

**Surfaces (SF-*):**
- **SF-01** — [statement; path:symbol only with `[unverified]`] — [user / derived:<path> / assumption]

**Tempting anti-scope (AS-*):**
- **AS-01** — [concrete implementation/axis temptation; generic does not count] — [user / derived:<path> / assumption]

**Refusal:**
- **R1:** I refuse the sprint if [observable effect fails] — [user / derived:<path> / assumption]

**Repo rules:** [follow <path> | user exception: <reason> | N/A (axis does not touch product)]

---

## 3. Sprint scope

### In scope

- [ ] [capability/deliverable 1]
- [ ] [capability/deliverable 2]
- [ ] [capability/deliverable 3]

### Out of scope

- [ ] [tempting adjacent item that does not enter]
- [ ] [future improvement]
- [ ] [scope expansion risk to avoid]

### Size limit

- [ ] Single goal confirmed.
- [ ] No more than one complex vertical deliverable.
- [ ] If the PLAN estimates more than 8 tasks, break before executing.

---

## 4. Context and sources

| Type | Source | Use in this sprint |
|---|---|---|
| Master backlog | [path/anchor] | [macro scope/dependency] |
| Product | [doc/link] | [rule/decision] |
| Contract/API | [doc/link] | [field/integration] |
| Real code | [path/symbol optional] | [pattern/current state] |
| Discussion | [link/summary] | [decision/context] |

> The `Discussion` row is **mandatory** (v0.16.0, CN6): every sprint file declares the discussion from which it was born — it is the source of intent that the cold reviewer uses as an oracle. Empty cell or placeholder (`[link/summary]`, `[...]`, `—`, `N/A`) causes `talos_verify_sprint_file` to reject the artifact, including in standalone sprints. Filled example:

| Type | Source | Use in this sprint |
|---|---|---|
| Discussion | `_app-vault/docs/decisions/artefatos.md` (DEC-027) | origin decision/context |

Notes:

- Do not copy implementation here.
- If a source becomes a product contract, reflect in §7.
- If a source becomes a technical task, reflect in PLAN.

---

## 5. Dependencies and blockers

### Dependencies

| ID | Type | Description | Status | Evidence |
|---|---|---|---|---|
| S<NN-1> | sprint | [dependency] | [done/open/blocked] | [link] |
| DEP-001 | external | [contract/access/decision] | [open/done/blocked] | [link] |

### Current blockers

| ID | Blocker | Owner | Action | Status |
|---|---|---|---|---|
| BLK-001 | [blocker] | [owner] | [action] | [open/resolved] |

---

## 6. Sprint decisions

Local decisions shaping this sprint. Product decisions becoming acceptance must appear in §7.1 (D*).

| ID | Decision | Source | Impact | Status |
|---|---|---|---|---|
| SD-001 | [decision] | [source] | [impact] | [proposed/approved/reverted] |

---

## 7. Product contract (frozen)

Single home of product for this sprint: D* decisions, UX scenarios, and binary acceptance. The §7 acceptance derives from saturated §2; the cold validator scores code against this block (not against PLAN). Freeze flow: `draft` (maturation) → upon approval, record `Contract status: approved` + `Contract seal: sha256:<hash of §7>`; any edit to the approved block without re-approval is tampering (`FROZEN_ACCEPTANCE_TAMPERED`). To re-edit: return to `draft` (clearing seal), edit, re-approve.

### 7.1 Product decisions (D*)

> SSoT for product decisions. Other sections reference by `D-id`. Every decision declares provenance in the `Origin` column (v0.16.0).

| ID | Decision | Origin |
|---|---|---|
| D1 | [closed decision — product, not implementation — given by user] | user |
| D2 | [decision read from real code or contract] | derived:packages/example.js |
| D3 | [decision inferred by model — close via interview before supporting Must/P0 acceptance] | assumption |

Provenance `Origin` legend (enum):

- `user` — interview response or direct brainstorm quote.
- `derived:<path>` — read from real code/contract; `<path>` relative to repo root; suffix ` (new)` when the file is yet to be created (e.g.: `derived:packages/new_module.js (new)`).
- `assumption` — inferred by model; does not support `Must`/`P0` sprint acceptance until confirmed.

### 7.2 UX scenarios

> Per scenario: Input / Behavior (loading · empty · error) / Success.

### 7.2.1 [Scenario A — e.g.: create / load]

- **Input:** [where the user comes from]
- **Behavior:** [step by step; loading / empty / error]
- **Success:** [what the user sees]

### 7.2.2 [Scenario B — e.g.: edit / insufficient data]

- **Input:** [...]
- **Behavior:** [...]
- **Success:** [...]

### 7.3 Binary acceptance

> Observable and atomic criteria (`AC-*`). Hierarchy: `AC-*` ⊃ `EVAL-*`. Every `EVAL-*` of `eval_manifest` §9 must be referenced by ≥1 `AC-*`. Granularity: ≥1 `AC-*` per §7.2 scenario + ≥1 regression when there is material regression.

```yaml
acceptance:
  - id: AC-001
    origin: "user"
    behavior: "[observable effect]"
    source_refs: [REQ-001]
    decisions: [D1]
    scenario: "[§7.2 scenario]"
    evals: [EVAL-001]
    evidence:
      required: [I, T-outcome, W]
      manual: null
  - id: AC-002
    origin: "derived:packages/example.js"
    behavior: "[observable effect requiring manual smoke]"
    source_refs: [REQ-002]
    decisions: [D2]
    scenario: "[§7.2 scenario]"
    evals: [EVAL-002]
    evidence:
      required: [I, T-outcome, M]
      manual:
        severity: high
        scenario: "[minimal human steps]"
        expected_evidence: "[observable result]"
        impact_paths: ["packages/foo.js"]
```

Every `AC-*` declares `origin` (same enum as §7.1: `user` | `derived:<path>` | `assumption`). `assumption` does not support acceptance in a `Must`/`P0` sprint: the `talos_verify_sprint_file` gate blocks naming the `AC-*` until the assumption is closed in an interview.

Evidence types (D4): `I` implementation, `T-outcome` observable outcome (return/effect assert), `W` wiring, `M` manual smoke. `manual` must be `null` when `required` does not include `M`; object (severity/scenario/expected_evidence/impact_paths) when it does.

> Opt-in traceability (v1): with metadata `Traceability: v1` **and** `ledger.sprints[<id>].schema: traceability_v1`, every `AC-*` declares `source_refs: [REQ-*]` (no inline comment on same line — parser reads only list) with ids existing in ledger `.talos/traceability/<slug>.json` (registered via `talos_traceability` action `upsert`); REQ `included` assigned to sprint must appear in ≥1 AC; non-1:1 link requires `reason` in `reqs[<id>].links[]` of ledger. Without mark (legacy), current gates apply — no new field required and `source_refs` is ignored.

---

## 8. Definition of Ready

- [ ] Backlog points to this sprint file (except standalone).
- [ ] This sprint file points to backlog (or `Not applicable (standalone)`).
- [ ] Single goal and closed scope.
- [ ] Critical dependencies resolved.
- [ ] Critical blockers resolved or logged.
- [ ] Contract §7 complete (D*, UX scenarios, `AC-*` in YAML `acceptance`) and `Contract status` filled.
- [ ] Saturated intent (§1 seal) — mandatory for green DoR / `plan_ready`.
- [ ] Minimal `eval_manifest` filled.
- [ ] Explicit next action.

**DoR status:** [green / yellow / red]

---

## 9. Eval manifest

Minimal sprint evaluation manifest. Informs PLAN, executor, and validator on what needs proving. `EVAL-*` is subordinate proof medium to `AC-*` via `evals:` in §7.3. Manual smoke (M) lives in AC's `evidence.manual`; there are no loose `manual_checks` here as acceptance authority.

```yaml
eval_manifest:
  sprint_id: "S<NN>"
  objective: "[short objective]"
  must_prove:
    - id: "EVAL-001"
      claim: "[verifiable claim]"
      source: "[Sprint §7 / PLAN §8 / state path / test]"
      evidence_required: "[test, command, screenshot, state, log, fixture]"
  regression_guards:
    - "[flow/rule that cannot break]"
  negative_paths:
    - "[relevant error/permission/empty/retry]"
```

---

## 10. Policy manifest

Local sprint rules. Does not replace AGENTS.md or project rules.
Planned areas belong to sprint/PLAN scope; do not use positive list as allowlist of files.

```yaml
policy_manifest:
  forbidden_scope:
    - "[forbidden area/module]"
  data_safety:
    - "[no deleting data / no migrating contract / no secrets in logs]"
  required_gates:
    - "talos_verify_sprint_file"
    - "talos_verify_template_conformance:plan"
    - "talos-task-validator"
  critical_review:               # optional — true makes slice-review mandatory (D06/D09)
    required: false
    reasons: []                  # fixed enum: authorization | payment | data_migration | public_contract | host_adapter_dispatch
```

---

## 11. Guide and sensors

### Guides

- [ ] [product/code/process pattern to follow]
- [ ] [useful reference]

### Drift sensors

- [ ] Scope growing beyond single goal.
- [ ] Contract §7 copying implementation.
- [ ] PLAN copying roadmap.
- [ ] Claim without evidence.
- [ ] Non-done dependency treated as ready.
- [ ] Decision reopened without history.

---

## 12. Evidence-to-claim

Living table to close the loop between promise and proof.

| Claim | Where promised | Expected evidence | Actual evidence | Status |
|---|---|---|---|---|
| [claim] | [Sprint §7 / PLAN § / backlog] | [test/gate/state] | [path/link] | [pending/pass/fail] |

---

## 13. PLAN

> Product acceptance lives in §7 of this sprint file. This section only tracks the execution PLAN.

| Field | Value |
|---|---|
| Status | [pending / draft / approved / executed] |
| Path | [path] |
| Execution mode | [sequential / orchestrated-per-slice] |
| Observations | [summary] |

---

## 14. Execution and validation

### Expected gates

| Gate | Status | Evidence |
|---|---|---|
| Valid sprint file | [pending/pass/fail] | [path/result] |
| Contract §7 | [pending/pass/fail] | [status + seal] |
| Valid PLAN | [pending/pass/fail] | [path/result] |
| Execution completed | [pending/pass/fail] | [state path] |
| Cold validator | [pending/pass/fail] | [verdict/path] |

### Definition of Done

- [ ] Acceptance criteria §7.3 (`AC-*`) green.
- [ ] PLAN executed within boundary.
- [ ] Local validations recorded.
- [ ] Cold validator `pass` or `pass_with_observations`.
- [ ] Evidence-to-claim complete.
- [ ] Backlog updated with status and links.
- [ ] Relevant learnings recorded.

**DoD status:** [green / yellow / red]

---

## 15. Learnings and handoff for next sprints

| Type | Learning | Affects | Action |
|---|---|---|---|
| product | [learning] | [SNN/backlog] | [action] |
| technical | [learning] | [PLAN/future sprint] | [action] |
| operational | [learning] | [runbook/QA] | [action] |

---

## 16. History

| Date | Author | Change |
|---|---|---|
| [YYYY-MM-DD] | [name/agent] | Sprint file creation |
