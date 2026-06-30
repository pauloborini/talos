# NAMING — Decisão de Marca do Ecossistema Atlas

> Decisão de produto cross-repo. Registrada aqui (raiz de `atlas-workflow`) por ser
> o repo onde a conversa aconteceu; deve ser copiada/linkada no repo `atlas-cortex`
> (e, no futuro, no repo de Athena) para que qualquer sessão/agente que trabalhe em
> qualquer um dos repos veja a mesma convenção.

## DEC-ECO-001 — Atlas é guarda-chuva, não nome de produto técnico

**Data**: 2026-06-30
**Dono**: Paulo

**Decisão**: "Atlas" é o nome do **ecossistema** (marca/guarda-chuva), não aparece
mais nos nomes técnicos dos produtos individuais (server name, tool prefix, skill
prefix, bin CLI, nome de pacote npm, nome de plugin). Cada subproduto recebe um
codinome mitológico próprio.

**Motivo**: dois MCPs com "Atlas" no nome (e um terceiro a caminho) faziam agentes
confundirem qual produto usar — não havia colisão técnica de tool name (cada um já
namespaceava diferente), mas colisão conceitual: "Atlas" repetido em todo lugar
não dá ao agente (nem ao humano) um gancho de memória para diferenciar produto.

**Mapeamento fechado**:

| Codinome | Produto | Função | Repo |
|---|---|---|---|
| **Argus** | code retrieval / context packing local | gigante de 100 olhos, nunca dorme — fit com daemon de auto-sync e indexação contínua | `atlas-cortex` (a renomear) |
| **Talos** | pipeline determinística PRD→plano→execução→validação | autômato de bronze, executa regra fixa sem desvio — fit com determinismo/gates duros, sem improviso | `atlas-workflow` (este repo) |
| **Athena** | documentação contínua / dossiês de feature (futuro, ainda não existe) | deusa da sabedoria/estratégia — fit com conhecimento acumulado do projeto | a criar |

**Impacto**: rename técnico em 2 repos existentes (planos abaixo) + reserva de nome
para o terceiro produto quando ele nascer.

---

## Plano de rename 1 — `atlas-workflow` → Talos

**Diferença crítica em relação ao Argus**: este produto **tem usuário real**
(instalado via marketplace por quem quer que seja, ainda que hoje seja só o
Paulo) e o CLAUDE.md deste repo declara invariante **"não quebrar o que já
funciona"** + **"main sempre instalável"**. Rename aqui não é find-replace livre:
é breaking change versionado com caminho de migração para instalações existentes.

### Escopo técnico (levantado por exploração, não executado ainda)

A duplicação física é o multiplicador de esforço: o conteúdo fonte vive em
`packages/` e é fisicamente copiado (não symlink) para `plugins/atlas-workflow-orchestrator/`
e para `hosts/{opencode,pi,zcode}/`. **Toda string a trocar deve ser trocada na
fonte (`packages/`) e re-sincronizada via `build/build-plugins.sh` +
`build/install-host.sh`** — nunca editada nas 5 cópias à mão.

| # | O quê | Onde (fonte) | Vira |
|---|---|---|---|
| 1 | Prefixo de tool MCP | `packages/mcp-server/server.js` (~4991 linhas, tool defs a partir de ~4569) | `atlas_*` → `talos_*` |
| 2 | Nome do server MCP (chave de config) | `.claude-plugin/plugin.json`, `.mcp.json`, `build/cli/atlas-init.mjs` (`mergeServerInto(..., 'atlas-workflow', ...)`) | `mcpServers.atlas-workflow` → `mcpServers.talos` |
| 3 | Nome do plugin | `.claude-plugin/plugin.json` (`name`), `plugin-manifests/{claude,codex,zcode}/plugin.json`, `hosts/zcode/.zcode-plugin/plugin.json` | `atlas-workflow-orchestrator` → `talos` |
| 4 | Nome do marketplace | `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json` | `atlas-workflow` → `talos` |
| 5 | 11 skills `atlas-*` | `packages/skills/*`, `packages/orchestrator/skills/atlas-workflow-orchestrator/` | `atlas-plan-execute`→`talos-plan-execute` (e as outras 9), `atlas-workflow-orchestrator`→`talos` (skill orquestradora, nome coincide com o produto) |
| 6 | Scope npm | `package.json`, `packages/mcp-server/package.json` (`@atlas-workflow/mcp-server`) | `@atlas-workflow/*` → `@talos/*` |
| 7 | Bin CLI público | `package.json` (`bin`), `build/cli/atlas-init.mjs` | `atlas-workflow` → `talos` |
| 8 | `REPO_SLUG`/`PLUGIN_ID`/`ZCODE_PLUGIN_NAME` hardcoded | `build/cli/atlas-init.mjs` linhas 21-22, 584 | atualizar para novo slug/nome |
| 9 | Guards de build hardcoded | `build/check-consistency.mjs` (regex de frontmatter, `MCP_SERVER` literal linha 148), `build/bump-version.mjs`, `build/build-plugins.sh` (artefato `atlas-workflow-${host}.plugin`), `build/install-host.sh` | atualizar todos os 4 scripts — **se esquecidos, quebram silenciosamente, não dão erro óbvio** |
| 10 | Repo GitHub | `origin = github.com/pauloborini/atlas-workflow` | **decisão em aberto** — ver abaixo |

