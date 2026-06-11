---
name: atlas-workflow-orchestrator
description: "Orquestra pipeline completo de desenvolvimento de features: /workflow <mode> <input-type> [flags]. Automatiza PRD generation → validação → entrevista (se necessário) → planejamento → execução → review (opcional). Pipeline orientado a artefato com gates duros: cada fase só conta se produzir arquivo verificável em disco."
category: Development Automation
---

# Atlas Workflow Orchestrator

Orquestra pipelines de desenvolvimento de features no projeto Atlas, automatizando a sequência de skills sob demanda com um único comando.

> **v0.3 — MCP como fonte obrigatória de status.** Cada gate materializado deve ser consultado via MCP antes de avançar: `atlas_ping`, `atlas_preflight`, `atlas_verify_artifact`, `atlas_scan_prd`, `atlas_verify_template_conformance`, `atlas_lock_dispatch` e `atlas_assert_after_plan`. Sem resposta MCP, sem resultado exigido ou status bloqueante → workflow abortado, sem fallback narrativo. Edge cases de ambiente (conflito plugin/nativo, MCP indisponível, estado corrompido, lock conflict e drift de versão) bloqueiam com causa, impacto e próxima ação segura.

## Sintaxe

```
/workflow <mode> <input-type> [flags]
```

### Modos

Três modos **canônicos de execução** — `full`, `direct`, `execute` (PRD §5 D1) — mais o modo `interview-only`, que permanece **separado** (entrevista sem execução; PRD D2, não é colapsado em `full`).

- **`full`** — pipeline completo: PRD → validação → entrevista (se necessário) → **plano (artefato obrigatório)** → executor → review (opcional)
- **`direct`** — pipeline enxuto: PRD → validação → entrevista (se necessário) → executor → review (opcional). **Não produz plano de handoff** — a diferença real para `full` é exatamente essa.
- **`execute`** — recebe um **`PLAN_*.md` pronto** e o executa **sem gerar plano** (PRD D1). Entrada = caminho de plano; reverifica o artefato + conformidade de template e despacha `plan_execute` direto. Não regera nem replaneja: ajustes de plano pedem `full`. `atlas_assert_after_plan` (gate pós-plano do `full`) **não se aplica** em `execute` — o plano já é o input; o equivalente é a reverificação na entrada (PRD D13). **Não há alias `plan`**: usar `plan` como modo é ambíguo com planejamento documental e deve ser rejeitado como modo inválido.
- **`interview-only`** — entrevista direta (ex: brainstorm, resolução de decisões). Entrevista **sem execução**: não usa `guarantee_level` no fluxo (não há execução de código a garantir). Permanece modo separado (PRD D2).

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
/workflow full backlog-item "S05"
→ Gera PRD para S05, valida, entrevista se necessário, cria PLAN_*.md, executa a partir do plano

/workflow direct prd "/path/to/PRD_S05.md" --review
→ Valida PRD, executa direto (sem handoff), roda review ao final

/workflow full idea "melhorar performance de listagem" --interview
→ Gera PRD de indicação, força entrevista, plano, executor

/workflow interview-only brainstorm "que tal dark mode?"
→ Entrevista direto, sem PRD prévio

