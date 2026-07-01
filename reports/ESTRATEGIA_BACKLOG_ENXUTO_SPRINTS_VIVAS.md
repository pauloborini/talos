# Estratégia Talos — Backlog Enxuto e Sprints Vivas

Data: 2026-06-29

## Resumo executivo

O Talos deve evoluir de um backlog mestre monolítico para um modelo em duas camadas:

- **Backlog mestre enxuto**: índice estratégico, fases, tabela de sprints, dependências, prioridade, status e links.
- **Arquivo vivo de sprint**: fonte de verdade detalhada de cada sprint, com contexto, critérios, decisões, evals, riscos e histórico.

Isto preserva a premissa central do Talos: macro fica no backlog; execução continua pequena, determinística e validável por sprint.

## Decisão proposta

Usar esta estrutura padrão:

```text
.talos/backlog/BACKLOG_MESTRE_<produto>.md
.talos/backlog/sprints/S01_<slug>.md
.talos/prd/PRD_S01_<slug>.md
.talos/plans/PLAN_S01_<slug>.md
.talos/state/<run_id>/
```

O backlog mestre não deve duplicar o conteúdo detalhado da sprint. Ele aponta para a sprint e espelha apenas resumo/status/dependências.

## Fonte de verdade por camada

| Camada | Fonte | Responsabilidade |
|---|---|---|
| Estratégia macro | `BACKLOG_MESTRE_*.md` | visão, fases, ordem, dependências, prioridade, próxima sprint |
| Escopo da sprint | `sprints/SNN_*.md` | contexto completo da sprint, critérios, riscos, decisões, evals |
| Contrato de produto | `PRD_SNN_*.md` | especificação aprovada para implementação |
| Contrato de execução | `PLAN_SNN_*.md` | tarefas executáveis, invariantes, gates |
| Prova de execução | `.talos/state/<run_id>/` | diff, evidência, validator, trace |

## Conteúdo do backlog mestre

Manter enxuto:

- objetivo macro;
- princípios/invariantes;
- fases;
- tabela de sprints com ID, título, status, MoSCoW, ganho, esforço, prioridade e link;
- grafo de dependências;
- próxima sprint executável;
- decisões macro;
- riscos macro;
- registro de alterações.

Evitar:

- critérios completos de cada sprint;
- plano técnico;
- decisões locais detalhadas;
- listas longas de tasks;
- logs de execução.

## Conteúdo do arquivo vivo de sprint

Cada `SNN_<slug>.md` deve conter:

- ID imutável da sprint;
- link bidirecional para o backlog mestre;
- objetivo único;
- resultado esperado;
- fora de escopo;
- dependências internas/externas;
- contexto relevante;
- decisões abertas/fechadas;
- critérios de aceite;
- DoR/DoD;
- `eval_manifest`;
- gates esperados;
- riscos e fallback;
- links para PRD, PLAN, state/trace e validator;
- histórico vivo de alterações.

## Aprendizados incorporados

### 1. Contexto limpo por unidade pequena

O harness local mostrou que tarefas longas degradam modelo. Talos já reduz esse risco com sprint/slice pequena. Separar sprint em arquivo próprio reforça isto: o agente lê só a sprint, não o backlog inteiro.

Aplicação:

- `talos-sprint-prd-generator` deve ler o arquivo da sprint como fonte primária.
- Backlog mestre entra apenas para dependências e ordem macro.

### 2. Guides e sensors

Guides orientam antes da ação; sensors verificam depois.

Aplicação:

- Guides: backlog mestre, sprint file, PRD, PLAN, AGENTS.md, skills.
- Sensors: lint/testes, `talos_scan_prd`, template conformance, validator, review, evals.

### 3. Evidence-to-claim

ARIS reforça que toda conclusão deve ter prova. No Talos, cada claim da sprint precisa apontar para evidência.

Aplicação:

- sprint file registra critérios;
- PRD transforma critérios em contrato;
- PLAN mapeia tarefas para evidências;
- validator exige `claim -> evidence`.

### 4. Eval manifesto por sprint

Langfuse/AgentOps reforça eval contínuo. No Talos, isto deve existir localmente, sem SaaS obrigatório.

