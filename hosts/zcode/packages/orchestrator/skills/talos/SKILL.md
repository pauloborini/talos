---
name: talos
description: "Orquestra pipeline completo de desenvolvimento de features: /talos <mode> <input-type> [flags]. Automatiza backlog macro → sprint file → PRD → validação → entrevista (se necessário) → planejamento → execução → review (opcional) e oferece audit universal sem correção. Pipeline orientado a artefato com gates duros: cada fase só conta se produzir arquivo verificável em disco."
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

Três modos **canônicos de execução** — `full`, `direct`, `execute` (PRD §5 D1) — mais os modos sem execução `interview-only` e `audit`.

- **`full`** — pipeline completo: backlog macro (se necessário) → sprint file → PRD → validação → entrevista (se necessário) → **plano (artefato obrigatório)** → executor → review (opcional)
- **`direct`** — pipeline enxuto: backlog macro (se necessário) → sprint file → PRD → validação → entrevista (se necessário) → `talos-direct-execute` → review (opcional). **Não produz plano de handoff** — a diferença real para `full` é exatamente essa.
- **`execute`** — recebe um **`PLAN_*.md` pronto** e o executa **sem gerar plano** (PRD D1). Entrada = caminho de plano; reverifica o artefato + conformidade de template e despacha `plan_execute` direto. Não regera nem replaneja: ajustes de plano pedem `full`. `talos_assert_after_plan` (gate pós-plano do `full`) **não se aplica** em `execute` — o plano já é o input; o equivalente é a reverificação na entrada (PRD D13). **Não há alias `plan`**: usar `plan` como modo é ambíguo com planejamento documental e deve ser rejeitado como modo inválido.
- **`interview-only`** — entrevista direta (ex: brainstorm, resolução de decisões). Entrevista **sem execução**: não usa `guarantee_level` no fluxo (não há execução de código a garantir). Permanece modo separado (PRD D2).
- **`audit`** — auditoria universal sem correção de código: lê target/boundary, regras locais e stack detectada; gera relatório de achados e, com `--handoff`, plano Talos-style para correção futura. **Não executa plano, não chama executor e não altera código.**

### Input Types

- **`sprint`** — Sprint ID (ex: S05) já ancorado no backlog e em sprint file vivo; alias canônico novo para `backlog-item`
- **`backlog-item`** — alias legado de `sprint`; manter por compatibilidade
- **`idea`** — Indicação/brainstorm curto ou macro input ainda sem backlog canônico
- **`prd`** — Path para PRD existente ou nome do arquivo
- **`brainstorm`** — Texto livre (só para `interview-only`)
- **`target`** — Path/feature/módulo auditável (só para `audit`)

### Flags

- `--interview` — força entrevista de PRD mesmo sem ambiguidades detectadas
- `--review` — executa slice-review ao final (senão é opcional)
- `--handoff` — em `audit`, escreve plano Talos-style em `.talos/plans/` derivado dos achados evidenciados; não executa
- `--scope <descrição>` — em `audit`, restringe o boundary lógico dentro do target
- `--help` — mostra sintaxe completa

## Exemplos

