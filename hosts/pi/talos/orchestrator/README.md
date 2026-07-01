# Talos Orchestrator

Orquestra pipelines completos de desenvolvimento de features no projeto Talos, automatizando a sequência de skills (backlog macro → sprint file → PRD → planejamento → execução → validação fria → review) sob demanda.

## Quick Start

```bash
/talos full sprint "S05"
```

Pipeline completo executado automaticamente:
1. Resolve S05 no backlog e valida o sprint file vivo
2. Gera PRD a partir do sprint file
3. Valida PRD (inclui TC com `require_sprint_file:true`)
4. Executa entrevista se houver decisões em aberto
5. Cria plano com Eval/Policy por task
6. Executa plano e grava state com `eval_results`/`policy_scope`
7. Despacha validator frio
8. (Opcional) Executa review

## Sintaxe

```
/talos <mode> <input-type> [flags]
```

### Modes

- `full` — Pipeline completo (sprint file → PRD → plano → executor → validator → review opcional)
- `direct` — Pipeline enxuto (sprint file/PRD → executor → validator → review opcional)
- `interview-only` — Entrevista direta (brainstorm, resolução de decisões)

### Input Types

- `sprint` — Sprint ID (ex: S05) ancorado no backlog e em sprint file vivo
- `backlog-item` — alias legado de `sprint`
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
/talos full sprint "S05"
```

Output:
```
✅ Talos: claude full sprint completed

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
/talos direct prd "/path/to/PRD_S05.md" --review
```

### Direct pipeline com sprint S05

```
/talos direct sprint "S05"
```

### Entrevista de brainstorm

```
/talos interview-only brainstorm "Que tal dark mode?"
```

### Force entrevista mesmo sem ambiguidades

```
/talos full idea "melhorar performance" --interview
```

## Como funciona

### Full Mode

```
1. Parse input (resolve backlog/sprint file)
   ↓
2. Validate backlog index (`talos_verify_backlog_index`)
   ↓
3. Select next sprint (`talos_select_next_sprint`)
   ↓
4. Validate Sprint file (`talos_verify_sprint_file`)
   ↓
5. Generate PRD (`talos-sprint-prd-generator`)
   ↓
6. Validate PRD (G5 + TC `require_sprint_file:true`)
   ↓
7. Interview (automático se ambiguidades OU --interview)
   └─ Atualiza PRD com decisões coletadas
   ↓
8. Plan (`talos-plan-handoff`)
   ↓
9. Validate Plan (TC `require_sprint_file:true`)
   ↓
10. Execute obrigatório em `full` (`talos-plan-execute`, state com `eval_results`)
   ↓
11. Validator frio (`talos-task-validator`)
   ↓
12. Update sprint status (`talos_update_sprint_status`)
   ↓
13. Review (se --review)
   └─ `talos-slice-review`
   ↓
14. Output (resumo + próximos passos)
```

### Direct Mode

```
1. Parse/Generate PRD
   ↓
2. Validate PRD + Interview (condicional)
   ↓
3. Execute (`talos-direct-execute`, mantendo `phase: plan_execute`)
   ↓
4. Validator frio (`talos-task-validator`)
   ↓
5. Update sprint status (`talos_update_sprint_status`, quando houver backlog/sprint)
   ↓
6. Review (se --review)
   ↓
7. Output
```

### Interview-Only Mode

```
1. Cria draft mínimo pelo `PRD_TEMPLATE.md` quando a entrada é brainstorm
   ↓
2. Entrevista `talos-prd-interview` com `prd_path` válido
   ↓
