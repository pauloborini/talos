---
name: claude-direct-execute
description: Skill `claude-direct-execute` (par com `codex-direct-execute` / `cursor-direct-execute`; complementa `claude-plan-execute`). Use when the user provides a PRD/spec/path or a debated task and wants implementation NOW, in the same chat, without first producing a separate planning artifact. Executes from a compact in-turn execution contract with PRD obligation tracking, finite task gates, bounded repair, and mandatory cold validation via `claude-task-validator`. Preserve evidence against acceptance criteria, dependencies, fixtures, and invariants. Do NOT use for planning-only, review-only, or handoff-artifact requests, or when product rules/contracts/permissions/migrations/security are materially ambiguous.
---

# Claude Direct Execute

## Propósito

Executar direto a partir de um PRD/spec/task preservando qualidade de execução: escopo explícito, obrigações, invariantes, ordem de tasks, riscos e validação. **Não escrever artefato de planejamento separado** a menos que o usuário peça.

Isto **não** é execução sem plano. Substitui o plano markdown visível por um **contrato operacional compacto** mantido no turno atual e passado à validação fria.

Diferença vs `claude-plan-execute`: aquela consome um artefato `claude-plan-handoff` pré-existente. Esta parte de um PRD/task cru e gera o contrato compacto inline, sem produzir artefato.

## Critérios de Uso

Use quando **todos** forem verdadeiros:

- Usuário quer implementação, não artefato de planejamento.
- Escopo é um PRD/spec/path ou task debatida com fronteiras claras.
- Trabalho cabe em uma slice coerente ou sequência bounded de tasks.
- Execução acontece no mesmo chat/contexto.
- Um contrato compacto basta para o `claude-task-validator`.

**Não** use quando **qualquer** for verdadeiro:

- Usuário pede só planejamento, revisão, explicação ou artefato de handoff.
- Regras de produto, permissões, contrato de backend, migrations, segurança ou risco de perda de dados estão materialmente ambíguos.
- O PRD/spec conflita com o código ou docs adjacentes de modo que bloqueia a implementação.

## Workflow

### Passo 0 — Triagem

Antes de implementar, decida um caminho exato:

- `direct`: prosseguir com esta skill.
- `blocked`: pedir a decisão faltante ou o ambiente.

Faça no máximo 1-3 perguntas bloqueantes **apenas** quando uma suposição razoável pudesse mudar comportamento de produto, contrato, permissões, persistência ou resultado visível ao usuário. Caso contrário, declare suposições e prossiga.

Respeite o WORKFLOW do `CLAUDE.md`/`AGENTS.md` do projeto: classifique o tipo de tarefa e emita a **Pré-confirmação de Contexto** antes de editar código.

### Passo 1 — Carregar inputs

Leia o PRD/spec/task fornecido e os arquivos diretamente referenciados necessários para resolver o escopo. Se o input nomear artefatos do repo, **verifique que existem** antes de editar.

Extraia só itens relevantes à execução:

- in scope / out of scope
- critérios de aceite e deliverables obrigatórios
- decisões já aceitas
- invariantes e regras "não alterar"
- contratos, entidades, rotas, schemas, wrappers, arquivos gerados
- contratos de dependência que devem ser consumidos, bridgeados ou preservados
- requisitos de fixtures e linguagem de cenário ("semanas", "perfis", "matriz", "sequência", "integração")
- requisitos de validação
- riscos de regressão
- arquivos/módulos prováveis

Se o PRD referencia outro PRD ou contrato de código como dependência, inspecione o suficiente para confirmar o shape da dependência e a bridge requerida. **Não** satisfaça dependência criando contratos sintéticos paralelos a menos que o PRD permita explicitamente.

### Passo 2 — Montar Contrato de Execução Compacto

Antes de editar, escreva um contrato compacto na resposta de trabalho ou no estado de tasks interno. Tamanho segue complexidade: terso para tasks simples, mais denso só onde preciso para preservar escopo, invariantes e qualidade do validador.

Shape obrigatório:

```text
Contrato Direct Execute
- Objetivo:
- Fronteira:
- In scope:
- Out of scope:
- Obrigações:
- Invariantes:
- Bridges de dependência:
- Fixtures/cenários:
- Probes de cenário:
- Probes de risco:
- Ordem de tasks:
- Validação:
- Condições de parada:
```

**Não** expanda isto em artefato de planejamento separado. O objetivo são guardrails de execução, não documentação de transferência. O contrato pode ser terso na resposta visível, mas deve ser concreto o bastante para passar inalterado ao `claude-task-validator`.

**Obrigações são mandatórias.** Converta cada critério de aceite do PRD e cada deliverable explícito em uma linha compacta:

```text
O1 <requisito> -> evidência: <arquivo/teste/check>
```

Quando o PRD pede fixtures, perfis, semanas, matrizes, bridges/adapters, imutabilidade, determinismo ou semântica de calendário, **nomeie isso explicitamente** em `Obrigações`. Não colapse em genérico "testes cobrem regras".

Adicione um **pacote de análise de fechamento** antes de iniciar a implementação. Mantenha compacto, mas concreto o bastante para um validador frio caçar omissões em vez de só confirmar arquivos óbvios:

- `Ledger de invariantes`: cada invariante / regra "não alterar", com evidência de código esperada.
- `Probes de cenário`: negativo, repetido, vazio/null, fora de ordem, falha parcial, estado stale, permissão e cleanup relevantes a esta slice.
- `Probes de contrato`: DTO/entity/schema/route/RPC/gerado/localização/fronteiras de import que poderiam driftar.
- `Probes de risco`: cada risco de regressão traduzido em pergunta específica que o validador deve responder a partir do código.
- `Mapa de validação`: quais checks provam quais obrigações, e quais obrigações ficam só com evidência manual.

Se um probe é irrelevante, omita. Não escreva probe genérico como "checar edge cases"; nomeie o estado, ator, campo, rota ou modo de falha exato.

### Passo 3 — Implementar por tasks finitas

Execute uma task por vez. Prefira esta ordem quando aplicável:

1. contratos/types/domain
2. bridges/adapters de dependência a partir de models ou contratos existentes
3. boundary de datasource/client
4. repository/use case/state
5. wiring de UI/rota
6. fixtures/testes/geração/docs requeridos para fechamento

Para cada task, mantenha um contrato de task minúsculo:

- objetivo
- arquivos provavelmente tocados
- invariantes em risco
- obrigações satisfeitas
- check focado
- orçamento de reparo

**Não** alargue escopo para limpeza oportunista.

### Passo 4 — Gate de cada task

Rode checks focados apropriados ao diff:

- testes direcionados (só sob pedido explícito, conforme `CLAUDE.md`)
- `flutter analyze` — **obrigatório** após qualquer alteração de código (regra do projeto); corrija erros/warnings antes de fechar a task
- codegen/localização/schema quando relevante
- scan de diff para scope creep
- verificação runtime/browser quando UI mudou

Se um check falha, classifique:

- `fixable`: causado pelo diff atual e reparável dentro do orçamento
- `blocked`: env faltante, falha upstream, contrato ambíguo ou decisão requerida
- `pre-existing`: fora da slice; reporte, não repare a menos que bloqueie o fechamento

Repare só falhas do diff atual. Pare após falha repetida ou orçamento esgotado.

### Passo 5 — Validação fria obrigatória

Após as tasks e os gates locais passarem, invoque a skill `claude-task-validator` como **subagent isolado** em sessão fria. **Não existe caminho para relatório final sem passar por esta validação.**

**Mecanismo de invocação (em ordem de preferência):**

1. Se existir `subagent_type: claude-task-validator` registrado → usar diretamente.
2. Caso contrário → usar `subagent_type: general-purpose` (Agent tool) e **colar inline** o conteúdo integral de `~/.claude/skills/claude-task-validator/SKILL.md` no prompt como contexto fixo (não confiar em "carregue a skill" — subagent genérico não garante carregamento).

**Montagem do prompt do subagent:**

