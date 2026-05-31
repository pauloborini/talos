---
name: atlas-workflow-orchestrator
description: "Orquestra pipeline completo de desenvolvimento de features: /workflow <tool> <mode> <input-type> [flags]. Automatiza PRD generation → validação → entrevista (se necessário) → planejamento → execução → review (opcional). Pipeline orientado a artefato com gates duros: cada fase só conta se produzir arquivo verificável em disco."
category: Development Automation
---

# Atlas Workflow Orchestrator

Orquestra pipelines de desenvolvimento de features no projeto Atlas, automatizando a sequência de skills sob demanda com um único comando.

> **v0.1.9 — famílias completas + `full` não termina no plano.** Cada fase do pipeline só é considerada concluída se produzir um **arquivo verificável em disco**. A próxima fase lê esse arquivo. A família vem de `<tool>` e não mistura skills. Em `full`, depois de `PLAN_*.md` validado, a próxima ação obrigatória é despachar `plan_execute` como sub-agent blocking. Sem executor → workflow `incomplete`, nunca `completed`.

## Sintaxe

```
/workflow <tool> <mode> <input-type> [flags]
```

### Ferramentas

- `claude`
- `cursor`
- `codex`

### Modos

- **`full`** — pipeline completo: PRD → validação → entrevista (se necessário) → **plano (artefato obrigatório)** → executor → review (opcional)
- **`direct`** — pipeline enxuto: PRD → validação → entrevista (se necessário) → executor → review (opcional). **Não produz plano de handoff** — a diferença real para `full` é exatamente essa.
- **`interview-only`** — entrevista direta (ex: brainstorm, resolução de decisões)

### Input Types

- **`backlog-item`** — Sprint ID (ex: S05) ou indicação direta (ex: "implementar login")
- **`idea`** — Indicação/brainstorm curto
- **`prd`** — Path para PRD existente ou nome do arquivo
- **`brainstorm`** — Texto livre (só para `interview-only`)

### Flags

- `--interview` — força entrevista de PRD mesmo sem ambiguidades detectadas
- `--review` — executa slice-review ao final (senão é opcional)
- `--help` — mostra sintaxe completa

## Exemplos

```
/workflow <tool> full backlog-item "S05"
→ Gera PRD para S05, valida, entrevista se necessário, cria PLAN_*.md, executa a partir do plano

/workflow <tool> direct prd "/path/to/PRD_S05.md" --review
→ Valida PRD, executa direto (sem handoff), roda review ao final

/workflow <tool> full idea "melhorar performance de listagem" --interview
→ Gera PRD de indicação, força entrevista, plano, executor

/workflow <tool> interview-only brainstorm "que tal dark mode?"
→ Entrevista direto, sem PRD prévio
```

---

## Fase 0 — Pré-flight obrigatório (antes de qualquer fase)

Executar **antes** de iniciar o pipeline. Se qualquer item falhar, **parar e reportar** — nunca emular.

1. **Parse** dos argumentos `<tool> <mode> <input-type> [input] [flags]`. Se inválido ou `--help` → mostrar sintaxe e parar.
2. **`<tool>` é autoritativo — define a família de skills.** `claude` → família `claude-*`, `cursor` → `cursor-*`, `codex` → `codex-*`. **O host (Cursor/Codex/Claude Code) NÃO escolhe a família.** Host é só o lugar onde roda; um host como o Cursor enxerga e despacha as três famílias. Proibido trocar a família por causa do host. Resolver os ids exatos via `atlas_workflows_config.md` (ver Gate G10).
3. **Verificar despachabilidade da família escolhida.** Para cada skill exigida pelo modo, confirmar que o **id exato** daquela família é invocável via Skill tool e despachável via Agent tool neste host.
   - **Família mista é proibida** (Gate G10): não rode PRD em `claude-*` e plano em `cursor-*`. Toda a run usa uma família.
   - As três famílias são completas. Se uma skill específica da família **não existir** → **ABORTAR**, não trocar a família inteira.
   - **Nunca substituir por variante** (ex: `-orchestrated`, `-experimental`) salvo flag explícita do usuário (Gate G10).
   ```text
   ⛔ Pré-flight falhou
      Família (<tool>): <claude-*|cursor-*|codex-*>
      Skill exigida ausente: <id exato>
      Motivo: id não despachável neste host
      Ação: rodar onde a família <tool> esteja disponível, ou trocar o <tool> do comando
   ```
   **PROIBIDO o fallback "implementação direta" / "contratos equivalentes inline".** Não existe caminho onde o orquestrador faz plano ou código no próprio fio. Emulação inline e fallback direto são a falha-raiz que esta skill proíbe — se não há sub-agent, **para**. (Gate G7.)
