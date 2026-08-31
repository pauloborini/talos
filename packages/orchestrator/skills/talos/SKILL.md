---
name: talos
description: "Orquestra pipeline completo de desenvolvimento de features: /talos <mode> <input-type> [flags]. Automatiza backlog macro → sprint file (contrato §7) → entrevista (se necessário) → planejamento → execução → review (opcional) e oferece audit universal sem correção. Pipeline orientado a artefato com gates duros: cada fase só conta se produzir arquivo verificável em disco."
category: Development Automation
---

# Talos

Orquestra pipelines de desenvolvimento de features no projeto Talos, automatizando a sequência de skills sob demanda com um único comando.

> **MCP é fonte obrigatória de status.** Cada gate é consultado via MCP antes de avançar (tools por fase na Fase 0 e nos fluxos). Sem resposta MCP, sem resultado exigido ou status bloqueante → workflow abortado, sem fallback narrativo. Edge cases de ambiente (conflito plugin/nativo, MCP indisponível, estado corrompido, lock conflict, drift de versão) bloqueiam com causa, impacto e próxima ação segura.

## Sintaxe

```
/talos <mode> <input-type|target> [flags]
```

### Modos

Três modos **canônicos de execução** — `full`, `direct`, `execute` — mais os modos sem execução `interview-only` e `audit`.

- **`full`** — pipeline completo: backlog macro (se necessário) → sprint file com contrato §7 → validação/entrevista (se necessário) → **plano (artefato obrigatório)** → executor → review (opcional)
- **`direct`** — pipeline enxuto: backlog macro (se necessário) → sprint file com contrato §7 → validação/entrevista (se necessário) → `talos-direct-execute` → review (opcional). **Não produz plano de handoff** — a diferença real para `full` é exatamente essa.
- **`execute`** — recebe um **`PLAN_*.md` pronto** e o executa **sem gerar plano**. Entrada = caminho de plano; reverifica o artefato + conformidade de template e despacha `plan_execute` direto. Não regera nem replaneja: ajustes de plano pedem `full`. `talos_assert_after_plan` (gate pós-plano do `full`) **não se aplica** em `execute` — o plano já é o input; o equivalente é a reverificação na entrada. **Não há alias `plan`**: usar `plan` como modo é ambíguo com planejamento documental e deve ser rejeitado como modo inválido.
- **`interview-only`** — entrevista direta (ex: brainstorm, resolução de decisões). Entrevista **sem execução**: não usa `guarantee_level` no fluxo (não há execução de código a garantir). Permanece modo separado. Saída = sprint file standalone com contrato §7 (não PRD).
- **`audit`** — auditoria universal sem correção de código: lê target/boundary, regras locais e stack detectada; gera relatório de achados e, com `--handoff`, plano Talos-style para correção futura. **Não executa plano, não chama executor e não altera código.**

### Input Types

- **`sprint`** — Sprint ID (ex: S05) já ancorado no backlog e em sprint file vivo; alias canônico novo para `backlog-item`
- **`backlog-item`** — alias legado de `sprint`; manter por compatibilidade
- **`idea`** — Indicação/brainstorm curto, macro input ainda sem backlog canônico, ou spec/PRD-ish legado (tratado como idea — tipo `prd` removido)
- **`brainstorm`** — Texto livre (só para `interview-only`)
- **`plan`** — Path para `PLAN_*.md` pronto (só para `execute`, ou auto-roteado)
- **`target`** — Path/feature/módulo auditável (só para `audit`)

### Flags

- `--interview` — força entrevista do **contrato §7 do sprint file** mesmo sem ambiguidades detectadas
- `--review` — executa slice-review ao final (senão é opcional; sprints com `policy_manifest.critical_review.required: true` no §10 tornam a slice-review obrigatória mesmo sem a flag — G8)
- `--loop` — esteira serial de sprints com auto-correção (seção **"Modo loop"**): percorre as sprints `ready` em sequência (única pausa = entrevista), corrige residual de review in-loop (repair → verification), despacha sidecar de escalation se o residual persistir, estaciona sprint irrecuperável em `detached_repair` e drena `PENDENCIAS_<slug>.md` sob demanda; **implica review crítica (G8) sem editar `policy_manifest` por sprint** (D12); default sem a flag inalterado (CN7). Só com backlog.
- `--handoff` — em `audit`, escreve plano Talos-style em `.talos/plans/` derivado dos achados evidenciados; não executa
- `--scope <descrição>` — em `audit`, restringe o boundary lógico dentro do target
- `--help` — mostra sintaxe completa

## Exemplos

```
/talos full sprint "S05"
→ Resolve S05 no backlog, valida sprint file + contrato §7, entrevista se necessário, cria PLAN_*.md, executa a partir do plano

/talos direct sprint "S05"
→ Resolve S05 no backlog, valida sprint file + contrato §7, executa direto sem PLAN_*.md

/talos full idea "melhorar performance de listagem" --interview
→ Prioriza BACKLOG_MESTRE_*.md quando a entrada ainda é macro, cria/atualiza sprint file, seleciona a próxima sprint executável, força entrevista do contrato §7, plano, executor

/talos interview-only brainstorm "que tal dark mode?"
→ Cria sprint file standalone mínimo pelo SPRINT_TEMPLATE.md (§7 draft), valida o path e entrevista via talos-sprint-interview; aprova+sela; sem execução

/talos execute plan "/path/to/PLAN_S05_login.md"
→ Reverifica o plano (artifact + TC), executa direto via plan_execute + validador frio. Não gera plano.

/talos audit "apps/mobile/lib/features/auth" --handoff
→ Audita somente o target informado contra regras locais + stack detectada + Ponytail pass; gera relatório e `PLAN_AUDIT_*.md` sem execução.
```

---

## Fase 0 — Pré-flight obrigatório (antes de qualquer fase)

Executar **antes** de iniciar o pipeline. Se qualquer item falhar, **parar e reportar** — nunca emular.

1. **Parse** dos argumentos `<mode> <input-type|target> [input] [flags]`. Se inválido ou `--help` → mostrar sintaxe e parar. Em `audit`, o segundo argumento é `target`, não `input-type`.
2. **Chamar MCP `talos_ping`.** Se não responder, versão vier vazia, `version_check.status` vier bloqueado ou capacidades não listarem os gates exigidos pelo modo → abortar com erro de MCP indisponível/drift. Não seguir por prosa.
2a. **Chamar MCP `talos_capabilities`.** Ler `host`, `subagent_dispatch`, `validator_dispatch`, `capabilities_flags`, `required_deps` e `dispatch_capability`. Determinar a **disponibilidade real** dos pré-requisitos essenciais neste host: o subagente do plugin é despachável? o MCP está vivo (ping ok)? Em hosts com `required_deps` (ex.: pi: `pi-mcp-adapter` + `pi-subagents`), confirmar que cada dep está presente; se faltar, o pré-requisito correspondente é `false`. Para modos com execução (`full`, `direct`, `execute`), determinar também `host_capabilities.dispatch_mutable`: se `dispatch_capability:"mutable"`, não precisa reportar; se `dispatch_capability:"unknown"` (zcode/pi/generic/antigravity), reporte `dispatch_mutable:true` **somente** quando o sub-agent do host aceitar os agentes talos-* e tiver ferramentas mutáveis equivalentes a Write/Edit/Bash. Se não for verificável ou for read-only (ex.: schema restrito a `Explore`), não reporte `true`; deixe o `talos_preflight` bloquear no gate `DISPATCH`.
2b. **Chamar MCP `talos_classify_input`** no input informado (`input_path`), **antes de rotear**. `classify_input` é para **artefato em arquivo** (path em disco). A tool devolve `artifact_type` ∈ {`backlog`, `plan`, `idea`, `unknown`} (verdade forte = TC de plano passa) e um `banner` de roteamento já pronto. Spec/PRD-ish legado classifica como `idea`. **O tipo de input é fato e prevalece sobre o modo pedido** (intenção). Aplicar o roteamento:
   - **`plan` em `direct`/`full`** → auto-rotear para **`execute`** (executa o plano pronto; nunca gera plano de plano, mesmo com arquivo renomeado). **Não bloqueia**: ecoar o banner de troca `▸ talos: roteamento · pediu={x} mas input={y} → modo=execute`.
   - **`execute` sobre `backlog`/`idea`** → auto-rotear para **`full`** (ou `direct` conforme o pedido), pois não há plano a executar. **Não bloqueia**: ecoar o banner de troca correspondente.
   - **`idea` (`status: not_a_file`)** → o input é **descrição livre, não path**. **Não é `unknown` nem BLOCK**: roteia para **`direct`** (implementa a partir da descrição/spec). Quando o usuário passou uma idea inline (input-type `idea`), você pode até **não chamar** `classify_input` (ele é para arquivos) e seguir direto em `direct`/`full` conforme o pedido — nunca tratar a descrição como path ilegível.
   - **`unknown`** (arquivo existe mas não classifica) → **não adivinhar**: ecoar o banner de input ilegível e **pedir esclarecimento** ao usuário (qual arquivo/tipo). Não inventa modo.
   - Tipo coincide com o modo → segue sem troca (ecoar o banner `roteia` simples).
   O `banner` vem do MCP; o orquestrador **só ecoa** (ver "Protocolo de banner").
