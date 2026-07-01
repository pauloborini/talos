# Procedimento de Patch, Bump e Release

Procedimento obrigatorio para qualquer IA/agente que altere este repo. Objetivo:
manter `main` instalavel, bundles sincronizados, `npx github` funcional e CI confiavel.

## 0. Regra principal

Nao declare pronto sem evidencia local. "Pronto" exige:

- versoes sincronizadas;
- changelog atualizado;
- catologos gerados (`plugins/`, `hosts/`);
- artefatos `.plugin` + `SHA256SUMS` validos;
- pacote tarball/npx inspecionado;
- working tree entendido;
- release e full-auto: bumpar `VERSION` na `main` cria tag + GitHub Release
  sozinho (secao 9). Logo, so subir bump de `VERSION` na `main` com o patch
  inteiro pronto e validado — o push e a propria autorizacao de publicar release.

`archive/` e `raycast/` nao entram no patch salvo pedido explicito.

## 1. Preflight obrigatorio

Antes de editar:

```bash
rtk git status --short --branch
rtk git log --oneline -8
rtk rg -n "Plugin version|version|npm|release|CI|bump" VERSION package.json packages/mcp-server/package.json README.md COMMANDS.md CHANGELOG.md PATCH_PROCEDURE.md .github build packages/orchestrator .claude-plugin plugin-manifests
```

Se houver mudancas locais que voce nao fez, preserve. Nao reverta. Se afetarem o
patch, leia e incorpore.

## 2. Classifique o patch

- `runtime`: muda skill, comando, MCP, gates, roteamento, sub-agents ou comportamento.
- `packaging`: muda manifest, marketplace, estrutura de bundle, npx/tarball, `.plugin`, release.
- `docs`: muda docs sem alterar comportamento distribuido.
- `tooling`: muda scripts auxiliares, CI ou validadores.

Bump obrigatorio quando:

- `runtime` ou `packaging`;
- docs/tooling entram no artefato distribuido (`README`, `packages/orchestrator/**`,
  skills, templates, manifests, `build/cli/**`, `.npmignore`, `.github/release`);
- CI/release/npx muda e o usuario quer liberar nova versao.

Patch somente de doc interna pode nao bumpar, mas precisa changelog se afetar
procedimento operacional.

## 3. Escolha da versao

Use SemVer:

- patch (`X.Y.Z+1`): fix, confiabilidade, docs distribuidas, CI/release, npx.
- minor (`X.Y+1.0`): feature aditiva ou breaking pre-1.0 controlado.
- major: reservado para `1.0+`.

Se ja existem mudancas apos a versao atual publicada/planejada, nao reutilize a
mesma versao. Bump novo. Ex.: mudancas apos `0.8.1` => `0.8.2`.

## 4. Arquivos obrigatorios no bump

Caminho automatico (preferido). Roda o bump determinístico, que sincroniza os
arquivos com versao concreta, regenera bundles/catalogos e roda check-consistency:

```bash
rtk node build/bump-version.mjs <nova-versao>   # ex.: 0.8.3
```

Ele toca:

- `VERSION`
- `plugins/talos/VERSION`
- `hosts/pi/talos/VERSION`
- `hosts/opencode/.opencode/talos/VERSION`
- `package.json`
- `packages/mcp-server/package.json`
- `.claude-plugin/plugin.json`
- `README.md`
- `COMMANDS.md`
- `packages/mcp-server/README.md`
- linha `**Plugin version:**` de `packages/orchestrator/README.md`
- manifests e READMEs concretos em `plugins/talos/**`
- manifests e READMEs concretos em `hosts/pi/**`
- manifests e READMEs concretos em `hosts/opencode/**`
- linhas `Versão: \`X.Y.Z\`` em `CLAUDE.md` e `AGENTS.md`

Tambem regenera bundles/catalogos via `build/build-plugins.sh` e roda
`build/check-consistency.mjs`. NAO toca `CHANGELOG.md`, `PATCH_PROCEDURE.md` nem
a secao `### Novidades vX` do orchestrator README (prosa/exemplos historicos) —
esses seguem manuais.

Atualizar manualmente (sempre):

