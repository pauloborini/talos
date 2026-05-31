# Atlas Workflow

Marketplace de plugins para orquestrar pipelines de desenvolvimento no ecossistema Atlas (PRD → validação → entrevista → plano → execução → review).

## Plugin

| Nome | Versão | Descrição |
|------|--------|-----------|
| `atlas-workflow-orchestrator` | 0.1.9 | Orquestrador com gates G1–G11 e roteamento por `<tool>` (`claude-*` / `cursor-*` / `codex-*`) |

## Estrutura

```
.claude-plugin/marketplace.json   # Claude Code marketplace
.agents/plugins/marketplace.json # Codex / Agents marketplace
atlas-workflow-orchestrator/     # Fonte do plugin (Claude)
plugins/atlas-workflow-orchestrator/  # Cópia para layout Codex
```

## Uso local (Claude Code)

1. **Marketplace por pasta** (desenvolvimento direto neste clone):

   ```bash
   claude plugin marketplace add /Volumes/Dados/projetos/atlas-workflow
   claude plugin install atlas-workflow-orchestrator@atlas-workflow
   ```

2. **Marketplace pelo GitHub** (mesmo conteúdo, atualizado via `git pull` no cache do Claude):

   ```bash
   claude plugin marketplace add pauloborini/atlas-workflow
   claude plugin install atlas-workflow-orchestrator@atlas-workflow
   ```

3. Comando: `/workflow <tool> <mode> <input-type> [flags]`

## Publicar atualizações

Antes de qualquer patch/versionamento, siga [PATCH_PROCEDURE.md](PATCH_PROCEDURE.md).

1. Edite em `atlas-workflow-orchestrator/` e sincronize `plugins/atlas-workflow-orchestrator/`.
2. Atualize manifests, changelog e README conforme o procedimento.
3. Regenere `atlas-workflow-orchestrator.plugin` quando a fonte do plugin mudar.
4. Commit, push para `main`.
5. No host alvo: atualize marketplace/reinstale para pegar a nova versão no cache.

## Repositório

https://github.com/pauloborini/atlas-workflow