3. **Chamar MCP `talos_preflight`** com `run_id`, `<mode>`, `input_type`/`artifact_type` quando conhecidos, `host`, `expected_version` (quando o host reportar versão) e `host_capabilities` (a disponibilidade real apurada no passo 2a — ex.: `{"subagent_available":false}` se a dep do subagente faltar; `{"dispatch_mutable":true}` se um host `unknown` foi verificado como mutável). O resultado é a fonte obrigatória de pré-requisitos, modo, versão, lock, ids oficiais `talos-*` e `routing.document_flow`.
   - **Gate `PREREQ` (DEC-004): pré-requisito essencial ausente é hard-fail.** Se `gate:"PREREQ"`/`status:"blocked"`, **abortar em `ready`** (antes de qualquer fase/dispatch) com `missing_prerequisites`, causa, impacto e `next_action`. **Proibido degradar, rodar validator inline ou prosseguir sem isolamento, em qualquer tamanho de tarefa.** Só capability não-essencial (`todo`) segue sem o recurso.
   ```text
   ⛔ Pré-flight falhou (PREREQ)
      Host: <host>   Faltando: <missing_prerequisites>
      Motivo: host sem pré-requisito essencial de determinismo (subagente/MCP)
      Ação: <next_action> (ex.: instalar pi-mcp-adapter + pi-subagents; ou usar host com subagente+MCP nativos)
   ```
   - **Gate `DISPATCH` (DEC-008): subagente sem mutação verificada é hard-fail em execução.** Se `gate:"DISPATCH"`/`status:"blocked"`, **abortar em `ready`** com causa, impacto e `next_action`. Proibido executar código no fio principal para compensar sub-agent read-only. Modos read-only (`audit`, `interview-only`) não exigem `dispatch_mutable`.
   ```text
   ⛔ Pré-flight falhou (DISPATCH)
      Host: <host>   Dispatch: <dispatch_capability>
      Motivo: subagente sem Write/Edit/Bash verificado para execução
      Ação: <next_action>
   ```
3b. **Gate DEP — dependência de backlog (só `sprint`/`backlog-item`).** Se o item declara `Dependências` no backlog/registro de origem, ler o status de cada dependência **no mesmo backlog**. Se alguma não estiver `done` ou `manual_validation_pending` (D5: MVP satisfaz DEP), **abortar em `ready`** com `unmet_dependencies`, causa e `next_action` — determinístico, sem pergunta. Todas `done`/`manual_validation_pending` (ou sem dependências) → segue. Decisão em aberto **não** entra aqui (não é dependência de execução).
   ```text
   ⛔ Pré-flight falhou (DEP)
      Item: <id>   Dependência não satisfeita: <dep> (status: <status>)
      Motivo: dependência de backlog não está `done`/`manual_validation_pending`
      Ação: executar <dep> antes de <id>
   ```
3c. **Gate Backlog/Sprint — índice e recorte vivo obrigatórios (`full`/`direct` com `sprint`, `backlog-item` ou `backlog_first`).** Quando houver backlog, chamar `talos_verify_backlog_index`; para macro input, chamar também `talos_select_next_sprint` **com `mode` do pipeline atual** e usar somente o `selected` + `next_action` retornados pelo MCP. Resolver o `Sprint file` linkado/selecionado e chamar `talos_verify_sprint_file`. Se backlog inválido, seleção ausente, sprint file `pendente`, inexistente, divergente do Sprint ID, sem seções mínimas (`Metadados`, `Escopo`, `Definition of Ready`, `eval_manifest`, `policy_manifest`, contrato §7) ou com gate bloqueado/indisponível, **abortar antes do plano** com causa e `next_action`. **Após `passed`, o `next_action` é obrigatório e mode-aware:** `sprint_interview` → maturar §7; `plan_handoff` → redigir PLAN (só `full`/`execute`); `plan_execute` → despachar executor do modo (`plan_execute` em `full`/`execute`, `direct_execute` em `direct`). Proibido ignorar o verbo MCP ou inventar `gerar_prd`/PRD.
   ```text
   ⛔ Pré-flight falhou (SPRINT_FILE)
      Item: <id>   Sprint file: <path|pendente>
      Motivo: sprint file ausente/inválido; plano não nasce sem contrato §7
      Ação: criar/atualizar SPRINT_S<NN>_<slug>.md via SPRINT_TEMPLATE.md
   ```
4. **Usar a cadeia única `talos-*`.** Cliente (Claude Code, Cursor, Codex App, Antigravity, ZCode, OpenCode, Pi CLI) é host de execução, não família de skills. Não existe roteamento por cliente.
5. **Carregar defaults do pacote do plugin** (`defaults/paths.md` e `references/subagent_dispatch.md`). Não exigir config na raiz do repositório usuário.
6. **Verificar disponibilidade dos ids `talos-*`.** Para cada skill exigida pelo modo, confirmar que o id exato é **invocável** no host. Para as skills de **execução/validação/review** (`plan_execute`, `direct_execute`, `task_validator`, `findings_repair`, `slice_review`), confirmar também que são **despacháveis pelo verbo nativo do host** — leia `talos_capabilities.subagent_dispatch.mechanism` (não assuma "Agent tool"; no Codex é `spawn_agent(agent_type)`, no opencode `@<name>`, no pi `subagent({...})`, no ZCode e Claude é `Agent(subagent_type)`). No Codex, `$<skill>` é ativação in-context de skill e **não** conta como sub-agent isolado para execução. Para as skills **documentais/de leitura** (`sprint_interview`, `plan_handoff`, `audit`), basta invocabilidade no fio principal; não exigir despachabilidade como sub-agent.
   - **Skill ausente é bloqueio** (Gate G10): não substitua por skill nativa, variante antiga ou prompt inline.
   - **Conflito plugin × skill nativa:** use somente o id exato retornado pelo preflight. Se o host não permitir comprovar que a skill vem do plugin esperado, aborte e peça remoção/desativação manual da nativa; não resolva por tentativa silenciosa.
   - **Nunca substituir por variante de executor** (Gate G10).
   - Resolver como o sub-agent carregará o `SKILL.md` real do id antes de executar (ver `references/subagent_dispatch.md`).
   ```text
   ⛔ Pré-flight falhou
      Skill exigida ausente: <id exato>
      Motivo: id não despachável neste host
      Ação: instalar/ativar o plugin ou corrigir o pacote talos-* disponível no host
   ```
   **PROIBIDO o fallback "implementação direta" / "contratos equivalentes inline".** Não existe caminho onde o orquestrador faz plano ou código no próprio fio. Emulação inline e fallback direto são a falha-raiz que esta skill proíbe — se não há sub-agent, **para**. (Gate G7.)
8. **Rejeitar conflito de modo:** se o pedido tiver `full`/`direct` junto com "sem patch", "sem editar código", "planejamento apenas", "handoff only" ou equivalente, **pare antes de gerar artefatos**. `full` executa `talos-plan-execute`; `direct` executa `talos-direct-execute`; não existe interpretação plan-only implícita. Se o usuário quer diagnóstico sem patch, o modo correto é `audit`.
9. **Declarar o plano de execução** (1 bloco curto): `run_id`, modo, **ids exatos de cada sub-agent**, sequência de fases, artefatos esperados e tools MCP que sustentarão cada gate. Só então iniciar a Fase 1.

---

## Princípio de continuação automática (não-parada)

O pipeline é **fire-and-continue**: uma vez iniciado, o orquestrador avança fase a fase **sem pedir permissão ao usuário entre gates**. A única coisa que para o pipeline é um **gate duro retornando `blocked`** (PREREQ/DEP/G1–G11/TC via contrato MCP ou check determinístico) ou um **blockage de ambiente real** (MCP morto, sub-agent não despachável, lock conflict, artefato corrompido). Nada mais. Blockage é prerequisito ausente — **não** é "decisão em aberto", "ambiguidade de produto" nem "tenho dúvida": essas seguem o caminho de resolução e continuam.

**Proibido (regressão):**
- Pedir confirmação para avançar: "Quer que eu mature o contrato?", "posso seguir?", "continuo?", "devo despachar o executor?". A resposta é sempre sim — **execute**. Se a próxima fase tem artefato a produzir, produza.
- Inventar modo fora do contrato. **Não existe "Modo Discussão", "modo análise", "dry-run"** ou similar. Os únicos modos são `full`/`direct`/`execute`/`interview-only`/`audit`. Pedido em linguagem natural que nomeia um modo (ex.: "/talos full sprint S40") **executa esse modo** — não vira pergunta nem resumo passivo.
- Parar por decisão em aberto. Decisão pendente de **qualquer fonte** (scan de aceite, entrevista, `PERGUNTAS_EM_ABERTO.md`, doc de discussão/decisões como `DISCUSSAO_*.md`, ou o próprio backlog) **não é blockage**: garante sprint file com §7, dispara `talos-sprint-interview` sobre ele, propaga e **continua**. Nunca oferecer "responda só: seguir com recomendação ou D=...". Ver "Decisão em aberto ≠ parada".