### Decisão em aberto: renomear o repo GitHub também?

`DEC-009` (já registrada) fixou `npx github:pauloborini/atlas-workflow init <host>`
como instalador público recomendado. Se o repo for renomeado:
- GitHub redireciona URLs antigas automaticamente por tempo indeterminado (mitiga, não resolve permanentemente).
- `REPO_SLUG` em `atlas-init.mjs` muda de qualquer forma — é código, não só doc.
- Consistente: nome do produto = nome do repo = menos confusão futura.

Se o repo **não** for renomeado: nome técnico do produto (Talos) fica
dessincronizado do slug do repo (atlas-workflow) — funciona, mas é a mesma
categoria de confusão que motivou este documento, só que entre repo e produto
em vez de entre produtos. **Recomendação: renomear o repo também.**

### Migração para instalações existentes (não pular)

A chave `mcpServers.atlas-workflow` em configs já escritas em máquinas (incluindo
a do Paulo) precisa de lógica de migração em `atlas-init.mjs`: detectar chave
antiga, remover, escrever a nova — não deixar o usuário com 2 entradas ou uma
órfã. Isso é trabalho de código, não só rename de string.

### Sequenciamento recomendado

1. Bump de versão consciente (breaking, conforme invariante 1 do CLAUDE.md) — sugestão `1.0.0` (rename de marca é, semanticamente, o tipo de marco que justifica sair do `0.x`).
2. Editar fonte em `packages/` (tool prefix, skills, package.json, scripts de build).
3. Re-rodar `build/build-plugins.sh` + `build/install-host.sh` para resincronizar as 4 cópias derivadas.
4. Atualizar os 4 scripts de build/consistência (item 9 da tabela).
5. Adicionar lógica de migração de chave de config em `atlas-init.mjs`.
6. `build/check-consistency.mjs` + `claude plugin validate ./ --strict` (gate do invariante 6 do CLAUDE.md).
7. Smoke real: install em pelo menos Claude Code + 1 host adicional, `atlas_ping`→`talos_ping`, dispatch do validator.
8. Só então: renomear repo GitHub (se decidido), atualizar README/CHANGELOG/docs.
9. Branch feature, nunca direto em `main` (invariante 2).

---

## Plano de rename 2 — `atlas-cortex` → Argus

**Sem usuário externo, sem landing page, sem divulgação** → rename livre, sem
necessidade de migração ou compat shim. Estrutura: monorepo workspace, pacote
real em `packages/cortex/` (não na raiz).

