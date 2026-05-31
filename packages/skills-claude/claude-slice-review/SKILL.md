---
name: claude-slice-review
description: Skill `claude-slice-review` (par com `cursor-slice-review` / `codex-slice-review`). Use após `claude-plan-execute` concluir uma slice. Revisa só a slice executada com o plano como contrato. Revisão fria — idealmente nova sessão. Encontra regressões comportamentais, gaps de lógica, cenários em falta, riscos de segurança e violações arquiteturais antes de considerar o trabalho fechado.
---

# Claude Slice Review

Use esta skill **após** `claude-plan-execute` terminar uma slice de implementação.

Esta é uma **revisão fria** — idealmente em nova sessão, sem memória da implementação, para evitar viés do executor.

---

## Contrato de Revisão

A revisão se baseia em três inputs:

1. **Artefato do plano** — `.claude/plans/<nome>.md` produzido pelo `claude-plan-handoff`.
2. **Tasks executadas** — quais T0N foram implementadas.
3. **Código real tocado** — arquivos modificados na implementação.

---

## Fluxo Obrigatório

### Passo 1 — Construir a Boundary da Slice
Antes de revisar o código, identifique o diff físico da slice (`git diff --name-only main...HEAD`).
Extraia do plano (seções do novo template compacto):
* **Seção 2 — Invariantes de execução (derivados do PRD)** — contrato não-negociável.
* **Seção 6 — Contratos técnicos (só ambiguidade PRD -> código)** — shapes, regras e assinaturas.
* **Seção 8 — Validação e checklist (§14)** — invariantes específicos e checks de QA.
* Quais task IDs foram executadas.
* Quais arquivos foram realmente tocados vs esperados.
* Quais regras "Não mudar" se aplicam à slice.

*Se as seções principais não existem no plano, registre como finding estrutural antes de revisar o conteúdo. Não force escopos inventados.*

### Passo 2 — Modo Revisão, não Implementação
Esta skill encontra problemas primeiro. Não corrija código durante a revisão.
Procure por:
* Regressões comportamentais introduzidas.
* Gaps de lógica ocultos ou cenários de negócio faltantes.
* Bugs de transição de estado e desalinhamento view/store.
* Problemas de segurança ou privacidade.
* Drift de contrato em relação ao plano.
* Gaps de testes e validação.

### Passo 3 — Usar o Plano para Caçar Cenários Faltantes
Para cada task executada, compare o objetivo, a mudança esperada e o done criteria com o código real.
Aplique as lentes de cenário aplicáveis:
* **Estado e orquestração:** Transições de estado reativas (loading, success, empty, error), taps rápidos de concorrência, cleanup simétrico, async stale.
* **Regras de negócio:** Caminhos negativos do plano tratados, decisões fechadas aplicadas.
* **View e renderização:** Casos de renderização de inputs vazios, nulls, parciais, feedback condicional ao usuário.
* **Contratos e integração:** Divergência de shape, enums, mappers, RLS server-side, i18n em todos os ARBs.
* **Segurança:** Enfraquecimento de permissões, bypass de auth, session cleanups.

### Passo 4 — Distinguir Findings do Diff vs. Pré-existentes
Mapeie o que foi introduzido pelo diff da slice. Problemas pré-existentes devem ser apontados como observações separadas.

### Passo 5 — Output (Estrutura Fixa)

```markdown
## Findings

### P0 — [título]
- **Slice/Task:** T0N
- **Por que importa:** [impacto real]
- **Arquivo:** `path/arquivo.dart:linha`
- **Modo de falha:** [o que quebra e como]
- **Evidência:** [o que suporta o finding]

### P1 — [título]
[mesmo formato]

### P2 — [título]
[mesmo formato]

### P3 — [título]
[mesmo formato]

---

## Perguntas Abertas ou Suposições
[questões que precisam de confirmação antes de agir nos findings]

---

## Resumo da Slice
[breve — o que foi bem implementado, o que precisa atenção, se a slice pode ser considerada fechada]
```
