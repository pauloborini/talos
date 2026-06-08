# Relatório — erros do pipeline Atlas S27 PayTrainer

Data: 2026-06-08  
Origem: `/Volumes/Dados/projetos/paytrainer-app`  
Destino solicitado: `/Volumes/Dados/projetos/atlas-workflow/reports/`  
Run: `atlas-s27-qa-automacao`  
Plano: `.atlas/plans/PLAN_S27_qa_automacao.md`  
State final usado: `.atlas/state/atlas-s27-qa-automacao/s27-qa-automacao.json`

## 1. Resumo executivo

O pipeline executou a S27 localmente, mas não fechou como `pass` no validator.

Houve avanço real:

- plano validado por G1 e template conformance;
- preflight Atlas passou com garantia `full_pipeline`;
- testes alvo passaram após reparos;
- `flutter analyze` passou;
- `git diff --check` passou;
- boundary state foi criado e atualizado.

Mas houve problemas relevantes no pipeline:

- `atlas-task-validator` não estava exposto como `agent_type` nativo no Codex, apesar de `atlas_capabilities` declarar subagent disponível.
- Foi necessário usar fallback via subagente `default` carregando a skill do validator.
- O primeiro `flutter test` falhou por sandbox ao acessar cache do Flutter fora do workspace.
- O validator retornou `fail` três vezes, sempre com findings P2.
- O limite de 2 ciclos de reparo do executor foi atingido.
- O último veredito observado permanece `fail` por lacuna de cobertura M5 fullPage.

Conclusão: a implementação local ficou mais forte e os gates locais estão verdes, mas a slice S27 não deve ser marcada como fechada pelo Atlas enquanto o último finding P2 do validator não for resolvido ou explicitamente aceito como follow-up pelo dono do produto/engenharia.

## 2. Linha do tempo observada

### 2.1 Entrada e triagem

Pedido recebido:

```text
mcp atlas execute PLAN_S27_qa_automacao.md
```

Classificação local por AGENTS.md:

- tipo primário: `testing`;
- índice carregado: `project-rules/index/testing.md`;
- regras obrigatórias carregadas:
  - `project-rules/rules/patterns_rules.md`;
  - `project-rules/rules/architecture_rules.md`.

Pré-confirmação emitida antes da execução.

### 2.2 Gates Atlas iniciais

Passaram:

- `atlas_capabilities(host=codex)`;
- `atlas_verify_artifact(.atlas/plans/PLAN_S27_qa_automacao.md)`;
- `atlas_verify_template_conformance(... artifact_type=plan)`;
- `atlas_preflight(mode=execute, host=codex)`.

Resultado relevante de capabilities:

```json
{
  "host": "codex",
  "validator_dispatch": {
    "topology": "sibling",
    "nested_subagent_available": false,
    "dispatcher": "orchestrator"
  },
  "capabilities_flags": {
    "subagent_available": true,
    "mcp_available": true,
    "todo_available": true
  }
}
```

Interpretação: executor não deveria tentar validator nested; deveria devolver `validator_handoff_required` com `state_path`.

### 2.3 Execução inicial

Foram adicionados testes em:

- `apps/paytrainer_pro/test/features/gamification/services/gamification_service_test.dart`
- `apps/paytrainer_pro/test/features/gamification/presentation/components/gamification_widgets_test.dart`

Cobertura inicial adicionada:

- trilha e colapso M1-M6;
- shell activation/full e sanitização de tab/deep link;
- latch monotônico;
- persistência local por usuário;
- celebrações M4/M5/M6;
- sheets M4/M5/M6;
- CTA de jornada;
- fallback vazio/loading/erro em alguns widgets.

### 2.4 Falha operacional: Flutter cache fora do sandbox

Primeira tentativa:

```bash
cd apps/paytrainer_pro && flutter test test/features/gamification test/features/main
```

Falhou com:

```text
/Users/pauloborini/src/flutter/bin/internal/update_engine_version.sh: line 64: /Users/pauloborini/src/flutter/bin/cache/engine.stamp: Operation not permitted
```

Causa: sandbox bloqueou escrita/leitura necessária no cache do SDK Flutter fora do workspace.

Correção operacional aplicada: reexecutar com permissão elevada. Depois disso, o comando rodou.

