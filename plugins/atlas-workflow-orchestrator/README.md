# Atlas Workflow Orchestrator

Orquestra pipelines completos de desenvolvimento de features no projeto Atlas, automatizando a sequência de skills (PRD generation → planejamento → execução → review) sob demanda.

## Quick Start

```bash
/workflow claude full backlog-item "S05"
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
/workflow <tool> <mode> <input-type> [flags]
```

### Tools

- `claude` — Claude (MVP)
- `cursor` — Cursor (futuro)
- `codex` — Codex (futuro)

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
/workflow claude full backlog-item "S05"
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
  ✅ Executor output ready
  ⏭️  Slice review: not executed
```

### Direct pipeline com PRD existente + review

```
/workflow claude direct prd "/path/to/PRD_S05.md" --review
```

### Entrevista de brainstorm

```
/workflow claude interview-only brainstorm "Que tal adicionar dark mode?"
```

### Force entrevista mesmo sem ambiguidades

```
/workflow claude full idea "melhorar performance" --interview
```

## Como funciona

### Full Mode

```
1. Parse input (resolve sprint/indicação)
   ↓
2. Generate PRD (claude-sprint-prd-generator)
   ↓
3. Validate PRD (busca TBD, "a confirmar", gaps)
   ↓
4. Interview (automático se ambiguidades OU --interview)
   └─ Atualiza PRD com decisões coletadas
   ↓
5. Plan (claude-plan-handoff)
   ↓
6. Validate Plan (tem gaps?)
   └─ Pergunta: volta? continua TBD? adia?
   ↓
7. Execute (claude-plan-execute com task-validator sub-agent)
   ↓
8. Review (se --review)
   └─ claude-slice-review
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

## Validação automática

Plugin detecta ambiguidades em:
- **Objetivo (§3):** TBD, "a confirmar", vago
- **Escopo (§4):** incompleto, "depende de"
- **Decisões (§5):** vazio ou muito vago
- **Experiência (§8):** gaps, "a definir"
- **Contratos (§9):** "ainda não definido", "mock"

Se encontra ambiguidades → dispara `claude-prd-interview` automaticamente.

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
3. Rodada de `open-questions-interview` skill (se necessário)

### Ao rodar workflow

```
/workflow claude full backlog-item "S05"
```

Plugin automatiza tudo. Você valida output.

### Depois de workflow

1. Validação de output do executor
2. (Opcional) Rodada de slice-review: `/workflow claude slice-review /path/to/output`
3. Avança para S06

## Skills envolvidas (Claude MVP)

| Skill | Função |
|-------|--------|
| `claude-sprint-prd-generator` | Gera PRD a partir de sprint/indicação |
| `claude-prd-interview` | Entrevista de PRD (resolve ambiguidades) |
| `claude-plan-handoff` | Cria plano executável |
| `claude-plan-execute` | Executa plano (com task-validator sub-agent) |
| `claude-slice-review` | Review fria de implementação |

## Configuração

Plugin usa `atlas_workflows_config.md` para:
- Mapeamento tool → skills
- Validadores de ambiguidade
- Sequências por modo

Sem config → usa defaults (Claude skills).

## Error handling

- **Sprint não encontrado:** reporta sprints disponíveis
- **Skill falha:** para, reporta erro, oferece retry/skip/abort
- **PRD inválido:** reporta sections faltando
- **Ambiguidades não resolvidas:** pergunta próximos passos

## Próximas versões

- **v0.2** Cursor support
- **v0.3** Codex support
- **v0.4** Antigravity support
- **v1.0** Full feature parity + smart tool detection

## Dúvidas?

Veja `atlas_workflows_config.md` para detalhes técnicos e mapeamentos completos.

---

**Plugin version:** 0.1.5  
**Author:** Paulo Borini  
**Last updated:** 2026-05-30

### Novidades v0.1.5 — roteamento por `<tool>`, não por host

Conserta falha do GF09 (comando `claude` roteou pra `cursor-*`, pegou a variante `-orchestrated` errada e misturou famílias PRD-claude / resto-cursor):

- **Gate G10 — `<tool>` autoritativo:** a família de skills é definida **só** pelo argumento `<tool>` (`claude`→`claude-*`, `cursor`→`cursor-*`, `codex`→`codex-*`). O **host não escolhe família** — o Cursor enxerga e despacha as três; ele é só onde roda.
- **Família única por run:** proibido misturar (PRD em claude, plano em cursor). Skill ausente → fallback **por-skill** declarado na config, senão aborta. Nunca troca a família inteira.
- **Id exato:** proibido substituir por variante (`-orchestrated`, `-experimental`) sem flag explícita do usuário.

### Novidades v0.1.4 — orquestrador de mãos atadas

Conserta falha do GF08 (orquestrador implementou inline em paralelo ao sub-agent de execução; contexto 87%; slice-review feito inline):

- **Gate G9 — orquestrador é coordenador:** após a Fase 0, **proibido** editar arquivo, escrever Dart, rodar comando mutante (flutter/test/git write) ou implementar "em paralelo". Únicas ações: despachar sub-agent, ler artefato, reportar.
- **Dispatch blocking:** despacha **um** sub-agent por vez (foreground), **espera o retorno**, só então segue. `run_in_background` proibido para fases do pipeline. Sem dois sub-agents simultâneos.
- **`slice-review` é sub-agent de verdade (G7):** despachado, nunca revisão inline narrada pelo orquestrador.

### Novidades v0.1.3 — sub-agent forçado + ordem de validação

Conserta falhas observadas no GF07 (plano sem template, validator+slice em paralelo, fallback inline no Cursor):

- **Gate G7 — sub-agent obrigatório:** `plan_handoff` e `plan_execute` despachados como sub-agent (Agent tool), **nunca** no fio do orquestrador. `PLAN_*.md` **deve** conformar ao template da skill (§2 invariantes, §10 contratos, §11 riscos, §14 checklist, tasks T01..Tn) — plano sem template = G7 violado.
- **Gate G8 — ordem fixa de validação:** `task-validator` roda **antes/dentro** do relatório do executor; `slice-review` roda **por último**, só após o executor retornar 100%. **Nunca em paralelo** — são funções distintas em série.
- **Fase 0 sem brecha:** matou o fallback "implementação direta / contratos equivalentes inline". Host sem sub-agent despachável → **aborta**, ponto.

### Novidades v0.1.2 — pipeline orientado a artefato

Conserta a degradação onde `full` virava "só coda" (sem plano, sem validador frio, auto-aprovando):

- **Fase 0 pré-flight:** verifica se as skills exigidas existem como invocáveis no host. Se faltar → para e reporta; **nunca emula a skill inline**.
- **Gates duros G1–G6:** cada fase só conclui com artefato em disco (G1); em `full`, zero código antes de `PLAN_*.md` validado (G2); skills invocadas de verdade, não absorvidas no §10 do PRD (G3); validador frio como sub-agent separado (G4); scan de ambiguidade determinístico e logado, sem escape hatch "tenho certeza" (G5); status verificado contra disco (G6).
- **`direct` ≠ `full` de verdade:** `direct` não produz `PLAN_*.md` por design; `full` exige o plano antes de qualquer código.