**Contrato §7 incompleto em `full`/`direct`** = a fase de produto **matura o contrato no sprint file** (invoca `talos-sprint-interview` / autoria documental no fio principal). Nunca perguntar "quer que eu gere?".

**Backlog ausente em macro input (`routing.document_flow.priority = backlog_first`)** = antes do plano, invocar `talos-backlog-generator` no fio principal para criar/atualizar `BACKLOG_MESTRE_*.md` e `SPRINT_S<NN>_*.md`, validar artefatos em disco, chamar `talos_verify_backlog_index` e escolher a próxima sprint executável via `talos_select_next_sprint`. Em seguida, maturar o contrato §7 somente a partir do sprint file dessa sprint. Isto preserva o escopo pequeno de execução: macro fica no backlog mestre; sprint file fecha recorte vivo + contrato; plano/executor recebem apenas a sprint selecionada.

**Após entrevista**: reexecuta os gates afetados (`talos_verify_artifact`/`talos_verify_sprint_file`/`talos_scan_acceptance`/TC) e **retoma o pipeline (plano→execução) automaticamente**, sem nova confirmação.

A única interação legítima com o usuário é **dentro de uma fase** — o mecanismo estruturado `question_prompt` devolvido por `talos_capabilities`, usado pela entrevista para resolver ambiguidade de produto. Resolver ambiguidade ≠ pedir permissão pra avançar. Terminada a fase, respostas são persistidas no sprint file (§7), gates são reexecutados e o pipeline segue sozinho.


## Papel do orquestrador (fronteira de determinismo pela mutação de código)

O orquestrador **coordena a execução**, não implementa código — maestro que aponta cada sub-agent na ordem e espera terminar, **nunca pega o instrumento de código**. A fronteira de determinismo é a **mutação de código**, com **duas fases**:

- **ANTES do plano validado — autoria documental livre no fio principal.** Pode maturar contrato §7 no sprint file, entrevistar e escrever `PLAN_*.md` direto; fases documentais não exigem sub-agent (documento não muta o produto). **Ao aprovar o contrato §7, gravar `Contrato status: aprovado` + `Selo do contrato: sha256:<hash>`** — sem selo íntegro o sprint file não avança como contrato pronto.
- **DEPOIS do plano validado (`talos_verify_artifact` + TC `passed`) — mãos atadas fortes.** Não edita mais sprint/plano/código nem roda comando mutante; só coordena (despachar sub-agent, ler artefato pra verificar gate, ecoar banner, montar output).

Execução de código é **sempre** sub-agent executor do modo (`talos-plan-execute` em `full`/`execute`; `talos-direct-execute` em `direct`), mantendo `phase: plan_execute`, + validador frio `task_validator` (Gate G9/G7). Dispatch blocking: despacha → espera retorno → verifica gate → próxima fase. Nunca dois sub-agents simultâneos.

### Verbo de dispatch é host-agnóstico (não assuma "Agent tool")

O **mecanismo** varia por host — leia `subagent_dispatch.mechanism`, `.example` e `validator_dispatch` de `talos_capabilities` (fonte de verdade em runtime) e use o **verbo nativo**. Não hardcode o verbo do Claude. Mapeamento ilustrativo, onde `<exec>` é o id da fase (`plan-execute`/`direct-execute`/`slice-review`/`task-validator`):

- **claude:** `Agent(subagent_type: "talos-<exec>", prompt: ...)`
- **codex:** `spawn_agent(agent_type: "talos-<exec>", items: [{ type: "text", text: "<state_path ou task>" }])` (custom agent nativo em `CODEX_HOME/agents/talos-<exec>.toml`; `.codex/agents/` do bundle é gerado). `$talos-*` sozinho **não** isola contexto — use `spawn_agent`.
- **zcode:** `Agent(subagent_type: "talos-<exec>", prompt: "<state_path>")` (Claude Agent SDK — mesmo verbo de Claude, formato `agents/<name>.md` no plugin root; `ZCODE_PLUGIN_ROOT` injetado pelo host)
- **opencode:** `@talos-<exec>` (ou auto por description)
- **pi:** `subagent({ agent: "talos-<exec>", task, context: "fresh" })`
- **antigravity:** `define_subagent(name, system_prompt)` + `invoke_subagent(Subagents: [{TypeName, Role, Prompt, Workspace}])`
- **generic:** subagente nativo do host

> Ausência de "Agent tool" (host ≠ Claude) **não** é licença pra executar inline — é sinal pra usar o verbo daquele host (Gate G9, qualquer host). Host sem mecanismo de sub-agent já abortou em PREREQ; você nunca chega aqui sem isolamento.

### Fallback de subagente (limitação do host ZCode)

Se `talos_capabilities.subagent_dispatch.fallback.enabled === true` (hoje só no perfil **zcode**), despache usando o fallback em vez do verbo nominal — para **todos** os 5 dispatches (validator, findings-repair, slice-review, plan-execute, direct-execute):

- `subagent_type`: `fallback.subagent_type` (`"general-purpose"`)
- `prompt`: `fallback.prompt_template` com `<name>` substituído por `talos-<exec>` (ex.: `talos-task-validator`) e `<input>` substituído por `state_path` (validator/repair/review) ou `task` (executores).

**Por que existe:** o ZCode não propaga MCP para sub-agentes de plugin (mesmo com `mcp__...` no frontmatter `tools:`), mas propaga para o subagente nativo `general-purpose`. O fallback despacha `general-purpose`, que herda MCP + tools nativas; o contrato do subagente Talos vem do `agents/<name>.md` apontado pelo prompt (fonte única preservada).

**Gate G4/sibling preservado:** ainda é um subagente irmão isolado, despachado blocking, com `dispatch_token`/`challenge_response` ecoados do output. Mudou o `subagent_type` (nativo vs plugin), não a topologia. Os gates R17/R19/R20 continuam válidos: o token provém do output do irmão, não fabricado pelo orquestrador. `lock_validator(start→complete)` opera no mesmo ciclo de vida.

**Hosts sem o campo `fallback`** (claude/codex/opencode/pi/antigravity/generic) seguem o verbo nominal exato do mapeamento acima — zero mudança de comportamento.


## Protocolo de banner (única comunicação de progresso)

O orquestrador comunica progresso **apenas** por **banner de fase de linha única** no formato `▸ talos: <fase> · <ação> [· <detalhe>]`. Regras:

- **A string vem do MCP.** Cada gate de tool (`talos_preflight`, `talos_classify_input`, `talos_scan_acceptance`, `talos_verify_artifact`, `talos_verify_template_conformance`, `talos_lock_dispatch`, `talos_assert_after_plan`) devolve o campo `banner` pronto, derivado do banco canônico de templates no MCP. O orquestrador **só ECOA** essa string — sem reescrever, traduzir ou enfeitar.
- **Proibido narrar intenção entre gates.** Nada de "vou despachar o sub-agent...", "agora vou...", "deixa eu verificar...". Qualquer prosa de intenção entre fases é **regressão**. A sessão do usuário é uma sequência limpa de linhas `▸ talos: ...`.
- **Uma linha por transição**, em pt-BR, prefixada por `▸ talos:`. Os eventos do banco incluem: roteia, roteia c/ troca, preflight ok, preflight fail (`BLOCK`), aceite (`aceite_ok` / `aceite_lacunas`), entrevista, plano, exec, validação, review, done.
- Preflight bloqueado → ecoar o banner `preflight · BLOCK · <motivo>`; contrato com lacunas → banner `aceite · <n> lacunas`. O detalhe livre só entra no slot `<detalhe>` quando o template tem um.

> O banner **não substitui** os gates de execução: ele é a camada de comunicação. Gates duros (G1–G11, PREREQ, TC) continuam decidindo o fluxo por contrato MCP, não pela string.

## Gates duros (HARD GATES)

Regras inegociáveis. Violação = parar, não contornar.