4. **Rejeitar conflito de modo:** se o pedido tiver `full`/`direct` junto com "sem patch", "sem editar código", "planejamento apenas", "handoff only" ou equivalente, **pare antes de gerar artefatos**. `full`/`direct` executam `plan_execute`; não existe interpretação plan-only implícita.
5. **Declarar o plano de execução** (1 bloco curto): modo, **família escolhida + ids exatos de cada sub-agent**, sequência de fases e ordem dos sub-agents (plan_handoff → execute[→task-validator] → slice-review), artefatos esperados, gates aplicáveis. Só então iniciar a Fase 1.

---

## Papel do orquestrador (mãos atadas)

O orquestrador **coordena**, não implementa. Pense nele como um maestro: aponta para cada músico (sub-agent) na ordem certa e espera cada um terminar. Ele nunca pega um instrumento.

- **Permitido:** parse de args, scan de ambiguidade, despachar sub-agent (blocking, um por vez), ler artefato em disco para verificar gate, montar o output final.
- **Proibido (Gate G9):** editar arquivo, escrever Dart, rodar comando mutante (`flutter`, `test`, `git add/commit`), implementar "em paralelo", usar `run_in_background` para fases do pipeline.
- **Dispatch blocking:** despacha → **espera o retorno** → verifica gate → próxima fase. Nunca dois sub-agents simultâneos. Nunca trabalhar enquanto um sub-agent roda.

Se você (orquestrador) está prestes a editar código, **pare**: esse trabalho é do sub-agent de execução. Despache-o e espere.

## Gates duros (HARD GATES)

Regras inegociáveis. Violação = parar, não contornar.

| # | Gate | Aplica a |
|---|------|----------|
| G1 | **Artefato antes de avançar.** Uma fase só conta como concluída se o arquivo que ela produz existir em disco. Verificar com leitura real do arquivo (Read/ls), nunca por auto-relato. | todas |
| G2 | **Em `full`, proibido escrever qualquer código (Dart) antes de existir `PLAN_*.md` validado em disco.** Se for escrever código sem plano, o modo correto é `direct` — então pare e avise o usuário do mismatch. | `full` |
| G3 | **Skills invocadas de verdade.** Cada fase invoca a skill correspondente via Skill tool (ou sub-agent via Agent tool para o validador). Proibido absorver o trabalho da skill no mesmo turno "implicitamente" (ex: plano dentro do §10 do PRD não substitui `PLAN_*.md`). | todas |
| G4 | **Validador frio é sub-agent separado dentro do executor.** O orquestrador verifica no pré-flight que `task_validator` existe, mas quem despacha esse sub-agent é `plan_execute`, para receber findings e aplicar reparo limitado antes do relatório final. O executor não valida o próprio trabalho no mesmo contexto. | execução |
| G5 | **Scan de ambiguidade determinístico e logado.** A decisão de pular a entrevista só é válida se o scan retornar **zero** padrões e esse resultado for registrado no output. Não existe "pular porque tenho certeza". `--interview` sempre força. | validação PRD |
| G6 | **Status verificado, não auto-reportado.** O ✅ de cada item no output só pode ser marcado após confirmar o artefato em disco. Faltou artefato exigido pelo modo → status final `incomplete`, nunca `completed`. | output |
| G7 | **Plano e execução rodam como sub-agent despachado (Agent tool), nunca no contexto do orquestrador.** As fases `plan_handoff` e `plan_execute` **devem** ser disparadas como sub-agents. Proibido produzir o plano ou escrever o código no próprio fio do orquestrador. Além disso, o `PLAN_*.md` **deve** conformar ao template da skill `plan_handoff` (§2 invariantes, §10 contratos, §11 riscos, §14 checklist, tasks numeradas T01..Tn). Plano sem essas seções = G7 violado → refazer via sub-agent. | plano + execução |
| G8 | **Ordem fixa de validação: `task-validator` ANTES, `slice-review` POR ÚLTIMO. Nunca em paralelo.** O `task-validator` é sub-agent filho de `plan_execute` e roda **dentro/antes** do relatório final do executor (alimenta o reparo, bloqueia o relatório). O `slice-review` (se `--review`) roda como sub-agent de fase final **separada** despachada pelo orquestrador, só **depois** do executor retornar 100%. É proibido disparar `slice-review` enquanto o executor ou o `task-validator` ainda estão rodando. | validação + review |
| G10 | **`<tool>` autoritativo, família única, id exato.** A família de skills é definida **exclusivamente** pelo argumento `<tool>` do comando, nunca pelo host. Proibido misturar famílias numa run. Usar sempre o **id exato** mapeado; proibido substituir por variante (`-orchestrated`, `-experimental`, etc.) salvo flag explícita. Skill ausente → aborta, nunca troca a família inteira. | roteamento |
| G9 | **Orquestrador é coordenador de mãos atadas.** Depois da Fase 0, o orquestrador **NÃO** edita arquivos, **NÃO** escreve código, **NÃO** roda comando mutante (flutter/test/git write), **NÃO** "ajuda" o sub-agent. Suas únicas ações permitidas: despachar sub-agent, ler artefato em disco para verificação de gate, e produzir o output final. **Dispatch é blocking**: despacha **um** sub-agent por vez (Agent tool em foreground), **espera o retorno**, só então segue. Proibido `run_in_background` para fases do pipeline e proibido o orquestrador implementar "em paralelo" enquanto um sub-agent roda. Se o orquestrador tocar em código = G9 violado. | orquestrador |
| G11 | **`full` deve executar depois do plano.** Depois que `PLAN_*.md` existe e passa G1/G2/G7, a próxima ação obrigatória é despachar `plan_execute` como sub-agent blocking. Proibido finalizar, pedir validação humana, resumir ou marcar `completed` só com handoff. Pedido `full` + "sem patch"/"só plano" é conflito de modo e deve abortar no pré-flight. | `full` |

