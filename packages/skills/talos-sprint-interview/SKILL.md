---
name: talos-sprint-interview
description: Skill `talos-sprint-interview`. Use quando o usuário quer validar, interrogar ou amadurecer a intenção (§2) e o contrato de produto (§7) de um sprint file antes do planejamento ou implementação. Entrevista dual L2: saturação do eixo (T1–T7) depois contrato §7. Proibido `INTENT.md`.
---

# Sprint Interview (Talos)

Valide maturidade da **intenção (§2)** e do **contrato de produto (§7)** por entrevista guiada antes do planejamento ou implementação técnica. Não gere PRD. **Proibido** artefato `INTENT.md` — casa única é o sprint file §2.

Ordem SDD **rígida** na mesma skill (mesma sessão possível):

1. **Fase 1 — saturação do eixo (§2):** classificar eixo; loop T* via `question_prompt`; persistir §2; selar intenção quando T*=0.
2. **Fase 2 — contrato §7:** D* / cenários UX / `AC-*` **derivados** da §2 saturada; selo §7.

`talos_scan_acceptance` com zero padrões **não** pula a fase 1. `--interview` força **as duas** fases. Sem `question_prompt` → bloqueia a rodada (não degrada para pergunta livre).

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Talos.
* Antes da entrevista, resolver `SPRINT_TEMPLATE.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/SPRINT_TEMPLATE.md` não existir, abortar com erro claro: `Template canônico ausente: SPRINT_TEMPLATE.md`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

---

## Escopo da Skill

### Fase 1 — §2 Objetivo e valor (intenção)

* **Eixo do ataque** (`dados` \| `ux` \| `estrutura` \| `contrato` \| `misto`)
* **Superfícies** `SF-NN`, **Anti-escopo tentador** `AS-NN`, **Recusa** `R1`, **Regras do repo** (quando o eixo toca produto)
* **Aferição T\*** (T1–T7 da spec `SPEC_INTENT_SATURATION_SDD.md` §4)
* **Intenção status** + **Selo da intenção** (write-once quando saturada)

### Fase 2 — contrato congelado (§7)

* **§7.1 Decisões de produto (D\*)**
* **§7.2 Cenários UX** (loading / vazio / erro / sucesso)
* **§7.3 Aceite binário** — `AC-*` em YAML `acceptance` (critérios atômicos; hierarquia `AC-*` ⊃ `EVAL-*`)

---

## Gatilhos T* (fase 1)

Saturação = **T\* = 0**, não contagem de rodadas. Qualquer gatilho verdadeiro torna a fase 1 obrigatória:

| # | Gatilho |
|---|---------|
| T1 | Campo obrigatório da §2 vazio ou placeholder |
| T2 | `premissa` no eixo; ou `derivado:` que afirma comportamento |
| T3 | Superfície nomeada sem linha que fixe comportamento observável |
| T4 | Recusa ausente ou tautológica |
| T5 | Anti-escopo só genérico |
| T6 | Eixo toca produto e regra do repo sem «seguir» ou exceção `usuario` |
| T7 | Eixo `misto` sem declarar fatia Must vs adiada |

Registrar na §2 uma linha `**Aferição T*:**` com gatilhos disparados/zerados após cada rodada.

---

## Catálogo do inútil (nunca perguntar — spec §5.4)

L1 e L2: quantas sprints; confirmar o óbvio já gravado `usuario`; opção só de existência de arquivo; loading/vazio/erro fora de eixo `ux`; refator/componentizar fora de eixo `estrutura`; campos de entidade fora de eixo `dados`; «quer testes?»; recusa tautológica como opção; ampliar escopo; reabrir decisão fechada nesta sprint.

L2 só a mais: MoSCoW de outra sprint; inventar segundo objetivo.

Se a única pergunta restante está no catálogo → **não perguntar**; grave anti-escopo ou `derivado:<path>` de existência e re-aferir T*.

Cada rodada: **tema** (objetivo único da sprint) ∩ **eixo** ∩ **T\* residual** — stem cita o tema; pare quando T*=0.

---

## Workflow Obrigatório

### Fase 1 — Saturação §2

