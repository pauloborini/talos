---
name: codex-prd-interview
description: Skill `codex-prd-interview`. Use quando o usuário quer validar, interrogar ou amadurecer um PRD antes do planejamento ou implementação. Esta skill lê o PRD, cruza-o com código e contratos, detecta ambiguidades/discrepâncias, faz perguntas de múltipla escolha e para quando não restam gaps bloqueadores.
---

# PRD Interview (Codex)

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