3. Output (PRD esboço + decisões)
```

## Sequências canônicas

Talos é família única. Cliente (Claude Code, Cursor, Codex App) é apenas o host que executa as skills; não existe roteamento por família.

| Mode | Sequência |
|------|-----------|
| `full` | `talos-sprint-prd-generator` → `talos-prd-interview` quando necessário → `talos-plan-handoff` → `talos-plan-execute` → `talos-task-validator` → `talos-findings-repair` (no `fail`) → `talos-slice-review` somente com `--review` |
| `direct` | PRD/spec existente → `talos-direct-execute` → `talos-task-validator` → `talos-findings-repair` (no `fail`) → `talos-slice-review` somente com `--review` |
| `interview-only` | draft PRD mínimo (se brainstorm) → `talos-prd-interview` |

## Validação automática

Plugin detecta ambiguidades em:
- **Contexto e objetivo (§1):** TBD, "a confirmar", vago
- **Escopo (§2):** incompleto, "depende de"
- **Decisões (§3):** vazio ou muito vago
- **Fluxos e cenários UX (§4):** gaps, "a definir"
- **Contrato funcional e invariantes (§5):** "ainda não definido", "mock"

Se encontra ambiguidades → o orquestrador conduz `talos-prd-interview` automaticamente no fio principal.

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

1. Opcional: criar backlog mestre explicitamente com `$talos-backlog-generator`
2. Preenchimento de `PERGUNTAS_EM_ABERTO.md` (fora do plugin)
3. Resolver perguntas abertas fora do pipeline (se necessário)

Se você rodar `full`/`direct` com macro input (`idea`, briefing, roadmap ou conversa solta), o orquestrador prioriza `talos-backlog-generator` automaticamente quando o MCP retornar `routing.document_flow.priority = backlog_first`. O macro fica no `BACKLOG_MESTRE_*.md`; o MCP valida o índice com `talos_verify_backlog_index`, escolhe a execução com `talos_select_next_sprint` e sincroniza backlog+sprint file com `talos_update_sprint_status` após validator terminal.

### Ao rodar workflow

```
/talos full sprint "S05"
```

Plugin automatiza tudo. Você valida output.

### Depois de workflow

1. Validação de output do executor
2. (Opcional) Rodada de slice-review quando `--review` foi solicitado
3. Avança para S06

## Skills envolvidas

| Skill | Função |
|-------|--------|
| `talos-backlog-generator` | Cria backlog mestre a partir de ideia, prompt, conversa ou briefing; roda explicitamente ou como primeira fase documental em macro input `backlog_first` |
| `talos-sprint-prd-generator` | Gera PRD a partir de sprint/indicação |
| `talos-prd-interview` | Entrevista de PRD (resolve ambiguidades) |
| `talos-audit` | Audita target/boundary sem patch: lê regras locais, detecta stack, produz achados com `arquivo:linha`; com `--handoff`, grava `.talos/plans/PLAN_AUDIT_*.md` TC-conforme sem executar |
| `talos-plan-handoff` | Cria plano executável |
| `talos-plan-execute` | Executa plano (com `talos-task-validator` sub-agent) |
| `talos-findings-repair` | Corrige findings P0/P1/P2 após `fail` do validator dentro do boundary executado |
| `talos-task-validator` | Validador frio sibling; lê `state_path`, emite veredito estruturado e nunca corrige |
| `talos-slice-review` | Review fria de implementação quando `--review` está presente |

## Configuração

Plugin usa configuração embutida no MCP para modos, skills `talos-*` e validadores de ambiguidade. Defaults auxiliares continuam empacotados em `packages/orchestrator/defaults/` e referências em `packages/orchestrator/references/`.

## Error handling

- **Sprint não encontrado:** reporta sprints disponíveis
- **Skill falha:** para, reporta erro, oferece retry/skip/abort
- **PRD inválido:** reporta sections faltando
- **Ambiguidades não resolvidas:** pergunta próximos passos

## Dúvidas?

Veja este README, `packages/mcp-server/README.md` e os SKILL.md `talos-*` para o contrato operacional atual.

---

**Plugin version:** 0.12.1
**Author:** Paulo Borini
**Last updated:** 2026-07-01

### Novidades v0.12.1 — comando `/talos` canônico

- **Comando público corrigido** — o comando legado saiu da superfície distribuída; o comando canônico agora é `/talos <mode> ...`.
- **Bundles e hosts sincronizados** — `packages/orchestrator/commands/talos.md` foi propagado para Claude/Cursor, Codex, opencode, pi e zcode.
- **Docs e exemplos limpos** — README, `COMMANDS.md`, skill orquestradora, prompts Codex e snippets Raycast usam `/talos ...`; resíduos do método antigo ficam restritos a histórico ou GitHub Actions.
- **Distribuição sem npm registry** — publicação npm fica desativada; o caminho oficial é `npx github:pauloborini/talos` + GitHub Release.

### Novidades v0.12.0 — rebranding atlas-workflow → Talos

- **Rebranding completo** — `atlas-workflow` renomeado para **Talos**. Skills `atlas-*` → `talos-*`, CLI `atlas-init.mjs` → `talos-init.mjs`, plugin `atlas-workflow-orchestrator` → `talos`. 632 arquivos alterados.
- **Identidade própria** — Logo, README, marketplace e metadados refletem o nome definitivo. O pipeline é o mesmo; o nome mudou.
- **Compatibilidade com legado** — Instalador limpa automaticamente artefatos com prefixo `atlas-` de instalações antigas; `SKILL_PREFIXES` cobre `['talos-', 'atlas-']`.
- **Docs sincronizados** — `AGENTS.md`, `CLAUDE.md`, `NAMING.md`, `CHANGELOG.md` e todos os manifests atualizados. `marketplace.json` lista os 7 hosts.

### Novidades v0.11.1 — correção do instalador Antigravity (Gemini)

- **Instalação do Antigravity global completa** — O instalador unificado (`init antigravity`) agora copia a pasta `packages/` inteira recursivamente, incluindo as subpastas `skills` e `templates`, em vez de apenas a subpasta `mcp-server`.
- **Sem erros de inicialização** — Resolve o erro de módulo ausente (`document_quality.mjs`) que ocorria no setup global do Antigravity.
- **Drifts de versão resolvidos** — Ajustadas referências em READMEs e documentações operacionais para refletirem as versões de releases corretas.

### Novidades v0.11.0 — fallback de subagente para host ZCode

- **Workaround de Dispatch no ZCode** — O host ZCode tem uma limitação onde sub-agentes de plugin (`subagent_type: "talos-*"`) não herdam conexões MCP. Implementado o adapter `fallback` que despacha `general-purpose` (agente nativo, herda MCP) apontando para o MD do agente canônico como prompt do sistema.
- **Isolamento Sibling Preservado** — O validador frio irmão (Gate G4) permanece isolado e executado em subagente separado, mantendo os invariantes de arquitetura.

### Novidades v0.10.1 — alias `sprint` canônico e Raycast alinhado

- **`sprint` agora é o input público principal** para `/talos full` e `/talos direct`; `backlog-item` continua aceito só por compatibilidade.
- **Comandos e docs sincronizados** — README, `COMMANDS.md`, comandos do orquestrador, bundles dos hosts e snippets do Raycast foram atualizados para o novo contrato.
- **Sem mudança de runtime** — o fluxo continua determinístico e os gates de validação permanecem os mesmos; a mudança é de contrato de entrada e distribuição.

### Novidades v0.10.0 — backlog em 2 camadas + 4 gates MCP de sprint

- **Backlog em 2 camadas**: mestre enxuto (índice estratégico — fases, tabela de sprints, MoSCoW, dependências, links) + sprint files vivos (`sprints/SNN_<slug>.md`, 16 seções: DoR/DoD, `eval_manifest`, `policy_manifest`, §14 Execução e validação, §16 Histórico). Skills priorizam sprint file como fonte primária de contexto; backlog mestre só para deps/ordem macro.
- **`talos_verify_sprint_file`** — valida conformidade do arquivo vivo contra `SPRINT_TEMPLATE.md`: seções obrigatórias, link bidirecional ao backlog, DoR, eval_manifest. Fail-closed (ausente ou vazio = blocked).
- **`talos_verify_backlog_index`** — valida backlog mestre: §7 Registro de sprints, enums válidos (MoSCoW/prioridade/status), links para sprint files reais, sem duplicata de sprint ID, detecção de ciclo de dependência, status drift backlog↔sprint file = blocked.
- **`talos_select_next_sprint`** — seleção determinística: filtra `state=ready` + deps done + sprint file válido + DoR verde; ordena por MoSCoW→prioridade→ganho→esforço→ID. Resultado único, sem ambiguidade.
- **`talos_update_sprint_status`** — atualiza status atomicamente em backlog e sprint file: pré-condição (FSM de transições, `done` exige validator terminal + `state_path`), escrita com rollback P2 (se write do sprint file falhar após o backlog ser escrito, backlog é restaurado), pós-validação antes de `passed`.
- **`SPRINT_TEMPLATE.md`** canônico — template de 16 seções para sprint files vivos.
- **`BACKLOG_MESTRE_TEMPLATE.md` refatorado** — índice enxuto sem duplicar conteúdo de sprint.

### Novidades v0.9.4 — audit handoff TC-conforme + perfis de stack

- `/talos audit --handoff` passa a escrever `.talos/plans/PLAN_AUDIT_<slug>.md` **conforme ao `PLAN_TEMPLATE.md`** (cabeçalho com `| **PRD** | N/A — origem auditoria |`, ref a `BOUNDARY_PRD_PLAN.md`, §1–§6/§8, tasks `#### T01.`): passa no gate TC e é de fato consumível por `/talos execute plan`. Fecha a promessa quebrada da estrutura ad-hoc anterior, que falharia o gate.
- Perfis de stack ganham 6 linhas detectáveis — `go`, `rust`, `java_kotlin`, `firebase`, `supabase`, `rest_openapi` — no baseline universal e no validador frio, ativadas só por manifests/deps/comandos reais no boundary.
- `audit`/`interview-only` não declaram `guarantee_level` (não há execução a garantir); descrição do `talos_preflight` endurecida para refletir a impl.