/workflow execute plan "/path/to/PLAN_S05_login.md"
→ Reverifica o plano (artifact + TC), executa direto via plan_execute + validador frio. Não gera plano.
```

---

## Fase 0 — Pré-flight obrigatório (antes de qualquer fase)

Executar **antes** de iniciar o pipeline. Se qualquer item falhar, **parar e reportar** — nunca emular.

1. **Parse** dos argumentos `<mode> <input-type> [input] [flags]`. Se inválido ou `--help` → mostrar sintaxe e parar.
2. **Chamar MCP `atlas_ping`.** Se não responder, versão vier vazia, `version_check.status` vier bloqueado ou capacidades não listarem os gates exigidos pelo modo → abortar com erro de MCP indisponível/drift. Não seguir por prosa.
2a. **Chamar MCP `atlas_capabilities`.** Ler `host`, `subagent_dispatch`, `validator_dispatch`, `capabilities_flags` e `required_deps`. Determinar a **disponibilidade real** dos pré-requisitos essenciais neste host: o subagente do plugin é despachável? o MCP está vivo (ping ok)? Em hosts com `required_deps` (ex.: pi: `pi-mcp-adapter` + `pi-subagents`), confirmar que cada dep está presente; se faltar, o pré-requisito correspondente é `false`.
2b. **Chamar MCP `atlas_classify_input`** no input informado (`input_path`), **antes de rotear** (PRD D3/D6). `classify_input` é para **artefato em arquivo** (path em disco). A tool devolve `artifact_type` ∈ {`backlog`, `prd`, `plan`, `idea`, `unknown`} (verdade forte = TC de plano passa) e um `banner` de roteamento já pronto. **O tipo de input é fato e prevalece sobre o modo pedido** (intenção). Aplicar o roteamento:
   - **`plan` em `direct`/`full`** → auto-rotear para **`execute`** (executa o plano pronto; nunca gera plano de plano, mesmo com arquivo renomeado — PRD D6). **Não bloqueia**: ecoar o banner de troca `▸ atlas: roteamento · pediu={x} mas input={y} → modo=execute`.
   - **`execute` sobre `backlog`/`prd`** → auto-rotear para **`full`** (ou `direct` conforme o pedido), pois não há plano a executar. **Não bloqueia**: ecoar o banner de troca correspondente.
   - **`idea` (`status: not_a_file`)** → o input é **descrição livre, não path**. **Não é `unknown` nem BLOCK**: roteia para **`direct`** (implementa a partir da descrição/spec). Quando o usuário passou uma idea inline (input-type `idea`), você pode até **não chamar** `classify_input` (ele é para arquivos) e seguir direto em `direct`/`full` conforme o pedido — nunca tratar a descrição como path ilegível.
   - **`unknown`** (arquivo existe mas não classifica) → **não adivinhar**: ecoar o banner de input ilegível e **pedir esclarecimento** ao usuário (qual arquivo/tipo). Não inventa modo.
   - Tipo coincide com o modo → segue sem troca (ecoar o banner `roteia` simples).
   O `banner` vem do MCP; o orquestrador **só ecoa** (ver "Protocolo de banner").
3. **Chamar MCP `atlas_preflight`** com `run_id`, `<mode>`, `host`, `expected_version` (quando o host reportar versão) e `host_capabilities` (a disponibilidade real apurada no passo 2a — ex.: `{"subagent_available":false}` se a dep do subagente faltar). O resultado é a fonte obrigatória de pré-requisitos, modo, versão, lock e ids oficiais `atlas-*`.
   - **Gate `PREREQ` (DEC-004): pré-requisito essencial ausente é hard-fail.** Se `gate:"PREREQ"`/`status:"blocked"`, **abortar em `ready`** (antes de qualquer fase/dispatch) com `missing_prerequisites`, causa, impacto e `next_action`. **Proibido degradar, rodar validator inline ou prosseguir sem isolamento, em qualquer tamanho de tarefa.** Só capability não-essencial (`todo`) segue sem o recurso.
   ```text
   ⛔ Pré-flight falhou (PREREQ)
      Host: <host>   Faltando: <missing_prerequisites>
      Motivo: host sem pré-requisito essencial de determinismo (subagente/MCP)
      Ação: <next_action> (ex.: instalar pi-mcp-adapter + pi-subagents; ou usar host com subagente+MCP nativos)
   ```
4. **Usar a cadeia única `atlas-*`.** Cliente (Claude Code, Cursor, Codex App) é host de execução, não família de skills. Não existe roteamento por cliente.
5. **Carregar defaults do pacote do plugin** (`defaults/paths.md` e `references/subagent_dispatch.md`). Não exigir config na raiz do repositório usuário.
6. **Verificar disponibilidade dos ids `atlas-*`.** Para cada skill exigida pelo modo, confirmar que o id exato é **invocável** no host. Para as skills de **execução/validação/review** (`plan_execute`, `direct_execute`, `task_validator`, `findings_repair`, `slice_review`), confirmar também que são **despacháveis pelo verbo nativo do host** — leia `atlas_capabilities.subagent_dispatch.mechanism` (não assuma "Agent tool"; no Codex é `spawn_agent(agent_type)`, no opencode `@<name>`, no pi `subagent({...})`). No Codex, `$<skill>` é ativação in-context de skill e **não** conta como sub-agent isolado para execução. Para as skills **documentais** (`prd_generator`, `prd_interview`, `plan_handoff`), basta invocabilidade no fio principal; não exigir despachabilidade como sub-agent.
   - **Skill ausente é bloqueio** (Gate G10): não substitua por skill nativa, variante antiga ou prompt inline.
   - **Conflito plugin × skill nativa:** use somente o id exato retornado pelo preflight. Se o host não permitir comprovar que a skill vem do plugin esperado, aborte e peça remoção/desativação manual da nativa; não resolva por tentativa silenciosa.
   - **Nunca substituir por variante de executor** (Gate G10).
   - Resolver como o sub-agent carregará o `SKILL.md` real do id antes de executar (ver `references/subagent_dispatch.md`).
   ```text
   ⛔ Pré-flight falhou
      Skill exigida ausente: <id exato>
      Motivo: id não despachável neste host
      Ação: instalar/ativar o plugin ou corrigir o pacote atlas-* disponível no host
   ```
   **PROIBIDO o fallback "implementação direta" / "contratos equivalentes inline".** Não existe caminho onde o orquestrador faz plano ou código no próprio fio. Emulação inline e fallback direto são a falha-raiz que esta skill proíbe — se não há sub-agent, **para**. (Gate G7.)
8. **Rejeitar conflito de modo:** se o pedido tiver `full`/`direct` junto com "sem patch", "sem editar código", "planejamento apenas", "handoff only" ou equivalente, **pare antes de gerar artefatos**. `full`/`direct` executam `plan_execute`; não existe interpretação plan-only implícita.
9. **Declarar o plano de execução** (1 bloco curto): `run_id`, modo, **ids exatos de cada sub-agent**, sequência de fases, artefatos esperados e tools MCP que sustentarão cada gate. Só então iniciar a Fase 1.

---

## Papel do orquestrador (fronteira de determinismo pela mutação de código)

O orquestrador **coordena a execução**, não implementa código. Pense nele como um maestro: aponta para cada músico (sub-agent) na ordem certa e espera cada um terminar. **Ele nunca pega o instrumento de código.**

A fronteira de determinismo é a **mutação de código** (PRD D10), e ela tem **duas fases** com regras diferentes:

- **ANTES do plano validado — autoria documental é livre no agente principal.** O orquestrador (agente principal) **pode** autorar o PRD, conduzir a entrevista e **escrever o `PLAN_*.md` diretamente**. Fases puramente documentais (gerar/maturar PRD, entrevistar, redigir plano) **não exigem** despacho de sub-agent. Documento não é código: autoria não muta o produto. **Ao autorar/finalizar um PRD no fio principal, estampar `| Status | Aprovado para implementação |`** — é o `required_status` que o gate TC exige (ver Validate PRD). Sem isso o PRD sai `Draft` e trava o TC em 2-3 rodadas de correção. (O `atlas-sprint-prd-generator` já faz isso; a autoria inline deve seguir igual.)
- **DEPOIS do plano validado (`atlas_verify_artifact` + TC `passed`) — mãos atadas fortes.** A partir daí o orquestrador **NÃO** edita PRD/plano, **NÃO** edita código, **NÃO** roda comando mutante. Só **coordena a execução**: despachar sub-agent, ler artefato para verificar gate, ecoar banner, montar o output final.
- **Execução de código é SEMPRE gateada — nunca afrouxa.** Toda mutação de código vive obrigatoriamente em sub-agent `plan_execute` (blocking, um por vez) + validador frio `task_validator` (PRD D10). O orquestrador **nunca escreve código**, em nenhuma fase, em nenhum modo. Isto não muda com a autoria documental livre acima.

- **Permitido:** parse de args; classificar input; autorar PRD/entrevista/`PLAN_*.md` **enquanto o plano não foi validado**; despachar sub-agent (blocking, um por vez); ler artefato em disco para verificar gate; ecoar banner; montar o output final.
- **Proibido (Gate G9):** escrever/editar **código**; rodar comando mutante (`flutter`, `test`, `git add/commit`); editar PRD/plano **depois** do plano validado; implementar "em paralelo"; usar `run_in_background` para fases do pipeline.
- **Dispatch blocking:** despacha → **espera o retorno** → verifica gate → próxima fase. Nunca dois sub-agents simultâneos. Nunca trabalhar enquanto um sub-agent roda.

### Verbo de dispatch é host-agnóstico (não assuma "Agent tool")

O **mecanismo** de despacho de sub-agent **varia por host** — leia `subagent_dispatch.mechanism`, `.example` e `validator_dispatch` de `atlas_capabilities` e use o **verbo nativo do host**. Não hardcode o verbo do Claude. Mapeamento (ilustrativo; a fonte de verdade em runtime é `atlas_capabilities`):

- **claude:** `Agent(subagent_type: "atlas-<exec>", prompt: ...)`
- **codex:** `spawn_agent(agent_type: "atlas-<exec>", items: [{ type: "text", text: "<state_path ou task>" }])` usando custom agent nativo `.codex/agents/atlas-<exec>.toml`. No Codex atual, sub-agents não recebem `spawn_agent`; portanto `validator_dispatch.topology = sibling`: o executor retorna `validator_handoff_required` com `state_path`, e o orquestrador despacha `atlas-task-validator` como sub-agent irmão isolado.
- **opencode:** `@atlas-<exec>` (ou auto por description)
- **pi:** `subagent({ agent: "atlas-<exec>", task, context: "fresh" })`
- **generic:** subagente nativo do host

Onde `<exec>` é o id resolvido da fase (`plan-execute`, `direct-execute`, `slice-review`, `task-validator`).

> **Rodar a mutação de código no fio principal é violação do Gate G9 — em QUALQUER host.** Ausência da "Agent tool" (porque o host não é Claude) **não** é licença para executar inline: é sinal de que você deve usar o **verbo de dispatch daquele host**. No Codex, `$atlas-*` sozinho não isola contexto; use `spawn_agent`. Se o host não expõe nenhum mecanismo de sub-agent (preflight `subagent_available:false`), o gate PREREQ já abortou em `ready` — você nunca chega aqui sem isolamento.

Se você (orquestrador) está prestes a editar **código**, **pare**: esse trabalho é do sub-agent de execução. Despache-o (verbo nativo do host) e espere. (Autoria de PRD/plano antes da validação é a única autoria permitida no fio principal.)

## Protocolo de banner (única comunicação de progresso)

O orquestrador comunica progresso **apenas** por **banner de fase de linha única** no formato `▸ atlas: <fase> · <ação> [· <detalhe>]` (PRD D7/D8). Regras:

- **A string vem do MCP.** Cada gate de tool (`atlas_preflight`, `atlas_classify_input`, `atlas_scan_prd`, `atlas_verify_artifact`, `atlas_verify_template_conformance`, `atlas_lock_dispatch`, `atlas_assert_after_plan`) devolve o campo `banner` pronto, derivado do banco canônico de 11 templates no MCP. O orquestrador **só ECOA** essa string — sem reescrever, traduzir ou enfeitar (PRD D9).
- **Proibido narrar intenção entre gates.** Nada de "vou despachar o sub-agent...", "agora vou...", "deixa eu verificar...". Qualquer prosa de intenção entre fases é **regressão** (PRD §6). A sessão do usuário é uma sequência limpa de linhas `▸ atlas: ...`.
- **Uma linha por transição**, em pt-BR, prefixada por `▸ atlas:`. Os 11 eventos do banco: roteia, roteia c/ troca, preflight ok, preflight fail (`BLOCK`), prd scan, entrevista, plano, exec, validação, review, done.
- Preflight bloqueado → ecoar o banner `preflight · BLOCK · <motivo>`; PRD com lacunas → banner `prd · <n> lacunas`. O detalhe livre só entra no slot `<detalhe>` quando o template tem um.

> O banner **não substitui** os gates de execução: ele é a camada de comunicação. Gates duros (G1–G11, PREREQ, TC) continuam decidindo o fluxo por contrato MCP, não pela string.

## Gates duros (HARD GATES)

Regras inegociáveis. Violação = parar, não contornar.

| # | Gate | Aplica a |
|---|------|----------|
| G1 | **Artefato antes de avançar.** Uma fase só conta como concluída se `atlas_verify_artifact` aprovar o arquivo produzido. Leitura local pode complementar, mas não substitui o resultado MCP. | todas |
| G2 | **Em `full`, proibido escrever qualquer código (Dart) antes de existir `PLAN_*.md` validado em disco.** Se for escrever código sem plano, o modo correto é `direct` — então pare e avise o usuário do mismatch. | `full` |
| G3 | **Skills invocadas de verdade — autoria documental no fio principal, execução de código em sub-agent.** **Fases documentais ANTES do plano validado** (gerar/maturar PRD, entrevistar, redigir `PLAN_*.md`) podem ser conduzidas pelo orquestrador (agente principal) carregando a skill correspondente; não exigem despacho de sub-agent (autoria não muta código). **Fases de execução de código** invocam a skill via **sub-agent despachado** (verbo nativo do host de `atlas_capabilities` — não necessariamente "Agent tool"), que carrega o `SKILL.md` do id resolvido antes de agir — prompt "aja como X" não basta. Sempre proibido absorver o artefato "implicitamente" (ex: plano dentro do §6 do PRD não substitui `PLAN_*.md`): o artefato exigido pelo modo tem que existir em disco e passar G1/TC. | todas |
| G4 | **Validador frio é sempre sub-agent separado.** Se `validator_dispatch.topology = nested`, o executor despacha `task_validator`, consome o veredito/findings dentro do próprio loop de execução e só reporta ao orquestrador depois do estado terminal da slice. Se `topology = sibling` (Codex atual), o executor escreve `state_path` e para; o orquestrador despacha `task_validator` como sub-agent irmão isolado, trava `atlas_lock_validator` e, em caso de `fail`, roda `repair_start` + despacha **`atlas-findings-repair`** (não o executor completo) antes do **2º e último** validator. `validator_run_id`/`repair_run_id` são obrigatórios para fechar cada slot ativo. O executor nunca valida o próprio trabalho no mesmo contexto. | execução |
| G5 | **Scan de ambiguidade determinístico e logado.** A decisão de pular a entrevista só é válida se `atlas_scan_prd` retornar **zero** padrões e esse resultado MCP estiver no ledger. Não existe "pular porque tenho certeza". `--interview` sempre força. | validação PRD |
| TC | **Conformidade de template via MCP.** PRD e PLAN só avançam como artefatos documentais se `atlas_verify_template_conformance` retornar `passed` e `pending_count: 0`. Pendência bloqueia com `next_action`. | PRD + plano |
| G6 | **Status verificado, não auto-reportado.** O ✅ de cada item no output só pode ser marcado após confirmar o artefato em disco. Faltou artefato exigido pelo modo → status final `incomplete`, nunca `completed`. | output |
| G7 | **Execução de código roda SEMPRE como sub-agent despachado (verbo nativo do host, lido de `atlas_capabilities`), nunca no contexto do orquestrador.** A **autoria** do `PLAN_*.md` pode ser feita pelo orquestrador no fio principal **enquanto o plano não foi validado** (autoria documental, PRD D10) — mas o plano só vira confiável após `atlas_verify_artifact` + TC `passed`. A **execução do plano** (`plan_execute`) e qualquer mutação de código vão obrigatoriamente a sub-agent. Antes de iniciar/concluir fase de execução, usar `atlas_lock_dispatch`; fase fora de ordem ou paralela bloqueia. Depois do plano validado, o orquestrador não edita mais o plano (mãos atadas fortes). | plano + execução |
| G8 | **Ordem fixa de validação: `task-validator` ANTES, `slice-review` POR ÚLTIMO. Nunca em paralelo.** Conclusão de `plan_execute` usa `atlas_lock_dispatch` com `validator_status: passed`; review só inicia após execução concluída. | validação + review |
| PREREQ | **Pré-requisitos de determinismo (hard-fail, DEC-004).** `atlas_preflight` verifica, **antes de tudo**, se o host tem subagente + MCP (essenciais). Ausente (ex.: pi sem `pi-mcp-adapter`/`pi-subagents`, host MCP-only sem subagente) → aborta em `ready` com `missing_prerequisites`/`next_action`. Sem degradação, sem validator inline, qualquer tamanho. `todo` não-essencial segue sem mirror. | roteamento |
| G10 | **Família única atlas-*, id exato.** Modo, versão, lock e ids oficiais vêm de `atlas_preflight`, nunca do host. Skill ausente, conflito de origem, lock ativo ou drift de versão → aborta com causa/impacto/próxima ação. | roteamento |
| G9 | **Fronteira de determinismo pela mutação de código.** O orquestrador **NUNCA** escreve/edita **código** nem roda comando mutante (flutter/test/git write), em qualquer fase ou modo — execução de código é sempre do sub-agent. **Autoria documental** (PRD, entrevista, `PLAN_*.md`) é permitida no fio principal **somente ANTES do plano validado**; uma vez que o plano passa `atlas_verify_artifact` + TC, **mãos atadas fortes**: o orquestrador não edita mais PRD/plano/código, só coordena execução (despachar sub-agent, ler artefato para verificar gate, ecoar banner, montar output final). **NÃO** "ajuda" o sub-agent de execução. **Dispatch é blocking**: despacha **um** sub-agent por vez (verbo nativo do host de `atlas_capabilities`, em foreground), **espera o retorno**, só então segue. Proibido `run_in_background` para fases do pipeline e proibido implementar "em paralelo" enquanto um sub-agent roda. Se o orquestrador tocar em **código** = G9 violado, **inclusive rodar a mutação inline porque o host não tem "Agent tool"** (use o verbo daquele host). | orquestrador |
| G11 | **`full` deve executar depois do plano.** Depois que `PLAN_*.md` passa G1/G2/G7/TC, chamar `atlas_assert_after_plan`; a próxima ação obrigatória é despachar `plan_execute` como sub-agent blocking. Proibido completed só com handoff. | `full` |

---

## Fluxo de execução

### Full mode

Artefatos esperados (em ordem): `PRD_*.md` → (`PRD_*.md` atualizado) → `PLAN_*.md` → diff de código → relatório do validador.

1. **Parse input** — resolve backlog-item/idea para contexto de sprint.
2. **Generate PRD** — invocar o id resolvido para `prd_generator`, depois chamar `atlas_verify_artifact` no `PRD_*.md`.
3. **Validate PRD** — chamar `atlas_scan_prd` e `atlas_verify_template_conformance(artifact_type=prd, required_status=Aprovado para implementação)` quando o PRD for avançar. G5 e TC entram no ledger com fonte MCP.
4. **Interview (condicional)** — se `atlas_scan_prd` retornar bloqueante, TC bloquear ou `--interview` → invocar o id resolvido para `prd_interview`, depois reexecutar `atlas_verify_artifact`, `atlas_scan_prd` e TC no PRD atualizado.
5. **Plan** — `atlas_lock_dispatch(action=start, phase=plan_handoff)`, carregar/invocar `plan_handoff` no fio principal para redigir `PLAN_*.md`, depois chamar `atlas_verify_artifact` e `atlas_verify_template_conformance(artifact_type=plan)`. Concluir a fase com `atlas_lock_dispatch(action=complete, phase=plan_handoff)`. **Nenhuma linha de código pode ter sido escrita até aqui.**
   - **G11:** se `PLAN_*.md` foi validado, chamar `atlas_assert_after_plan`. Se a próxima ação não for `dispatch_plan_execute_blocking`, abortar.
6. **Validate plan** — se há gaps → aplica a Lógica de decisão (A/B/C).
7. **Execute** — `atlas_lock_dispatch(action=start, phase=plan_execute)`, despachar `plan_execute` como sub-agent lendo o `PLAN_*.md`. Se `validator_dispatch.topology = nested`, o executor dispara `task_validator` filho, consome o feedback dentro do próprio loop e só devolve ao orquestrador o resultado terminal da execução. Se `topology = sibling`, o executor retorna `validator_handoff_required` com `state_path`; o orquestrador usa `atlas_lock_validator` para despachar **um** `task_validator` por vez, fechar o retorno com `validator_run_id`, e se o veredito for `fail`, chamar `atlas_lock_validator(action=repair_start, state_path=...)`, despachar `atlas-findings-repair`, fechar com `repair_run_id` e só então rodar o **2º e último** validator. Ao obter `passed` ou `passed_with_observations`, concluir com `atlas_lock_dispatch(action=complete, phase=plan_execute, validator_status=<terminal>)`. Status diferente bloqueia review e output completed.
8. **Review (condicional)** — somente após execução concluída e se `--review` → `atlas_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `atlas_lock_dispatch(action=complete, phase=slice_review)`.
9. **Output** — ledger verificado com fonte MCP por gate/fase (ver "Output") + próximos passos.

