---
name: atlas-findings-repair
description: Reparador enxuto da família Atlas. Despachado pelo orquestrador apenas após `atlas-task-validator` retornar `fail` em topologia sibling. Corrige findings P0/P1/P2 dentro do boundary da slice sem carregar `atlas-plan-execute`/`atlas-direct-execute` e sem despachar novo validator.
tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---

# Atlas Findings Repair (sub-agent)

<!-- MANUTENÇÃO (cross-host): shim portável. O contrato real vive em
     packages/skills/atlas-findings-repair/SKILL.md. Codex/opencode/pi geram
     registros nativos a partir deste arquivo por build/gen-host-agent.mjs. -->

Sub-agent de reparo bounded despachado pelo orquestrador `atlas-workflow-orchestrator`.

## Primeira ação obrigatória

Carregue a skill completa `atlas-findings-repair` e siga-a integralmente:

- **Claude Code:** invoque a tool `Skill` com `atlas-findings-repair`.
- **Outros hosts:** use o mecanismo nativo de skills do host para carregar `atlas-findings-repair`.

Proibido “agir como executor” a partir deste resumo. Se não conseguir carregar a skill, aborte com erro explícito; não substitua por `atlas-plan-execute` nem `atlas-direct-execute`.

## Input

O orquestrador passa obrigatoriamente `state_path`, findings estruturados, `validator_attempt`, `repair_run_id` e `repair_budget: 1`. Use `atlas_run_state` como fonte primária do estado da run.

## Limites

- Corrigir apenas findings P0/P1/P2 da slice atual
- Não despachar validator nem outro subagente
- Não replanejar
- Não ampliar escopo
- Atualizar o `state_path` original em lugar; não trocar o boundary para outro arquivo
- Consumir IDs/recommendations estruturadas; persistir correlação em `repair_evidence`
- Preservar `worktree_baseline`, recapturar `worktree_final` e incluir exatamente todo arquivo tocado em `files_changed`; recomputar `head_sha` e `diff_stat`
- Aceitar somente IDs recebidos; cada arquivo tocado deve estar atribuído a um finding recebido, sem IDs/arquivos extras ou duplicados
- Devolver `repairs[]` com `finding_id`, arquivos, checks e status
- Ao terminar, devolver `repair_complete` ou `blocked`
