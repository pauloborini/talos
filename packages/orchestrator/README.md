# Talos Orchestrator

Orquestra pipelines completos de desenvolvimento de features no projeto Talos, automatizando a sequência de skills (backlog macro → sprint file §7 → planejamento → execução → validação fria → review) sob demanda.

## Quick Start

```bash
/talos full sprint "S05"
```

Pipeline completo executado automaticamente:
1. Resolve S05 no backlog e valida o sprint file vivo
2. Valida/matura o contrato §7 com `AC-*` (entrevista se necessário)
3. Cria plano com Eval/Policy por task (`require_sprint_file:true`)
4. Executa plano e grava state v3 com `eval_results`/`acceptance_results`/`policy_scope`
5. Despacha validator frio (nota contra §7 / oráculo T-outcome)
6. Review se `--review` ou `critical_review.required:true` (G8 — antes do fechamento de status)
7. Fecha status: `done` (todos `AC-*` proved, sem M) ou `manual_validation_pending` (M aberto; satisfaz DEP; sem handoff)

## Sintaxe

```
/talos <mode> <input-type> [flags]
```

### Modes

- `full` — Pipeline completo (sprint file §7 → plano → executor → validator → review sob policy → status)
- `direct` — Pipeline enxuto (sprint file §7 → executor → validator → review sob policy → status)
- `interview-only` — Entrevista direta (brainstorm → sprint standalone §7)
- `execute` — Executa `PLAN_*.md` pronto
- `audit` — Auditoria sem correção

### Input Types

- `sprint` — Sprint ID (ex: S05) ancorado no backlog e em sprint file vivo
- `backlog-item` — alias legado de `sprint`
- `idea` — Indicação/brainstorm curto ou spec legado (não gera PRD — contrato mora no §7)
- `plan` — Path para plano pronto (modo `execute`)
- `brainstorm` — Texto livre (só para interview-only)
- `target` — Arquivo/diretório/feature (só em `audit`)

### Flags

- `--interview` — Força entrevista do contrato §7 do sprint mesmo sem ambiguidades
- `--review` — Executa slice-review ao final (senão opcional; sprints com `policy_manifest.critical_review.required: true` no §10 tornam a review obrigatória — G8)
- `--loop` — Esteira serial de sprints com auto-correção (introduzida em v0.20.0 e endurecida em v0.21.2): em cada seleção passa `loop:true` ao MCP e, antes das `ready`, pode maturar uma sprint `backlog` válida com deps satisfeitas e DoR amarelo/verde pela entrevista do §7; depois a reseleciona antes de plano/execução. Corrige residual de review in-loop (repair origem `slice_review` → verification), despacha o sidecar `talos-escalation-repair` se o residual persistir, estaciona sprint irrecuperável em `detached_repair` e drena `PENDENCIAS_<slug>.md` sob demanda (`drain_required` do MCP); implica review crítica (G8) sem editar `policy_manifest` por sprint. Sem a flag, o pipeline atual não muda
- `--handoff` — Só em `audit`: grava `.talos/plans/PLAN_AUDIT_*.md` TC-conforme
- `--scope <descrição>` — Só em `audit`: restringe o boundary textual
- `--help` — Mostra sintaxe completa

## Exemplos

### Full pipeline com sprint S05

```
/talos full sprint "S05"
```

Output:
```
✅ Talos: claude full sprint completed

📄 Sprint: /path/to/SPRINT_S05_login.md
📋 Plan: /path/to/PLAN_S05_login.md
🚀 Output: [summary do executor]

Status:
  ✅ Sprint file / contrato §7 valid
  ✅ Ambiguidades resolvidas (2 decisões coletadas)
  ✅ Plano generated
  ✅ Executor output ready (required in full/direct)
  ⏭️  Slice review: not executed
```

### Direct pipeline com sprint S05

```
/talos direct sprint "S05"
```

### Entrevista de brainstorm

```
/talos interview-only brainstorm "Que tal dark mode?"
```

### Force entrevista mesmo sem ambiguidades

```
/talos full idea "melhorar performance" --interview
```

## Como funciona

### Full Mode

```
1. Parse input (resolve backlog/sprint file)
   ↓
2. Validate backlog index (`talos_verify_backlog_index`)
   ↓
3. Select next sprint (`talos_select_next_sprint`)
   ↓
4. Validate Sprint file (`talos_verify_sprint_file`)
   ↓
5. Scan aceite (`talos_scan_acceptance` / G5 — AC-* / §7)
   ↓
6. Interview (automático se ambiguidades OU --interview)
   └─ Atualiza §7 + sela ao aprovar (`talos-sprint-interview`)
   ↓
7. Plan (`talos-plan-handoff`)
   ↓
8. Validate Plan (TC `require_sprint_file:true`)
   ↓
9. Execute obrigatório em `full` (`talos-plan-execute`, state v3 + acceptance_results)
   ↓
10. Validator frio (`talos-task-validator` vs §7 / oráculo T-outcome)
   ↓
11. Review (se --review ou critical_review.required:true no §10 — G8)
   └─ `talos-slice-review` (antes do fechamento de status)
   ↓
12. Update sprint status (`talos_update_sprint_status`)
   └─ done (sem M) | manual_validation_pending (M aberto; sem handoff)
   ↓
13. Output (resumo + próximos passos: sync M e/ou memory-promote)
```

### Direct Mode

```
1. Parse / Sprint file / Contrato §7 (AC-*)
   ↓
2. Validate aceite + Interview (condicional)
   ↓
3. Execute (`talos-direct-execute`, mantendo `phase: plan_execute`)
   ↓
4. Validator frio (`talos-task-validator`)
   ↓
5. Review (se --review ou critical_review.required:true no §10 — G8)
   ↓
6. Update sprint status (`talos_update_sprint_status`, quando houver backlog/sprint)
   └─ done | manual_validation_pending
   ↓
7. Output
```

### Interview-Only Mode

```
1. Cria draft mínimo pelo `SPRINT_TEMPLATE.md` (standalone §7) quando a entrada é brainstorm
   ↓
2. Entrevista `talos-sprint-interview` com `sprint_file_path` válido
   ↓
3. Output (sprint file §7 aprovado+selo)
```

## Sequências canônicas

Talos é família única. Cliente (Claude Code, Cursor, Codex App) é apenas o host que executa as skills; não existe roteamento por família.

| Mode | Sequência |
|------|-----------|
| `full` | `talos-sprint-interview` quando necessário → `talos-plan-handoff` → `talos-plan-execute` → `talos-task-validator` → `talos-findings-repair` (no `fail`) → `talos-slice-review` (com `--review`; obrigatória quando `critical_review.required:true` — G8) |
| `direct` | sprint/contrato §7 → `talos-direct-execute` → `talos-task-validator` → `talos-findings-repair` (no `fail`) → `talos-slice-review` (com `--review`; obrigatória quando `critical_review.required:true` — G8) |
| `interview-only` | draft sprint standalone §7 (se brainstorm) → `talos-sprint-interview` |