### Direct mode

Artefatos esperados: `PRD_*.md` → (atualizado) → diff de código → relatório do validador. **Sem `PLAN_*.md`** — por design.

1. Parse / Generate PRD (se necessário) + `atlas_verify_artifact`.
2. Validate PRD → `atlas_scan_prd` + `atlas_verify_template_conformance`; entrevista condicional reexecuta os gates.
3. Execute — `atlas_lock_dispatch(action=start, phase=plan_execute)`; despacha `plan_execute` direto a partir do PRD; conclui com `atlas_lock_dispatch(action=complete, phase=plan_execute, validator_status=passed)`.
4. Review (condicional) — só após executor retornar 100% e dispatch MCP permitir.
5. Output (ledger verificado).

> Se durante `direct` o escopo exigir um plano de handoff formal, **avise o usuário** e sugira `full` — não fabrique um `PLAN_*.md` ad hoc no meio de `direct`.

### Execute mode

Entrada: um **`PLAN_*.md` pronto**. Artefatos esperados: (plano já existe) → diff de código → relatório do validador. **Não produz `PLAN_*.md`** (PRD D1). `atlas_assert_after_plan` **não se aplica** (PRD D13).

1. **Parse / classify** — `atlas_ping` → `atlas_capabilities` → **`atlas_classify_input`** no input (PRD D3/D6: o tipo é fato e precisa ser conhecido antes de travar o modo) → **`atlas_preflight(<modo efetivo>)`** (PREREQ hard-fail intacto). A classificação determina o tipo: se for plano, o modo efetivo é `execute` e o preflight trava `execute`; se o input não for plano, auto-rotear (ver Fase 0, passo 2b) e o preflight trava o modo roteado. **`classify_input` sempre precede `preflight`** (o preflight trava o modo efetivo, não o pedido).
2. **Reverificar o plano na entrada** — `atlas_verify_artifact` no `PLAN_*.md` (G1) + `atlas_verify_template_conformance(artifact_type=plan)` (TC). Plano velho/manual/inválido **trava aqui** com `next_action` em linguagem de produto (PRD D11 — "autoria é livre, execução é gateada"). Sem reverificação válida não há dispatch.
3. **Executar** — `atlas_lock_dispatch(action=start, phase=plan_execute)`; despachar `plan_execute` como sub-agent blocking lendo o `PLAN_*.md`. A validação segue `validator_dispatch`: nested dentro do executor quando suportado, sibling pelo orquestrador no Codex atual. Ao obter validator `passed`, concluir com `atlas_lock_dispatch(action=complete, phase=plan_execute, validator_status=passed)`. `plan_execute` é aceito como **primeira fase** em `execute` (sem fase nova; PRD D13).
4. **Review (condicional)** — só após execução concluída e se `--review` → `atlas_lock_dispatch(action=start, phase=slice_review)`, despachar `slice_review`, depois `complete`.
5. **Output** — ledger verificado; `guarantee_level` = `full_pipeline` (PRD D12).