| # | O quê | Onde | Vira |
|---|---|---|---|
| 1 | Nome do pacote npm (raiz + `packages/cortex`) | `package.json`, `packages/cortex/package.json` | `atlas-cortex` → `argus` |
| 2 | Bin CLI (2 aliases hoje) | `packages/cortex/package.json` (`bin`) | `{atlas-cortex, cortex}` → `argus` (dropar os 2 aliases antigos, sem usuário pra quebrar) |
| 3 | Diretório do pacote | `packages/cortex/` | → `packages/argus/` |
| 4 | Nome do server MCP | `packages/cortex/src/mcp/tool-registry.ts:17` (`MCP_SERVER_NAME`) | `"atlas-cortex"` → `"argus"` |
| 5 | Tool names (10 tools) | `tool-registry.ts` | **sem mudança** — já são genéricos (`search`, `explore`, etc.), sem prefixo |
| 6 | `program.name()` do CLI | `packages/cortex/src/cli.ts:106` | `"cortex"` → `"argus"` |
| 7 | Diretório de estado por-workspace | `workspace.ts:4` (`WORKSPACE_DIR`) | `.cortex/` → `.argus/` (distinto de `.atlas/`, que é do Talos — confirmado, não relacionados) |
| 8 | `PRODUCT_ID`/`PRODUCT_SUBDIR` | `workspace.ts:10`, `user-paths.ts:11` | `"atlas-cortex"` → `"argus"` |
| 9 | `MCP_SERVER_KEY` (chave em config de 7 hosts) | `install/mcp-hosts.ts:9` + ~8 usos no arquivo | `"atlas-cortex"` → `"argus"` |
| 10 | Systemd unit do daemon | `daemon/service.ts:9,99` | `atlas-cortex.service` → `argus.service` |
| 11 | Marcadores de bloco (git hooks + agent-rules) | `commands/hooks.ts:13-14`, `commands/agent-rules.ts:5-6,10-26` | `>>> atlas-cortex >>>` → `>>> argus >>>`; texto `RULES_BODY` ("Atlas Cortex", `.cortex/`) → "Argus", `.argus/` |
| 12 | Plugin Codex App | `plugins/atlas-cortex/.codex-plugin/plugin.json`, `.mcp.json` (versão hardcoded) | dir → `plugins/argus/`, conteúdo atualizado |
| 13 | Scripts de release/CI | `scripts/check-release.mjs` (path hardcoded + `CORTEX_VERSION`), `scripts/homologate.mjs` (`CORTEX_HOMOLOGATION_REPOS`, literal `.cortex`), `scripts/smoke-package.mjs` (testa os 2 bins + client name), `.github/workflows/release.yml` (`--workspace=atlas-cortex`) | atualizar todos |
| 14 | Docs | `README.md`, `README.pt-BR.md`, `COMMANDS.md` (105 menções), `COMMANDS.pt-BR.md` (106 menções), `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md` | find-replace, `COMMANDS*.md` é o mais pesado |
| 15 | `.app-vault/` (docs internas) | não auditado em detalhe (fora do código-fonte) | revisar separadamente, fora do código crítico |
| 16 | Repo GitHub | `origin = github.com/pauloborini/atlas-cortex` | renomear para `argus` — sem custo de redirect de usuário, é o momento certo |
| 17 | Versão | `1.1.0` atual | rename de marca → `2.0.0` ou reset simbólico para `1.0.0`/`0.1.0` sob novo nome (decisão de gosto, sem implicação técnica já que não há consumidor) |

### Sequenciamento recomendado

1. Editar fonte em `packages/cortex/src/` (constantes, CLI name, workspace dir).
2. Mover/renomear `packages/cortex/` → `packages/argus/`, atualizar `package.json` (raiz + pacote).
3. Atualizar `plugins/atlas-cortex/` → `plugins/argus/`.
4. Atualizar os 4 scripts de release/CI.
5. `npm run validate` (typecheck + testes + lint + build, conforme README).
6. Renomear repo GitHub.
7. Atualizar docs (README/COMMANDS em ambos idiomas, CHANGELOG).
8. Reinstalar localmente (`argus install`) em todos os hosts em uso, confirmando que a migração de `.cortex/` → `.argus/` não deixa estado órfão (mesmo sem usuário externo, o Paulo usa em produção local hoje).

---

## Athena (reservado, não iniciado)

Nome reservado para o futuro produto de documentação contínua/dossiês. Sem repo,
sem código — só a reserva de nome registrada aqui para não colidir com Argus/Talos
quando o produto nascer. Quando for criado, copiar este documento (ou linkar) no
novo repo.

---

## Ordem recomendada entre os dois rename

**Talos primeiro ou Argus primeiro?** Argus tem custo de execução menor (sem
migração de usuário, sem necessidade de bump de versão coordenado com invariantes
de não-regressão) — é o rename "barato" para validar o processo (find-replace +
scripts de release) antes de aplicar a versão mais arriscada (Talos, que mexe em
gates de build, duplicação 5x e compat de instalações existentes). Recomendação:
**Argus primeiro**, Talos depois, cada um em branch feature próprio, smoke real
antes de merge em `main` (invariantes 2 e 6 do CLAUDE.md deste repo).