Residual da review (introduzido em v0.20.0 e endurecido em v0.21.2, em loop e standalone): P0/P1 → `talos-findings-repair` com origem `slice_review` → **verification pontual** (delta do `repair_evidence`; executa os checks declarados antes de julgar) → sidecar `talos-escalation-repair` se o residual persistir; P2/P3 → `talos_pendencies(append)` (`PD-<sprint>-<NN>` em `PENDENCIAS_<slug>.md`). Nunca 2º `talos-task-validator` nem nova review completa no ramo da review.

## Validação automática

Plugin detecta ambiguidades no contrato §7 do sprint file (`talos_scan_acceptance`):
- **Decisões D*:** TBD, "a confirmar", vago
- **Cenários UX:** gaps, "a definir"
- **Aceite `AC-*`:** `behavior` TBD, YAML incompleto, hierarquia AC⊃EVAL quebrada

Se encontra ambiguidades → o orquestrador conduz `talos-sprint-interview` automaticamente no fio principal (fire-and-continue: **não** há menu para adiar ou marcar TBD e seguir).

## Decisão em aberto ≠ parada

Decisões pendentes **disparam entrevista** e o pipeline **continua** após o contrato ser maturável. O orquestrador não pede “quer que eu continue?” nem oferece adiar/TBD como atalho — gates duros (`blocked`) ou bloqueio real de ambiente são as únicas paradas.

## Fechamento: `done` vs validação manual

| Status | Quando | DEP | Handoff |
|--------|--------|-----|---------|
| `done` | Todos `AC-*` `proved`; sem `M` aberto (ou M já syncado) | satisfaz | emite `HANDOFF_*.md` |
| `manual_validation_pending` | Prova auto ok + ≥1 `M` pendente | satisfaz | **não** emite |

Com M aberto, o próximo passo humano é:

1. Criar/preencher `.talos/manual-validation/<backlog-slug>.md` (IDs `MV-<sprint>-<ac>`)
2. Chamar `talos_sync_manual_validation`
3. Em `passed` + `handoff_path` → opcional `$talos-memory-promote <handoff_path>`

`M` `failed` bloqueia a origem e liga a flag `revalidation_required` no cone de dependentes (coluna *Revalidação*).

## Integração com seu workflow

### Antes de rodar workflow

1. Opcional: criar backlog mestre explicitamente com `$talos-backlog-generator`
2. Preenchimento de `PERGUNTAS_EM_ABERTO.md` (fora do plugin)
3. Resolver perguntas abertas fora do pipeline (se necessário)

Se você rodar `full`/`direct` com macro input (`idea`, briefing, roadmap ou conversa solta), o orquestrador prioriza `talos-backlog-generator` automaticamente quando o MCP retornar `routing.document_flow.priority = backlog_first`. O macro fica no `BACKLOG_MESTRE_*.md`; o MCP valida o índice com `talos_verify_backlog_index`, escolhe a execução com `talos_select_next_sprint` e sincroniza backlog+sprint file com `talos_update_sprint_status` após validator terminal.

### Ao rodar workflow

```
/talos full sprint "S05"
```

Plugin automatiza tudo. Você valida output.

### Depois de workflow

1. Conferir status: `done` ou `manual_validation_pending`
2. Se MVP: preencher relatório M → `talos_sync_manual_validation` → `done` + handoff
3. Se `handoff_path`: opcional `$talos-memory-promote <handoff_path>`
4. Avança para a próxima sprint (`talos_select_next_sprint`; deps em MVP já liberam)

## Skills envolvidas

| Skill | Função |
|-------|--------|
| `talos-backlog-generator` | Cria backlog mestre a partir de ideia, prompt, conversa ou briefing; roda explicitamente ou como primeira fase documental em macro input `backlog_first` |
| `talos-sprint-interview` | Matura o contrato §7 do sprint file com `AC-*` (resolve ambiguidades; aprova+sela) |
| `talos-audit` | Audita target/boundary sem patch: lê regras locais, detecta stack, produz achados com `arquivo:linha`; com `--handoff`, grava `.talos/plans/PLAN_AUDIT_*.md` TC-conforme sem executar |
| `talos-plan-handoff` | Cria plano executável a partir do contrato §7 + código |
| `talos-plan-execute` | Executa plano (com `talos-task-validator` sub-agent) |
| `talos-direct-execute` | Executa direto a partir do sprint/contrato §7 (modo `direct`) |
| `talos-findings-repair` | Corrige findings P0/P1/P2 após `fail` do validator dentro do boundary executado |
| `talos-task-validator` | Validador frio sibling; lê `state_path`, emite veredito estruturado + `acceptance_results` e nunca corrige |
| `talos-slice-review` | Review fria quando `--review` ou `critical_review.required:true` (G8); fase de verification (pós-repair) |
| `talos-escalation-repair` | Sidecar serial do loop `--loop`: residual P0/P1 pós-verification (slot `escalation`) e PDs delegadas pelo drain |
| `talos-memory-promote` | Promove candidatos de `HANDOFF_*.md` após `done` (nunca em MVP); sink Argus opcional |

## Configuração

Plugin usa configuração embutida no MCP para modos, skills `talos-*` e validadores de ambiguidade. Defaults auxiliares continuam empacotados em `packages/orchestrator/defaults/` e referências em `packages/orchestrator/references/`.

## Error handling

- **Sprint não encontrado:** reporta sprints disponíveis
- **Skill falha:** para, reporta erro, oferece retry/skip/abort
- **Sprint file / contrato §7 inválido:** reporta pendências do gate (`talos_verify_sprint_file` / `talos_scan_acceptance`)
- **Ambiguidades não resolvidas:** dispara `talos-sprint-interview`, propaga e continua

## Dúvidas?

Veja este README, `packages/mcp-server/README.md` e os SKILL.md `talos-*` para o contrato operacional atual.

---

**Plugin version:** 0.22.0
**Author:** Paulo Borini
**Last updated:** 2026-09-04

### Novidades v0.22.0 — veredito tipado da slice review e gate de fechamento derivado pelo MCP

- **Complete da review exige veredito.** `talos_lock_dispatch(action=complete, phase=slice_review)` passa a exigir `review_verdict ∈ {pass, pass_with_observations, fail}`; sem ele o complete devolve `blocked`/`review_verdict_ausente`.
- **Findings com ids `F-NNN`.** `review_findings` segue o mesmo packet do validator (`classify_findings.mjs`); `fail` ou qualquer P0/P1 devolve `blocked`/`review_repair_required` e trava o fechamento até a cadeia de repair (`origin=slice_review`).
- **Gate derivado, não declarado.** `data.gates.slice_review` e `data.review_cycle` são projeção do MCP no complete da fase; `talos_run_state(action=upsert)` com `gates.slice_review` é recusado (-32602).
- **Review crítica lida pelo MCP.** `talos_update_sprint_status` lê `policy_manifest.critical_review.required` do sprint file além da flag `--loop`; sem review derivada `passed` não há `done` nem `manual_validation_pending`.
- **Liveness preservada pós-review.** O commit do repair pós-review herda a mesma base (`base_sha`, `worktree_baseline`, `slice_commit_sha256`) do `plan_execute` já fechado.

