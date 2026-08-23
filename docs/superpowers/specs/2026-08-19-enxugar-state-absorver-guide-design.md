# Brainstorm — Enxugar colo da LLM e absorver o Guide no Talos

- **Status:** desenho fechado para implementação (ondas 1–3). Ainda não é `DEC-*`.
- **Data:** 2026-08-19 · revisão de contrato 2026-08-21
- **Repo:** Talos (`0.17.2` → bump `0.18.x` na onda 1)
- **Não faz parte:** scriptar receipts do Guide (repo do Guide)

Fontes:

- [guide-pack-talos-absorcao.canvas.tsx](/Users/pauloborini/.cursor/projects/Users-pauloborini-Documents-projetos-talos/canvases/guide-pack-talos-absorcao.canvas.tsx)
- [talos-boilerplate-state.canvas.tsx](/Users/pauloborini/.cursor/projects/Users-pauloborini-Documents-projetos-talos/canvases/talos-boilerplate-state.canvas.tsx)

Enxugar o colo da LLM e absorver o Guide são o mesmo movimento: **a LLM julga em slots curtos; o MCP grava forma, git e índices.**

---

## 1. Problema

O state v3 no disco já é compacto. O custo está no procedimento:

1. Executors colam o JSON do schema — inclusive `acceptance_results`, que o executor não escreve.
2. A LLM monta SHA, `files_changed` e `worktree_*`. O MCP já tem `captureWorktreeSnapshot()`.
3. Quatro mapas repetem o mesmo fato: `task_evidence`, `validation_map`, `proof_refs`, `eval_results`.
4. G12 exige sete events. Só o equivalente a `state_path_created` trava o validator.
5. `talos_run_state` é upsert. A LLM ainda é writer do arquivo de slice.

Absorver o Guide como pack (GUIDE.md, JOURNAL.md, receipts, packguide Python) aumentaria o colo. Vale o padrão de escrita, desvio tipado, drift de skill, re-selo e a topologia orquestrador→subagente (já G4/G9).

---

## 2. Princípio

> LLM envia julgamento referenciável. MCP deriva o resto. Skill cita ID de gate/verbo, não ensina a montar artefato.

Intocável: DEC-012 sibling, DEC-004/008 fail-closed, DEC-013/014 §7+aceite, DEC-002/010/011 instalável. Cortar validator, oráculo T-outcome ou `state_path` único não é enxugue.

---

## 3. Abordagem

| | | |
|---|---|---|
| **A (fechada)** | `talos_commit_state` + `proofs[]`; disco continua v3 projetado | |
| B rejeitada | State vira log Journal | Breaking de reader/status |
| C rejeitada | Só enxugar prosa; LLM Write JSON | Blob volta |

Sem schema v4. MCP recebe julgamento e **grava** os mapas v3 para `talos_lock_validator` / oráculo / `talos_update_sprint_status` não mudarem de contrato.

---

## 4. Verbo `talos_commit_state`

Tool MCP nova. `additionalProperties: false`. Único writer do arquivo `.talos/state/<run_id>/<slice>.json`.

### 4.1 Quem pode chamar

O MCP infere `role` pelo lock ativo. A LLM **não** envia `role`.

| `role` | Condição | Senão |
|--------|----------|--------|
| `execute` | `dispatch.active.phase === plan_execute` e liveness ≠ `handoff_ready` | blocked |
| `repair` | slot `talos_lock_validator` em `repair_start` aberto para este `state_path` | blocked |
| `pref` | (onda 3) dispatch `phase === sprint_pref` ativo | blocked |

Repair **não** é fase `plan_execute`. Commit de repair **não** emite checkpoint de executor. Emite registro no ledger do slot de repair (`state_hash` do arquivo).

### 4.2 Payload (LLM)

```json
{
  "run_id": "string",
  "slice": "string",
  "plan_path": "string (obrigatório se routing.mode é full|execute e existe plano)",
  "sprint_file_path": "string opcional",
  "obligation_ids": ["O1"],
  "proofs": [
    {
      "id": "AC-001",
      "kind": "AC",
      "check": "node --test tests/foo.test.js",
      "files": ["packages/foo.js"],
      "covers": ["O1"]
    }
  ],
  "eval_na": [{ "id": "EVAL-002", "reason": "not_in_slice" }],
  "repair": [{ "finding_id": "F-001", "check": "node --test tests/foo.test.js" }]
}
```

