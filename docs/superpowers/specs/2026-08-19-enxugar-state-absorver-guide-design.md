# Brainstorm — Enxugar colo da LLM e absorver o Guide no Talos

- **Status:** rascunho de design (ainda não é `DEC-*`)
- **Data:** 2026-08-19
- **Repo:** Talos (`0.17.2`)
- **Não faz parte deste doc:** scriptar receipts do Guide (fica no repo do Guide)

Fontes desta sessão:

- [guide-pack-talos-absorcao.canvas.tsx](/Users/pauloborini/.cursor/projects/Users-pauloborini-Documents-projetos-talos/canvases/guide-pack-talos-absorcao.canvas.tsx)
- [talos-boilerplate-state.canvas.tsx](/Users/pauloborini/.cursor/projects/Users-pauloborini-Documents-projetos-talos/canvases/talos-boilerplate-state.canvas.tsx)

Este arquivo unifica os dois boards num único programa. Enxugar o colo da LLM e absorver o Guide são o mesmo movimento: **a LLM julga em slots curtos; o MCP grava forma, git e índices.**

---

## 1. Problema

O state v3 no disco já é compacto (IDs, paths, hashes, índices). O custo de token e de erro está no **procedimento**:

1. `talos-plan-execute` / `talos-direct-execute` colam o JSON inteiro do schema — inclusive `acceptance_results`, que o executor **não** escreve.
2. A LLM monta à mão `base_sha`, `head_sha`, `files_changed`, `diff_stat` e tuplas `worktree_*`. O MCP **já tem** `captureWorktreeSnapshot()`.
3. Quatro mapas repetem o mesmo fato: `task_evidence`, `validation_map`, `proof_refs`, `eval_results`.
4. Gate G12 exige **sete** events (`executor_started` … `state_path_created`). Só `state_path_created` trava o isolamento do validator (G12/G4). O resto é heartbeat.
5. `talos_run_state` é merge/upsert. A LLM ainda é writer do arquivo de slice. O padrão que funcionou no Guide (journal-append: LLM seta 2–3 campos; script preenche eid/de/data) **não existe** no Talos.

Absorver Guide “como pack” (GUIDE.md, JOURNAL.md, receipts.md, packguide Python) **aumentaria** o colo. O que vale é o padrão de escrita, o manifesto de transições, desvio tipado, drift de skill, e a topologia loop→subagente→pref→F (já quase espelhada em G4/G9).

---

## 2. Princípio (única regra de produto a promover depois)

> LLM envia julgamento referenciável. MCP deriva o resto. Skill cita ID de gate/verbo, não ensina a montar artefato.

Invariantes que **não** se negociam neste programa (já são `DEC-*`): sibling-only (DEC-012), PREREQ/DISPATCH fail-closed (DEC-004/008), contrato §7 + aceite atômico (DEC-013/014), plugin instalável (DEC-002/010/011). Cortar validator, oráculo T-outcome ou `state_path` único para poupar token é regressão, não enxugue.

---

## 3. Abordagens consideradas

| | Abordagem | Prós | Contras |
|---|-----------|------|---------|
| **A (escolhida)** | Verbo MCP `talos_commit_state` + `proofs[]` curto; state v3 vira **projeção** escrita pelo MCP; skills perdem o blob JSON; G12 cai para 2 pulsos; eventos de desvio e view de slice entram como fatias seguintes no mesmo MCP | Sem breaking de reader se o MCP ainda emitir v3 canônico; reusa snapshot git já existente; um contrato para enxugue **e** absorção | Precisa de writer único no MCP; skills e hosts/ copiados precisam deixar de ensinar Write no path do state |
| B | Trocar state por log de eventos estilo JOURNAL (append-only) e o validator lê o log | Mais “Guide”; auditoria temporal | Breaking de schema; validator e `talos_update_sprint_status` hoje leem objeto único; custo alto para o mesmo ganho |
| C | Só enxugar prosa das skills; LLM continua Write no JSON | Patch pequeno | Não mata SHA/índice/exemplo errado; o blob volta a crescer |

**Decisão deste brainstorm:** A. Schema v3 **permanece** o formato em disco e o contrato do validator. Quem muda é o **writer** (MCP, não LLM). Readers legado de v3 não precisam de v4 se o shape canônico for o mesmo.

Não há v4 neste programa, a menos que `proofs[]` no arquivo se mostre mais barato que projetar os quatro mapas. Default: MCP recebe `proofs[]` e **grava** os mapas v3 atuais, para `talos_lock_validator` / oráculo / status não mudarem de contrato.

