# Plano 04 - Revisão fria como último passo da skill de backlog

**Pack:** ../GUIDE.md

**Objetivo do plano:** ao terminar de escrever, a skill despacha um subagente frio com mandato canônico versionado, que audita e corrige todo o output daquela execução e devolve o relatório ao chamador.

**Resultado esperado:** hoje nada confronta backlog e sprint files contra o código antes da execução; depois, nenhum backlog é entregue sem ter sido auditado por um agente que não viu a conversa que o originou.

**Cenários servidos:** CN4.

**Fronteira de entrada:** CN1.

**Fecha neste plano:** CN4, VC2, VC3, INV3, INV4.

**Dependências:** Plano 03.
**Natureza:** OBRIGATÓRIO
**Ativação:** sempre
**Risco:** alto
**Status:** CONCLUÍDO (2026-08-06)

> Desenho fechado (entrevista 2026-08-06, mesmo padrão do `create-guide`): o mandato é um prompt em `references/`, despachado ao **subagente genérico/default do host** — o oposto de um agente registrado da família `talos-*`. Sem tool MCP, sem gate, sem skill dedicada, sem campo novo no adapter: `talos_capabilities` schema v5 fica intacto (INV3). O dispatch é único e incondicional; não há checagem de `dispatch_capability` nem de `host_capabilities.dispatch_mutable`, porque o gate DISPATCH/DEC-008 protege mutação de **código** no pipeline de execução e esta é fase documental, com boundary de escrita em markdown de backlog/sprint (D15).

### Direção de implementação

Entrega a etapa 4 do fluxo de 2.4. A peça central é um arquivo de mandato em `references/`, no mesmo padrão do passo 10 do `create-guide`: o prompt é lido do disco e despachado sem reescrita, porque mandato improvisado varia de rigor a cada execução e não deixa rastro do que foi confrontado. O `SKILL.md` ganha o passo final que lê esse arquivo, monta o boundary com **todos** os paths escritos naquela execução e despacha pelo verbo declarado em `capabilities.subagent_dispatch`.

Nada disso entra no MCP nem no orquestrador. A decisão Q-CBR-06 removeu gate, selo e lock: a obrigação vive inteira dentro da skill, como no `create-guide`. O que este plano prova mecanicamente é o contrato do lado de cá da fronteira — que o mandato existe com suas cláusulas, que o boundary cobre o output inteiro e que nenhum nome de ferramenta de host está hardcodado. O veredito do agente fica além da fronteira e é smoke.

### Responsabilidades do plano

| Responsabilidade | Local | Implementação planejada |
|------------------|-------|--------------------------|
| Mandato canônico | `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` | Prompt completo, com boundary de escrita, ordem de leitura, severidade e formato de veredito |
| Dispatch | `packages/skills/talos-backlog-generator/SKILL.md` (passo final) | Lê o mandato, monta boundary, despacha pelo verbo do host, aguarda, repassa relatório |
| Verbo do host | `packages/mcp-server/server.js:capabilities` (`subagent_dispatch`) | Lido em runtime |

### Invariantes, valores críticos e regressões

- Preservar `INV3`: nenhuma tool MCP nova e nenhuma fase nova de orquestrador, provado por `AC-04.3.1`.
- Preservar `INV4`: nenhuma ferramenta de host hardcodada, provado por `AC-04.3.2`.
- Valor crítico tocado: VC2 (mandato canônico) e VC3 (verbo de dispatch), sinks no passo final da skill.
- Regressão provável: descrever o mandato em prosa dentro do `SKILL.md` "para facilitar". Isso recria exatamente a falha que o arquivo existe para evitar, e o boundary tende a encolher para "a sprint selecionada", contrariando D10.
- Regressão provável: o revisor tocar código do produto. O mandato declara boundary de escrita fechado nos artefatos daquela execução; código, testes e config são read-only.

### Tasks

#### 04.1 Mandato canônico da revisão fria

**Entrega:** `references/COLD_BACKLOG_REVIEW_PROMPT.md` com o mandato completo.

**Implementação planejada:**
Criar o arquivo com um bloco de prompt parametrizado por `<BACKLOG_PATH>`, `<SPRINT_PATHS>`, `<FONTES_DE_DISCUSSAO>` e `<RAIZ_DO_REPO>`, contendo:
- **Contexto negado explicitamente:** o revisor não recebe a conversa que originou os artefatos, e isso é deliberado. A fonte de intenção é a §4 `Discussão` de cada sprint file.
- **Ordem obrigatória:** ler as fontes de discussão → ler o código real → só então julgar backlog e sprint files. Artefato lido contra si mesmo sempre fecha.
- **Boundary de escrita:** pode editar o backlog e os sprint files informados, desde que a §7 esteja em `draft`. §7 com `Contrato status: aprovado` é read-only e vira finding de entrevista. Código, testes, config e qualquer path fora da lista são read-only.
- **O que confrontar, em ordem de prioridade:** (1) toda linha `Origem: premissa`, começando pelas que sustentam sprint `Must`/`P0`; (2) `Origem: derivado:<path>` cujo arquivo existe mas não diz o que a linha afirma — o gate prova que o path existe, só a leitura prova que ele sustenta a decisão; (3) `AC-*` cujo `behavior` não é observável ou não é falseável; (4) `EVAL-*` órfão e AC sem prova automática; (5) AC inalcançável no código real; (6) sprint com mais de um objetivo; (7) dependências declaradas contra as reais; (8) `critical_review.reasons` contra o que a sprint efetivamente toca.
- **Escopo do julgamento, delimitado explicitamente:** o revisor julga o **contrato de produto contra o código real**. Ele **não** aplica ao artefato documental as políticas que governam a mutação de código no pipeline de execução — gate DISPATCH/DEC-008, `dispatch_capability`, topologia sibling, locks e budget de repair existem para execução, e importá-los para uma fase que escreve markdown produz bloqueio por política que não se aplica. Capacidade de host, verbo de dispatch e schema do adapter estão **fora** do escopo desta revisão: se o revisor concluir que a skill precisa de campo novo em `talos_capabilities`, de gate MCP ou de verificação de host para despachar o próprio revisor, isso é over-reach e o finding é inválido por construção.
- **Protocolo:** congelar a lista de findings antes da primeira edição; classificar cada um como `REPARÁVEL`, `ENTREVISTA NECESSÁRIA` ou `RECUSADO` com motivo; aplicar os reparáveis; no máximo 2 passagens internas (default de P1).
- **Formato de saída:** findings por severidade (`P0` = executar a sprint como está produz trabalho errado ou perda de dado; `P1` = bloqueia ou desperdiça a execução; `P2` = imprecisão que sobrevive), o que foi alterado com path, o que foi recusado com motivo, e uma linha final de veredito ∈ `pass` | `pass_with_observations` | `fail` | `interview_required`.

**Responsabilidade e integração:** arquivo lido pelo passo final do `SKILL.md`; empacotado junto da skill pelo build.

**Comportamentos operacionais aplicáveis:**

- Principal: mandato completo e autocontido.
- Nenhum finding: `pass` é resultado legítimo quando o revisor leu fontes e código e conferiu.

**Invariantes e regressões:**

- O mandato não pode pedir ao revisor que rode build ou testes do produto; a inspeção é read-only sobre código.

**Critérios de aceite:**

