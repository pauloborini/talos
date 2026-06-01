# Defaults de paths

Estes defaults viajam no pacote do plugin. O workflow não exige `atlas_workflows_config.md` na raiz do repositório usuário.

## Config

1. Usar `atlas_workflows_config.md` empacotado no plugin.
2. Usar `defaults/` e `references/` empacotados no plugin.
3. Só considerar arquivos equivalentes no workspace quando o usuário apontar explicitamente.

## Artefatos

| Artefato | Default |
|----------|---------|
| PRD | path informado pelo usuário; senão diretório do backlog/template encontrado pela skill geradora |
| PLAN | mesmo diretório do PRD, salvo se a skill de handoff resolver path mais específico |
| Evidência de execução | relatório emitido pelo executor + diff real do workspace |

## Regra

Path específico de produto/repo nunca é obrigatório no orquestrador. Skills de PRD/plano podem descobrir templates/backlog no workspace, mas ausência de layout específico não muda a família nem autoriza implementação inline.
