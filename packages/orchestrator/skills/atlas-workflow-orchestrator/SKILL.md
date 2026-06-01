---
name: atlas-workflow-orchestrator
description: "Orquestra pipeline completo de desenvolvimento de features: /workflow <tool> <mode> <input-type> [flags]. Automatiza PRD generation → validação → entrevista (se necessário) → planejamento → execução → review (opcional). Pipeline orientado a artefato com gates duros: cada fase só conta se produzir arquivo verificável em disco."
category: Development Automation
---

# Atlas Workflow Orchestrator

Orquestra pipelines de desenvolvimento de features no projeto Atlas, automatizando a sequência de skills sob demanda com um único comando.

> **v0.2 — MCP como fonte obrigatória de status.** Cada gate materializado deve ser consultado via MCP antes de avançar: `atlas_ping`, `atlas_preflight`, `atlas_lock_family`, `atlas_verify_artifact`, `atlas_scan_prd`, `atlas_verify_template_conformance`, `atlas_lock_dispatch` e `atlas_assert_after_plan`. Sem resposta MCP, sem resultado exigido ou status bloqueante → workflow abortado, sem fallback narrativo.

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
2. **Chamar MCP `atlas_ping`.** Se não responder, versão vier vazia ou capacidades não listarem os gates exigidos pelo modo → abortar com erro de MCP indisponível. Não seguir por prosa.
3. **Chamar MCP `atlas_preflight`** com `run_id`, `<tool>` como `family` e `<mode>`. O resultado G10 é a fonte obrigatória de família, modo e ids oficiais.
4. **Chamar MCP `atlas_lock_family`** antes de despachar cada papel (`prd_generator`, `prd_interview`, `plan_handoff`, `plan_execute`, `task_validator`, `slice_review` quando aplicável), usando o id exato retornado no preflight.
5. **Carregar config/defaults do pacote do plugin.** Usar `atlas_workflows_config.md`, `defaults/paths.md` e `references/subagent_dispatch.md` empacotados. Não exigir config na raiz do repositório usuário.
6. **`<tool>` é autoritativo — define a família de skills.** `claude` → família `claude-*`, `cursor` → `cursor-*`, `codex` → `codex-*`. **O host (Cursor/Codex/Claude Code) NÃO escolhe a família.** Host é só o lugar onde roda; um host como o Cursor enxerga e despacha as três famílias. Proibido trocar a família por causa do host. Resolver os ids exatos pelo resultado de `atlas_preflight` (ver Gate G10).
7. **Verificar despachabilidade da família escolhida.** Para cada skill exigida pelo modo, confirmar que o **id exato** daquela família é invocável via Skill tool e despachável via Agent tool neste host.
   - **Família mista é proibida** (Gate G10): não rode PRD em `claude-*` e plano em `cursor-*`. Toda a run usa uma família.
   - As três famílias são completas. Se uma skill específica da família **não existir** → **ABORTAR**, não trocar a família inteira.
   - **Nunca substituir por variante de executor** (Gate G10).
   - Resolver como o sub-agent carregará o `SKILL.md` real do id antes de executar (ver `references/subagent_dispatch.md`).
   ```text
   ⛔ Pré-flight falhou
      Família (<tool>): <claude-*|cursor-*|codex-*>
      Skill exigida ausente: <id exato>
      Motivo: id não despachável neste host
      Ação: rodar onde a família <tool> esteja disponível, ou trocar o <tool> do comando
   ```
   **PROIBIDO o fallback "implementação direta" / "contratos equivalentes inline".** Não existe caminho onde o orquestrador faz plano ou código no próprio fio. Emulação inline e fallback direto são a falha-raiz que esta skill proíbe — se não há sub-agent, **para**. (Gate G7.)