- `AC-04.1.1` O arquivo existe e contém as cláusulas de boundary de escrita (artefatos editáveis, código read-only), a ordem obrigatória de leitura e o enum de veredito com os quatro valores. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: remover a cláusula de código read-only — o revisor passa a poder "corrigir" o produto para o artefato fechar, que é a inversão exata do que a revisão existe para fazer.
- `AC-04.1.4` O mandato contém a cláusula que delimita o escopo do julgamento, declarando que políticas de mutação de código (gate DISPATCH/DEC-008, `dispatch_capability`, locks) não se aplicam ao artefato documental e que exigir campo novo em `talos_capabilities` ou gate MCP para o próprio dispatch é finding inválido. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: remover essa cláusula — o revisor volta a reprovar a geração de backlog por política de execução, bloqueando entrega em host cuja mutação nunca foi verificada, e o defeito é caro justamente porque o finding parece rigoroso.
- `AC-04.1.2` O mandato determina que a §7 com `Contrato status: aprovado` é read-only e vira `interview_required`. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: permitir edição de §7 aprovada — uma atualização de backlog passa a reescrever contrato selado de sprint anterior, quebrando o selo write-once.
- `AC-04.1.3` O mandato obriga o revisor a **aplicar** os findings classificados como reparáveis nos artefatos e a relatar o que alterou, proibindo devolver finding reparável para o chamador consertar. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: escrever o mandato como auditoria que só lista findings — o chamador recebe lista de defeitos em vez de artefato corrigido, o que é D19/R6 invertido, e nenhum outro AC do plano acusa.

**Evidência esperada:**

- `AC-04.1.1` -> `build/tests/etapa3.test.mjs::mandato_revisao_canonico`.
- `AC-04.1.2` -> `build/tests/etapa3.test.mjs::mandato_revisao_canonico`.
- `AC-04.1.3` -> `build/tests/etapa3.test.mjs::mandato_revisao_canonico`.
- `AC-04.1.4` -> `build/tests/etapa3.test.mjs::mandato_revisao_canonico`.

**Validação focada:**

```bash
node --test build/tests/etapa3.test.mjs
```

#### 04.2 Passo de dispatch no `SKILL.md`

**Entrega:** a skill encerra despachando o revisor e repassando o relatório.

**Implementação planejada:**
Acrescentar ao workflow do `talos-backlog-generator` um passo final, depois da validação dos gates, que: (1) monta a lista de paths efetivamente escritos naquela execução — o backlog mestre e **cada** sprint file criado ou alterado, não apenas a sprint selecionada; (2) coleta as fontes de discussão da §4 desses sprint files; (3) lê `references/COLD_BACKLOG_REVIEW_PROMPT.md` do disco e substitui apenas os parâmetros, sem reescrever o mandato de memória; (4) resolve `talos_capabilities.subagent_dispatch` e despacha, pelo verbo declarado ali, **um** subagente genérico/default do host — não um agente registrado `talos-*` —, em foreground, aguardando o retorno; (5) recebe o relatório, repassa ao chamador o que foi corrigido e o veredito, e só então entrega o backlog.
O passo declara que falha de dispatch **bloqueia a entrega** com causa e próxima ação — não existe caminho de degradação nem revisão inline pelo próprio autor, pelo mesmo motivo que a topologia sibling existe no caminho de execução: quem escreveu não revisa o que escreveu. O dispatch é incondicional: nenhum branch por host, nenhuma leitura de `dispatch_capability`.
Como o revisor escreve **depois** dos gates da etapa 3 do fluxo 2.4, o passo também determina que, havendo artefato alterado por ele, a skill reexecute `talos_verify_sprint_file` nos sprint files tocados e `talos_verify_backlog_index` no backlog antes de entregar. Não é gate novo nem tool nova: é rodar de novo os gates que já existem, sobre o conteúdo que passou a valer.
O retorno estruturado do modo `backlog_first` ganha o campo `cold_review` com `{ dispatched, verdict, findings_applied }`, para o orquestrador ecoar no ledger sem que isso vire gate.

**Responsabilidade e integração:** consome `capabilities`; não chama tool MCP nova.

**Comportamentos operacionais aplicáveis:**

- Principal: dispatch único, blocking, com boundary completo.
- Veredito `fail` ou `interview_required`: repassar ao chamador sem declarar backlog pronto.
- Falha de dispatch: bloquear a entrega com causa.
- Revisor alterou artefato: reexecutar os gates existentes sobre os paths tocados antes de entregar.
- Revisor não alterou nada (`findings_applied: 0`): entregar sem regatear — `sem AC: o artefato entregue é byte-idêntico ao que os gates da etapa 3 já aprovaram`.

**Invariantes e regressões:**

- Um subagente por vez, em foreground — o mesmo princípio de dispatch blocking do orquestrador.

**Critérios de aceite:**

- `AC-04.2.1` O passo instrui a montar o boundary com o backlog e **todos** os sprint files escritos na execução, e o texto nomeia explicitamente que não é apenas a sprint selecionada. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: descrever o boundary como "a sprint selecionada" — incoerência entre sprints deixa de ser detectável, que é a razão de o boundary ser o lote (D10).
- `AC-04.2.2` O passo instrui a **ler** o mandato do arquivo e proíbe reescrevê-lo de memória ou resumi-lo. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: inlinear o mandato no `SKILL.md` — o rigor volta a variar por execução e VC2 perde o sink.
- `AC-04.2.3` O passo declara que falha de dispatch bloqueia a entrega, sem revisão inline nem degradação. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: permitir seguir sem revisão quando o dispatch falha — a garantia vira warning, contrariando o invariante 4 do `CLAUDE.md`.
- `AC-04.2.4` O passo obriga a repassar ao chamador os findings por severidade, o que foi alterado com path e o veredito, **e** proíbe materializar esse relatório em arquivo (nenhum diretório novo sob `.talos/`). Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: gravar o relatório em `.talos/backlog-review/` ou apenas "entregar o backlog revisado" — no primeiro caso D20 cai e a superfície documental cresce; no segundo o chamador perde a chance de discordar antes de seguir, que é o critério 3 do INTENT.
- `AC-04.2.5` O passo determina reexecutar `talos_verify_sprint_file`/`talos_verify_backlog_index` sobre os artefatos que o revisor alterou, antes da entrega. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: entregar direto após o relatório — uma correção do revisor que quebre procedência, selo ou link de backlog sai pela porta sem passar por gate nenhum, já que os gates rodaram antes de ele escrever.

**Evidência esperada:**

- `AC-04.2.1` -> `build/tests/etapa3.test.mjs::skill_backlog_boundary_completo`.
- `AC-04.2.2` -> `build/tests/etapa3.test.mjs::skill_backlog_le_mandato`.
- `AC-04.2.3` -> leitura do `SKILL.md`.
- `AC-04.2.4` -> `build/tests/etapa3.test.mjs::skill_backlog_relatorio_ao_chamador`.
- `AC-04.2.5` -> `build/tests/etapa3.test.mjs::skill_backlog_regate_pos_revisao`.

**Validação focada:**

```bash
node --test build/tests/etapa3.test.mjs
```

#### 04.3 Provar que nada vazou para MCP, orquestrador ou host

**Entrega:** INV3 e INV4 verificadas mecanicamente.

**Implementação planejada:**
Adicionar teste que conta as tools registradas em `packages/mcp-server/server.js` e compara com a lista esperada nomeada explicitamente no próprio teste, de forma que qualquer tool nova exija atualização consciente da lista. Adicionar teste que varre `packages/skills/talos-backlog-generator/` (SKILL.md + references) buscando **nomes de ferramenta de host** (`AskUserQuestion`, `Agent`, `Task`, `runSubagent`, `request_user_input`, `interactive_prompt`) e falha se algum aparecer como instrução — os descritores `question_prompt` e `subagent_dispatch` são a única fonte do verbo. O que o teste **não** proíbe: descrever em prosa que o alvo do dispatch é o **subagente genérico/default do host** (e não um agente registrado `talos-*`). Isso é o desenho fechado (D9, entrevista 2026-08-06, mesmo padrão do `create-guide`), não hardcode: nenhum nome de ferramenta é citado. O casamento é por token de ferramenta, não por conceito.

