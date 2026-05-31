---
name: cursor-direct-execute
description: Skill `cursor-direct-execute` (par com `codex-direct-execute` / `claude-direct-execute`; complementa `cursor-plan-execute`). Executa PRD/spec/path ou task debatida no mesmo chat, sem artefato de planejamento separado. Contrato operacional compacto, obrigações do PRD, gates finitos por task, reparo limitado e validação fria obrigatória via `cursor-task-validator`. Use quando o usuário quer implementar agora. Não use para só planejar, revisar, handoff, ou quando produto/contrato/permissões/migrations/segurança estão materialmente ambíguos.
---

# Cursor Direct Execute

## Propósito

Executar direto a partir de um PRD/spec/task preservando qualidade de execução: escopo explícito, obrigações, invariantes, ordem de tasks, riscos e validação. **Não escrever artefato de planejamento separado** (nem `cursor-plan-handoff`) a menos que o usuário peça.

Isto **não** é execução sem plano. Substitui o plano markdown visível por um **contrato operacional compacto** mantido no turno atual e passado à validação fria.

| Trilho | Entrada | Validação típica |
|--------|---------|------------------|
| `cursor-plan-execute` | `cursor-plan-handoff` em disco | alias para `cursor-plan-execute-orchestrated` + `cursor-task-validator` |
| `cursor-plan-execute-orchestrated` | `cursor-plan-handoff` | `cursor-task-validator` por slice |
| **`cursor-direct-execute`** | PRD/spec/task cru | **`cursor-task-validator`** (contrato compacto inline) |

## Quando ativar

### Gatilhos primários
- "implementa agora", "executa direto", "sem plano", "sem handoff"
- PRD/spec/path anexado com pedido de implementação
- `cursor-direct-execute`, "usa direct execute"
- task debatida com fronteiras claras e pedido de código

### Banner ao ativar
```text
Skill ativada: cursor-direct-execute (contrato compacto + validação fria cursor-task-validator).
```

### Quando NÃO ativar
- Só planejamento, revisão, explicação ou artefato `cursor-plan-handoff`
- Regras de produto, permissões, contrato backend, migrations, segurança ou perda de dados **materialmente ambíguos**
- PRD/spec conflita com código ou docs de forma que bloqueia implementação
- Usuário pediu explicitamente `cursor-plan-handoff` + `cursor-plan-execute` → usar a cadeia com plano

## Workflow

### Passo 0 — Triagem e workspace

Decida um caminho exato:

- `direct`: prosseguir com esta skill
- `blocked`: pedir decisão ou ambiente faltante

**Workspace:** se o trabalho pertence a um projeto existente, chame `move_agent_to_root` (MCP `cursor-app-control`) **antes** de editar, assim que o path do repo estiver claro. Não implementar em home e mover depois.

No máximo **1–3 perguntas bloqueantes** quando uma suposição razoável mudaria produto, contrato, permissões, persistência ou UX. Caso contrário, declare suposições e prossiga.