Enums fechados:

- `kind`: `AC` | `EVAL` | `T`
- `eval_na.reason`: `not_in_slice` | `not_applicable` | `blocked_external`

Campos proibidos no input (presente → `-32602`): `acceptance_results`, `worktree_baseline`, `worktree_final`, `files_changed`, `base_sha`, `head_sha`, `check_table`, `proof_refs`, `eval_results`, `task_evidence`, `validation_map`, `policy_scope`, `executed_at`, `state_schema_version`, `role`.

### 4.3 Obrigatórios por role / modo

**`execute` + `contract_kind=plan`** (routing `full`/`execute` com plano):

- `proofs` não vazio.
- `plan_path` existente no consumer_root.
- Todo `AC-*` do §7.3 do sprint ligado ao plano (se `sprint_file_path` resolvido) tem proof `kind=AC` **ou** o AC é só `M` (manual) — ACs só-M não exigem proof T; ACs com `T-outcome` exigem proof.
- Todo `EVAL-*` do `eval_manifest` tem proof `kind=EVAL` ou linha `eval_na`.
- Todo `T0N` da slice no PLAN §5 tem proof `kind=T`.
- `obligation_ids` omitido; MCP parseia do plano (§2/§6 IDs `\b[OISR]\d+\b` + ACs).

**`execute` + `contract_kind=direct`:**

- `plan_path` omitido ou `null`.
- `obligation_ids` não vazio (IDs curtos, sem prosa).
- `proofs` não vazio; pelo menos um `kind=T` ou `kind=AC`.
- Se `sprint_file_path` presente, mesmas regras de AC/EVAL acima.

**`repair`:**

- `repair` não vazio.
- Cada `finding_id` existe no packet do `repair_start`.
- `proofs` opcional (só se o reparo mudar prova de AC/EVAL/T).
- Não envia `first_write`. Baseline do execute é preservada.

**`pref` (onda 3):** como `execute` mas `proofs` cobre só o que o pref tocou; baseline = `worktree_final` anterior (MCP copia, não recaptura baseline).

### 4.4 O que o MCP grava (v3)

Na ordem do `STATE_FILE_SCHEMA.md`:

| Campo | Fonte |
|-------|--------|
| `state_schema_version` | `3` |
| `run_id`, `slice` | args |
| `base_sha` | `git rev-parse HEAD` gravado em `lock_dispatch(start)` (nunca nome de branch) |
| `head_sha` | `git rev-parse HEAD` agora |
| `contract_kind` | `plan` se `plan_path`; senão `direct` |
| `tasks` | ids `kind=T` nos proofs (repair: união com tasks já no arquivo) |
| `files_changed` / `diff_stat` | `base_sha...HEAD` + delta `worktree_baseline→worktree_final`; dirty pré-existente idêntico fora |
| `plan_path` / `sprint_*` | args + parse |
| `prd_path` | omitido ou `null` |
| `boundary_refs` | IDs parseados (invariantes, tasks, EVAL, AC) — não prosa |
| `contract_ids` | parse plano/§7 + `obligation_ids` no direct |
| `eval_results` | proofs `EVAL` → `status: passed`; `eval_na` → `status` não-`passed` com `evidence: [reason]` — **nunca** `passed` forjado |
| `proof_refs` | proofs `AC`: `{checks, files}` índices. Sem `files` no proof → `files: []` (não espalhar o diff) |
| `policy_scope` | `policy_manifest` do sprint; arquivo em `forbidden_scope` que apareça no diff → commit blocked |
| `check_table` | dedup das strings `check` |
| `validation_map` | ver §4.5 |
| `task_evidence` | proofs `T` |
| `repair_evidence` | só `role=repair`: append `{finding_id, files, checks, status: "resolved"}` |
| `worktree_baseline` | ledger do `first_write`; repair/pref **não** sobrescreve |
| `worktree_final` | `captureWorktreeSnapshot()` agora |
| `executed_at` | clock MCP |
| `executor_skill` | fase: `talos-plan-execute` \| `talos-direct-execute` \| `talos-findings-repair` \| `talos-sprint-pref` |
| `acceptance_results` | **não** neste verbo |