1. **Leitura:** leia sprint file (§2 + contexto §3/§4) e cruze código quando `derivado:<path>` exigir verificação.
2. **Classificar eixo** cedo (`dados` \| `ux` \| `estrutura` \| `contrato` \| `misto`); `misto` exige T7 antes do pack primário.
3. **Aferir T\*:** liste gatilhos abertos (T1–T7). Enquanto T*>0: (a) `talos_capabilities` → `question_prompt`; ausente → **bloqueie**; (b) formule 1 decisão por rodada, 3 opções mutuamente exclusivas de **produto**, recomendada explícita, `decision_id` estável (`INT-<tema>-<n>` ou equivalente estável); (c) exclua perguntas do catálogo do inútil; (d) persistência imediata com `applyIntentField` de `../_shared/scripts/document_quality.mjs` (upsert eixo/SF/AS/R1/regras + linha Aferição T*) — ou edição equivalente no corpo §2 + `setTableValue`; (e) re-leia e re-aferir T*. Decisão fechada não reaparece.
4. **Selar intenção:** só quando T*=0, chame `approveIntentSaturation` (ou `applyIntentField(..., { approve: true })`). Sem selo válido, intenção não está saturada.

### Fase 2 — Contrato §7

5. **Mapeamento de Gaps §7:** classifique cada lacuna como `✅` / `⚠️` / `❌` (mesmas regras abaixo). D* e AC **derivam** da §2 saturada (recusa R1, SF-*, anti-escopo AS-*).
6. **Mapeamento por Subseções:**
   * **§7.1 Decisões (D\*):** `❌` se faltar decisão que altere fluxo principal, mappers, roteamento ou comportamento crítico.
   * **§7.2 Cenários UX:** `❌` se impactar o fluxo principal e faltarem loading, erro, vazio ou permissões.
   * **§7.3 Aceite (`AC-*`):** `❌` se faltar `AC-*` por cenário §7.2; se `behavior` subjetivo; se evidência omitir prova automática; EVAL órfão; etc.

   **Standalone:** eleve o critério de `❌` quando §7 for única fonte Eval/Policy.

7. **Perguntas §7:** `question_prompt` do host; `persistInterviewRound(sprint_path, answers)` rodada a rodada; use `pendingInterviewQuestions` para D* já fechadas. Pergunta de aceite (`behavior`) **só** na fase 2, derivada da recusa já gravada.
8. **Aprovar contrato:** só emita `Pronto para planejamento` quando zerar todos os `❌` da §7 **e** intenção saturada. Feche com `persistInterviewRound(..., { approve: true })` ou `approveAcceptanceContract`.
9. **Veredito:** devolva controle ao orquestrador para reexecutar `talos_verify_sprint_file` (default `plan_ready`) e `talos_scan_acceptance`.

---

## Índice Provisório (fim de cada rodada)

```text
Eixo do ataque:   dados|ux|estrutura|contrato|misto
Aferição T*:      [T1–T7 abertos / zerados]
Intenção status:  rascunho|saturada
§7.1 Decisões:    ✅/⚠️/❌   (fase 2)
§7.2 Cenários UX: ✅/⚠️/❌   (fase 2)
§7.3 AC-*:        ✅/⚠️/❌   (fase 2)
Contrato status:  draft|aprovado
```

Materialize o índice após cada persistência; não reutilize índice anterior à resposta.

---

## Uso standalone vs protocolo interno no workflow

Esta skill é de **autoria documental**. A fronteira de determinismo do Talos é a **mutação de código**: autoria é livre, execução é gateada.

### (a) Uso standalone permitido

Invoque diretamente para amadurecer §2 + §7. `interview-only` sela intenção **e** §7 antes de declarar contrato pronto.

### (b) O artefato NÃO é confiável só por existir

Ao entrar em execução (`full`/`direct`/`execute`), re-gateie com `talos_verify_sprint_file` (limiar `plan_ready`: intenção saturada + contrato aprovado, selos íntegros).

### (c) No workflow

O orquestrador despacha quando `maturity !== plan_ready`, `--interview`, ou G5>0 — **nunca** porque `scan=0` «pulou» L2.

> **Invariante:** autoria é livre, execução é gateada. Plano/direct exigem `Intenção status: saturada` com selo íntegro **e** contrato §7 aprovado.