8. **Rejeitar conflito de modo:** se o pedido tiver `full`/`direct` junto com "sem patch", "sem editar código", "planejamento apenas", "handoff only" ou equivalente, **pare antes de gerar artefatos**. `full`/`direct` executam `plan_execute`; não existe interpretação plan-only implícita.
9. **Declarar o plano de execução** (1 bloco curto): `run_id`, modo, **família escolhida + ids exatos de cada sub-agent**, sequência de fases, artefatos esperados e tools MCP que sustentarão cada gate. Só então iniciar a Fase 1.

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
| G1 | **Artefato antes de avançar.** Uma fase só conta como concluída se `atlas_verify_artifact` aprovar o arquivo produzido. Leitura local pode complementar, mas não substitui o resultado MCP. | todas |
| G2 | **Em `full`, proibido escrever qualquer código (Dart) antes de existir `PLAN_*.md` validado em disco.** Se for escrever código sem plano, o modo correto é `direct` — então pare e avise o usuário do mismatch. | `full` |
| G3 | **Skills invocadas de verdade.** Cada fase invoca a skill correspondente via Skill tool ou sub-agent. O sub-agent deve carregar o `SKILL.md` do id resolvido antes de agir; prompt "aja como X" não basta. Proibido absorver o trabalho da skill no mesmo turno "implicitamente" (ex: plano dentro do §10 do PRD não substitui `PLAN_*.md`). | todas |
| G4 | **Validador frio é sub-agent separado dentro do executor.** O orquestrador verifica no pré-flight que `task_validator` existe, mas quem despacha esse sub-agent é `plan_execute`, para receber findings e aplicar reparo limitado antes do relatório final. O executor não valida o próprio trabalho no mesmo contexto. | execução |
| G5 | **Scan de ambiguidade determinístico e logado.** A decisão de pular a entrevista só é válida se `atlas_scan_prd` retornar **zero** padrões e esse resultado MCP estiver no ledger. Não existe "pular porque tenho certeza". `--interview` sempre força. | validação PRD |
| TC | **Conformidade de template via MCP.** PRD e PLAN só avançam como artefatos documentais se `atlas_verify_template_conformance` retornar `passed` e `pending_count: 0`. Pendência bloqueia com `next_action`. | PRD + plano |
| G6 | **Status verificado, não auto-reportado.** O ✅ de cada item no output só pode ser marcado após confirmar o artefato em disco. Faltou artefato exigido pelo modo → status final `incomplete`, nunca `completed`. | output |
| G7 | **Plano e execução rodam como sub-agent despachado (Agent tool), nunca no contexto do orquestrador.** Antes de iniciar/concluir fase, usar `atlas_lock_dispatch`; fase fora de ordem ou paralela bloqueia. Além disso, o `PLAN_*.md` deve passar TC. | plano + execução |
| G8 | **Ordem fixa de validação: `task-validator` ANTES, `slice-review` POR ÚLTIMO. Nunca em paralelo.** Conclusão de `plan_execute` usa `atlas_lock_dispatch` com `validator_status: passed`; review só inicia após execução concluída. | validação + review |
| G10 | **`<tool>` autoritativo, família única, id exato.** A família e os ids oficiais vêm de `atlas_preflight`/`atlas_lock_family`, nunca do host. Skill ausente ou troca de família → aborta, nunca troca a família inteira. | roteamento |
| G9 | **Orquestrador é coordenador de mãos atadas.** Depois da Fase 0, o orquestrador **NÃO** edita arquivos, **NÃO** escreve código, **NÃO** roda comando mutante (flutter/test/git write), **NÃO** "ajuda" o sub-agent. Suas únicas ações permitidas: despachar sub-agent, ler artefato em disco para verificação de gate, e produzir o output final. **Dispatch é blocking**: despacha **um** sub-agent por vez (Agent tool em foreground), **espera o retorno**, só então segue. Proibido `run_in_background` para fases do pipeline e proibido o orquestrador implementar "em paralelo" enquanto um sub-agent roda. Se o orquestrador tocar em código = G9 violado. | orquestrador |
| G11 | **`full` deve executar depois do plano.** Depois que `PLAN_*.md` passa G1/G2/G7/TC, chamar `atlas_assert_after_plan`; a próxima ação obrigatória é despachar `plan_execute` como sub-agent blocking. Proibido completed só com handoff. | `full` |

---

## Fluxo de execução

### Full mode

Artefatos esperados (em ordem): `PRD_*.md` → (`PRD_*.md` atualizado) → `PLAN_*.md` → diff de código → relatório do validador.

1. **Parse input** — resolve backlog-item/idea para contexto de sprint.
2. **Generate PRD** — chamar `atlas_lock_family(role=prd_generator)`, invocar o id resolvido para `prd_generator`, depois chamar `atlas_verify_artifact` no `PRD_*.md`.
3. **Validate PRD** — chamar `atlas_scan_prd` e `atlas_verify_template_conformance(artifact_type=prd, required_status=Aprovado para implementação)` quando o PRD for avançar. G5 e TC entram no ledger com fonte MCP.
4. **Interview (condicional)** — se `atlas_scan_prd` retornar bloqueante, TC bloquear ou `--interview` → chamar `atlas_lock_family(role=prd_interview)`, invocar o id resolvido para `prd_interview`, depois reexecutar `atlas_verify_artifact`, `atlas_scan_prd` e TC no PRD atualizado.
5. **Plan** — chamar `atlas_lock_family(role=plan_handoff)` e `atlas_lock_dispatch(action=start, phase=plan_handoff)`, despachar `plan_handoff` como sub-agent, depois chamar `atlas_verify_artifact` e `atlas_verify_template_conformance(artifact_type=plan)`. Concluir a fase com `atlas_lock_dispatch(action=complete, phase=plan_handoff)`. **Nenhuma linha de código pode ter sido escrita até aqui.**
   - **G11:** se `PLAN_*.md` foi validado, chamar `atlas_assert_after_plan`. Se a próxima ação não for `dispatch_plan_execute_blocking`, abortar.