Respeite `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `project-rules/index/*.md` e `project-rules/rules/*.md` do repositório (ou o equivalente declarado em `AGENTS.md`) antes de editar.

### Passo 1 — Carregar inputs

Leia o PRD/spec/task e arquivos diretamente referenciados. Se o input nomear artefatos do repo, **confirme que existem** antes de editar.

Extraia só o relevante à execução:

- in scope / out of scope
- critérios de aceite e deliverables
- decisões já aceitas
- invariantes e regras "não alterar"
- contratos, entidades, rotas, schemas, wrappers, gerados
- dependências a consumir, bridgear ou preservar
- fixtures e linguagem de cenário ("semanas", "perfis", "matriz", "sequência", "integração")
- validação exigida, riscos de regressão, arquivos/módulos prováveis

Se o PRD referencia outro PRD/contrato como dependência, inspecione o suficiente para confirmar shape e bridge. **Não** crie contratos sintéticos paralelos salvo permissão explícita no PRD.

### Passo 2 — Contrato de Execução Compacto

Antes de editar, monte o contrato (terso na resposta visível; denso o bastante para o validador). Shape obrigatório:

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
- Probes de contrato:
- Probes de risco:
- Ordem de tasks:
- Validação:
- Condições de parada:
```

**Não** expandir em `cursor-plan-handoff` nem CreatePlan. São guardrails de execução, não documentação de transferência.

Converta cada critério de aceite e deliverable em obrigação:

```text
O1 <requisito> -> evidência: <arquivo/teste/check>
```

Fixtures, perfis, semanas, matrizes, bridges, imutabilidade, determinismo e calendário devem aparecer **nomeados** em `Obrigações` — não colapsar em "testes cobrem regras".

**Pacote de análise de fechamento** (compacto, concreto):

- `Ledger de invariantes`: cada invariante + evidência esperada no código
- `Probes de cenário`: negativo, repetido, vazio/null, fora de ordem, falha parcial, stale, permissão, cleanup — só os relevantes, com estado/ator/rota nomeados
- `Probes de contrato`: DTO/entity/schema/route/RPC/gerado/i18n/import que podem driftar
- `Probes de risco`: cada risco → pergunta que o validador responde no código
- `Mapa de validação`: qual check prova qual obrigação; o que fica só evidência manual

### Passo 3 — Implementar por tasks finitas

Uma task por vez. Ordem preferida quando aplicável:

1. contratos/types/domain
2. bridges/adapters de dependência
3. datasource/client boundary
4. repository/use case/state
5. UI/rota
6. fixtures/testes/codegen/docs para fechamento

Contrato mínimo por task: objetivo, arquivos prováveis, invariantes em risco, obrigações satisfeitas, check focado, orçamento de reparo (padrão **2** ciclos por task salvo complexidade).

Use `TodoWrite` para tasks T01..Tn quando houver mais de uma. **Não** alargar escopo para cleanup oportunista.

### Passo 4 — Gate de cada task

Checks focados ao diff:

- testes direcionados (quando o PRD ou `AGENTS.md` exigir)
- `flutter analyze` / typecheck / lint nos arquivos tocados (quando o stack for Dart/TS/etc. conforme o projeto)
- codegen, i18n, schema quando relevante
- scan de diff para scope creep
- browser/runtime quando UI mudou (`cursor-ide-browser` se necessário)

Classifique falhas:

- `fixable`: causado pelo diff atual, reparável no orçamento
- `blocked`: env, upstream, contrato ambíguo, decisão requerida
- `pre-existing`: fora da slice; reportar, não reparar salvo bloquear fechamento

Repare só falhas do diff atual. Pare após a mesma falha **duas vezes** ou orçamento esgotado.

### Passo 5 — Validação fria obrigatória

Após tasks e gates locais, invoque **`cursor-task-validator`** como subagent **readonly** em sessão fria. **Não há relatório final "pronto" sem este passo** (salvo fallback explícito abaixo).

**Invocação (ordem de preferência):**

1. `Task` com `subagent_type: generalPurpose`, `readonly: true`, prompt mandando ler **integralmente** `~/.cursor/skills/cursor-task-validator/SKILL.md` e seguir como validador.
2. Não confiar em "carregue a skill" sem path — o subagent deve abrir o arquivo ou receber o conteúdo inline se o ambiente não permitir leitura externa.

**Prompt do subagent (template):**

```text
Você atua como cursor-task-validator. Leia e siga estritamente:
~/.cursor/skills/cursor-task-validator/SKILL.md

Modo: contrato Direct Execute (não há cursor-plan-handoff em disco).
Mapeie Invariantes/Obrigações/Probes do contrato para as seções equivalentes do validador.

INPUTS:

1. Boundary:
<git diff --name-only> + <git diff --stat> (base: main ou branch acordada)

2. Contrato Direct Execute (integral):
<colar contrato do Passo 2>

3. Tasks executadas:
- T01: …
- T02: …

4. Tasks bloqueadas: <lista ou "nenhuma">

5. Checks locais: <comandos + resultados>

6. Ledger de obrigações: O1..ON com evidência alegada

7. Pacote de fechamento:
   - Ledger de invariantes
   - Probes de cenário / contrato / risco
   - Mapa de validação

8. Contexto frio: você não viu a execução; leia só o código atual.
9. Profundidade: lentes de cenário estilo slice-review SÓ dentro desta slice; findings mapeiam a obrigações, invariantes, riscos, dependências ou baseline universal.

Não edite arquivos. Não proponha diff. Busque cenários faltantes e validação fraca antes de `pass`.
```

**Consumo do veredito:**

| Veredito | Ação |
|----------|------|
| `pass` | Fechar slice → relatório final |
| `fail-com-P1` | Reparar P1 + P2 que mapeiem a obrigações/invariantes/determinismo/dependências/fixtures; re-validar |
| `fail-com-P2-only` | Reparar P2 material no mesmo mapeamento; registrar resto; re-validar após reparo relevante |

**Loop bounded:** Validação 1 → reparo → **Validação 2** (mesmo prompt + nota `ciclo 2`). Se ciclo 2 ainda `fail-com-P1`, **parar** e reportar findings + fixes tentados — não terceiro ciclo automático.

Reparo cirúrgico só no que o finding aponta. Observações fora do contrato **não** disparam reparo.

**Fallback:** se subagents isolados não estiverem disponíveis, **não** finja slice fechada. Self-check local contra o mesmo contrato, reporte `validator não rodado` e risco residual explícito.

## Condições de parada

Pare e reporte em vez de improvisar quando:

- código contradiz o PRD em produto, permissões, backend ou persistência
- dependência PRD/contrato requerida ausente ou instável
- implementar violaria out-of-scope explícito
- checks determinísticos não rodam sem evidência equivalente
- reparo repete a mesma falha duas vezes
- validador não recebe boundary, contrato, tasks, nota fria e pacote de fechamento
- obrigação do PRD sem evidência código/teste/check após implementação

## Relatório final

Curto (PT-BR):

- escopo entregue
- arquivos principais tocados
- validações rodadas
- veredito do validador / ciclos
- bloqueios ou riscos residuais

Não colar o contrato completo salvo pedido do usuário.

## Depois da execução (opcional)

Revisão fria mais ampla (cenários de negócio, segurança, drift) numa sessão separada: `cursor-slice-review`, usando o mesmo contrato ou PRD como âncora.

## Anti-padrões

- Produzir `cursor-plan-handoff` "por precaução" no meio do direct execute
- Pular `cursor-task-validator` e declarar "pronto"
- Misturar prefixos: plano `codex-`/`claude-` com validador `cursor-`
- Usar `cursor-flutter-staff-auditor` no lugar do `cursor-task-validator` neste trilho
- Commit automático sem pedido explícito do usuário
