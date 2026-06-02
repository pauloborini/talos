# Procedimento de Patch

Use este procedimento em todo patch que altera o plugin, seus manifests, documentacao operacional ou artefato empacotado da linha v0.2.

## Objetivo

Garantir que versionamento, changelog, manifests por host, pacotes `.plugin`, checksums e validacoes fiquem sempre sincronizados e rastreaveis.

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

- `VERSION`: semver publico unico.
- `README.md`: versao atual, artefatos, instalacao e resultado esperado.
- `plugin-manifests/claude/plugin.json`: manter `__VERSION__` injetavel pelo build.
- `plugin-manifests/codex/plugin.json`: manter `__VERSION__` injetavel pelo build.
- `packages/orchestrator/README.md`: atualizar se o contrato do orquestrador mudar.
- `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`: atualizar banner/changelog se o runtime mudar.
- `packages/orchestrator/commands/workflow.md`: atualizar se o resumo dos gates/contrato mudar.
- `CHANGELOG.md`: entrada do patch, com tipo, impacto, arquivos afetados e validacoes.
- `dist/atlas-workflow-claude.plugin`, `dist/atlas-workflow-codex.plugin` e `dist/SHA256SUMS`: regenerar via `build/build-plugins.sh`.

Atualizar se tocados:

- `packages/orchestrator/atlas_workflows_config.md`.
- `packages/orchestrator/defaults/**`.
- `packages/orchestrator/references/**`.
- `.github/workflows/release.yml`.
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

Para patches `runtime`, registrar o mesmo resumo tambem no changelog da `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`.

Para patches `packaging`, registrar tambem no README do plugin.

## Regra de sincronizacao

`packages/` e a raiz do repo sao a fonte unica da v0.2. `archive/v0.1.10/` e rollback historico e nao deve ser sincronizado em patches v0.2.

Os manifests sao intencionalmente diferentes por host e recebem a versao por injecao no build:

- `plugin-manifests/claude/plugin.json`
- `plugin-manifests/codex/plugin.json`

O manifest de marketplace-from-source (instalacao via GitHub publico) tem versao **concreta**, lida crua pelos hosts sem build:

- `.claude-plugin/marketplace.json` (catalogo Claude Code / Cursor)
- `.claude-plugin/plugin.json` (`version` deve casar com `VERSION`)
- `.agents/plugins/marketplace.json` (catalogo Codex)
- `plugins/atlas-workflow-orchestrator/` (bundle Codex gerado pelo build; commitar junto com bump de versao)
- `plugins/atlas-workflow-orchestrator/.codex-plugin/plugin.json` (`version` deve casar com `VERSION`)

O guard `build/check-consistency.mjs` falha em drift de versao nos manifests from-source.

Ao bumpar `VERSION`, atualizar `version` em `.claude-plugin/plugin.json` e regenerar `plugins/atlas-workflow-orchestrator/` via `build/build-plugins.sh`.

## Regra de pacote

Se qualquer arquivo em `packages/`, `plugin-manifests/`, `build/`, `hooks/`, docs de instalacao/release ou contrato empacotado mudar, regenerar:

```bash
rtk build/build-plugins.sh
```

Incluir no commit o diretorio `plugins/atlas-workflow-orchestrator/` (marketplace Codex from-source no GitHub).

Depois validar:

```bash
(cd dist && rtk shasum -a 256 -c SHA256SUMS)
rtk unzip -t dist/atlas-workflow-claude.plugin
rtk unzip -t dist/atlas-workflow-codex.plugin
rtk unzip -p dist/atlas-workflow-claude.plugin .claude-plugin/plugin.json
rtk unzip -p dist/atlas-workflow-codex.plugin .codex-plugin/plugin.json
```

Release operacional:

1. Fechar PR/commit com build e checksums atualizados.
2. Criar tag anotada `vX.Y.Z` apenas quando release externa estiver autorizada.
3. Push da tag aciona `.github/workflows/release.yml`.
4. Conferir que os assets publicados sao `atlas-workflow-claude.plugin`, `atlas-workflow-codex.plugin` e `SHA256SUMS`.
5. Conferir checksum dos assets baixados contra `SHA256SUMS`.

## Checklist de validacao

Rodar no minimo:

```bash
rtk build/build-plugins.sh
(cd dist && rtk shasum -a 256 -c SHA256SUMS)
rtk unzip -t dist/atlas-workflow-claude.plugin
rtk unzip -t dist/atlas-workflow-codex.plugin
rtk unzip -p dist/atlas-workflow-claude.plugin .claude-plugin/plugin.json
rtk unzip -p dist/atlas-workflow-codex.plugin .codex-plugin/plugin.json
```

Rodar buscas direcionadas conforme o patch. Exemplos:

```bash
rtk rg -n "vX.Y.Z|version|0\\.2\\." .
rtk rg -n "standalone|marketplace|Cursor|checksum|SHA256SUMS" README.md PATCH_PROCEDURE.md CHANGELOG.md
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

- `VERSION` divergir da tag de release;
- versao injetada divergir entre manifests gerados;
- checksums ausentes ou invalidos;
- artefato Claude/Cursor ou Codex ausente;
- changelog nao tiver entrada do patch;
- pacote `.plugin` estiver desatualizado depois de mudanca no bundle;
- release externa for necessaria sem autorizacao explicita para tag/push/publicacao.
