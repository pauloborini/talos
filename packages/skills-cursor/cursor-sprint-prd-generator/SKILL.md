---
name: cursor-sprint-prd-generator
description: >-
  Gera, monta ou atualiza um PRD de Sprint a partir de um Sprint ID (S01/S02/...),
  ancorado no BACKLOG_MESTRE*.md real, no PRD_TEMPLATE*.md real e no código real do
  repositório ativo. Use com cursor-sprint-prd-generator, "cria o PRD da sprint SXX",
  "gera o PRD da S03", "monta PRD de sprint", ou ao fornecer um sprint ID. Não inventa
  contrato, schema, endpoint ou migration. Agnóstica a produto, stack e layout de pastas.
  Par: codex-sprint-prd-generator, claude-sprint-prd-generator.
---

# Sprint PRD Generator (Cursor)

Gera PRDs de Sprint em PT-BR ancorados em **backlog real + template real + código real do repo atual**. **Não invente contrato.** **Não assuma** produto, stack, monorepo, paths fixos nem convenções que não estejam no template, backlog ou código inspecionado.

Todo PRD gerado por esta skill deve focar estritamente no comportamento funcional de produto (O QUÊ e POR QUÊ), deixando a implementação de código (COMO e ONDE) sob responsabilidade exclusiva do plano de execução posterior.

---

## Ativação

* `cursor-sprint-prd-generator`
* "cria o PRD da sprint S03", "gera PRD de sprint", "atualiza PRD da sprint"
* Sprint ID `S<NN>` (com ou sem path de repo/backlog)

---

## Agnosticismo de Repositório (Obrigatório)

* **Produto/App:** só do template, backlog, README, package ou código — **sem nome default**. Incerto → `Pendente de decisão` ou **AskQuestion**.
* **Paths:** só os citados no backlog/template ou **descobertos** com `Glob`/`Grep` no repo (migrations, apps, packages, docs vault, design system, etc.). Não presuma `.app-vault` ou caminhos rígidos.
* **Diretório de saída:** filename/path indicados no backlog; senão, `Glob` por PRDs existentes e gravar ao lado do padrão detectado.

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
