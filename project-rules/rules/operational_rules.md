# RULES: OPERATIONAL

## Gates por boundary

Comandos reais do repositório. Cada gate define ID, comando, gatilho e resultado esperado.

| ID | Comando | Gatilho | Resultado esperado |
|---|---|---|---|
| `guard` | `node build/check-consistency.mjs` | qualquer diff em `packages/**`, `build/**`, `agents/**`, `hooks/**`, templates ou manifestos | zero erro; o guard também recusa skill que reensina schema morto (DR01–05) |
| `public-docs` | `node build/check-public-docs.mjs` | diff em `README`, `COMMANDS` ou docs públicos | zero PII, zero path de disco do autor |
| `unit` | `node --test packages/mcp-server/server.test.js` | diff no MCP ou em `packages/skills/_shared/scripts/**` | 100% verde |
| `guards-unit` | `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs build/tests/fixtures-s9.test.mjs` | diff nos gates de review/classificação | 100% verde |
| `smoke-hosts` | `node build/smoke-hosts.mjs` e `node build/conformance-matrix.mjs` | diff em adapter, capability ou host | boot + detecção + capabilities + ping verdes por host |
| `smoke-install` | `node build/smoke-install.mjs` | diff em instalador, manifesto ou catálogo | install/uninstall limpos por host |
| `bundle` | `bash build/build-plugins.sh` | **qualquer** mudança em `packages/`, `plugin-manifests/`, `build/`, `hooks/`, `README`, `COMMANDS`, `PATCH_PROCEDURE.md` ou `.npmignore` | `hosts/**` e `plugins/talos/**` regenerados e commitados quando mudarem |
| `checksums` | `(cd dist && shasum -a 256 -c SHA256SUMS)` | release | todos OK |
| `diff-check` | `git diff HEAD --check` | diff tracked | zero erro de whitespace/patch |
| `suite` | `bash build/test-all.sh` | fecho de release e de refactor estrutural | suíte completa verde (espelha o CI — é o único gate de qualidade local) |

- Gate estrutural não substitui análise estática; diff somente documental sem código não aciona `guard`/`unit`.
- Nunca declarar gate verde com comando falho, mesmo por baseline.

## Autocontenção

- Norma de engenharia mora em `AGENTS.md` ou em `project-rules/`.
- `project-rules/` **referencia** `DEC-NNN` do vault; nunca copia o valor.
- O runbook completo de bump/release é `PATCH_PROCEDURE.md` (raiz, versionado, público) — as normas abaixo não o substituem e nenhuma regra depende dele para *decidir*, apenas para *operar* o release. Mesmo status para `build/test-all.sh`, que é o agregador dos gates acima.
- Toda regra precisa ser alcançável por ao menos um índice em `project-rules/index/`.

## Bump, regeneração e release

- Classifique o patch: `runtime` (skill, comando, MCP, gate, roteamento, subagente), `packaging` (manifest, marketplace, bundle, npx, release), `docs`, `tooling`.
- Bump SemVer obrigatório para `runtime` e `packaging`, e para `docs`/`tooling` que entram no artefato distribuído. Mudança restrita a `build/` pode ir sem bump.
- Nunca reutilize versão já publicada; bump novo.
- Após bump ou mudança em `packages/`: `bash build/build-plugins.sh` e commit dos bundles que mudarem. Nunca editar bundle à mão.
- Release é **manual**: bump commitado na base → tag anotada `vX.Y.Z` no commit final validado → `gh release create` com `.plugin` e `SHA256SUMS`. Não existe workflow automático no repositório.
- Stop conditions: parar e corrigir se versões divergirem, se docs correntes apontarem versão antiga, se `guard`/`unit`/smoke/conformance/checksum falharem, se `.plugin` estiver ausente ou inválido, se o changelog não tiver a entrada da versão, ou se a base ficaria não instalável (DEC-010, DEC-011).

## Testes

- Teste só é criado ou executado quando o usuário pedir explicitamente. Analyzer, guard e smoke são gates, não testes para essa restrição.
- Teste que apenas cristaliza implementação ruim é anti-padrão; prefira invariante estrutural na origem.

## Falhas e baseline

- Corrija a falha que você introduziu ou que está dentro do boundary.
- Falha preexistente fora do boundary não autoriza refactor adjacente: registre comando e evidência, separe o baseline e classifique o resultado.

## Áreas intocáveis

- `archive/` e `raycast/` não entram em patch nem em refactor sem pedido explícito.
- Conteúdo gitignored de terceiros (`.app-work/references/`) nunca é insumo de regra.

## Fechamento

- Informe regras aplicadas, comandos executados, resultado e pendências.
- Classifique: `pronto`, `degradado mas utilizável` ou `precisa de follow-up`.
- Idioma de respostas, planos e artefatos: **PT-BR**.
- Commit, push, tag e release somente por pedido explícito.
- Commit de bundle só depois de `bash build/build-plugins.sh` — bundle defasado é gate reprovado, não atalho.