```
/talos full sprint "S05"
→ Resolve S05 no backlog, valida sprint file, gera PRD, valida, entrevista se necessário, cria PLAN_*.md, executa a partir do plano

/talos direct sprint "S05"
→ Resolve S05 no backlog, valida sprint file, gera PRD, valida, executa direto sem PLAN_*.md

/talos direct prd "/path/to/PRD_S05.md" --review
→ Valida PRD, executa direto (sem handoff), roda review ao final

/talos full idea "melhorar performance de listagem" --interview
→ Prioriza BACKLOG_MESTRE_*.md quando a entrada ainda é macro, cria/atualiza sprint file, seleciona a próxima sprint executável, gera PRD, força entrevista, plano, executor

/talos interview-only brainstorm "que tal dark mode?"
→ Cria draft mínimo pelo template canônico, valida o path e entrevista esse PRD; sem execução

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
2b. **Chamar MCP `talos_classify_input`** no input informado (`input_path`), **antes de rotear** (PRD D3/D6). `classify_input` é para **artefato em arquivo** (path em disco). A tool devolve `artifact_type` ∈ {`backlog`, `prd`, `plan`, `idea`, `unknown`} (verdade forte = TC de plano passa) e um `banner` de roteamento já pronto. **O tipo de input é fato e prevalece sobre o modo pedido** (intenção). Aplicar o roteamento:
   - **`plan` em `direct`/`full`** → auto-rotear para **`execute`** (executa o plano pronto; nunca gera plano de plano, mesmo com arquivo renomeado — PRD D6). **Não bloqueia**: ecoar o banner de troca `▸ talos: roteamento · pediu={x} mas input={y} → modo=execute`.
   - **`execute` sobre `backlog`/`prd`** → auto-rotear para **`full`** (ou `direct` conforme o pedido), pois não há plano a executar. **Não bloqueia**: ecoar o banner de troca correspondente.
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
3b. **Gate DEP — dependência de backlog (só `sprint`/`backlog-item`).** Se o item declara `Dependências` no backlog/registro de origem, ler o status de cada dependência **no mesmo backlog**. Se alguma não estiver `done`, **abortar em `ready`** com `unmet_dependencies`, causa e `next_action` — determinístico, sem pergunta. Todas `done` (ou sem dependências) → segue. Decisão em aberto **não** entra aqui (não é dependência de execução).
   ```text
   ⛔ Pré-flight falhou (DEP)
      Item: <id>   Dependência não satisfeita: <dep> (status: <status>)
      Motivo: dependência de backlog não está `done`
      Ação: executar <dep> antes de <id>
   ```
3c. **Gate Backlog/Sprint — índice e recorte vivo obrigatórios (`full`/`direct` com `sprint`, `backlog-item` ou `backlog_first`).** Quando houver backlog, chamar `talos_verify_backlog_index`; para macro input, chamar também `talos_select_next_sprint` e usar somente o `selected` retornado pelo MCP. Resolver o `Sprint file` linkado/selecionado e chamar `talos_verify_sprint_file`. Se backlog inválido, seleção ausente, sprint file `pendente`, inexistente, divergente do Sprint ID, sem seções mínimas (`Metadados`, `Escopo`, `Definition of Ready`, `eval_manifest`, `policy_manifest`) ou com gate bloqueado/indisponível, **abortar antes do PRD** com causa e `next_action`.
   ```text
   ⛔ Pré-flight falhou (SPRINT_FILE)
      Item: <id>   Sprint file: <path|pendente>
      Motivo: sprint file ausente/inválido; PRD não nasce direto do backlog
      Ação: criar/atualizar SPRINT_S<NN>_<slug>.md via SPRINT_TEMPLATE.md
   ```
4. **Usar a cadeia única `talos-*`.** Cliente (Claude Code, Cursor, Codex App, Antigravity, ZCode, OpenCode, Pi CLI) é host de execução, não família de skills. Não existe roteamento por cliente.
5. **Carregar defaults do pacote do plugin** (`defaults/paths.md` e `references/subagent_dispatch.md`). Não exigir config na raiz do repositório usuário.
6. **Verificar disponibilidade dos ids `talos-*`.** Para cada skill exigida pelo modo, confirmar que o id exato é **invocável** no host. Para as skills de **execução/validação/review** (`plan_execute`, `direct_execute`, `task_validator`, `findings_repair`, `slice_review`), confirmar também que são **despacháveis pelo verbo nativo do host** — leia `talos_capabilities.subagent_dispatch.mechanism` (não assuma "Agent tool"; no Codex é `spawn_agent(agent_type)`, no opencode `@<name>`, no pi `subagent({...})`, no ZCode e Claude é `Agent(subagent_type)`). No Codex, `$<skill>` é ativação in-context de skill e **não** conta como sub-agent isolado para execução. Para as skills **documentais/de leitura** (`prd_generator`, `prd_interview`, `plan_handoff`, `audit`), basta invocabilidade no fio principal; não exigir despachabilidade como sub-agent.
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

**Proibido (regressão, PRD §6):**
- Pedir confirmação para avançar: "Quer que eu gere o PRD?", "posso seguir?", "continuo?", "devo despachar o executor?". A resposta é sempre sim — **execute**. Se a próxima fase tem artefato a produzir, produza.
- Inventar modo fora do contrato. **Não existe "Modo Discussão", "modo análise", "dry-run"** ou similar. Os únicos modos são `full`/`direct`/`execute`/`interview-only`/`audit`. Pedido em linguagem natural que nomeia um modo (ex.: "/talos full sprint S40") **executa esse modo** — não vira pergunta nem resumo passivo.
- Parar por decisão em aberto. Decisão pendente de **qualquer fonte** (scan de PRD, entrevista, `PERGUNTAS_EM_ABERTO.md`, doc de discussão/decisões como `DISCUSSAO_*.md`, ou o próprio backlog) **não é blockage**: gera o PRD se ainda não existe, dispara `talos-prd-interview` sobre ele, propaga e **continua**. Nunca oferecer "responda só: seguir com recomendação ou D=...". Ver "Decisão em aberto ≠ parada".

**PRD ausente em `full`/`direct`** = o passo "Generate PRD" **gera o PRD automaticamente** (invoca o id resolvido para `prd_generator` / autoria documental no fio principal). Nunca perguntar "quer que eu gere?".

**Backlog ausente em macro input (`routing.document_flow.priority = backlog_first`)** = antes de gerar PRD, invocar `talos-backlog-generator` no fio principal para criar/atualizar `BACKLOG_MESTRE_*.md` e `SPRINT_S<NN>_*.md`, validar artefatos em disco, chamar `talos_verify_backlog_index` e escolher a próxima sprint executável via `talos_select_next_sprint`. Em seguida, gerar PRD somente a partir do sprint file dessa sprint. Isto preserva o escopo pequeno de execução: macro fica no backlog mestre; sprint file fecha recorte vivo; PRD/plano/executor recebem apenas a sprint selecionada.

**Após entrevista**: reexecuta os gates afetados (`talos_verify_artifact`/`talos_scan_prd`/TC) e **retoma o pipeline (plano→execução) automaticamente**, sem nova confirmação.

A única interação legítima com o usuário é **dentro de uma fase** — o mecanismo estruturado `question_prompt` devolvido por `talos_capabilities`, usado pela entrevista para resolver ambiguidade de produto. Resolver ambiguidade ≠ pedir permissão pra avançar. Terminada a fase, respostas são persistidas no PRD, gates são reexecutados e o pipeline segue sozinho.


## Papel do orquestrador (fronteira de determinismo pela mutação de código)

O orquestrador **coordena a execução**, não implementa código — maestro que aponta cada sub-agent na ordem e espera terminar, **nunca pega o instrumento de código**. A fronteira de determinismo é a **mutação de código** (PRD D10), com **duas fases**:

- **ANTES do plano validado — autoria documental livre no fio principal.** Pode autorar PRD, entrevistar e escrever `PLAN_*.md` direto; fases documentais não exigem sub-agent (documento não muta o produto). **Ao finalizar um PRD inline, estampar `| Status | Aprovado para implementação |`** — é o `required_status` do gate TC; sem isso o PRD sai `Draft` e trava o TC em rodadas de correção.
- **DEPOIS do plano validado (`talos_verify_artifact` + TC `passed`) — mãos atadas fortes.** Não edita mais PRD/plano/código nem roda comando mutante; só coordena (despachar sub-agent, ler artefato pra verificar gate, ecoar banner, montar output).

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

O orquestrador comunica progresso **apenas** por **banner de fase de linha única** no formato `▸ talos: <fase> · <ação> [· <detalhe>]` (PRD D7/D8). Regras:

- **A string vem do MCP.** Cada gate de tool (`talos_preflight`, `talos_classify_input`, `talos_scan_prd`, `talos_verify_artifact`, `talos_verify_template_conformance`, `talos_lock_dispatch`, `talos_assert_after_plan`) devolve o campo `banner` pronto, derivado do banco canônico de 11 templates no MCP. O orquestrador **só ECOA** essa string — sem reescrever, traduzir ou enfeitar (PRD D9).
- **Proibido narrar intenção entre gates.** Nada de "vou despachar o sub-agent...", "agora vou...", "deixa eu verificar...". Qualquer prosa de intenção entre fases é **regressão** (PRD §6). A sessão do usuário é uma sequência limpa de linhas `▸ talos: ...`.
- **Uma linha por transição**, em pt-BR, prefixada por `▸ talos:`. Os 11 eventos do banco: roteia, roteia c/ troca, preflight ok, preflight fail (`BLOCK`), prd scan, entrevista, plano, exec, validação, review, done.
- Preflight bloqueado → ecoar o banner `preflight · BLOCK · <motivo>`; PRD com lacunas → banner `prd · <n> lacunas`. O detalhe livre só entra no slot `<detalhe>` quando o template tem um.

> O banner **não substitui** os gates de execução: ele é a camada de comunicação. Gates duros (G1–G11, PREREQ, TC) continuam decidindo o fluxo por contrato MCP, não pela string.

## Gates duros (HARD GATES)

Regras inegociáveis. Violação = parar, não contornar.

| # | Gate | Aplica a |
|---|------|----------|
| G1 | **Artefato antes de avançar.** Uma fase só conta como concluída se `talos_verify_artifact` aprovar o arquivo produzido. Leitura local pode complementar, mas não substitui o resultado MCP. | todas |
| G2 | **Em `full`, proibido escrever qualquer código (Dart) antes de existir `PLAN_*.md` validado em disco.** Se for escrever código sem plano, o modo correto é `direct` — então pare e avise o usuário do mismatch. | `full` |
| G3 | **Skills invocadas de verdade — autoria documental no fio principal, execução de código em sub-agent.** **Fases documentais ANTES do plano validado** (gerar/maturar PRD, entrevistar, redigir `PLAN_*.md`) podem ser conduzidas pelo orquestrador (agente principal) carregando a skill correspondente; não exigem despacho de sub-agent (autoria não muta código). **Fases de execução de código** invocam a skill via **sub-agent despachado** (verbo nativo do host de `talos_capabilities` — não necessariamente "Agent tool"), que carrega o `SKILL.md` do id resolvido antes de agir — prompt "aja como X" não basta. Sempre proibido absorver o artefato "implicitamente" (ex: plano dentro do §6 do PRD não substitui `PLAN_*.md`): o artefato exigido pelo modo tem que existir em disco e passar G1/TC. | todas |
| G4 | **Validador frio é sempre sub-agent irmão (sibling), em todos os hosts.** O executor escreve `state_path` e para (retorna `validator_handoff_required`); o orquestrador abre o slot com `talos_lock_validator`, despacha `task_validator` como irmão isolado e só aceita output cujo `dispatch_token` corresponda ao `validator_recovery.expected_dispatch_token`. Em caso de `fail`, roda `repair_start`, passa ao **`talos-findings-repair`** o pacote `{state_path, findings, validator_attempt, repair_run_id, repair_budget: 1}`, exige atualização do mesmo `state_path`, fecha o repair e executa o **2º e último** validator. `validator_run_id`, `dispatch_token` e `repair_run_id` são obrigatórios para fechar slots ativos. O executor nunca valida o próprio trabalho nem despacha o validador no mesmo contexto. **A topologia é sempre sibling** — host sem join síncrono é rejeitado no preflight (gate JOIN). **Recovery de orquestrador re-spun:** antes de aceitar qualquer retorno, ler `talos_run_state(get)` e usar `validator_recovery` para reconhecer o slot ativo; retornos divergentes voltam `stale_discarded: true` e devem ser descartados. **Falha de dispatch do validador em runtime = `blocked`, nunca inline (R17).** Se o despacho do `task_validator` (verbo nativo do host) **errar ou não retornar** — Agent/spawn/subagent que falha, host sem sub-agent disponível em runtime — a slice **bloqueia** com causa e `next_action`; é **proibido** validar inline, no contexto do orquestrador, ou relatar um veredito que o irmão frio não produziu. Não existe caminho de degradação: dispatch quebrado fecha a fase, não a contorna. **Proveniência do `dispatch_token` (R19):** o token submetido no `lock_validator(complete)` tem que ser o que **o próprio validador irmão devolveu no output dele** — não um valor que o orquestrador leu de `validator_recovery` e repassou sem o irmão ter rodado. O `validator_recovery` serve para *reconhecer/descartar* retornos stale, não para *fabricar* o token de um validador que não executou. **Proof-of-work (R20):** quando `lock_validator(start)` emite um `challenge` (sha256 de um arquivo do boundary), o `complete` exige `challenge_response` — também vindo **do output do validador irmão**, jamais preenchido pelo orquestrador. O MCP recomputa o hash do disco; divergência/ausência → `challenge_failed` (`blocked`), slot preservado, re-despachar o mesmo validador. Re-dispatch é **bounded**: após o teto de falhas por attempt o slot fecha terminal (`challenge_exhausted`, fail-closed) em vez de loopar. É atestação mecânica de leitura do boundary, **não** prova de isolamento não-forjável (MCP fala stdio com um único caller) — fecha o atalho preguiçoso de afirmar veredito sem ler código. | execução |
| G5 | **Scan de ambiguidade determinístico e logado.** A decisão de pular a entrevista só é válida se `talos_scan_prd` retornar **zero** padrões e esse resultado MCP estiver no ledger. Não existe "pular porque tenho certeza". `--interview` sempre força. | validação PRD |
| TC | **Conformidade de template via MCP.** PRD e PLAN só avançam como artefatos documentais se `talos_verify_template_conformance` retornar `passed` e `pending_count: 0`. Em `full`/`direct` com sprint file, chamar com `require_sprint_file:true`. Pendência bloqueia com `next_action`. | PRD + plano |
| G6 | **Status verificado, não auto-reportado.** O ✅ de cada item no output só pode ser marcado após confirmar o artefato em disco. Faltou artefato exigido pelo modo → status final `incomplete`, nunca `completed`. | output |
| G7 | **Execução de código roda SEMPRE como sub-agent despachado (verbo nativo do host, lido de `talos_capabilities`), nunca no contexto do orquestrador.** A **autoria** do `PLAN_*.md` pode ser feita pelo orquestrador no fio principal **enquanto o plano não foi validado** (autoria documental, PRD D10) — mas o plano só vira confiável após `talos_verify_artifact` + TC `passed`. A **execução do plano** (`plan_execute`) e qualquer mutação de código vão obrigatoriamente a sub-agent. Antes de iniciar/concluir fase de execução, usar `talos_lock_dispatch`; fase fora de ordem ou paralela bloqueia. Depois do plano validado, o orquestrador não edita mais o plano (mãos atadas fortes). | plano + execução |
| G12 | **Executor vivo precisa provar progresso.** Ao iniciar `plan_execute`, `talos_lock_dispatch(start)` cria liveness de bootstrap/progresso. O executor precisa emitir `talos_lock_dispatch(checkpoint, phase=plan_execute, event=...)` cedo, começando por `executor_started`/`skill_loaded`, depois `plan_loaded`, `handoff_accepted`, `task_started`, `first_write` e `state_path_created` conforme avança. `state_path_created` exige `state_path` legível/parseável, põe o liveness em `handoff_ready` e não expira por timeout de progresso enquanto aguarda o orquestrador abrir `talos_lock_validator(start)`. O validator só abre se o último checkpoint for `state_path_created` para exatamente o mesmo `state_path`. Se o sub-agent não retornar, travar, ficar sem primeiro checkpoint, ou ficar com checkpoint antigo sem avanço antes do handoff, o orquestrador chama `talos_lock_dispatch(action=status, phase=plan_execute)`: `executor_bootstrap_timeout`/`executor_progress_timeout` viram `stalled`, o lock é liberado para `retry_plan_execute`, e a execução não pode ser declarada completa. Sem checkpoint/progresso antes do handoff não há "em andamento" confiável. | execução |
| G8 | **Ordem fixa de validação: `task-validator` ANTES, `slice-review` POR ÚLTIMO. Nunca em paralelo.** Conclusão de `plan_execute` usa `talos_lock_dispatch` com `validator_status: passed`; review só inicia após execução concluída. | validação + review |
| PREREQ | **Pré-requisitos de determinismo (hard-fail, DEC-004).** `talos_preflight` verifica, **antes de tudo**, se o host tem subagente + MCP (essenciais). Ausente (ex.: pi sem `pi-mcp-adapter`/`pi-subagents`, host MCP-only sem subagente) → aborta em `ready` com `missing_prerequisites`/`next_action`. Sem degradação, sem validator inline, qualquer tamanho. `todo` não-essencial segue sem mirror. | roteamento |
| DEP | **Dependência de backlog não satisfeita = hard-fail determinístico.** Se o input é `sprint`/`backlog-item` e o item declara `Dependências` (ex.: S40 dep S39) cujo status, lido no mesmo backlog/registro de onde o item veio, **não** é `done`, abortar em `ready` com `unmet_dependencies`, causa e `next_action` (executar a dependência primeiro). Sem improviso e sem pergunta: ou a dep está `done` e segue, ou bloqueia com causa. Não confundir com decisão em aberto (que não bloqueia). | roteamento (`sprint`/`backlog-item`) |
| BACKLOG_INDEX | **Backlog mestre é índice verificável.** Em `backlog_first` e `sprint`/`backlog-item`, chamar `talos_verify_backlog_index` antes de escolher sprint ou gerar PRD. Link ausente, sprint file ilegível, dep interna inválida/cíclica ou status drift bloqueia. | roteamento |
| SELECT_NEXT_SPRINT | **Próxima sprint vem do MCP.** Em `backlog_first`, chamar `talos_select_next_sprint`; sem `selected` não há PRD. A seleção exige `state=ready`, deps internas `done`, sprint file válido e DoR verde. | roteamento |
| SPRINT_STATUS_SYNC | **Fechamento de sprint é gate MCP, não prosa.** Quando a execução validada pertence a backlog/sprint file, chamar `talos_update_sprint_status`: `done` exige `state_path` + `validator_verdict=pass|pass_with_observations`; `blocked` registra `fail`. O MCP sincroniza BACKLOG_MESTRE + SPRINT_SNN e bloqueia reabrir `done` sem autorização explícita. | pós-validação |
| SPRINT_FILE | **Sprint file vivo obrigatório antes de PRD.** Em `full`/`direct` com `sprint`, `backlog-item` ou `backlog_first`, resolver o sprint file via backlog/saída do backlog-generator e validar com `talos_verify_sprint_file`. Ausente/inválido/divergente/gate indisponível bloqueia antes do PRD. `audit --handoff`, `execute plan` e `interview-only brainstorm` ficam fora deste gate. | roteamento/PRD |
| G10 | **Família única talos-*, id exato.** Modo, versão, lock e ids oficiais vêm de `talos_preflight`, nunca do host. Skill ausente, conflito de origem, lock ativo ou drift de versão → aborta com causa/impacto/próxima ação. | roteamento |
| G9 | **Fronteira de determinismo pela mutação de código.** O orquestrador **NUNCA** escreve/edita **código** nem roda comando mutante (flutter/test/git write), em qualquer fase ou modo — execução de código é sempre do sub-agent. **Autoria documental** (PRD, entrevista, `PLAN_*.md`) é permitida no fio principal **somente ANTES do plano validado**; uma vez que o plano passa `talos_verify_artifact` + TC, **mãos atadas fortes**: o orquestrador não edita mais PRD/plano/código, só coordena execução (despachar sub-agent, ler artefato para verificar gate, ecoar banner, montar output final). **NÃO** "ajuda" o sub-agent de execução. **Dispatch é blocking**: despacha **um** sub-agent por vez (verbo nativo do host de `talos_capabilities`, em foreground), **espera o retorno**, só então segue. Proibido `run_in_background` para fases do pipeline e proibido implementar "em paralelo" enquanto um sub-agent roda. Se o orquestrador tocar em **código** = G9 violado, **inclusive rodar a mutação inline porque o host não tem "Agent tool"** (use o verbo daquele host). | orquestrador |
| G11 | **`full` deve executar depois do plano.** Depois que `PLAN_*.md` passa G1/G2/G7/TC, chamar `talos_assert_after_plan`; a próxima ação obrigatória é despachar `plan_execute` como sub-agent blocking. Proibido completed só com handoff. | `full` |

---

## Fluxo de execução

### [EXEC] — passo comum de execução + validação

`talos_lock_dispatch(action=start, phase=plan_execute)` em todos os modos; despachar como sub-agent blocking o `routing.executor_skill` devolvido pelo preflight: `talos-plan-execute` em `full`/`execute`, `talos-direct-execute` em `direct`. O executor emite checkpoints G12; antes do handoff, sem retorno/progresso exige `talos_lock_dispatch(action=status, phase=plan_execute)` e `executor_bootstrap_timeout`/`executor_progress_timeout` viram `stalled`/retry — nunca execução em andamento. O executor retorna `validator_handoff_required` com `state_path`; o MCP só abre o slot após o checkpoint `state_path_created` para esse mesmo `state_path`, põe `handoff_ready` e não expira por timeout enquanto aguarda validator. Validação sempre **sibling**: `talos_lock_validator(action=start)`, despachar **um** `task_validator`, exigir no output o `dispatch_token` do slot e fechar com `validator_run_id` + `dispatch_token`. Se o output do validator for persistido em arquivo (`validator-output.json` ou equivalente), passar `validator_output_path` no `talos_lock_validator(action=complete)` ou validar o arquivo com `talos_verify_artifact(artifact_kind=json)` antes de declarar closure; JSON inválido bloqueia. Em `fail`: `repair_start`, despachar `talos-findings-repair` com `{state_path, findings, validator_attempt, repair_run_id, repair_budget: 1}`, exigir atualização do mesmo `state_path`, fechar com `repair_run_id` e rodar o **2º e último** validator. `passed`/`passed_with_observations` são terminais aprovados. Se a execução tem `backlog_path` + `sprint_id`, chamar `talos_update_sprint_status` após o veredito terminal: `done` com `state_path`, `validator_verdict`, `prd_path`, `plan_path`; `blocked` se o veredito final for `fail`. Sem esse gate `passed`, não declarar sprint concluída nem avançar seleção. Status diferente bloqueia review e output completed.

### Full mode

Artefatos esperados (em ordem): `BACKLOG_MESTRE_*.md` (se macro) → `SPRINT_S<NN>_*.md` → `PRD_*.md` → (`PRD_*.md` atualizado) → `PLAN_*.md` → diff de código → relatório do validador.

1. **Parse input** — resolve `sprint`/`backlog-item`/`idea` para contexto de sprint.
1a. **Backlog first (condicional)** — se `routing.document_flow.priority = backlog_first`, invocar `talos-backlog-generator`, produzir/atualizar `BACKLOG_MESTRE_*.md` + sprint file(s), chamar `talos_verify_artifact`, `talos_verify_backlog_index`, `talos_select_next_sprint` e `talos_verify_sprint_file`. Extrair `sprint_id` + `sprint_file_path` somente de `talos_select_next_sprint.selected`. Não gerar PRD direto do macro input.
1b. **Sprint file (obrigatório)** — para `sprint`/`backlog-item`, resolver/validar o sprint file antes do PRD. Se ausente/inválido, bloquear com `SPRINT_FILE`.
2. **Generate PRD** — invocar o id resolvido para `prd_generator` com `sprint_id`, `sprint_file_path` e backlog autoritativo; depois chamar `talos_verify_artifact` no `PRD_*.md`.
3. **Validate PRD** — chamar `talos_scan_prd` e `talos_verify_template_conformance(artifact_type=prd, required_status=Aprovado para implementação, require_sprint_file=true)` quando o PRD for avançar. G5 e TC entram no ledger com fonte MCP.
4. **Interview (condicional)** — se `talos_scan_prd` retornar bloqueante, TC bloquear ou `--interview` → invocar o id resolvido para `prd_interview`, depois reexecutar `talos_verify_artifact`, `talos_scan_prd` e TC no PRD atualizado.
5. **Plan** — `talos_lock_dispatch(action=start, phase=plan_handoff)`, carregar/invocar `plan_handoff` no fio principal para redigir `PLAN_*.md` a partir de PRD + sprint file + código real, depois chamar `talos_verify_artifact` e `talos_verify_template_conformance(artifact_type=plan, require_sprint_file=true)`. Concluir a fase com `talos_lock_dispatch(action=complete, phase=plan_handoff)`. **Nenhuma linha de código pode ter sido escrita até aqui.**
   - **G11:** se `PLAN_*.md` foi validado, chamar `talos_assert_after_plan`. Se a próxima ação não for `dispatch_plan_execute_blocking`, abortar.
6. **Validate plan** — se há gaps → dispara entrevista, propaga e continua (ver "Decisão em aberto ≠ parada"). Não para pra pedir permissão.
7. **Execute** — rodar o passo **[EXEC]** (lê `PLAN_*.md`).
8. **Review (condicional)** — somente após execução concluída e se `--review` → `talos_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `talos_lock_dispatch(action=complete, phase=slice_review)`.
9. **Output** — ledger verificado com fonte MCP por gate/fase, incluindo `talos_update_sprint_status` quando houver sprint/backlog, + próximos passos.

