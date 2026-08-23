# Relatório — Gap estrutural: promoção a `done` com ACs `unproved` (waiver sem caminho canônico)

- **Data:** 2026-08-21
- **Projeto onde o gap se manifestou:** `ekklesia` (backlog Talos `BACKLOG_MESTRE_residual_quase`, sprints S05–S07)
- **Plugin instalado no host:** talos `0.17.1` (cache ZCode); **repo-fonte:** HEAD `0.17.2` (branch `docs/enxugar-state-absorver-guide-design`)
- **Arquivos centrais:** `packages/mcp-server/server.js` (fonte) / `packages/orchestrator/skills/talos/SKILL.md`
- **Natureza:** defeito de design (beco sem saída na FSM), não bug de execução. Correção a implementar no MCP + skills (requisitos na §5).

---

## 1. Resumo executivo

O pipeline Talos (orquestrador → plan-handoff → plan-execute → task-validator → update_sprint_status) funciona de ponta a ponta **enquanto os ACs podem ser provados por máquina ou declaram `manual` no §7.3**. Porém, quando o **projeto cliente proíbe criação/execução de testes automatizados sem pedido explícito** (regra operacional do ekklesia: `project-rules/rules/operational_rules.md` §Testes), o executor só produz gates estáticos (grep/analyze, sem `assert`), o oráculo classifica os ACs como `unproved`, e **a FSM não tem nenhuma saída canônica**: nem `done` (exige todos `proved`), nem `manual_validation_pending` (exige zero `unproved`), nem relatório MV (rejeita itens de AC sem `manual` declarado no §7.3 congelado — "item fantasma").

Resultado nas sprints S06 e S07 do ekklesia: o fechamento só ocorreu por **workaround** — edição manual da linha do backlog + waiver documental fora do pipeline — autorizado explicitamente pelo usuário a cada vez. O caminho improvisado não passa por gate MCP: sem ledger de promoção, sem `HANDOFF_*.md`, sem `handoff_path`, sem `talos-memory-promote` — e não está documentado em nenhuma skill (as skills, corretamente, mandam "nunca contornar o gate", mas o gate não tem saída).

A correção precisa tornar o waiver um **caminho canônico de primeira classe**: `review → manual_validation_pending → relatório MV cobrindo todos os ACs não-proved → talos_sync_manual_validation → done (com handoff)`, com consentimento explícito do usuário para cada waiver.

## 2. Cronologia dos fatos (ekklesia, backlog residual QUASE)

### S05 — donations (2026-08-21): caminho MV funcionou (contraste)

AC-004 **declarava `manual` no §7.3**; provas automáticas proved; oráculo emitiu `manual_pending`; relatório `MV-S05-AC-004` marcado `waived` (DEP-001: smoke exigia sessão autenticada); `talos_sync_manual_validation` promoveu `done` com handoff. **Prova de que o fluxo existe quando o contrato prevê manual.** Incidente lateral (não é o gap deste relatório): o `talos_lock_validator(complete)` travou com `invalid_finding_shape` — na época um bug de serialização de arrays JSON do cliente MCP do host; não se reproduziu depois (S04 em diante). O smoke waived foi registrado à mão no `MAPA_TESTES.md` (Parte H).

### S06 — church (2026-08-21): primeiro beco sem saída → workaround 1

- §7.3 congelado com **todos os 5 ACs `manual: null`** (contrato selado; alterar o §7.3 depois = `FROZEN_ACCEPTANCE_TAMPERED`).
- Regra do cliente proíbe criar/executar teste sem pedido → checks estáticos sem `assert` → oráculo: **5× `unproved`**.
- `manual_validation_pending` inalcançável (exige ≥1 `manual_pending` e **zero** `unproved` — ver §3.2); `done` bloqueado (exige todos `proved` — §3.1).
- Tentativa de fechar por relatório MV **duplamente travada**: (a) não há `manual_validation_pending` para o sync promover; (b) itens `MV-S06-AC-*` para ACs com `manual: null` são rejeitados como **item fantasma** (server.js:3068).
- **Workaround (autorizado explicitamente pelo usuário):** edição manual da linha S06 no backlog → `done`/`validator:pass`; waiver documental `.talos/manual-validation/BACKLOG_MESTRE_residual_quase_S06.md` (5 ACs waived); smokes pendentes no `MAPA_TESTES.md` (Parte I, SMOKE-S06-001/002). State permaneceu honesto com `unproved`.

