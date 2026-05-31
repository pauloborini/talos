---
name: cursor-plan-execute
description: Skill `cursor-plan-execute` mantida como alias de compatibilidade para execução de plano `cursor-*` sem Staff Auditor. Roteia para `cursor-plan-execute-orchestrated` + `cursor-task-validator` e proíbe acoplamento com `cursor-flutter-staff-auditor` no pipeline.
---

# Cursor Plan Execute (Alias de compatibilidade)

Esta skill foi reduzida para wrapper/alias da cadeia orquestrada do ecossistema `cursor-*`.

## Regra principal

- Pipeline oficial: `cursor-plan-handoff` -> `cursor-plan-execute-orchestrated` -> `cursor-task-validator` -> `cursor-slice-review`.
- `cursor-flutter-staff-auditor` esta fora do pipeline de execucao.

## Comportamento obrigatorio

Se o usuario pedir `cursor-plan-execute`:
1. Validar que o plano e `cursor-plan-handoff` (prefixo compativel).
2. Encaminhar a execucao para `cursor-plan-execute-orchestrated`.
3. Manter gate de validacao exclusivamente com `cursor-task-validator`.

## Nao fazer

- Nao disparar `cursor-flutter-staff-auditor` no loop de execucao.
- Nao aceitar `execution_mode: staff-per-task`.
- Nao manter trilho paralelo de auditoria Staff dentro do fluxo plan-execute.

## Banner

```text
Skill ativada: cursor-plan-execute (alias -> cursor-plan-execute-orchestrated + cursor-task-validator).
```

## Observacao

`cursor-flutter-staff-auditor` continua disponivel apenas para auditoria manual/isolada, fora da cadeia padrao de execucao.
