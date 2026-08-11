---
name: talos-sprint-interview
description: Skill `talos-sprint-interview`. Use quando o usuário quer validar, interrogar ou amadurecer o contrato de produto (§7) de um sprint file antes do planejamento ou implementação. Esta skill lê a §7 do sprint file, cruza com código e contratos, detecta ambiguidades/discrepâncias, faz perguntas de múltipla escolha e, ao fechar, aprova e sela o contrato.
---

# Sprint Interview (Talos)

Valide maturidade do **contrato de produto** (§7 do sprint file) por entrevista guiada antes do planejamento ou implementação técnica. Não gere PRD. Não avance para o planejamento enquanto houver bloqueadores ativos (`❌`).

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Talos.
* Antes da entrevista, resolver `SPRINT_TEMPLATE.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/SPRINT_TEMPLATE.md` não existir, abortar com erro claro: `Template canônico ausente: SPRINT_TEMPLATE.md`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Escopo da Skill

Ataque principalmente as seguintes subseções do contrato congelado:

* **§7.1 Decisões de produto (D*)**
* **§7.2 Cenários UX** (loading / vazio / erro / sucesso)
* **§7.3 Aceite binário** — `AC-*` em YAML `acceptance` (critérios atômicos; hierarquia `AC-*` ⊃ `EVAL-*`)

---

## Workflow Obrigatório

1. **Leitura e Inspecção:** Leia o sprint file (foco §7) e cruze com o código do repositório para verificar discrepâncias físicas reais.
2. **Mapeamento de Gaps:** Classifique cada lacuna como:
   * `✅` **Completo:** Decisão suficiente e verificável.
   * `⚠️` **Pendente:** Falta detalhe de negócio que pode ser resolvido depois (não-bloqueante).
   * `❌` **Bloqueador:** Ambiguidade, conflito com o código ou falta de fluxo de UX crítico que impede o planejamento de engenharia.

**Mapeamento por Subseções:**
* **§7.1 Decisões (D*):** `❌` se faltar decisão que altere fluxo principal, mappers, roteamento ou comportamento crítico.
* **§7.2 Cenários UX:** `❌` se impactar o fluxo principal e faltarem os caminhos de loading, erro, vazio ou permissões.
* **§7.3 Aceite (`AC-*`):** `❌` se faltar `AC-*` por cenário §7.2; se `behavior` for subjetivo/não observável; se `evidence.required` omitir prova automática (`I`/`T-outcome`/`W`); se `EVAL-*` órfão ou AC sem EVAL quando prova auto exigida; se `M` presente sem objeto `manual` ou vice-versa. Granularidade mínima: ≥1 `AC-*` por cenário + ≥1 de regressão quando houver regressão material.

**Standalone (`Backlog mestre: Não aplicável (standalone)`):** sem backlog de apoio, a §7 é a única fonte de Eval/Policy que `talos-plan-handoff` vai ter. Eleve o critério de `❌`: gap que em sprint-bound seria `⚠️` é `❌` em standalone se afetar Eval/Policy do plano.

3. **Resolver mecanismo estruturado:** chame `talos_capabilities`, leia `question_prompt` e use seu `mechanism`/shape. Nunca hardcode nome de ferramenta de host. Se o descriptor estiver ausente ou indisponível, bloqueie a rodada; não degrade para pergunta livre sem correlação.
4. **Perguntas por rodada:** formule no máximo 4 perguntas concisas, exatamente 3 opções, recomendada explícita e `decision_id` D* estável. Antes de perguntar, use `pendingInterviewQuestions` de `../_shared/scripts/document_quality.mjs` para excluir decisões já fechadas na §7.
5. **Persistência imediata:** ao receber respostas, grave-as no mesmo sprint file antes de qualquer nova pergunta, preservando IDs/anchors e acrescentando histórico. Use `persistInterviewRound(sprint_path, answers)`, que escreve via arquivo temporário + rename e valida readback; falha bloqueia. Nunca acumule respostas apenas no chat. Decisão em aberto/Q- aberta **não trava** o pipeline: propague e continue (Princípio de continuação automática).
6. **Reindexação:** releia o sprint file salvo, reexecute o índice §7.1–§7.3 e recalcule perguntas pendentes. Decisão fechada não pode reaparecer em rodada posterior.
7. **Aprovar e selar:** só emita `Pronto para planejamento` quando zerar todos os `❌`. Ao fechar, chame `persistInterviewRound(sprint_path, answers, date, { approve: true })` ou `approveAcceptanceContract` após a última rodada — isso seta `Contrato status: aprovado` + `Selo do contrato: sha256:<hash do §7>` (normalização idêntica a `validateAcceptanceSeal`). Sem selo válido, o contrato não está fechado.
8. **Veredito Final:** no workflow, devolva controle ao orquestrador para reexecutar artifact/scan/TC sobre o sprint file.

---

## Índice Provisório (fim de cada rodada)

```text
§7.1 Decisões:   ✅/⚠️/❌
§7.2 Cenários UX: ✅/⚠️/❌
§7.3 AC-*:        ✅/⚠️/❌
Contrato status:  draft|aprovado
```

O índice é materializado novamente após cada persistência; não reutilize índice anterior à resposta.

---

## Uso standalone vs protocolo interno no workflow

Esta skill é de **autoria documental** (maturar o contrato §7). A fronteira de determinismo do Talos é a **mutação de código**: como esta skill não muta código, **autoria é livre, execução é gateada**.

### (a) Uso standalone permitido

Você pode invocar `talos-sprint-interview` diretamente, fora do pipeline, para amadurecer a §7 de um sprint file. Não há restrição: autoria documental não muta o produto.

### (b) O artefato NÃO é confiável só por existir

Um contrato amadurecido standalone **não vale como gate aprovado** pelo simples fato de existir. Ao entrar em execução (modos `full`/`direct`/`execute`), o sprint file é **re-gateado** por `talos_verify_sprint_file` (inclui selo quando `aprovado`). Contrato velho, manual ou com selo adulterado **trava na entrada**, não na autoria.

### (c) Standalone vs protocolo interno no workflow

- **Standalone:** o usuário conduz a skill diretamente; o produto é o sprint file com §7 maturada/selada, sujeito a re-validação posterior.
- **No workflow:** quem conduz a fase de produto é o **orquestrador principal**, que decide quando entrevistar (scan de ambiguidade / `--interview`) e roda os gates MCP. A skill é a mesma; o que muda é quem orquestra e os gates que cercam a fase.

> **Invariante:** autoria é livre, execução é gateada. Um contrato §7 só vira confiável para execução após `talos_verify_sprint_file` com selo íntegro quando `aprovado`.