### Novidades v0.8.4 — liveness do executor (Gate G12)

- `plan_execute` agora tem liveness explícito: `talos_lock_dispatch(start)` cria deadline de bootstrap e o executor precisa emitir checkpoints materiais.
- `talos-plan-execute` deve reportar `executor_started`, `skill_loaded`, `plan_loaded`, `handoff_accepted`, `task_started`, `first_write` e `state_path_created` conforme avança.
- Se o sub-agent não retornar/progredir antes do handoff, o orquestrador consulta `talos_lock_dispatch(status)`; bootstrap vencido vira `executor_bootstrap_timeout`, checkpoint antigo sem avanço vira `executor_progress_timeout`; ambos persistem `stalled`, liberam retry e não podem ser tratados como execução em andamento.
- Depois de `state_path_created`, o liveness fica `handoff_ready` e não expira por timeout de progresso enquanto aguarda o orquestrador abrir `talos_lock_validator(start)`.
- `talos_lock_validator(start)` só abre o validator depois de `state_path_created` para o mesmo `state_path`; checkpoint final sem arquivo legível é bloqueado.

### Novidades v0.8.2 — release/npm e procedimento de bump

- Pacote npm `talos` validado como instalador multi-host (`npm pack`, `npm exec` do tarball e `.npmignore` restritivo).
- CI de release publica npm com provenance e GitHub Release somente por tag `vX.Y.Z`, com guard de tag = `VERSION` = `package.json.version`.
- Procedimento de patch/bump documenta o fluxo completo para IA: classificar mudança, atualizar versões, regenerar catálogos, validar CI local, checar pacote npm, taguear e verificar publicação.