**Responsabilidade e integração:** testes puros, sem produção.

**Comportamentos operacionais aplicáveis:**

- Principal: o teste falha nomeando a tool registrada a mais ou o token de ferramenta encontrado — `sem AC: é a própria asserção de AC-04.3.1/AC-04.3.2, não um comportamento de produto a aceitar`.

**Invariantes e regressões:**

- O teste de tools não pode ser um `assert(count > 0)`: precisa comparar contra a lista nomeada.

**Critérios de aceite:**

- `AC-04.3.1` O conjunto de tools registradas no MCP é exatamente a lista esperada, sem adição por este release. Seam: gate-mcp-sprint; nível: ancorada; golden: N/A; falseia se: registrar uma tool nova (por exemplo `talos_lock_backlog_review`) — o teste fica vermelho, que é o comportamento correto dado que Q-CBR-06 removeu o lock.
- `AC-04.3.2` Nenhum **nome de ferramenta de host** aparece como instrução na skill de backlog nem no mandato; a instrução aponta os descritores `question_prompt`/`subagent_dispatch`. Dizer em prosa que o alvo é o subagente genérico/default do host não viola o AC — é o desenho de D9. Seam: dispatch-revisor; nível: ancorada; golden: N/A; falseia se: escrever "despache com a Agent tool" no `SKILL.md` — a skill quebra em Cursor, Codex, opencode, pi, zcode e VS Code, que declaram verbos diferentes.

**Evidência esperada:**

- `AC-04.3.1` -> `packages/mcp-server/server.test.js::tools_registradas_sem_adicao`.
- `AC-04.3.2` -> `build/tests/etapa3.test.mjs::skill_backlog_sem_ferramenta_hardcodada`.

**Validação focada:**

```bash
node --test packages/mcp-server/server.test.js
node --test build/tests/etapa3.test.mjs
```

### Gates e smoke

```bash
node --test packages/mcp-server/server.test.js
node --test build/tests/etapa3.test.mjs
git diff --check
```

Smoke manual, quando aplicável:

1. Rodar `talos-backlog-generator` sobre um brainstorm real que produza duas ou mais sprints.
2. Observar o dispatch do revisor como último passo, depois dos gates.
3. Conferir no relatório devolvido: o que foi corrigido, com path, e o veredito.
4. Abrir um dos sprint files e confirmar que a correção está no arquivo, não só no relatório.

### Definition of done

- [ ] Implementação segue direção, responsabilidades e fluxo planejados.
- [ ] Regras locais respeitadas.
- [ ] Critérios de aceite possuem evidência.
- [ ] Todo aceite material tem linha de falsificação com red observado.
- [ ] Todo comportamento operacional declarado nas tasks tem AC, ou `sem AC: motivo`.
- [ ] INV3 e INV4 provadas pelos ACs que 2.8 declara.
- [ ] D19 (audita **e** corrige), D14 e D20 (relatório ao chamador, sem arquivo) provados por AC, não só descritos em prosa.
- [ ] Artefato alterado pelo revisor volta a passar pelos gates antes da entrega.
- [ ] CN4 tem a prova declarada em 2.1: automatizada no lado do contrato, smoke no veredito do agente.
- [ ] VC2 e VC3 chegam aos sinks declarados em 2.6, com asserção discriminante.
- [ ] Gates focados passam.
- [ ] `Impl` registra implementação real, testes, decisões e pendências.

### Registro de implementação

**Impl:** EXECUTADO (2026-08-06) — plano selecionado (04), pack REVISAO_FRIA_BACKLOG_GUIDE.

- **Baseline:** HEAD `bd5a341` (Plano 03 CONCLUÍDO); worktree limpo exceto `.commandcode/` não rastreada (não tocada). HEAD final: `bd5a341` — sem commit (proibido nesta etapa).
- **Arquivos e símbolos alterados:** `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` (novo — mandato canônico VC2); `packages/skills/talos-backlog-generator/SKILL.md` (passo 14 do workflow + retorno `backlog_first` com `cold_review`); `build/tests/etapa3.test.mjs` (+6 testes); `packages/mcp-server/server.test.js` (+1 teste); `.gitignore` (negação da regra `references/` para a pasta do mandato); `plans/04-revisao-fria.md` (este Impl); `GUIDE.md` §4 (status do plano 04). Nenhum símbolo de código produtivo alterado (`server.js`, `document_quality.mjs`, templates, orquestrador fora do diff — INV3).
- **Fronteira de entrada (CN1) confirmada no código, sem regressão de entrada:** `SKILL.md` passo 4 instrui o ciclo escanear→perguntar→persistir — `talos_scan_acceptance` com `sprint_markdown` de cada sprint do rascunho antes de gravar, rodadas via `talos_capabilities.question_prompt` (`max_questions`/`options_per_question` do descritor do host), resposta aplicada com `Origem: usuario` ao fim da rodada, declínio vira `Origem: premissa` registrada. As 3 pernas verdes do LEDGER continuam passando: `server.test.js::talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)`, `etapa3::skill backlog: texto livre morto nos dois sítios... (AC-03.1.1 / LEG1)` e `etapa3::entrevista: persistir rodada preserva Origem... (AC-01.3.1 / INV1)` — todas verdes na suite real (27/27 etapa3; server.test.js com 265 pass). CN1 PROVADO no LEDGER coerente com o código.

**Solução e fluxo implementados**

- **Task 04.1 — mandato canônico:** `references/COLD_BACKLOG_REVIEW_PROMPT.md` criado no mesmo padrão do `create-guide` (instruções de despacho + bloco de prompt parametrizado por `<BACKLOG_PATH>`, `<SPRINT_PATHS>`, `<FONTES_DE_DISCUSSAO>`, `<RAIZ_DO_REPO>`). Cláusulas: contexto negado explicitamente (a §4 `Discussão` é a fonte de intenção); ordem obrigatória discussão → código real → julgamento dos artefatos; boundary de escrita (backlog + sprint files editáveis somente com §7 em `Contrato status: draft`; §7 aprovada read-only vira `ENTREVISTA NECESSÁRIA`; código, testes, config e path fora da lista read-only, sem rodar build/testes do produto); o que confrontar em 8 itens priorizados (premissa em Must/P0 primeiro); **escopo do julgamento delimitado** (AC-04.1.4): gate DISPATCH/DEC-008, `dispatch_capability`, topologia sibling, locks e budget de repair são políticas de mutação de **código** que não se aplicam à fase documental — exigir campo novo em `talos_capabilities` ou gate MCP para o próprio dispatch é over-reach e "o finding é inválido por construção"; protocolo de uma única revisão (congelar findings antes da primeira edição; classificar `REPARÁVEL`/`ENTREVISTA NECESSÁRIA`/`RECUSADO`; aplicar reparáveis e relatar com path — proibido devolver reparável ao chamador; **no máximo duas passagens internas** — default de P1 aplicado); severidade P0/P1/P2; formato de saída com findings por severidade, o que foi alterado com path, recusas com motivo e veredito ∈ `pass` | `pass_with_observations` | `fail` | `interview_required`.
- **Task 04.2 — passo de dispatch:** `SKILL.md` ganhou o passo 14 (`Revisar a frio e entregar`), depois dos gates do passo 13: (1) boundary = backlog mestre + **cada** sprint file criado ou alterado (explicitamente "não apenas a sprint selecionada" — D10); (2) fontes de discussão da §4; (3) leitura do mandato do disco (`packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md`) substituindo apenas os 4 parâmetros — "nunca reescreva o mandato de memória nem o resuma"; (4) verbo de `talos_capabilities.subagent_dispatch`, um único subagente genérico/default do host (não `talos-*`), foreground, dispatch incondicional sem branch por host e sem leitura de `dispatch_capability` (D15/D22: `unknown` ≠ incapaz); (5) relatório ao chamador (findings por severidade, o que foi alterado com path, veredito) sem materializar em arquivo (D20: nenhum diretório novo sob `.talos/`); falha de dispatch bloqueia a entrega (sem degradação nem revisão inline); veredito `fail`/`interview_required` → repassar sem declarar backlog pronto; **regate**: artefato alterado pelo revisor volta a `talos_verify_sprint_file`/`talos_verify_backlog_index` antes da entrega; `findings_applied: 0` → entrega sem regatear (byte-idêntico ao que os gates do passo 13 aprovaram). Retorno `backlog_first` ganhou `cold_review: { dispatched, verdict, findings_applied }`, com nota de que o orquestrador ecoa no ledger como informação, não gate.
- **Task 04.3 — INV3/INV4 mecânicos:** `server.test.js::tools_registradas_sem_adicao` (AC-04.3.1) compara `toolsList()` contra a lista canônica de 16 tools nomeada no teste; `etapa3::skill_backlog_sem_ferramenta_hardcodada` (AC-04.3.2) varre SKILL.md + references por tokens de ferramenta de host (`AskUserQuestion`, `Agent`, `Task`, `runSubagent`, `request_user_input`, `interactive_prompt`) e exige `question_prompt`/`subagent_dispatch` na skill. Orquestrador intocado (INV3: nenhuma fase/gate novo; `git status` sem diff em `packages/orchestrator/`).