### Direct mode

Artefatos esperados: `PRD_*.md` → (atualizado) → diff de código → relatório do validador. **Sem `PLAN_*.md`** — por design.

1. Parse / Backlog first (condicional) / Sprint file / Generate PRD (se necessário) + `talos_verify_artifact`. Se `routing.document_flow.priority = backlog_first`, gerar/atualizar `BACKLOG_MESTRE_*.md` + sprint file antes do PRD e recortar a execução para a próxima sprint executável. PRD nasce do sprint file, não do backlog macro.
2. Validate PRD → `talos_scan_prd` + `talos_verify_template_conformance(require_sprint_file=true)`; entrevista condicional reexecuta os gates.
3. **Execute** — rodar o passo **[EXEC]** (executor lê o PRD; sem `PLAN_*.md`).
4. Review (condicional) — só após executor retornar 100% e dispatch MCP permitir.
5. Output (ledger verificado).

> Se durante `direct` o escopo exigir um plano de handoff formal, **avise o usuário** e sugira `full` — não fabrique um `PLAN_*.md` ad hoc no meio de `direct`.

### Execute mode

Entrada: um **`PLAN_*.md` pronto**. Artefatos esperados: (plano já existe) → diff de código → relatório do validador. **Não produz `PLAN_*.md`** (PRD D1). `talos_assert_after_plan` **não se aplica** (PRD D13).

