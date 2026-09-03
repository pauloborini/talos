# Determinismo

Afeta: [pipeline, orquestrador, mcp, hosts]

### DEC-003 — Detecção de host data-driven

Registry de detecção de host em `HOST_ADAPTERS`, data-driven e ordenado por precedência. Adicionar host = adicionar detector (env próprio/arquivo); sem ramo solto. `talos_capabilities` (schema v5) detecta `claude`/`codex`/`opencode`/`pi`/`zcode`/`vscode`/`generic`.

### DEC-004 — PREREQ hard-fail

Host sem pré-requisito essencial (subagente + MCP) é rejeitado no preflight (`talos_preflight`), não degradado. Capability não-essencial (ex.: todo nativo) apenas segue sem o recurso. Warning não substitui garantia. Hosts `must_report` (pi/generic) falham-fechado se o orquestrador não reportar `host_capabilities`; nativos (claude/codex/opencode/zcode/vscode) são `self_evident` para PREREQ/JOIN.

### DEC-005 — Dependências obrigatórias do pi

Host pi exige duas deps externas: `pi-mcp-adapter` (MCP) e `pi-subagents` (subagente). Ausência é hard-fail no preflight.

### DEC-007 — HostAdapter portável

Variação de host vive em `talos_capabilities` (runtime) + `host-adapters.md` (doc) + manifesto de packaging. Skills são host-agnósticas. Tools nativas do cliente não são proxyáveis — o adapter descreve, não roteia. Contrato `HostAdapter` é entrada runtime data-driven (`subagent_dispatch`, `question_prompt`, `todo_tool`, `hooks`, `capabilities_flags`).

### DEC-008 — DISPATCH hard-fail

Gate DISPATCH bloqueia modos `full`/`direct`/`execute` em hosts com mutação desconhecida até `host_capabilities.dispatch_mutable:true`. Subagente sem mutação verificada é hard-fail em execução; proibido executar código no fio principal para compensar. Modos read-only (`audit`, `interview-only`) não exigem `dispatch_mutable`. `pass`/`pass_with_observations` do validador são terminais (só `fail` reabre loop).

### DEC-020 — Join síncrono do orquestrador

Join síncrono (validator_dispatch.join) é a premissa de portabilidade do modelo sibling: orquestrador despacha folha irmã, bloqueia-aguarda e recebe valor de retorno estruturado. Host sem join verificado → `blocked` no preflight, sem fallback.

### DEC-029 — Git + ledger são a verdade; slice JSON é cache

O estado da slice é git (worktree + SHAs) mais o ledger da run (`.talos/state/<run>/run.json`). O arquivo `.talos/state/<run>/<slice>.json` é cache projetado pelo MCP via `talos_commit_state`. Agente não conserta state com editor. Writer único = MCP (v0.18 preservado).

### DEC-030 — Baseline t0 no `lock_dispatch(start)`; `first_write` só heartbeat

`talos_lock_dispatch(action=start, phase=plan_execute)` captura `worktree_baseline` (t0). `first_write` permanece no G12 público **somente** como heartbeat de liveness (uma vez, imediatamente antes da primeira mutação). Não grava baseline. `first_write` tardio não zera `files_changed`.

### DEC-031 — `files_changed` é fato git, não claim do executor

`files_changed` = (porcelain agora Δ t0) ∪ `diff(base_sha…HEAD)` minus `.talos/`. A projeção **não** filtra por `proofs[].files` nem `repair[].files`. Prova ⊆ fato: `proofs.files` ⊂ `files_changed`. Claim fora do fact recusa o commit; fact omitido por claim vazio é defeito.

### DEC-032 — G4 recomputa e reprojeta; validator não julga metadata

`talos_lock_validator(start)` recomputa a fórmula de DEC-031. Divergência → o MCP reprojeta e sobrescreve o JSON; não despacha `talos-findings-repair`. Com G4 aberto, o validator frio não emite fail por `files_changed`, sha ou `run_id`.

### DEC-033 — Recover de órfão é `reconcile` MCP

Dual-writer fail-closed permanece (`sha(disco)` = `liveness.slice_commit_sha256`). Recover: `talos_commit_state` role `reconcile` (mesmo `run_id`, `plan_execute` ativo) regrava a projeção e atualiza o sha. `next_action` é `open_validator` ou `complete_repair` conforme o ciclo. `remover_ou_renomear_slice_órfã` não é o recover do loop.

### DEC-034 — Slot único: ID opaco não mata o ciclo

Com um único slot ativo, `repair_complete` / `validator_complete` aceitam `repair_run_id` / `validator_run_id` omitido ou diferente do id canônico `{run}:repair|{validator}:n:ts` usando o slot ativo. Dois slots ou stale real continuam `blocked`.

### DEC-035 — Repair LLM só produto; budget não gasta em metadata

`talos-findings-repair` corrige findings P0/P1 de **código/produto**. Metadata (boundary, sha, run_id, `files_changed`) vai a DEC-032/033. `repair[]` lista só paths mutados **neste** repair; `files_changed` da slice é união mecânica execute∪repair. Budget de repair = 1 por finding de produto, não por F-00x de state.

### DEC-036 — Slice JSON magro

O JSON de slice guarda hashes só dos paths de `files_changed`. Snapshot porcelain completo (`worktree_final` como inventário de sujeira do repo) não é superfície para o LLM confrontar com `files_changed`.

### DEC-037 — `--loop` fecha sprint por gate, com recover explícito

Após veredito terminal do validator, o orquestrador chama `talos_update_sprint_status` no mesmo turno. `talos_select_next_sprint` recusa avanço se a run tem validator terminal e a sprint ainda está `review`. Run `stalled` ou `repair_running` com sha órfão devolve `next_action: reconcile_state` em vez de só `unmet_dependencies`. Deps `done` / `manual_validation_pending` (DEC-014) permanecem.
