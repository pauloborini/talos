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
**Status:** PENDENTE

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

**Impl:** PENDENTE: ainda não executado.

### Auditoria pós-implementação

PENDENTE: ainda não auditado.