6. **Validate plan** — se há gaps → aplica a Lógica de decisão (A/B/C).
7. **Execute** — chamar `atlas_lock_family(role=plan_execute)` e `atlas_lock_dispatch(action=start, phase=plan_execute)`, despachar `plan_execute` como sub-agent lendo o `PLAN_*.md`. Dentro desse sub-agent, `plan_execute` dispara `task_validator` filho. Ao retornar, concluir com `atlas_lock_dispatch(action=complete, phase=plan_execute, validator_status=passed)`. Status diferente bloqueia review e output completed.
8. **Review (condicional)** — somente após execução concluída e se `--review` → chamar `atlas_lock_family(role=slice_review)`, `atlas_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `atlas_lock_dispatch(action=complete, phase=slice_review)`.
9. **Output** — ledger verificado com fonte MCP por gate/fase (ver "Output") + próximos passos.

### Direct mode

Artefatos esperados: `PRD_*.md` → (atualizado) → diff de código → relatório do validador. **Sem `PLAN_*.md`** — por design.

1. Parse / Generate PRD (se necessário) com `atlas_lock_family(role=prd_generator)` + `atlas_verify_artifact`.
2. Validate PRD → `atlas_scan_prd` + `atlas_verify_template_conformance`; entrevista condicional reexecuta os gates.
3. Execute — `atlas_lock_family(role=plan_execute)` + `atlas_lock_dispatch(action=start, phase=plan_execute)`; despacha `plan_execute` direto a partir do PRD; conclui com `atlas_lock_dispatch(action=complete, phase=plan_execute, validator_status=passed)`.
4. Review (condicional) — só após executor retornar 100% e dispatch MCP permitir.
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

Antes de contar bloqueantes, aplicar exclusões estreitas do config (`exclude_if_line_contains`, hoje `depende de plano`) para frases de sucesso/resultado que descrevem dependência operacional já planejada. Não usar julgamento livre: a exclusão precisa estar no config e ser logada.

**Threshold = 1.** Se ≥ 1 padrão bloqueante → dispara o `prd_interview` resolvido por `<tool>`. **Gate G5:** se 0 padrões bloqueantes, registrar `Ambiguity scan: 0 padrões bloqueantes — entrevista pulada` no output. Não há decisão subjetiva de "tenho certeza, pulo".

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
  ✅ Preflight: passed [MCP: atlas_preflight / G10]
  ✅ PRD artifact: passed [MCP: atlas_verify_artifact / G1]
  ✅ Ambiguity scan: 2 padrões → entrevista executada [MCP: atlas_scan_prd / G5]
  ✅ Template conformance: passed [MCP: atlas_verify_template_conformance / TC]
  ✅ Plano generated [MCP: atlas_verify_artifact + atlas_verify_template_conformance]
  ✅ Dispatch plan_execute: passed [MCP: atlas_lock_dispatch / G7+G8]
  ✅ After plan: passed [MCP: atlas_assert_after_plan / G11]
  ✅ Validador frio: P1=0 P2=1 P3=2 [executor + task-validator]
  ⏭️  Slice review: not applicable [MCP source: mode/flag]

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

Se algum resultado MCP exigido estiver ausente, indisponível ou bloqueante, o cabeçalho deve ser:

```
⚠️  Workflow: <tool> <mode> <input-type> aborted
   Gate MCP: <tool MCP ou gate>
   Status: <blocked|missing|unavailable>
   Próxima ação permitida: <next_action retornado pelo MCP ou restaurar serviço MCP>
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
- **MCP indisponível, sem resultado exigido ou status bloqueante** → aborta a fase; reporta tool/gate/status/`next_action`; nunca usa fallback narrativo.
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

Plugin referencia `atlas_workflows_config.md` empacotado para:
- Mapeamento tool → skills
- Padrões de ambiguidade (lista canônica)
- Sequências de skill por modo + artefatos esperados
- Gates duros

Se a config empacotada estiver ausente, o pacote está inválido: abortar no pré-flight. Não cair para defaults Claude implícitos.

---

## Ordem de sub-agents (resumo executável)