### Novidades v0.21.2 — fix do instalador MinimaxCode em npx/tarball

- **Instalação do MinimaxCode resiliente a npx/tarball.** O instalador `installMavis` passa a resolver `server.js`, `traceability.mjs`, `package.json`, `_shared`, `skills` e `agents` a partir do bundle `plugins/talos/` quando `packages/` e `agents/` da raiz estiverem excluídos pelo `.npmignore` do tarball.
- **Dependências do runtime Mavis empacotadas.** `traceability.mjs` (import obrigatório do `server.js` desde a v0.19.0) e `package.json` passam a ser copiados para o diretório do plugin (`~/.minimax/plugins/talos/`), garantindo boot do MCP e resposta correta do `talos_ping`.
- **Prevenção de cache temporário no agent config.** O `config.yaml` dos custom agents do MinimaxCode não grava mais o diretório temporário do cache do npx como `defaultWorkspaceDir`.
- **Cobertura em smoke-install.** `build/smoke-install.mjs` ganha suite completa de validação de install e uninstall do MinimaxCode.

### Novidades v0.21.1 — hardening pós-0.21.0 no reconcile e no repair

- **Slice `direct` continua `direct` no reconcile.** O MCP deixa de herdar o sentinel interno `.talos/plans/direct.md` como `plan_path` real ao reconstruir uma slice sem `proofs`; isso evita flip incorreto de `contract_kind=direct -> plan` em recoveries.
- **Repair pós-fail volta ao trilho certo.** Quando o complete do validador grava `acceptance_results`, o ledger ressincroniza `liveness.slice_commit_sha256` antes do próximo commit; o repair subsequente continua `role=repair` e preserva o enforcement D15 de subconjunto em `repair[].files`.
- **Regressões cobertas em teste.** `packages/mcp-server/server.test.js` ganha casos para os dois achados da campanha integrada e deixa de depender do cwd da raiz para localizar fixtures.
- **Docs consolidadas para distribuição.** README pública, README do MCP e este README do orquestrador passam a narrar explicitamente o hardening da `0.21.1`, alinhando release, operação e material de comunicação.

### Novidades v0.21.0 — determinismo mecânico de boundary na slice e fechamento de sprint (BREAKING 0.21)

- **Boundary mecânico via git (`files_changed`).** `files_changed` passa a ser derivado deterministicamente pelo MCP como o git fact real (porcelain atual Δ baseline t0 do start ∪ commits desde base_sha minus `.talos/`), sem filtragem por `proofs[].files` vazios ou parciais.
- **Baseline t0 no start.** Capturado em `talos_lock_dispatch(start, phase=plan_execute)`; `first_write` vira heartbeat G12 puro (não sobrescreve baseline).
- **Reprojeção no G4.** Divergência de fórmula é corrigida pelo MCP via reproject overwrite antes de abrir o slot, sem falso repair de metadata; JSON com sha divergente recupera com role `reconcile` (não rename).
- **Validador frio focado em produto.** Não litiga metadata; repair foca exclusivamente em findings de produto (budget 1 por finding).
- **Fechamento no `--loop` (D17/D18).** `talos_update_sprint_status` roda no mesmo turno antes de `talos_select_next_sprint`; `select_next` bloqueia avanço com `next_action: reconcile_state` quando há slice órfã em run stalled ou repair_running.
- **BREAKING (DEC-039).** Skills 0.20 que ensinam baseline no `first_write` ou filtro de `files_changed` por proofs são rejeitadas pelo guard `DR05`.

### Novidades v0.20.0 — esteira `--loop` de sprints com auto-correção (minor aditiva, D18)

- **Flag `--loop`** — esteira serial de sprints: puxa a próxima sprint `ready` sozinha após fechar a atual (única pausa = entrevista), com repair in-loop, sidecar de escalation, drain de pendências e estacionamento. Flag gravada no ledger (`options.loop`); sem a flag, o pipeline atual não muda (CN7) e o gate de review crítica sob `policy_manifest` segue como estava.
- **Residual da review — auto-correção (D3/D4/D17).** P0/P1 na review abre `repair_start` com origem `slice_review` (budget 1 fail-closed por provenance) → `talos-findings-repair` → **verification pontual** (fase nova da `talos-slice-review`: delta do `repair_evidence`, executa os checks declarados antes de julgar, veredito `resolved`/`not_resolved`/`regression` por finding) → veredito persistido via `repair_complete` (`data.verification` validado pelo MCP; `resolved` sem check executado é recusado). Nunca 2º `talos-task-validator` nem nova review completa no ramo da review (LEG1 cortado no G8/bloco EXEC; G4 do validator preservado).
- **Sidecar `talos-escalation-repair` (D7).** Residual P0/P1 persistente abre slot com origem `escalation` (budget próprio, 1 dispatch por sprint) e é corrigido serial, sem self-validation; falha do sidecar estaciona a sprint em **`detached_repair`** (novo status: não `done`, não satisfaz DEP, não emite handoff; saída `→ready`/`→blocked`) enquanto a campanha segue para a próxima independente.
- **PENDENCIAS + drain (D9/D10/D20).** Residual P2/P3 vira `PD-<sprint>-<NN>` em `.talos/backlog/PENDENCIAS_<slug>.md` (writer exclusivo do MCP, id monotônico por arquivo); `talos_select_next_sprint` retorna `drain_required` com ≥3 PDs abertas, PD no cone DEP do candidato ou overlap de files — drenada pelo sidecar em modo drain antes do avanço.
- **Standalone com a mesma cadeia (D13)** — o arco review→repair→verification→sidecar não é condicional a `--loop`; review crítica sob `critical_review.required` segue antes de `talos_update_sprint_status` (G8 preservado).
- **Blindagem (Plano 06).** Guards permanentes no `check-consistency` (review read-only, ramo review sem 2º validator, verification com eco/âncora de checks/roteamento por severidade, violated⇒P0 mecânico, enum `detached_repair` e catálogo do sidecar) + guard test; docs descrevem o loop.
- Bump minor `0.19.0 → 0.20.0`. Schema MCP v5 e disco v3 inalterados.

### Novidades v0.19.0 — rastreabilidade MCP de requisitos `traceability v1` (opt-in) + receipt de fechamento + métricas de piloto

