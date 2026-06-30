---
name: talos-sprint-prd-generator
description: Skill `talos-sprint-prd-generator`. Use quando o usuário pedir para criar, gerar, montar ou atualizar um PRD de Sprint a partir de um sprint ID como S01/S02. O sprint file `SPRINT_S<NN>_*.md` é fonte primária; backlog mestre é autoridade de índice/status.
---

# Talos Sprint PRD Generator

Gere PRDs de Sprint em PT-BR ancorados no sprint file vivo, no backlog mestre como índice/status, no template canônico empacotado e no código real do repositório atual. Não invente contrato.

Contrato atual:

- Sprint file é a fonte primária de recorte, escopo, critérios candidatos, `eval_manifest`, `policy_manifest`, riscos e evidência esperada.
- Backlog mestre só decide autoridade de índice/status: sprint existente, dependências, estado, path do sprint file, PRD/PLAN/State.
- PRD não nasce direto do backlog nem de roadmap macro.
- Sprint file ausente, não linkado ou inconsistente bloqueia a geração com ação corretiva.

Todo PRD gerado por esta skill deve declarar explicitamente a cadeia de execução Atlas (`atlas-*`) para consumo posterior por `talos-plan-handoff` e `talos-plan-execute`.

---

## Entrada Esperada

* Sprint ID: `S<NN>` (`S01`, `S02`, etc.).
* Opcional: path explícito do sprint file. Quando fornecido, deve bater com o Sprint ID e com o backlog autoritativo.
* Opcional: app/projeto alvo quando houver mais de um backlog/sprint file candidato.
* Opcional: path de saída.
* Opcional: path explícito do backlog autoritativo. Quando fornecido, vence qualquer descoberta.

*Se faltar o Sprint ID, peça antes de gerar.*

---

## Workflow Obrigatório

1. **Localizar Insumos:** Descubra a raiz do repo com `git rev-parse --show-toplevel`. Localize o template canônico em `<raiz-do-plugin>/packages/templates/PRD_TEMPLATE.md` e a política `BOUNDARY_PRD_PLAN.md`. Localize backlogs candidatos (`**/BACKLOG_MESTRE*.md`) sem escolher por heurística silenciosa.
2. **Fechar autoridade do backlog:** use `../_shared/scripts/document_quality.mjs#resolveSprintAuthority` com precedência fixa: path explícito → backlog canônico referenciado pelo artefato/input → único candidato contendo o Sprint ID. Zero match bloqueia. Múltiplos matches sem autoridade, mesmo com conteúdo parecido, bloqueiam com paths conflitantes e `next_action` para informar o path.
3. **Resolver sprint file:** leia a linha S<NN> do backlog autoritativo e extraia `Sprint file`. Se path explícito foi fornecido, confirme que bate com o backlog. Se ausente, `pendente`, inexistente, com Sprint ID divergente, backlink ausente para o backlog ou DoR vermelho sem ação corretiva, bloqueie com `next_action: criar/atualizar SPRINT_S<NN>_<slug>.md via SPRINT_TEMPLATE.md`.
4. **Validar sprint file:** chame `talos_verify_sprint_file` com `sprint_path`, `sprint_id` e `backlog_path`. Bloqueie em `failed`/`blocked` ou se o gate estiver indisponível. Sem sprint file conforme, não gerar PRD executável.
5. **Extração da Sprint:** leia o sprint file como fonte primária. Extraia objetivo, escopo/fora de escopo, dependências, decisões locais, critérios candidatos, `eval_manifest`, `policy_manifest` e evidence-to-claim esperado. Leia o backlog só para status, dependências macro, fase-fonte, prioridade e paths oficiais. Registre no PRD o path + anchor exato do backlog e do sprint file.
6. **Inspecionar Código:** Busque no codebase por contratos reais que influenciam a feature e registre anchors estáveis (`path:símbolo` ou `path:linha`) nas referências; não copie implementação para o PRD.
7. **Redação/atualização:** siga `PRD_TEMPLATE.md`. Ao atualizar, preserve IDs `D*`, decisões fechadas, anchors e histórico; novos IDs são append-only. Mudança deliberada em D* exige decisão explícita e registro histórico.

### Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Resolver `PRD_TEMPLATE.md` a partir da raiz do plugin/bundle, antes de olhar qualquer arquivo do repo consumidor.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PRD_TEMPLATE.md` não existir, abortar com erro claro: `Template canônico ausente: PRD_TEMPLATE.md`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Metadados Talos Obrigatórios

Todo PRD criado ou atualizado por esta skill deve incluir, perto do topo e sem substituir o template, o seguinte bloco de metadados:

```md
## Metadados de execução
- Plan prefix: `atlas`
- Target planner: `talos-plan-handoff`
- Target executor: `talos-plan-execute`
- Internal validator: `talos-task-validator`
- External review: `talos-slice-review` (optional)
```

---

## Regras de Conteúdo

* **Status final:** `Aprovado para implementação`. Setar **automaticamente** ao finalizar a geração — é o status que o gate TC do orquestrador exige (`required_status=Aprovado para implementação`) para o PRD avançar no pipeline. Não deixar `Draft` (trava o gate e força correção manual). O sinal de determinismo que sustenta o avanço é o `talos_scan_prd` (varredura de ambiguidade) + entrevista quando houver padrões bloqueantes — não o campo Status, que é marcador documental.
* **Data:** ISO `YYYY-MM-DD` (hoje).
* **Autoridade:** `Relacionado`/`Referências` inclui backlog autoritativo + anchor da sprint e anchors de código/contrato usados.
* **Sprint file:** cabeçalho e referências incluem path explícito do sprint file; `Fonte de recorte` aponta para seções usadas.
* **Escopo:** Lista fechada de capacidades funcionais derivada do sprint file, não do backlog macro.
* **UX:** Cobrir caminhos de `loading`, `empty`, `error`, `success` e `permission` sob a perspectiva do usuário.
* **Critérios de Aceite:** Binários e observáveis, divididos conforme `PRD_TEMPLATE.md` em: **Produto**, **UX**, **Dados** e **Regressão de produto**; devem refletir os critérios candidatos e EVAL-* relevantes do sprint file sem copiar o YAML inteiro.
* **Proibições Estritas:** 
  * Não inventar schemas, RPCs, endpoints ou tabelas.
  * Não misturar plano de implementação, classes Dart, imports, clean architecture ou comandos de terminal com o PRD. Seguir estritamente o `BOUNDARY_PRD_PLAN.md`.

---

## Validação Mínima

Antes de salvar:
* Confirme que todas as seções do template estão presentes.
* Garanta que o bloco de `Metadados de execução` existe e está preenchido com `atlas`.
* Garanta que backlog mestre e sprint file estão linkados no cabeçalho.
* Garanta que todo EVAL-* relevante do sprint file aparece em §6 ou no Apêndice como referência.
* Certifique-se de que não há nomes de classes de código ou arquivos Dart dentro do PRD.