- `CHANGELOG.md` (entrada da nova versao — secao 5);
- `packages/orchestrator/README.md` (secao `### Novidades vX` + `Last updated`);
- `PATCH_PROCEDURE.md` quando o procedimento mudar.

Se rodar o bump a mao em vez do script, atualizar:

- `VERSION`
- `plugins/talos/VERSION`
- `hosts/pi/talos/VERSION`
- `hosts/opencode/.opencode/talos/VERSION`
- `package.json`
- `packages/mcp-server/package.json`
- `.claude-plugin/plugin.json`
- `README.md`
- `COMMANDS.md`
- `CLAUDE.md`
- `AGENTS.md`
- manifests e READMEs concretos em `plugins/talos/**`
- manifests e READMEs concretos em `hosts/pi/**`
- manifests e READMEs concretos em `hosts/opencode/**`

Atualizar quando aplicavel:

- `packages/orchestrator/README.md`
- `packages/orchestrator/skills/talos/SKILL.md`
- `packages/orchestrator/commands/talos.md`
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
`packages/orchestrator/skills/talos/SKILL.md`.

Para `packaging`/npx/release, documentar se a publicacao depende de tag
`vX.Y.Z`. Publicacao npm registry esta desativada por contrato; `package.json`
deve manter `private: true` enquanto isso valer.

## 6. Regeneracao obrigatoria

Depois de qualquer bump ou mudanca em `packages/`, `plugin-manifests/`, `build/`,
`hooks/`, `README`, `COMMANDS`, `PATCH_PROCEDURE`, `.npmignore` ou `.github`:

```bash
rtk build/build-plugins.sh
```

O build deve regenerar:

- `dist/talos-claude.plugin`
- `dist/talos-codex.plugin`
- `dist/talos-opencode.plugin`
- `dist/talos-pi.plugin`
- `dist/SHA256SUMS`
- `plugins/talos/**`
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
rtk unzip -t dist/talos-claude.plugin
rtk unzip -t dist/talos-codex.plugin
rtk unzip -t dist/talos-opencode.plugin
rtk unzip -t dist/talos-pi.plugin
```

Inspecionar manifests gerados:

```bash
rtk unzip -p dist/talos-claude.plugin .claude-plugin/plugin.json
rtk unzip -p dist/talos-codex.plugin .codex-plugin/plugin.json
rtk rg -n "\"version\": \"X.Y.Z\"|Plugin version:\\*\\* X.Y.Z|version: X.Y.Z|vX.Y.Z|X.Y.Z" VERSION package.json packages/mcp-server/package.json README.md COMMANDS.md CHANGELOG.md packages/orchestrator plugins hosts .claude-plugin
rtk rg -n "<versao-antiga>" . --glob '!archive/**' --glob '!raycast/**' --glob '!node_modules/**'
```

No ultimo comando, substitua `<versao-antiga>` pela versao anterior real. Deve
retornar apenas historicos esperados (`CHANGELOG.md`, `reports/**` etc.).
Qualquer doc corrente com versao antiga e drift de bump.

Se existir no host local:

```bash
rtk codex plugin validate ./ --strict
rtk claude plugin validate ./ --strict
```

Se algum subcomando nao existir, registrar no relatorio final. Nao inventar PASS.

## 8. Validacao npx/tarball obrigatoria

Usar cache temporario para evitar cache local root-owned. Isto valida o caminho
`npx github:pauloborini/talos ...` sem publicar no npm registry:

```bash
rtk env npm_config_cache=/tmp/talos-npm-cache npm pack --dry-run --json
rtk mkdir -p /tmp/talos-npm-pack
rtk env npm_config_cache=/tmp/talos-npm-cache npm pack --pack-destination /tmp/talos-npm-pack
rtk env npm_config_cache=/tmp/talos-npm-cache npm exec --yes --package /tmp/talos-npm-pack/talos-X.Y.Z.tgz -- talos --help
rtk env npm_config_cache=/tmp/talos-npm-cache npm exec --yes --package /tmp/talos-npm-pack/talos-X.Y.Z.tgz -- talos init opencode --dry-run --dir /tmp/talos-opencode-target
rtk env npm_config_cache=/tmp/talos-npm-cache npm exec --yes --package /tmp/talos-npm-pack/talos-X.Y.Z.tgz -- talos init codex --dry-run
```

Nao consultar registry npm como gate. O pacote `talos` permanece privado no
`package.json` e nao deve ser publicado no npm enquanto a distribuicao oficial
for apenas `npx github:pauloborini/talos`.

## 9. CI e release externo

CI normal roda em push/PR:

- `build/build-plugins.sh`
- catologos from-source sem diff/untracked;
- testes MCP;
- smoke-hosts;
- conformance;
- checksums;
- runtime MCP em Windows/macOS.

Release e FULL AUTO. O caminho primario e empurrar o bump de `VERSION` para a
`main` — isso, por si so, cria tag + GitHub Release. NAO precisa criar tag a
mao; a action cria a tag `vX.Y.Z`. Logo: subir um `VERSION` novo na `main` E o
ato de autorizar a publicacao da release. Nao bumpar `VERSION` na `main` sem o
CHANGELOG da versao pronto (a release falha-fecha se faltar a entrada).

```bash
# fluxo full-auto: bump na main publica GitHub Release sozinho
rtk node build/bump-version.mjs X.Y.Z
# (editar CHANGELOG + Novidades, revisar, commitar)
rtk git push origin main          # => Release dispara: tag + GitHub Release
```

`build/bump-version.mjs` NAO cria tag local. Se houver tag local `vX.Y.Z` criada
antes do commit, apagar e recriar depois do commit ou preferir o fluxo full-auto.
Tag apontando para commit pre-bump quebra a publicacao.

Override manual por tag (hotfix fora da main / re-release) continua valendo,
mas a tag deve apontar para o commit final ja validado:

```bash
rtk git tag -a vX.Y.Z -m "vX.Y.Z" && rtk git push origin vX.Y.Z
```

Mudancas so em `.github/`, `build/` ou `PATCH_PROCEDURE.md` (fora do artefato
distribuido) podem ir pra `main` SEM bumpar `VERSION`. O workflow roda em push
na `main`, mas o job `decide` pula publicacao se a tag da versao atual ja existir.

O workflow `.github/workflows/release.yml` deve:

1. job `decide`: derivar a versao (da tag, ou de `VERSION` no push da main) e
   pular se a tag `vX.Y.Z` ja existe; guard `VERSION` == `package.json.version`;
2. job `release` (so se `decide` liberar): build + check-consistency;
3. guards de qualidade (testes MCP + smoke-hosts + conformance) antes de publicar release;
4. extrair notas do `CHANGELOG.md` aceitando cabecalho `## X.Y.Z` ou `## vX.Y.Z`
   (falha-fecha se ausente);
5. validar `.plugin` e checksums;
6. publicar GitHub Release com 5 `.plugin` + `SHA256SUMS` (cria a tag se ausente).

Depois do push/tag, verificar:

```bash
rtk gh run list --workflow release.yml --limit 5
```

Se `gh` nao estiver autenticado, reportar blocker externo.

## 10. Relatorio final esperado

Responder com:

- versao final;
- arquivos principais alterados;
- validacoes executadas e resultado;
- status npx/tarball;
- se tag/release foi ou nao criada;
- blockers externos, se houver.

## 11. Stop conditions

Pare e corrija antes de finalizar se:

- `VERSION`, `package.json`, `packages/mcp-server/package.json` ou manifests concretos divergem;
- `README`/`COMMANDS` apontam versao antiga;
- `AGENTS.md`/`CLAUDE.md` apontam versao antiga;
- `Plugin version` em `packages/orchestrator/README.md` ou bundles aponta versao antiga;
- `build/check-consistency.mjs` falha;
- teste MCP, smoke ou conformance falha;
- checksum falha;
- `.plugin` ausente ou zip invalido;
- `npm pack` nao inclui `build/cli/talos-init.mjs`, `hosts/` e `plugins/`;
- `npm exec` do tarball nao roda o bin;
- changelog nao tem entrada da versao;
- release externa foi pedida mas tag/push/publicacao nao foram autorizados;
- `main` ficaria nao instalavel.