| Task | Estado | Implementação real | Arquivos/símbolos |
|------|--------|--------------------|-------------------|
| 04.1 | IMPLEMENTADA | Mandato canônico com boundary de escrita, ordem discussão→código→artefatos, escopo do julgamento delimitado (AC-04.1.4), §7 aprovada read-only, aplicar reparáveis, enum de veredito, budget de 2 passagens (P1) | `references/COLD_BACKLOG_REVIEW_PROMPT.md` (novo) |
| 04.2 | IMPLEMENTADA | Passo 14: boundary completo, leitura do mandato do disco, dispatch via `subagent_dispatch` incondicional, relatório ao chamador sem arquivo, bloqueio em falha, regate pós-revisão; `cold_review` no retorno `backlog_first` | `SKILL.md` (passo 14, JSON do retorno) |
| 04.3 | IMPLEMENTADA | Lista canônica de 16 tools nomeada no teste; varredura por tokens de ferramenta em SKILL.md + references | `server.test.js` (+1), `etapa3.test.mjs` (+1) |

**ACs e evidência**

| AC | Resultado | Evidência |
|----|-----------|-----------|
| AC-04.1.1 | PASSOU | `etapa3::mandato revisão: arquivo canônico com as cláusulas obrigatórias (AC-04.1.1 a 04.1.4 / VC2)` — boundary de escrita (pode editar / read-only), ordem (fontes de discussão → código real → só então julgar), enum com 4 vereditos |
| AC-04.1.2 | PASSOU | Mesmo teste: `Contrato status: aprovado` + `ENTREVISTA NECESSÁRIA` presentes no mandato |
| AC-04.1.3 | PASSOU | Mesmo teste: `REPARÁVEL` + "reparável para quem chamou corrigir" (proibição de devolução) |
| AC-04.1.4 | PASSOU | Mesmo teste: `DISPATCH/DEC-008`, `dispatch_capability` e "inválido por construção" presentes no mandato |
| AC-04.2.1 | PASSOU | `etapa3::skill backlog: passo final monta boundary com todos os paths escritos (AC-04.2.1)` — "sprint file criado ou alterado", "não apenas a sprint selecionada", "backlog mestre" no passo 14 |
| AC-04.2.2 | PASSOU | `etapa3::skill backlog: passo final lê o mandato do arquivo e proíbe reescrita de memória (AC-04.2.2)` — `COLD_BACKLOG_REVIEW_PROMPT.md`, "substitua apenas", "reescreva o mandato de memória" |
| AC-04.2.3 | PASSOU | Leitura do `SKILL.md` passo 14: "Falha de dispatch **bloqueia a entrega** com causa e próxima ação: não existe caminho de degradação nem revisão inline pelo próprio autor" (grep green) |
| AC-04.2.4 | PASSOU | `etapa3::skill backlog: relatório ao chamador, sem arquivo (AC-04.2.4)` — "findings por severidade", "com path", "veredito", "nunca é materializado em arquivo", `.talos/` |
| AC-04.2.5 | PASSOU | `etapa3::skill backlog: regate dos gates sobre artefatos alterados pelo revisor (AC-04.2.5)` — `talos_verify_sprint_file`/`talos_verify_backlog_index` + "antes de entregar" no passo 14 |
| AC-04.3.1 | PASSOU | `server.test.js::tools: conjunto registrado é exatamente a lista canônica, sem adição (AC-04.3.1 / INV3)` — 16 tools nomeadas, diff vazio contra `toolsList()` |
| AC-04.3.2 | PASSOU | `etapa3::skill backlog: nenhum nome de ferramenta de host como instrução (AC-04.3.2 / INV4)` — 6 tokens ausentes do corpus (SKILL.md + references), `question_prompt`/`subagent_dispatch` presentes |

**Falsificação de aceite material (red observado)**

| AC | `falseia se` declarado | Falsificador real do teste | Red observado | Resultado |
|----|------------------------|----------------------------|---------------|-----------|
| AC-04.1.1/04.1.2/04.1.3/04.1.4 | Remover o arquivo de mandato (`mandato_revisao_canonico` vermelho); remover cláusula de código read-only; remover cláusula do escopo do julgamento; permitir edição de §7 aprovada; mandato como auditoria que só lista | Teste escrito antes do arquivo existir: `ENOENT ... COLD_BACKLOG_REVIEW_PROMPT.md` no run pré-implantação; cláusulas exigidas por asserções individuais (read-only, ordem, enum, aprovado, REPARÁVEL, DISPATCH/DEC-008) | Run pré-implantação: 6 testes novos vermelhos (ENOENT do mandato + asserções ausentes no passo 14) — red capturado | VERMELHO capturado; verde após a criação do mandato e do passo 14 |
| AC-04.2.1 | Descrever o boundary como "a sprint selecionada" | Asserção exige "sprint file criado ou alterado" + "não apenas a sprint selecionada" no passo final | Run pré-implantação: `AssertionError: boundary não enumera todos os sprint files` (sem passo 14) | VERMELHO capturado; verde após a edição |
| AC-04.2.2 | Inlinear o mandato no `SKILL.md` / remover o arquivo | Asserção exige `COLD_BACKLOG_REVIEW_PROMPT.md` + proibição de reescrita no passo 14; remover o arquivo derruba `mandato_revisao_canonico` (ENOENT) | Run pré-implantação: `AssertionError: passo final não instrui a ler o arquivo do mandato` | VERMELHO capturado; verde após a edição |
| AC-04.2.3 | Permitir seguir sem revisão quando o dispatch falha | Leitura do passo 14 (grep documental): "bloqueia a entrega" + "não existe caminho de degradação" | `git show HEAD:SKILL.md` sem passo 14 (red empírico por leitura do estado pré-edição) | VERMELHO demonstrado; verde após a edição |
| AC-04.2.4 | Gravar relatório em `.talos/backlog-review/` ou "entregar o backlog revisado" sem relato | Asserções de "findings por severidade", "com path", "veredito", "nunca é materializado em arquivo", `.talos/` | Run pré-implantação: `AssertionError: passo final não repassa findings por severidade` | VERMELHO capturado; verde após a edição |
| AC-04.2.5 | Entregar direto após o relatório, sem regate | Asserções de `talos_verify_sprint_file`/`talos_verify_backlog_index` + "antes de entregar" no passo final | Run pré-implantação: `AssertionError: passo final não reexecuta o gate de sprint file` | VERMELHO capturado; verde após a edição |
| AC-04.3.1 | Registrar uma tool nova (ex.: `talos_lock_backlog_review`) | Teste compara `toolsList()` contra lista canônica nomeada | Mutação temporária aplicada no `toolsList` do `server.js` (tool fake adicionada): `AssertionError ... actual: [..., 'talos_lock_backlog_review', ...]`; mutação revertida, verde restaurado | VERMELHO capturado; verde após reverter |
| AC-04.3.2 | Escrever "despache com a Agent tool" no `SKILL.md` | Varredura por 6 tokens no corpus (SKILL.md + references) | Mutação temporária no `SKILL.md` ("Despache com a Agent tool..."): `AssertionError: nome de ferramenta de host hardcodado: Agent`; mutação revertida, verde restaurado | VERMELHO capturado; verde após reverter |

