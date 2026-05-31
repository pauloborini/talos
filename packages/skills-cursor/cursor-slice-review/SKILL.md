---
name: cursor-slice-review
description: Skill `cursor-slice-review` (par com `codex-slice-review` / `claude-slice-review`). Revisa uma slice já implementada após `cursor-plan-execute` (ou execução equivalente), usando o plano (`cursor-plan-handoff` ou markdown compatível), invariantes e código tocado como contrato. Revisão fria focada na slice — regressões ocultas, gaps de lógica, cenários em falta, riscos de segurança, violações arquiteturais e testes em falta. Não alargar ao repositório inteiro salvo pedido explícito.
---

# Cursor Slice Review

Use esta skill **depois** de uma passagem de implementação ter concluído uma slice concreta do plano (por exemplo após `cursor-plan-execute` ou `cursor-plan-execute-orchestrated`).

Esta é uma **revisão fria** — idealmente em nova sessão, sem viés do executor. Revise apenas a slice executada.

---

## Contrato de Revisão

Basear a revisão em três entradas:
1. **Artefato do plano** — `.claude/plans/<nome>.md` produzido pelo `cursor-plan-handoff` (Seção 2 - Invariantes, Seção 6 - Contratos, Seção 8 - Validação e checklist (validator)).
2. **IDs das tasks executadas** ou limites claros da slice.
3. **Código realmente alterado** (diff ou lista de arquivos).

---

## Fluxo Obrigatório

### 1. Construir a Boundary da Slice
Antes de revisar o código, identifique o diff físico da slice (`git diff --name-only main...HEAD`).
Extraia do plano (seções do novo template compacto):
* **Seção 2 — Invariantes de execução (derivados do PRD)** — regras e invariantes de execução.
* **Seção 6 — Contratos técnicos (só ambiguidade PRD -> código)** — assinaturas e mappers.
* **Seção 8 — Validação e checklist (validator)** — checklist de QA e regressão específica (tag `(§14)` opcional/legado).
* Quais task IDs foram executadas.
* Quais arquivos foram realmente tocados vs esperados.
* Quais regras "Não mudar" se aplicam à slice.

### 2. Modo Revisor Adversarial
Esta skill encontra problemas primeiro. Não corrija código durante a revisão.
Procure por:
* Regressões comportamentais introduzidas.
* Gaps de lógica ocultos ou cenários de negócio faltantes.
* Bugs de transição de estado e desalinhamento view/store.
* Problemas de segurança ou privacidade.
* Drift de contrato em relação ao plano.
* Gaps de testes e validação.

### 3. Usar o Plano para Caçar Cenários Faltantes
Para cada task executada, compare o objetivo, a mudança esperada e o done criteria com o código real.
Aplique as lentes de cenário aplicáveis (estado reativo, unhappy paths, UI conditional `canManage`, mappers, casts e nullability).

### 4. Distinguir Findings do Diff vs. Pré-existentes
Mapeie o que foi introduzido pelo diff da slice. Problemas pré-existentes devem ser apontados como observações separadas.

### 5. Formato de Saída (Obrigatório)

```markdown
## Slice Review Summary
- Plan: <path or id>
- Tasks reviewed: <Txx,...>
- Verdict: PASS | PASS_WITH_WARNINGS | FAIL

## Findings
### Blockers
- ...

### High
- ...

### Medium / Low
- ...

## Plan mismatches
- Task Txx: expected ... observed ...

## Test gaps
- ...

## Recommended next actions
- ...
```
