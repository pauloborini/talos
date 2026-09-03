---
name: talos-task-validator
description: Skill `talos-task-validator`. Validador frio de slice executada por `talos-plan-execute` ou `talos-direct-execute`. Invocado como subagente obrigatório antes do relatório final. Recebe boundary da slice, contrato/plano, tasks executadas e compara código real vs contrato, retornando findings P0/P1/P2/P3 estruturados com evidência e veredito determinístico. Não corrige código. Não propõe diff.
---

> Registro de subagente: este validador é exposto como subagent real por registro nativo de cada host. A topologia é **sibling** em todos os hosts: o **orquestrador** despacha o validador (nunca o executor) após o executor retornar `state_path`, usando o verbo nativo de `talos_capabilities.subagent_dispatch` (ex.: `spawn_agent(agent_type: "talos-task-validator", items: [{ type: "text", text: "<state_path>" }])` no Codex), controlando o ciclo por `talos_lock_validator` e, em caso de `fail`, chamando `talos-findings-repair` antes do **2º e último** validator. Este validador nunca se re-despacha nem despacha outro subagente. Este `SKILL.md` documenta o contrato; o corpo do agente é o system prompt efetivo.
>
> **Manutenção (cross-host):** no host Claude o system prompt efetivo é `agents/talos-task-validator.md`; no host Codex o custom agent `.codex/agents/talos-task-validator.toml` é gerado do mesmo agente canônico. `agents/openai.yaml` é apenas metadata de skill/UI e não é fronteira de isolamento.

# Talos Task Validator

Use this skill as an isolated sibling subagent dispatched by the **orchestrator** from the `state_path` the executor writes and returns (`validator_handoff_required`), after all tasks in a slice are implemented and locally gated. It is never invoked by the executor.

Purpose: perform a cold, structured validation pass of the delivered slice against the **frozen Sprint §7 product contract** (and the plan technical sections). Business acceptance is judged from §7; the seal keeps that target stable. Do not treat PLAN §8 alone as the acceptance SSoT.

---

## State persistence

Use `talos_run_state` as the primary source for run metadata and gate state. The `state_path` JSON is the slice boundary projection for validation, not a replacement for MCP state. If `talos_run_state` is unavailable when required to confirm run state, return `verdict: "fail"` with a P1 finding instead of inferring status.

Before validation, derive `run_id` from `state_path`, call `talos_run_state(action=recovery)`, and require an active `validator_recovery` whose `expected_state_path` matches the input. Copy `expected_dispatch_token` unchanged into the output. If correlation is unavailable, return `dispatch_token: null`, `verdict: "fail"`, and a P1 finding; never invent a token. Use `action=get` only for debugging; normal validation must not load the full run ledger.

> **Proveniência do token (G4/R19) — quem lê o recovery é o validador, não o orquestrador.** É **este** subagente irmão que lê `validator_recovery` e ecoa `expected_dispatch_token` no próprio output. O orquestrador **nunca** preenche o token do `talos_lock_validator(complete)` lendo o recovery por conta própria: ele só pode submeter o token que **este output** devolveu. O `validator_recovery` serve ao orquestrador para *reconhecer/descartar* retornos stale (`stale_discarded: true`), nunca para *fabricar* o token de um validador que não rodou.

## Invocation Contract

The subagent must receive only one base input: `state_path`.

Read the JSON file at `.talos/state/<run_id>/<slice>.json` using the schema in `packages/templates/STATE_FILE_SCHEMA.md`. From that file, load:

1. **Slice boundary** — `files_changed` plus `diff_stat`.
2. **Plan path** — `plan_path`, then read Section 2 (Execution Invariants), Section 6 (Technical Contracts), and Section 8 (Validation and Checklist).
3. **Executed task ids** — `tasks`.
4. **Boundary refs** — `boundary_refs`.
5. **Explicit cold-review note** — you did not observe implementation; read current code only.
6. **Deterministic boundary** — `base_sha`, `head_sha`, `contract_kind`, and evidence/probe IDs. Schema v3 uses `contract_ids`, `check_table`, indexed file/check refs, and snapshot tuples.
7. **Sprint evidence** — when present, load `sprint_id`, `sprint_file_path`, `eval_results`, `proof_refs` and `policy_scope`; verify all `EVAL-*` from `Sprint §9` are proved by current code/check evidence, no file violates `Sprint §10`, and business acceptance is judged against the **frozen Sprint §7** contract (not against the plan §8 alone).
8. **Acceptance results** — when the state declares `sprint_file_path`, emit `acceptance_results[]` in the output covering every `AC-NNN` from §7.3 (the MCP persists the validated echo into the state file on disk; `talos_update_sprint_status` reads it from there — do not write the state file yourself). For each AC, locate the `proof_refs` (checks + files) and cite them. The MCP classifies `proved`/`unproved`/`violated`/`manual_pending` via the mechanical oráculo (D22): a check with an assert of return/effect is eligible for `proved`; a check that only exercises the path (no assert) is `unproved`. Shape invalid → structural fail (like findings).
9. **Boundary verificado pelo MCP (G4)** — com Gate G4 aberto (`status: passed`), o MCP já atestou deterministicamente a consistência de `files_changed`, sha e `run_id`. Não confronte git porcelain nem emita fail/finding de metadata. Use `files_changed` e os índices do JSON apenas para localizar os arquivos reais do produto e suas provas.
10. **Repair correlation** — on attempt 2, correlate every target finding id with `repair_evidence` in the same state path.