**Prova executável de CN4 (2.1) — estado**

| Perna declarada em 2.1 | Prova real | Estado |
|------------------------|------------|--------|
| `etapa3::mandato_revisao_canonico` (automatizada no lado do contrato) | `mandato revisão: arquivo canônico com as cláusulas obrigatórias (AC-04.1.1 a 04.1.4 / VC2)` + `skill_backlog_le_mandato`/`boundary_completo`/`regate_pos_revisao`/`relatorio_ao_chamador` (passo 14: leitura do arquivo, boundary completo, regate, relatório) | passando (red observado) |
| Smoke manual do veredito do agente | NÃO EXECUTADO — N/A neste ambiente: exige host com MCP + `subagent_dispatch` em runtime; o pack declara o veredito do agente como smoke por não-determinismo (2.1/2.9: "o que é automatizável ... está em mandato_revisao_canonico") | smoke declarado pelo pack; lado do contrato automatizado e verde |

CN4: a prova automatizável do lado do contrato (mandato existe, é lido do arquivo, boundary cobre todo o output, regate e relatório instruídos) está implementada e verde.

**Valor crítico consumido**

| Valor | Sink declarado | Sink real | Situação do leitor antigo | Prova discriminante |
|-------|----------------|-----------|---------------------------|---------------------|
| VC2 — mandato canônico | `SKILL.md:passo_revisao_fria` | `SKILL.md` passo 14 (idêntico) | nenhum | `etapa3::mandato revisão...` (cláusulas lidas do arquivo real) + `skill_backlog_le_mandato` (passo instrui ler do disco e proíbe reescrita de memória — falharia se o mandato fosse inline ou o arquivo sumisse: ENOENT observado no red) |
| VC3 — verbo de dispatch | `SKILL.md:passo_revisao_fria` | `SKILL.md` passo 14 (idêntico) | nenhum | `etapa3::skill_backlog_sem_ferramenta_hardcodada`: nenhum nome de ferramenta de host no corpus e `subagent_dispatch` presente — falharia com "despache com a Agent tool" (red observado por mutação); origem real confirmada em `server.js:612` (`subagent_dispatch: adapter.subagent_dispatch`) e exposta por `capabilities` |

**Cutover de legado:** nenhuma linha do livro-razão 2.7 tem `Morre em` neste plano (LEG1 → Plano 03, LEG2 → Plano 01) — sem cutover a executar.

**Delta de ledger proposto** (promoção é ato de auditoria — não gravado no LEDGER)

| Obrigação | Estado proposto | Onde ficou |
|-----------|-----------------|------------|
| CN4 | PRONTO (prova do lado do contrato completa; veredito do agente é smoke declarado) | `etapa3::mandato revisão: ... (AC-04.1.1 a 04.1.4 / VC2)` + `::skill_backlog_le_mandato`, `::skill_backlog_boundary_completo` (nomes reais com sufixo `(AC-xx)`), `::skill_backlog_regate_pos_revisao`, `::skill_backlog_relatorio_ao_chamador` |
| VC2 | PRONTO | mandato em `references/COLD_BACKLOG_REVIEW_PROMPT.md` consumido pelo passo 14; teste de cláusulas + teste de leitura do arquivo |
| VC3 | PRONTO | `subagent_dispatch` de `server.js:capabilities` consumido pelo passo 14; teste de ausência de tool name + presença do descritor |
| INV3 | PRONTO | `server.test.js::tools: conjunto registrado é exatamente a lista canônica... (AC-04.3.1 / INV3)` (16 tools) + orquestrador sem diff (nenhuma fase/gate novo) |
| INV4 | PRONTO | `etapa3::skill backlog: nenhum nome de ferramenta de host como instrução (AC-04.3.2 / INV4)` |

Nenhuma `regressão de entrada` encontrada (CN1 confirmado no código, idêntico ao que o LEDGER declara PROVADO).

**Decisão P1 aplicada (default de execução):** budget de passagens internas de reparo do revisor = **2**, conforme a recomendação do GUIDE §1; o usuário não fechou outra escolha — aplicado no mandato ("Faça no máximo duas passagens internas de reparo. Isso continua sendo uma única revisão."), espelhando o revisor frio do `create-guide`.

**Gates e resultados**

| Gate | Resultado |
|------|-----------|
| `node --test build/tests/etapa3.test.mjs` | 27 pass / 0 fail (inclui os 6 novos) |
| `node --test packages/mcp-server/server.test.js` | 265 pass / 22 fail — **falha pré-existente de ambiente**, mesma família registrada no Impl do Plano 03 (264 pass / 22 fail): `copyfile` de `.talos/memory/HANDOFF_TEMPLATE.md` (ENOENT; arquivo não rastreado no repo, pasta `.talos/memory/` inexistente) derruba os testes de handoff/update_sprint_status/sync_manual_validation. Não é regressão deste plano; o teste novo (AC-04.3.1) passa |
| `node build/check-consistency.mjs` | exit 0 — "check-consistency: ok" |
| `git diff --check` | limpo |
| Contagem de tools MCP | `grep -c "name: 'talos_" packages/mcp-server/server.js` = 16 (idêntica ao baseline; INV3) |
| `git check-ignore` do mandato | exit 1 após a negação no `.gitignore` (arquivo não ignorado; antes da correção, exit 0 — ignorado) |

**Comportamentos operacionais (task 04.2) vs AC**

| Comportamento | Cobertura |
|---------------|-----------|
| Dispatch único, blocking, com boundary completo | Passo 14 itens (1)-(4) — AC-04.2.1 |
| Veredito `fail`/`interview_required`: repassar sem declarar backlog pronto | Passo 14 ("Veredito `fail` ou `interview_required`: repasse ao chamador sem declarar o backlog pronto") — sem AC dedicado no plano; motivo: deriva do critério 3 do INTENT coberto por AC-04.2.4 (repasse do relatório com veredito) e é consequência direta da leitura do mandato (veredito é parte da SAÍDA) |
| Falha de dispatch bloqueia a entrega com causa | Passo 14 — AC-04.2.3 |
| Revisor alterou artefato: reexecutar gates sobre os paths tocados | Passo 14 — AC-04.2.5 |
| Revisor não alterou nada (`findings_applied: 0`): entregar sem regatear | Passo 14 — `sem AC: o artefato entregue é byte-idêntico ao que os gates da etapa 3 já aprovaram` (declarado no plano) |
| Mandato completo e autocontido; `pass` é resultado legítimo | Mandato (REGRAS: "Nenhum finding é resultado legítimo...") — AC-04.1.1/04.1.3 |
| Revisor nunca roda build/testes do produto | Mandato ("Não rode build nem testes do produto") — sem AC dedicado no plano; motivo: é a cláusula read-only de código coberta por AC-04.1.1 (boundary) |
| Um subagente por vez, foreground | Passo 14 item (4) ("um único subagente ... em foreground, aguardando o retorno") — sem AC dedicado no plano; motivo: mesmo princípio do dispatch blocking do orquestrador, coberto por AC-04.2.3 (bloqueio em falha) |