- **Ledger de rastreabilidade opt-in (tool única `talos_traceability`).** REQs de origem → destino → AC/`source_refs` → `acceptance_results` v3 → receipt MCP, em `.talos/traceability/<backlog-slug>.json` (D5: zero coluna nova no backlog; D2: zero hook; state v3 intocado). Actions: `upsert` (insert-or-update por REQ; `deferred`/`rejected` com motivo; `deferred` com destino tipado; fonte `external` exige `ref`), `verify` (destinos/ids + cruzamento com `source_refs` do §7.3 via `checkTraceabilityGraph`).
- **Parser/selo/conformance do §7.3 com `source_refs`.** `applyItemField` passa a mapear o campo (antes era no-op no YAML); sprint v1 tem grafo REQ↔AC exigido (refs válidas, sem órfãos, REQ `included` com caminho até AC, N:N com motivo); sprint sem marcador v1 (legacy) sela e fecha como hoje (CN7).
- **Gate de fechamento v1 no `done`.** `talos_update_sprint_status(done)` em sprint v1 recusa REQ `included` com qualquer AC ligado `unproved`/`manual_pending`/`violated`/ausente — antes de qualquer write (D14; irmão N:N não fecha por um lado).
- **Receipt de fechamento é projeção do MCP.** Action `receipt` devolve cobertura por REQ, exceções (deferred/rejected) e blockers, derivada de ledger + `acceptance_results` do state v3; o orquestrador ecoa o payload, sem claim de cobertura próprio.
- **Métricas de piloto.** Action `record_metric` persiste `{calls, retries, turns, coverage, instructions}` no documento completo (escrita absoluta preserva `reqs`/`sprints`); economia só se promove com medição registrada (INV5).
- **Minor 0.19.0 (D10):** feature aditiva opt-in com readers legacy — bump minor, sem breaking; bundes `plugins/`/`hosts/` regenerados pelo `build/bump-version.mjs`.

### Novidades v0.18.2 — nono host (MinimaxCode) + Plugin V1 spec-conforme + 5 custom agents + Plugin V1 visível com skills

- **Nono host do Talos: MinimaxCode.** Adição puramente adapter: nova entrada `mavis` em `HOST_ADAPTERS` (perfil `self_evident` + `dispatch_capability: "mutable"` + `question_prompt: "ask_user"` + `todo_tool: "todowrite"` + `hooks.supported: false` + capabilities `{subagent, mcp, todo}`); linha de detecção `env:TALOS_HOST=mavis` na matriz; case em `smoke-hosts.mjs` (`sv=5 ping=ok`). Sem tocar no motor (gates, preflight, run state, slice ledger, validator lock, checkpoint state, schema de tools).
- **Plugin V1 do MinimaxCode, gerado pelo packager e spec-conforme (13 files / 108 KiB, dentro dos 1024 files / 64 MiB do limite).** `build/install-host.sh mavis` materializa `~/.minimax/plugins/talos/`: `.minimax-plugin/plugin.json` (schemaVersion 1, name "talos", version 0.18.2, category "Code", apps vazio, 10 skills listadas), `servers.mcp.json` (stdio, `node` + `./server.js` relativo, env `TALOS_HOST=mavis`, timeout 30s), `icon.png` (PNG 1×1 RGBA 68B), `skills/talos-*/SKILL.md` (10, copiados de `packages/skills/`).
- **5 custom agents MinimaxCode (não fallback genérico).** Cada um é um agente real no DB do MinimaxCode, criado via `mavis agent create` + `mavis agent update` (system_prompt = corpo do canônico `agents/<talos-<name>.md` do Talos): `talos-direct-execute`, `talos-findings-repair`, `talos-plan-execute`, `talos-slice-review`, `talos-task-validator`. Mirror no disco em `~/.minimax/agents/talos-*/` com `agent.md` (system_prompt puro) + `config.yaml` (defaultWorkspaceDir).
- **Plugin V1 visível e skills carregando (fix do "instalado e morto").** O packager original referenciava o `server.js` por path absoluto (`$ROOT/packages/mcp-server/server.js`), que o reader oficial do MinimaxCode rejeita (`MCP_SCHEMA_INVALID: contains an absolute stdio argument` — o `minimax-reader` sempre delega o MCP para `readOfficialMcpFile` mesmo com `source: 'LOCAL_MINIMAX'`). Sem isso, o plugin inteiro falhava validação e o `mcpServers: {}` ficava vazio — sintoma exato: `talos-*` skills invisíveis, "instalado" mas morto. Fix: (1) **bundle do `server.js` dentro do Plugin V1** + `args: ["./server.js"]` relativo; (2) **bundle de `skills/_shared/`** como sibling `~/.minimax/plugins/skills/_shared/` (o loader ignora dirs sem manifest, então é inerte pro scan; existe só pra resolver o import hard-coded `../skills/_shared/scripts/document_quality.mjs` do `server.js`).
- **Removido o "passo extra de registro MCP"** do output do install — o Plugin V1 agora se auto-registra (e auto-inicia o MCP) via `LocalPluginDirectoryWatcher` do MinimaxCode. O workaround `mavis mcp create` virou lixo histórico (e foi removido do DB pra não conflitar com o auto-load).
- **Validação fim-a-fim no runtime real do MinimaxCode:** (a) subagente `talos-task-validator` invocou `mcp__talos__talos_ping` → `{status: alive, version: 0.18.1, 17 capabilities}` (versão anterior — o 0.18.2 entra no próximo release); (b) `node build/smoke-hosts.mjs` → 9/9 hosts OK; (c) `node build/check-consistency.mjs` → sem regressão A1/A2; (d) `mavis agent list` → 5/5 `talos-*` listados ao lado de `worker`/`verifier`/`explore`; (e) `mcp get` confirma 1 MCP `talos` (stdio) registrado.

### Novidades v0.18.1 — install zcode sob npx materializa o catálogo hosts/zcode (manifest na raiz do cache)

- **`talos init zcode` funciona de verdade via `npx github:pauloborini/talos`.** O instalador copiava o pacote npm inteiro para o cache do host e dependia do `.claude-plugin/plugin.json` na raiz — mas o tarball npm exclui `.claude-plugin/` (`.npmignore`). Sob npx, o cache ficava sem NENHUM manifest: os registros marcavam `talos@talos` como instalado/habilitado, porém a descoberta não resolvia skill, agente ou MCP nenhum ("instalado" e morto — sintoma: zero skills `talos-*` na sessão com a 0.18.0 no cache).
- **Cache materializado do catálogo `hosts/zcode/`** — mesmo layout do artefato `dist/talos-zcode.plugin`: `.zcode-plugin/plugin.json` NA RAIZ + `agents/` + `skills/` + `packages/`, com MCP via `${ZCODE_PLUGIN_ROOT}` (padrão dos plugins oficiais do zcode). Fail-cedo se o catálogo estiver ausente e assert pós-cópia do manifest (falha no install, não silenciosamente na sessão).
- **Bootstrap MCP do manifesto Claude à prova de Cursor/Grok.** O bootstrap da 0.18.0 dependia de `CLAUDE_PLUGIN_ROOT` no ENV do spawn, que esses hosts não injetam (`talos-mcp: run.sh não encontrado` no log). Agora, esgotadas as sondas de env/PWD, o `-c` varre os caches conhecidos do Talos (`~/.cursor`, `~/.zcode`, `~/.claude` — marketplace e cache — e legados `/home/box`) e executa o `run.sh` mais recente; sem nenhum, falha dizendo para atualizar/reinstalar.
- **`smoke-install.mjs`** valida o contrato novo (manifest `.zcode-plugin` na raiz, `skills === './skills/'`, args MCP com `${ZCODE_PLUGIN_ROOT}`, server.js/skill orquestradora/validator presentes) e **`run.test.mjs`** ganha 4 testes do bootstrap (cache mais recente sem env; falha acionável). Quem instalou a 0.18.0 via npx deve rodar `init zcode` 0.18.1 e reiniciar o host.