---

## Fluxo de execução

### Full mode

Artefatos esperados (em ordem): `PRD_*.md` → (`PRD_*.md` atualizado) → `PLAN_*.md` → diff de código → relatório do validador.

1. **Parse input** — resolve backlog-item/idea para contexto de sprint.
2. **Generate PRD** — invoca o id resolvido para `prd_generator` da família escolhida. **Gate G1:** confirmar `PRD_*.md` em disco antes de seguir.
3. **Validate PRD** — roda o scan de ambiguidade (ver "Validação automática"). **Gate G5:** registrar quantos padrões foram encontrados.
4. **Interview (condicional)** — se ambiguidades ≥ 1 **OU** `--interview` → invoca o id resolvido para `prd_interview`. Atualiza o `PRD_*.md` com as decisões. **Gate G1:** confirmar PRD atualizado.
5. **Plan** — despacha o id resolvido para `plan_handoff` **como sub-agent (Agent tool)** (Gate G7). **Gate G1 + G2:** confirmar `PLAN_*.md` em disco e que conforma ao template (§2/§10/§11/§14 + tasks T01..Tn). **Nenhuma linha de código pode ter sido escrita até aqui.**
   - **G11:** se `PLAN_*.md` foi validado, o orquestrador não pode encerrar nem entregar apenas o handoff. A próxima ação é obrigatoriamente a Fase 7.
6. **Validate plan** — se há gaps → aplica a Lógica de decisão (A/B/C).
7. **Execute** — despacha o id resolvido para `plan_execute` **como sub-agent (Agent tool)** lendo o `PLAN_*.md` (Gate G7 + G11). Dentro desse sub-agent, **antes do relatório final**, `plan_execute` dispara o `task_validator` resolvido como sub-agent filho com git diff + plano (Gate G4). Findings P1/P2 voltam para `plan_execute`, alimentam reparo limitado e só então o executor retorna. **Gate G8:** validador roda aqui, slice-review NÃO.
8. **Review (condicional)** — **somente após o executor retornar 100%** (Gate G8) e se `--review` → **despacha o id resolvido para `slice_review` como sub-agent** (Agent tool, blocking — Gate G7+G9). É uma fase final separada, jamais uma revisão inline escrita pelo orquestrador. Proibido em paralelo com a Fase 7.
9. **Output** — ledger verificado (ver "Output") + próximos passos.

### Direct mode

Artefatos esperados: `PRD_*.md` → (atualizado) → diff de código → relatório do validador. **Sem `PLAN_*.md`** — por design.

1. Parse / Generate PRD (se necessário). **Gate G1.**
2. Validate PRD → Interview (condicional). **Gate G5.**
3. Execute — despacha o id resolvido para `plan_execute` **como sub-agent** direto a partir do PRD (Gate G7). **Gate G4** (validador frio dentro do executor, antes do relatório).
4. Review (condicional) — só após executor retornar 100% (Gate G8).
5. Output (ledger verificado).

> Se durante `direct` o escopo exigir um plano de handoff formal, **avise o usuário** e sugira `full` — não fabrique um `PLAN_*.md` ad hoc no meio de `direct`.

### Interview-only mode

1. Entrevista direta (sem PRD anterior) — invoca o id resolvido para `prd_interview`.
2. Gera PRD esboço (opcional).