> `execute` **não replaneja**. Se o plano estiver incompleto/errado, o caminho é `full` (gerar plano novo), não consertar o plano dentro de `execute`.

### Interview-only mode

1. Entrevista direta (sem PRD anterior) — invoca o id resolvido para `prd_interview`.
2. Gera PRD esboço (opcional).

> `interview-only` é entrevista **sem execução**: não há fase `plan_execute` nem `guarantee_level` no fluxo (nada de código a garantir). A autoria do esboço é documental e livre.

---

## Validação automática de PRD

O scan é **determinístico**. Marca ambiguidade quando uma seção contém qualquer padrão abaixo (lista canônica embutida no MCP):

- **§1 Contexto e objetivo:** `TBD`, `a confirmar`, `talvez`, `não definido`
- **§2 Escopo:** `pode ser`, `depende de`, `ainda não`, `incompleto`
- **§3 Decisões:** vazio/conteúdo mínimo, `vago`
- **§4 Fluxos e cenários UX:** `a definir`, `gap`, `depende de`
- **§5 Contrato funcional e invariantes:** `ainda não definido`, `mock apenas`, `a confirmar`

Antes de contar bloqueantes, aplicar exclusões estreitas do config (`exclude_if_line_contains`, hoje `depende de plano`) para frases de sucesso/resultado que descrevem dependência operacional já planejada. Não usar julgamento livre: a exclusão precisa estar no config e ser logada.