### Novidades v0.18.0 — onda 1 completa: writer MCP + guards DR01–04 + release 0.18

- **Writer do JSON de slice virou o MCP.** O executor/repair **não** monta nem escreve `.talos/state/<run_id>/<slice>.json` — chama `talos_commit_state` com julgamento curto (`proofs[]`, `obligation_ids`, `plan_path`, `sprint_file_path`, `eval_na`, `repair[]`) e recebe `state_path` + `state_sha256`. O MCP projeta o state v3 completo (escrita absoluta tmp+rename) e registra `liveness.slice_commit_sha256` no ledger.
- **G12 público é só `first_write`.** O checkpoint do executor é emitido uma única vez, imediatamente antes da primeira mutação; o MCP bloqueia qualquer outro event de executor (conjunto público enxuto). Slice no-op só commita (120s sem stalled).
- **`talos_lock_validator(start)` por sha, não por checkpoint.** O slot só abre se o sha do disco for o do último commit MCP daquele path (`liveness.slice_commit_sha256`); JSON de slice escrito à mão (órfão/dual-writer) é bloqueado.
- **Repair pelo mesmo verbo.** `talos-findings-repair` corrige e commita via `talos_commit_state` com `repair[]` no mesmo `state_path`, sem editor no JSON.
- Skills `talos-plan-execute`, `talos-direct-execute`, `talos-findings-repair` e o G12 deste SKILL reescritos para o fluxo onda 1.
- **Guards DR01–04 no `check-consistency`.** Skills de execução (canônicas e espelhos `hosts/`/`plugins/`) que reensinaram `STATE_FILE_SCHEMA.md`, escrita de `worktree_baseline`/`worktree_final`, checkpoints mortos ou `"acceptance_results"` no payload falham o guard citando o DR* (allowlist: schema, MCP, task-validator, testes).
- **Release `0.18.0`** sincroniza `packages/` + `hosts/` + `plugins/talos/` no mesmo bump (`node build/bump-version.mjs 0.18.0`); espelhos regenerados, nunca editados à mão. Breaking de procedimento (writer do slice = MCP), disco permanece v3.

### Novidades v0.17.2 — instalador zcode via marketplace (substitui o caminho do data-dir)

- **`talos-init zcode` instala via marketplace `talos` (id `talos@talos`)** — reproduz o fluxo "Add Marketplace + Install" da UI do ZCode, que é o que realmente funciona no host (o caminho `zcode-plugins-official` de 0.17.1 não registra NENHUM MCP de plugin — `mcpServerCount:0` em todas as sessões). Agora o install registra o marketplace (git `pauloborini/talos`) em `known_marketplaces.json`, copia o catálogo para `marketplaces/talos/` e o plugin para `cache/talos/talos/<versão>/`, grava `talos@talos` em `installed_plugins.json`, cria `data/talos@talos/` e habilita no `config.json`.
- **`uninstall zcode`** reverte tudo E limpa o legado do caminho quebrado `zcode-plugins-official` (data-dir, cache, config entry, marketplace cache entry).
- **`smoke-install.mjs`** — asserções de zcode migradas para o fluxo marketplace: cache `cache/talos/talos/<v>`, marketplace `known_marketplaces.json`, registro `installed_plugins.json`, `enabledPlugins["talos@talos"]`, idempotência e uninstall + limpeza de legado.
- Supersede a abordagem de 0.17.1 (que só materializava o data-dir no path `zcode-plugins-official`, sem mudar o paradigma de instalação). Sem mudança de runtime MCP, schema v5, gates ou topologia sibling.

### Novidades v0.17.1 — instalador zcode materializa e remove o data-dir

- **`talos-init` zcode preenche o data-dir** — `materializeZcodeDataDir` é chamado após popular o cache; copia `cache/.../0.17.1/` → `~/.zcode/cli/plugins/data/talos@zcode-plugins-official/`. Cobre o caso em que o host pula a materialização porque vê a pasta vazia órfã de instalação anterior abortada (skills/MCP ficavam invisíveis).
- **`talos-init` zcode remove o data-dir no uninstall** — `removeZcodeDataDir` espelha a operação (simétrico ao install; sem isso, `uninstall` deixava o data-dir órfão). Defesa contra symlink: ambos falham-fechado se `dataDir` aponta para fora de `~/.zcode/cli/plugins/data/`.
- **Idempotência** — 2ª execução de `init zcode` (sem uninstall no meio) detecta o plugin.json canônico no data-dir e pula a cópia, sem duplicar nem destruir conteúdo.
- **`smoke-install.mjs`** — 3 asserts novos: data-dir populado após init, populado após idempotência, removido após uninstall. Sem eles a regressão passava silenciosa.
- Sem mudança de runtime MCP, schema v5, gates ou topologia sibling. Os outros 7 hosts não passam pelo problema (Claude/Cursor/Codex usam marketplace nativo do host; opencode/pi/antigravity/vscode escrevem em paths nativos do host sem data-dir separado).

### Novidades v0.16.1 — docs de adapters (VS Code + `question_prompt`)

- **`host-adapters.md` com o 8º host** — coluna `vscode` na matriz de adapters (`runSubagent`, `manage_todo_list`, perfil `self_evident`, `dispatch_capability: 'mutable'`, config MCP via `.vscode/mcp.json`/`settings.json` com `TALOS_HOST=vscode`), linha de detecção `TALOS_HOST=vscode`, nota de instalação e "Status multi-host" com o VS Code.
- **Contrato de entrevista documentado** — campo `question_prompt` (`{mechanism, mode, max_questions, options_per_question, persistence, resume_after_interview?}`) na tabela do contrato (schema v5) e linha de concern na matriz com o mechanism por host (AskUserQuestion/request_user_input/question/interactive_prompt/ask_question/vscode_askQuestions/native_structured_question).
- **Cosmético** — "Estado atual (2026-08)" em `AGENTS.md`/`CLAUDE.md`; contagem de colunas das linhas finais da matriz corrigida (6 → 8 células).
- Sem mudança de runtime MCP, gates ou topologia sibling. Schema MCP v5 intacto.

### Novidades v0.16.0 — procedência por linha e revisão fria do backlog (BREAKING)