---

## 4. Contrato fino — o que a LLM ainda envia

### 4.1 `talos_commit_state` (P0)

Entrada (julgamento):

```json
{
  "run_id": "<já no lock>",
  "slice": "<id>",
  "proofs": [
    { "id": "AC-001", "kind": "AC", "check": "node --test tests/foo.test.js" },
    { "id": "EVAL-001", "kind": "EVAL", "check": "node --test tests/foo.test.js" },
    { "id": "T01", "kind": "T", "check": "node --test tests/foo.test.js" }
  ],
  "eval_na": [{ "id": "EVAL-002", "reason": "not_in_slice" }]
}
```

Regras:

- `check` é a **string do comando já executado** nesta slice. MCP deduplica em `check_table` e preenche índices.
- `kind` fechado: `AC` | `EVAL` | `T`. Um AC sem `kind: AC` e sem `eval_na` correspondente, quando o sprint file está no run, falha fechado (mesmo espírito de `proof_refs` ausente → `unproved`).
- `direct` (sem plano): o run lock já tem obligations; se não tiver, o commit falha. LLM **não** recola texto de invariante.
- MCP preenche: `state_schema_version`, `run_id`, `executed_at`, `executor_skill` (fase ativa), `plan_path` / `sprint_*` do run, `contract_ids` parseados do PLAN/§7, `policy_scope` do `policy_manifest`, `base_sha`/`head_sha`/`files_changed`/`diff_stat` via git, `worktree_final` agora, `worktree_baseline` do snapshot gravado no `first_write` (ou no `lock_dispatch(start)` se ainda não houve write — ver §5).
- MCP **não** aceita `acceptance_results` neste verbo. Continua eco do validator + persist no `complete`.
- Após gravar o arquivo, o MCP emite internamente o equivalente a `state_path_created` (o executor **não** manda o sétimo checkpoint à mão). Retorno: `{ state_path, gate: G12, ... }`.

Baseline: no **primeiro** `first_write` (ou num `talos_snapshot_worktree` único chamado pelo executor **antes** da primeira mutação, se `first_write` for implícito demais), o MCP grava `worktree_baseline` no run ledger. `commit_state` recaptura `worktree_final` e deriva `files_changed` = `base_sha...head_sha` + delta baseline→final, dirty pré-existente idêntico fora — **a mesma regra que o schema já documenta**, só que executada em Node.

### 4.2 Projeção dos quatro mapas

MCP deriva do `proofs[]`:

- `proof_refs[AC]` ← proofs `kind=AC`
- `eval_results` ← proofs `kind=EVAL` (`status: passed` se o caller não mandou `eval_na`; `eval_na` vira evidência tipada, não `passed` forjado)
- `task_evidence` ← proofs `kind=T`
- `validation_map` ← cruzamento obligations do plano × checks dos proofs da slice (IDs do PLAN, não narrativa)

Se o parse do plano não achar uma obligation citada, commit falha com erro estrutural — não completa com array vazio silencioso.

### 4.3 Evento curto (absorção journal-append) — mesmo espírito, fatia seguinte

`talos_run_event` (verbo novo; **não** reusar `upsert` de `talos_run_state`, que já misturou merge parcial com replace):

```json
{ "kind": "descoberta|lacuna|renegociacao|note", "subject": "T01|AC-001|§7", "facts": "≤200 chars" }
```

MCP infere: ator (fase do lock), `at`, id monotônico, hash. Proibido: LLM setar `de`, `at`, `eid`. `lacuna` e `renegociacao` bloqueiam promoção de sprint até token de re-selo consumido (absorção CONTRACT.lock uso único). `descoberta` só registra.

Isto **não** substitui o state de slice. É ledger da run, como o journal do Guide.

---

## 5. G12 — dois pulsos

Set atual (7): `executor_started`, `skill_loaded`, `plan_loaded`, `handoff_accepted`, `task_started`, `first_write`, `state_path_created`.

Set alvo (2 + implícitos):

| Pulso | Quem emite | Função |
|-------|------------|--------|
| `lock_dispatch(start)` | orquestrador (já existe) | prova que o executor foi despachado; substitui `executor_started` / `skill_loaded` / `plan_loaded` / `handoff_accepted` / `task_started` como teatro |
| `first_write` | executor, **uma vez**, imediatamente antes da primeira mutação **ou** MCP detecta via snapshot vazio→não-vazio se quisermos zero calls — **decisão: executor chama uma vez**. Motivo: detecção por git no MCP sem chamada ainda não existe e misturaria liveness com side-effect | grava `worktree_baseline`; prova mutação iminente |
| `talos_commit_state` | executor no fim | grava state + equivale a `state_path_created` |