---

## Validação automática de PRD

O scan é **determinístico**. Marca ambiguidade quando uma seção contém qualquer padrão abaixo (lista canônica em `atlas_workflows_config.md`):

- **§3 Objetivo:** `TBD`, `a confirmar`, `talvez`, `não definido`
- **§4 Escopo:** `pode ser`, `depende de`, `ainda não`, `incompleto`
- **§5 Decisões:** vazio/conteúdo mínimo, `vago`
- **§8 Experiência:** `a definir`, `gap`, `depende de`
- **§9 Dados/contratos:** `ainda não definido`, `mock apenas`, `a confirmar`

**Threshold = 1.** Se ≥ 1 padrão → dispara o `prd_interview` resolvido por `<tool>`. **Gate G5:** se 0 padrões, registrar `Ambiguity scan: 0 padrões — entrevista pulada` no output. Não há decisão subjetiva de "tenho certeza, pulo".

---

## Lógica de decisão

Quando há decisões pendentes durante entrevista ou validação de plano:

```
Plugin: "Tenho decisões em aberto:"
  Q-XXX-01: [decisão 1]
  Q-XXX-02: [decisão 2]

Opções:
  A) Volta pra resolver tudo (roda interview agora)
  B) Continua com recomendações (marca TBD, segue)
  C) Adia essas decisões
```

Usuário escolhe A/B/C → plugin continua conforme.

---

## Output

O ledger é **verificado contra disco** (Gate G6). Cada artefato listado precisa existir.

```
✅ Workflow: claude full backlog-item completed

📄 PRD: /path/to/PRD_S05_login.md            [verificado em disco]
📋 Plan: /path/to/PLAN_S05_login.md          [verificado em disco]
🚀 Output: [summary 1-2 linhas do executor]

Status:
  ✅ PRD valid
  ✅ Ambiguity scan: 2 padrões → entrevista executada (2 decisões)
  ✅ Plano generated (PLAN_*.md presente)
  ✅ Executor output ready (required in full/direct)
  ✅ Validador frio: P1=0 P2=1 P3=2 (sub-agent task-validator)
  ⏭️  Slice review: not executed (run with --review)

Próximo passo:
  [ ] Validar executor output
  [ ] Rodar slice-review (opcional)
  [ ] Avançar para próxima sprint
```

Se algum artefato exigido pelo modo estiver ausente, o cabeçalho vira:

```
⚠️  Workflow: claude full backlog-item incomplete
   Faltando: PLAN_*.md (Gate G2 bloqueou execução de código)
```

Se `full` gerou `PLAN_*.md` mas não despachou `plan_execute`, o cabeçalho deve ser:

```
⚠️  Workflow: <tool> full <input-type> incomplete
   Violação: G11 — PLAN_*.md validado, mas plan_execute não foi despachado
   Próxima ação obrigatória: despachar plan_execute como sub-agent blocking
```

---

## Integração com PERGUNTAS_EM_ABERTO.md

Plugin verifica `PERGUNTAS_EM_ABERTO.md` durante validação de PRD. Se houver Q-… abertas relacionadas à sprint → informa ao usuário e para/aguarda decisão; não despacha open-questions automaticamente neste pipeline.

---

## Error handling

- **Pré-flight falha (skill ausente no host)** → para, reporta, não emula (ver Fase 0).
- **Sprint não encontrado** → reporta sprints disponíveis.
- **Skill falha** → para, reporta erro, oferece retry/skip/abort.
- **PRD inválido** → reporta sections faltando, opção de continuar com warning.
- **Gate duro violado** → para, reporta qual gate (G1–G11) e o artefato/condição faltante.
- **Ambiguidades não resolvidas** → pergunta próximos passos (ver Lógica de decisão).

---

## Skills envolvidas

| Skill | Entrada | Saída (artefato) |
|-------|---------|------------------|
| `prd_generator` resolvido por `<tool>` | sprint_id/indicação | `PRD_*.md`, decisions_found |
| `prd_interview` resolvido por `<tool>` | prd_path, ambiguities | `PRD_*.md` atualizado, decisions |
| `plan_handoff` resolvido por `<tool>` | prd_path | `PLAN_*.md` |
| `plan_execute` resolvido por `<tool>` | plan_path (full) ou prd_path (direct) | diff de código, evidência |
| `slice_review` resolvido por `<tool>` | diff/output | review_feedback |

**Sub-agent frio (Gate G4):** `task_validator` resolvido por `<tool>` é verificado no pré-flight pelo orquestrador, mas despachado por `plan_execute` como sub-agent filho.

---

## Configuração

