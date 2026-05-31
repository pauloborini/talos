---
name: codex-sprint-prd-generator
description: Skill `codex-sprint-prd-generator`. Use quando o usuário pedir para criar, gerar, montar ou atualizar um PRD de Sprint a partir de um sprint ID como S01/S02, usando o template de PRD e o backlog/roadmap real do repositório como fonte de escopo, dependências e fase-fonte.
---

# Codex Sprint PRD Generator

Gere PRDs de Sprint em PT-BR ancorados no backlog/roadmap real, no template real e no código real do repositório atual. Não invente contrato. 

Todo PRD gerado por esta skill deve declarar explicitamente a cadeia de execução Codex (`codex-*`) para consumo posterior por `codex-plan-handoff` e `codex-plan-execute`.

---

## Entrada Esperada

* Sprint ID: `S<NN>` (`S01`, `S02`, etc.).
* Opcional: app/projeto alvo quando houver mais de uma fonte de backlog/roadmap.
* Opcional: path de saída.

*Se faltar o Sprint ID, peça antes de gerar.*

---

## Workflow Obrigatório

1. **Localizar Insumos:** Descubra a raiz do repo com `git rev-parse --show-toplevel`. Localize template (`**/PRD_TEMPLATE*.md`) e backlog/roadmap (`**/BACKLOG_MESTRE*.md`).
2. **Extração da Sprint:** Leia a fonte de backlog/roadmap. Localize a sprint, extraindo fase-fonte, objetivo, dependências e filename do PRD.
3. **Inspecionar Código:** Busque no codebase por classes, tabelas, RPCs, mappers e rotas existentes que influenciam a feature.
4. **Redação do PRD:** Siga estritamente o layout enxuto e focado do `PRD_TEMPLATE.md` (teto orientativo de ~180-220 linhas), separando dores e regras de negócio de implementações de código.

---

## Metadados Codex Obrigatórios

Todo PRD criado ou atualizado por esta skill deve incluir, perto do topo e sem substituir o template, o seguinte bloco de metadados:

```md
## Metadados de execução
- Plan prefix: `codex`
- Target planner: `codex-plan-handoff`
- Target executor: `codex-plan-execute`
- Internal validator: `codex-task-validator`
- External review: `codex-slice-review` (optional)
```

---

## Regras de Conteúdo

* **Status Inicial:** `Draft`.
* **Data:** ISO `YYYY-MM-DD` (hoje).
* **Escopo:** Lista fechada de capacidades funcionais.
* **UX:** Cobrir caminhos de `loading`, `empty`, `error`, `success` e `permission` sob a perspectiva do usuário.
* **Critérios de Aceite:** Binários e observáveis, divididos conforme `PRD_TEMPLATE.md` em: **Produto**, **UX**, **Dados** e **Regressão de produto**.
* **Proibições Estritas:** 
  * Não inventar schemas, RPCs, endpoints ou tabelas.
  * Não misturar plano de implementação, classes Dart, imports, clean architecture ou comandos de terminal com o PRD. Seguir estritamente o `BOUNDARY_PRD_PLAN.md`.

---

## Validação Mínima

Antes de salvar:
* Confirme que todas as seções do template estão presentes.
* Garanta que o bloco de `Metadados de execução` existe e está preenchido com `codex`.
* Certifique-se de que não há nomes de classes de código ou arquivos Dart dentro do PRD.
