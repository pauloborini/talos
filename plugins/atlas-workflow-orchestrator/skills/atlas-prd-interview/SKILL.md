---
name: atlas-prd-interview
description: Skill `atlas-prd-interview`. Use quando o usuário quer validar, interrogar ou amadurecer um PRD antes do planejamento ou implementação. Esta skill lê o PRD, cruza-o com código e contratos, detecta ambiguidades/discrepâncias, faz perguntas de múltipla escolha e para quando não restam gaps bloqueadores.
---

# PRD Interview (Atlas)

Valide maturidade de PRD por entrevista guiada antes do planejamento ou implementação técnica. Não gere o PRD do zero. Não avance para o planejamento enquanto houver bloqueadores ativos (`❌`).

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Antes da entrevista, resolver `PRD_TEMPLATE.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PRD_TEMPLATE.md` não existir, abortar com erro claro: `Template canônico ausente: PRD_TEMPLATE.md`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Escopo da Skill

Ataque principalmente as seguintes seções do novo template de PRD:
* **§5 Decisões de produto (fechadas)**
* **§6 Regras e invariantes (negócio)**
* **§8 Fluxos e cenários UX**
* **§9 Contrato funcional (dados)**
* **§10 Critérios de aceite (negócio)**

---

## Workflow Obrigatório

1. **Leitura e Inspecção:** Leia o PRD e cruze com o código do repositório para verificar discrepâncias físicas reais (se componentes, rotas e APIs descritos batem com a codebase).
2. **Mapeamento de Gaps:** Classifique cada lacuna como:
   * `✅` **Completo:** Decisão suficiente e verificável.
   * `⚠️` **Pendente:** Falta detalhe de negócio que pode ser resolvido depois (não-bloqueante).
   * `❌` **Bloqueador:** Ambiguidade, conflito com o código ou falta de fluxo de UX crítico que impede o planejamento de engenharia.

**Mapeamento por Seções (Novo Template):**
* **§5 Decisões de produto (fechadas):** `❌` se faltar decisão que altere fluxo principal, mappers, roteamento ou comportamento crítico.
* **§6 Regras e invariantes (negócio):** `❌` se a regra de negócio for ambígua ou impossível de verificar na codebase.
* **§8 Fluxos e cenários UX:** `❌` se impactar o fluxo principal e faltarem os caminhos de loading, erro, vazio ou permissões.
* **§9 Contrato funcional (dados):** `❌` se campos críticos não possuírem regras de formato (ex: decimais).
* **§10 Critérios de aceite (negócio):** `❌` se o critério for subjetivo, não observável ou não testável.

3. **Perguntas por Rodada (AskUserQuestion):** Formule rodadas de no máximo 4 perguntas concisas via ferramenta nativa `AskUserQuestion`, com exatamente 3 opções e indicando a recomendada. **Pare o turno e aguarde a resposta.**
4. **Veredito Final:** Só emita o veredito de `Pronto para planejamento` quando zerar todos os `❌`.

---

## Índice Provisório (fim de cada rodada)

```text
§5 Decisões:     ✅/⚠️/❌
§6 Invariantes:  ✅/⚠️/❌
§8 Experiência:  ✅/⚠️/❌
§9 Contratos:    ✅/⚠️/❌
§10 Aceite:      ✅/⚠️/❌
```

---

## Uso standalone vs protocolo interno no workflow (PRD D10/D11)

Esta skill é de **autoria documental** (maturar um PRD). A fronteira de determinismo do Atlas é a **mutação de código** (PRD D10): como esta skill não muta código, **autoria é livre, execução é gateada**.

### (a) Uso standalone permitido

Você pode invocar `atlas-prd-interview` diretamente, fora do pipeline, para amadurecer um PRD. Não há restrição: autoria documental não muta o produto. O artefato resultante (`PRD_*.md`) é livre para existir e ser editado.

### (b) O artefato NÃO é confiável só por existir

Um PRD amadurecido standalone **não vale como gate aprovado** pelo simples fato de existir. Ao entrar em execução (modos `full`/`direct`/`execute`), ele é **re-gateado obrigatoriamente** por `atlas_verify_artifact` + `atlas_verify_template_conformance` (TC). PRD velho, manual ou inválido **trava na entrada da execução**, não na autoria. Esta skill não emite veredito de execução nem declara o PRD "pronto para implementar de forma determinística".

### (c) Standalone vs protocolo interno no workflow

- **Standalone:** o usuário conduz a skill diretamente; o produto é o PRD maturado, sujeito a re-validação posterior.
- **No workflow:** quem conduz a fase de PRD é o **orquestrador principal** (agente principal), que decide quando entrevistar (scan de ambiguidade / `--interview`) e roda os gates MCP do pipeline. A skill é a mesma; o que muda é quem orquestra e os gates que cercam a fase.

> **Invariante:** autoria é livre, execução é gateada. Um PRD só vira confiável para execução após `atlas_verify_artifact` + TC na entrada (PRD D11).