Plugin referencia `atlas_workflows_config.md` para:
- Mapeamento tool → skills
- Padrões de ambiguidade (lista canônica)
- Sequências de skill por modo + artefatos esperados
- Gates duros

Se não houver config → usa defaults (Claude skills) e os gates desta SKILL.

---

## Ordem de sub-agents (resumo executável)

```
orquestrador
 ├─ Fase 0: pré-flight (resolve skills do host; sem sub-agent => ABORTA, nunca inline)
 ├─ PRD        → sub-agent prd_generator        → PRD_*.md (G1)
 ├─ scan       → determinístico (G5)            → entrevista se ≥1 ou --interview
 ├─ PLANO      → sub-agent plan_handoff (G7)    → PLAN_*.md conforme template §2/§10/§11/§14 (G2)
 ├─ G11        → se full: PLAN validado => próxima ação obrigatória = plan_execute
 ├─ EXECUÇÃO   → sub-agent plan_execute (G7+G11)
 │                └─ task-validator (sub-agent frio, G4) ANTES do relatório (G8)
 │                   findings → reparo limitado → executor retorna
 └─ REVIEW     → sub-agent slice_review (só se --review, SÓ após executor 100%, G8) — nunca paralelo
```

Regra de ouro: **um sub-agent por fase, em série, blocking**. O orquestrador espera cada sub-agent terminar antes do próximo e **nunca** trabalha em paralelo (Gate G9). Em `full`, `PLAN_*.md` validado obriga `plan_execute` no mesmo workflow (G11). `task-validator` ⟂ `slice-review` jamais coexistem.

## Changelog

- **v0.1.9** — Remove exceção cross-family: famílias `claude`, `cursor` e `codex` completas, incluindo `cursor-sprint-prd-generator`; skill ausente agora aborta sem fallback.
- **v0.1.8** — Limita o workflow às famílias `claude`, `cursor` e `codex`, clarifica `task_validator` como sub-agent filho de `plan_execute` e torna Open Questions apenas bloqueio/aviso fora do pipeline.
- **v0.1.7** — Gate G11: em `full`, após `PLAN_*.md` validado, `plan_execute` é a próxima ação obrigatória; proíbe finalizar só com handoff e rejeita `full/direct` com "sem patch"/"só plano".
- **v0.1.6** — Sincroniza versões/manifests, remove hardcode operacional `claude-*` no fluxo genérico e define ids Codex exatos (`codex-*`) para cumprir G10.
- **v0.1.5** — Roteamento por `<tool>`, não por host. Gate G10: `<tool>` é autoritativo (define a família `claude-*`/`cursor-*`/`codex-*`); host NÃO escolhe família. Família única por run (proibido misturar), id exato (proibido variante `-orchestrated` sem flag). Fase 0 reescrita: removida a resolução "host Cursor ⇒ cursor-*" que ignorava o arg. Corrige GF09 (comando `claude` roteou pra `cursor-*`, pegou `cursor-plan-execute-orchestrated` errado e misturou famílias).
- **v0.1.4** — Orquestrador de mãos atadas. Gate G9 (orquestrador é coordenador: proibido editar código/rodar comando mutante/implementar em paralelo; dispatch blocking, um sub-agent por vez, sem `run_in_background`). G7 estendido ao `slice-review` (deve ser sub-agent despachado, não revisão inline). Corrige GF08: orquestrador implementou inline em paralelo ao sub-agent de execução (contexto 87%) e fez slice-review inline.
- **v0.1.3** — Força sub-agent. Gate G7 (plano e execução despachados como sub-agent, nunca inline; `PLAN_*.md` deve conformar ao template da skill `plan_handoff`). Gate G8 (ordem fixa: `task-validator` antes/dentro do executor, `slice-review` por último, nunca em paralelo). Fase 0 reforçada: matou o fallback "implementação direta / contratos equivalentes inline" — host sem sub-agent despachável **aborta**. Corrige falhas observadas no GF07 (plano sem template, validator+slice em paralelo, fallback inline no Cursor).
- **v0.1.2** — Pipeline orientado a artefato. Adicionados: Fase 0 pré-flight (verifica invocabilidade, proíbe emulação inline), Gates duros G1–G6, scan de ambiguidade determinístico (mata o escape hatch "tenho certeza"), validador frio obrigatório como sub-agent, ledger verificado contra disco. `direct` explicitamente não produz `PLAN_*.md`.
- **v0.1.1** — `/workflow` slash command.
- **v0.1.0** — MVP (Claude skills).

## Próximas fases

- **v0.2** Cursor support
- **v0.3** Codex hardening
- **v1.0** Full feature parity em todas as ferramentas