1. **Parse / classify** — `talos_ping` → `talos_capabilities` → **`talos_classify_input`** no input (PRD D3/D6: o tipo é fato e precisa ser conhecido antes de travar o modo) → **`talos_preflight(<modo efetivo>)`** (PREREQ hard-fail intacto). A classificação determina o tipo: se for plano, o modo efetivo é `execute` e o preflight trava `execute`; se o input não for plano, auto-rotear (ver Fase 0, passo 2b) e o preflight trava o modo roteado. **`classify_input` sempre precede `preflight`** (o preflight trava o modo efetivo, não o pedido).
2. **Reverificar o plano na entrada** — `talos_verify_artifact` no `PLAN_*.md` (G1) + `talos_verify_template_conformance(artifact_type=plan)` (TC). Plano velho/manual/inválido **trava aqui** com `next_action` em linguagem de produto (PRD D11 — "autoria é livre, execução é gateada"). Sem reverificação válida não há dispatch.
3. **Executar** — rodar o passo **[EXEC]** (lê `PLAN_*.md`). `plan_execute` é aceito como **primeira fase** em `execute` (sem fase nova; PRD D13).
4. **Review (condicional)** — só após execução concluída e se `--review` → `talos_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `complete`.
5. **Output** — ledger verificado; `guarantee_level` = `full_pipeline` (PRD D12).

> `execute` **não replaneja**. Se o plano estiver incompleto/errado, o caminho é `full` (gerar plano novo), não consertar o plano dentro de `execute`.

### Interview-only mode

1. Se a entrada já for PRD válido, usar seu path. Se for `brainstorm`, criar primeiro um draft mínimo em disco com `packages/templates/PRD_TEMPLATE.md`, preservando as 6 seções canônicas e registrando o brainstorm em contexto/objetivo. Sem sprint vinculada (caso típico de brainstorm), preencher `**Sprint file**: Não aplicável (standalone)` e `Eval source: PRD §6 (standalone)` — nunca deixar o placeholder genérico do template sem resolver.
2. Verificar o draft com `talos_verify_artifact` e `talos_verify_template_conformance(artifact_type=prd)` (sem `require_sprint_file` — `interview-only` nunca exige sprint); path ausente/inválido bloqueia.
3. Invocar `prd_interview` no fio principal com `prd_path` válido; persistir respostas no mesmo artefato e reverificar.

> `interview-only` é entrevista **sem execução**: não há fase `plan_execute` nem `guarantee_level` no fluxo (nada de código a garantir). A autoria do esboço é documental e livre.

> **Próximo passo após PRD standalone maturo:** `interview-only` não planeja nem executa. Para implementar, o usuário invoca `talos-plan-handoff` standalone sobre esse PRD (fora do pipeline `full`/`direct`, que exigem sprint — ver `talos-plan-handoff` §"Fontes obrigatórias"), produzindo um `PLAN_*.md` com `Source mode: standalone`, e então roda `/talos execute plan "<path>"` para executar. `full`/`direct` rejeitam esse PRD na entrada por falta de sprint file (por design).

### Audit mode

Entrada: um `target` auditável, com flags opcionais `--handoff` e `--scope <descrição>`. Artefatos esperados: relatório de auditoria em resposta; se `--handoff`, plano Talos-style salvo em `.talos/plans/PLAN_AUDIT_<slug>.md`. **Não há execução, `plan_execute`, validator, repair, review nem `guarantee_level`.**

1. **Parse / target** — resolver target real em disco. Se o target não for localizável, parar com pedido objetivo de path/boundary.
2. **Pré-flight leve** — `talos_ping` → `talos_capabilities` → `talos_preflight(mode=audit)` para travar versão/família `talos-*`. Não chamar `talos_classify_input`: audit não roteia input para execução.
3. **Invocar `talos-audit` no fio principal** — carregar o `SKILL.md` real, auditar só o boundary informado, ler regras locais, detectar stack por manifests/configs/comandos reais, aplicar checklist universal e Ponytail pass final.
4. **Output** — relatório com stack detectada, regras consultadas, boundary, achados P0/P1/P2/P3 com `arquivo:linha`, gaps por área e limitações.
5. **Handoff opcional** — se `--handoff`, escrever `PLAN_AUDIT_*.md` **conforme ao `PLAN_TEMPLATE.md`** (cabeçalho com linha `| **PRD** | N/A — origem auditoria |`, ref a `BOUNDARY_PRD_PLAN.md`, §1–§6/§8, tasks `#### T01.`), derivado somente dos achados evidenciados — passa no gate TC e é consumível por `/talos execute plan`. Reportar o path e **parar aqui. Não chamar executor automaticamente.**

