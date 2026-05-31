---
name: claude-sprint-prd-generator
description: >
  Gera, monta ou atualiza um PRD de Sprint a partir de um Sprint ID (S01/S02/...), ancorado no BACKLOG_MESTRE*.md real, no PRD_TEMPLATE*.md real e no código real. Usar quando o usuário pedir: "cria o PRD da sprint SXX", "gera o PRD da S03", "monta o PRD de sprint", "atualiza o PRD da sprint", ou fornecer um sprint ID para virar PRD. Não inventa contrato, schema, endpoint ou migration.
---

# Sprint PRD Generator (Claude)

Gere PRDs de Sprint em PT-BR ancorados no backlog/roadmap real, no template real e no código real do repositório atual. Não invente contrato.

Todo PRD gerado por esta skill deve focar estritamente no comportamento funcional de produto (O QUÊ e POR QUÊ), deixando a implementação de código (COMO e ONDE) sob responsabilidade exclusiva do plano de execução posterior.

---

## Entrada Esperada

* Sprint ID: `S<NN>` (`S01`, `S02`, etc.).
* Opcional: app/projeto alvo quando houver mais de uma fonte de backlog/roadmap.
* Opcional: path de saída.

*Se faltar o Sprint ID, peça antes de gerar.*

---

## Workflow Obrigatório

1. **Localizar Insumos:** Descubra a raiz do repo com `git rev-parse --show-toplevel`. Localize o template (`**/PRD_TEMPLATE*.md`) e o backlog/roadmap (`**/BACKLOG_MESTRE*.md`).
2. **Extração da Sprint:** Leia o backlog real e localize a sprint, extraindo fase-fonte, objetivo, dependências de produto e links.
3. **Inspecionar Código:** Investigue o codebase real para identificar APIs, rotas e componentes de design system que afetam funcionalmente o fluxo do usuário.
4. **Redação do PRD:** Siga o layout enxuto do `PRD_TEMPLATE.md` (teto orientativo de ~180-220 linhas), separando dores e regras de negócio de implementações técnicas.

---

## Regras de Conteúdo

* **Status Inicial:** `Draft`.
* **Data:** ISO `YYYY-MM-DD` (hoje).
* **Escopo:** Lista fechada de capacidades funcionais.
* **UX:** Cobrir caminhos de `loading`, `empty`, `error`, `success` e `permission` sob a ótica do usuário.
* **Critérios de Aceite:** Binários e observáveis, divididos conforme `PRD_TEMPLATE.md` em: **Produto**, **UX**, **Dados** e **Regressão de produto**.
* **Proibições Estritas:**
  * Não inventar schemas, RPCs, endpoints ou migrations.
  * Não misturar plano de implementação, classes Dart, imports, clean architecture ou comandos de terminal com o PRD. Seguir estritamente o `BOUNDARY_PRD_PLAN.md`.

---

## Validação Mínima

Antes de salvar:
* Confirme que todas as seções do template estão presentes.
* Garanta que não há nomes de classes de código ou arquivos Dart dentro do PRD.
