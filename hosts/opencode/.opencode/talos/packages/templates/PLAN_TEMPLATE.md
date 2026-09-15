# PLAN <ID> — <Title> (execution)

| Field | Value |
|-------|-------|
| **Sprint file** | [SPRINT_S<NN>_<slug>.md](./<relative-path>) — `eval_manifest` §9 — or `Not applicable (standalone)` when `Source mode: standalone` |
| **Package / app** | `<packages/... | apps/...>` |
| **Type** | `<feature | ui | navigation | …>` |
| **execution_mode** | `<sequential (T01→TN) | orchestrated-per-slice>` |
| **Date** | <YYYY-MM-DD> |

**Technical scope:** Sprint §3 + contract §7. **Out of scope:** <bullets derived from sprint out-of-scope — do not recopy entire §3>.

**Eval source:** Sprint §7/§9 (or `Sprint §7 (standalone)` when without backlog).

Policy: [BOUNDARY_SPRINT_PLAN.md](./BOUNDARY_SPRINT_PLAN.md).

---

## 1. Executive summary

<What will be implemented in 1 paragraph + observable technical outcome.>

**Scope source:** <Sprint file §2–§4 + contract §7>

**Reference pattern in monorepo:** <e.g.: "mirror module X in ...">

**Mandatory differences vs reference (do not copy blindly)**

| Topic | Reference (reject) | This deliverable (Sprint §7) |
|-------|--------------------|-----------------------------|
| <…> | <…> | <D* or rule> |

<Existing capabilities in code that this slice only integrates — e.g.: ready GF04 use cases.>

---

## 2. Execution invariants (derived from Sprint §7)

- <technical invariant derived from Sprint §7 D*/scenarios — e.g.: no refetch when filtering>
- <`sprint-bound`: invariant/gate derived from sprint file §9/§10 — e.g.: preserve boundary X. `standalone`: invariant/gate derived directly from Sprint §7>
- <…>

> Do not recopy the contract decision table or the sprint file YAML; reference `Sprint §7 D12` and, in `sprint-bound`, `Sprint §9 EVAL-001`. In `standalone`, reference only `Sprint §7`.

---

## 3. Pitfalls

- <common anti-pattern in repo> → <correction>
- <…>

---

## 4. State at sprint opening (pre-implementation)

> If the deliverable is **already in the code**, do not reimplement: use as verification checklist against Sprint §7.3 and PLAN §8. The executor **reads the repo** and confirms what is missing.

- **Sprint status:** <status from sprint file + relevant blockers>
- <3–6 bullets of what blocks today — behavior or absence, not list of 15 files>

---

## 5. Execution tasks

<!-- For execution_mode: orchestrated-per-slice, group with ### Slice A — … -->

#### T01. <Short title>

- **Objective:** <observable outcome>
- intent_refs: [SF-01, R1]
- **Reference:** <module/pattern in monorepo — optional>
- **Preconditions:** <none | T0X>
- **Expected change:** <what concretely changes>
- **Preserved invariants:** <§2 or Sprint §7>
- **Eval/Policy:** <`sprint-bound`: Sprint §9 EVAL-* / §10 relevant policy. `standalone`: Sprint §7 relevant acceptance>
- **Do not change:** <…>
- **Do not do:** <forbidden shortcuts>
- **Dependencies:** <none | T0X>
- **Risks:** <if relevant>
- **Done criterion:** <objective signal>
- **Local validation:**
  ```bash
  cd <package-or-repo> && <command>
  ```
- **Quality gates:** <optional — verifiable items of this task>
- **Minimal cases:** <only in test tasks — numbered list>

#### T02. <…>

<!-- repeat up to TNN; each task declares intent_refs after Objective (e.g.: [SF-01, R1] or [R1]) -->

<repeat up to TNN>

#### TNN. Final validation

- **Objective:** local gates + regression of dependent deliverables + minimal manual acceptance (Sprint §7.3; in `sprint-bound` also Sprint §9).
- intent_refs: [R1]
- **Dependencies:** T01–T(N-1)
- **Done criterion:** zero issues; green tests
- **Local validation:**
  ```bash
  cd <package> && flutter analyze
  cd <package> && flutter test
  ```
- **Manual verification (recommended):**
  1. <step aligned with UX scenarios of Sprint §7.2>
  2. <…>

---

## 6. Technical contracts (only ambiguity Sprint §7 → code)

### 6.1 <Domain / persistence / API>

| <Layer> | Rule |
|---------|------|
| <…> | <…> |

### 6.2 <Failures / states / pipeline — if applicable>

| <Code or step> | <Behavior in store/UI> |
|----------------|------------------------|

---

## 7. Slices (only if `execution_mode: orchestrated-per-slice`)

| Slice | Tasks | Objective |
|-------|-------|----------|
| A | T01–T03 | <…> |
| B | T04–T05 | <…> |

Order: **A → B → …**. Validator: diff boundary per slice + §2 and §7.

---

## 8. Validation and checklist (validator)

Reference **Sprint §7** + invariants **§2** of this plan. In `sprint-bound`, add `eval_manifest` of sprint file §9. In `standalone`, declare `Eval source: Sprint §7` — no mandatory sprint manifest beyond contract.

```bash
cd <package> && flutter analyze
cd <package> && flutter test
```

- [ ] <criterion derived from Sprint §7 D*/acceptance or Sprint §9 EVAL-*>
- [ ] <…>

---

## What this template DOES NOT include (by design)

- Final handoff prompt
- Planner readiness gate
- § "Loaded rules" from `project-rules` (AGENTS loads)
- Copy of D* table from contract §7
- Full copy of `eval_manifest`/`policy_manifest`
- Global inventory of touched files