**Threshold = 1.** Se ≥ 1 padrão bloqueante → o orquestrador invoca `atlas-prd-interview` no fio principal. **Gate G5:** se 0 padrões bloqueantes, registrar `Ambiguity scan: 0 padrões bloqueantes — entrevista pulada` no output. Não há decisão subjetiva de "tenho certeza, pulo".

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

O ledger é **verificado contra disco** (Gate G6). Cada artefato listado precisa existir. A linha `Guarantee level` declara o enum `guarantee_level` emitido pelo MCP (PRD D12) e aparece em `full`/`direct`/`execute` — todos pipeline completo (`full_pipeline`). `interview-only` não emite `guarantee_level` (entrevista sem execução).

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
  ✅ Guarantee level: full_pipeline [MCP: atlas_preflight / D12]

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
⚠️  Workflow: <mode> <input-type> aborted
   Gate MCP: <tool MCP ou gate>
   Status: <blocked|missing|unavailable>
   Causa: <causa provável retornada pelo MCP ou indisponibilidade da fonte primária>
   Impacto: <por que a fase não pode avançar sem risco de ledger falso>
   Próxima ação permitida: <next_action retornado pelo MCP ou restaurar serviço MCP>
```

Se `full` gerou `PLAN_*.md` mas não despachou `plan_execute`, o cabeçalho deve ser:

```
⚠️  Workflow: full <input-type> incomplete
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
| `atlas-backlog-generator` | ideia/prompt/conversa/briefing | `BACKLOG_MESTRE_*.md` |
| `atlas-sprint-prd-generator` | sprint_id/indicação | `PRD_*.md`, decisions_found |
| `atlas-prd-interview` | prd_path, ambiguities | `PRD_*.md` atualizado, decisions |
| `atlas-plan-handoff` | prd_path | `PLAN_*.md` |
| `atlas-plan-execute` | plan_path (full / **execute**) ou prd_path (direct) | diff de código, evidência |
| `atlas-slice-review` | diff/output | review_feedback |

