# Talos — Missão e Invariantes do Projeto

> Conhecimento permanente do projeto. Vale para qualquer sessão/agente que trabalhe neste repo. Estas regras têm precedência sobre conveniência ou velocidade.

## Missão

Talos é uma **pipeline de desenvolvimento determinística** (sprint §7 → plano → execução → validação fria), empacotada como plugin **público e gratuito** no GitHub, instalável por qualquer pessoa. Nasceu de skills usadas de forma manual e separada; o objetivo é **automatizar e tornar 100% determinístico**.

Duas metas inegociáveis, sempre juntas:

1. **Determinístico.** O pipeline decide por contrato (JSON, gates MCP, veredito estruturado), nunca por prosa ou improviso. Isolamento de contexto via subagente é parte do determinismo — sem ele, alucina em tarefa grande.
2. **Público e gratuito, usável por todos.** Está no GitHub público porque qualquer um pode usar. Logo: se a gente entrega algo mal feito que ninguém consegue instalar/usar, **quebra o propósito**. Qualidade de distribuição é requisito, não detalhe.

## Invariantes (o que "maneira correta" significa aqui)

1. **Não quebrar o que já funciona.** Toda expansão preserva o comportamento anterior. Breaking change só com bump de versão consciente + caminho de migração documentado. Regressão = falha, não trade-off.
2. **Sempre instalável e usável durante o desenvolvimento.** `main` é a base estável e instalável a qualquer momento (`claude plugin marketplace add pauloborini/talos`). Trabalho em progresso vive em feature branches; nunca deixa `main` num estado quebrado.
3. **Atualização simples.** Instalar e atualizar em 1–2 comandos. Sem passos manuais frágeis. Marketplace-from-source (GitHub público) é o caminho primário; artefato `.plugin`/release é secundário.
4. **Determinismo > alcance.** Host sem pré-requisito essencial (subagente + MCP) é **rejeitado no preflight (hard-fail)**, não degradado. Capability não-essencial (ex.: todo nativo) apenas segue sem o recurso. Warning não substitui garantia.
5. **Multi-host por adapter, núcleo portável no MCP.** Skills são host-agnósticas; variação de host vive em `talos_capabilities` (runtime) + `host-adapters.md` (doc) + manifesto de packaging. Tools nativas do cliente não são proxyáveis — o adapter descreve, não roteia.
6. **Validar antes de declarar pronto.** "Pronto" exige smoke real: build + `claude plugin validate ./ --strict` + instalação no host + `talos_ping` + dispatch do validator. Código verde no repo ≠ funciona no host.

## Estado atual (2026-08)