Aplicação:

```yaml
eval_manifest:
  acceptance_criteria:
    - id: AC-01
      evidence_required: file_line_or_test
      gate: required
  regression_cases:
    - id: REG-01
      source: previous_failure
  thresholds:
    p0: 0
    p1: 0
    missing_evidence: 0
```

### 5. Trace e aprendizado entre sprints

Meta-Harness mostrou que otimização sem traces ricos vira chute.

Aplicação:

- cada run grava trace local;
- sprint file linka trace relevante;
- falhas viram regressions/eval cases;
- backlog só espelha status final.

### 6. Policy manifest

CUGA reforça políticas configuráveis.

Aplicação por sprint:

```yaml
policy_manifest:
  tool_approval: explicit_for_external_side_effects
  allowed_mutation_scope:
    - path_or_feature_boundary
  output_format: talos_validator_schema
  guardrails:
    - no_backend_contract_change_without_prd
```

### 7. Review adversarial com limite

Council/ARIS ajudam em revisão, mas consenso livre não é gate determinístico.

Aplicação:

- review adversarial opcional para sprint crítica;
- output vira findings com evidência;
- severidade/veredito continuam determinísticos no validator.

## Contratos de sincronização

Para evitar drift:

- IDs de sprint são imutáveis.
- Backlog mestre e sprint file têm link bidirecional.
- Status duplicado deve bater.
- Dependências no backlog devem referenciar IDs existentes.
- Sprint `done` não pode ser editada sem registro explícito.
- Decisão fechada não pode ser reaberta sem nova decisão registrada.
- PRD só nasce de sprint file ou backlog-item recortado, não de macro input solto.

## Gates novos sugeridos

1. `talos_verify_backlog_index`
   - valida links para sprint files;
   - valida dependências;
   - valida status espelhado.

2. `talos_verify_sprint_file`
   - valida template da sprint;
   - valida links para backlog/PRD/PLAN;
   - valida `eval_manifest`.

3. `talos_select_next_sprint`
   - lê backlog mestre;
   - escolhe próxima sprint executável;
   - bloqueia dependência não done.

4. `talos_update_sprint_status`
   - atualiza sprint file e espelho no backlog;
   - exige registro de alteração;
   - bloqueia drift.

## Mudança nas skills

### `talos-backlog-generator`

Deve criar/atualizar:

- backlog mestre enxuto;
- arquivos vivos de sprint;
- links bidirecionais;
- próxima sprint executável.

### `talos-sprint-prd-generator`

Deve priorizar:

1. arquivo vivo da sprint;
2. backlog mestre apenas para dependências/status;
3. código/docs reais para descoberta técnica.

### `talos`

Fluxo recomendado:

```text
macro input
  -> talos-backlog-generator
  -> BACKLOG_MESTRE + sprints/SNN
  -> select next sprint
  -> talos-sprint-prd-generator
  -> talos-plan-handoff
  -> talos-plan-execute/talos-direct-execute
  -> talos-task-validator
```

Para `backlog-item` existente:

```text
backlog-item
  -> sprints/SNN
  -> PRD
  -> PLAN/EXEC
```

## Próxima slice sugerida

`S-BACKLOG-02 — Backlog enxuto + sprint files vivos`

Escopo:

- criar `SPRINT_TEMPLATE.md`;
- ajustar `BACKLOG_MESTRE_TEMPLATE.md` para índice enxuto;
- atualizar `talos-backlog-generator`;
- atualizar `talos-sprint-prd-generator`;
- adicionar validações de link/status/dependência;
- adicionar testes de update não destrutivo.

Fora de escopo:

- mudar execução de código;
- mudar validator sibling;
- adicionar SaaS/OTEL;
- auto-otimizar harness.

## Resumo final

Esta estratégia mantém o Talos fiel ao desenho atual: backlog macro, sprint pequena, PRD recortado, plano executável e validação fria. A melhoria é estrutural: o backlog deixa de carregar todos os detalhes e passa a apontar para arquivos vivos de sprint, que viram a fonte contextual correta para PRD, execução, eval e aprendizado contínuo.
