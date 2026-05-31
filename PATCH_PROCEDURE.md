# Procedimento de Patch

Use este procedimento em todo patch que altera o plugin, seus manifests, documentacao operacional ou artefato empacotado.

## Objetivo

Garantir que versionamento, changelog, fonte Claude, copia Codex, pacote `.plugin` e validacoes fiquem sempre sincronizados e rastreaveis.

## Classificacao do patch

Antes de editar, classifique:

- `runtime`: muda contrato da skill, comando, config, roteamento, gates, fluxo de sub-agents ou comportamento esperado.
- `packaging`: muda manifests, marketplace, estrutura do plugin ou pacote `.plugin`.
- `docs`: muda README, procedimento, exemplos ou instrucoes sem alterar comportamento do plugin.
- `tooling`: muda atalhos/snippets/scripts auxiliares.

Se o patch for `runtime` ou `packaging`, bump de versao do plugin e changelog sao obrigatorios.

Se o patch for `docs` ou `tooling`, changelog raiz e obrigatorio; bump do plugin so e obrigatorio se o artefato distribuido mudar.

## Pontos obrigatorios ao subir versao do plugin

Atualizar todos:

- `README.md`: tabela do plugin.
- `atlas-workflow-orchestrator/.claude-plugin/plugin.json`: campo `version`.
- `plugins/atlas-workflow-orchestrator/.codex-plugin/plugin.json`: campo `version`.
- `atlas-workflow-orchestrator/README.md`: `Plugin version`, `Last updated` se aplicavel, e bloco `Novidades vX.Y.Z`.
- `plugins/atlas-workflow-orchestrator/README.md`: mesmo conteudo do README fonte.
- `atlas-workflow-orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`: banner inicial se mencionar versao/contrato atual, e `Changelog`.
- `plugins/atlas-workflow-orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`: mesmo conteudo da skill fonte.
- `atlas-workflow-orchestrator/commands/workflow.md`: atualizar versao citada se o resumo dos gates/contrato mudou.
- `plugins/atlas-workflow-orchestrator/commands/workflow.md`: mesmo conteudo do comando fonte.
- `CHANGELOG.md`: entrada do patch, com tipo, impacto e arquivos afetados.

Atualizar se tocados:

- `atlas-workflow-orchestrator/atlas_workflows_config.md`.
- `plugins/atlas-workflow-orchestrator/atlas_workflows_config.md`.
- `.claude-plugin/marketplace.json`.
- `.agents/plugins/marketplace.json`.
- `raycast/README.md`.
- `raycast/atlas-workflow-snippets.json`.

## Regra de changelog

Todo patch precisa registrar:

- versao ou identificador do patch;
- data local;
- tipo (`runtime`, `packaging`, `docs`, `tooling`);
- resumo curto;
- mudancas objetivas;
- impacto no workflow;
- arquivos/artefatos atualizados;
- validacoes executadas.

Para patches `runtime`, registrar o mesmo resumo tambem no changelog da `SKILL.md`.

Para patches `packaging`, registrar tambem no README do plugin.

## Regra de sincronizacao

Sempre que editar arquivos sob `atlas-workflow-orchestrator/`, sincronizar o equivalente sob `plugins/atlas-workflow-orchestrator/`.

Pares que devem bater:

- `atlas-workflow-orchestrator/README.md`
- `plugins/atlas-workflow-orchestrator/README.md`
- `atlas-workflow-orchestrator/atlas_workflows_config.md`
- `plugins/atlas-workflow-orchestrator/atlas_workflows_config.md`
- `atlas-workflow-orchestrator/commands/workflow.md`
- `plugins/atlas-workflow-orchestrator/commands/workflow.md`
- `atlas-workflow-orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`
- `plugins/atlas-workflow-orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`

Os manifests sao intencionalmente diferentes por host:

- `atlas-workflow-orchestrator/.claude-plugin/plugin.json`
- `plugins/atlas-workflow-orchestrator/.codex-plugin/plugin.json`

## Regra de pacote

Se qualquer arquivo em `atlas-workflow-orchestrator/` mudar, regenerar:

```bash
zip -r atlas-workflow-orchestrator.plugin atlas-workflow-orchestrator
```

Depois validar:

```bash
rtk unzip -t atlas-workflow-orchestrator.plugin
rtk unzip -p atlas-workflow-orchestrator.plugin atlas-workflow-orchestrator/.claude-plugin/plugin.json
```

## Checklist de validacao

Rodar no minimo:

```bash
rtk jq . atlas-workflow-orchestrator/.claude-plugin/plugin.json
rtk jq . plugins/atlas-workflow-orchestrator/.codex-plugin/plugin.json
rtk unzip -t atlas-workflow-orchestrator.plugin
rtk diff -qr atlas-workflow-orchestrator/README.md plugins/atlas-workflow-orchestrator/README.md
rtk diff -qr atlas-workflow-orchestrator/atlas_workflows_config.md plugins/atlas-workflow-orchestrator/atlas_workflows_config.md
rtk diff -qr atlas-workflow-orchestrator/commands/workflow.md plugins/atlas-workflow-orchestrator/commands/workflow.md
rtk diff -qr atlas-workflow-orchestrator/skills/atlas-workflow-orchestrator/SKILL.md plugins/atlas-workflow-orchestrator/skills/atlas-workflow-orchestrator/SKILL.md
```

Rodar buscas direcionadas conforme o patch. Exemplos:

```bash
rtk rg -n "vX.Y.Z|Plugin version|version" .
rtk rg -n "antigravity|futuro|fallback|cross-family" atlas-workflow-orchestrator plugins/atlas-workflow-orchestrator README.md
```

## Template de entrada no changelog

```md
## vX.Y.Z - YYYY-MM-DD

Tipo: runtime|packaging|docs|tooling

Resumo: ...

Mudancas:
- ...

Impacto:
- ...

Arquivos/artefatos:
- ...

Validacao:
- ...
```

## Stop conditions

Pare e corrija antes de finalizar se:

- versao divergir entre manifests;
- README fonte divergir da copia Codex sem motivo;
- skill fonte divergir da copia Codex sem motivo;
- comando fonte divergir da copia Codex sem motivo;
- config fonte divergir da copia Codex sem motivo;
- changelog nao tiver entrada do patch;
- pacote `.plugin` estiver desatualizado depois de mudanca em `atlas-workflow-orchestrator/`.