- **Procedência obrigatória** — coluna `Origem` na §7.1 e nas decisões do backlog; campo `origin` em cada `AC-*` (`usuario` \| `derivado:<path>` \| `premissa`); schema pré-0.16 recusado com `migrar_para_0_16`.
- **Gates de procedência** — `premissa` não sustenta sprint `Must`/`P0`; `derivado:<path>` resolvido contra o disco; §4 `Discussão` obrigatória.
- **Entrevista estruturada no generator** — rascunho escaneado em memória (`sprint_markdown`), perguntas via `question_prompt`, resposta vira decisão `Origem: usuario`.
- **Revisão fria** — passo final da skill lê o mandato de `references/COLD_BACKLOG_REVIEW_PROMPT.md`, despacha subagente genérico por `subagent_dispatch` e regateia os gates sobre artefatos corrigidos.
- **Não entrou** — nenhuma tool MCP nova, nenhum gate novo de orquestrador, nenhum selo de revisão.
- **Breaking (corte seco)** — artefatos pré-0.16 não são suportados; iniciar backlog/sprint novo. Schema MCP v5 e topologia sibling/G4/dispatch intactos.

### Novidades v0.15.2 — docs alinhadas ao contrato 0.15

- **Docs distribuídas** — README/orquestrador/COMMANDS/MCP descrevem `AC-*`, `manual_validation_pending`, `talos_sync_manual_validation`, `critical_review` e 16 tools MCP.
- **Removido** — menu A/B/C (anti-padrão); “15 tools”; DEP só-`done`; mapa G8/G9 invertido.
- Schema MCP v5 e topologia sibling intactos.

### Novidades v0.15.1 — preflight de cache marketplace (EACCES)

- **Packaging** — `init` Claude/Cursor/Codex detecta cache `~/.…/plugins/marketplaces/talos` não gravável (ex.: owned por root após `sudo`) e falha cedo com `sudo rm -rf …` explícito.
- **Docs** — Troubleshooting em `COMMANDS.md` para `Failed to finalize marketplace cache`.
- Schema MCP v5 e topologia sibling intactos.

### Novidades v0.15.0 — aceite atômico (`AC-*`) e validação manual não bloqueante (BREAKING)

- **Contrato §7** — §7.3 com YAML `acceptance`/`AC-*` (hierarquia AC⊃EVAL, selo §7 write-once); checkbox dos 4 grupos removido (LEG1); smoke mora em `evidence.manual` do AC (LEG4).
- **State v3 + oráculo** — `state_schema_version:3` obrigatório (v1/v2 hard-fail — LEG2); `acceptance_results`/`proof_refs` por AC; `talos_lock_validator` exige `acceptance_results` ecoando o oráculo mecânico T-outcome quando sprint presente.
- **Status/DEP/handoff** — `manual_validation_pending` (satisfaz DEP — LEG3; nunca emite handoff); `done` exige `acceptance_results` com todos os `AC-*` `proved`; handoff só em `done`.
- **Validação manual** — relatório `.talos/manual-validation/<backlog>.md` + `talos_sync_manual_validation` (lock por backlog; `validated`/`waived` com justificativa; `failed` bloqueia a origem; todos `validated` → `done` com handoff).
- **Flag revalidação** — coluna `Revalidação` (índice 15) no backlog; cone transitivo `Depende de` no `M` failed; `done` bloqueado até revalidação; select não filtra.
- **Review crítica** — `policy_manifest.critical_review` (§10, reasons enum fixo); slice-review obrigatória antes de `talos_update_sprint_status` quando `required:true` (G8).
- **Fechamento** — `done` sem `acceptance_results` bloqueia; persist do oráculo fail-closed; guard VERSION cobre vscode/plugins.
- **Breaking (D19)** — artefatos pré-v0.15 não suportados; iniciar backlog/sprint novo. Schema MCP v5 e topologia sibling/G4/G12 intactos.

### Novidades v0.14.2 — MCP spawn com path com espaço

- **Packaging** — spawn do MCP via `/bin/bash` + path do `run.sh` em `args[]` (evita ENOENT em paths com espaço, ex. Parallels/`Application Support`).
- **Agents** — `description` citada no frontmatter YAML dos 5 agents da família.
- Schema MCP v5 e topologia sibling intactos.

### Novidades v0.14.1 — `select_next_sprint` sem `gerar_prd`

- **Patch de contrato** — `talos_select_next_sprint` deixa de retornar `next_action: "gerar_prd"`; deriva `sprint_interview` / `plan_handoff` / `plan_execute` do §7 + PLAN + `mode` (direct nunca sugere plan_handoff). Orquestrador consome o verbo obrigatoriamente.
- **Legado** — `prd_path` no payload/update permanece posicional no backlog; aceite mora no §7.
- Schema MCP v5 e topologia sibling intactos.

### Novidades v0.14.0 — sprint file absorve o PRD (BREAKING documental)

- **PRD removido do pipeline** — `full`/`direct`/`execute` não geram nem exigem `PRD_*.md`; contrato de produto vive na §7 do sprint file (congelado + selo sha256).
- **Skills retargetadas** — `talos-sprint-interview` (ex-`talos-prd-interview`); generator de PRD removido; validador frio nota contra §7.
- **Gates MCP** — TC só `plan`; scan → `talos_scan_acceptance`; plano linka `**Sprint file**`. Schema v5 / sibling G4 intactos.
- **Migração** — ver `CHANGELOG.md` 0.14.0 e bloco "Migração 0.13.x → 0.14.0" em `CLAUDE.md`/`AGENTS.md`.

### Novidades v0.13.0 — host VS Code (8º host)

- **VS Code como host oficial** — adapter `vscode` em `HOST_ADAPTERS`: perfil `self_evident`, `dispatch_capability: 'mutable'`, `todo_tool: 'manage_todo_list'`, subagente via `runSubagent`. Detecção por `TALOS_HOST=vscode`. 10/10 na matriz de conformance.
- **Instalador `init vscode`** — workspace (`.vscode/talos/` + `.vscode/mcp.json`) e global (`~/.vscode-talos/` + prompt folder + `settings.json` MCP). Parse tolerante a JSONC (comentários `//`, trailing commas) para o `settings.json` do VS Code.
- **Build + artefato** — `build_vscode()` em `build-plugins.sh`, `dist/talos-vscode.plugin`, catálogo `hosts/vscode/`. `install-host.sh` com caso `vscode`.
- **Docs** — `README.md`, `COMMANDS.md`, `AGENTS.md`, `CLAUDE.md`, `plugin-manifests/README.md` atualizados para 8 hosts.

### Novidades v0.12.2 — tokens e performance no MCP/state

- **State file v2 compacto** — handoff executor→validator com `contract_ids` por referência, `eval_results` como única fonte de claims e evidências por índice; JSON compacto, readers compatíveis com v1.
- **`talos_run_state` recovery** — action dedicada retorna só `validator_recovery` para o validador frio; `get` preservado para debug.
- **Tool descriptions enxutas** — menos tokens no `tools/list` sem mudar contratos MCP nem gates.

### Novidades v0.12.1 — comando `/talos` canônico

- **Comando público corrigido** — o comando legado saiu da superfície distribuída; o comando canônico agora é `/talos <mode> ...`.
- **Bundles e hosts sincronizados** — `packages/orchestrator/commands/talos.md` foi propagado para Claude/Cursor, Codex, opencode, pi e zcode.
- **Docs e exemplos limpos** — README, `COMMANDS.md`, skill orquestradora, prompts Codex e snippets Raycast usam `/talos ...`; resíduos do método antigo ficam restritos a histórico ou GitHub Actions.
- **Distribuição sem npm registry** — publicação npm fica desativada; o caminho oficial é `npx github:pauloborini/talos` + GitHub Release.