**Sub-agent frio (Gate G4):** `atlas-task-validator` é verificado no pré-flight pelo orquestrador e sempre roda isolado. Em hosts com `validator_dispatch.topology = nested`, ele é filho do executor e o feedback fecha dentro do loop do próprio executor; em Codex atual (`topology = sibling`), ele é sub-agent irmão despachado pelo orquestrador a partir do `state_path` retornado pelo executor.

---

## Configuração

Plugin usa configuração embutida no MCP para:
- mapear skills `atlas-*`;
- validar padrões de ambiguidade;
- declarar sequências por modo + artefatos esperados;
- aplicar gates duros.

Se o MCP não responder ou reportar drift, o pacote está inválido: abortar no pré-flight. Não cair para defaults implícitos.

---

## Ordem de sub-agents (resumo executável)

```
orquestrador
 ├─ MCP ping + preflight                         → atlas_ping + atlas_preflight (G10)
 ├─ PRD        → sub-agent                       → atlas_verify_artifact (G1)
 ├─ scan       → atlas_scan_prd (G5) + TC        → entrevista se bloqueado ou --interview
 ├─ PLANO      → lock_dispatch + sub-agent       → atlas_verify_artifact + atlas_verify_template_conformance
 ├─ G11        → atlas_assert_after_plan         → próxima ação obrigatória = plan_execute
 ├─ EXECUÇÃO   → atlas_lock_dispatch + sub-agent plan_execute
 │                └─ task-validator (sub-agent frio, G4) ANTES do relatório (G8)
 │                   findings → reparo limitado → executor retorna
 └─ REVIEW     → atlas_lock_dispatch + sub-agent slice_review (se --review)
```