### S07 — groups (2026-08-21, mesma sessão deste relatório): recorrência → workaround 2

- §7.3 com **AC-001 `manual: severity alta`** e AC-002/003/004 `manual: null` — caso misto.
- Executor produziu gates estáticos sem `assert` (regra do cliente) → oráculo: **4× `unproved`** (AC-001 com `M:pending` nos `proof_types`, mas status `unproved` — ver §3.0: `autoFail` domina o `manual`).
- Pipeline correto até o fim: G4 validator **pass** (attempt 1/2), G8 complete, status avançou `ready → doing → review`; slice-review in-pipeline: **0 findings**.
- Tentativa canônica registrada (2026-08-21T23:37:36Z, run `talos-full-s07-20260821`): `talos_update_sprint_status(status=done, validator_verdict=pass, gate_status=validator:pass)` → **blocked** com erro `update_sprint_status_precondition_failed` e pendências literais:
  - `state_path`: "Status done exige state_path como evidência." (`informar_state_path`)
  - `acceptance_results`: "Status done exige acceptance_results no state (todos AC proved; sem M/unproved/violated)." (`emitir_acceptance_results_no_state`)
- O `next_action` sugerido (`emitir_acceptance_results_no_state`) é **impossível de satisfazer** sob a política de testes do cliente — a prova automatizada não pode ser criada sem violar regra do projeto cliente.
- **Workaround (precedente S06, autorizado pelo usuário):** edição manual da linha S07 no backlog (`done`/`validator:pass`) + sprint file (§1/§12/§14/§16 com a quebra registrada) + waiver `.talos/manual-validation/BACKLOG_MESTRE_residual_quase_S07.md` (4 ACs waived) + `MAPA_TESTES.md` Parte J (SMOKE-S07-001/002 PENDENTE). State intocado (honesto com `unproved`).

## 3. Diagnóstico técnico — a cadeia de 5 travas

Todas as referências são do fonte `packages/mcp-server/server.js` (repo talos HEAD 0.17.2; o comportamento é o mesmo no 0.17.1 instalado).

### 3.0 Oráculo: `unproved` domina `manual` (server.js:4387–4470, `classifyAcceptanceResults`)

Regra de decisão (comentário D22/§5.4, ~4450–4462): alguma prova automática `unproved/absent` → status **`unproved`** (linha ~4455–4458, `autoFail`), **mesmo quando o AC declara `manual`** (M:pending só produz `manual_pending` se todas as provas automáticas estiverem proved/present). Como `T-outcome` só fica `proved` com `assert` em teste executável (`checkProvesOutcome`), projetos com política de evidência estática produzem `unproved` por construção — e `unproved` é o status que trava tudo abaixo.

### 3.1 `done` exige todos `proved` (server.js:2655, 2665)

"Status done exige acceptance_results no state (**todos AC proved; sem M/unproved/violated**)" — qualquer `unproved` bloqueia, com `next_action=resolver_aceite_ou_avancar_manual_validation_pending` (o próprio MCP aponta o caminho alternativo… que a trava 3.2 fecha).

### 3.2 `manual_validation_pending` exige zero `unproved` (server.js:2677–2697)

"Status manual_validation_pending exige acceptance_results no state (**≥1 AC manual_pending, sem unproved/violated**)" (2677) — `unproved` bloqueia a entrada (2687) e ainda exige ≥1 `manual_pending` (2691–2697), que o oráculo nunca emite no cenário 3.0.

### 3.3 Relatório MV rejeita AC sem `manual` no §7.3 — "item fantasma" (server.js:3037–3068)

"Item fantasma: `MV-<sprint>-<ac>` **sem AC.manual correspondente no §7.3**" → `fix_manual_validation_report`. Ou seja: mesmo relaxando 3.2, o relatório MV **não pode cobrir** os ACs `unproved` cujo contrato congelado declarou `manual: null`. Como o §7.3 é selado (alteração posterior = `FROZEN_ACCEPTANCE_TAMPERED`), o contrato não pode ser "consertado" depois para declarar manual retroativamente.

