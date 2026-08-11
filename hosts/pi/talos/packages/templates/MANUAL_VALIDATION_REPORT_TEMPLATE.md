# Validações manuais abertas — <backlog-slug>

Relatório humano de smoke manual (`M`) **por backlog** (D11). Backlogs nunca compartilham arquivo.

**Path:** `.talos/manual-validation/<backlog-slug>.md`
**Criação:** somente quando existe `M` aberto (sprint em `manual_validation_pending` com ≥1 AC `manual_pending`).
**Retenção:** somente pendências abertas (D12); itens `validated`/`waived`/`failed` saem do relatório no sync e o histórico fica no state/sprint/ledger da run (D24).

O relatório é autoridade **somente** para o resultado humano do smoke. Não muda produto, escopo, `AC-*`, policy, PLAN nem evidência automática.

| Campo | Valor |
|---|---|
| Backlog | `<path do backlog mestre>` |
| Atualizado em | `<ISO-8601>` |

## Pendências

| ID | Sprint / AC | Severidade | Status | Cenário | Ambiente | Evidência esperada | Resultado / justificativa |
|---|---|---|---|---|---|---|---|
| MV-S01-AC-002 | S01 / AC-002 | alta | pending | [curto] | [alvo] | [curta] | — |

Regras do gate `talos_sync_manual_validation` (D14/D15):

- ID estável `MV-<sprint>-<ac>`; a coluna `Sprint / AC` deve espelhar o ID.
- Status ∈ {`pending`, `in_progress`, `validated`, `waived`, `failed`}.
- `validated`/`waived` exigem `Resultado / justificativa` não vazio (intervenção humana; waiver exige justificativa).
- Cada `MV-*` deve corresponder a um `AC-*` com `evidence.manual` no §7.3 do sprint file — item fantasma bloqueia.
- `validated`/`waived` em todos os `M` abertos → sync promove a origem a `done` (com `HANDOFF_*`).
- `failed` → origem `blocked` (o cone de revalidação entra no Plano 5).
- Relatório inválido ou dirty fora do gate → `blocked` com `next_action=fix_manual_validation_report`.