Impacto Atlas: esse erro não é falha do produto, mas é falha de ambiente/gate. O pipeline precisa prever que Flutter SDK/cache pode exigir permissão fora do workspace em Codex App.

## 3. Problema principal de orquestração

### 3.1 `atlas-task-validator` não disponível como agent_type

Tentativa de dispatch nativo:

```text
spawn_agent(agent_type: "atlas-task-validator", items: [state_path])
```

Resultado:

```text
unknown agent_type 'atlas-task-validator'
```

Isso contradiz parcialmente a expectativa operacional do Atlas:

- `atlas_capabilities` declarou `subagent_available=true`;
- a skill `atlas-plan-execute` documenta que Codex usa `spawn_agent(agent_type: "atlas-task-validator")`;
- mas o host real não expôs esse `agent_type`.

Fallback usado:

- `spawn_agent(agent_type: "default")`;
- item skill: `atlas-task-validator/SKILL.md`;
- input textual contendo apenas o `state_path` como base;
- instrução explícita para retornar JSON final e não editar arquivos.

Impacto: validação fria foi executada, mas a garantia não é idêntica à rota nativa documentada. O Atlas Workflow deveria tratar isso como degradação operacional explícita, não como caminho normal silencioso.

## 4. Validator — rodada 1

State usado:

```text
.atlas/state/atlas-s27-qa-automacao/s27-qa-automacao.json
```

Veredito:

```json
{
  "verdict": "fail"
}
```

Findings:

| Severidade | Arquivo | Problema |
|------------|---------|----------|
| P2 | `gamification_service_test.dart` | M5 e M6 enfileiravam celebração, mas não testavam não repetição após `acknowledge`. |
| P2 | `gamification_widgets_test.dart` | Widgets cobriam sheets/CTA, mas não havia evidência de loading/vazio/erro/permissão. |

Boundary violation:

| Arquivo | Problema |
|---------|----------|
| `.app-vault/docs/prd/PRD_S27_qa_automacao.md` | Arquivo aparecia untracked no worktree e não constava em `files_changed` do state. |

Reparo aplicado:

- M5: adicionar `acknowledgeCelebration(m5)` e confirmar não repetição.
- M6: adicionar `acknowledgeCelebration(m6)` e confirmar não repetição.
- Widgets: adicionar casos para fallback vazio/loading/erro/permissão viáveis.
- State: incluir PRD untracked em `files_changed` para refletir boundary real observado.

Validações após reparo:

```bash
cd apps/paytrainer_pro && flutter test test/features/gamification test/features/main
cd apps/paytrainer_pro && flutter analyze
git diff --check
```

Resultado: todos verdes.

## 5. Validator — rodada 2

Veredito:

```json
{
  "verdict": "fail"
}
```

Findings:

| Severidade | Arquivo | Problema |
|------------|---------|----------|
| P2 | `gamification_widgets_test.dart` | T05/PRD pediam cobertura de superfícies Home/Planos/Perfil quando viável; teste cobria sheets/componentes genéricos, mas não integração Planos/Perfil. |
| P2 | `gamification_widgets_test.dart` | Teste nomeado erro/permissão apenas renderizava `JourneyProgressCard` sem action label, sem simular estado real de erro/permissão. |

Reparo aplicado:

- Planos: teste com `PlansActivationEmptySection`, CTA de jornada e botão `Criar plano`.
- Perfil: teste com `JourneyProgressCard` em modo equivalente ao usado pela `ProfilePage`, com CTA acionável.
- Loading: teste real com `PlansPageLoading`, sem CTA de jornada.
- Erro/permissão recuperável: teste real com `HomeTrainerAggregateErrorCard`, `tryAgain` e ausência de CTA operacional.
- Removido o teste enganoso que só simulava erro por ausência de action label.

Falha intermediária no reparo:

```text
pumpAndSettle timed out
```

Causa: `PlansPageLoading` usa skeleton/animação que não estabiliza para `pumpAndSettle`.

Correção:

```dart
await tester.pump();
```

Impacto: falha de teste, não de produto.

Validações após reparo:

```bash
cd apps/paytrainer_pro && flutter test test/features/gamification test/features/main
cd apps/paytrainer_pro && flutter analyze
git diff --check
```

Resultado: todos verdes.

## 6. Validator — rodada final observada

Veredito final observado:

```json
{
  "verdict": "fail",
  "findings": [
    {
      "severity": "P2",
      "file": "apps/paytrainer_pro/test/features/gamification/presentation/components/gamification_widgets_test.dart",
      "line": 65,
      "msg": "T05/PRD §4-6 não cobre a apresentação real da celebração M5: o teste instancia MilestoneSheet, mas o fluxo de produção envia M5 para apresentação fullPage; falta cobertura do listener/página real de celebração M5."
    }
  ],
  "boundary_violations": []
}
```

Observações positivas do validator final:

- template do PLAN passou;
- template do PRD passou;
- `flutter analyze` passou;
- `flutter test test/features/gamification test/features/main` passou.

Problema restante:

- M5 é `JourneyMilestoneCelebrationPresentation.fullPage` em produção;
- o teste existente validou `MilestoneSheet(m5)`, que não representa a superfície real de apresentação M5;
- falta teste de `JourneyMilestoneCelebrationPage` ou do `MilestoneCelebrationListener` roteando M5 para full page.

Status correto: `fail` por P2, após 2 ciclos de reparo.

## 7. Estado final do state Atlas

State atualizado:

```json
{
  "run_id": "atlas-s27-qa-automacao",
  "slice": "s27-qa-automacao",
  "tasks": ["T01", "T02", "T03", "T04", "T05", "T06"],
  "files_changed": [
    "apps/paytrainer_pro/test/features/gamification/services/gamification_service_test.dart",
    "apps/paytrainer_pro/test/features/gamification/presentation/components/gamification_widgets_test.dart",
    ".app-vault/docs/prd/PRD_S27_qa_automacao.md"
  ],
  "diff_stat": "3 files, +673 -34",
  "plan_path": ".atlas/plans/PLAN_S27_qa_automacao.md",
  "boundary_refs": ["PLAN §2", "PLAN §5 T01-T06", "PLAN §6", "PLAN §8", "PRD §3", "PRD §4", "PRD §5", "PRD §6"],
  "executed_at": "2026-06-08T01:11:02Z",
  "executor_skill": "atlas-plan-execute"
}
```

Run state MCP atualizado para:

```json
{
  "phase": "slice_validating",
  "status": "validator_handoff_required",
  "repair_cycle": 2
}
```

Observação: após o validator final `fail`, o estado ainda precisaria ser atualizado para `blocked` ou equivalente. Isso não foi feito antes deste relatório porque o pedido mudou para documentação dos erros.

## 8. Estado sujo observado no PayTrainer

Durante a criação deste relatório, `git status --short` em `/Volumes/Dados/projetos/paytrainer-app` mostrou várias mudanças fora da fronteira original da S27.

Exemplos observados:

```text
 M apps/paytrainer_pro/lib/features/auth/services/post_auth_route_resolver.dart
 M apps/paytrainer_pro/lib/features/gamification/di/gamification_di.dart
 M apps/paytrainer_pro/lib/features/gamification/gamification.dart
 M apps/paytrainer_pro/lib/features/gamification/services/gamification_service.dart
 M apps/paytrainer_pro/lib/features/main/presentation/pages/main_page.dart
 M apps/paytrainer_pro/lib/l10n/app_en.arb
 M apps/paytrainer_pro/lib/l10n/app_pt.arb
 M apps/paytrainer_pro/test/features/gamification/services/gamification_service_test.dart
?? .app-vault/docs/prd/gamificacao/PRD_S22_edge_recuperacao.md
?? apps/paytrainer_pro/lib/features/gamification/services/gamification_shell_redirect_feedback_service.dart
```

Interpretação: a árvore de trabalho contém mudanças de outras slices/sessões. O validator desta rodada avaliou o boundary informado no state, mas o workspace real não estava limpo. Para determinismo forte, o Atlas deveria registrar dirty baseline antes de executar ou exigir worktree isolada por run.

## 9. Diagnóstico de causa raiz

### 9.1 Registro de subagente Codex incompleto

O maior problema de pipeline foi a divergência entre contrato e host real:

- contrato: `atlas-task-validator` disponível como subagent nativo;
- realidade: `spawn_agent(agent_type: "atlas-task-validator")` falhou.

A capability `subagent_available=true` foi insuficiente. O gate deveria validar o agent_type exato antes de declarar full pipeline.

### 9.2 Executor em Codex fica dependente de fallback manual

Como a topologia é `sibling`, o executor para corretamente em `validator_handoff_required`.