```text
Você atua como `claude-task-validator`. Siga estritamente as regras abaixo (conteúdo da SKILL.md inline).

=== INÍCIO SKILL claude-task-validator ===
<colar aqui o conteúdo integral de ~/.claude/skills/claude-task-validator/SKILL.md>
=== FIM SKILL ===

INPUTS:

1. Boundary da slice:
<saída de: git diff --name-only main...HEAD (ou base apropriada)>
<saída de: git diff --stat main...HEAD>

2. Contrato de execução compacto (este é o plano-contrato; não há artefato em disco):
<colar o Contrato Direct Execute do Passo 2 integral>

3. Tasks executadas:
- T01: <título>
- T02: <título>
- ...

4. Tasks bloqueadas: <lista ou "nenhuma">

5. Checks locais rodados: <comandos + resultados, incl. flutter analyze>

6. Ledger de obrigações: <O1..ON com evidência alegada para cada>

7. Pacote de análise de fechamento:
   - Ledger de invariantes
   - Probes de cenário
   - Probes de contrato
   - Probes de risco
   - Mapa de validação

8. Profundidade do validador: aplique lentes de cenário estilo slice-review SÓ dentro desta slice; findings devem mapear a obrigações do PRD, invariantes, riscos, contratos de dependência ou baseline universal do validador.

Você não viu a execução. Lê código atual. Não corrige. Não propõe diff. Fix sugerido em 1-2 linhas de texto. Busque ativamente cenários faltantes e validação fraca antes de retornar `pass`.

NOTA SEVERIDADE: achado de segurança crítica / perda de dados (P0 em revisão externa) → classifique como P1 com nota no fix: "[P0-equivalente em slice-review] recomendar parar e reabrir escopo".
```

**Consumo do output:**

O validador retorna estrutura fixa: `Findings P1/P2/P3` + `Observações` + `Veredito`. O validador **não** edita arquivos.

| Veredito | Ação |
|----------|------|
| `pass` | Fechar slice → relatório final |
| `fail-com-P1` | Reparar todos os P1 + P2 baratos que mapeiem a obrigações/invariantes/determinismo/dependências/fixtures; re-validar |
| `fail-com-P2-only` | Reparar P2 quando mapeiam a obrigações/invariantes/determinismo/dependências/fixtures; registrar resto como follow-up; re-validar após reparo material |

**Loop bounded de re-validação:**

- Validação 1 → reparo → **Validação 2** (re-dispara o subagent com o mesmo prompt + nota "ciclo 2").
- Se Validação 2 ainda `fail-com-P1`: **parar**, reportar findings residuais e fixes tentados. Não tentar validação 3. Usuário decide.
- Se Validação 2 retorna `pass` ou `fail-com-P2-only`: relatório final.

**Regras do reparo durante validação:**

- Reparo só toca o que o finding aponta — não expandir escopo.
- Cada reparo cirúrgico, com path:linha do finding.
- Não reabrir decisões fechadas sem evidência no código que contradiga o contrato.
- Observações (fora do contrato) **não** disparam reparo — só registrar no relatório.

Se subagents isolados estiverem indisponíveis no ambiente, **não** finja que a slice está validada. Rode um self-check local contra o mesmo contrato, reporte `validator não rodado` e marque risco residual explícito.

## Condições de Parada

Pare e reporte em vez de improvisar quando:

- código contradiz o PRD em comportamento de produto, permissões, contrato de backend ou shape de persistência
- PRD/contrato de dependência requerido está faltante ou instável
- implementar violaria out-of-scope explícito
- checks determinísticos não rodam e não há evidência equivalente
- loops de reparo repetem a mesma falha duas vezes
- validador não pode receber boundary da slice, contrato, lista de tasks, nota de cold-review e pacote de fechamento
- qualquer obrigação do PRD fica sem evidência de código/teste/check após a implementação

## Relatório Final

Mantenha curto:

- escopo alterado
- arquivos tocados
- validações rodadas (incl. `flutter analyze`)
- veredito do validador / ciclos
- bloqueios ou riscos residuais

Não inclua o contrato interno completo a menos que o usuário peça.