### Novidades v0.12.0 — rebranding atlas-workflow → Talos

- **Rebranding completo** — `atlas-workflow` renomeado para **Talos**. Skills `atlas-*` → `talos-*`, CLI `atlas-init.mjs` → `talos-init.mjs`, plugin `atlas-workflow-orchestrator` → `talos`. 632 arquivos alterados.
- **Identidade própria** — Logo, README, marketplace e metadados refletem o nome definitivo. O pipeline é o mesmo; o nome mudou.
- **Compatibilidade com legado** — Instalador limpa automaticamente artefatos com prefixo `atlas-` de instalações antigas; `SKILL_PREFIXES` cobre `['talos-', 'atlas-']`.
- **Docs sincronizados** — `AGENTS.md`, `CLAUDE.md`, `NAMING.md`, `CHANGELOG.md` e todos os manifests atualizados. `marketplace.json` lista os 8 hosts.

### Novidades v0.11.1 — correção do instalador Antigravity (Gemini)

- **Instalação do Antigravity global completa** — O instalador unificado (`init antigravity`) agora copia a pasta `packages/` inteira recursivamente, incluindo as subpastas `skills` e `templates`, em vez de apenas a subpasta `mcp-server`.
- **Sem erros de inicialização** — Resolve o erro de módulo ausente (`document_quality.mjs`) que ocorria no setup global do Antigravity.
- **Drifts de versão resolvidos** — Ajustadas referências em READMEs e documentações operacionais para refletirem as versões de releases corretas.

### Novidades v0.11.0 — fallback de subagente para host ZCode

- **Workaround de Dispatch no ZCode** — O host ZCode tem uma limitação onde sub-agentes de plugin (`subagent_type: "talos-*"`) não herdam conexões MCP. Implementado o adapter `fallback` que despacha `general-purpose` (agente nativo, herda MCP) apontando para o MD do agente canônico como prompt do sistema.
- **Isolamento Sibling Preservado** — O validador frio irmão (Gate G4) permanece isolado e executado em subagente separado, mantendo os invariantes de arquitetura.

### Novidades v0.10.1 — alias `sprint` canônico e Raycast alinhado

- **`sprint` agora é o input público principal** para `/talos full` e `/talos direct`; `backlog-item` continua aceito só por compatibilidade.
- **Comandos e docs sincronizados** — README, `COMMANDS.md`, comandos do orquestrador, bundles dos hosts e snippets do Raycast foram atualizados para o novo contrato.
- **Sem mudança de runtime** — o fluxo continua determinístico e os gates de validação permanecem os mesmos; a mudança é de contrato de entrada e distribuição.

### Novidades v0.10.0 — backlog em 2 camadas + 4 gates MCP de sprint

- **Backlog em 2 camadas**: mestre enxuto (índice estratégico — fases, tabela de sprints, MoSCoW, dependências, links) + sprint files vivos (`sprints/SNN_<slug>.md`, 16 seções: DoR/DoD, `eval_manifest`, `policy_manifest`, §14 Execução e validação, §16 Histórico). Skills priorizam sprint file como fonte primária de contexto; backlog mestre só para deps/ordem macro.
- **`talos_verify_sprint_file`** — valida conformidade do arquivo vivo contra `SPRINT_TEMPLATE.md`: seções obrigatórias, link bidirecional ao backlog, DoR, eval_manifest. Fail-closed (ausente ou vazio = blocked).
- **`talos_verify_backlog_index`** — valida backlog mestre: §7 Registro de sprints, enums válidos (MoSCoW/prioridade/status), links para sprint files reais, sem duplicata de sprint ID, detecção de ciclo de dependência, status drift backlog↔sprint file = blocked.
- **`talos_select_next_sprint`** — seleção determinística: por padrão filtra `state=ready` + deps `done`/`manual_validation_pending` + sprint file válido + DoR verde; com `loop:true`, inclui exclusivamente a pré-etapa de sprint `backlog` válida com DoR amarelo/verde e devolve `sprint_interview`. Ordena por MoSCoW→prioridade→ganho→esforço→ID. Resultado único, sem ambiguidade.
- **`talos_update_sprint_status`** — atualiza status atomicamente em backlog e sprint file: pré-condição (FSM de transições, `done`/`manual_validation_pending` exigem validator terminal + `state_path`; `done` bloqueado com M aberto), escrita com rollback P2 (se write do sprint file falhar após o backlog ser escrito, backlog é restaurado), pós-validação antes de `passed`. Handoff só em `done`.
- **`SPRINT_TEMPLATE.md`** canônico — template de 16 seções para sprint files vivos.
- **`BACKLOG_MESTRE_TEMPLATE.md` refatorado** — índice enxuto sem duplicar conteúdo de sprint.

### Novidades v0.9.4 — audit handoff TC-conforme + perfis de stack

- `/talos audit --handoff` passa a escrever `.talos/plans/PLAN_AUDIT_<slug>.md` **conforme ao `PLAN_TEMPLATE.md`** (cabeçalho com `| **Sprint file** | N/A — origem auditoria |`, ref a `BOUNDARY_SPRINT_PLAN.md`, §1–§6/§8, tasks `#### T01.`): passa no gate TC e é de fato consumível por `/talos execute plan`. Fecha a promessa quebrada da estrutura ad-hoc anterior, que falharia o gate.
- Perfis de stack ganham 6 linhas detectáveis — `go`, `rust`, `java_kotlin`, `firebase`, `supabase`, `rest_openapi` — no baseline universal e no validador frio, ativadas só por manifests/deps/comandos reais no boundary.
- `audit`/`interview-only` não declaram `guarantee_level` (não há execução a garantir); descrição do `talos_preflight` endurecida para refletir a impl.

### Novidades v0.8.4 — liveness do executor (Gate G12)

- `plan_execute` agora tem liveness explícito: `talos_lock_dispatch(start)` cria deadline de bootstrap e o executor precisa emitir checkpoints materiais.
- O executor reporta `first_write` (checkpoint público G12, uma única vez, imediatamente antes da primeira mutação) e comprova o handoff via `talos_commit_state` — os demais events de executor foram removidos no G12 enxuto da onda 1 (v0.17.3; ver seção de novidades acima).
- Se o sub-agent não retornar/progredir antes do handoff, o orquestrador consulta `talos_lock_dispatch(status)`; bootstrap vencido vira `executor_bootstrap_timeout`, checkpoint antigo sem avanço vira `executor_progress_timeout`; ambos persistem `stalled`, liberam retry e não podem ser tratados como execução em andamento.
- Depois de `talos_commit_state`, o liveness fica `handoff_ready` (com `slice_commit_sha256` no ledger) e não expira por timeout de progresso enquanto aguarda o orquestrador abrir `talos_lock_validator(start)`.
- `talos_lock_validator(start)` só abre o validator quando o sha do disco for o do último commit MCP daquele `state_path`; JSON de slice escrito à mão (órfão/dual-writer) é bloqueado.