Em **`execute`** a cadeia começa direto na reverificação + execução (o plano é o input):

```
orquestrador
 ├─ MCP ping + capabilities                    → atlas_ping + atlas_capabilities
 ├─ classify_input                             → atlas_classify_input (tipo prevalece; determina modo efetivo; auto-rotear se não-plano)
 ├─ preflight(<modo efetivo>)                  → atlas_preflight (G10, PREREQ) — trava o modo efetivo, não o pedido
 ├─ REVERIFICA plano (entrada)                 → atlas_verify_artifact + atlas_verify_template_conformance (G1+TC; D11)
 ├─ EXECUÇÃO   → atlas_lock_dispatch + sub-agent plan_execute  (primeira fase; assert_after_plan N/A — D13)
 │                └─ task-validator (sub-agent frio, G4) ANTES do relatório (G8)
 └─ REVIEW     → atlas_lock_dispatch + sub-agent slice_review (se --review)
```

Regra de ouro: **um sub-agent por fase de execução, em série, blocking, sustentado por MCP**. O orquestrador espera cada sub-agent terminar antes do próximo e **nunca** trabalha em paralelo nem escreve código (Gate G9). Autoria documental (PRD/plano) é livre no fio principal **antes** do plano validado; depois, mãos atadas. Em `full`, `PLAN_*.md` validado obriga `plan_execute` no mesmo workflow (G11). `task-validator` ⟂ `slice-review` jamais coexistem. Progresso só por banner (string do MCP).

## Changelog