### Novidades v0.8.0 — proof-of-work do validador frio (Gate G4, R20)

- `talos_lock_validator(start)` emite um `challenge` (sha256 de um arquivo do boundary do `state_path`); o validador irmão lê via `validator_recovery.challenge`, computa o hash e devolve em `challenge_response`.
- `talos_lock_validator(complete)` recomputa o hash do disco e bloqueia (`challenge_failed`) em divergência/ausência, sem fechar o slot — re-despacho do mesmo validador. O re-dispatch é **bounded** por attempt: esgotado o teto, o slot fecha terminal (`challenge_exhausted`, fail-closed).
- O hash esperado nunca é persistido em estado legível (recomputado on-demand). Best-effort: boundary sem arquivo legível → sem enforcement; arquivo ausente no complete → `unverifiable`, não bloqueia.
- Escopo honesto: atestação **mecânica** de leitura do boundary, **não** prova de isolamento não-forjável. Schema `talos_capabilities` v5 intacto.

### Novidades v0.7.1 / v0.7.2 — confiabilidade

- `ping().capabilities` derivado de `toolsList()` (fonte única — fim do drift que omitia `talos_classify_input`); CI job `cross-os` (Windows/macOS); `.gitattributes` para artefatos gerados.
- `talos_run_state(upsert)` faz merge top-level (não derruba `dispatch.active`); `findActiveRunConflict` só bloqueia conflito de lock real; `talos_verify_artifact` aceita `artifact_kind`; Gate G4 endurecido (R17 falha de dispatch = `blocked`; R19 proveniência do `dispatch_token`).

