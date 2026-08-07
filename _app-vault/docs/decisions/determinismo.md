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