---

## Validação automática de PRD

O scan é **determinístico** e roda **dentro do MCP** (`talos_scan_prd`): a lista canônica de padrões §1-§5 e as exclusões de config (`exclude_if_line_contains`) são embutidas e mantidas no servidor — o orquestrador **não** reaplica padrões por conta própria, só consome o resultado. Não usar julgamento livre.

**Threshold = 1.** Se ≥ 1 padrão bloqueante → o orquestrador invoca `talos-prd-interview` no fio principal. **Gate G5:** se 0 padrões bloqueantes, registrar `Ambiguity scan: 0 padrões bloqueantes — entrevista pulada` no output. Não há decisão subjetiva de "tenho certeza, pulo".

---

## Decisão em aberto ≠ parada

Detalhe do caminho que a "Princípio de continuação automática" exige para decisão pendente de **qualquer fonte** (scan/entrevista/validação de plano/`PERGUNTAS_EM_ABERTO.md`/`DISCUSSAO_*.md`/backlog — a fonte não muda o tratamento):

1. **Garantir sprint file + PRD primeiro.** Em `full`/`direct`, se o PRD não existe, validar/criar primeiro o sprint file (quando o fluxo exigir sprint), então **gerar o PRD draft** com as decisões marcadas. A entrevista é **PRD-scoped**: roda **sobre** o PRD, nunca antes. Detectar decisão não antecipa nem pula a geração do PRD.
2. **Disparar `talos-prd-interview`** sobre o PRD — resolve via `talos_capabilities.question_prompt`, sem hardcode de host.
3. **Persistir após cada rodada** no mesmo PRD, reindexar §3–§6 e não repetir D* fechada.
4. **Propagar** ao PRD/plano/DEC/registro de origem.
5. **Reexecutar** os gates afetados (`talos_verify_artifact`/`talos_scan_prd`/TC) e **continuar** automaticamente.