| # | Gate | Aplica a |
|---|------|----------|
| G1 | **Artefato antes de avançar.** Uma fase só conta como concluída se `talos_verify_artifact` aprovar o arquivo produzido. Leitura local pode complementar, mas não substitui o resultado MCP. | todas |
| G2 | **Em `full`, proibido escrever qualquer código (Dart) antes de existir `PLAN_*.md` validado em disco.** Se for escrever código sem plano, o modo correto é `direct` — então pare e avise o usuário do mismatch. | `full` |
| G3 | **Skills invocadas de verdade — autoria documental no fio principal, execução de código em sub-agent.** **Fases documentais ANTES do plano validado** (maturar contrato §7, entrevistar, redigir `PLAN_*.md`) podem ser conduzidas pelo orquestrador (agente principal) carregando a skill correspondente; não exigem despacho de sub-agent (autoria não muta código). **Fases de execução de código** invocam a skill via **sub-agent despachado** (verbo nativo do host de `talos_capabilities` — não necessariamente "Agent tool"), que carrega o `SKILL.md` do id resolvido antes de agir — prompt "aja como X" não basta. Sempre proibido absorver o artefato "implicitamente": o artefato exigido pelo modo tem que existir em disco e passar G1/TC. | todas |
| G4 | **Validador frio é sempre sub-agent irmão (sibling), em todos os hosts.** O executor escreve `state_path` e para (retorna `validator_handoff_required`); o orquestrador abre o slot com `talos_lock_validator`, despacha `task_validator` como irmão isolado e só aceita output cujo `dispatch_token` corresponda ao `validator_recovery.expected_dispatch_token`. Em caso de `fail`, roda `repair_start`, passa ao **`talos-findings-repair`** o pacote `{state_path, findings, validator_attempt, repair_run_id, repair_budget: 1}`, exige atualização do mesmo `state_path`, fecha o repair e executa o **2º e último** validator. `validator_run_id`, `dispatch_token` e `repair_run_id` são obrigatórios para fechar slots ativos. O executor nunca valida o próprio trabalho nem despacha o validador no mesmo contexto. **A topologia é sempre sibling** — host sem join síncrono é rejeitado no preflight (gate JOIN). **Recovery de orquestrador re-spun:** antes de aceitar qualquer retorno, ler `talos_run_state(get)` e usar `validator_recovery` para reconhecer o slot ativo; retornos divergentes voltam `stale_discarded: true` e devem ser descartados. **Falha de dispatch do validador em runtime = `blocked`, nunca inline (R17).** Se o despacho do `task_validator` (verbo nativo do host) **errar ou não retornar** — Agent/spawn/subagent que falha, host sem sub-agent disponível em runtime — a slice **bloqueia** com causa e `next_action`; é **proibido** validar inline, no contexto do orquestrador, ou relatar um veredito que o irmão frio não produziu. Não existe caminho de degradação: dispatch quebrado fecha a fase, não a contorna. **Proveniência do `dispatch_token` (R19):** o token submetido no `lock_validator(complete)` tem que ser o que **o próprio validador irmão devolveu no output dele** — não um valor que o orquestrador leu de `validator_recovery` e repassou sem o irmão ter rodado. O `validator_recovery` serve para *reconhecer/descartar* retornos stale, não para *fabricar* o token de um validador que não executou. **Proof-of-work (R20):** quando `lock_validator(start)` emite um `challenge` (sha256 de um arquivo do boundary), o `complete` exige `challenge_response` — também vindo **do output do validador irmão**, jamais preenchido pelo orquestrador. O MCP recomputa o hash do disco; divergência/ausência → `challenge_failed` (`blocked`), slot preservado, re-despachar o mesmo validador. Re-dispatch é **bounded**: após o teto de falhas por attempt o slot fecha terminal (`challenge_exhausted`, fail-closed) em vez de loopar. É atestação mecânica de leitura do boundary, **não** prova de isolamento não-forjável (MCP fala stdio com um único caller) — fecha o atalho preguiçoso de afirmar veredito sem ler código. | execução |
| G5 | **Scan de ambiguidade determinístico e logado.** A decisão de pular a entrevista só é válida se `talos_scan_acceptance` retornar **zero** padrões e esse resultado MCP estiver no ledger. Não existe "pular porque tenho certeza". `--interview` sempre força. | validação contrato §7 |
| TC | **Conformidade de template via MCP.** PLAN só avança como artefato documental se `talos_verify_template_conformance` retornar `passed` e `pending_count: 0` (`artifact_type=plan`). Em `full`/`direct` com sprint file, chamar com `require_sprint_file:true`. Pendência bloqueia com `next_action`. | plano |
| G6 | **Status verificado, não auto-reportado.** O ✅ de cada item no output só pode ser marcado após confirmar o artefato em disco. Faltou artefato exigido pelo modo → status final `incomplete`, nunca `completed`. | output |
| G7 | **Execução de código roda SEMPRE como sub-agent despachado (verbo nativo do host, lido de `talos_capabilities`), nunca no contexto do orquestrador.** A **autoria** do `PLAN_*.md` pode ser feita pelo orquestrador no fio principal **enquanto o plano não foi validado** (autoria documental) — mas o plano só vira confiável após `talos_verify_artifact` + TC `passed`. A **execução do plano** (`plan_execute`) e qualquer mutação de código vão obrigatoriamente a sub-agent. Antes de iniciar/concluir fase de execução, usar `talos_lock_dispatch`; fase fora de ordem ou paralela bloqueia. Depois do plano validado, o orquestrador não edita mais o plano (mãos atadas fortes). | plano + execução |
| G12 | **Executor vivo precisa provar progresso.** Ao iniciar `plan_execute`, `talos_lock_dispatch(start)` cria liveness de bootstrap/progresso (com `base_sha = git rev-parse HEAD`). O checkpoint público do executor é **apenas** `first_write` (`talos_lock_dispatch(checkpoint, phase=plan_execute, event=first_write)`), emitido imediatamente antes da primeira mutação — o MCP bloqueia qualquer outro event de executor (conjunto público enxuto). O handoff é comprovado pelo commit: `talos_commit_state` projeta o state v3, grava a slice, põe `liveness.status=handoff_ready` com `slice_commit_sha256` no ledger e devolve `state_path` + `state_sha256`. `talos_lock_validator(start)` só abre se o sha do disco for o do último commit MCP daquele `state_path` (órfão/dual-writer bloqueado). Se o sub-agent não retornar, travar, ficar sem `first_write` **e** sem commit até o bootstrap (120s), ou ficar com checkpoint antigo sem avanço antes do handoff, o orquestrador chama `talos_lock_dispatch(action=status, phase=plan_execute)`: `executor_bootstrap_timeout`/`executor_progress_timeout` viram `stalled`, o lock é liberado para `retry_plan_execute`, e a execução não pode ser declarada completa. Slice no-op que só commita em até 120s **não** é stalled. Sem gesto (`first_write` ou commit) antes do handoff não há "em andamento" confiável. | execução |
| G8 | **Ordem fixa de validação: `task-validator` ANTES, `slice-review` POR ÚLTIMO. Nunca em paralelo.** Conclusão de `plan_execute` usa `talos_lock_dispatch` com `validator_status: passed`; review só inicia após execução concluída. **Review crítica (D06/D09):** quando `policy_manifest.critical_review.required: true` no §10 do sprint file, `talos-slice-review` é **obrigatória** (não depende de `--review`); com `--loop` roda sempre (D12 — sem editar `policy_manifest` por sprint; o MCP recusa o fechamento sem gate `slice_review` `passed` no ledger). Em ambos os casos: após veredito terminal do `task-validator` e **antes de `talos_update_sprint_status`** — sem review verde não há `done` nem `manual_validation_pending`. **Residual da review — auto-correção (D3/D4/D17):** P0/P1 na review → `talos_lock_validator(action=repair_start, origin=slice_review)` (budget 1 por provenance) → `talos-findings-repair` → verification pontual (delta do `repair_evidence`; executa os checks declarados antes de julgar) → ecoar o veredito por finding com `talos_lock_validator(action=repair_complete, data.verification)`; residual P0/P1 persistente (`not_resolved`/`regression`) → `repair_start(origin=escalation)` → sidecar `talos-escalation-repair` despachado serial → verification sobre o delta do sidecar → residual persiste ⇒ `talos_update_sprint_status(status=detached_repair)` em `--loop` / `blocked` com causa fora dele. **Nunca** 2º `task-validator` nem nova review completa no ramo da review — o ramo do validator (G4) mantém o **2º e último** validator. Proibido inferir `reasons` por prosa/diff — reasons são declarados no §10 (enum fixo) e `talos_verify_sprint_file` rejeita valor fora do enum. | validação + review |
| PREREQ | **Pré-requisitos de determinismo (hard-fail, DEC-004).** `talos_preflight` verifica, **antes de tudo**, se o host tem subagente + MCP (essenciais). Ausente (ex.: pi sem `pi-mcp-adapter`/`pi-subagents`, host MCP-only sem subagente) → aborta em `ready` com `missing_prerequisites`/`next_action`. Sem degradação, sem validator inline, qualquer tamanho. `todo` não-essencial segue sem mirror. | roteamento |
| DEP | **Dependência de backlog não satisfeita = hard-fail determinístico.** Se o input é `sprint`/`backlog-item` e o item declara `Dependências` (ex.: S40 dep S39) cujo status, lido no mesmo backlog/registro de onde o item veio, **não** é `done`/`manual_validation_pending` (D5), abortar em `ready` com `unmet_dependencies`, causa e `next_action` (executar a dependência primeiro). Sem improviso e sem pergunta: ou a dep está `done`/`manual_validation_pending` e segue, ou bloqueia com causa. Não confundir com decisão em aberto (que não bloqueia). | roteamento (`sprint`/`backlog-item`) |
| BACKLOG_INDEX | **Backlog mestre é índice verificável.** Em `backlog_first` e `sprint`/`backlog-item`, chamar `talos_verify_backlog_index` antes de escolher sprint ou avançar ao contrato. Link ausente, sprint file ilegível, dep interna inválida/cíclica ou status drift bloqueia. | roteamento |
| SELECT_NEXT_SPRINT | **Próxima sprint + verbo vêm do MCP.** Em `backlog_first`, chamar `talos_select_next_sprint` com `mode` do pipeline; sem `selected` não há avanço. A seleção exige `state=ready`, deps internas `done`/`manual_validation_pending`, sprint file válido e DoR verde. Em `passed`, **obrigatório** seguir `next_action` ∈ {`sprint_interview`,`plan_handoff`,`plan_execute`} (mode-aware: `direct` nunca sugere `plan_handoff`; §7 draft → interview). | roteamento |
| SPRINT_STATUS_SYNC | **Fechamento de sprint é gate MCP, não prosa.** Em sprints com `policy_manifest.critical_review.required: true`, este gate só pode ser chamado após `talos-slice-review` verde (G8) — sem review crítica não há `done`/`manual_validation_pending`. Quando a execução validada pertence a backlog/sprint file, chamar `talos_update_sprint_status`: `done` exige `state_path` + `validator_verdict=pass|pass_with_observations` + acceptance_results sem M/unproved/violated; `manual_validation_pending` quando o state deixa M pendente (≥1 AC `manual_pending`, sem unproved/violated) — o MCP **não** emite handoff nem devolve `handoff_path` nesse status (`next_action=aguardar_validacao_manual`; sem promote); `blocked` registra `fail`. O MCP sincroniza BACKLOG_MESTRE + SPRINT_SNN e bloqueia reabrir `done` sem autorização explícita. Quando `done` com veredito terminal, o MCP emite `HANDOFF_*.md` e retorna `handoff_path` — ecoar no ledger. **Validação manual (M):** com `next_action=aguardar_validacao_manual`, criar/atualizar `.talos/manual-validation/<backlog-slug>.md` a partir de `MANUAL_VALIDATION_REPORT_TEMPLATE.md` (somente pendências abertas; IDs `MV-<sprint>-<ac>`); o humano marca `validated`/`waived`/`failed` e o orquestrador chama `talos_sync_manual_validation` (lock por backlog). Sync `blocked` com `next_action=fix_manual_validation_report` → corrigir o relatório e re-sincronizar — nunca contornar o gate; sync `passed` com `handoff_path` → `promover_handoff`; `failed` → origem `blocked` (`corrigir_smoke_falho`; cone de revalidação no Plano 5). **Rastreabilidade v1 (opt-in):** sprint com metadado `Traceability: v1` tem gates de fechamento próprios no MCP — `done` exige também o gate de rastreabilidade (`talos_update_sprint_status` recusa REQ `included` com qualquer AC ligado não `proved`); o receipt de cobertura é o payload da action `talos_traceability(action=receipt)` (projeção do MCP sobre ledger + `acceptance_results` do state v3) — **ecoar o JSON devolvido, sem recalcular cobertura nem aceitar claim próprio**. **Registro do par v1:** a marca tem dois lados — ao finalizar/marcar a sprint como `v1`, registrar no MESMO momento os REQs e a marca irmã no ledger via `talos_traceability(action=upsert)` (`reqs[]` com `sources[{kind,ref}]`/disposition/targets e `sprint:{sprint_id, schema:"traceability_v1"}`); sprint marcada sem ledger (ou vice-versa) bloqueia conformance, `verify` e fechamento com `alinhar_marcadores_traceability`. Após a execução, medir calls/retries/turns reais do fluxo e registrar via `action=record_metric` antes do done — sem registro não há base de economia para reportar. | pós-validação |
| SPRINT_FILE | **Sprint file vivo obrigatório antes do plano.** Em `full`/`direct` com `sprint`, `backlog-item` ou `backlog_first`, resolver o sprint file via backlog/saída do backlog-generator e validar com `talos_verify_sprint_file`. Ausente/inválido/divergente/gate indisponível bloqueia antes do plano. `audit --handoff`, `execute plan` e `interview-only brainstorm` ficam fora deste gate. | roteamento/produto |
| G10 | **Família única talos-*, id exato.** Modo, versão, lock e ids oficiais vêm de `talos_preflight`, nunca do host. Skill ausente, conflito de origem, lock ativo ou drift de versão → aborta com causa/impacto/próxima ação. | roteamento |
| G9 | **Fronteira de determinismo pela mutação de código.** O orquestrador **NUNCA** escreve/edita **código** nem roda comando mutante (flutter/test/git write), em qualquer fase ou modo — execução de código é sempre do sub-agent. **Autoria documental** (contrato §7, entrevista, `PLAN_*.md`) é permitida no fio principal **somente ANTES do plano validado**; uma vez que o plano passa `talos_verify_artifact` + TC, **mãos atadas fortes**: o orquestrador não edita mais sprint/plano/código, só coordena execução (despachar sub-agent, ler artefato para verificar gate, ecoar banner, montar output final). **NÃO** "ajuda" o sub-agent de execução. **Dispatch é blocking**: despacha **um** sub-agent por vez (verbo nativo do host de `talos_capabilities`, em foreground), **espera o retorno**, só então segue. Proibido `run_in_background` para fases do pipeline e proibido implementar "em paralelo" enquanto um sub-agent roda. Se o orquestrador tocar em **código** = G9 violado, **inclusive rodar a mutação inline porque o host não tem "Agent tool"** (use o verbo daquele host). | orquestrador |
| G11 | **`full` deve executar depois do plano.** Depois que `PLAN_*.md` passa G1/G2/G7/TC, chamar `talos_assert_after_plan`; a próxima ação obrigatória é despachar `plan_execute` como sub-agent blocking. Proibido completed só com handoff. | `full` |

