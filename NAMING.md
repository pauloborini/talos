# NAMING — Decisão de Marca do Ecossistema Atlas

> Decisão de produto cross-repo. Registrada aqui (raiz de `talos`, originalmente `atlas-workflow`) por ser
> o repo onde a conversa aconteceu; deve ser copiada/linkada nos repos `atlas-cortex`,
> `atlas-brain` e `atlas-agents` para que qualquer sessão/agente que trabalhe em
> qualquer um dos repos veja a mesma convenção.

## DEC-ECO-001 — Atlas Agents é o produto; Argus/Talos/Athena são módulos que ele absorve

**Data**: 2026-06-30
**Dono**: Paulo

**Decisão**: "Atlas" deixa de ser repetido como prefixo nos nomes técnicos dos
produtos que hoje são MCPs satélites (server name, tool prefix, skill prefix, bin
CLI, nome de pacote npm, nome de plugin) — eles ganham codinome mitológico
próprio. **Exceção: `atlas-agents` mantém o nome.** Ele não é um peer dos outros —
é o app final (Electron, single-user, já v3.0) que a visão de produto prevê
**absorver** Argus/Talos/Athena como módulos internos no futuro. Não existe
ambiguidade em manter "Atlas" só nele: a partir desta decisão há um único produto
chamado Atlas (o hub), e os módulos que ele consome têm identidade própria — não
dois+ produtos disputando o mesmo nome.

**Motivo**: múltiplos MCPs com "Atlas" no nome faziam agentes confundirem qual
produto usar — não havia colisão técnica de tool name (cada um já namespaceava
diferente), mas colisão conceitual: "Atlas" repetido em todo lugar não dá ao
agente (nem ao humano) um gancho de memória para diferenciar produto. Renomear os
módulos satélites reforça a relação hierárquica real (módulo → hub) em vez de
mascará-la atrás de nomes parecidos.

**Mapeamento fechado**:

| Codinome | Produto | Função | Repo | Status |
|---|---|---|---|---|
| **Atlas Agents** | hub/app final — assistente pessoal de IA desktop, orquestra MCPs locais e agentes especializados | sem codinome — é o produto que absorve os demais | `atlas-agents` | já v3.0, mantém nome |
| **Argus** | code retrieval / context packing local | gigante de 100 olhos, nunca dorme — fit com daemon de auto-sync e indexação contínua | `atlas-cortex` (a renomear) | código maduro, sem usuário externo |
| **Talos** | pipeline determinística PRD→plano→execução→validação | autômato de bronze, executa regra fixa sem desvio — fit com determinismo/gates duros, sem improviso | `talos` (este repo) | v0.11.1, com usuário (mesmo que só o Paulo) |
| **Athena** | documentação/conhecimento contínuo do projeto | deusa da sabedoria/estratégia — fit com conhecimento acumulado | `atlas-brain` (a renomear) | repo existe, fase de pesquisa (`_analysis/gbrain` — referência arquitetural de memória/graph/synthesis, não é fonte a copiar) |

**Nota sobre o app Flutter `atlas`** (`/Volumes/Dados/projetos/atlas`, monorepo
"Atlas Monorepo" com `apps/atlas`): produto de consumo final completamente
não-relacionado a este ecossistema de dev tooling — mesmo nome, domínio
diferente. Fora do escopo desta decisão; mencionado aqui só para não confundir
buscas futuras por "atlas" no disco.

**Impacto**: rename técnico em 2 repos existentes (planos abaixo) + reserva de nome
para o terceiro produto quando ele nascer.

---

## Plano de rename 1 — `atlas-workflow` → Talos (concluído)

**Diferença crítica em relação ao Argus**: este produto **tem usuário real**
(instalado via marketplace por quem quer que seja, ainda que hoje seja só o
Paulo) e o CLAUDE.md deste repo declara invariante **"não quebrar o que já
funciona"** + **"main sempre instalável"**. Rename aqui não é find-replace livre:
é breaking change versionado com caminho de migração para instalações existentes.

### Escopo técnico (levantado por exploração, não executado ainda)

A duplicação física é o multiplicador de esforço: o conteúdo fonte vive em
`packages/` e é fisicamente copiado (não symlink) para `plugins/talos/`
e para `hosts/{opencode,pi,zcode}/`. **Toda string a trocar deve ser trocada na
fonte (`packages/`) e re-sincronizada via `build/build-plugins.sh` +
`build/install-host.sh`** — nunca editada nas 5 cópias à mão.

| # | O quê | Onde (fonte) | Vira |
|---|---|---|---|
| 1 | Prefixo de tool MCP | `packages/mcp-server/server.js` (~4991 linhas, tool defs a partir de ~4569) | `atlas_*` → `talos_*` |
| 2 | Nome do server MCP (chave de config) | `.claude-plugin/plugin.json`, `.mcp.json`, `build/cli/talos-init.mjs` | `mcpServers.atlas-workflow` → `mcpServers.talos` |
| 3 | Nome do plugin | `.claude-plugin/plugin.json` (`name`), `plugin-manifests/{claude,codex,zcode}/plugin.json`, `hosts/zcode/.zcode-plugin/plugin.json` | `atlas-workflow-orchestrator` → `talos` |
| 4 | Nome do marketplace | `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json` | `atlas-workflow` → `talos` |
| 5 | 11 skills `atlas-*` | `packages/skills/*`, `packages/orchestrator/skills/atlas-workflow-orchestrator/` | `atlas-plan-execute`→`talos-plan-execute` (e as outras 9), `atlas-workflow-orchestrator`→`talos` (skill orquestradora, nome coincide com o produto) |
| 6 | Scope npm | `package.json`, `packages/mcp-server/package.json` (`@atlas-workflow/mcp-server`) | `@atlas-workflow/*` → `@talos/*` |
| 7 | Bin CLI público | `package.json` (`bin`), `build/cli/talos-init.mjs` | `atlas-workflow` → `talos` |
| 8 | `REPO_SLUG`/`PLUGIN_ID`/`ZCODE_PLUGIN_NAME` hardcoded | `build/cli/talos-init.mjs` | atualizar para novo slug/nome |
| 9 | Guards de build hardcoded | `build/check-consistency.mjs` (regex de frontmatter, `MCP_SERVER` literal linha 148), `build/bump-version.mjs`, `build/build-plugins.sh` (artefato `talos-${host}.plugin`), `build/install-host.sh` | atualizar todos os 4 scripts — **se esquecidos, quebram silenciosamente, não dão erro óbvio** |
| 10 | Repo GitHub | `origin = github.com/pauloborini/talos` | **decisão em aberto** — ver abaixo |

