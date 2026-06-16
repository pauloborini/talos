# Procedimento de Patch, Bump e Release

Procedimento obrigatorio para qualquer IA/agente que altere este repo. Objetivo:
manter `main` instalavel, bundles sincronizados, npm publicavel e CI confiavel.

## 0. Regra principal

Nao declare pronto sem evidencia local. "Pronto" exige:

- versoes sincronizadas;
- changelog atualizado;
- catologos gerados (`plugins/`, `hosts/`);
- artefatos `.plugin` + `SHA256SUMS` validos;
- pacote npm inspecionado;
- working tree entendido;
- release/tag somente com autorizacao explicita.

`archive/` e `raycast/` nao entram no patch salvo pedido explicito.

## 1. Preflight obrigatorio

Antes de editar:

```bash
rtk git status --short --branch
rtk git log --oneline -8
rtk rg -n "0\\.8\\.|Plugin version|version|npm|release|CI|bump" VERSION package.json packages/mcp-server/package.json README.md COMMANDS.md CHANGELOG.md PATCH_PROCEDURE.md .github build packages/orchestrator .claude-plugin plugin-manifests
```

Se houver mudancas locais que voce nao fez, preserve. Nao reverta. Se afetarem o
patch, leia e incorpore.

## 2. Classifique o patch

- `runtime`: muda skill, comando, MCP, gates, roteamento, sub-agents ou comportamento.
- `packaging`: muda manifest, marketplace, estrutura de bundle, npm, `.plugin`, release.
- `docs`: muda docs sem alterar comportamento distribuido.
- `tooling`: muda scripts auxiliares, CI ou validadores.

Bump obrigatorio quando:

- `runtime` ou `packaging`;
- docs/tooling entram no artefato distribuido (`README`, `packages/orchestrator/**`,
  skills, templates, manifests, `build/cli/**`, `.npmignore`, `.github/release`);
- CI/release/npm muda e o usuario quer liberar nova versao.

Patch somente de doc interna pode nao bumpar, mas precisa changelog se afetar
procedimento operacional.

## 3. Escolha da versao

Use SemVer:

- patch (`X.Y.Z+1`): fix, confiabilidade, docs distribuidas, CI/release, npm.
- minor (`X.Y+1.0`): feature aditiva ou breaking pre-1.0 controlado.
- major: reservado para `1.0+`.

Se ja existem mudancas apos a versao atual publicada/planejada, nao reutilize a
mesma versao. Bump novo. Ex.: mudancas apos `0.8.1` => `0.8.2`.

## 4. Arquivos obrigatorios no bump

Atualizar manualmente:

- `VERSION`
- `package.json`
- `packages/mcp-server/package.json`
- `.claude-plugin/plugin.json`
- `README.md`
- `COMMANDS.md`
- `CHANGELOG.md`
- `PATCH_PROCEDURE.md` quando o procedimento mudar

Atualizar quando aplicavel:

