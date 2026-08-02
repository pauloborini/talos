---
name: talos-memory-promote
description: Skill `talos-memory-promote`. Use quando o usuário acionar `$talos-memory-promote [<handoff_path>]`, pedir para promover candidatos de um HANDOFF pós-validator, ou quando o ledger/orquestrador apontar promote explícito. Lê `.talos/memory/HANDOFF_*.md`, filtra 0–3 candidatos com âncora forte e promove via adapter de sink (`argus_remember` se Argus `remember` disponível; senão soft-fail `none`). Não é auto no `done`; não exige Argus; não implementa Atlas Memory Graph (porta documental `atlas_memory_graph`).
---

# Talos Memory Promote

Skill host-agnóstica: lê um handoff descartável pós-validator e promove candidatos duráveis via **adapter de sink**. Promote é **explícito** — nunca chamado por `update_sprint_status` / emit do `done`.

## Sintaxe

```text
$talos-memory-promote
$talos-memory-promote <handoff_path>
$talos-memory-promote .talos/memory/HANDOFF_<slug>_<YYYYMMDD>.md
```

- Com `<handoff_path>`: usa o path informado (relativo ao project root ou absoluto).
- Sem arg: descobre o `HANDOFF_*.md` mais recente sob `.talos/memory/` (exclui `HANDOFF_TEMPLATE.md`).
- Se nenhum handoff existir → soft-fail “handoff ausente” (não hard-fail do pipeline).

## Contrato duro

- Teto **0–3** candidatos; 4º é recusado.
- **0 candidatos = sucesso** — reportar 0 promovidos e **não** chamar sink.
- Âncora forte obrigatória: `tipo` ∈ `EVAL` \| `finding` \| `symbol` \| `test` \| `id` + `valor`. Path de `SPRINT_*.md` / backlog **sozinho** como âncora é inválido.
- Sink runtime:
  - tools Argus `remember` disponíveis → `argus_remember`
  - senão → `none` (soft-fail)
- Soft-fail `none`: mensagem clara + `handoff_path` + próximos passos; **não** apaga/move o MD; **não** exige instalar Argus; **não** cria vault paralelo sob `.talos/`.
- Proibido: `argus learn`, receipt JSON, auto-promote no `done`, hard-fail sem Argus, SoT longa nova sob `.talos/` além do HANDOFF já emitido.
- **Não** implementar Memory Graph / UI Atlas neste repo.

## Scripts do pacote

Use os scripts puros (testáveis, sem MCP embutido):

| Script | Função |
|--------|--------|
| `scripts/parse_handoff.mjs` | parse + filtro de candidatos |
| `scripts/sink_adapter.mjs` | `detectSink` + `promoteCandidates` (+ shapes de `remember`) |
| `scripts/promote_flow.mjs` | resolve path → parse → detect → promote (mockável) |

```bash
node --test packages/skills/talos-memory-promote/*.test.js
# ou: cd packages/skills/talos-memory-promote && npm test
```

Fixtures em `fixtures/`; implementação em `scripts/`.
## Fluxo obrigatório

1. **Resolver path** do HANDOFF (arg ou mais recente em `.talos/memory/`).
2. **Carregar e parsear** via `parse_handoff.mjs` (`parseHandoffMarkdown` / `parseHandoffFile`).
3. Se `zero_success` ou `candidates.length === 0` → reportar sucesso com **0 promovidos** e encerrar (sem sink).
4. **Detectar sink** inspecionando tools MCP disponíveis no host:
   - Se existir tool Argus equivalente a `remember` → `argus_remember`.
   - Senão → `none`.
5. **`argus_remember`:** para cada candidato válido (≤3), chamar `remember` no host com shape nativa Argus via `rememberCallShape`: `content`←claim(+motivo), `type`←`"decision"`, `tags`←`["talos-handoff", "anchor:<tipo>:<valor>"]` (omitir tag âncora se ausente), `links`←`[ref]` só se `ref` truthy. Sem keys `claim`/`anchor_*`. Reportar `promoted_count` 0–3.
6. **`none`:** soft-fail com causa + `handoff_path` + próximos passos (usar MD / Argus opcional / Atlas chat). Não quebrar pipeline já `done`.
7. Reportar descartados do filtro (âncora inválida, over_cap) sem inventar fatos.

## Sink `atlas_memory_graph` (porta Core — documental)

Enum documental para o **Atlas Agents** (outro repo / Core):

| Campo | Contrato |
|-------|----------|
| Input | o mesmo `HANDOFF_*.md` (candidatos já filtrados 0–3) |
| Saída | persistência no Memory Graph / chat Atlas |
| Seleção automática neste plugin | **nunca** — `detectSink` só retorna `argus_remember` \| `none` |
| Implementação | fora deste repositório Talos |

Quem usa Atlas cola/anexa o HANDOFF no chat (ou skill nativa futura). Este plugin só documenta a porta.

## Soft-fail sem sink (exemplo de mensagem)

```text
Nenhum sink de memória disponível (Argus `remember` ausente).
Handoff preservado em: .talos/memory/HANDOFF_….md
Próximos passos: (1) usar o MD manualmente; (2) ativar Argus opcionalmente e rerodar;
(3) colar/anexar no chat Atlas Agents (porta atlas_memory_graph).
```

## Proibições

- Não chamar esta skill a partir de `update_sprint_status` / `emitMemoryHandoff`.
- Não chamar `argus learn` nem gravar receipt JSON.
- Não hard-fail se Argus estiver ausente.
- Não criar SoT longa sob `.talos/` além do handoff já emitido (S03).
- Não empacotar manifesto multi-host aqui (S05).
- Não implementar Atlas Memory Graph neste repo.

## Aceite rápido

- Com Argus: promove ≤3 com âncora forte.
- Sem Argus: soft-fail + `handoff_path`.
- 0 candidatos: sucesso, 0 chamadas a sink.
- Docs citam `atlas_memory_graph` como porta (não implementação).
