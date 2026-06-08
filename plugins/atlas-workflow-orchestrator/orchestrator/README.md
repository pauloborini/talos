# Atlas Workflow Orchestrator

Orquestra pipelines completos de desenvolvimento de features no projeto Atlas, automatizando a sequência de skills (PRD generation → planejamento → execução → review) sob demanda.

## Quick Start

```bash
/workflow full backlog-item "S05"
```

Pipeline completo executado automaticamente:
1. Gera PRD para sprint S05
2. Valida PRD (detecta ambiguidades automaticamente)
3. Executa entrevista se houver decisões em aberto
4. Cria plano
5. Executa plano
6. (Opcional) Executa review

## Sintaxe

```
/workflow <mode> <input-type> [flags]
```

### Modes

- `full` — Pipeline completo (PRD → plano → executor → review opcional)
- `direct` — Pipeline enxuto (PRD → executor → review opcional)
- `interview-only` — Entrevista direta (brainstorm, resolução de decisões)

### Input Types

- `backlog-item` — Sprint ID (ex: S05) ou indicação direta
- `idea` — Indicação/brainstorm curto
- `prd` — Path para PRD existente
- `brainstorm` — Texto livre (só para interview-only)

### Flags

- `--interview` — Força entrevista de PRD mesmo sem ambiguidades
- `--review` — Executa slice-review ao final
- `--help` — Mostra sintaxe completa

## Exemplos

### Full pipeline com sprint S05

```
/workflow full backlog-item "S05"
```

Output:
```
✅ Workflow: claude full backlog-item completed

📄 PRD: /path/to/PRD_S05_login.md
📋 Plan: /path/to/PLAN_S05_login.md
🚀 Output: [summary do executor]

Status:
  ✅ PRD valid
  ✅ Ambiguidades resolvidas (2 decisões coletadas)
  ✅ Plano generated
  ✅ Executor output ready (required in full/direct)
  ⏭️  Slice review: not executed
```

### Direct pipeline com PRD existente + review

```
/workflow direct prd "/path/to/PRD_S05.md" --review
```

### Entrevista de brainstorm

```
/workflow interview-only brainstorm "Que tal dark mode?"
```

### Force entrevista mesmo sem ambiguidades

```
/workflow full idea "melhorar performance" --interview
```

## Como funciona

### Full Mode

```
1. Parse input (resolve sprint/indicação)
   ↓
2. Generate PRD (`atlas-sprint-prd-generator`)
   ↓
3. Validate PRD (busca TBD, "a confirmar", gaps)
   ↓
4. Interview (automático se ambiguidades OU --interview)
   └─ Atualiza PRD com decisões coletadas
   ↓
5. Plan (`atlas-plan-handoff`)
   ↓
6. Validate Plan (tem gaps?)
   └─ Pergunta: volta? continua TBD? adia?
   ↓
7. Execute obrigatório em `full` (`atlas-plan-execute`, com `atlas-task-validator` sub-agent)
   ↓
8. Review (se --review)
   └─ `atlas-slice-review`
   ↓
9. Output (resumo + próximos passos)
```

### Direct Mode

```
1. Parse/Generate PRD
   ↓
2. Validate PRD + Interview (condicional)
   ↓
3. Execute
   ↓
4. Review (se --review)
   ↓
5. Output
```

### Interview-Only Mode

```
1. Entrevista direta (sem PRD anterior)
   ↓
2. Output (PRD esboço + decisões)
```

## Sequências canônicas

Atlas é família única. Cliente (Claude Code, Cursor, Codex App) é apenas o host que executa as skills; não existe roteamento por família.

| Mode | Sequência |
|------|-----------|
| `full` | `atlas-sprint-prd-generator` → `atlas-prd-interview` quando necessário → `atlas-plan-handoff` → `atlas-plan-execute` → `atlas-task-validator` → `atlas-slice-review` somente com `--review` |
| `direct` | PRD/spec existente → `atlas-direct-execute` → `atlas-task-validator` → `atlas-slice-review` somente com `--review` |
| `interview-only` | `atlas-prd-interview` |

## Validação automática

Plugin detecta ambiguidades em:
- **Contexto e objetivo (§1):** TBD, "a confirmar", vago
- **Escopo (§2):** incompleto, "depende de"
- **Decisões (§3):** vazio ou muito vago
- **Fluxos e cenários UX (§4):** gaps, "a definir"
- **Contrato funcional e invariantes (§5):** "ainda não definido", "mock"

Se encontra ambiguidades → o orquestrador conduz `atlas-prd-interview` automaticamente no fio principal.

## Lógica de decisão

Quando há decisões pendentes:

```
Plugin: Tenho decisões em aberto:
  Q-XXX-01: [decisão 1]
  Q-XXX-02: [decisão 2]

Opções:
  A) Volta pra resolver tudo (roda interview agora)
  B) Continua com recomendações (marca TBD)
  C) Adia essas decisões
```

Você escolhe A/B/C → pipeline continua conforme.

## Integração com seu workflow

### Antes de rodar workflow

1. Análise de sprints futuras
2. Preenchimento de `PERGUNTAS_EM_ABERTO.md` (fora do plugin)
3. Resolver perguntas abertas fora do pipeline (se necessário)

### Ao rodar workflow

```
/workflow full backlog-item "S05"
```

Plugin automatiza tudo. Você valida output.

### Depois de workflow

1. Validação de output do executor
2. (Opcional) Rodada de slice-review quando `--review` foi solicitado
3. Avança para S06

## Skills envolvidas

| Skill | Função |
|-------|--------|
| `atlas-sprint-prd-generator` | Gera PRD a partir de sprint/indicação |
| `atlas-prd-interview` | Entrevista de PRD (resolve ambiguidades) |
| `atlas-plan-handoff` | Cria plano executável |
| `atlas-plan-execute` | Executa plano (com `atlas-task-validator` sub-agent) |
| `atlas-slice-review` | Review fria de implementação quando `--review` está presente |

## Configuração

Plugin usa configuração embutida no MCP para modos, skills `atlas-*` e validadores de ambiguidade. Defaults auxiliares continuam empacotados em `packages/orchestrator/defaults/` e referências em `packages/orchestrator/references/`.

## Error handling

- **Sprint não encontrado:** reporta sprints disponíveis
- **Skill falha:** para, reporta erro, oferece retry/skip/abort
- **PRD inválido:** reporta sections faltando
- **Ambiguidades não resolvidas:** pergunta próximos passos

## Dúvidas?

Veja este README, `packages/mcp-server/README.md` e os SKILL.md `atlas-*` para o contrato operacional atual.

---

**Plugin version:** 0.6.1
**Author:** Paulo Borini
**Last updated:** 2026-06-08

### Novidades v0.6.1 — fronteira documental no orquestrador

- Fases documentais (`PRD`, entrevista, `PLAN_*.md`) são conduzidas no orquestrador; o primeiro sub-agent obrigatório do `full` nasce em `atlas-plan-execute`.
- Os únicos sub-agents do pipeline são `atlas-plan-execute`/`atlas-direct-execute`, `atlas-task-validator` e `atlas-slice-review`.
- Em hosts `nested`, o executor consome o feedback do validator dentro do próprio loop; em Codex (`sibling`), o orquestrador coordena o validator irmão e só reabre execução em `fail`.
- `atlas_preflight`/dispatchability distinguem skills documentais de skills executoras, evitando exigir sub-agent para entrevista/plano.