Marcar TBD e adiar só se o usuário pedir **explicitamente** — nunca por iniciativa do orquestrador.

> `PERGUNTAS_EM_ABERTO.md` é verificado na validação de PRD; Q- aberta da sprint **não é blockage** — entra neste mesmo caminho.

---

## Output

O ledger é **verificado contra disco** (Gate G6). Cada artefato listado precisa existir. A linha `Guarantee level` declara o enum `guarantee_level` emitido pelo MCP (PRD D12) e aparece em `full`/`direct`/`execute` — todos pipeline completo (`full_pipeline`). `interview-only` não emite `guarantee_level` (entrevista sem execução).

```
✅ Talos: claude full sprint completed

📄 PRD: /path/to/PRD_S05_login.md            [verificado em disco]
📋 Plan: /path/to/PLAN_S05_login.md          [verificado em disco]
🚀 Output: [summary 1-2 linhas do executor]

Status:
  ✅ Preflight: passed [MCP: talos_preflight / G10]
  ✅ PRD artifact: passed [MCP: talos_verify_artifact / G1]
  ✅ Ambiguity scan: 2 padrões → entrevista executada [MCP: talos_scan_prd / G5]
  ✅ Template conformance: passed [MCP: talos_verify_template_conformance / TC]
  ✅ Plano generated [MCP: talos_verify_artifact + talos_verify_template_conformance]
  ✅ Dispatch plan_execute: passed [MCP: talos_lock_dispatch / G7+G8]
  ✅ After plan: passed [MCP: talos_assert_after_plan / G11]
  ✅ Validador frio: P0=0 P1=0 P2=1 P3=2 [executor + task-validator]
  ⏭️  Slice review: not applicable [MCP source: mode/flag]
  ✅ Guarantee level: full_pipeline [MCP: talos_preflight / D12]

Próximo passo:
  [ ] Validar executor output
  [ ] Rodar slice-review (opcional)
  [ ] Avançar para próxima sprint
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
- **PRD inválido** → reporta sections faltando, opção de continuar com warning.
- **Gate duro violado** → para, reporta qual gate (G1–G11) e o artefato/condição faltante.
- **Ambiguidades não resolvidas** → dispara entrevista, propaga e continua (ver "Decisão em aberto ≠ parada"). Não é parada.

---

## Skills envolvidas

`talos-backlog-generator` é a primeira fase documental para macro inputs em `full`/`direct` quando `routing.document_flow.priority = backlog_first`. Ele deve retornar `backlog_path`, `sprint_id` e `sprint_file_path`. Para `sprint`/`backlog-item`, o orquestrador resolve o sprint file existente via backlog. Para `prd`, `plan`, `execute`, `interview-only` e `audit`, não roda automaticamente; a cadeia continua a partir do artefato/input já recortado.

| Skill | Entrada | Saída (artefato) |
|-------|---------|------------------|
| `talos-backlog-generator` | macro input sem backlog canônico ou pedido explícito de backlog | `BACKLOG_MESTRE_*.md`, `SPRINT_S<NN>_*.md`, `sprint_id`, `sprint_file_path` |
| `talos-sprint-prd-generator` | `sprint_id`, `sprint_file_path`, backlog autoritativo | `PRD_*.md`, decisions_found |
| `talos-prd-interview` | prd_path, ambiguities | `PRD_*.md` atualizado, decisions |
| `talos-plan-handoff` | `prd_path`, `sprint_file_path`, código real | `PLAN_*.md` |
| `talos-audit` | target, flags (`--handoff`, `--scope`) | relatório de auditoria; `.talos/plans/PLAN_AUDIT_*.md` opcional sem execução |
| `talos-plan-execute` | plan_path (`full` / `execute`) | diff de código, evidência, `state_path` |
| `talos-direct-execute` | prd_path/spec/task (`direct`) | diff de código, evidência, `state_path` |
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
 ├─ PRD        → autoria documental no pai       → talos-sprint-prd-generator + talos_verify_artifact (G1)
 ├─ scan       → talos_scan_prd (G5) + TC        → entrevista se bloqueado ou --interview
 ├─ PLANO      → PRD + sprint file + código real → talos_verify_artifact + talos_verify_template_conformance
 ├─ G11        → talos_assert_after_plan         → próxima ação obrigatória = plan_execute
 ├─ EXECUÇÃO   → talos_lock_dispatch + sub-agent talos-plan-execute
 ├─ VALIDAÇÃO  → lock_validator + task-validator irmão
 │                └─ fail → findings-repair (budget 1, mesmo state_path) → validator final
 └─ REVIEW     → talos_lock_dispatch + sub-agent slice_review (se --review)
```