**Smoke manual (passos 1-4 do plano):** NÃO EXECUTADO — N/A neste ambiente: exige host com MCP `talos_capabilities` + `subagent_dispatch` em runtime e um brainstorm real com duas ou mais sprints; o pack declara o veredito do agente como smoke por não-determinismo (2.1, seam dispatch-revisor). As partes determinísticas do cenário (mandato lido do arquivo, boundary completo, regate, relatório, ausência de tool name) estão cobertas pelos testes automatizados acima.

**Desvios técnicos:** nenhum desvio de direção. Nomenclatura: os nomes reais dos testes diferem dos declarados nas "Evidências esperadas" do plano (padrão da trilha: nome descritivo + sufixo `(AC-xx)`): `mandato_revisao_canonico` → `mandato revisão: arquivo canônico com as cláusulas obrigatórias (AC-04.1.1 a 04.1.4 / VC2)`; `skill_backlog_boundary_completo` → `skill backlog: passo final monta boundary com todos os paths escritos (AC-04.2.1)`; `skill_backlog_le_mandato` → `skill backlog: passo final lê o mandato do arquivo e proíbe reescrita de memória (AC-04.2.2)`; `skill_backlog_relatorio_ao_chamador` → `skill backlog: relatório ao chamador, sem arquivo (AC-04.2.4)`; `skill_backlog_regate_pos_revisao` → `skill backlog: regate dos gates sobre artefatos alterados pelo revisor (AC-04.2.5)`; `skill_backlog_sem_ferramenta_hardcodada` → `skill backlog: nenhum nome de ferramenta de host como instrução (AC-04.3.2 / INV4)`; `tools_registradas_sem_adicao` → `tools: conjunto registrado é exatamente a lista canônica, sem adição (AC-04.3.1 / INV3)`.

**Lacunas descobertas:** nenhuma lacuna estrutural no código. Notas: (1) **regra `references/` genérica no `.gitignore` (adicionada no commit ff83cb1) engolia o mandato novo** — `git check-ignore` confirmou o arquivo ignorado após a criação; corrigido com negação específica (`!packages/skills/talos-backlog-generator/references/`), necessária ao aceite de VC2/CN4 (mandato versionado e empacotado); arquivos `references/` já rastreados em `packages/` (ex.: `orchestrator/references/host-adapters.md`) não foram afetados; (2) cópias geradas de `SKILL.md` em `hosts/` e `plugins/` permanecem defasadas (já estavam desde o Plano 03; o `references/` novo também não tem cópia) — regeneração é obrigação do Plano 05 (INV5), como registrado no LEDGER em LEG1; (3) divergência de nomenclatura de testes declarados vs reais (mapeamento acima).

**Pendências conhecidas:** (1) 22 falhas pré-existentes em `server.test.js` por `.talos/memory/HANDOFF_TEMPLATE.md` ausente — ambiente, fora do recorte (mesma família do Plano 03); (2) smoke manual do dispatch do revisor em host real não executado (sem host MCP neste ambiente) — coberto pelas provas automatizadas do lado do contrato, veredito do agente é smoke por declaração do pack; (3) `.commandcode/` não rastreada não tocada (preservada).

### Auditoria pós-implementação

**Veredito: CONCLUÍDO (2026-08-06).** 3 tasks, 12 ACs (10 com teste automatizado, 2 documentais por leitura conforme o plano), 1 cenário (CN4), 2 valores críticos (VC2, VC3), 2 invariantes (INV3, INV4), fronteira CN1 reconferida no código, 4 gates confrontados. Nenhum finding P0/P1/P2 em aberto; 4 observações P3 registradas. Nenhuma correção necessária no recorte.

#### Fase A0 — dívida, fronteira e delta

- **Dívida vencida (`Fecha neste plano`):** CN4, VC2, VC3, INV3, INV4 — todos verificados e promovidos abaixo.
- **Fronteira de entrada (CN1) no código, sem regressão:** `SKILL.md` passo 4 intacto — ciclo escanear→perguntar→persistir com `talos_scan_acceptance`/`sprint_markdown` antes de gravar, rodadas via `talos_capabilities.question_prompt` (`max_questions`/`options_per_question` do descritor), resposta aplicada com `Origem: usuario` ao fim da rodada, declínio vira `Origem: premissa`. O diff do recorte não toca o passo 4 (só adiciona o passo 14). As 3 pernas verdes do LEDGER re-verificadas na suíte real: `server.test.js::talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)`, `etapa3::skill backlog: texto livre morto nos dois sítios... (AC-03.1.1 / LEG1)` e `etapa3::entrevista: persistir rodada preserva Origem... (AC-01.3.1 / INV1)` — todas verdes (27/27 etapa3; server.test.js 265 pass/22 fail de ambiente). CN1 PROVADO no LEDGER coerente com o código.
- **Delta contra o já provado (CN1/CN2/CN3/CN5/CN6/VC1/LEG1/LEG2/INV1/INV2):** o diff do recorte toca apenas `SKILL.md` (passo 14 novo + `cold_review` no JSON de retorno, adições puras), `build/tests/etapa3.test.mjs` (+6 testes, adições puras), `packages/mcp-server/server.test.js` (+1 teste, adição pura), `.gitignore` (negação escopada), `GUIDE.md` §4 e este plano. Nenhum símbolo de código produtivo alterado (`server.js`, `document_quality.mjs`, templates, orquestrador fora do diff) — nenhuma obrigação promovida pelos Planos 01-03 quebrada ou tocada com efeito observável.

#### Cenários traçados neste recorte

| Cenário | Trace no código real | Fronteira alcançada | Prova executável |
|---------|----------------------|---------------------|------------------|
| CN4 — ao fim da geração, usuário recebe backlog e sprint files já corrigidos por agente que não viu a conversa, com relato do que mudou | `SKILL.md` passo 14 (sink `passo_revisao_fria`): (1) boundary = backlog mestre + **cada** sprint file criado/alterado, "não apenas a sprint selecionada"; (2) fontes de discussão da §4; (3) leitura do disco de `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md`, "substitua apenas" os 4 parâmetros, "nunca reescreva o mandato de memória"; (4) `talos_capabilities.subagent_dispatch` resolvido em runtime (`server.js:259-336`, descritor por host), dispatch incondicional de um subagente genérico/default (sem nome de ferramenta, sem branch por host, sem leitura de `dispatch_capability` — D15/D22), foreground; (5) relatório ao chamador (findings por severidade, paths, veredito) nunca materializado em arquivo; falha de dispatch bloqueia a entrega; `fail`/`interview_required` ⇒ repassar sem declarar backlog pronto; artefato alterado ⇒ regate de `talos_verify_sprint_file`/`talos_verify_backlog_index` antes de entregar; `findings_applied: 0` ⇒ entrega byte-idêntica ao gateado | completa neste recorte no lado do contrato (mandato no arquivo + passo 14 lendo/dispachando/regateando); o veredito do agente fica além da fronteira (salto agente→host, externo ao código do projeto) e é smoke por declaração do pack (2.1/2.9) | `etapa3::mandato revisão: arquivo canônico com as cláusulas obrigatórias (AC-04.1.1 a 04.1.4 / VC2)` (lê o arquivo real) + `::skill backlog: passo final lê o mandato do arquivo... (AC-04.2.2)`, `::...monta boundary... (AC-04.2.1)`, `::...regate... (AC-04.2.5)`, `::...relatório... (AC-04.2.4)` (leem o passo 14 real do `SKILL.md`); smoke manual do veredito N/A sem host MCP |

