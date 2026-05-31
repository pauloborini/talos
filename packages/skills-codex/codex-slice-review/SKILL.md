---
name: codex-slice-review
description: Skill `codex-slice-review` (par com `cursor-slice-review` / `claude-slice-review`). Revisa uma slice implementada após `codex-plan-execute`, usando o plano (`codex-plan-handoff`), invariantes e código tocado como contrato. Revisão fria focada na slice — regressões ocultas, gaps de lógica, cenários em falta, riscos de segurança, violações arquiteturais e testes em falta.
---

# Codex Slice Review

Use this skill after `codex-plan-execute` or any equivalent implementation pass has finished a specific plan slice.

Review only the slice that was executed. Do not widen into a generic repo audit unless the user explicitly asks for that.

---

## Review Contract

Base the review on three inputs:
1. **The plan artifact** produced by `codex-plan-handoff` (Section 2 - Invariantes, Section 6 - Contratos, Section 8 - Validação (§14)).
2. **The executed task ids** or slice boundaries.
3. **The real code** touched by the implementation.

---

## Required Workflow

### 1. Build the slice boundary first
Before reviewing code, identify:
* diff physical boundary (`git diff --name-only main...HEAD`).
* Section 2 - Invariants of Execution (contract).
* Section 6 - Technical Contracts (signatures and shapes).
* Section 8 - Validation and Checklist (§14) (QA criteria).
* touch files expected vs actual.
* resolved conflicts and permission matrices that apply.

If the diff and the plan disagree materially, call that out as a structural finding or blocker. Do not silently review an invented scope.

### 2. Review in code-review mode, not implementation mode
This skill is not for fixing code first. It is for finding problems first.
Look for:
* behavioral regressions introduced by the slice.
* hidden logic gaps or missing business scenarios.
* state-transition bugs and view/store mismatches.
* security or privacy issues.
* contract drift from the plan.
* validation and tests gaps.

### 3. Use the plan to hunt missing scenarios
For each executed task, compare: stated objective, expected change, invariants preserved, and done criteria with real code.
Ask what the implementation forgot:
* **State & orquestration:** transition states reativity (loading, success, empty, error), rapid triggers concurency, setup/cleanup symmetry, async stale.
* **Business rules:** negative paths, closed decisions, fallsback that weaken invariants.
* **View & rendering:** inputs empty, null, partial, out of order, UI permission conditional.
* **Contracts:** shape drift, enums, mappers, RLS server-side, i18n parity.

### 4. Distinguish current-diff findings from pre-existing issues
Prefer findings attributable to the executed slice. Mark pre-existing issues as observations or separate notes to keep signals clean and actionable.

### 5. Output Expectations

Return exactly this structure:

```markdown
## Findings

### P0 - <short title>
- **Slice/Task:** T0N
- **Por que importa:** [impacto real]
- **Arquivo:** `relative/path.ext:line`
- **Modo de falha:** [o que quebra e como]
- **Evidência:** [o que suporta o finding]

### P1 - <short title>
[same shape]

### P2 - <short title>
[same shape]

### P3 - <short title>
[same shape]

---

## Perguntas Abertas ou Suposições
[questões que precisam de confirmação antes de agir nos findings]

---

## Resumo da Slice
[breve — o que foi bem implementado, o que precisa atenção, se a slice pode ser considerada fechada]
```

Do not add extra sections or narrative conclusions.