Mas sem um orquestrador real chamando o agent_type correto, o usuário precisou pedir “Rode o validador” e o executor precisou improvisar fallback.

### 9.3 State boundary precisou ser corrigido no meio da validação

O PRD estava untracked e fora de `files_changed`. O validator marcou boundary violation corretamente.

Isso indica que o state file precisa incluir todos os artefatos documentais criados/alterados, não só código/testes.

### 9.4 Critério T05 estava amplo demais para teste widget rápido

O plano exigia Home/Planos/Perfil + loading/vazio/erro/permissão/sucesso “quando viável”. O executor fez cobertura incremental, mas o validator interpretou corretamente que alguns testes eram genéricos demais.

Isso gerou ciclos de reparo focados em tornar os testes mais representativos de superfícies reais.

### 9.5 Limite de reparo foi atingido com finding residual

A skill `atlas-plan-execute` limita reparo a 2 ciclos. Após o terceiro validator com `fail`, o comportamento correto é bloquear ou pedir decisão explícita, não continuar reparando indefinidamente.

## 10. Recomendações para o Atlas Workflow

### 10.1 Validar agent_type real no preflight

Adicionar gate que tente descobrir/validar explicitamente:

```text
atlas-task-validator registrado como agent_type invocável
```

Não basta `subagent_available=true`.

Se o agent_type não existir:

- `guarantee_level` deve cair para `reduced_standalone`; ou
- o preflight deve falhar; ou
- o fallback default+skill deve ser formalizado como rota degradada.

### 10.2 Registrar fallback de validator como degradação

Quando usar `default` + skill markdown, o relatório/state deveria marcar:

```json
{
  "validator_dispatch_mode": "fallback_default_agent_with_skill",
  "guarantee_level": "degraded"
}
```

### 10.3 State file deve incluir docs/PRDs vivos

Se PRD/plano/documento usado na slice está untracked ou alterado, deve entrar em `files_changed` ou em campo separado:

```json
"artifacts_changed": []
```

Isso evita boundary violation tardia.

### 10.4 Capturar dirty baseline

Antes da execução, registrar:

```bash
git status --short
```

E separar:

- mudanças preexistentes;
- mudanças do executor;
- artefatos Atlas gerados.

Sem isso, validator em worktree suja fica menos determinístico.

### 10.5 Checklist T05 precisa ser mais objetivo

Texto como “quando viável” é interpretável. Melhor transformar em checklist fechado por superfície:

- Home: CTA activation, loading, erro recuperável.
- Planos: empty activation, loading, erro sem planos.
- Perfil: journey card e CTA.
- M5: fullPage celebration.

Isso reduz ciclos de validator por ambiguidade.

### 10.6 Validator deveria distinguir “gap residual pós-limite” de “pipeline bug”

O último `fail` é um gap real de cobertura, não bug do Atlas. O pipeline bug foi o agent_type ausente. O relatório final do orquestrador deveria separar:

- `pipeline_failure`: infraestrutura/orquestração;
- `slice_failure`: contrato não atendido;
- `environment_failure`: sandbox/cache;
- `worktree_hygiene`: dirty baseline.

## 11. Próximo passo recomendado

Para fechar S27 corretamente:

1. Adicionar teste real da apresentação M5 fullPage:
   - `JourneyMilestoneCelebrationPage`, ou
   - `MilestoneCelebrationListener` garantindo que M5 usa fullPage em vez de sheet.
2. Rodar:
   ```bash
   cd apps/paytrainer_pro && flutter test test/features/gamification test/features/main
   cd apps/paytrainer_pro && flutter analyze
   git diff --check
   ```
3. Atualizar `.atlas/state/atlas-s27-qa-automacao/s27-qa-automacao.json`.
4. Rodar validator novamente.
5. Se passar, marcar `slice_done`; se falhar, bloquear, pois o limite de reparo já foi atingido.

## 12. Veredito deste relatório

Resultado técnico local: parcial, com gates locais verdes.  
Resultado Atlas: não fechado.  
Último validator: `fail` P2.  
Falha de pipeline Atlas: sim, por agent_type nativo ausente apesar de capabilities indicarem subagent disponível.  
Falha de contrato da slice: sim, cobertura M5 fullPage ainda ausente.  
Ação recomendada: corrigir M5 fullPage ou registrar bloqueio explícito antes de qualquer fechamento.