Retraçado integralmente nesta auditoria (sem registro anterior neste plano). CN1 (fronteira) re-verificado no código; CN2/CN3/CN5/CN6 não são servidos por este recorte; suítes que os exercitam continuam verdes.

#### Consumo no sink (VC2, VC3) e mutadores

- VC2 — mandato canônico: origem `references/COLD_BACKLOG_REVIEW_PROMPT.md:Mandato` → sink `SKILL.md:passo_revisao_fria` (passo 14) confirmado por leitura dos dois arquivos (passo 14 referencia o path, lê do disco, substitui apenas parâmetros). Prova discriminante: `mandato revisão...` lê o arquivo real e exige as cláusulas (boundary de escrita, ordem discussão→código→artefatos, enum de 4 vereditos, §7 aprovada → `ENTREVISTA NECESSÁRIA`, `REPARÁVEL` + proibição de devolução, `DISPATCH/DEC-008`/`dispatch_capability`/"inválido por construção" do escopo do julgamento); falsificador executado nesta auditoria: remover o arquivo ⇒ ENOENT vermelho em `mandato revisão...`. Falsificador de AC-04.2.2 executado: se o passo 14 não instruísse a leitura ou permitisse reescrita de memória, `skill_backlog_le_mandato` falha (asserções de `COLD_BACKLOG_REVIEW_PROMPT.md`/`substitua apenas`/`reescreva o mandato de memória`).
- VC3 — verbo de dispatch: origem `server.js:capabilities` (`subagent_dispatch`, L259-336) → sink `SKILL.md:passo_revisao_fria` (passo 14: "resolva `talos_capabilities.subagent_dispatch` e despache pelo verbo declarado ali"). Prova discriminante: `skill_backlog_sem_ferramenta_hardcodada` (AC-04.3.2/INV4) varre o corpus inteiro (SKILL.md + references) por 6 tokens de tool de host e exige `question_prompt`/`subagent_dispatch`; falsificador executado nesta auditoria: injetar "Despache com a Agent tool" no passo 14 ⇒ vermelho; mutação revertida.
- Mutadores de §0: nenhum tocado pelo recorte (`server.js`, `document_quality.mjs` e templates fora do diff).

#### Reachability do legado

Nenhuma linha do livro-razão 2.7 tem `Morre em` neste plano (LEG1 → Plano 03, LEG2 → Plano 01) — sem cutover a executar. As duas linhas `PROVADO` de legado permanecem inertes: busca repo-wide sem novo chamador introduzido pelo recorte (diff puro de skill/testes/gitignore).

#### Falsificação de aceite material (re-executada nesta auditoria)

Todos os 12 ACs confrontados (`falseia se` declarado × teste real × red):

| AC | `falseia se` declarado | Confronto nesta auditoria | Red |
|----|------------------------|---------------------------|-----|
| AC-04.1.1/04.1.2/04.1.3/04.1.4 | Remover arquivo de mandato; remover cláusula read-only; remover escopo do julgamento; permitir edição de §7 aprovada; mandato só lista | `mandato revisão...` lê o arquivo real e assere cláusula a cláusula (read-only, ordem, enum, aprovado+ENTREVISTA NECESSÁRIA, REPARÁVEL+proibição, DISPATCH/DEC-008+dispatch_capability+inválido por construção) | **Re-executado por mutação nesta auditoria:** remover o arquivo ⇒ `ENOENT` vermelho; arquivo restaurado, verde. Impl registra red pré-implantação idêntico |
| AC-04.2.1 | Descrever o boundary como "a sprint selecionada" | `skill_backlog_boundary_completo` assere "sprint file criado ou alterado" + "não apenas a sprint selecionada" + "backlog mestre" no passo 14 | **Re-executado por mutação:** substituir por "apenas a sprint selecionada" ⇒ `AssertionError` vermelho; revertido, verde |
| AC-04.2.2 | Inlinear o mandato no `SKILL.md` / remover o arquivo | `skill_backlog_le_mandato` assere `COLD_BACKLOG_REVIEW_PROMPT.md` + "substitua apenas" + proibição de reescrita no passo 14; remoção do arquivo derruba `mandato revisão...` (ENOENT verificado acima) | VERMELHO por mutação (acima) + red pré-implantação registrado no Impl |
| AC-04.2.3 | Permitir seguir sem revisão quando o dispatch falha | Leitura do passo 14: "Falha de dispatch **bloqueia a entrega** com causa e próxima ação: não existe caminho de degradação nem revisão inline pelo próprio autor" (grep green) | Red por estado pré-edição (`git show HEAD:SKILL.md` sem passo 14), verificado no Impl |
| AC-04.2.4 | Gravar relatório em `.talos/backlog-review/` ou "entregar o backlog revisado" sem relato | `skill_backlog_relatorio_ao_chamador` assere "findings por severidade", "com path", "veredito", "nunca é materializado em arquivo", `.talos/` no passo 14 | VERMELHO pré-implantação registrado; asserções discriminantes confirmadas por leitura |
| AC-04.2.5 | Entregar direto após o relatório, sem regate | `skill_backlog_regate_pos_revisao` assere `talos_verify_sprint_file`/`talos_verify_backlog_index` + "antes de entregar" no passo 14 | VERMELHO pré-implantação registrado; asserções confirmadas |
| AC-04.3.1 | Registrar uma tool nova (ex.: `talos_lock_backlog_review`) | `tools: conjunto registrado é exatamente a lista canônica... (AC-04.3.1 / INV3)` compara `toolsList()` contra lista nomeada de 16 | **Re-executado por mutação nesta auditoria:** tool fake registrada em `server.js` ⇒ `AssertionError` com o nome da tool na mensagem; revertido, verde. `grep -c "name: 'talos_" server.js` = 16 |
| AC-04.3.2 | Escrever "despache com a Agent tool" no `SKILL.md` | `skill_backlog_sem_ferramenta_hardcodada` varre 6 tokens no corpus (SKILL.md + references) + exige `question_prompt`/`subagent_dispatch` | **Re-executado por mutação nesta auditoria:** token `Agent tool` injetado ⇒ vermelho; revertido, verde |

Nenhum proxy: todos os testes com teste automatizado leem os arquivos reais (`fs.readFileSync` sob `node --test`); os 2 ACs documentais (04.2.3 e o mapeamento de comportamentos abaixo) têm lastro em leitura do passo 14 real e no estado pré-edição verificado por `git show`.

#### Invariantes (INV3, INV4)

- INV3 — nenhuma tool MCP nova e nenhuma fase nova de orquestrador: `grep -c "name: 'talos_" packages/mcp-server/server.js` = 16 (idêntico ao baseline); AC-04.3.1 verde com lista nomeada; `git diff` sem alteração em `packages/orchestrator/` (0 linhas) e em `server.js`. Provada por AC-04.3.1.
- INV4 — skill nunca hardcoda ferramenta de host: AC-04.3.2 verde sobre o corpus real (SKILL.md + references); descritores `question_prompt`/`subagent_dispatch` são a única fonte do verbo; o passo 14 descreve em prosa o alvo como subagente genérico/default do host, sem citar nome de ferramenta (permitido por AC-04.3.2, desenho de D9).

#### Decisão P1 aplicada