### 3.4 Sync só promove a partir de `manual_validation_pending` (server.js:3309–3345)

`canPromote = plan.backlogRow.state === 'manual_validation_pending' && plan.gateVerdict` — com 3.2 fechando a entrada, todo o mecanismo de waiver (D24, relatório append-only, `MANUAL_VALIDATION_STATE_MAP`, promoção `done` com handoff, `failed → blocked`) fica **inalcançável**.

### 3.5 Skills não documentam o caso (orchestrator `SKILL.md:218, 230, 246`)

O gate `SPRINT_STATUS_SYNC` e o passo de output documentam apenas: `done` (todos proved) e `manual_validation_pending` (≥1 `manual_pending`), com "nunca contornar o gate". **Não existe orientação para o caso "ACs `unproved` por política de evidência estática + validator pass + review limpa"** — o agente fica entre violar a skill (contornar) ou deixar a sprint presa em `review` para sempre. Foi o que forçou a improvisação nas S06/S07.

### Síntese do beco

```
checks estáticos (sem assert, por regra do cliente)
  → oráculo: unproved (3.0)
    → done bloqueado (3.1)
    → manual_validation_pending bloqueado (3.2)
    → relatório MV não pode cobrir o AC (3.3)
    → sync não tem de onde promover (3.4)
    → skill não prevê o caso (3.5)
      ⇒ única saída encontrada: edição manual do backlog (fora do pipeline)
```

## 4. Workaround aplicado e seus custos

**Mecânica (S06 e S07, idêntica):** edição manual da linha da sprint no backlog para `done`/`validator:pass`; atualização manual da sprint file (§1 status, §12 evidência, §14 gate de fechamento com a quebra registrada, §16 histórico); waiver documental em `.talos/manual-validation/<backlog-slug>_<sprint>.md` (fora do pipeline — nunca lido/validado pelo MCP); smokes humanos pendentes em `.app-work/testes/MAPA_TESTES.md`.

**Custos:**

1. **Sem handoff:** o `done` canônico emite `HANDOFF_*.md` e retorna `handoff_path` (habilita `$talos-memory-promote`); o done manual não emite nada — S06 e S07 ficaram sem handoff e sem memory-promote.
2. **Sem ledger FSM:** a promoção não passa por `talos_update_sprint_status` — sem rastro no run state, sem banner, sem validação de consistência (a edição manual é apenas texto numa tabela markdown).
3. **Documentação duplicada e manual:** waiver + MAPA_TESTES + §14/§16, tudo escrito à mão com risco de divergência de formato; o MCP não conhece o waiver.
4. **Estado permanentemente divergente:** o state file mantém `unproved` (honesto) enquanto o backlog diz `done` — qualquer auditoria futura do MCP sobre essas sprints vê inconsistência estrutural.
5. **Precedente humano repetível sem ferramenta:** a exceção virou prática (S06→S07) sustentada apenas por memória de sessão e boa vontade do agente.

## 5. Requisitos de correção (MCP + skills) — para implementar em sessão futura

**R1 — FSM/oráculo (server.js): tornar o waiver caminho canônico de primeira classe.**
Direção sugerida (alinhada a D22/D24 e ao mecanismo de sync existente — decisão fina cabe à sessão de implementação):
- **(a)** `manual_validation_pending` passa a aceitar `unproved` (desde que sem `violated`) quando: validator com veredito terminal `pass|pass_with_observations` **e** todos os ACs não-proved passarem a ser cobríveis pelo relatório MV — ou seja, a exigência "≥1 `manual_pending`, zero `unproved`" vira "zero `violated` + ≥1 AC não-proved (manual_pending ou unproved) a validar".
- **(b)** Item fantasma (3037–3068) passa a rejeitar apenas MV de **AC inexistente no §7.3** (não mais "AC sem `manual` declarado") — o relatório MV torna-se o veículo de waiver também para ACs `unproved` por política de evidência estática.
- **(c)** `done` via `talos_sync_manual_validation` permanece fail-closed: só promove quando **todos** os ACs não-proved estão `validated|waived` no relatório (comportamento atual de `closedByReport`, 3309–3345, preservado).
- **(d)** `waived` exige justificativa + autor explícito (o consentimento humano que hoje existe fora do pipeline — S06/S07 — entra no protocolo: campo `result/autor` já validado pelo sync).