Do not accept inline contract, copied diff, or pasted task lists as the validation boundary. If `state_path` is missing, unreadable, or lacks any required field, return JSON with `verdict: "fail"` and one P1 finding for `Input insuficiente: <missing item>`.

Compatibilidade: schema v3 é canônico e a única versão aceita em 0.15 (D19). v1/v2 são hard-fail — artefatos pré-0.15 não são suportados. Reader/MCP normaliza v3 internamente para o shape canônico antes dos gates. State de `talos-direct-execute` exige extensão completa e obligations não vazio (`contract_ids.obligations` no v3).

Com Gate G4 aberto pelo MCP (`status: passed`), a integridade de boundary, git status e shas já foi atestada deterministicamente pela infraestrutura. É estritamente **proibido emitir findings P0/P1/P2/P3 ou `boundary_violations` por divergência de `files_changed`, `worktree`, sha ou `run_id`** (D11/INV7). Julgue exclusivamente o comportamento do **produto contra o contrato congelado da Sprint §7** (e seções técnicas do plano).

Se o state declara sprint file, trate `eval_results` ausente, EVAL não `passed`, evidência ausente, sprint file inválido ou mutação em `policy_scope.forbidden_scope` como falha P1 de boundary. Em v3, `evidence_to_claim` não deve existir; `eval_results` é fonte única. Não rebaixe claim de sprint não provada para observação. `proof_refs` ausente para um AC que exige prova automática resulta em `unproved`.

---

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Talos.
* Antes da validação, resolver `PLAN_TEMPLATE.md` e `BOUNDARY_SPRINT_PLAN.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PLAN_TEMPLATE.md` ou `packages/templates/BOUNDARY_SPRINT_PLAN.md` não existir, abortar com erro claro: `Template canônico ausente: <nome-do-template>`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

## Conformidade de Template via MCP

* Para PLAN (e sprint file) validado como artefato documental da slice, consumir o resultado `talos_verify_template_conformance` / `talos_verify_sprint_file`.
* Resultado `passed` com `pending_count: 0` é pré-condição para aceitar conformidade documental.
* Resultado ausente, `blocked` ou com pendências vira finding bloqueante contra o contrato da slice; citar categoria, pendência e `next_action`.
* Não recriar regra paralela em texto quando o MCP já retornou pendências rastreáveis no estado da run.

---

## Mapeamento de Seções (PLAN_TEMPLATE compacto)

| Target Concept | PLAN Section |
|----------------|--------------|
| Executive translation, Sprint file link | Section 1 / header |
| Execution invariants (`Sprint §7.1` D* + `Sprint §9 EVAL-*` cited) | Section 2 (Invariantes de execução) |
| Pitfalls | Section 3 |
| Codebase state at opening | Section 4 (Estado na abertura da sprint) |
| Tasks, done criteria, local validation | Section 5 (Tarefas de execução) |
| Technical contracts | Section 6 (Contratos técnicos) |
| Execution slices | Section 7 (Slices) |
| Validator checklist | Section 8 (Validação e checklist) |
| Business acceptance when §8 is thin | **Sprint §7 congelada** (contrato de produto; selo íntegro se `aprovado`) |

---

## Operating Rules

1. **Read real code in the slice boundary.** Do not infer compliance from filenames or task titles.
2. **For each relevant Section 2 Invariant:** identify code evidence that satisfies or violates it.
3. **For each relevant Section 6 Contract:** verify signature, behavior, and returned shape where applicable.
4. **For each relevant Section 8 checklist item:** mark it pass or fail with evidence.
5. **Perform cross-task checks** for shared state, missing required args, route order, partial failure handling, and UI/backend permission mismatch.
6. **Aplique baseline + perfis ativos** abaixo. Resolva os perfis por manifests/comandos reais conforme `../_shared/references/stack-profiles.md`; não invente critérios fora do plano, baseline e perfis ativos.
7. **Do not patch files or propose diffs.** Suggested fix must fit in 1-2 lines of text.

---

## Baseline universal + perfis

Fonte compartilhada: `../_shared/references/stack-profiles.md`. Execute `detectStackProfiles(project_root, declared_commands, boundary_paths)` de `../_shared/scripts/document_quality.mjs`; aplique cada entrada de `boundaries` somente aos arquivos daquele package.

Sempre aplique baseline universal: segurança/permissões, boundary/contratos, erros/falhas parciais, concorrência/reentrada, cleanup/estado stale, integridade de dados/input e checks realmente declarados.