Budget de passagens internas de reparo do revisor = **2** (default de execução recomendado pelo GUIDE §1, espelhando o revisor frio do `create-guide`): mandato, "Faça no máximo duas passagens internas de reparo. Isso continua sendo uma única revisão." (PROTOCOLO OBRIGATÓRIO, Fase B passo 7). Contrato aplicado no arquivo real.

#### Comportamentos operacionais (task 04.2) vs AC

| Comportamento | Cobertura |
|---------------|-----------|
| Dispatch único, blocking, com boundary completo | Passo 14 itens (1)-(4) — AC-04.2.1 (+ AC-04.2.3 para bloqueio em falha) |
| Veredito `fail`/`interview_required`: repassar sem declarar backlog pronto | Passo 14 — AC-04.2.4 (repasse do relatório com veredito; "sem declarar pronto" é consequência do repasse, critério 3 do INTENT); justificativa registrada no Impl |
| Falha de dispatch bloqueia a entrega com causa | Passo 14 — AC-04.2.3 |
| Revisor alterou artefato: reexecutar gates sobre os paths tocados | Passo 14 — AC-04.2.5 |
| Revisor não alterou nada (`findings_applied: 0`): entregar sem regatear | Passo 14 — `sem AC: o artefato entregue é byte-idêntico ao que os gates da etapa 3 já aprovaram` (declarado no plano) |
| Mandato completo e autocontido; `pass` é resultado legítimo | Mandato (REGRAS) — AC-04.1.1/04.1.3 |
| Revisor nunca roda build/testes do produto | Mandato ("Não rode build nem testes do produto") — coberto por AC-04.1.1 (boundary read-only de código); motivo registrado no Impl |
| Um subagente por vez, foreground | Passo 14 item (4) — coberto por AC-04.2.3 (bloqueio em falha); motivo registrado no Impl |

#### Gates

| Gate | Resultado nesta auditoria |
|------|---------------------------|
| `node --test build/tests/etapa3.test.mjs` | 27/27 pass (inclui os 6 novos do plano) |
| `node --test packages/mcp-server/server.test.js` | 265 pass / 22 fail — conjunto de falhas **idêntico** ao baseline: re-verificado por stash (HEAD sem recorte: 264 pass / 22 fail; todas as 22 com `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` em `copyfile` — testes de handoff/update_sprint_status/sync_manual_validation). O teste novo AC-04.3.1 passa isolado (1/1). Nenhuma regressão nova |
| `node build/check-consistency.mjs` | exit 0 — "check-consistency: ok" |
| `git diff --check` | limpo |
| `git check-ignore` do mandato | exit 1 (não ignorado) após a negação escopada no `.gitignore`; regra `references/` continua cobrindo as demais pastas não rastreadas (nenhum arquivo rastreado sob `references/` ignorado) |

Smoke manual do dispatch em host real: NÃO EXECUTADO — N/A aceito. O plano condiciona o smoke a "quando aplicável"; não há host MCP com `subagent_dispatch` em runtime neste ambiente. 2.1/2.9 declaram o veredito do agente como smoke por não-determinismo e a prova automatizável do lado do contrato (mandato existe, é lido do arquivo, boundary cobre todo o output, regate e relatório instruídos) como `mandato_revisao_canonico` — implementada e verde, com red re-executado nesta auditoria. O único trecho não automatizável (veredito do subagente em host real) é salto externo ao código do projeto (seam `agente -> host runtime`, fora de escopo legítimo por B2).

#### Promoção de ledger

| Obrigação | Estado | Evidência |
|-----------|--------|-----------|
| CN4 | PROVADO | Trace completo: `SKILL.md` passo 14 (sink `passo_revisao_fria`) lê o mandato do disco, monta boundary com todo o output, despacha via `subagent_dispatch` incondicional, regateia e relata; mandato real com cláusulas verificadas; prova executável: `etapa3::mandato revisão... (AC-04.1.1 a 04.1.4 / VC2)` + `::skill_backlog_le_mandato`, `::skill_backlog_boundary_completo`, `::skill_backlog_regate_pos_revisao`, `::skill_backlog_relatorio_ao_chamador` — todas verdes, red por mutação re-executado (remoção do arquivo ⇒ ENOENT) |
| VC2 | PROVADO | Mandato em `references/COLD_BACKLOG_REVIEW_PROMPT.md` consumido pelo passo 14 (leitura do disco, substituição de parâmetros, proibição de reescrita); teste de cláusulas lê o arquivo real; remoção do arquivo ⇒ vermelho |
| VC3 | PROVADO | `subagent_dispatch` de `server.js:capabilities` (L259-336) consumido pelo passo 14; AC-04.3.2 verde (6 tokens ausentes do corpus, descritor presente); injeção de tool name ⇒ vermelho (mutação re-executada) |
| INV3 | PROVADO | AC-04.3.1: `toolsList()` == lista canônica nomeada de 16; tool fake ⇒ vermelho (mutação re-executada); `grep -c` = 16; orquestrador e `server.js` sem diff |
| INV4 | PROVADO | AC-04.3.2: varredura de 6 tokens de ferramenta de host no corpus SKILL.md + references; descritores `question_prompt`/`subagent_dispatch` como única fonte do verbo |

Nenhuma linha rebaixada: fronteira CN1 conferida no código no estado que o LEDGER declara (`PROVADO`) e nenhuma obrigação de plano anterior quebrada.

#### Observações (P3, não bloqueiam)

1. 22 falhas pré-existentes em `server.test.js` (ENOENT `.talos/memory/HANDOFF_TEMPLATE.md`) — dívida de ambiente conhecida dos Planos 01-03, sem dono no pack; deve ser resolvida antes do gate agregado `test-all.sh` (Plano 05/fechamento). Não tocadas.
2. Smoke manual do dispatch do revisor em host real não executado — N/A sem host MCP; cobertura do lado do contrato completa e verificada (ver Gates). O veredito do agente é smoke por declaração do pack (2.1/2.9).
3. Cópias geradas de `SKILL.md` em `hosts/`/`plugins/` permanecem defasadas (passo 14 e `references/` novo sem cópia) — regeneradas pelo build no Plano 05 (INV5/AC-05.2.1), mesmo precedente de LEG1.
4. Mapeamento de comportamentos operacionais sem AC dedicado (veredito `fail`/`interview_required`, um subagente por vez, não rodar build/testes do produto) com justificativa escrita no Impl e cobertura pelos ACs nomeados na tabela acima — consistente com o padrão aceito nos Planos 01-03.

**Promovido a CONCLUÍDO (2026-08-06) nesta auditoria; Status espelhado no §4 do GUIDE.md.**

**Histórico**

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Auditoria fria do Plano 04: A0 (CN4/VC2/VC3/INV3/INV4 dívida; CN1 fronteira sem regressão; delta sem toque em código produtivo); trace CN4 até o sink `passo_revisao_fria` (passo 14 lê o mandato, boundary completo, dispatch incondicional, regate, relatório); falsificação re-executada por mutação nos 4 falsificadores principais (remoção do mandato ⇒ ENOENT; boundary "apenas a sprint selecionada" ⇒ vermelho; token `Agent tool` ⇒ vermelho; tool fake em `server.js` ⇒ vermelho; todos revertidos e re-verificados verdes); baseline das 22 falhas re-verificada por stash (HEAD: 264 pass/22 fail idênticos, ENOENT HANDOFF_TEMPLATE.md); gates re-rodados (27/27, 265+22, check-consistency, diff --check, check-ignore exit 1); P1 (budget 2 passagens) confirmado no mandato; LEDGER: CN4, VC2, VC3, INV3, INV4 → PROVADO | `node --test` × 4 (suítes + mutações), `git stash` baseline, `check-consistency`, `git diff --check`, `git check-ignore`, leitura de SKILL.md passo 14, mandato e testes novos |
