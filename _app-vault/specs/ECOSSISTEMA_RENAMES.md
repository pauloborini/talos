# SPEC — Renomeações de marca do ecossistema (status e sequenciamento)

**Escopo:** cross-repo. Vive neste repo por ser onde a decisão nasceu (2026-06-30, `atlas-workflow` na época) e **deve ser copiada ou linkada** em `atlas-cortex`, `atlas-brain` e `atlas-agents` para que qualquer sessão veja a mesma convenção.
**Regra associada:** as regras de identidade e de prefixo são decisão de produto — ver `### DEC-050` em `docs/decisions/marca.md`. Este spec traz o **estado e o como executar**; não duplica o enunciado da regra.

## Estado das três renomeações

| Codinome | Repo | Status |
|---|---|---|
| **Talos** (pipeline determinística) | `talos` (este) | **Concluído** — produto, skills, bin CLI, manifests, marketplace e repo já sob o nome novo |
| **Argus** (code retrieval / context packing) | `atlas-cortex` | **Pendente** — sem usuário externo, sem divulgação: rename livre, sem necessidade de compat shim |
| **Athena** (documentação e conhecimento contínuo) | `atlas-brain` | **Pendente** — repo só com README e material de estudo: menor custo dos três |

`atlas-agents` é o hub/app final e **mantém o nome** — não tem ação de rename. Ele absorve os três módulos na visão de produto, sem ser pré-requisito de nenhum rename: os três seguem independentes até que a unificação seja decidida à parte.

## Convenção a aplicar em cada repo

Ao nascer ou renomear: nome de pacote, `bin`, server MCP, chave de config nos hosts, diretório de estado por workspace, unit de daemon, plugin de host, marcadores de bloco em hooks e agent-rules, scripts de release/CI, manifests e marketplace — tudo sem prefixo `atlas-`/`atlas_`, com o codinome. Docs (`README`, `COMMANDS`, `CHANGELOG`) entram no mesmo movimento; são o maior volume de menções.

**Cuidado registrado:** os guards de build com nomes hardcoded (guards de frontmatter, regex de script, artefato de zip, instalador) quebram **silenciosamente** se esquecidos — não dão erro óbvio. Tratar como item de checklist, não como detalhe.

## Sequenciamento recomendado (padrão dos três)

1. Bump consciente e breaking, conforme a regra de não quebrar o que funciona (Talos usou `0.x` → rename como marco).
2. Editar a **fonte** (pacote, constantes, nome de CLI, diretório de estado, chave de config).
3. Mover/renomear diretórios de pacote e plugin de host.
4. Atualizar scripts de build/release/CI e os guards hardcoded.
5. Regenerar artefatos derivados (bundles, catálogos) e rodar os gates do repo.
6. Smoke real: instalar em pelo menos dois hosts, `ping` e dispatch do validador.
7. Só então renomear o repo GitHub, e por fim atualizar docs, `CHANGELOG` e o marketplace.
8. Feature branch, nunca direto na base estável.

## Decisão em aberto — renomear também o repo GitHub?

GitHub redireciona URLs antigas por tempo indeterminado, o que mitiga mas não resolve; o slug aparece em código (`REPO_SLUG` do instalador), não só em doc. Manter o slug antigo deixa o nome técnico dessincronizado do repo — a mesma categoria de confusão que originou a decisão. **Recomendação registrada: renomear o repo junto.** Para este repo (Talos) a decisão já está resolvida pelo uso: `npx github:pauloborini/talos` é o instalador público.

## Nota do app Flutter `atlas`

Existe um produto de consumo final (`atlas`, monorepo com `apps/atlas`) **fora** desta decisão: ele não é módulo nem hub do ecossistema aqui descrito, e o nome `atlas` ali não é afetado pelo mapeamento acima.

## Re-derivação obrigatória na execução

O levantamento arquivo a arquivo que originou estes planos é **anterior a 2026-07** e envelhece: paths, scripts e manifests mudaram desde então (por exemplo, este repo passou de `0.17.2` para `0.23.1`). Antes de executar qualquer um dos dois renames pendentes, **refazer a exploração no repo-alvo** em vez de confiar no inventário antigo; o plano acima continua válido como sequência e como checklist de categorias.