### Decisão em aberto: renomear o repo GitHub também?

`DEC-009` (já registrada) fixou `npx github:pauloborini/talos init <host>`
como instalador público recomendado. Se o repo for renomeado:
- GitHub redireciona URLs antigas automaticamente por tempo indeterminado (mitiga, não resolve permanentemente).
- `REPO_SLUG` em `talos-init.mjs` muda de qualquer forma — é código, não só doc.
- Consistente: nome do produto = nome do repo = menos confusão futura.

Se o repo **não** for renomeado: nome técnico do produto (Talos) fica
dessincronizado do slug do repo (talos) — funciona, mas é a mesma
categoria de confusão que motivou este documento, só que entre repo e produto
em vez de entre produtos. **Recomendação: renomear o repo também.**

### Migração para instalações existentes (não pular)

A chave `mcpServers.talos` em configs já escritas em máquinas (incluindo
a do Paulo) precisava de lógica de migração em `talos-init.mjs`: detectar chave
antiga, remover, escrever a nova — não deixar o usuário com 2 entradas ou uma
órfã. Isso é trabalho de código, não só rename de string.

### Sequenciamento recomendado

1. Bump de versão consciente (breaking, conforme invariante 1 do CLAUDE.md) — sugestão `1.0.0` (rename de marca é, semanticamente, o tipo de marco que justifica sair do `0.x`).
2. Editar fonte em `packages/` (tool prefix, skills, package.json, scripts de build).
3. Re-rodar `build/build-plugins.sh` + `build/install-host.sh` para resincronizar as 4 cópias derivadas.
4. Atualizar os 4 scripts de build/consistência (item 9 da tabela).
5. ~~Adicionar lógica de migração de chave de config em `talos-init.mjs`.~~ (não necessário — instalador foi simplificado para instalação limpa)
6. `build/check-consistency.mjs` + `claude plugin validate ./ --strict` (gate do invariante 6 do CLAUDE.md).
7. Smoke real: install em pelo menos Claude Code + 1 host adicional, `talos_ping`→`talos_ping`, dispatch do validator.
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

## Plano de rename 3 — `atlas-brain` → Athena

Repo existe mas está em fase de pesquisa: só `README.md` (1 linha) +
`_analysis/gbrain/` (clone de terceiro, GBrain by Garry Tan/YC, estudado como
**referência arquitetural** — memória/graph traversal/synthesis — não é código a
herdar literalmente, e não deve ser commitado como histórico do projeto se for
só material de estudo). Sem código próprio ainda → menor custo de rename dos 3,
mas ações concretas:

1. Renomear o próprio repo GitHub: `atlas-brain` → `argus`... **não**, → `athena` (atenção ao rename certo na hora de executar).
2. Decidir e documentar no novo README se `_analysis/gbrain/` fica versionado (referência viva) ou vira nota/link externo (mais limpo — é código de terceiro, não dá pra confundir com fonte própria).
3. Ao escrever o primeiro código real, já nascer com a convenção: nome de pacote/bin/MCP server `athena`, sem prefixo `atlas-`/`atlas_`, mesmo padrão aplicado a Argus e Talos.
4. Quando a skill `atlas-prd-interview`/docs deste repo (`talos`/Talos) referenciarem o futuro produto de documentação, usar "Athena", não "Atlas Brain".

---

## Atlas Agents — sem plano de rename

`atlas-agents` mantém nome e estrutura como estão. Não há ação de rename aqui —
está registrado neste documento só para a relação ficar explícita: é o hub que,
na visão de produto, vai **consumir** Argus/Talos/Athena (provavelmente via MCP,
o mesmo padrão de integração que esses 3 já usam com outros hosts) à medida que
cada um amadurecer. Não é prerequisito dos 3 rename acima — eles seguem
independentes e standalone até que a unificação seja decidida e planejada à parte.

---

## Ordem recomendada entre os três rename

Por custo de execução, do mais barato ao mais caro:

1. **Athena** (`atlas-brain`) — sem código próprio, é praticamente só renomear o repo e decidir o destino do material de pesquisa.
2. **Argus** (`atlas-cortex`) — código maduro mas sem usuário externo, sem migração necessária.
3. **Talos** — tem invariante de não-regressão, duplicação física 5x, e instalações existentes a migrar; é o mais arriscado, deixar por último para aplicar o processo já validado nos outros dois.

Cada um em branch feature próprio, smoke real antes de merge em `main` (onde
aplicável — invariantes 2 e 6 do CLAUDE.md deste repo valem para `talos`;
os outros repos podem ter sua própria política, a confirmar lá).