---

## Fluxo de execução

### [EXEC] — passo comum de execução + validação

`talos_lock_dispatch(action=start, phase=plan_execute)` em todos os modos (grava `base_sha=HEAD` + liveness no ledger); despachar como sub-agent blocking o `routing.executor_skill` devolvido pelo preflight: `talos-plan-execute` em `full`/`execute`, `talos-direct-execute` em `direct`. O executor emite o checkpoint G12 `first_write` (apenas se mutar) e devolve o julgamento via `talos_commit_state`; antes do handoff, sem retorno/progresso exige `talos_lock_dispatch(action=status, phase=plan_execute)` e `executor_bootstrap_timeout`/`executor_progress_timeout` viram `stalled`/retry — nunca execução em andamento. O executor retorna `validator_handoff_required` com `state_path` **do retorno do commit**; o MCP só abre o slot se o sha do disco for o do último commit MCP daquele path (`liveness.slice_commit_sha256`), põe `handoff_ready` e não expira por timeout enquanto aguarda validator. Validação sempre **sibling**: `talos_lock_validator(action=start)`, despachar **um** `task_validator`, exigir no output o `dispatch_token` do slot e fechar com `validator_run_id` + `dispatch_token`. Se o output do validator for persistido em arquivo (`validator-output.json` ou equivalente), passar `validator_output_path` no `talos_lock_validator(action=complete)` ou validar o arquivo com `talos_verify_artifact(artifact_kind=json)` antes de declarar closure; JSON inválido bloqueia. Em `fail`: `repair_start`, despachar `talos-findings-repair` com `{state_path, findings, validator_attempt, repair_run_id, repair_budget: 1}`, exigir o commit de repair via `talos_commit_state` com `repair[]` no mesmo `state_path`, fechar com `repair_run_id` e rodar o **2º e último** validator. `passed`/`passed_with_observations` são terminais aprovados. **Review crítica (CN5/D06) e cadeia de fechamento (D3/D4/D13):** se o sprint file declara `policy_manifest.critical_review.required: true` — ou `--review`/`--loop` aciona —, despachar `talos-slice-review` como sub-agent **obrigatório** após o veredito terminal do validator e **antes** de qualquer `talos_update_sprint_status`. Ao fechar a fase, gravar o gate de review no ledger (gesto do orquestrador): `talos_run_state(action=get)` → montar `data.gates` **completo** (spread das gates existentes + `slice_review: {status: 'passed', timestamp}`) → `talos_run_state(action=upsert, data:{gates})` — o upsert é merge **top-level** no MCP: `gates` parcial apaga chaves irmãs (`G7`/`G8`); o gate de `--loop` do MCP lê `data.gates.slice_review.status`. **Residual — a mesma cadeia em loop e standalone (D13, sem condicional de `--loop`):** P0/P1 na review → `talos_lock_validator(action=repair_start, origin=slice_review)` (budget 1 por provenance — D17) → `talos-findings-repair` → verification (delta; executa os checks declarados antes de julgar) → ecoar o veredito com `talos_lock_validator(action=repair_complete, data.verification)`; residual P0/P1 persistente (`not_resolved`/`regression`) → `repair_start(origin=escalation)` → sidecar `talos-escalation-repair` (serial, blocking, sem self-validation) → verification sobre o delta do sidecar → residual persiste ⇒ `talos_update_sprint_status(status=detached_repair)` em `--loop` ou `blocked` com causa fora do loop — nunca retry do sidecar no mesmo ciclo (budget MCP por provenance). **Nunca** 2º `task-validator` nem nova review completa no ramo da review (o ramo do validator G4 mantém o **2º e último** validator). Residual P2/P3 → `talos_pendencies(action=append, {sprint_id, severity, files, recommendation, fix_validation})` — writer exclusivo do MCP. Sem review verde, não chamar `talos_update_sprint_status` para `done`/`manual_validation_pending`. Se a execução tem `backlog_path` + `sprint_id`, chamar `talos_update_sprint_status` após o veredito terminal: `done` com `state_path`, `validator_verdict`, `plan_path` — só quando os `acceptance_results` do state estão todos `proved` (sem M); `manual_validation_pending` quando o state deixa M pendente (≥1 AC `manual_pending`) — sem `handoff_path`, sem `$talos-memory-promote`; `blocked` se o veredito final for `fail`. Sem esse gate `passed`, não declarar sprint concluída nem avançar seleção. Status diferente bloqueia review e output completed. Em `manual_validation_pending`, criar o relatório `.talos/manual-validation/<backlog-slug>.md` (só M abertos); o fechamento humano passa por `talos_sync_manual_validation`: todos `validated`/`waived` → `done` com `HANDOFF_*`; algum `failed` → origem `blocked`; relatório inválido/dirty → `blocked` com `next_action=fix_manual_validation_report` (corrigir no gate e re-sincronizar, sem contorno).