Timeouts G12 (`bootstrap` / `progress`) **permanecem**. Ausência de `first_write` até o bootstrap deadline com fase execute ativa continua `stalled`. Não reintroduzir os cinco events removidos nas skills (ver §7 drift).

---

## 6. Skills e hosts — menos blob, mesmo gate

Depois do verbo existir:

- `talos-plan-execute` e `talos-direct-execute` **deletam** o exemplo JSON de 30 linhas e a ordem de campos do schema. Citam: `first_write` → implementar → `talos_commit_state(proofs)` → `validator_handoff_required` com o `state_path` do retorno.
- Proibido nas skills (e em `hosts/**` copiados): “crie `.talos/state/...` com Write”; “preencha worktree_baseline”; listar `acceptance_results` no bloco do executor.
- `STATE_FILE_SCHEMA.md` vira contrato **do MCP/validator**, não material de executor. Executor não é instruído a abrir esse arquivo.
- Orquestrador: o handoff continua só `state_path`. Sem colar proofs na mensagem do validator.

Isso é a absorção de `drift_forbidden` do Guide: `build/check-consistency.mjs` ganha regras DR* contra strings âncora nas skills (equivalente a DR08 do journal: skill não ensina heading de tabela / Write de state).

---

## 7. O que absorver do Guide (depois do writer MCP)

Ordem **depois** de `commit_state` estável — senão cada fatia nova ensina a LLM a preencher mais um artefato.

| # | Fatia | Origem Guide | Contrato mínimo no Talos |
|---|--------|--------------|---------------------------|
| 1 | `talos_commit_state` + snapshot git | journal-append / `--git-boundary` | §4.1 |
| 2 | Mapas v3 projetados de `proofs[]` | LEDGER como projeção | §4.2 |
| 3 | G12 7→2 + skills sem blob | menos procedimento | §5–6 |
| 4 | DR* em `check-consistency` | `canon.drift_forbidden` | skill/host que ensinar Write de state ou checkpoint morto falha o guard |
| 5 | `talos_run_event` + classes de desvio | J07 descoberta/lacuna/renegociação | §4.3 |
| 6 | Token de re-selo uso único | CONTRACT.lock | reabrir §7 `aprovado` exige evento `renegociacao` aprovado e token não gasto; segundo uso falha |
| 7 | View compilada da slice | compile/view do plano | MCP devolve `{tasks, AC, EVAL, forbidden_scope, gates}` para o executor **não** reler o sprint inteiro |
| 8 | `falseia_se` no YAML do AC | AC do Guide | campo opcional no §7.3; validator confronta se o check nomeado no proof **mencionaria** a mutação (julgamento LLM no validator, não regex no MCP) |
| 9 | Fase C1 sibling no **fim da sprint** | pref-guide | 1 subagente mutável, modelo herdado, **não** por slice, **não** é validator, **não** é F. Orquestrador despacha. Skills não se chamam. |
| 10 | Fechamento F = sessão nova | audit-guide-plan | `talos-slice-review` / fechamento humano com modelo à escolha. Fora do loop de execute. Já quase é G8; documentar o mapeamento, não criar skill-in-skill |

**Não absorver:** GUIDE.md como input de execute; packguide Python; JOURNAL.md / receipts.md como SSoT; executor promover sprint a `done`; pref ou F inline.

---

## 8. Fluxo alvo (uma slice)

```text
orquestrador  lock_dispatch(start, phase=plan_execute)
       │
       ▼
executor      (lê view MCP da slice, quando fatia 7 existir; senão PLAN path)
              first_write  → MCP snapshot baseline
              implementa + gates locais (lint/test) — inalterado
              talos_commit_state(proofs) → arquivo v3 + G12 committed
              return validator_handoff_required { state_path }
       │
       ▼
orquestrador  lock_validator(start) → sibling talos-task-validator
              (lê state_path; ecoa acceptance_results; challenge inalterado)
       │
       ├── fail → findings-repair (mesmo state_path) → 2º validator (teto atual)
       └── pass|pass_with_observations → fecha slice
```

Fim de **sprint** (não de slice), se 9–10 estiverem no backlog da release: C1 uma vez; F sessão nova. Não misturar C1 no executor da slice.

---

## 9. Compatibilidade e breaking

