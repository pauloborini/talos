---
name: cursor-prd-interview
description: >-
  Valida maturidade de PRD por entrevista guiada: lê o PRD, cruza com código e
  contratos do repositório (Read, Grep, SemanticSearch), conduz rodadas curtas com
  AskQuestion e interrompe o turno até o usuário responder. Não reescreve o PRD
  nem fecha veredito com bloqueadores abertos. Use com /prd-interview, "entrevista
  de PRD", "validar PRD", ou ao anexar um PRD antes de planejar ou implementar.
---

# PRD Interview (Cursor)

Entrevista guiada para endurecer um **PRD já escrito** antes de planejamento ou implementação técnica.

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Antes da entrevista, resolver `PRD_TEMPLATE.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PRD_TEMPLATE.md` não existir, abortar com erro claro: `Template canônico ausente: PRD_TEMPLATE.md`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Ativação

* `/prd-interview`, `cursor-prd-interview`, "entrevista de PRD", "validar PRD", "endurecer PRD"
* Usuário anexa ou cita o caminho do PRD

---

## Fluxo Obrigatório

1. **Leitura Completa:** Leia o PRD e cruze com o código do repositório para verificar discrepâncias físicas reais (se componentes, rotas e APIs descritos batem com a codebase).
2. **Mapeamento de Gaps:** Classifique cada lacuna como:
   * `✅` **Completo:** Decisão suficiente e verificável.
   * `⚠️` **Pendente:** Falta detalhe de negócio que pode ser resolvido depois (não-bloqueante).
   * `❌` **Bloqueador:** Ambiguidade, conflito com o código ou falta de fluxo de UX crítico que impede o planejamento de engenharia.

**Mapeamento por Seções (PRD_TEMPLATE):**
* **§4 Escopo funcional:** `❌` se em escopo / fora de escopo / não objetivos estiverem vagos (scope creep).
* **§5 Decisões de produto (fechadas):** `❌` se faltar decisão que altere fluxo principal, mappers, roteamento ou comportamento crítico.
* **§6 Regras e invariantes (negócio):** `❌` se a regra de negócio for ambígua ou impossível de verificar na codebase.
* **§8 Fluxos e cenários UX:** `❌` se impactar o fluxo principal e faltarem os caminhos de loading, erro, vazio ou permissões.
* **§9 Contrato funcional (dados):** `❌` se campos críticos não possuírem regras de formato (ex: decimais).
* **§10 Critérios de aceite (negócio):** `❌` se o critério for subjetivo, não observável ou não testável.

3. **Perguntas por Rodada (AskQuestion):** Formule rodadas de no máximo 4 perguntas concisas via `AskQuestion`, com exatamente 3 opções e indicando a recomendada. **Pare o turno e aguarde a resposta.**
4. **Veredito Final:** Só emita o veredito de `Pronto para planejamento` quando zerar todos os `❌`.

---

## Modos de Turno

* **PREP (preparação):** Lê o PRD, cruza com o código e mapeia os gaps sem fazer perguntas diretas ou tomar decisões.
* **PERGUNTA (rodada — ponto de pausa):** Exibe a chamada `AskQuestion` e o índice provisório, parando o turno com a linha:
  `⏸️ Aguardando suas respostas (formulário acima ou neste thread, ex.: 1:A 2:B). Só continuo após sua resposta.`
* **FINAL (síntese):** Exibe o veredito final, as decisões consolidadas e as próximas ações apenas após a aprovação de todos os `❌`.

---

## Índice Provisório (fim de cada rodada)

```text
§4 Escopo:       ✅/⚠️/❌
§5 Decisões:     ✅/⚠️/❌
§6 Invariantes:  ✅/⚠️/❌
§8 Experiência:  ✅/⚠️/❌
§9 Contratos:    ✅/⚠️/❌
§10 Aceite:      ✅/⚠️/❌
```
