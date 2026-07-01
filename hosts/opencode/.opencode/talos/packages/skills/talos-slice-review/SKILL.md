---
name: talos-slice-review
description: Skill `talos-slice-review`. Revisa uma slice implementada após `talos-plan-execute`, usando o plano (`talos-plan-handoff`), invariantes e código tocado como contrato. Revisão fria focada na slice — regressões ocultas, gaps de lógica, cenários em falta, riscos de segurança, violações arquiteturais e testes em falta.
---

# Talos Slice Review

Use this skill only when `--review` is present after `talos-plan-execute` or any equivalent implementation pass has finished a specific plan slice.

Review only the slice that was executed. Do not widen into a generic repo audit unless the user explicitly asks for that.

## Invocation gate

`--review` is the only automatic dispatch condition. Do not auto-trigger from heuristics, diff size, risk level, or validator observations. If `--review` is absent, report that external review was skipped by contract.

## Uso standalone — rótulo de garantia reduzida obrigatório (PRD D10/D11)

Esta skill é **análise de leitura**: revisa código, **não muta código**. Pela fronteira de determinismo do Talos (mutação de código, PRD D10), leitura standalone é **permitida**, mas carrega **risco epistêmico** — a análise não passou pela defesa fria do pipeline (`talos-task-validator`, que é pipeline-only, só `state_path`). Esse risco é mitigado por **rótulo**, não por gate.

**Regra dura:** quando `talos-slice-review` roda **fora do pipeline** (sem o `talos-task-validator` ter fechado a slice via state file), a saída **SEMPRE** sai rotulada como garantia reduzida. É **proibido** simular `validator_status: passed` ou qualquer veredito de validação aprovado — a review é leitura, não validação fria.

### Formato exato do rótulo (obrigatório no topo da saída standalone)

```text
guarantee_level: reduced_standalone
validator_status: not_run (sem validator-closed)
scope: standalone
```

- `guarantee_level: reduced_standalone` — enum fixo (PRD D12); nunca `full_pipeline` em uso standalone.
- `validator_status: not_run (sem validator-closed)` — declara explicitamente que a defesa fria não rodou. **Proibido** escrever `passed`/`pass`.
- `scope: standalone` — marca que a review não está ancorada num state file de pipeline.

Quando a review roda **dentro do pipeline** (despachada pelo orquestrador após o validator frio fechar a slice), o nível de garantia da slice vem do pipeline (`full_pipeline`) e este rótulo de redução **não** se aplica — mas a própria review continua sendo leitura e nunca emite veredito de validador.

> **Invariante:** uma análise de leitura standalone nunca se declara fechada por validação; sai rotulada `reduced_standalone` e jamais simula `validator_status: passed` (PRD D10/D11, fecha Q-08).

## State persistence

Use `talos_run_state` as the primary source for run state, dispatch status, and validator status. Do not read or write run ledger files directly. If MCP state is unavailable, block the review rather than accepting a local file fallback.

---

## Review Contract

Base the review on three inputs:
1. **The plan artifact** produced by `talos-plan-handoff` (Section 2 - Invariantes, Section 6 - Contratos, Section 8 - Validação).
2. **The executed task ids** or slice boundaries.
3. **The real code** touched by the implementation.

---

## Required Workflow

### 1. Build the slice boundary first
Before reviewing code, identify:
* boundary físico do diff a partir do state/task ids; use a base configurada ou upstream e inclua mudanças não commitadas pertencentes à slice.
* Section 2 - Invariants of Execution (contract).
* Section 6 - Technical Contracts (signatures and shapes).
* Section 8 - Validation and Checklist (QA criteria).
* touch files expected vs actual.
* resolved conflicts and permission matrices that apply.

If the diff and the plan disagree materially, call that out as a structural finding or blocker. Do not silently review an invented scope.

### 2. Review in code-review mode, not implementation mode
This skill is not for fixing code first. It is for finding problems first.
Look for:
* behavioral regressions introduced by the slice.
* hidden logic gaps or missing business scenarios.
* state-transition bugs and view/store mismatches.
* security or privacy issues.
* contract drift from the plan.
* validation and tests gaps.

### 3. Use the plan to hunt missing scenarios
For each executed task, compare: stated objective, expected change, invariants preserved, and done criteria with real code.
Ask what the implementation forgot:
* **State & orquestration:** transition states reativity (loading, success, empty, error), rapid triggers concurency, setup/cleanup symmetry, async stale.
* **Business rules:** negative paths, closed decisions, fallsback that weaken invariants.
* **View & rendering:** inputs empty, null, partial, out of order, UI permission conditional.
* **Contracts:** shape drift, enums, mappers, RLS server-side, i18n parity.

