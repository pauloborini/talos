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

- **tool**: `claude` (MVP) · `cursor`/`codex`/`antigravity` (futuro)
- **mode**: `full` · `direct` · `interview-only`
- **input-type**: `backlog-item` · `idea` · `prd` · `brainstorm`
- **flags**: `--interview` · `--review` · `--help`

Exemplos:

```
/workflow claude full backlog-item "S05"
/workflow claude direct prd "/path/PRD_S05.md" --review
/workflow claude interview-only brainstorm "que tal dark mode?"
```

Não improvise comportamento fora do `SKILL.md`. Em caso de ambiguidade ou erro, siga as seções "Lógica de decisão" e "Error handling" da skill.

**Gates duros (v0.1.7):** o pipeline é orientado a artefato. Antes de iniciar, rode a **Fase 0 (Pré-flight)** — se uma skill exigida não existir como invocável neste host, **pare e reporte; nunca emule a skill inline**. Respeite os Gates G1–G11 da SKILL: artefato em disco antes de avançar (G1); em `full`, nenhum código antes de `PLAN_*.md` validado (G2); skills invocadas de verdade (G3); validador frio como sub-agent separado (G4); scan de ambiguidade determinístico e logado (G5); status verificado contra disco (G6); plano/execução/review como sub-agents reais (G7); ordem validator→review, nunca paralelo (G8); orquestrador de mãos atadas e dispatch blocking (G9); roteamento por `<tool>`, família única e ids exatos (G10); em `full`, após `PLAN_*.md` validado, a próxima ação obrigatória é despachar `plan_execute` — nunca finalizar só com handoff (G11).