### Novidades v0.8.2 — release/npm e procedimento de bump

- Pacote npm `talos` validado como instalador multi-host (`npm pack`, `npm exec` do tarball e `.npmignore` restritivo).
- CI de release publica npm com provenance e GitHub Release somente por tag `vX.Y.Z`, com guard de tag = `VERSION` = `package.json.version`.
- Procedimento de patch/bump documenta o fluxo completo para IA: classificar mudança, atualizar versões, regenerar catálogos, validar CI local, checar pacote npm, taguear e verificar publicação.

### Novidades v0.8.0 — proof-of-work do validador frio (Gate G4, R20)

- `talos_lock_validator(start)` emite um `challenge` (sha256 de um arquivo do boundary do `state_path`); o validador irmão lê via `validator_recovery.challenge`, computa o hash e devolve em `challenge_response`.
- `talos_lock_validator(complete)` recomputa o hash do disco e bloqueia (`challenge_failed`) em divergência/ausência, sem fechar o slot — re-despacho do mesmo validador. O re-dispatch é **bounded** por attempt: esgotado o teto, o slot fecha terminal (`challenge_exhausted`, fail-closed).
- O hash esperado nunca é persistido em estado legível (recomputado on-demand). Best-effort: boundary sem arquivo legível → sem enforcement; arquivo ausente no complete → `unverifiable`, não bloqueia.
- Escopo honesto: atestação **mecânica** de leitura do boundary, **não** prova de isolamento não-forjável. Schema `talos_capabilities` v5 intacto.

### Novidades v0.7.1 / v0.7.2 — confiabilidade

- `ping().capabilities` derivado de `toolsList()` (fonte única — fim do drift que omitia `talos_classify_input`); CI job `cross-os` (Windows/macOS); `.gitattributes` para artefatos gerados.
- `talos_run_state(upsert)` faz merge top-level (não derruba `dispatch.active`); `findActiveRunConflict` só bloqueia conflito de lock real; `talos_verify_artifact` aceita `artifact_kind`; Gate G4 endurecido (R17 falha de dispatch = `blocked`; R19 proveniência do `dispatch_token`).

### Novidades v0.7.0 — topologia sibling-only

- Validação fria é sempre sub-agent irmão em todos os hosts: o executor escreve `state_path` e encerra; o orquestrador despacha `talos-task-validator`. Gate JOIN no preflight, `dispatch_token` monotônico, máximo de 2 validators por contrato. `CAPABILITIES_SCHEMA_VERSION` v3 → v5 (BREAKING de contrato, sem mudança de comportamento).

### Novidades v0.6.2 — backlog mestre

- `talos-backlog-generator` cria backlog mestre a partir de ideia, prompt ou conversa quando acionado explicitamente ou como primeira fase documental em macro input `backlog_first`.
- O backlog padrão vai para `.talos/backlog/BACKLOG_MESTRE_<slug>.md` quando o usuário não informa path.
- `BACKLOG_MESTRE_TEMPLATE.md` inclui MoSCoW, esforço x ganho, dependências, riscos e próxima sprint executável.
- Em `full`/`direct`, macro input sem backlog canônico passa por backlog antes do contrato §7; `sprint`/`backlog-item` e plano existentes continuam começando no artefato já recortado.

### Novidades v0.6.1 — fronteira documental no orquestrador

- Fases documentais (`contrato §7`, entrevista, `PLAN_*.md`) são conduzidas no orquestrador; o primeiro sub-agent obrigatório do `full` nasce em `talos-plan-execute`.
- Os sub-agents do pipeline são `talos-plan-execute`/`talos-direct-execute`, `talos-task-validator`, `talos-findings-repair`, `talos-slice-review` e — desde v0.20.0 — o sidecar `talos-escalation-repair` (serial, só com slot de escalation/drain aberto).
- A topologia é **sibling** em todos os hosts: o orquestrador coordena o validator irmão a partir do `state_path` retornado pelo executor e só reabre execução em `fail`. Host sem join síncrono é rejeitado no preflight (gate JOIN).
- `talos_preflight`/dispatchability distinguem skills documentais de skills executoras, evitando exigir sub-agent para entrevista/plano.

### Novidades v0.9.3 — ZCode como novo host (tier-1)

- **Novo host: ZCode** (Claude Agent SDK compat). Entrada `zcode` em `HOST_ADAPTERS` (`packages/mcp-server/server.js`) com perfil `self_evident` — `Agent(subagent_type)` + `TodoWrite` + MCP stdio + skills nativas, clone estrutural do Claude Code. Detector `ZCODE_PLUGIN_ROOT` em `HOST_DETECTORS`. `validator_dispatch.join.sync: 'self_evident'`, `confidence: 'presumed'`.
- ZCode reusa o agente canônico `agents/<name>.md` no plugin root (mesmo formato Claude); sem gerador próprio, sem custo de manutenção a cada nova skill/agent.
- Installer `init zcode` (cache-based, análogo ao `init antigravity`): copia catálogo `hosts/zcode/` para `~/.zcode/cli/plugins/cache/zcode-plugins-official/talos/<version>/`, atualiza o `marketplace.json` cache e habilita o plugin em `~/.zcode/cli/config.json` (`enabledPlugins`). **Sem dependências externas** (não exige `pi-mcp-adapter`/etc. — passa no preflight direto).
- **Novo host: VS Code** (Copilot Chat nativo). Entrada `vscode` em `HOST_ADAPTERS` (`packages/mcp-server/server.js`) com perfil `self_evident` — `runSubagent` + `manage_todo_list` + MCP (`mcp.json`) + skills nativas. Detector via `TALOS_HOST=vscode` injetado no MCP config. `validator_dispatch.join.sync: 'self_evident'`, `confidence: 'high'`. `dispatch_capability: 'mutable'` (subagentes VS Code têm Write/Edit/Bash, confirmado em produção).
- VS Code reusa os agentes canônicos `agents/<name>.md` (mesmo formato Claude); sem gerador próprio. Skills no prompt folder do VS Code (`~/Library/Application Support/Code/User/prompts/` no macOS).
- Installer `init vscode` (análogo a opencode/pi): workspace copia `.vscode/talos/` + `.vscode/mcp.json`; global copia runtime para `~/.vscode-talos/`, agents/skills para o prompt folder, e mescla MCP no `settings.json` do usuário (`github.copilot.chat.mcpServers`). **Sem dependências externas**.
- Oito hosts suportados: `claude`, `codex`, `opencode`, `pi`, `antigravity`, `zcode`, `vscode`, `generic`. `CAPABILITIES_SCHEMA_VERSION` segue **v5** (adição aditiva, sem breaking). Smoke real no host VS Code confirma `host=vscode sv=5 join.sync=self_evident ping=alive version=0.12.2`.
