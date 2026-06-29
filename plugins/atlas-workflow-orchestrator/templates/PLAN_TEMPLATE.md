# PLAN <ID> — <Título> (execução)

| Campo | Valor |
|-------|-------|
| **PRD** | [PRD_<ID>_<slug>.md](./<caminho-relativo>) — decisões **PRD §3** (D*) |
| **Sprint file** | [SPRINT_S<NN>_<slug>.md](./<caminho-relativo>) — `eval_manifest` §9 |
| **Package / app** | `<packages/... \| apps/...>` |
| **Tipo** | `<feature \| ui \| navigation \| …>` |
| **execution_mode** | `<sequencial (T01→TN) \| orchestrated-per-slice>` |
| **Data** | <YYYY-MM-DD> |

**Escopo técnico:** PRD §2 + sprint file §3. **Fora:** <bullets derivados do PRD fora de escopo — não recopiar §2 inteiro>.

Política: [BOUNDARY_PRD_PLAN.md](./BOUNDARY_PRD_PLAN.md). Exemplos: [PRD/GARANTIAFACIL/EXEMPLO/](../PRD/GARANTIAFACIL/EXEMPLO/).

---

## 1. Tradução executiva

<O que será implementado em 1 parágrafo + resultado observável técnico.>

**Fonte de recorte:** <Sprint file §2–§4 + PRD §2/§3>

**Padrão de referência no monorepo:** <ex.: “espelhar módulo X em …”>

**Diferenças obrigatórias vs referência (não copiar cegamente)**

| Tema | Referência (rejeitar) | Esta entrega (PRD) |
|------|----------------------|-------------------|
| <…> | <…> | <D* ou regra> |

<Capacidades já existentes no código que esta slice só integra — ex.: use cases GF04 prontos.>

---

## 2. Invariantes de execução (derivados do PRD)

- <invariante técnico derivado de PRD §3/§5 — ex.: sem refetch ao filtrar>
- <invariante/gate derivado de sprint file §9/§10 — ex.: preservar boundary X>
- <…>

> Não recopiar a tabela de decisões do PRD nem o YAML do sprint file; referenciar `PRD §3 D12` e `Sprint §9 EVAL-001`.

---

## 3. Pitfalls

- <anti-padrão comum no repo> → <correção>
- <…>

---

## 4. Estado na abertura da sprint (pré-implementação)

> Se a entrega **já estiver no código**, não reimplementar: usar como checklist de verificação contra PRD §6 e PLAN §8. O executor **lê o repo** e confirma o que falta.

- **Sprint status:** <status do sprint file + bloqueios relevantes>
- <3–6 bullets do que bloqueia hoje — comportamento ou ausência, não lista de 15 arquivos>

---

## 5. Tarefas de execução

<!-- Para execution_mode: orchestrated-per-slice, agrupar com ### Slice A — … -->

#### T01. <Título curto>

- **Objetivo:** <resultado observável>
- **Referência:** <módulo/padrão no monorepo — opcional>
- **Pré-condições:** <nenhuma \| T0X>
- **Mudança esperada:** <o que muda de forma concreta>
- **Invariantes preservados:** <§2 ou PRD>
- **Eval/Policy:** <Sprint §9 EVAL-* / §10 policy relevante>
- **Não mudar:** <…>
- **Não fazer:** <atalhos proibidos>
- **Dependências:** <nenhuma \| T0X>
- **Riscos:** <se relevante>
- **Critério de done:** <sinal objetivo>
- **Validação local:**
  ```bash
  cd <package-ou-repo> && <comando>
  ```
- **Quality gates:** <opcional — itens verificáveis desta task>
- **Casos mínimos:** <somente em tasks de teste — lista numerada>

#### T02. <…>

<repetir até TNN>

#### TNN. Validação final

- **Objetivo:** gates locais + regressão de entregas dependentes + aceite manual mínimo (PRD §6 + Sprint §9).
- **Dependências:** T01–T(N-1)
- **Critério de done:** zero issues; testes verdes
- **Validação local:**
  ```bash
  cd <package> && flutter analyze
  cd <package> && flutter test
  ```
- **Verificação manual (recomendada):**
  1. <passo alinhado ao PRD §4>
  2. <…>

---

## 6. Contratos técnicos (só ambiguidade PRD → código)

### 6.1 <Domínio / persistência / API>

| <Camada> | Regra |
|----------|--------|
| <…> | <…> |

### 6.2 <Falhas / estados / pipeline — se aplicável>

| <Code ou etapa> | <Comportamento na store/UI> |
|-----------------|----------------------------|

---

## 7. Slices (somente se `execution_mode: orchestrated-per-slice`)

| Slice | Tasks | Objetivo |
|-------|-------|----------|
| A | T01–T03 | <…> |
| B | T04–T05 | <…> |

Ordem: **A → B → …**. Validator: boundary do diff por slice + §2 e §7.

---

## 8. Validação e checklist (validator)

Referência **PRD §6** + invariantes **§2** deste plano + `eval_manifest` do sprint file §9.

```bash
cd <package> && flutter analyze
cd <package> && flutter test
```

- [ ] <critério derivado de PRD D*/§6 ou Sprint §9 EVAL-*>
- [ ] <…>

---

## O que este template NÃO inclui (propositalmente)

- Handoff prompt final
- Gate de prontidão do planejador
- § “Regras carregadas” do `project-rules` (AGENTS carrega)
- Cópia da tabela D* do PRD
- Cópia integral do `eval_manifest`/`policy_manifest`
- Inventário global de arquivos tocados
