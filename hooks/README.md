Hooks opcionais de backstop para Claude Code.

Fonte primária continua sendo o MCP (`packages/mcp-server`). Estes hooks apenas antecipam bloqueios críticos no host Claude Code; ausência deles não invalida Cursor, Codex nem o workflow MCP.

## Instalação manual

1. Copie o bloco de `hooks/claude/settings.snippet.json` para o `settings.json` do Claude Code.
2. Troque `<ATLAS_WORKFLOW_REPO>` pelo path absoluto deste repo ou do plugin instalado.
3. Mantenha o comando apontando para `hooks/claude/atlas-workflow-hook.js`.

## Regras cobertas

- `PreToolUse`: bloqueia escrita de produto antes de `PLAN_*.md` validado em modo `full`.
- `PreToolUse`: bloqueia ação mutante enquanto a sessão está em fase de coordenação ou dispatch não executor.
- `Stop`: bloqueia encerramento com fase ativa, G11 pendente ou gate MCP bloqueado.

Mensagens de bloqueio mostram regra violada, impacto e próxima ação permitida. Se `.atlas-run` estiver ausente, o hook fica inativo. Se `.atlas-run` existir mas estiver ilegível/corrompido, o estado não é tratado como aprovado.
