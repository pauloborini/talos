# Atlas Workflow Orchestrator — Missão e Invariantes do Projeto

> Conhecimento permanente do projeto. Vale para qualquer sessão/agente que trabalhe neste repo. Estas regras têm precedência sobre conveniência ou velocidade.

## Missão

Atlas é uma **pipeline de desenvolvimento determinística** (PRD → plano → execução → validação fria), empacotada como plugin **público e gratuito** no GitHub, instalável por qualquer pessoa. Nasceu de skills usadas de forma manual e separada; o objetivo é **automatizar e tornar 100% determinístico**.

Duas metas inegociáveis, sempre juntas:

1. **Determinístico.** O pipeline decide por contrato (JSON, gates MCP, veredito estruturado), nunca por prosa ou improviso. Isolamento de contexto via subagente é parte do determinismo — sem ele, alucina em tarefa grande.
2. **Público e gratuito, usável por todos.** Está no GitHub público porque qualquer um pode usar. Logo: se a gente entrega algo mal feito que ninguém consegue instalar/usar, **quebra o propósito**. Qualidade de distribuição é requisito, não detalhe.

## Invariantes (o que "maneira correta" significa aqui)

1. **Não quebrar o que já funciona.** Toda expansão preserva o comportamento anterior. Breaking change só com bump de versão consciente + caminho de migração documentado. Regressão = falha, não trade-off.
2. **Sempre instalável e usável durante o desenvolvimento.** `main` é a base estável e instalável a qualquer momento (`claude plugin marketplace add pauloborini/atlas-workflow`). Trabalho em progresso vive em feature branches; nunca deixa `main` num estado quebrado.
3. **Atualização simples.** Instalar e atualizar em 1–2 comandos. Sem passos manuais frágeis. Marketplace-from-source (GitHub público) é o caminho primário; artefato `.plugin`/release é secundário.
4. **Determinismo > alcance.** Host sem pré-requisito essencial (subagente + MCP) é **rejeitado no preflight (hard-fail)**, não degradado. Capability não-essencial (ex.: todo nativo) apenas segue sem o recurso. Warning não substitui garantia.
5. **Multi-host por adapter, núcleo portável no MCP.** Skills são host-agnósticas; variação de host vive em `atlas_capabilities` (runtime) + `host-adapters.md` (doc) + manifesto de packaging. Tools nativas do cliente não são proxyáveis — o adapter descreve, não roteia.
6. **Validar antes de declarar pronto.** "Pronto" exige smoke real: build + `claude plugin validate ./ --strict` + instalação no host + `atlas_ping` + dispatch do validator. Código verde no repo ≠ funciona no host.

## Estado atual (2026-06)

- Versão: `0.10.1`. Topologia **sibling-only** (v0.7.0, BREAKING de contrato `atlas_capabilities` schema v3→v5, sem mudança de comportamento de execução): validador frio é sempre sub-agent irmão; executor escreve `state_path` e para; orquestrador despacha `atlas-task-validator`. v0.7.1 = patch de confiabilidade (merge no `upsertState`, version-conflict só em lock real, banner por `artifact_kind`, G4 endurecido R17/R19). v0.7.2 = patch de confiabilidade (`ping().capabilities` derivado de `toolsList()`, CI cross-OS, `.gitattributes`). v0.8.0 = proof-of-work do validador frio (Gate G4 R20): `lock_validator(start)` emite challenge sha256 de arquivo do boundary, validador devolve `challenge_response`, `complete` recomputa do disco e bloqueia em divergência; re-dispatch de `challenge_failed` é bounded por attempt (`challenge_exhausted`, fail-closed) — atestação mecânica de leitura, não prova de isolamento não-forjável; schema v5 intacto. v0.8.1 = patch de confiabilidade de contrato (só SKILL/command, sem código MCP/schema): fire-and-continue (Princípio de continuação automática — só para em gate duro blocked ou blockage real) + decisão em aberto/Q- aberta não para (entrevista→propaga→continua) + novo Gate DEP (dependência de backlog não-done = hard-fail determinístico); fecha pausa discricionária do orquestrador (parava pra pedir confirmação não-exigida). Smoke S18 multi-host: Claude Code/Codex/Cursor/opencode PASS em tarefa real (2026-06-14); pi pendente.
- Seis hosts: **Claude Code**, **Cursor**, **Codex App**, **opencode**, **pi cli** e **zcode**. Claude/Cursor/Codex via marketplace-from-source; opencode/pi via catálogo from-source (`hosts/`) com `build/install-host.sh` (1 comando). zcode via cache `~/.zcode/cli/plugins/cache/` (instalador `init zcode`) + ativação `/plugins enable` no host. pi exige deps externas `pi-mcp-adapter` + `pi-subagents` (DEC-005). zcode é Claude Agent SDK compat — `Agent(subagent_type)` + `TodoWrite` + MCP stdio nativos; sem deps externas; detecção via `env:ZCODE_PLUGIN_ROOT` (injetado pelo `.zcode-plugin/plugin.json`); PREREQ/JOIN `self_evident`, mas execução exige gate DISPATCH com `dispatch_mutable:true` quando a mutação do subagente for verificada.
- Camada de adapter: `atlas_capabilities` (MCP, schema v5) detecta `claude`/`codex`/`opencode`/`pi`/`zcode`/`generic` (data-driven em `HOST_ADAPTERS`); `validator_dispatch.join { sync, confidence, mechanism }` por host (gate JOIN).
- Determinismo: gate PREREQ no `atlas_preflight` é hard-fail (DEC-004). Hosts `must_report` (pi/generic) falham-fechado se o orquestrador não reportar `host_capabilities`; nativos (claude/codex/opencode/zcode) são `self_evident` para PREREQ/JOIN. Gate DISPATCH (DEC-008) bloqueia `full/direct/execute` em hosts com mutação desconhecida até `host_capabilities.dispatch_mutable:true`. `pass`/`pass_with_observations` do validador são terminais (só `fail` reabre loop).
- Backlog pós-v0.5.0: `.app-vault/docs/BACKLOG_MESTRE_MULTIHOST.md`; template canônico de PRD: `packages/templates/PRD_TEMPLATE.md` (6 seções).

## Regras operacionais

- Antes de mergear refactor estrutural em `main`: rodar `build/check-consistency.mjs` + `claude plugin validate ./ --strict`.
- `.claude-plugin/plugin.json` tem versão **concreta** sincronizada com `VERSION` (guard falha em drift).
- Não tocar `archive/`, `raycast/` salvo pedido explícito.
- Respostas, planos e artefatos em **pt-BR**.
