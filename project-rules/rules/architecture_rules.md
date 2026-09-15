# RULES: ARCHITECTURE

## Papel

Definir a estrutura do produto, os boundaries entre fonte e artefato gerado, e os invariantes verificáveis do Talos.

## Estrutura e boundaries

| Camada | Papel | Pode depender de |
|---|---|---|
| `packages/mcp-server/` | núcleo portável: tools MCP, gates, parsing e projeção do state | `packages/skills/_shared/scripts/` |
| `packages/skills/` e `packages/orchestrator/` | skills `talos-*`, host-agnósticas | prompts e templates; **nunca** tool nativa de um cliente |
| `packages/templates/` | templates canônicos (sprint, plano, backlog, relatório) | nada |
| `agents/` | definições dos subagentes despachados | contrato de dispatch do orquestrador |
| `plugin-manifests/`, `hooks/` | manifesto por host e hooks do plugin | nada |
| `hosts/**`, `plugins/talos/**` | **espelhos gerados** | gerados por `build/build-plugins.sh` a partir de `packages/` — nunca editados à mão |
| `build/` | tooling e validadores | `packages/` (leitura) |

## Invariantes

1. **Fonte única.** `packages/**` é a fonte canônica do produto. `hosts/**` e `plugins/talos/**` são espelhos; editar espelho à mão produz drift silencioso entre fonte e artefato distribuído.
2. **Núcleo portável no MCP, variação de host no adapter.** Skills não citam tool nativa do cliente; a variação vive em `talos_capabilities` (runtime), `host-adapters.md` (doc) e no manifesto de packaging. O adapter descreve, não roteia (DEC-003, DEC-007).
3. **Determinismo > alcance.** Host sem pré-requisito essencial (subagente + MCP) é rejeitado no preflight, não degradado. Warning não substitui garantia (DEC-004, DEC-008).
4. **Não quebrar o que já funciona.** Toda expansão preserva o comportamento anterior; regressão é falha, não trade-off. Breaking change exige bump consciente e caminho de migração documentado (DEC-009).
5. **Versão concreta e única.** `VERSION`, `package.json`, `packages/mcp-server/package.json`, `.claude-plugin/plugin.json` e os manifests concretos dos bundles carregam a mesma versão; drift é falha de gate (DEC-018).
6. **Contrato antes de código.** Mudança de formato de sprint file, de state ou de tool MCP é mudança de contrato: exige a `DEC-NNN` correspondente no vault antes da implementação.

## Caso híbrido (regra de produto × norma de implementação)

O **efeito observável pelo usuário final** mora em `_app-vault/docs/decisions/` sob `### DEC-NNN`; a **norma de como implementar** mora aqui e em `build/`. Referencie a `DEC-NNN` — **nunca copie o valor literal** para `project-rules/`: o mesmo número em dois territórios é violação (SCHEMA §8, D18).

## Proibições estruturais

- Não editar `hosts/**` ou `plugins/talos/**` à mão — rode `build/build-plugins.sh`.
- Não introduzir dependência de tool nativa de host em skill ou prompt.
- Não criar regra de produto em `project-rules/` nem copiar valor de decisão para cá.
- Não tocar `archive/` nem `raycast/` sem pedido explícito.

## Gatilhos típicos

- criação ou alteração de tool MCP, gate ou parsing de documento;
- nova skill, subagente ou host;
- mudança de manifesto, bundle ou caminho de instalação;
- refatoração com impacto em mais de uma camada.