**R2 — Mensagens/next_action honestos.**
Quando `done` bloquear por `unproved` (2655), o `next_action` deve apontar o caminho viável (relatório MV), não `emitir_acceptance_results_no_state` (impossível sob política de testes restritiva). O `resolver_aceite_ou_avancar_manual_validation_pending` de 2665 já aponta a direção — a FSM precisa torná-lo executável (R1a).

**R3 — Skills (orchestrator `SKILL.md` gates `SPRINT_STATUS_SYNC` + passo de fechamento; `talos-plan-execute`; `talos-task-validator`).**
Documentar o fluxo de exceção: projeto com política de evidência estática → oráculo emite `unproved` → após validator pass (+ slice-review quando §10 exigir), o orquestrador avança `review → manual_validation_pending` e cria o relatório MV cobrindo **todos** os ACs não-proved (IDs `MV-<sprint>-<ac>`); o usuário decide `validated|waived|failed`; `talos_sync_manual_validation` promove `done` **com handoff**. Registrar que waiver sem `manual` declarado no §7.3 é legítimo exatamente neste cenário, e proibir explicitamente a edição manual do backlog como caminho.

**R4 — Handoff no fechamento via waiver.**
`done` por sync MV deve emitir `HANDOFF_*.md`/`handoff_path` e habilitar `$talos-memory-promote` (paridade com done canônico; hoje o workaround perde isso).

**R5 — Testes no repo talos.**
Casos mínimos: (i) S05-like: AC com `manual` declarado, provas proved → `manual_pending` → sync → done (regressão do fluxo atual); (ii) S06-like: todos `manual: null` + `unproved` + validator pass → deve alcançar `manual_validation_pending` e fechar por waiver; (iii) S07-like: misto (1 manual + 3 null, todos unproved); (iv) item fantasma novo: MV para AC inexistente no §7.3 → `fix_manual_validation_report`; (v) fail-closed preservado: `violated`/`failed` → `blocked`; waiver sem justificativa → bloqueia.

**R6 — Migração/notes de versão.**
Bump de versão (repo está em 0.17.2; host com 0.17.1) + nota em `CHANGELOG.md` + atualização de `PATCH_PROCEDURE.md`/build se o empacotamento `plugins/talos/packages/mcp-server/server.js` for gerado.

## 6. Evidências

| Item | Referência |
|---|---|
| Run S07 | `talos-full-s07-20260821` (ekklesia) — G4 validator pass 2026-08-21T23:11:45Z; `update_sprint_status` blocked 23:37:36Z (`update_sprint_status_precondition_failed`) |
| State S07 (unproved honesto) | `ekklesia/.talos/state/talos-full-s07-20260821/S07_correcao_groups.json` (`acceptance_results` 4× `unproved`) |
| Sprint files | `ekklesia/.talos/backlog/sprints/SPRINT_S06_correcao_church.md` / `SPRINT_S07_correcao_groups.md` (§14/§16 registram a quebra) |
| Waivers fora do pipeline | `ekklesia/.talos/manual-validation/BACKLOG_MESTRE_residual_quase_S06.md` / `_S07.md` (S05: relatório no `BACKLOG_MESTRE_residual_quase.md`) |
| Smokes pendentes | `ekklesia/.app-work/testes/MAPA_TESTES.md` Partes H (S05), I (S06), J (S07) |
| Código (5 travas) | `server.js:4455` (autoFail→unproved), `:2655/2665` (done), `:2677/2687/2697` (manual_validation_pending), `:3037/3068` (item fantasma), `:3309–3345` (sync/canPromote) |
| Skills | `packages/orchestrator/skills/talos/SKILL.md:218` (SPRINT_STATUS_SYNC), `:230` (pós-validator), `:246` (output/MV) |
| Regra do cliente que origina o cenário | `ekklesia/project-rules/rules/operational_rules.md` §Testes — sem criar/executar teste sem pedido explícito |