Extensão de ledger (não precisa ir no JSON se o G12 já guardar): `slice_commit_sha256` do arquivo. `lock_validator(start)` exige que o sha do disco == último commit MCP daquele `state_path` (B7). Arquivo JSON válido escrito pela LLM sem commit → blocked.

Git falhou / fora do consumer_root → commit blocked, **nenhum** JSON parcial no disco (write atômico: tmp + rename).

### 4.5 `validation_map`

1. Se algum proof tem `covers`, cada id em `covers` tem de existir em `contract_ids`. Cada obligation recebe os checks dos proofs que a cobrem. Obligation parseada sem nenhum `covers` → commit blocked (não completar com linha vazia).
2. Se **nenhum** proof tem `covers`, uma linha por obligation parseada, `checks` = todos os índices de `check_table` (equivalente grosso ao executor atual “a slice cobriu o plano”).
3. Direct: `covers` opcional; default = todas as `obligation_ids` × todos os checks.

### 4.6 Retorno

```json
{
  "gate": "G12",
  "role": "execute|repair|pref",
  "status": "passed",
  "state_path": ".talos/state/<run_id>/<slice>.json",
  "state_sha256": "<hex>"
}
```

`role=execute`: liveness → `handoff_ready`, `last_checkpoint: state_path_created` (interno, executor não chama checkpoint).

`check` é honor system (exit 0 não é gravado). Oráculo/validator relê o teste. Sem `talos_capture_cmd` neste programa.

---

## 5. G12 fechado

Set de events que o **executor** ainda pode mandar via `talos_lock_dispatch(checkpoint)`:

- `first_write` — único event público restante.

Events removidos das skills e do set aceito: `executor_started`, `skill_loaded`, `plan_loaded`, `handoff_accepted`, `task_started`, `state_path_created`. Mandar um deles → G12 blocked `checkpoint_desconhecido` (o set encolhe de verdade).

### 5.1 Bootstrap / progress

`lock_dispatch(start)` **não** conta como checkpoint de executor (continua orquestrador).

- **Bootstrap (120s):** `stalled` se o executor não chamou **nem** `first_write` **nem** `talos_commit_state` até o deadline. Slice sem mutação: só `commit_state` dentro de 120s basta.
- **Progress (300s):** após o primeiro desses dois, o relógio de progress vale até `handoff_ready`.
- Contradizer “sem `first_write` até bootstrap = stalled **sempre**” está **revogado**. A regra é a frase anterior.

### 5.2 `first_write`

Uma vez, **imediatamente antes** da primeira mutação. Grava `worktree_baseline` no ledger da run. Segunda chamada → blocked.

Commit `execute` com diff não vazio e sem `first_write` no ledger → blocked.

Commit `execute` com diff vazio e sem `first_write` → passed (nada a fotografar).

Repair/pref: **proibido** `first_write`.

### 5.3 B7

`lock_validator(start)` (ciclo 1) exige último `slice_commit_sha256` == sha do arquivo. Não há `state_path_created` manual.

Mesma release que o verbo: skills + MCP + hosts copiados + DR*. Sem dual-writer.

---

## 6. Skills (onda 1)

`talos-plan-execute`, `talos-direct-execute`, `talos-findings-repair`:

1. Fluxo: (`first_write` se for mutar) → implementar/gates locais → `talos_commit_state` → `validator_handoff_required` / `repair_complete` com `state_path` do retorno.
2. Apagar blob JSON, ordem de campos, “siga STATE_FILE_SCHEMA”, “preencha worktree_*”.
3. Repair: não Write no JSON; mesmo `state_path`; `repair[]` obrigatório.
4. Direct: `obligation_ids` no commit; contrato compacto continua na resposta de trabalho (não vai para o disco além dos IDs).
5. Validator: inalterado no output; lê v3; ganha a checagem de sha via MCP no lock (não na skill).
6. Orquestrador: handoff continua só `state_path`. Sem colar `proofs`. Deixa de ensinar os 7 events.

`STATE_FILE_SCHEMA.md` = contrato MCP/validator. Executor não é instruído a abrir.

### 6.1 DR* (`build/check-consistency.mjs`) — onda 1

Falham o guard se aparecerem nestes glob: `packages/skills/talos-plan-execute/**`, `talos-direct-execute/**`, `talos-findings-repair/**` (e cópias `hosts/**`, `plugins/**` equivalentes):

