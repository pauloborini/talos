# Atlas Workflow

Monorepo do plugin Atlas Workflow Orchestrator v0.2: skills, templates, MCP server e manifests dos hosts (Claude Code + Codex) num único pacote versionado.

**Versão atual:** veja [`VERSION`](VERSION) (`0.2.0-dev`).

## Estrutura

| Item | Papel |
|------|-------|
| [`packages/`](packages/) | Skills (`skills-{claude,cursor,codex}/`), templates canônicos e MCP server (S04+) |
| [`plugin-manifests/`](plugin-manifests/) | Manifests dos hosts (Claude Code + Codex) — preenchida em S02 |
| [`build/`](build/) | Script de build que gera os `.plugin` em `dist/` — preenchida em S02 |
| [`hooks/`](hooks/) | Hooks opcionais de backstop — preenchida em S11 |
| [`raycast/`](raycast/) | Snippets do Raycast (uso pessoal, independente do plugin v0.2) |
| [`archive/v0.1.10/`](archive/v0.1.10/) | Plugin v0.1.10 arquivado (rollback emergencial) |
| `.app-vault/` | Documentos de planejamento locais (gitignored) — backlog mestre vive aqui |
| [`VERSION`](VERSION) | Semver canônico do plugin |
| [`CHANGELOG.md`](CHANGELOG.md) | Histórico de releases |
| [`PATCH_PROCEDURE.md`](PATCH_PROCEDURE.md) | Procedimento de patch |

## Onde encontrar

- **Backlog mestre v0.2:** [`.app-vault/docs/BACKLOG_MESTRE.md`](.app-vault/docs/BACKLOG_MESTRE.md) (15 sprints, 14 decisões fechadas)
- **Templates canônicos (PRD, PLAN, BOUNDARY, BACKLOG, PERGUNTAS):** [`packages/templates/`](packages/templates/)
- **Plugin v0.1.10 (arquivado):** [`archive/v0.1.10/atlas-workflow-orchestrator/`](archive/v0.1.10/atlas-workflow-orchestrator/) — reinstalar via `claude plugin marketplace add <path>` para rollback

## Templates canônicos

`packages/templates/` é a fonte única dos templates empacotados no plugin v0.2. Skills de PRD, entrevista e plano devem resolver PRD, PLAN, boundary, backlog e perguntas por essa pasta do bundle antes de considerar qualquer arquivo do repo consumidor.

Se um template canônico exigido não existir no bundle, o workflow deve parar com erro explícito nomeando o template ausente. Não há fallback silencioso para cópias antigas, vault local ou templates globais.

## Repositório

https://github.com/pauloborini/atlas-workflow