Aplique estes probes determinísticos a cada símbolo ou hunk alterado relevante:
* **Linha a linha:** leia cada hunk alterado e a função completa que o contém; construa entradas, estados, timings ou plataformas concretas capazes de provocar falha.
* **Comportamento removido:** para cada guard, validação, cleanup, error path ou teste removido/substituído, identifique o invariante protegido e prove onde o novo código o restabelece.
* **Rastreamento cross-file:** inspecione callers e callees quando assinaturas, shapes de retorno, erros, timing, ordem ou pré-condições mudarem.
* **Altitude:** confirme que a mudança corrige o componente proprietário do invariante, sem empilhar um caso especial local sobre um defeito compartilhado.
* **Regras aplicáveis:** inspecione arquivos de instruções do repo que governam os arquivos alterados. Reporte apenas violações exatas, com path da regra, texto da regra, linha violadora e impacto concreto.

Reuse, simplificação e eficiência só viram findings quando o diff atual cria custo comportamental, operacional ou de manutenção concreto. Não reporte preferências de estilo.

### 4. Distinguish current-diff findings from pre-existing issues
Prefer findings attributable to the executed slice. Mark pre-existing issues as observations or separate notes to keep signals clean and actionable.

### 5. Verifique candidatos antes de reportar

Elimine duplicatas que descrevam o mesmo defeito no mesmo local. Classifique cada candidato restante como:
* `CONFIRMED` — evidência e cenário de falha alcançável sustentam o defeito.
* `REFUTED` — código, tipo, invariante ou guard prova que o candidato é falso ou já está tratado.
* `NEEDS_EVIDENCE` — o cenário é relevante, mas a evidência disponível não estabelece o defeito.

Apenas `CONFIRMED` vira finding. Descarte `REFUTED`. Mova `NEEDS_EVIDENCE` para `Perguntas Abertas ou Suposições`, sem apresentá-lo como defeito. Nunca mantenha um candidato apenas por ser plausível.

Antes de renderizar a saída, materialize os findings confirmados como JSON e execute o gate canônico Node `node scripts/classify_findings.mjs <findings.json>`. Cada item deve conter `severity`, `task_id`, `title`, `file`, `line`, `failure_mode`, `evidence`, `recommendation` e `fix_validation`. Saída não-zero bloqueia o relatório até o payload ser corrigido; é proibido ignorar o gate ou substituir campos ausentes por texto vazio. Array vazio é válido quando não há findings confirmados.

Node é o único requisito runtime deste gate e funciona em Linux/macOS/Windows. `scripts/classify_findings.py` permanece por uma release somente como wrapper compatível que delega ao Node; não é fonte canônica nem torna Python obrigatório.

### 6. Recomende uma correção de causa raiz

Todo finding deve incluir exatamente uma recomendação principal de correção e uma validação que comprove a correção. A recomendação deve:
* atacar a causa raiz no componente proprietário do invariante violado;
* ser cirúrgica e permanecer no boundary revisado, salvo quando a evidência provar que o proprietário está fora dele;
* preservar contratos do plano, arquitetura e comportamento existente não implicado pelo finding;
* nomear concretamente componente, condição e comportamento esperado;
* ser a melhor correção sustentada pela evidência disponível, nunca uma alegação sem suporte de superioridade absoluta.

Não ofereça alternativas A/B. Não forneça patch completo nem altere código. Se a evidência for insuficiente para recomendar uma correção com segurança, classifique o candidato como `NEEDS_EVIDENCE` em vez de emitir finding.

### 7. Output Expectations

Return exactly this structure:

```markdown
## Findings

### P0 - <short title>
- **Slice/Task:** T0N
- **Por que importa:** [impacto real]
- **Arquivo:** `relative/path.ext:line`
- **Modo de falha:** [o que quebra e como]
- **Evidência:** [o que suporta o finding]
- **Correção recomendada:** [uma correção cirúrgica na causa raiz]
- **Validação da correção:** [teste/check específico que comprova a resolução]

### P1 - <short title>
[same shape]

### P2 - <short title>
[same shape]

### P3 - <short title>
[same shape]

---

## Perguntas Abertas ou Suposições
[questões que precisam de confirmação antes de agir nos findings]

---

## Resumo da Slice
[breve — o que foi bem implementado, o que precisa atenção, se a slice pode ser considerada fechada]
```

Do not add extra sections or narrative conclusions.