| ID | Âncora |
|----|--------|
| DR01 | `STATE_FILE_SCHEMA.md` |
| DR02 | `worktree_baseline` ou `worktree_final` |
| DR03 | `executor_started` / `skill_loaded` / `plan_loaded` / `handoff_accepted` / `task_started` / `state_path_created` |
| DR04 | `"acceptance_results"` |

Allowlist: `packages/templates/STATE_FILE_SCHEMA.md`, `packages/mcp-server/**`, `packages/skills/talos-task-validator/**`, testes. Mensagem do guard cita o DR*.

Onda 3 acrescenta `talos-sprint-pref` nas mesmas âncoras.

---

## 7. Ondas

Uma onda = um PR revisável. Ordem rígida: 1 antes de 2 antes de 3.

### Onda 1 — writer (P0)

Fatias 1–4 + furos B1/B7: `talos_commit_state`, projeção dos mapas, G12 §5, skills §6, DR*, repair/direct no mesmo verbo. Bump `0.18.x`.

Pronto: slice real no host sem Write no state; `first_write`+`commit_state` ou só `commit_state`; validator sibling; `check-consistency` + `claude plugin validate ./ --strict`.

### Onda 2 — ledger de desvio + view + falseia

**Fatia 5 — `talos_run_event`.** Verbo novo (não `upsert`).

```json
{ "run_id": "...", "kind": "descoberta|lacuna|renegociacao|note|lacuna_resolvida", "subject": "T01|AC-001|§7", "facts": "max 200 chars" }
```

MCP infere ator (fase do lock), `at`, `eid` monotônico, hash. Proibido no input: `at`, `eid`, `actor`.

- `descoberta` / `note`: só ledger.
- `lacuna`: append em `run.data.blockers`. `talos_update_sprint_status` → `done` / `manual_validation_pending` blocked enquanto houver blocker aberto.
- `lacuna_resolvida`: fecha blocker do mesmo `subject`. Sem subject aberto → blocked.
- `renegociacao`: **não** destampa o §7. Retorna `{ token, status: "pending_user" }`. Token uso único, TTL 24h, preso ao `sprint_file_path` do run.

**Fatia 6 — `talos_consume_reseal`.** Args: `token`, `sprint_file_path`. Efeito: `Contrato status` → `draft`, `Selo` → pendente (mesmo procedimento que o interview já usa para reeditar). Segundo consume / token expirado / sprint errado → fail. Destampar **sem** token gasto → fail (fecha o “reabrir frouxo”). Interview continua sendo quem re-aprova e sela.

**Fatia 7 — `talos_slice_view`.** Args: `plan_path` e/ou `sprint_file_path`, `slice` opcional. Retorno JSON: `{ tasks, ac, evals, forbidden_scope, required_gates, invariants }`. Parser do disco; cache por mtime. **Validator não lê a view** — lê sprint/PLAN. Executor onda 2 passa a citar este verbo em vez de reler o sprint inteiro.

**Fatia 8 — `falseia_se`.** Campo YAML opcional string ≤200 em cada `AC-*` do §7.3. `talos_verify_sprint_file` aceita ausência; se presente, tem de ser string não vazia. Skill do validator: se o campo existe, julgar se o check citado no `proof_refs` falharia com aquela mutação; senão finding P2. **Zero regex no MCP.**

### Onda 3 — C1 e F

**Fatia 9 — `talos-sprint-pref`.** Skill nova, só orquestrador. Uma vez por sprint, **depois** da última slice em `pass`/`pass_with_observations` e **antes** de `talos_update_sprint_status`. Modelo herdado. Mandato = caça C1 do Guide (verde-mas-falso: teste sem red, legado no caminho). Não é validator, não é G8, não é por slice.

Fluxo: `lock_dispatch(start, phase=sprint_pref)` → subagente → mutação + `commit_state` (`role=pref`) → `lock_validator` (ciclo próprio, teto 1 repair, **não** conta no teto de 2 da slice) → então status sync. `policy_manifest.pref_required: true` obriga; ausente = skip. Default do template de sprint: `false` (opt-in) para não mudar comportamento dos packs atuais (DEC-009).

