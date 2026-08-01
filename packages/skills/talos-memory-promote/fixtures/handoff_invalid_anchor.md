# HANDOFF — fixture âncora sprint_path inválida + 4º descartado

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
claim: Fato válido com âncora EVAL.
âncora.tipo: EVAL
âncora.valor: EVAL-003
ref: packages/skills/talos-memory-promote/SKILL.md
motivo: prova do filtro 0 candidatos = sucesso.

### Candidato 2
claim: Tentativa inválida usando só path de sprint.
âncora.tipo: id
âncora.valor: .talos/backlog/sprints/SPRINT_S04_skill_memory_promote.md
ref: .talos/backlog/sprints/SPRINT_S04_skill_memory_promote.md
motivo: deveria ser descartado pelo filtro D4.

### Candidato 3
claim: Segundo fato válido via symbol.
âncora.tipo: symbol
âncora.valor: detectSink
ref: packages/skills/talos-memory-promote/scripts/sink_adapter.mjs
motivo: adapter de sink é contrato estável da skill.

### Candidato 4
claim: Quarto fato deve ser recusado pelo teto 0-3.
âncora.tipo: test
âncora.valor: parse_handoff.test.js
ref: packages/skills/talos-memory-promote/scripts/parse_handoff.test.js
motivo: excesso além do cap.
