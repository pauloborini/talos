# SPEC — Caça C1 pré-fechamento (sprint-pref) e papel do G8 (onda 3)

**Status:** contrato a implementar — a fase `sprint_pref` já é **reconhecida** pelo dispatch e o commit nessa fase é bloqueado por contrato (`{ code: "onda3_pref_fora_de_escopo" }` em `packages/mcp-server/server.js`), mas a skill e o ciclo de validação não existem.
**Origem:** desenho "Enxugar colo da LLM e absorver o Guide no Talos" (2026-08-19), onda 3.
**Regra associada:** validação antes de declarar pronto e revisão crítica — ver as cláusulas de determinismo e pipeline em `_app-vault/docs/decisions/`.

## Fatia 9 — skill `talos-sprint-pref`

Skill nova, **só do orquestrador**. Roda **uma vez por sprint**, depois da última slice em `pass` ou `pass_with_observations` e **antes** de `talos_update_sprint_status`.

- **Mandato:** caça C1 do Guide — o verde-mas-falso (teste sem vermelho, legado no caminho).
- **Não é** validator, **não é** G8, **não é** por slice.
- **Fluxo:** `lock_dispatch(start, phase=sprint_pref)` → subagente → mutação + `talos_commit_state` (com `role=pref`) → `lock_validator` em ciclo próprio com **teto de 1 repair** (não consome o teto de 2 da slice) → então a sincronização de status.
- **Obrigatoriedade:** `policy_manifest.pref_required: true` obriga a fase; ausente = skip. O default do template de sprint é `false` (opt-in), para não mudar o comportamento dos packs atuais.

## Fatia 10 — o G8 é o F

- Sem skill nova: `talos-slice-review` (G8) **é** o F.
- O orquestrador documenta: G8 não sai de dentro de execute, validator ou pref; quando `critical_review.required`, é sessão nova com modelo à escolha.
- Código: não despachar review a partir das skills de execute, repair ou pref (já proibido) — resta apenas o texto do orquestrador e um guard DR05 impedindo que essas skills citem `talos-slice-review` como alvo de dispatch.

## Fluxo alvo da sprint-bound

```text
(sprint-bound, última slice fechada, pref_required)
orquestrador   sprint_pref -> commit_state(role=pref) -> validator (teto 1)
               [sessão nova] G8 se critical_review.required
               talos_update_sprint_status
```
