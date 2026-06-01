---
description: Orquestra pipeline de desenvolvimento de feature no Atlas (PRD → validação → entrevista → plano → execução → review)
argument-hint: <tool> <mode> <input-type> [input] [--interview] [--review] [--help]
---

Você está executando o comando `/workflow` do plugin **atlas-workflow-orchestrator**.

Argumentos recebidos: `$ARGUMENTS`

## Ação

1. Invoque a skill **`atlas-workflow-orchestrator`** passando os argumentos acima como input.
2. A skill é dona de toda a lógica: parsing de `<tool> <mode> <input-type> [input] [flags]`, orquestração das sub-skills, validação de ambiguidades, lógica de decisão A/B/C e formato de output. Siga o `SKILL.md` dela como contrato.
3. Se `$ARGUMENTS` estiver vazio ou contiver `--help`, mostre a sintaxe completa da skill e pare.

## Referência rápida de sintaxe

```
/workflow <tool> <mode> <input-type> [input] [flags]
```

- **tool**: `claude` · `cursor` · `codex`
- **mode**: `full` · `direct` · `interview-only`
- **input-type**: `backlog-item` · `idea` · `prd` · `brainstorm`
- **flags**: `--interview` · `--review` · `--help`

Exemplos:

```
/workflow <tool> full backlog-item "S05"
/workflow <tool> direct prd "/path/PRD_S05.md" --review
/workflow <tool> interview-only brainstorm "que tal dark mode?"
```

Não improvise comportamento fora do `SKILL.md`. Em caso de ambiguidade ou erro, siga as seções "Lógica de decisão" e "Error handling" da skill.

**Gates duros (v0.2):** o pipeline é orientado a artefato e MCP. Antes de iniciar, rode a **Fase 0 (Pré-flight)** com `atlas_ping`, `atlas_preflight` e `atlas_lock_family`; carregar config/defaults do pacote; resolver ids da família `<tool>`; garantir que cada sub-agent carregue o `SKILL.md` real antes de agir. Se MCP não responder, resultado exigido estiver ausente ou status for bloqueante, **aborte; nunca use fallback narrativo**. Respeite os Gates G1–G11 + TC da SKILL: `atlas_verify_artifact` antes de avançar (G1); em `full`, nenhum código antes de `PLAN_*.md` validado (G2); skills invocadas de verdade (G3); validador frio como sub-agent separado (G4); `atlas_scan_prd` determinístico e logado (G5); status verificado contra disco e MCP (G6); plano/execução/review como sub-agents reais com `atlas_lock_dispatch` (G7/G8); orquestrador de mãos atadas e dispatch blocking (G9); roteamento por `<tool>` via `atlas_preflight`/`atlas_lock_family` (G10); em `full`, `atlas_assert_after_plan` exige `plan_execute` após plano (G11); PRD/PLAN exigem `atlas_verify_template_conformance` passed com `pending_count: 0` (TC).
