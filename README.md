# Atlas Workflow

Monorepo do plugin Atlas Workflow Orchestrator v0.3: skills, templates, MCP server e manifests dos hosts (Claude Code/Cursor + Codex) num único pacote versionado.

**Versão atual:** veja [`VERSION`](VERSION) (`0.3.0`).

## Release v0.3.0

Artefatos oficiais:

| Host | Artefato | Observacao |
|------|----------|------------|
| Claude Code | `atlas-workflow-claude.plugin` | Instala o bundle completo e registra o MCP via manifest Claude. |
| Cursor | `atlas-workflow-claude.plugin` | Cursor herda o artefato Claude Code; nao ha pacote Cursor separado. |
| Codex | `atlas-workflow-codex.plugin` | Instala skills Codex e `.mcp.json` empacotado. |

Integridade: validar o arquivo baixado contra `SHA256SUMS`.

```bash
shasum -a 256 -c SHA256SUMS
```

Release GitHub: criar tag `v0.3.0` somente quando a publicacao externa estiver autorizada. O workflow `.github/workflows/release.yml` valida `VERSION`, roda `build/build-plugins.sh`, confere checksums e publica os dois `.plugin` com `SHA256SUMS`.

## Instalacao por host

Pre-requisitos comuns:

- Node.js disponivel no host que executa MCP.
- Artefato `.plugin` e `SHA256SUMS` da mesma release.
- Checksum validado antes da instalacao.

Claude Code:

1. Baixar `atlas-workflow-claude.plugin`.
2. Validar checksum.
3. Instalar pelo fluxo de plugin do Claude Code.
4. Confirmar que o MCP `atlas-workflow` responde com `atlas_ping`.

Cursor:

1. Usar o mesmo `atlas-workflow-claude.plugin`.
2. Validar checksum.
3. Instalar pelo fluxo de plugin compativel/herdado do Claude Code.
4. Confirmar que as skills resolvidas sao as do bundle v0.3.

Codex:

1. Baixar `atlas-workflow-codex.plugin`.
2. Validar checksum.
3. Instalar pelo fluxo de plugin do Codex.
4. Confirmar que `.mcp.json` aponta para `packages/mcp-server/server.js` e que `atlas_ping` responde.

Resultado esperado: `/workflow <mode> <input-type>` carrega o orquestrador v0.3, usa MCP como fonte de gates e despacha sub-agents `atlas-*`.

Atlas é família única. Cliente (Claude Code, Cursor, Codex App) é executor das skills, não família. Não há mais roteamento por família.

## Como funciona

| Skill | Input | Output | Proxima skill |
|-------|-------|--------|---------------|
| `atlas-sprint-prd-generator` | Sprint ID, backlog/roadmap, template PRD | `PRD_*.md` | `atlas-prd-interview` quando houver ambiguidades |
| `atlas-prd-interview` | PRD ou brainstorm | PRD validado/atualizado ou decisões pendentes | `atlas-plan-handoff` em `full`; executor em `direct` |
| `atlas-plan-handoff` | PRD aprovado, regras do repo, código real | `.atlas/plans/<id>.plan.md` | `atlas-plan-execute` |
| `atlas-plan-execute` | Plano executável | Diff, checks locais, `.atlas/state/<run_id>/<slice>.json` | `atlas-task-validator` |
| `atlas-direct-execute` | PRD/spec/tarefa escopada | Diff, checks locais, `.atlas/state/<run_id>/<slice>.json` | `atlas-task-validator` |
| `atlas-task-validator` | `state_path` | JSON `{verdict, findings, observations, boundary_violations}` | reparo pelo executor ou fechamento |
| `atlas-slice-review` | Plano, diff, validator passed, flag `--review` | Review fria da slice | fechamento |

State machine do executor:

```text
ready → implementing → gating → repairing → task_done → slice_validating → slice_done | blocked
```

Paths canônicos:

- Planos novos: `.atlas/plans/`
- Estado de run MCP: `.atlas/state/<run_id>/run.json`
- Boundary executor→validator: `.atlas/state/<run_id>/<slice>.json`

## Estrutura

| Item | Papel |
|------|-------|
| [`packages/`](packages/) | Skills `atlas-*`, templates canônicos e MCP server |
| [`agents/`](agents/) | Subagentes do plugin (`atlas-task-validator`) descobertos pelo host |
| [`plugin-manifests/`](plugin-manifests/) | Manifests dos hosts (Claude Code/Cursor + Codex) |
| [`build/`](build/) | Script de build que gera os `.plugin` em `dist/` |
| [`hooks/`](hooks/) | Hooks opcionais de backstop |
| [`raycast/`](raycast/) | Snippets do Raycast (uso pessoal, independente do plugin) |
| [`archive/v0.1.10/`](archive/v0.1.10/) | Plugin v0.1.10 arquivado (rollback emergencial) |
| `.app-vault/` | Documentos de planejamento locais (gitignored) — backlog mestre vive aqui |
| [`VERSION`](VERSION) | Semver canônico do plugin |
| [`CHANGELOG.md`](CHANGELOG.md) | Histórico de releases |
| [`PATCH_PROCEDURE.md`](PATCH_PROCEDURE.md) | Procedimento de patch |

## Onde encontrar

- **Backlog mestre v0.2:** [`.app-vault/docs/BACKLOG_MESTRE.md`](.app-vault/docs/BACKLOG_MESTRE.md) (15 sprints, 14 decisões fechadas)
- **Templates canônicos (PRD, PLAN, BOUNDARY, BACKLOG, PERGUNTAS):** [`packages/templates/`](packages/templates/)
- **MCP server mínimo:** [`packages/mcp-server/`](packages/mcp-server/) (`atlas_ping`, `atlas_run_state`, stdio)
- **Plugin v0.1.10 (arquivado):** [`archive/v0.1.10/atlas-workflow-orchestrator/`](archive/v0.1.10/atlas-workflow-orchestrator/) — reinstalar via `claude plugin marketplace add <path>` para rollback

## Templates canônicos

`packages/templates/` é a fonte única dos templates empacotados no plugin v0.3. Skills de PRD, entrevista e plano devem resolver PRD, PLAN, boundary, backlog e perguntas por essa pasta do bundle antes de considerar qualquer arquivo do repo consumidor.

Se um template canônico exigido não existir no bundle, o workflow deve parar com erro explícito nomeando o template ausente. Não há fallback silencioso para cópias antigas, vault local ou templates globais.

## Repositório

https://github.com/pauloborini/atlas-workflow
