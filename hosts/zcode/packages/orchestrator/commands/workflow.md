---
description: Orquestra pipeline de desenvolvimento de feature no Atlas (backlog macro → sprint file → PRD → validação → entrevista → plano → execução → review) e auditoria universal sem correção
argument-hint: <mode> <input-type|target> [input] [--interview] [--review] [--handoff] [--scope] [--help]
---

Você está executando o comando `/workflow` do plugin **atlas-workflow-orchestrator**.

Argumentos recebidos: `$ARGUMENTS`

## Ação

1. Invoque a skill **`atlas-workflow-orchestrator`** passando os argumentos acima como input.
2. A skill é dona de toda a lógica: parsing de `<mode> <input-type> [input] [flags]`, orquestração das sub-skills, validação de ambiguidades, resolução de decisão em aberto via entrevista (não para o pipeline) e formato de output. Siga o `SKILL.md` dela como contrato.
3. Se `$ARGUMENTS` estiver vazio ou contiver `--help`, mostre a sintaxe completa da skill e pare.

## Referência rápida de sintaxe

```
/workflow <mode> <input-type|target> [input] [flags]
```

- **mode**: `full` · `direct` · `execute` · `interview-only` · `audit`
- **input-type**: `backlog-item` · `idea` · `prd` · `plan` · `brainstorm`
- **flags**: `--interview` · `--review` · `--handoff` · `--scope <descrição>` · `--help`

Exemplos:

```
/workflow full backlog-item "S05"
/workflow direct prd "/path/PRD_S05.md" --review
/workflow execute plan "/path/PLAN_S05.md"
/workflow interview-only brainstorm "que tal dark mode?"
/workflow audit apps/mobile/lib/features/auth --handoff
→ Gera relatório e `.atlas/plans/PLAN_AUDIT_*.md`; não executa correções
```

Não improvise comportamento fora do `SKILL.md`. **Pipeline é fire-and-continue**: uma vez iniciado, avança fase a fase sem pedir permissão entre gates; só para em gate duro `blocked` ou blockage de ambiente real (ver "Princípio de continuação automática"). Nunca invente "Modo Discussão" ou peça "quer que eu gere/continue?". Decisão em aberto não para — dispara entrevista, propaga e segue. Em caso de erro real, siga "Error handling".

**Gates duros (v0.3):** o pipeline é orientado a artefato e MCP. Antes de iniciar, rode a **Fase 0 (Pré-flight)** com `atlas_ping`, `atlas_capabilities` e `atlas_preflight`; use ids `atlas-*`; garanta que cada sub-agent carregue o `SKILL.md` real antes de agir. Se MCP não responder, resultado exigido estiver ausente ou status for bloqueante, **aborte; nunca use fallback narrativo**. Respeite os Gates G1–G11 + TC da SKILL: backlog macro gera/atualiza sprint file antes de PRD; backlog existente passa por `atlas_verify_backlog_index`; macro input escolhe próxima sprint via `atlas_select_next_sprint`; `backlog-item` exige sprint file vivo validado por `atlas_verify_sprint_file`; após validator terminal, sprint/backlog fecham via `atlas_update_sprint_status`; `atlas_verify_artifact` antes de avançar (G1); em `full`, nenhum código antes de `PLAN_*.md` validado (G2); skills invocadas de verdade (G3); validador frio como sub-agent separado (G4); `atlas_scan_prd` determinístico e logado (G5); status verificado contra disco e MCP (G6); execução/review como sub-agents reais com `atlas_lock_dispatch`, enquanto PRD/entrevista/plano são autoria documental no pai (G7/G8); orquestrador de mãos atadas e dispatch blocking (G9); família única atlas-* via `atlas_preflight` (G10); em hosts com `dispatch_capability:"unknown"`, execução exige `host_capabilities.dispatch_mutable:true` ou o gate DISPATCH bloqueia; em `full`, `atlas_assert_after_plan` exige `atlas-plan-execute` após plano (G11); `direct` usa `atlas-direct-execute`; ambos mantêm `phase: plan_execute`; PRD/PLAN de sprint exigem `atlas_verify_template_conformance(..., require_sprint_file=true)` passed com `pending_count: 0` (TC). Em `interview-only brainstorm`, crie draft mínimo pelo template antes de invocar `atlas-prd-interview` com `prd_path` válido.
