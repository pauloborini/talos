# HANDOFF — fixture candidatos válidos

## Metadados

| Campo | Valor |
|---|---|
| sprint_id | S04 |
| data | 2026-08-01 |
| status_pos_validator | pass |
| origem | manual |

---

## Candidatos (0–3)

### Candidato 1
claim: Gate G12 exige checkpoint state_path_created antes do validator frio.
âncora.tipo: EVAL
âncora.valor: EVAL-001
ref: packages/skills/talos-plan-execute/SKILL.md
motivo: regra de liveness reutilizada em toda slice plan_execute.

### Candidato 2
claim: Finding P1 sobre selo write-once deve virar check no verify.
âncora.tipo: finding
âncora.valor: F-SELO-001
ref: (ausente — ok; não bloqueia)
motivo: padrão de integridade do contrato congelado.