Em **`execute`** a cadeia começa direto na reverificação + execução (o plano é o input):

```
orquestrador
 ├─ MCP ping + capabilities                    → talos_ping + talos_capabilities
 ├─ classify_input                             → talos_classify_input (tipo prevalece; determina modo efetivo; auto-rotear se não-plano)
 ├─ preflight(<modo efetivo>)                  → talos_preflight (G10, PREREQ) — trava o modo efetivo, não o pedido
 ├─ REVERIFICA plano (entrada)                 → talos_verify_artifact + talos_verify_template_conformance (G1+TC; D11)
 ├─ EXECUÇÃO   → talos_lock_dispatch + sub-agent plan_execute  (primeira fase; assert_after_plan N/A — D13)
 ├─ VALIDAÇÃO  → lock_validator + task-validator irmão → repair opcional → terminal
 └─ REVIEW     → talos_lock_dispatch + sub-agent slice_review (se --review)
```

Regra de ouro: **um sub-agent por fase de execução, em série, blocking, sustentado por MCP**. O orquestrador espera cada sub-agent terminar antes do próximo e **nunca** trabalha em paralelo nem escreve código (Gate G9). Autoria documental (PRD/plano) é livre no fio principal **antes** do plano validado; depois, mãos atadas. Em `full`, `PLAN_*.md` validado obriga `plan_execute` no mesmo workflow (G11). `task-validator` ⟂ `slice-review` jamais coexistem. Progresso só por banner (string do MCP).

> Histórico de versões (detalhe de cada correção) e roadmap: [`CHANGELOG.md`](../../../../CHANGELOG.md) na raiz — fonte canônica.