- `packages/orchestrator/README.md`
- `packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`
- `packages/orchestrator/commands/workflow.md`
- `packages/orchestrator/references/**`
- `packages/templates/**`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.npmignore`
- `build/**`

Nao trocar `__VERSION__` em:

- `plugin-manifests/claude/plugin.json`
- `plugin-manifests/codex/plugin.json`

Esses manifests recebem versao por injecao em `build/build-plugins.sh`.

## 5. Changelog

Adicionar entrada no topo:

```md
## X.Y.Z - YYYY-MM-DD

Tipo: **runtime|packaging|docs|tooling**. **Sem/Com breaking**. Schema MCP: ...

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

Para `runtime`, tambem atualizar o changelog resumido no fim de
`packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md`.

Para `packaging`/npm/release, documentar se a publicacao depende de tag
`vX.Y.Z` e de `NPM_TOKEN`.

## 6. Regeneracao obrigatoria

Depois de qualquer bump ou mudanca em `packages/`, `plugin-manifests/`, `build/`,
`hooks/`, `README`, `COMMANDS`, `PATCH_PROCEDURE`, `.npmignore` ou `.github`:

```bash
rtk build/build-plugins.sh
```

O build deve regenerar:

- `dist/atlas-workflow-claude.plugin`
- `dist/atlas-workflow-codex.plugin`
- `dist/atlas-workflow-opencode.plugin`
- `dist/atlas-workflow-pi.plugin`
- `dist/SHA256SUMS`
- `plugins/atlas-workflow-orchestrator/**`
- `hosts/opencode/**`
- `hosts/pi/**`

Esses diretorios gerados entram no commit quando mudarem.

## 7. Validacao local obrigatoria

Rodar, nesta ordem:

```bash
rtk node build/check-consistency.mjs
rtk node --test packages/mcp-server/server.test.js
rtk node build/smoke-hosts.mjs
rtk node build/conformance-matrix.mjs
rtk shasum -a 256 -c SHA256SUMS   # dentro de dist/
```

Validar zips:

```bash
rtk unzip -t dist/atlas-workflow-claude.plugin
rtk unzip -t dist/atlas-workflow-codex.plugin
rtk unzip -t dist/atlas-workflow-opencode.plugin
rtk unzip -t dist/atlas-workflow-pi.plugin
```

Inspecionar manifests gerados:

```bash
rtk unzip -p dist/atlas-workflow-claude.plugin .claude-plugin/plugin.json
rtk unzip -p dist/atlas-workflow-codex.plugin .codex-plugin/plugin.json
rtk rg -n "\"version\": \"X.Y.Z\"|Plugin version:\\*\\* X.Y.Z|version: X.Y.Z|vX.Y.Z|X.Y.Z" VERSION package.json packages/mcp-server/package.json README.md COMMANDS.md CHANGELOG.md packages/orchestrator plugins hosts .claude-plugin
```

Se existir no host local:

```bash
rtk codex plugin validate ./ --strict
rtk claude plugin validate ./ --strict
```

Se algum subcomando nao existir, registrar no relatorio final. Nao inventar PASS.

## 8. Validacao npm obrigatoria

Usar cache temporario para evitar cache local root-owned:

```bash
rtk env npm_config_cache=/tmp/atlas-npm-cache npm pack --dry-run --json
rtk mkdir -p /tmp/atlas-npm-pack
rtk env npm_config_cache=/tmp/atlas-npm-cache npm pack --pack-destination /tmp/atlas-npm-pack
rtk env npm_config_cache=/tmp/atlas-npm-cache npm exec --yes --package /tmp/atlas-npm-pack/atlas-workflow-X.Y.Z.tgz -- atlas-workflow --help
rtk env npm_config_cache=/tmp/atlas-npm-cache npm exec --yes --package /tmp/atlas-npm-pack/atlas-workflow-X.Y.Z.tgz -- atlas-workflow init opencode --dry-run --dir /tmp/atlas-opencode-target
rtk env npm_config_cache=/tmp/atlas-npm-cache npm exec --yes --package /tmp/atlas-npm-pack/atlas-workflow-X.Y.Z.tgz -- atlas-workflow init codex --dry-run
```

Conferir registry antes de release:

```bash
rtk env npm_config_cache=/tmp/atlas-npm-cache npm view atlas-workflow version
rtk env npm_config_cache=/tmp/atlas-npm-cache npm view atlas-workflow@X.Y.Z version
```

`E404` para pacote novo e aceitavel antes da primeira publicacao. Versao existente
igual a `X.Y.Z` significa que `release.yml` deve pular publish npm por idempotencia.

## 9. CI e release externo

CI normal roda em push/PR:

- `build/build-plugins.sh`
- catologos from-source sem diff/untracked;
- testes MCP;
- smoke-hosts;
- conformance;
- checksums;
- runtime MCP em Windows/macOS.

Release so por tag:

```bash
rtk git tag -a vX.Y.Z -m "vX.Y.Z"
rtk git push origin <branch>
rtk git push origin vX.Y.Z
```

So criar/push tag quando o usuario autorizar explicitamente.

O workflow `.github/workflows/release.yml` deve:

1. validar `GITHUB_REF_NAME` (`vX.Y.Z`) contra `VERSION`;
2. rodar build;
3. extrair notas do `CHANGELOG.md` aceitando cabecalho `## X.Y.Z` ou `## vX.Y.Z`;
4. validar `.plugin` e checksums;
5. publicar npm com `NPM_TOKEN` + provenance;
6. publicar GitHub Release com 4 `.plugin` + `SHA256SUMS`.

Depois da tag, verificar:

```bash
rtk gh run list --workflow release.yml --limit 5
rtk env npm_config_cache=/tmp/atlas-npm-cache npm view atlas-workflow@X.Y.Z version
```

Se `gh` nao estiver autenticado, reportar blocker externo.

## 10. Relatorio final esperado

Responder com:

- versao final;
- arquivos principais alterados;
- validacoes executadas e resultado;
- status npm/registry;
- se tag/release foi ou nao criada;
- blockers externos, se houver.

## 11. Stop conditions

Pare e corrija antes de finalizar se:

- `VERSION`, `package.json`, `packages/mcp-server/package.json` ou manifests concretos divergem;
- `README`/`COMMANDS` apontam versao antiga;
- `Plugin version` em `packages/orchestrator/README.md` ou bundles aponta versao antiga;
- `build/check-consistency.mjs` falha;
- teste MCP, smoke ou conformance falha;
- checksum falha;
- `.plugin` ausente ou zip invalido;
- `npm pack` nao inclui `build/cli/atlas-init.mjs`, `hosts/` e `plugins/`;
- `npm exec` do tarball nao roda o bin;
- changelog nao tem entrada da versao;
- release externa foi pedida mas tag/push/publicacao nao foram autorizados;
- `main` ficaria nao instalavel.