### Full mode

Artefatos esperados (em ordem): `BACKLOG_MESTRE_*.md` (se macro) → `SPRINT_S<NN>_*.md` (contrato §7 aprovado+selo) → (`SPRINT_*.md` atualizado) → `PLAN_*.md` → diff de código → relatório do validador.

1. **Parse input** — resolve `sprint`/`backlog-item`/`idea` para contexto de sprint.
1a. **Backlog first (condicional)** — se `routing.document_flow.priority = backlog_first`, invocar `talos-backlog-generator`, produzir/atualizar `BACKLOG_MESTRE_*.md` + sprint file(s), chamar `talos_verify_artifact`, `talos_verify_backlog_index`, `talos_select_next_sprint(mode=full)` e `talos_verify_sprint_file`. Extrair `sprint_id` + `sprint_file_path` de `selected` e **ramificar pela `next_action`**: `sprint_interview` → passo 3; `plan_handoff` → passo 4; `plan_execute` → passo 6 (se PLAN já existe). Não avançar ao plano direto do macro input.
1b. **Sprint file (obrigatório)** — para `sprint`/`backlog-item`, resolver/validar o sprint file antes do plano. Se ausente/inválido, bloquear com `SPRINT_FILE`.
2. **Contrato §7 (produto)** — garantir contrato de produto no sprint file (D*, cenários UX, aceite atômico `AC-*`). Chamar `talos_verify_sprint_file` e `talos_scan_acceptance`.
3. **Interview (condicional)** — se `talos_scan_acceptance` retornar bloqueante, sprint file bloquear ou `--interview` → invocar o id resolvido para `sprint_interview` (`talos-sprint-interview`), depois reexecutar `talos_verify_sprint_file`, `talos_scan_acceptance` e selo (aprovação).
4. **Plan** — `talos_lock_dispatch(action=start, phase=plan_handoff)`, carregar/invocar `plan_handoff` no fio principal para redigir `PLAN_*.md` a partir do contrato §7 + sprint file + código real, depois chamar `talos_verify_artifact` e `talos_verify_template_conformance(artifact_type=plan, require_sprint_file=true)`. Concluir a fase com `talos_lock_dispatch(action=complete, phase=plan_handoff)`. **Nenhuma linha de código pode ter sido escrita até aqui.**
   - **G11:** se `PLAN_*.md` foi validado, chamar `talos_assert_after_plan`. Se a próxima ação não for `dispatch_plan_execute_blocking`, abortar.
5. **Validate plan** — se há gaps → dispara entrevista, propaga e continua (ver "Decisão em aberto ≠ parada"). Não para pra pedir permissão.
6. **Execute** — rodar o passo **[EXEC]** (lê `PLAN_*.md`).
7. **Review (obrigatória sob policy; condicional senão)** — após execução concluída: se o sprint file declara `policy_manifest.critical_review.required: true`, `talos-slice-review` é obrigatória mesmo sem `--review` (G8 — antes de `talos_update_sprint_status`); senão, somente se `--review`. Em ambos: `talos_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `talos_lock_dispatch(action=complete, phase=slice_review)`.
8. **Output** — ledger verificado com fonte MCP por gate/fase, incluindo `talos_update_sprint_status` quando houver sprint/backlog, + próximos passos. Quando `talos_update_sprint_status(done)` retornar `handoff_path`, incluir `Próximo: $talos-memory-promote <handoff_path>` no ledger final (skill S04 — não despachar nesta sprint). Em `manual_validation_pending` o MCP **não** retorna `handoff_path`: registrar `Próximo: validar manualmente (MV-*)` — criar `.talos/manual-validation/<backlog-slug>.md` (somente M abertos) e **não** incluir `$talos-memory-promote` no ledger. Após o humano resolver os `MV-*`, chamar `talos_sync_manual_validation`: `passed` + `handoff_path` → `Próximo: $talos-memory-promote <handoff_path>`; `passed` sem handoff e `next_action=corrigir_smoke_falho` → origem `blocked`, registrar revalidação pendente; `blocked` com `next_action=fix_manual_validation_report` → corrigir o relatório no gate (waiver sem justificativa, item fantasma, status inválido) e re-sincronizar — nunca declarar `done` sem sync `passed`.

### Direct mode

Artefatos esperados: `SPRINT_S<NN>_*.md` (contrato §7) → (atualizado) → diff de código → relatório do validador. **Sem `PLAN_*.md`** — por design.

1. Parse / Backlog first (condicional) / Sprint file / Contrato §7 (se necessário) + `talos_verify_sprint_file`. Se `routing.document_flow.priority = backlog_first`, gerar/atualizar `BACKLOG_MESTRE_*.md` + sprint file antes, chamar `talos_select_next_sprint(mode=direct)` e recortar a execução para `selected`. **Seguir `next_action`:** `sprint_interview` → entrevista §7; `plan_execute` → passo Execute (nunca `plan_handoff` em `direct`). Contrato nasce/matura no sprint file, não no backlog macro.
2. Validate aceite → `talos_scan_acceptance` + `talos_verify_sprint_file`; entrevista condicional reexecuta os gates.
3. **Execute** — rodar o passo **[EXEC]** (executor lê o sprint file / contrato §7; sem `PLAN_*.md`).
4. Review (obrigatória sob policy; condicional senão) — só após executor retornar 100% e dispatch MCP permitir; `policy_manifest.critical_review.required: true` no sprint file torna a slice-review obrigatória mesmo sem `--review` (G8).
5. Output (ledger verificado).

> Se durante `direct` o escopo exigir um plano de handoff formal, **avise o usuário** e sugira `full` — não fabrique um `PLAN_*.md` ad hoc no meio de `direct`.

### Execute mode

Entrada: um **`PLAN_*.md` pronto**. Artefatos esperados: (plano já existe) → diff de código → relatório do validador. **Não produz `PLAN_*.md`**. `talos_assert_after_plan` **não se aplica**.

1. **Parse / classify** — `talos_ping` → `talos_capabilities` → **`talos_classify_input`** no input → **`talos_preflight(<modo efetivo>)`** (PREREQ hard-fail intacto). A classificação determina o tipo: se for plano, o modo efetivo é `execute` e o preflight trava `execute`; se o input não for plano, auto-rotear (ver Fase 0, passo 2b) e o preflight trava o modo roteado. **`classify_input` sempre precede `preflight`** (o preflight trava o modo efetivo, não o pedido).
2. **Reverificar o plano na entrada** — `talos_verify_artifact` no `PLAN_*.md` (G1) + `talos_verify_template_conformance(artifact_type=plan)` (TC). Plano velho/manual/inválido **trava aqui** com `next_action` em linguagem de produto ("autoria é livre, execução é gateada"). Sem reverificação válida não há dispatch.
3. **Executar** — rodar o passo **[EXEC]** (lê `PLAN_*.md`). `plan_execute` é aceito como **primeira fase** em `execute` (sem fase nova).
4. **Review (obrigatória sob policy; condicional senão)** — após execução concluída: se o sprint file declara `policy_manifest.critical_review.required: true`, `talos-slice-review` é obrigatória mesmo sem `--review` (G8 — antes de `talos_update_sprint_status`); senão, somente se `--review`. Em ambos: `talos_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `complete`.
5. **Output** — ledger verificado; `guarantee_level` = `full_pipeline`.

> `execute` **não replaneja**. Se o plano estiver incompleto/errado, o caminho é `full` (gerar plano novo), não consertar o plano dentro de `execute`.

### Interview-only mode

1. Se a entrada já for sprint file válido com §7, usar seu path. Se for `brainstorm`, criar primeiro um draft mínimo em disco com `packages/templates/SPRINT_TEMPLATE.md`: `Backlog mestre: Não aplicável (standalone)`, §7 em draft (D* / cenários UX / aceite), registrando o brainstorm em objetivo/contexto. Nunca criar PRD draft.
2. Verificar o draft com `talos_verify_artifact` e `talos_verify_sprint_file` (sem exigir backlog real — standalone); path ausente/inválido bloqueia.
3. Invocar `talos-sprint-interview` no fio principal com `sprint_file_path` válido; persistir respostas na §7 do mesmo artefato; ao aprovar, gravar selo sha256; reverificar.

