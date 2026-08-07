# HANDOFF — candidatos pós-validator

Template de emissão de `HANDOFF_*.md` pelo `talos_update_sprint_status` (sprint `done` com veredito validator terminal).

## Metadados

| Campo | Valor |
|---|---|
| sprint_id | <sprint_id> |
| data | <data> |
| status_pos_validator | <veredito> |
| origem | <origem> |

---

## Regras do filtro

Filtro determinístico de promoção (`talos-memory-promote`), 0–3 candidatos:

- Âncora forte obrigatória: `âncora.tipo` ∈ `EVAL` \| `finding` \| `symbol` \| `test` \| `id`, com `âncora.valor` preenchido.
- Path de `SPRINT_*.md` / backlog **sozinho** como âncora é inválido (filtro D4).
- `claim` e `motivo` obrigatórios; `ref` opcional (pode ser `(ausente — ok; não bloqueia)`).
- 0 candidatos = sucesso (nenhum fato promovido automaticamente).

---

## Candidatos (0–3)

### Candidato 1
claim: <fato durável com âncora forte>
âncora.tipo: <EVAL|finding|symbol|test|id>
âncora.valor: <EVAL-*|F-*|símbolo|teste|id>
ref: <path real que sustenta>
motivo: <por que vale promoção>

## Exemplos

### Candidato válido
claim: Gate G12 exige checkpoint state_path_created antes do validator frio.
âncora.tipo: EVAL
âncora.valor: EVAL-001
ref: packages/skills/talos-plan-execute/SKILL.md
motivo: regra de liveness reutilizada em toda slice plan_execute.

### Candidato inválido (âncora de sprint/backlog sozinha)
claim: A sprint S04 deve seguir o fluxo.
âncora.tipo: id
âncora.valor: SPRINT_S04_runtime.md
ref: (ausente)
motivo: path de sprint sozinho não é âncora durável.
