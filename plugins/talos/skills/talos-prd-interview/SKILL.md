---
name: talos-prd-interview
description: Skill `talos-prd-interview`. Use quando o usuário quer validar, interrogar ou amadurecer um PRD antes do planejamento ou implementação. Esta skill lê o PRD, cruza-o com código e contratos, detecta ambiguidades/discrepâncias, faz perguntas de múltipla escolha e para quando não restam gaps bloqueadores.
---

# PRD Interview (Talos)

Valide maturidade de PRD por entrevista guiada antes do planejamento ou implementação técnica. Não gere o PRD do zero. Não avance para o planejamento enquanto houver bloqueadores ativos (`❌`).

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Antes da entrevista, resolver `PRD_TEMPLATE.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PRD_TEMPLATE.md` não existir, abortar com erro claro: `Template canônico ausente: PRD_TEMPLATE.md`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Escopo da Skill

Ataque principalmente as seguintes seções do template de PRD:
* **§3 Decisões de produto (fechadas)**
* **§4 Fluxos e cenários UX**
* **§5 Contrato funcional e invariantes** (regras de negócio + contrato de dados)
* **§6 Critérios de aceite (negócio)**

---

## Workflow Obrigatório

1. **Leitura e Inspecção:** Leia o PRD e cruze com o código do repositório para verificar discrepâncias físicas reais (se componentes, rotas e APIs descritos batem com a codebase).
2. **Mapeamento de Gaps:** Classifique cada lacuna como:
   * `✅` **Completo:** Decisão suficiente e verificável.
   * `⚠️` **Pendente:** Falta detalhe de negócio que pode ser resolvido depois (não-bloqueante).
   * `❌` **Bloqueador:** Ambiguidade, conflito com o código ou falta de fluxo de UX crítico que impede o planejamento de engenharia.

**Mapeamento por Seções (Novo Template):**
* **§3 Decisões de produto (fechadas):** `❌` se faltar decisão que altere fluxo principal, mappers, roteamento ou comportamento crítico.
* **§4 Fluxos e cenários UX:** `❌` se impactar o fluxo principal e faltarem os caminhos de loading, erro, vazio ou permissões.
* **§5 Contrato funcional e invariantes:** `❌` se campos críticos não possuírem regras de formato (ex: decimais) ou se a regra de negócio for ambígua/impossível de verificar na codebase.
* **§6 Critérios de aceite (negócio):** `❌` se o critério for subjetivo, não observável ou não testável.

**Standalone (`Sprint file: Não aplicável (standalone)`):** sem sprint de apoio, §3/§5/§6 são a única fonte de Eval/Policy que `talos-plan-handoff` vai ter. Eleve o critério de `❌` nessas seções: gap que em PRD sprint-bound seria `⚠️` (porque o sprint file cobriria) é `❌` em standalone se afetar Eval/Policy do plano. Não rebaixar rigor por não ter sprint.

3. **Resolver mecanismo estruturado:** chame `talos_capabilities`, leia `question_prompt` e use seu `mechanism`/shape. Nunca hardcode nome de ferramenta de host. Se o descriptor estiver ausente ou indisponível, bloqueie a rodada; não degrade para pergunta livre sem correlação.
4. **Perguntas por rodada:** formule no máximo 4 perguntas concisas, exatamente 3 opções, recomendada explícita e `decision_id` D* estável. Antes de perguntar, use `pendingInterviewQuestions` de `../_shared/scripts/document_quality.mjs` para excluir decisões já fechadas.
5. **Persistência imediata:** ao receber respostas, grave-as no mesmo PRD antes de qualquer nova pergunta, preservando IDs/anchors e acrescentando histórico. Use `persistInterviewRound(prd_path, answers)`, que escreve via arquivo temporário + rename e valida readback; falha bloqueia. Nunca acumule respostas apenas no chat.
6. **Reindexação:** releia o PRD salvo, reexecute o índice §3–§6 e recalcule perguntas pendentes. Decisão fechada não pode reaparecer em rodada posterior.
7. **Veredito Final:** só emita `Pronto para planejamento` quando zerar todos os `❌`; no workflow, devolva controle ao orquestrador para reexecutar artifact/scan/TC.

---

## Índice Provisório (fim de cada rodada)

```text
§3 Decisões:      ✅/⚠️/❌
§4 Experiência:   ✅/⚠️/❌
§5 Contrato+inv:  ✅/⚠️/❌
§6 Aceite:        ✅/⚠️/❌
```

O índice é materializado novamente após cada persistência; não reutilize índice anterior à resposta.

---

## Uso standalone vs protocolo interno no workflow (PRD D10/D11)

Esta skill é de **autoria documental** (maturar um PRD). A fronteira de determinismo do Atlas é a **mutação de código** (PRD D10): como esta skill não muta código, **autoria é livre, execução é gateada**.

### (a) Uso standalone permitido

Você pode invocar `talos-prd-interview` diretamente, fora do pipeline, para amadurecer um PRD. Não há restrição: autoria documental não muta o produto. O artefato resultante (`PRD_*.md`) é livre para existir e ser editado.

### (b) O artefato NÃO é confiável só por existir

Um PRD amadurecido standalone **não vale como gate aprovado** pelo simples fato de existir. Ao entrar em execução (modos `full`/`direct`/`execute`), ele é **re-gateado obrigatoriamente** por `talos_verify_artifact` + `talos_verify_template_conformance` (TC). PRD velho, manual ou inválido **trava na entrada da execução**, não na autoria. Esta skill não emite veredito de execução nem declara o PRD "pronto para implementar de forma determinística".

### (c) Standalone vs protocolo interno no workflow

- **Standalone:** o usuário conduz a skill diretamente; o produto é o PRD maturado, sujeito a re-validação posterior.
- **No workflow:** quem conduz a fase de PRD é o **orquestrador principal** (agente principal), que decide quando entrevistar (scan de ambiguidade / `--interview`) e roda os gates MCP do pipeline. A skill é a mesma; o que muda é quem orquestra e os gates que cercam a fase.

> **Invariante:** autoria é livre, execução é gateada. Um PRD só vira confiável para execução após `talos_verify_artifact` + TC na entrada (PRD D11).