- **Não breaking de artefato de consumidor** se o arquivo em `.talos/state/...` continuar v3 canônico. Executores velhos que ainda dão Write no JSON: durante uma janela, o MCP **aceita** o arquivo existente no `state_path_created` **ou** rejeita Write detectando que o conteúdo não passou por `commit_state`?
- **Decisão:** a partir da versão que introduzir o verbo, `state_path_created` **sem** commit MCP (arquivo órfão escrito pela LLM) é **hard-fail** G12. Não há reader v3 paralelo. Isso é breaking de **procedimento de skill**, não de schema. Bump menor (0.18.x) se só skills+MCP; bump consciente se hosts documentados ensinarem o fluxo velho — o guard DR* deve falhar o pack **antes** do release.
- `talos_run_state` upsert permanece para ledger da run. Não misturar upsert cego com commit de slice (já houve bug de replace apagar `data`).
- `prd_path` continua legado `null`; writers novos não o enviam.

---

## 10. Testes (contrato, não lista de arquivos)

- Commit com `proofs` → disco tem `proof_refs` / `eval_results` / `task_evidence` coerentes com `check_table` indexado.
- Commit sem proof de AC obrigatório do §7.3 → erro; validator nem abre.
- Snapshot: dirty pré-existente idêntico não entra em `files_changed`; mutação depois do baseline entra.
- Executor payload com `acceptance_results` → rejeitado.
- G12: `lock_validator(start)` só abre depois de `commit_state` para aquele `state_path`.
- Skill `talos-plan-execute` contendo a string âncora `worktree_baseline` como instrução de Write → `check-consistency` falha (depois da fatia DR*).
- Re-selo: segundo consume do mesmo token → fail.
- Regressão: `talos_update_sprint_status` / oráculo T-outcome inalterados contra fixtures v3 geradas pelo novo writer.

---

## 11. Critério de pronto (desta iniciativa, não de uma fatia)

Uma slice real no host: executor **não** abre `STATE_FILE_SCHEMA.md`, **não** escreve o JSON com editor, chama `first_write` + `commit_state`, validator sibling passa, `claude plugin validate ./ --strict` + `check-consistency` verdes. Contagem de checkpoints G12 por execute = 1 (`first_write`) + 1 verbo de commit. Skills de execute sem blob JSON.

Fatias 5–10 podem ficar no backlog/sprint seguinte; **não** entram no mesmo plano de implementação que 1–4 se o plano passar de um PR revisável.

---

## 12. Fora de escopo

- Qualquer mudança no repo do Guide (receipts JSON, `--render-receipt`).
- C1/F no mesmo PR que `commit_state`.
- Substituir `talos-task-validator` por script puro.
- Markdown de relatório humano no state.
- Alterar branch / hosts packaging além do necessário para o verbo MCP e o texto das skills canônicas (`packages/` + guard que replica).

---

## 13. Riscos

- **MCP como writer único** vira SPOF de boundary. Mitigação: testes de snapshot já existentes + fixtures de commit; falha de git no consumer_root = commit blocked, não JSON parcial.
- **View da slice (fatia 7)** pode omitir invariante. Mitigação: view é cache; validator continua lendo sprint/PLAN do disco, não da view.
- **`falseia_se` (fatia 8)** se virar regex no MCP → falso positivo. Mitigação: campo documental + julgamento no validator, nunca gate de string no MCP.
- **C1 mutável no fim da sprint** se despachado por slice → custo e reescrita. Mitigação: uma vez por sprint, orquestrador only.

---

## 14. Decisões já tomadas nesta sessão (Origem: conversa)

| ID | Decisão |
|----|---------|
| B1 | Writer do state = MCP; LLM só `proofs[]` (+ `eval_na` / `first_write`) |
| B2 | Disco permanece schema v3 projetado; sem v4 neste programa |
| B3 | Não importar receipts/JOURNAL/GUIDE.md para o Talos |
| B4 | G12 efetivo = `first_write` + `commit_state`; lock start cobre entrada |
| B5 | Pref/C1 e F são topologia de sprint/sessão, não de slice, e não são P0 |
| B6 | Orquestrador despacha; skill nunca puxa skill |

Pergunta em aberto **única** que o plano de implementação ainda precisa do usuário (o resto está fechado neste brainstorm):

> O hard-fail de “LLM Write no state” entra na **mesma** release que `talos_commit_state`, ou há uma versão de transição em que os dois writers coexistam?

Recomendação: **mesma release**, fail-closed, skills atualizadas no mesmo bump. Transição dupla-writer reensina o blob.