**Fatia 10 — F.** Sem skill nova. G8 `talos-slice-review` **é** o F. Orquestrador documenta: G8 não sai de execute/validator/pref inline; sessão nova e modelo à escolha quando `critical_review.required`. Código: não despachar review a partir das skills de execute/repair/pref (já proibido). Só texto do orquestrador + um DR05 (onda 3): essas skills não contêm `talos-slice-review` como alvo de dispatch.

---

## 8. Fluxo alvo

```text
orquestrador    lock_dispatch(start, phase=plan_execute)
                [grava base_sha = HEAD]
       │
       ▼
executor        first_write?  → baseline   (se for mutar)
                implementa + gates locais
                talos_commit_state(proofs, …)
                return { validator_handoff_required, state_path }
       │
       ▼
orquestrador    lock_validator(start)  [sha == commit MCP]
                sibling talos-task-validator
       │
       ├── fail → repair_start → findings-repair
       │          talos_commit_state (role=repair, repair[])
       │          repair_complete → 2º validator (teto da slice)
       └── pass|pass_with_observations → fecha slice

(sprint-bound, última slice, pref_required)
orquestrador    sprint_pref → commit_state role=pref → validator (teto 1)
                [sessão nova] G8 se critical_review
                talos_update_sprint_status
```

---

## 9. Compatibilidade

- Disco: v3 canônico. Consumidores que só lêem o JSON não quebram.
- Procedimento: breaking na onda 1 (0.18.x). Skills velhas que Write + `state_path_created` falham G12 e DR*.
- `talos_run_state` upsert segue só para ledger da run. Commit de slice não passa por upsert.
- `prd_path` legado `null`.

---

## 10. Testes de contrato

Onda 1: commit projeta mapas; AC T-outcome sem proof → blocked; `eval_na` não vira `passed`; payload com `acceptance_results` → `-32602`; diff sujo sem `first_write` → blocked; diff vazio sem `first_write` → passed; repair sem slot → blocked; repair preserva baseline; SHA órfão → `lock_validator` blocked; DR01–04 no guard; fixtures de status/oráculo inalteradas contra JSON gerado pelo writer.

Onda 2: lacuna bloqueia `done`; reseal 2× → fail; view omite prosa; `falseia_se` ausente é válido.

Onda 3: sem `pref_required` o orquestrador não despacha pref; com flag, status sync antes do pref → blocked.

---

## 11. Fora de escopo (permanente neste programa)

- Repo do Guide.
- `talos_capture_cmd` / receipts.md / JOURNAL.md / GUIDE.md / packguide Python.
- Validator virar script puro.
- Relatório humano no state.
- Dual-writer.
- Schema v4.
- Pref default-on (quebraria sprints atuais).

---

## 12. Riscos (mitigação já no contrato)

- MCP writer único → write atômico + testes de snapshot existentes.
- View incompleta → validator ignora view.
- `falseia_se` regex → proibido; só validator LLM.
- Pref por slice → contrato diz uma vez por sprint + opt-in.

---

## 13. Decisões

| ID | Decisão |
|----|---------|
| B1 | Writer = MCP. LLM: `proofs[]`, `eval_na`, `first_write`, `repair[]`, `obligation_ids` (direct) |
| B2 | Disco v3 projetado; sem v4 |
| B3 | Não importar receipts/JOURNAL/GUIDE.md |
| B4 | G12 executor = `first_write` + `commit_state`; lock start não é heartbeat de executor |
| B5 | C1/F = onda 3; C1 opt-in `pref_required`; F = G8 em sessão nova |
| B6 | Só orquestrador despacha; skill nunca puxa skill |
| B7 | Onda 1: hard-fail de Write órfão. Sem dual-writer |
| B8 | Repair/pref usam o mesmo `talos_commit_state`; role inferida pelo lock |
| B9 | `covers` opcional; `files` opcional; sem files → `proof_refs.files = []` |
| B10 | Bootstrap: `first_write` **ou** `commit_state` em 120s |
| B11 | Honor system do `check` aceito; sem capture-cmd |
| B12 | Re-selo = evento + `talos_consume_reseal` (token 1×); interview re-aprova |

Nada em aberto para implementar as três ondas. Próximo passo: plano de implementação da **onda 1** (ondas 2–3 têm contrato aqui, plano próprio na hora).