- Versão: `0.17.0`. **BREAKING (v0.16.0 — artefatos pré-0.16 não são suportados; iniciar backlog/sprint novo):** procedência por linha: coluna `Origem` na §7.1 do sprint file e nas decisões do backlog, campo `origin` obrigatório em cada `AC-*` (`usuario`/`derivado:<path>`/`premissa`); `premissa` não sustenta aceite de sprint `Must`/`P0`; `derivado:<path>` resolvido contra o disco; §4 `Discussão` obrigatória; entrevista estruturada no `talos-backlog-generator` (scan do rascunho em memória + `question_prompt`; resposta vira decisão `Origem: usuario`); revisão fria interna à skill (mandato em `references/COLD_BACKLOG_REVIEW_PROMPT.md`, dispatch incondicional por `subagent_dispatch`, regate dos gates sobre artefatos corrigidos, relatório ao chamador). Schema MCP v5 e topologia sibling/G4/dispatch intactos. Histórico — **BREAKING (v0.15.0, D19 — artefatos pré-v0.15 não são suportados; iniciar backlog/sprint novo):** aceite de produto atômico (`AC-*` no §7.3 com YAML `acceptance`, hierarquia AC⊃EVAL, selo §7 write-once); state schema v3 sem reader v1/v2 (`acceptance_results`/`proof_refs` por AC, oráculo mecânico T-outcome); status `manual_validation_pending` (satisfaz DEP; handoff só em `done`); relatório `.talos/manual-validation/` com sync MCP (`talos_sync_manual_validation`); flag `revalidation_required` (coluna 15 do backlog — flag, não status); review crítica obrigatória via `policy_manifest.critical_review`. Histórico — patch `0.14.2`: spawn MCP via `/bin/bash` + `run.sh` em `args[]` (paths com espaço) e `description` citada no frontmatter dos agents. Patch `0.14.1`: `talos_select_next_sprint` sem `gerar_prd` (`sprint_interview`/`plan_handoff`/`plan_execute` derivados do §7+PLAN). Base `0.14.0` **BREAKING de contrato documental** (schema MCP v5 intacto; topologia sibling/G4/dispatch intactos): o artefato `PRD_*.md` deixa de existir como etapa do pipeline; o sprint file absorve o **contrato de produto** na §7 ("Contrato de produto (congelado)") com decisões D*, cenários UX e aceite binário; contrato `aprovado` é write-once protegido por `Selo do contrato: sha256:<hash>`; `talos-prd-interview` → `talos-sprint-interview`; `talos_scan_prd` → `talos_scan_acceptance`; `talos-sprint-prd-generator` removido; `BOUNDARY_PRD_PLAN.md` → `BOUNDARY_SPRINT_PLAN.md`; `verifyTemplateConformance` aceita só `plan`; roteamento `full`/`direct`/`execute` não emite `prd_generator`/`PRD_*.md`; validador frio nota código contra a §7 do sprint file (não contra PRD). Histórico anterior: topologia **sibling-only** (v0.7.0, BREAKING de contrato `talos_capabilities` schema v3→v5); v0.7.1–v0.8.1 patches de confiabilidade; v0.10.0 backlog 2 camadas; v0.11.0 workaround ZCode; v0.12.0 rebranding atlas→Talos; v0.13.0 host VS Code.
- **Migração 0.13.x → 0.14.0:** (1) sprint files legados com §7 "Critérios candidatos para PRD" devem ganhar a §7 "Contrato de produto (congelado)" (decisões/UX/aceite vêm do PRD legado, se existir); (2) ao aprovar o contrato, gravar `Contrato status: aprovado` + `Selo do contrato` via `talos-sprint-interview` (ou regenerar selo com o utilitário de conformidade); (3) planos novos linkam `**Sprint file**` (não `**PRD**`); (4) PRDs existentes viram **insumo manual** para preencher a §7 e depois são arquivados fora do pipeline (não tocamos `archive/` automaticamente); (5) input tipo `prd` deixa de existir — trate como ideia/spec livre; (6) standalone passa a viver no **sprint file** (`Backlog link: Não aplicável (standalone)`), não em PRD.
- Oito hosts: **Claude Code**, **Cursor**, **Codex App**, **Antigravity (Gemini)**, **opencode**, **pi cli**, **zcode** e **VS Code**. Claude/Cursor/Codex via marketplace-from-source; Antigravity/opencode/pi/vscode via catálogo from-source (`hosts/`) com `build/install-host.sh` (1 comando). zcode via cache `~/.zcode/cli/plugins/cache/` (instalador `init zcode`) + ativação `/plugins enable` no host. pi exige deps externas `pi-mcp-adapter` + `pi-subagents` (DEC-005). zcode é Claude Agent SDK compat — `Agent(subagent_type)` + `TodoWrite` + MCP stdio nativos; sem deps externas; detecção via `env:ZCODE_PLUGIN_ROOT` (injetado pelo `.zcode-plugin/plugin.json`); PREREQ/JOIN `self_evident`, mas execução exige gate DISPATCH com `dispatch_mutable:true` quando a mutação do subagente for verificada. VS Code é Copilot Chat nativo com `runSubagent` + `manage_todo_list` + MCP (`mcp.json`); perfil `self_evident`; dispatch_capability `mutable` confirmado em produção. **Limitação do host zcode (v0.11.0):** sub-agentes de plugin (`subagent_type: "talos-*"`) não herdam conexões MCP do processo pai — bug do host, não do plugin. Workaround no adapter zcode: `subagent_dispatch.fallback.enabled:true` faz o orquestrador despachar `general-purpose` (nativo, herda MCP) lendo `agents/<name>.md` como system prompt. Isolamento sibling (Gate G4) preservado — ainda é subagente irmão isolado. Schema v5 mantido (campo aditivo).
- Camada de adapter: `talos_capabilities` (MCP, schema v5) detecta `claude`/`codex`/`opencode`/`pi`/`zcode`/`vscode`/`generic` (data-driven em `HOST_ADAPTERS`); `validator_dispatch.join { sync, confidence, mechanism }` por host (gate JOIN).
- Determinismo: gate PREREQ no `talos_preflight` é hard-fail (DEC-004). Hosts `must_report` (pi/generic) falham-fechado se o orquestrador não reportar `host_capabilities`; nativos (claude/codex/opencode/zcode/vscode) são `self_evident` para PREREQ/JOIN. Gate DISPATCH (DEC-008) bloqueia `full/direct/execute` em hosts com mutação desconhecida até `host_capabilities.dispatch_mutable:true`. `pass`/`pass_with_observations` do validador são terminais (só `fail` reabre loop).
- Backlog pós-v0.10.0: mestre enxuto (índice estratégico) em `.talos/backlog/BACKLOG_MESTRE_<produto>.md`; sprint files vivos em `.talos/backlog/sprints/SNN_<slug>.md` (fonte primária de contexto por sprint + contrato de produto §7 congelado); template canônico de sprint: `packages/templates/SPRINT_TEMPLATE.md`; boundary: `packages/templates/BOUNDARY_SPRINT_PLAN.md`; plano: `packages/templates/PLAN_TEMPLATE.md` (linka Sprint file).

## Produto — decisões vigentes

Vault: `_app-vault/`. Mapa: `_app-vault/INDEX.md`.
Fonte de verdade: `_app-vault/docs/decisions/<dominio>.md` — cada regra sob `### DEC-NNN`.

Domínios deste projeto:

- `pipeline` — missão, invariantes, topologia, aceite e contrato de produto
- `distribuicao` — install, hosts, packaging e versão
- `determinismo` — gates PREREQ/DISPATCH, adapters e join
- `artefatos` — backlog, sprint file e procedência 0.16

Regra de produto citada em qualquer outro lugar e ausente de `docs/decisions/` **não é regra** —
é lacuna a promover.

## Código — normas de implementação

Normas ao codar: invariantes e regras operacionais neste `AGENTS.md`, `PATCH_PROCEDURE.md` e validadores em `build/`.

Caso híbrido (a regra afeta o usuário **e** é validação de código): o **efeito observável pelo
usuário final** mora em `_app-vault/docs/decisions/`; a **norma de como implementar** mora aqui e em `build/`. Referenciar `DEC-NNN` — nunca copiar o valor.

## Regras operacionais

- Antes de mergear refactor estrutural em `main`: rodar `build/check-consistency.mjs` + `claude plugin validate ./ --strict`.
- `.claude-plugin/plugin.json` tem versão **concreta** sincronizada com `VERSION` (guard falha em drift).
- Não tocar `archive/`, `raycast/` salvo pedido explícito.
- Respostas, planos e artefatos em **pt-BR**.