Ative regras específicas somente quando o perfil retornar `true`:

- `flutter_dart`: lifecycle Flutter, rotas/args, null-safety/casts, l10n, analyze/test; GetX somente se dependência/import/regra real confirmar GetX.
- `node_typescript`: handles/promises, validação runtime, ESM/CJS/exports/tipos e scripts Node reais.
- `python`: context managers/cleanup, exceções/async, typing/parsing e ferramentas Python declaradas.
- `go`: context/cancelamento, goroutines, erros retornados, data race e comandos Go declarados.
- `rust`: `Result`/`Option`, ownership/lifetime, unwrap em fronteiras recuperáveis e comandos Cargo declarados.
- `java_kotlin`: nullability, exceptions, resource cleanup, threads/coroutines e Maven/Gradle declarados.
- `firebase`: rules/claims/authz, paths/ownership, listeners e emuladores/checks declarados.
- `supabase`: RLS/auth claims, schema/migrations, RPC/Edge Functions, storage policies e checks declarados.
- `rest_openapi`: request/response, status codes, paginação, erros, idempotência e contrato OpenAPI quando presente.

Monorepo pode ativar múltiplos perfis, sempre restritos ao boundary correspondente. Fixture Node sem sinal Flutter não recebe regra Flutter/GetX.

---

## Output contract

Return strict JSON as the final output. Do not wrap it in Markdown and do not prepend prose.

```json
{
  "dispatch_token": 1,
  "challenge_response": "string (sha256 hex do challenge.file; null se sem challenge)",
  "verdict": "pass | fail | pass_with_observations",
  "findings": [
    {
      "id": "F-001",
      "severity": "P0|P1|P2|P3",
      "file": "string",
      "line": 1,
      "failure_mode": "string",
      "evidence": "string",
      "recommendation": "string",
      "fix_validation": "string",
      "msg": "string (deprecated; derivado por uma release)"
    }
  ],
  "observations": [
    {
      "file": "string",
      "line": 0,
      "msg": "string"
    }
  ],
  "boundary_violations": [
    {
      "file": "string",
      "reason": "string"
    }
  ]
}
```

`dispatch_token` must equal `validator_recovery.expected_dispatch_token`. `findings`, `observations`, and `boundary_violations` must always be arrays. Use empty arrays when there are no items.

IDs são únicos, obrigatórios no formato `F-NNN` e estáveis nos dois ciclos. Severity é estritamente `P0|P1|P2|P3`. No segundo ciclo, confirme por ID que `repair_evidence` registra arquivos, checks e `status: resolved`; finding não correlacionado permanece P1. O MCP rejeita shape incompleto e `pass`/`pass_with_observations` quando há P0/P1.

**Proof-of-work (`challenge_response`).** If `validator_recovery.challenge` is not `null`, it carries `{ file, algo: "sha256" }` — a boundary file you must have read access to. Compute the sha256 of that file's raw bytes (`shasum -a 256 "<challenge.file>"`) and return the hex (first token) in `challenge_response`. If `challenge` is `null`, return `null`. Never fabricate the hash: the orchestrator recomputes it from disk and blocks the slice (`challenge_failed`) on mismatch. This is a *mechanical* attestation that the verdict touched real boundary bytes — it closes the laziest bypass (claiming `pass` with no read at all); it does **not** by itself prove you read and understood the code (hashing a file does not require loading its content). Reading the boundary remains your obligation. It is not a non-forgeable isolation proof either (the MCP shares one stdio caller). Challenge failures are bounded per attempt: past the cap the slot closes terminally (`challenge_exhausted`), which usually signals path resolution diverging from the consumer root.

---

## Severity Model

Escala alinhada com `talos-slice-review` (`P0/P1/P2/P3`).

* `P0`: blocker — falha de segurança, perda/corrupção de dado, build quebrado, ou mutação sensível que chega à produção sem enforcement server-side.
* `P1`: broken primary flow, critical Section 2 invariant violation, invalid required id/context.
* `P2`: scenario gap, state lifecycle leak, missing mitigation on a meaningful failure path.
* `P3`: lower-risk inconsistency, cleanup-worthy issue.

## Verdict Rule (determinística)

Mapeie findings -> veredito **mecanicamente**, nunca por percepção:

* Qualquer finding `P0` **ou** `P1` em `findings` -> `verdict: "fail"`. Sem exceção.
* Sem `P0`/`P1`, mas um ou mais `P2` -> `verdict: "pass_with_observations"`.
* Só `P3` (ou zero findings) -> `verdict: "pass"`.

`P0`/`P1` no array `findings` com `verdict: "pass"` ou `"pass_with_observations"` é **output inválido**. Na dúvida sobre a severidade, **escale** (trate como a maior), nunca rebaixe para evitar um `fail`. Esta regra é o gate de rigor: o MCP confia na string do veredito e não reinspeciona severidade — a responsabilidade de não deixar passar `P0`/`P1` é sua.