```
orquestrador
 ├─ MCP ping + preflight                         → atlas_ping + atlas_preflight (G10)
 ├─ PRD        → lock_family + sub-agent         → atlas_verify_artifact (G1)
 ├─ scan       → atlas_scan_prd (G5) + TC        → entrevista se bloqueado ou --interview
 ├─ PLANO      → lock_dispatch + sub-agent       → atlas_verify_artifact + atlas_verify_template_conformance
 ├─ G11        → atlas_assert_after_plan         → próxima ação obrigatória = plan_execute
 ├─ EXECUÇÃO   → atlas_lock_dispatch + sub-agent plan_execute
 │                └─ task-validator (sub-agent frio, G4) ANTES do relatório (G8)
 │                   findings → reparo limitado → executor retorna
 └─ REVIEW     → atlas_lock_dispatch + sub-agent slice_review (se --review)
```

Regra de ouro: **um sub-agent por fase, em série, blocking, sustentado por MCP**. O orquestrador espera cada sub-agent terminar antes do próximo e **nunca** trabalha em paralelo (Gate G9). Em `full`, `PLAN_*.md` validado obriga `plan_execute` no mesmo workflow (G11). `task-validator` ⟂ `slice-review` jamais coexistem.

## Changelog

- **v0.2.0-dev** — S10: orquestrador usa MCP como fonte obrigatória de status em preflight, PRD, scan, conformidade, dispatch, pós-plano, execução, review e ledger final; falha MCP aborta sem fallback narrativo.
- **v0.1.10** — Config/defaults empacotados no plugin; sub-agent deve carregar o `SKILL.md` real do id resolvido; G5 ganha exclusão estreita para falso positivo `depende de plano`; executor permanece o `plan_execute` exato da família, sem variante.
- **v0.1.9** — Remove exceção cross-family: famílias `claude`, `cursor` e `codex` completas, incluindo `cursor-sprint-prd-generator`; skill ausente agora aborta sem fallback.
- **v0.1.8** — Limita o workflow às famílias `claude`, `cursor` e `codex`, clarifica `task_validator` como sub-agent filho de `plan_execute` e torna Open Questions apenas bloqueio/aviso fora do pipeline.
- **v0.1.7** — Gate G11: em `full`, após `PLAN_*.md` validado, `plan_execute` é a próxima ação obrigatória; proíbe finalizar só com handoff e rejeita `full/direct` com "sem patch"/"só plano".
- **v0.1.6** — Sincroniza versões/manifests, remove hardcode operacional `claude-*` no fluxo genérico e define ids Codex exatos (`codex-*`) para cumprir G10.
- **v0.1.5** — Roteamento por `<tool>`, não por host. Gate G10: `<tool>` é autoritativo (define a família `claude-*`/`cursor-*`/`codex-*`); host NÃO escolhe família. Família única por run (proibido misturar), id exato. Fase 0 reescrita: removida a resolução "host Cursor ⇒ cursor-*" que ignorava o arg. Corrige GF09 (comando `claude` roteou pra `cursor-*` e misturou famílias).
- **v0.1.4** — Orquestrador de mãos atadas. Gate G9 (orquestrador é coordenador: proibido editar código/rodar comando mutante/implementar em paralelo; dispatch blocking, um sub-agent por vez, sem `run_in_background`). G7 estendido ao `slice-review` (deve ser sub-agent despachado, não revisão inline). Corrige GF08: orquestrador implementou inline em paralelo ao sub-agent de execução (contexto 87%) e fez slice-review inline.
- **v0.1.3** — Força sub-agent. Gate G7 (plano e execução despachados como sub-agent, nunca inline; `PLAN_*.md` deve conformar ao template da skill `plan_handoff`). Gate G8 (ordem fixa: `task-validator` antes/dentro do executor, `slice-review` por último, nunca em paralelo). Fase 0 reforçada: matou o fallback "implementação direta / contratos equivalentes inline" — host sem sub-agent despachável **aborta**. Corrige falhas observadas no GF07 (plano sem template, validator+slice em paralelo, fallback inline no Cursor).
- **v0.1.2** — Pipeline orientado a artefato. Adicionados: Fase 0 pré-flight (verifica invocabilidade, proíbe emulação inline), Gates duros G1–G6, scan de ambiguidade determinístico (mata o escape hatch "tenho certeza"), validador frio obrigatório como sub-agent, ledger verificado contra disco. `direct` explicitamente não produz `PLAN_*.md`.
- **v0.1.1** — `/workflow` slash command.
- **v0.1.0** — MVP (Claude skills).

## Próximas fases

- **v0.2** Cursor support
- **v0.3** Codex hardening
- **v1.0** Full feature parity em todas as ferramentas
