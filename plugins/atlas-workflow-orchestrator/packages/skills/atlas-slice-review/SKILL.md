---
name: atlas-slice-review
description: Skill `atlas-slice-review`. Revisa uma slice implementada após `atlas-plan-execute`, usando o plano (`atlas-plan-handoff`), invariantes e código tocado como contrato. Revisão fria focada na slice — regressões ocultas, gaps de lógica, cenários em falta, riscos de segurança, violações arquiteturais e testes em falta.
---

# Atlas Slice Review

Use this skill only when `--review` is present after `atlas-plan-execute` or any equivalent implementation pass has finished a specific plan slice.

Review only the slice that was executed. Do not widen into a generic repo audit unless the user explicitly asks for that.

## Invocation gate

`--review` is the only automatic dispatch condition. Do not auto-trigger from heuristics, diff size, risk level, or validator observations. If `--review` is absent, report that external review was skipped by contract.

## Uso standalone — rótulo de garantia reduzida obrigatório (PRD D10/D11)

Esta skill é **análise de leitura**: revisa código, **não muta código**. Pela fronteira de determinismo do Atlas (mutação de código, PRD D10), leitura standalone é **permitida**, mas carrega **risco epistêmico** — a análise não passou pela defesa fria do pipeline (`atlas-task-validator`, que é pipeline-only, só `state_path`). Esse risco é mitigado por **rótulo**, não por gate.

**Regra dura:** quando `atlas-slice-review` roda **fora do pipeline** (sem o `atlas-task-validator` ter fechado a slice via state file), a saída **SEMPRE** sai rotulada como garantia reduzida. É **proibido** simular `validator_status: passed` ou qualquer veredito de validação aprovado — a review é leitura, não validação fria.

### Formato exato do rótulo (obrigatório no topo da saída standalone)

```text
guarantee_level: reduced_standalone
validator_status: not_run (sem validator-closed)
scope: standalone
```

- `guarantee_level: reduced_standalone` — enum fixo (PRD D12); nunca `full_pipeline` em uso standalone.
- `validator_status: not_run (sem validator-closed)` — declara explicitamente que a defesa fria não rodou. **Proibido** escrever `passed`/`pass`.
- `scope: standalone` — marca que a review não está ancorada num state file de pipeline.

Quando a review roda **dentro do pipeline** (despachada pelo orquestrador após o validator frio fechar a slice), o nível de garantia da slice vem do pipeline (`full_pipeline`) e este rótulo de redução **não** se aplica — mas a própria review continua sendo leitura e nunca emite veredito de validador.

> **Invariante:** uma análise de leitura standalone nunca se declara fechada por validação; sai rotulada `reduced_standalone` e jamais simula `validator_status: passed` (PRD D10/D11, fecha Q-08).

## State persistence

Use `atlas_run_state` as the primary source for run state, dispatch status, and validator status. Do not read or write run ledger files directly. If MCP state is unavailable, block the review rather than accepting a local file fallback.

---

## Review Contract

Base the review on three inputs:
1. **The plan artifact** produced by `atlas-plan-handoff` (Section 2 - Invariantes, Section 6 - Contratos, Section 8 - Validação).
2. **The executed task ids** or slice boundaries.
3. **The real code** touched by the implementation.

---

## Required Workflow

### 1. Build the slice boundary first
Before reviewing code, identify:
* diff physical boundary (`git diff --name-only main...HEAD`).
* Section 2 - Invariants of Execution (contract).
* Section 6 - Technical Contracts (signatures and shapes).
* Section 8 - Validation and Checklist (QA criteria).
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
