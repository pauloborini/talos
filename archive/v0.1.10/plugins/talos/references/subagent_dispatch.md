# Despacho de sub-agent

Contrato host-agnóstico para Cursor, Codex e Claude Code.

## Regra central

Cada fase mapeada a um `skill_id` em `talos_workflows_config.md` roda em sub-agent foreground, blocking, um por vez.

A primeira ação do sub-agent deve ser carregar o `SKILL.md` completo do `skill_id` resolvido. Depois disso ele executa a skill.

Proibido:

- "aja como `<skill_id>`" sem carregar o `SKILL.md`;
- copiar resumo da skill para substituir a leitura real;
- executar plano/código/review no fio do orquestrador.

Equivalente aceito: mecanismo nativo do host que injete a skill completa no sub-agent.

## Payload mínimo

- `skill_id`
- `skill_md_path` ou indicação nativa equivalente da skill
- `prd_path` / `plan_path` / flags da fase
- instrução: "primeira ação: carregar a skill completa; segunda ação: executar a skill"

## Descoberta de `SKILL.md`

1. Mecanismo nativo de skills do host.
2. Diretório local de skills do host.
3. Workspace, apenas como fallback de descoberta.

Se não encontrar a skill da família pedida por `<tool>`, abortar. Não trocar família. Não emular inline.