- **v0.6.2** — Adiciona `atlas-backlog-generator` como skill documental explícita para criar backlog mestre a partir de ideia/prompt/conversa, fora da cadeia automática do workflow e sem invocação implícita. O backlog usa `BACKLOG_MESTRE_TEMPLATE.md` com MoSCoW, esforço x ganho, dependências, riscos e próxima sprint executável; quando o usuário não informa path, salva em `.atlas/backlog/BACKLOG_MESTRE_<slug>.md`. O mapa de skills do MCP passa a declarar `backlog_generator`, mas execução automática do pipeline permanece PRD → entrevista → plano → execução → validação fria.
- **v0.4.1** — Três modos canônicos de execução: adiciona **`execute`** (executa um `PLAN_*.md` pronto sem gerar plano; reverifica artefato + TC na entrada; `assert_after_plan` não se aplica, PRD D13). `interview-only` permanece modo separado e não usa `guarantee_level` no fluxo (entrevista sem execução). **Roteamento por tipo de input** (Fase 0): `atlas_classify_input` classifica `backlog|prd|plan|unknown` e o tipo prevalece sobre o modo pedido (PRD D3/D6) — `PLAN_*.md` em `direct`/`full` (mesmo renomeado) auto-roteia para `execute`; `execute` sobre backlog/PRD roteia para `full`/`direct`; `unknown` pede esclarecimento; trocas avisam por banner sem bloquear. **Protocolo de banner**: comunicação de progresso só por banner de linha única `▸ atlas: <fase> · <ação>`, string vinda do MCP (campo `banner` dos gates), orquestrador só ecoa; proibido narrar intenção entre gates. **Fronteira documental-no-agente-principal** (G3/G7/G9): autoria de PRD/entrevista/plano é livre no fio principal **antes** do plano validado; **depois** do plano validado (artifact + TC) o orquestrador fica de mãos atadas fortes; execução de código continua **sempre** em sub-agent `plan_execute` + validador frio (não afrouxa).
- **v0.3.0** — Família única `atlas-*`; remove o lock MCP de família; `atlas_preflight` trava modo/versão/ids sem família; `atlas-task-validator` vira subagent com boundary `.atlas/state/<run_id>/<slice>.json`; `atlas-slice-review` só roda com `--review`.
- **v0.2.0-dev** — S10: orquestrador usa MCP como fonte obrigatória de status em preflight, PRD, scan, conformidade, dispatch, pós-plano, execução, review e ledger final; falha MCP aborta sem fallback narrativo.
- **v0.1.10** — Config/defaults empacotados no plugin; sub-agent deve carregar o `SKILL.md` real do id resolvido; G5 ganha exclusão estreita para falso positivo `depende de plano`; executor permanece o `plan_execute` exato da família, sem variante.
- **v0.1.9** — Histórico pré-v0.3: removeu exceção cross-family e passou a abortar sem fallback quando uma skill oficial estivesse ausente.
- **v0.1.8** — Limita o workflow às famílias `claude`, `cursor` e `codex`, clarifica `task_validator` como sub-agent filho de `plan_execute` e torna Open Questions apenas bloqueio/aviso fora do pipeline.
- **v0.1.7** — Gate G11: em `full`, após `PLAN_*.md` validado, `plan_execute` é a próxima ação obrigatória; proíbe finalizar só com handoff e rejeita `full/direct` com "sem patch"/"só plano".
- **v0.1.6** — Histórico pré-v0.3: sincronizou versões/manifests e reforçou ids oficiais para cumprir G10.
- **v0.1.5** — Histórico pré-v0.3: corrigiu roteamento por host e reforçou id exato por run.
- **v0.1.4** — Orquestrador de mãos atadas. Gate G9 (orquestrador é coordenador: proibido editar código/rodar comando mutante/implementar em paralelo; dispatch blocking, um sub-agent por vez, sem `run_in_background`). G7 estendido ao `slice-review` (deve ser sub-agent despachado, não revisão inline). Corrige GF08: orquestrador implementou inline em paralelo ao sub-agent de execução (contexto 87%) e fez slice-review inline.
- **v0.1.3** — Força sub-agent. Gate G7 (plano e execução despachados como sub-agent, nunca inline; `PLAN_*.md` deve conformar ao template da skill `plan_handoff`). Gate G8 (ordem fixa: `task-validator` antes/dentro do executor, `slice-review` por último, nunca em paralelo). Fase 0 reforçada: matou o fallback "implementação direta / contratos equivalentes inline" — host sem sub-agent despachável **aborta**. Corrige falhas observadas no GF07 (plano sem template, validator+slice em paralelo, fallback inline no Cursor).
- **v0.1.2** — Pipeline orientado a artefato. Adicionados: Fase 0 pré-flight (verifica invocabilidade, proíbe emulação inline), Gates duros G1–G6, scan de ambiguidade determinístico (mata o escape hatch "tenho certeza"), validador frio obrigatório como sub-agent, ledger verificado contra disco. `direct` explicitamente não produz `PLAN_*.md`.
- **v0.1.1** — `/workflow` slash command.
- **v0.1.0** — MVP (Claude skills).

## Próximas fases

- **v0.4** hardening de empacotamento e smoke multi-host
- **v1.0** contrato estável de workflow
