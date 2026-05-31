---
name: claude-plan-execute
description: Skill `claude-plan-execute` (par com `cursor-plan-execute` / `codex-plan-execute`). Use when the user wants to execute a handoff plan produced by `claude-plan-handoff`. Implements the plan task-by-task with bounded quality gates, finite self-repair, and explicit stop conditions. Do not drift from plan invariants, introduce silent regressions, or loop indefinitely on self-correction.
---

# Claude Plan Execute

Use esta skill para transformar um plano de handoff compactado em execução controlada de código. 

Opere como uma máquina de estados com gates finitos por task. O objetivo é terminar a entrega com alta confiança técnica, sem adivinhar comportamento nem alterar o escopo do PRD.

---

## Modelo de Execução (Bounded)

```
                            (por task)                       (por slice)
ready → implementing → gating → repairing → task_done → ... → slice_validating → slice_done
                                           ↘ blocked                            ↘ blocked
```

`task_done` fecha uma task individual. `slice_done` só é alcançável passando por `slice_validating` — disparo obrigatório do `claude-task-validator` após a última task.

---

## Fluxo Obrigatório

### Passo 0 — Identificar e Validar o Plano
1. Liste os planos disponíveis no diretório do projeto.
2. Use `AskUserQuestion` para o usuário selecionar ou confirmar o caminho do plano.
3. Leia o arquivo de plano.
4. **Validação Estrutural:** O plano deve conter a estrutura de seções oficiais (Tradução Executiva, Invariantes de Execução, Tarefas de Execução, Contratos Técnicos e a Seção 8 contendo a tag `(§14)` do Checklist de Validação).
   * Se o plano não possuir as seções básicas de execução, pare e informe o usuário.
   * O Gate de Prontidão antigo (§15) e o Handoff Prompt (§16) **não são mais necessários** e não devem ser exigidos.
   * Se existir a Seção 9 (perguntas em aberto / bloqueios reais — **não** confundir com PRD §13 Referências) com itens bloqueantes ativos, pare a execução e solicite esclarecimento.
   * Se o checklist da Seção 8 for fino, leia **PRD §8–10** no PRD linkado no cabeçalho do plano.

### Passo 1 — Carregar o Plano como Contrato
Extraia do plano:
* **Tradução executiva e vínculos ao PRD** (da Seção 1 — path do PRD; referências `PRD §5` D*, sem recopiar a tabela).
* **Invariantes de execução** (da Seção 2).
* **Estado na abertura da sprint** (da Seção 4).
* **Pitfalls** (da Seção 3).
* **Todas as Tasks TNN** (da Seção 5).
* **Contratos Técnicos** (da Seção 6).
* **Slices de Execução** (da Seção 7).
* **Checklist do Validator** (da Seção 8 contendo a tag `(§14)`).

Registre todas as tasks extraídas com status `pending` usando `TodoWrite`.

### Passo 2 — Contrato por Task
Antes de editar qualquer código:
* Releia o schema completo da task a ser executada.
* Confirme critérios de done, invariantes e validação local da task.
* Marque a task como `in_progress` no `TodoWrite`. Mantenha apenas uma task ativa por vez.

### Passo 3 — Implementação Cirúrgica
Implemente uma task por vez. Não avance para a próxima sem rodar a validação local indicada na task. Não expanda escopo.

### Passo 4 — Gate de Qualidade Local
Após concluir a task, rode apenas as verificações locais indicadas na tarefa (linter, analyze do package ou suite de testes afetada). Não é necessário rodar a suite completa de testes do monorepo a cada task pequena.

### Passo 5 — Classificar o Resultado
* `pass`: Checks passaram, avance para a próxima task.
* `fixable`: Falha cirúrgica no diff atual. Dispare o reparo (máximo 2 passes por task).
* `blocked`: Condição de parada (2 falhas idênticas seguidas, budget esgotado ou dependência de ambiente ausente). Pare a execução e reporte estruturadamente as opções.

### Passo 6 — Fechar a Slice & Validação Fria (Passo 9)
Após concluir todas as tasks com status `completed`:
* Dispare a skill `claude-task-validator` como **subagent isolado**.
* Forneça ao validador: o diff da branch (`git diff`), o plano (focado na Seção 2, Seção 6 e na Seção 8/§14), e as tasks executadas.
* Trate os findings: repare todos os P1, repare P2 se barato, e rodar no máximo 2 ciclos de re-validação.

### Passo 7 — Relatório Final
Ao concluir, apresente o relatório de mudanças, validações bem-sucedidas, findings do validador e qualquer desvio inevitável em relação ao plano original.