> `interview-only` é entrevista **sem execução**: não há fase `plan_execute` nem `guarantee_level` no fluxo (nada de código a garantir). A autoria do esboço é documental e livre.

> **Próximo passo após sprint standalone maturo:** `interview-only` não planeja nem executa. Para implementar, o usuário invoca `talos-plan-handoff` standalone sobre esse sprint file (fora do pipeline `full`/`direct`, que exigem sprint de backlog — ver `talos-plan-handoff` §"Fontes obrigatórias"), produzindo um `PLAN_*.md` com `Source mode: standalone`, e então roda `/talos execute plan "<path>"` para executar. `full`/`direct` rejeitam standalone sem backlog na entrada por design.

### Audit mode

Entrada: um `target` auditável, com flags opcionais `--handoff` e `--scope <descrição>`. Artefatos esperados: relatório de auditoria em resposta; se `--handoff`, plano Talos-style salvo em `.talos/plans/PLAN_AUDIT_<slug>.md`. **Não há execução, `plan_execute`, validator, repair, review nem `guarantee_level`.**

1. **Parse / target** — resolver target real em disco. Se o target não for localizável, parar com pedido objetivo de path/boundary.
2. **Pré-flight leve** — `talos_ping` → `talos_capabilities` → `talos_preflight(mode=audit)` para travar versão/família `talos-*`. Não chamar `talos_classify_input`: audit não roteia input para execução.
3. **Invocar `talos-audit` no fio principal** — carregar o `SKILL.md` real, auditar só o boundary informado, ler regras locais, detectar stack por manifests/configs/comandos reais, aplicar checklist universal e Ponytail pass final.
4. **Output** — relatório com stack detectada, regras consultadas, boundary, achados P0/P1/P2/P3 com `arquivo:linha`, gaps por área e limitações.
5. **Handoff opcional** — se `--handoff`, escrever `PLAN_AUDIT_*.md` **conforme ao `PLAN_TEMPLATE.md`** (cabeçalho com linha `| **Sprint file** | N/A — origem auditoria |`, ref a `BOUNDARY_SPRINT_PLAN.md`, §1–§6/§8, tasks `#### T01.`), derivado somente dos achados evidenciados — passa no gate TC e é consumível por `/talos execute plan`. Reportar o path e **parar aqui. Não chamar executor automaticamente.**

### Modo loop — esteira serial de sprints (`--loop`)

Ativação: flag `--loop` em `full`/`direct` com backlog (macro input ou `sprint`/`backlog-item`). Só existe em pipeline com execução; `audit`/`interview-only` não têm loop. **Sem `--loop`, esta seção não se aplica** — o pipeline atual não muda (CN7, opt-in); a cadeia de fechamento da review, que é comum aos dois modos, já está no [EXEC].

**Início da sprint:** o `talos_lock_dispatch(action=start, phase=plan_execute)` de **cada sprint** da esteira leva `options:{loop:true}` (boolean estrito; valor não-booleano é recusa `-32602`). A flag é gravada no ledger daquele run (`data.options.loop`) pelo MCP — e é do MESMO run que o `talos_update_sprint_status` fecha a sprint, onde o gate de `--loop` recusa `done`/`manual_validation_pending` sem o gate `slice_review` `passed` (D12/VC3). Sem a flag, nada é gravado e nenhum retorno muda.

Ciclo serial — uma sprint por vez, nesta ordem, nada em paralelo:

1. **Seleção** — `talos_select_next_sprint` (mode-aware, como no fluxo normal). `status: blocked` sem `selected` → **relatório final** e fim da campanha.
2. **Drain sob demanda (CN4/D9/D20)** — se o retorno trouxer `drain_required.required: true` (reasons: `threshold` — teto de 3 PDs abertas; `dep_cone` — PD cuja sprint de origem está no cone DEP do candidato; `files_overlap` — overlap entre `files` da PD e os paths do §3 do sprint file do candidato), drenar **antes de avançar**: despachar o sidecar `talos-escalation-repair` em **modo drain** (blocking, um por vez — G9) para as PDs apontadas pelas reasons e fechar cada PD com `talos_pendencies(action=close, {pd_id})` — a escrita do arquivo é sempre do MCP; o orquestrador **nunca** grava em `PENDENCIAS_<slug>.md`. Depois re-chamar `talos_select_next_sprint`. O drain é acionado **somente pelo retorno do MCP** — não existe faxina obrigatória de todas as PDs antes de qualquer sprint (D9).
3. **Cadeia da sprint** — o passo **[EXEC]** comum, exatamente como descrito lá: entrevista → plano → execução → validator (G4) → review crítica → roteamento residual → fechamento. Em `--loop` a review crítica roda **sempre** (D12 — sem editar `policy_manifest` por sprint; o MCP recusa o fechamento sem review `passed` no ledger), e o residual P0/P1 segue a cadeia repair (`origin=slice_review`) → verification → sidecar (`origin=escalation`) → estacionamento se persistir.
4. **Residual P2/P3** — para cada finding não-blocking da review/verification, `talos_pendencies(action=append, {sprint_id, severity, files, recommendation, fix_validation})`; o MCP gera `PD-<sprint>-<NN>` monotônico.
5. **Estacionamento (D8)** — sidecar falhou (budget `escalation` esgotado ou `blocked` da skill) ⇒ `talos_update_sprint_status(status=detached_repair)`; **sem retry do sidecar no mesmo ciclo** (budget MCP por provenance). A sprint estacionada não satisfaz DEP e o `select_next` seguinte pula presa — a campanha segue para a próxima independente. Fechamento normal continua `done`/`manual_validation_pending`.
6. **Avanço automático (D14)** — terminada a cadeia da sprint (fechamento OU estacionamento, residual P2/P3 registrado), voltar ao passo 1 **sem pedir permissão entre gates**. A entrevista do contrato §7 é a **única pausa in-band** da esteira; todo o resto é "continuação automática" (Princípio de continuação automática).

**Sem concorrência (D16/INV8):** um sub-agent por fase, despachos blocking — sidecar e drain inclusive. A cadeia da sprint (sidecar e drain inclusos) **fecha antes** do `select_next` seguinte. Proibido sidecar em background/paralelo à próxima sprint, reentrada paralela ou qualquer "otimização" concorrente — é violação de gate (G9).

**Fim de campanha (zero candidata):** output final do loop relata — sprints fechadas (`done`/`manual_validation_pending`), sprints estacionadas (`detached_repair`) com causa, PDs abertas restantes (`drain_required.open_pd_count` / `talos_pendencies(action=list)`) — e ecoa o banner final do MCP (`select_next` `blocked`: "nenhuma sprint executável"). Proibido narrar estado por conta própria: banners são strings do MCP (Protocolo de banner).

**Erro no meio do loop (MCP indisponível, lock conflict, gate bloqueante):** aborta a esteira com causa, tool/gate/status e `next_action` — mesma regra de "Error handling", sem fallback narrativo. Sprints já fechadas e estacionamentos já gravados permanecem no disco; retomar re-executando `/talos <mode> <input> --loop` — o `select_next` re-deriva o estado do backlog.

---

## Validação automática de aceite (contrato §7)

O scan é **determinístico** e roda **dentro do MCP** (`talos_scan_acceptance`): a lista canônica de padrões e as exclusões de config (`exclude_if_line_contains`) são embutidas e mantidas no servidor — o orquestrador **não** reaplica padrões por conta própria, só consome o resultado. Não usar julgamento livre.

**Threshold = 1.** Se ≥ 1 padrão bloqueante → o orquestrador invoca `talos-sprint-interview` no fio principal. **Gate G5:** se 0 padrões bloqueantes, registrar `Ambiguity scan: 0 padrões bloqueantes — entrevista pulada` no output. Não há decisão subjetiva de "tenho certeza, pulo".

---

## Decisão em aberto ≠ parada

Detalhe do caminho que a "Princípio de continuação automática" exige para decisão pendente de **qualquer fonte** (scan/entrevista/validação de plano/`PERGUNTAS_EM_ABERTO.md`/`DISCUSSAO_*.md`/backlog — a fonte não muda o tratamento):

1. **Garantir sprint file com §7 primeiro.** Em `full`/`direct`, se o contrato não existe/está draft incompleto, validar/criar primeiro o sprint file (quando o fluxo exigir sprint), então **maturar a §7**. A entrevista é **sprint-scoped**: roda **sobre** o contrato §7, nunca antes do sprint file.
2. **Disparar `talos-sprint-interview`** sobre o sprint file — resolve via `talos_capabilities.question_prompt`, sem hardcode de host.
3. **Persistir após cada rodada** no mesmo sprint file (§7), reindexar e não repetir D* fechada; ao aprovar, gravar selo.
4. **Propagar** ao plano/DEC/registro de origem.
5. **Reexecutar** os gates afetados (`talos_verify_sprint_file`/`talos_scan_acceptance`/TC) e **continuar** automaticamente.