### Novidades v0.7.0 — topologia sibling-only

- Validação fria é sempre sub-agent irmão em todos os hosts: o executor escreve `state_path` e encerra; o orquestrador despacha `talos-task-validator`. Gate JOIN no preflight, `dispatch_token` monotônico, máximo de 2 validators por contrato. `CAPABILITIES_SCHEMA_VERSION` v3 → v5 (BREAKING de contrato, sem mudança de comportamento).

### Novidades v0.6.2 — backlog mestre

- `talos-backlog-generator` cria backlog mestre a partir de ideia, prompt ou conversa quando acionado explicitamente ou como primeira fase documental em macro input `backlog_first`.
- O backlog padrão vai para `.talos/backlog/BACKLOG_MESTRE_<slug>.md` quando o usuário não informa path.
- `BACKLOG_MESTRE_TEMPLATE.md` inclui MoSCoW, esforço x ganho, dependências, riscos e próxima sprint executável.
- Em `full`/`direct`, macro input sem backlog canônico passa por backlog antes do PRD; `sprint`/`backlog-item`, PRD e plano existentes continuam começando no artefato já recortado.

### Novidades v0.6.1 — fronteira documental no orquestrador

- Fases documentais (`PRD`, entrevista, `PLAN_*.md`) são conduzidas no orquestrador; o primeiro sub-agent obrigatório do `full` nasce em `talos-plan-execute`.
- Os únicos sub-agents do pipeline são `talos-plan-execute`/`talos-direct-execute`, `talos-task-validator`, `talos-findings-repair` e `talos-slice-review`.
- A topologia é **sibling** em todos os hosts: o orquestrador coordena o validator irmão a partir do `state_path` retornado pelo executor e só reabre execução em `fail`. Host sem join síncrono é rejeitado no preflight (gate JOIN).
- `talos_preflight`/dispatchability distinguem skills documentais de skills executoras, evitando exigir sub-agent para entrevista/plano.

### Novidades v0.9.3 — ZCode como novo host (tier-1)

- **Novo host: ZCode** (Claude Agent SDK compat). Entrada `zcode` em `HOST_ADAPTERS` (`packages/mcp-server/server.js`) com perfil `self_evident` — `Agent(subagent_type)` + `TodoWrite` + MCP stdio + skills nativas, clone estrutural do Claude Code. Detector `ZCODE_PLUGIN_ROOT` em `HOST_DETECTORS`. `validator_dispatch.join.sync: 'self_evident'`, `confidence: 'presumed'`.
- ZCode reusa o agente canônico `agents/<name>.md` no plugin root (mesmo formato Claude); sem gerador próprio, sem custo de manutenção a cada nova skill/agent.
- Installer `init zcode` (cache-based, análogo ao `init antigravity`): copia catálogo `hosts/zcode/` para `~/.zcode/cli/plugins/cache/zcode-plugins-official/talos/<version>/`, atualiza o `marketplace.json` cache e habilita o plugin em `~/.zcode/cli/config.json` (`enabledPlugins`). **Sem dependências externas** (não exige `pi-mcp-adapter`/etc. — passa no preflight direto).
- Sete hosts suportados: `claude`, `codex`, `opencode`, `pi`, `antigravity`, `zcode`, `generic`. `CAPABILITIES_SCHEMA_VERSION` segue **v5** (adição aditiva, sem breaking). Smoke real no host ZCode confirma `host=zcode sv=5 join.sync=self_evident ping=alive version=0.9.3`.