Marcar TBD e adiar só se o usuário pedir **explicitamente** — nunca por iniciativa do orquestrador.

> `PERGUNTAS_EM_ABERTO.md` é verificado na validação de aceite; Q- aberta da sprint **não é blockage** — entra neste mesmo caminho.

---

## Output

O ledger é **verificado contra disco** (Gate G6). Cada artefato listado precisa existir. A linha `Guarantee level` declara o enum `guarantee_level` emitido pelo MCP e aparece em `full`/`direct`/`execute` — todos pipeline completo (`full_pipeline`). `interview-only` não emite `guarantee_level` (entrevista sem execução).

```
✅ Talos: claude full sprint completed

📄 Sprint: /path/to/SPRINT_S05_login.md   [contrato §7 aprovado+selo]
📋 Plan: /path/to/PLAN_S05_login.md          [verificado em disco]
🚀 Output: [summary 1-2 linhas do executor]

Status:
  ✅ Preflight: passed [MCP: talos_preflight / G10]
  ✅ Sprint file: passed [MCP: talos_verify_sprint_file]
  ✅ Aceite scan: 2 padrões → entrevista executada [MCP: talos_scan_acceptance / G5]
  ✅ Template conformance: passed [MCP: talos_verify_template_conformance / TC]
  ✅ Plano generated [MCP: talos_verify_artifact + talos_verify_template_conformance]
  ✅ Dispatch plan_execute: passed [MCP: talos_lock_dispatch / G7+G8]
  ✅ After plan: passed [MCP: talos_assert_after_plan / G11]
  ✅ Validador frio: P0=0 P1=0 P2=1 P3=2 [executor + task-validator]
  ⏭️  Slice review: not applicable [MCP source: mode/flag/policy]
  ✅ Guarantee level: full_pipeline [MCP: talos_preflight / D12]

Próximo passo:
  [ ] Validar executor output
  [ ] Rodar slice-review (opcional)
  [ ] Avançar para próxima sprint
  Próximo: $talos-memory-promote <handoff_path>   [quando MCP retornar handoff_path em done terminal]
```

Se algum artefato exigido pelo modo estiver ausente, o cabeçalho vira:

```
⚠️  Talos: claude full sprint incomplete
   Faltando: PLAN_*.md (Gate G2 bloqueou execução de código)
```

Se algum resultado MCP exigido estiver ausente, indisponível ou bloqueante, o cabeçalho deve ser:

```
⚠️  Talos: <mode> <input-type> aborted
   Gate MCP: <tool MCP ou gate>
   Status: <blocked|missing|unavailable>
   Causa: <causa provável retornada pelo MCP ou indisponibilidade da fonte primária>
   Impacto: <por que a fase não pode avançar sem risco de ledger falso>
   Próxima ação permitida: <next_action retornado pelo MCP ou restaurar serviço MCP>
```

Se `full` gerou `PLAN_*.md` mas não despachou `plan_execute`, o cabeçalho deve ser:

```
⚠️  Talos: full <input-type> incomplete
   Violação: G11 — PLAN_*.md validado, mas plan_execute não foi despachado
   Próxima ação obrigatória: despachar plan_execute como sub-agent blocking
```

---

## Error handling

- **Pré-flight falha (skill ausente no host)** → para, reporta, não emula (ver Fase 0).
- **MCP indisponível, sem resultado exigido ou status bloqueante** → aborta a fase; reporta tool/gate/status/`next_action`; nunca usa fallback narrativo.
- **Sprint não encontrado** → reporta sprints disponíveis.
- **Skill falha** → para, reporta erro, oferece retry/skip/abort.
- **Contrato §7 inválido** → reporta pendências (D*/aceite/selo), opção de continuar via entrevista.
- **Gate duro violado** → para, reporta qual gate (G1–G11) e o artefato/condição faltante.
- **Ambiguidades não resolvidas** → dispara entrevista, propaga e continua (ver "Decisão em aberto ≠ parada"). Não é parada.

---

## Skills envolvidas

`talos-backlog-generator` é a primeira fase documental para macro inputs em `full`/`direct` quando `routing.document_flow.priority = backlog_first`. Ele deve retornar `backlog_path`, `sprint_id` e `sprint_file_path`. Para `sprint`/`backlog-item`, o orquestrador resolve o sprint file existente via backlog. Para `plan`, `execute`, `interview-only` e `audit`, não roda automaticamente; a cadeia continua a partir do artefato/input já recortado.

| Skill | Entrada | Saída (artefato) |
|-------|---------|------------------|
| `talos-backlog-generator` | macro input sem backlog canônico ou pedido explícito de backlog | `BACKLOG_MESTRE_*.md`, `SPRINT_S<NN>_*.md`, `sprint_id`, `sprint_file_path` |
| `talos-sprint-interview` | sprint_file_path, ambiguities | `SPRINT_*.md` §7 atualizado + selo ao aprovar |
| `talos-plan-handoff` | `sprint_file_path`, código real | `PLAN_*.md` |
| `talos-audit` | target, flags (`--handoff`, `--scope`) | relatório de auditoria; `.talos/plans/PLAN_AUDIT_*.md` opcional sem execução |
| `talos-plan-execute` | plan_path (`full` / `execute`) | diff de código, evidência, `state_path` |
| `talos-direct-execute` | sprint_file_path/spec/task (`direct`) | diff de código, evidência, `state_path` |
| `talos-slice-review` | diff/output | review_feedback |

**Sub-agent frio (Gate G4):** `talos-task-validator` é verificado no pré-flight pelo orquestrador e sempre roda isolado como **sub-agent irmão (sibling)**, em todos os hosts: despachado pelo orquestrador a partir do `state_path` retornado pelo executor. A topologia é sempre sibling — o executor nunca despacha o validador.

---

## Configuração

Plugin usa configuração embutida no MCP para:
- mapear skills `talos-*`;
- validar padrões de ambiguidade;
- declarar sequências por modo + artefatos esperados;
- aplicar gates duros.

Se o MCP não responder ou reportar drift, o pacote está inválido: abortar no pré-flight. Não cair para defaults implícitos.

---

## Ordem de sub-agents (resumo executável)

```
orquestrador
 ├─ MCP ping + preflight                         → talos_ping + talos_preflight (G10)
 ├─ BACKLOG    → se macro, autoria documental    → talos-backlog-generator + talos_verify_artifact
 ├─ SPRINT     → resolve/valida sprint file      → talos_verify_sprint_file
 ├─ ACEITE     → scan + entrevista se necessário → talos_scan_acceptance + talos-sprint-interview
 ├─ PLANO      → §7 + sprint file + código real  → talos_verify_artifact + talos_verify_template_conformance
 ├─ G11        → talos_assert_after_plan         → próxima ação obrigatória = plan_execute
 ├─ EXECUÇÃO   → talos_lock_dispatch + sub-agent talos-plan-execute
 ├─ VALIDAÇÃO  → lock_validator + task-validator irmão
 │                └─ fail → findings-repair (budget 1, mesmo state_path) → validator final
 └─ REVIEW     → talos_lock_dispatch + sub-agent slice_review (se --review, --loop ou critical_review.required)
                  └─ residual P0/P1 → repair(origin=slice_review) → verification → sidecar escalation → detached_repair se persistir; P2/P3 → talos_pendencies(append)
```

Em **`execute`** a cadeia começa direto na reverificação + execução (o plano é o input):

```
orquestrador
 ├─ MCP ping + capabilities                    → talos_ping + talos_capabilities
 ├─ classify_input                             → talos_classify_input (tipo prevalece; determina modo efetivo; auto-rotear se não-plano)
 ├─ preflight(<modo efetivo>)                  → talos_preflight (G10, PREREQ) — trava o modo efetivo, não o pedido
 ├─ REVERIFICA plano (entrada)                 → talos_verify_artifact + talos_verify_template_conformance (G1+TC)
 ├─ EXECUÇÃO   → talos_lock_dispatch + sub-agent plan_execute  (primeira fase; assert_after_plan N/A)
 ├─ VALIDAÇÃO  → lock_validator + task-validator irmão → repair opcional → terminal
 └─ REVIEW     → talos_lock_dispatch + sub-agent slice_review (se --review, --loop ou critical_review.required)
                  └─ residual P0/P1 → repair(origin=slice_review) → verification → sidecar escalation → detached_repair se persistir; P2/P3 → talos_pendencies(append)
```

Regra de ouro: **um sub-agent por fase de execução, em série, blocking, sustentado por MCP**. O orquestrador espera cada sub-agent terminar antes do próximo e **nunca** trabalha em paralelo nem escreve código (Gate G9). Autoria documental (contrato §7/plano) é livre no fio principal **antes** do plano validado; depois, mãos atadas. Em `full`, `PLAN_*.md` validado obriga `plan_execute` no mesmo workflow (G11). `task-validator` ⟂ `slice-review` jamais coexistem. Progresso só por banner (string do MCP).

> Histórico de versões (detalhe de cada correção) e roadmap: [`CHANGELOG.md`](../../../../CHANGELOG.md) na raiz — fonte canônica.
