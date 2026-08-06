# Plano 01 - Procedência por linha no schema, no parser e nos gates

**Pack:** ../GUIDE.md

**Objetivo do plano:** toda decisão e todo critério de aceite declaram `Origem`, e os gates MCP recusam procedência inválida, `premissa` sustentando sprint `Must`/`P0`, `derivado:<path>` inexistente e schema anterior a `0.16.0`.

**Resultado esperado:** hoje uma decisão inferida pelo modelo é indistinguível de uma dada pelo usuário e nada a bloqueia; depois, ela é rotulada por construção, contada no payload do gate e impedida de sustentar aceite de sprint prioritária.

**Cenários servidos:** CN2, CN3, CN5.

**Fronteira de entrada:** nenhuma: primeiro plano da trilha.

**Fecha neste plano:** CN2, CN3, CN5, VC1, LEG2, INV1, INV2.

**Dependências:** nenhuma.
**Natureza:** OBRIGATÓRIO
**Ativação:** sempre
**Risco:** alto
**Status:** PENDENTE

### Direção de implementação

Este plano entrega a etapa 3 do fluxo de 2.4 (escrever e gatear) na parte que é puramente mecânica: schema e validação. O ponto de entrada é `packages/templates/`, mas o contrato real vive em `packages/skills/_shared/scripts/document_quality.mjs`, que é quem o MCP consome. A ordem importa: o parser precisa reconhecer `origin` antes de a conformance poder julgá-lo, e `applyDecisionRow` precisa aprender a terceira coluna no mesmo plano em que a coluna nasce — senão a primeira entrevista persistida destrói a procedência.

A resolução de `derivado:<path>` exige um dado que `validateSprintFileConformance` hoje não recebe: o root do consumidor. A assinatura ganha uma opção; `verifySprintFile` a preenche com o mesmo mecanismo que já usa para abrir o backlog (`resolveConsumerPath`).

### Responsabilidades do plano

| Responsabilidade | Local | Implementação planejada |
|------------------|-------|--------------------------|
| Schema do contrato | `packages/templates/SPRINT_TEMPLATE.md`, `packages/templates/BACKLOG_MESTRE_TEMPLATE.md` | Coluna `Origem` na §7.1 e na tabela de decisões do backlog; campo `origin:` em cada item do YAML `acceptance` |
| Parse de procedência | `document_quality.mjs:applyItemField`, `:parseDecisionRows` | Reconhecer `origin` no AC e a coluna nova na tabela de decisões |
| Escrita de decisão | `document_quality.mjs:applyDecisionRow` | Montar as três colunas, preservando a `Origem` existente quando a linha já existe |
| Inserção de decisão nova | `document_quality.mjs:applyDecisionRow` (cabeçalho, L890) | Reconhecer o cabeçalho de 3 colunas para inserir `D<n>` inexistente |
| Migração das fixtures ao schema novo | `packages/mcp-server/server.test.js`, `build/tests/etapa3.test.mjs` | Fixtures existentes ganham `Origem`/`origin`; nenhuma validação é afrouxada para manter fixture legada verde |
| Julgamento | `document_quality.mjs:validateSprintFileConformance`, `:validateBacklogUpdate` | Enum, `premissa` em Must/P0, path inexistente, schema ausente |
| Exposição | `packages/mcp-server/server.js:verifySprintFile`, `:verifyBacklogIndex` | `premissa_count` no payload e root do consumidor na chamada da conformance |

### Invariantes, valores críticos e regressões

- Preservar `INV2`: o selo do §7 continua íntegro sob o schema novo, provado por `AC-01.4.1`.
- Mutador tocado: `applyDecisionRow` (§0 do GUIDE), semântica `upsert` com **duas colunas fixas**. A task 01.3 declara a lista final de três colunas que ela passa a montar.
- Valor crítico tocado: VC1, sink `document_quality.mjs:validateSprintFileConformance`. A entrega inclui a prova discriminante de que a persistência de entrevista não apaga a procedência.
- Legado tocado: LEG2 (`applyDecisionRow`, cabeçalho literal de 2 colunas no caminho de inserção), destino `matar neste plano`. **Não** confundir com `closedDecisionIds`: essa função descarta o grupo capturado e devolve o mesmo conjunto de `D<n>` com 2 ou 3 colunas (verificado executando-a sobre os dois formatos), e é o oráculo de materialização de `persistInterviewRound` — mexer nela sem necessidade é risco puro.
- Fixtures existentes são schema antigo: migrar no mesmo plano (`packages/mcp-server/server.test.js`, `build/tests/etapa3.test.mjs:104,176`). Suíte vermelha aqui não é falha preexistente; é consequência da entrega, e o atalho errado é afrouxar a validação.
- Regressão provável: `applyItemField` é chamado tanto no nível do item quanto dentro do fluxo de `evidence`; um campo novo mal posicionado captura chave de submapa. A implementação adiciona `origin` na mesma cadeia `else if` dos campos escalares (`id`/`behavior`/`scenario`), que só é alcançada quando `evidenceIndent < 0`.

### Tasks

#### 01.1 Coluna `Origem` no schema documental

**Entrega:** os dois templates canônicos declaram procedência.

**Implementação planejada:**
Em `packages/templates/SPRINT_TEMPLATE.md`, a tabela da §7.1 passa de `| ID | Decisão |` para `| ID | Decisão | Origem |`, com a legenda do enum logo abaixo (`usuario` = resposta de entrevista ou citação direta do brainstorm; `derivado:<path>` = lido do código/contrato real, path relativo à raiz do repo, sufixo ` (novo)` quando o arquivo ainda será criado; `premissa` = inferido pelo modelo). No YAML da §7.3, cada item de `acceptance` ganha `origin: "<valor>"` logo após `id`, e o texto de apoio registra que `premissa` não é aceito em sprint `Must`/`P0`.
Em `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`, a tabela `### Decisões bloqueantes` passa de `| ID | Decisão | Bloqueia | Dono | Status |` para `| ID | Decisão | Bloqueia | Dono | Origem | Status |` — `Origem` antes de `Status` para manter `Status` como última coluna, que é como `parseDecisionRows` e os leitores humanos a procuram.

**Responsabilidade e integração:** os templates são fonte única; as cópias em `hosts/` e `plugins/` são regeneradas pelo build no Plano 05.

**Comportamentos operacionais aplicáveis:**

- Principal: template novo já nasce com exemplo preenchido em cada valor do enum.

**Invariantes e regressões:**

- A §7.1 é parte do bloco hasheado pelo selo; mudar a tabela muda o hash, o que é esperado no corte seco e não afeta contratos novos.

**Critérios de aceite:**

- `AC-01.1.1` A §7.1 de `SPRINT_TEMPLATE.md` tem a coluna `Origem` e a legenda dos três valores do enum. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: N/A.
- `AC-01.1.2` A tabela de decisões de `BACKLOG_MESTRE_TEMPLATE.md` tem a coluna `Origem` imediatamente antes de `Status`. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: N/A.

**Evidência esperada:**

- `AC-01.1.1` -> leitura do template.
- `AC-01.1.2` -> leitura do template.

**Validação focada:**

```bash
grep -n "| ID | Decisão | Origem |" packages/templates/SPRINT_TEMPLATE.md
grep -n "| Dono | Origem | Status |" packages/templates/BACKLOG_MESTRE_TEMPLATE.md
```

#### 01.2 Parse e julgamento de procedência

**Entrega:** `document_quality.mjs` reconhece `origin` e emite pendência para cada violação.

**Implementação planejada:**
Adicionar em `applyItemField` (L186-196) a linha `else if (key === 'origin') item.origin = unquoteYaml(val);`, na mesma cadeia dos campos escalares.
Estender `parseDecisionRows` (L753-759) para mapear a coluna nova por posição do cabeçalho, e não por índice fixo: localizar `Origem` no header e ler a célula correspondente; ausência da coluna deixa `origin: null`, que a validação trata como pendência.
Criar em `document_quality.mjs` um helper exportado `validateOriginToken(raw, { root })` que devolve `{ valid, kind, path, reason }`: aceita `usuario`, `premissa`, e `derivado:<path>` com `path` não vazio; para `derivado:`, quando o valor **não** termina em ` (novo)`, resolve o path contra `root` com `fs.existsSync` e reprova se não existir. Sem `root`, a resolução é pulada e a função devolve `kind: 'derivado'` sem julgar existência — é o que permite chamar a conformance sem acesso a disco em teste unitário de parsing puro.
Em `validateSprintFileConformance`, dentro do laço de `acceptanceItems` (a partir de L546) e num laço novo sobre as linhas `D<n>` da §7.1, emitir:
- `procedencia_ausente` quando a §7.1 não tem coluna `Origem` ou um item de `acceptance` não tem `origin` — `next_action: 'migrar_para_0_16'`;
- `procedencia_invalida` quando o token não casa o enum — `next_action: 'corrigir_origem'`;
- `origem_path_inexistente` quando `derivado:<path>` sem ` (novo)` não resolve — `next_action: 'corrigir_origem_path'`;
- `procedencia_premissa_em_prioridade` quando `origin` é `premissa` **e** `tableValue(markdown,'MoSCoW')` é `Must` **ou** `tableValue(markdown,'Prioridade')` é `P0` — `next_action: 'fechar_premissa_em_entrevista'`, citando o `AC-*` ou o `D<n>` da linha.
A opção `root` entra na assinatura de `validateSprintFileConformance` junto de `sprintPath`/`sprintId`/`backlogPath`/`backlogMarkdown`.
Em `validateBacklogUpdate` (L791-830), acrescentar ao laço de `newRows`/decisões o erro `INVALID_ORIGIN:<id>:<valor>` para token fora do enum.

**Responsabilidade e integração:** a função é o sink de VC1; o MCP a consome sem lógica própria de procedência.

**Comportamentos operacionais aplicáveis:**

- Principal: pendência por linha, com o ID da decisão/AC no `message`.
- Erro de leitura de disco na resolução de path: tratar como path inexistente, com o motivo no `message` — `sem AC: comportamento de borda de `fs`, coberto pela mesma pendência do caminho principal`.

**Invariantes e regressões:**

- Não alterar o contrato de `evidence`/`manual`: `origin` é campo escalar de item.
- Sprint standalone (`Backlog mestre: Não aplicável (standalone)`) tem `MoSCoW`/`Prioridade` na §1 como qualquer outra: o bloqueio precisa funcionar sem backlog.

**Critérios de aceite:**

- `AC-01.2.1` Item de `acceptance` com `origin: "derivado:packages/mcp-server/server.js"` é parseado com `origin` preenchido, e `evidence.required`/`evidence.manual` continuam corretos no mesmo item. Seam: parse-aceite; nível: ancorada; golden: N/A; falseia se: mover a linha de `origin` para dentro da cadeia de `evidence` em `applyItemField`, fazendo o campo ser capturado como chave de submapa.
- `AC-01.2.2` Sprint com `MoSCoW: Must`, `Backlog mestre: Não aplicável (standalone)` e um `AC-*` com `origin: premissa` produz a pendência `procedencia_premissa_em_prioridade` nomeando aquele `AC-*`. Seam: conformance-sprint; nível: ancorada; golden: N/A; falseia se: ler a prioridade da linha do backlog em vez de `tableValue(markdown,'MoSCoW')` — a sprint standalone deixa de bloquear.
- `AC-01.2.3` Decisão com `Origem: derivado:packages/nao/existe.js` produz `origem_path_inexistente`, e a mesma decisão com ` (novo)` no fim passa. Seam: resolução-de-path; nível: ancorada em `os.tmpdir()` com arquivos reais; golden: N/A; falseia se: trocar `fs.existsSync` por checagem de formato do path — o caso do arquivo ausente passa a ser aceito.
- `AC-01.2.4` Sprint file sem a coluna `Origem` na §7.1 produz `procedencia_ausente` com `next_action: 'migrar_para_0_16'`. Seam: conformance-sprint; nível: ancorada; golden: N/A; falseia se: tratar coluna ausente como `premissa` implícita — o schema antigo passa a ser aceito em sprint não-prioritária, contrariando D17.
- `AC-01.2.5` Backlog com decisão de token inválido faz `validateBacklogUpdate` devolver `INVALID_ORIGIN:<id>:<valor>`. Seam: parse-decisão-backlog; nível: ancorada; golden: N/A; falseia se: aceitar qualquer string não vazia como origem.

**Evidência esperada:**

- `AC-01.2.1` -> `build/tests/etapa3.test.mjs::parse_origin_ac`.
- `AC-01.2.2` -> `build/tests/etapa3.test.mjs::premissa_bloqueia_must_p0`.
- `AC-01.2.3` -> `build/tests/etapa3.test.mjs::derivado_path_inexistente_bloqueia`.
- `AC-01.2.4` -> `build/tests/etapa3.test.mjs::schema_pre_016_rejeitado`.
- `AC-01.2.5` -> `build/tests/etapa3.test.mjs::parse_origem_backlog`.

**Validação focada:**

```bash
node --test build/tests/etapa3.test.mjs
```

#### 01.3 Escrita e leitura de decisão com três colunas

**Entrega:** persistir entrevista deixa de destruir a procedência.

**Implementação planejada:**
Em `applyDecisionRow` (L882-897), a linha de substituição passa a ser montada com três colunas. Quando a linha do `D<n>` já existe, extrair a célula `Origem` atual e preservá-la, salvo quando o chamador informar uma origem explícita — a assinatura passa a aceitar um terceiro argumento `origin` opcional, e `applyInterviewRound` (L920) o preenche com `'usuario'`, porque toda resposta de entrevista é resposta do usuário. A lista final montada é sempre `| <id> | <valor> | <origem> |`: a função monta as três células, nunca um subconjunto.
Quando a linha não existe, o insert usa o mesmo formato de três colunas. O reconhecimento do cabeçalho (`/(\| ID \| Decisão \|\n\|[-| ]+\|)/`, L890) passa a casar o cabeçalho de três colunas (`| ID | Decisão | Origem |`) — e, por corte seco (D17), **só** ele: cabeçalho de duas colunas é schema pré-`0.16.0` e deve continuar caindo em `DECISION_TABLE_MISSING`.
`closedDecisionIds` (L860-863) **não** é alterada: verificado executando a função sobre §7.1 de duas e de três colunas, o conjunto devolvido é idêntico (`match[1]`, o `D<n>`; o grupo 2 é descartado). É o oráculo de materialização usado por `persistInterviewRound` (L936) e por `pendingInterviewQuestions`; mexer nela não fecha obrigação nenhuma e arrisca o caminho de persistência.
Migrar no mesmo passo a fixture de `build/tests/etapa3.test.mjs:176` (§7.1 de duas colunas, com insert de `D2` pelo cabeçalho antigo) para o schema de três colunas — hoje esse teste passa e, depois desta task, ele é exatamente o que provaria o contrário do desejado se ficasse como está.

**Responsabilidade e integração:** `persistInterviewRound` continua o único ponto de escrita em disco; nada muda no protocolo temp+rename+readback.

**Comportamentos operacionais aplicáveis:**

- Principal: linha existente tem a decisão atualizada e a origem definida como `usuario`.
- Linha inexistente: insert com três colunas (coberto por `AC-01.3.2`).
- Tabela com cabeçalho de duas colunas (schema pré-`0.16.0`): continua lançando `DECISION_TABLE_MISSING:<id>` — é o comportamento correto no corte seco (D17), e não uma tolerância a preservar.

**Invariantes e regressões:**

- INV1: persistir rodada nunca destrói procedência já gravada.
- `pendingInterviewQuestions` e a checagem de materialização de `persistInterviewRound` (L936) dependem de `closedDecisionIds`. Ela **não** entra nesta task: devolve o mesmo conjunto de `D<n>` com duas ou três colunas.
- Fixture legada: `build/tests/etapa3.test.mjs:176` monta §7.1 de duas colunas e insere `D2`. Migrar para três colunas nesta task; sem isso o teste fica vermelho por schema antigo, não por defeito da implementação.

**Critérios de aceite:**

- `AC-01.3.1` Persistir uma rodada de entrevista (`persistInterviewRound`) sobre um sprint file real em `os.tmpdir()` cuja §7.1 tem três colunas, para um `D<n>` **que já existe na tabela**, resulta em arquivo cuja linha continua com três colunas e `Origem` igual a `usuario`. Seam: persistência-entrevista; nível: ancorada com `fs` real; golden: N/A; falseia se: reverter `applyDecisionRow` para montar a linha com duas células (`id` + `valor`) — a coluna `Origem` some do arquivo relido e o teste fica vermelho.
- `AC-01.3.2` Persistir uma rodada para um `D<n>` **que ainda não existe** na §7.1 de três colunas insere a linha com as três células, e a chamada não lança. Seam: persistência-entrevista; nível: ancorada com `fs` real; golden: N/A; falseia se: manter o casamento do cabeçalho de duas colunas em `applyDecisionRow` (L890) — o insert deixa de encontrar a tabela e a chamada estoura `INTERVIEW_PERSISTENCE_FAILED:DECISION_TABLE_MISSING:<id>`, que é como a entrevista quebraria em produção sem que `AC-01.3.1` acusasse nada.

**Evidência esperada:**

- `AC-01.3.1` -> `build/tests/etapa3.test.mjs::persist_preserva_origem`.
- `AC-01.3.2` -> `build/tests/etapa3.test.mjs::persist_insere_decisao_nova_tres_colunas`.

**Validação focada:**

```bash
node --test build/tests/etapa3.test.mjs
```

#### 01.4 Exposição nos gates MCP

**Entrega:** `verifySprintFile` e `verifyBacklogIndex` passam o root do consumidor e devolvem `premissa_count`.

**Implementação planejada:**
Em `verifySprintFile` (L1989), passar `root` para `validateSprintFileConformance`, derivado do mesmo mecanismo já usado para resolver `backlogPath` (`resolveConsumerPath`), e acrescentar `premissa_count` ao objeto `result` — contagem de linhas §7.1 e itens §7.3 com `origin` igual a `premissa`, sempre presente, inclusive zero.
Em `inspectBacklogIndex` (L2166), passar o mesmo `root` na chamada a `validateSprintFileConformance` (L2197) e acumular por sprint a contagem de `premissa`. Este chamador não é opcional: é o que `talos_verify_backlog_index` usa e o que a própria skill chama nos passos 9 e 13; deixá-lo sem `root` faz a resolução de `derivado:<path>` ficar silenciosamente inerte no gate de backlog enquanto reprova no gate de sprint — mesmo artefato, dois veredictos.
Em `verifyBacklogIndex` (L2226), acrescentar `premissa_count` agregando as decisões do backlog e as contagens por sprint devolvidas por `inspectBacklogIndex`.
Nenhuma tool nova é registrada; os schemas das tools existentes ganham apenas o campo de saída.

**Responsabilidade e integração:** o orquestrador e a skill leem `premissa_count`; o revisor frio do Plano 04 usa a contagem para priorizar.

**Comportamentos operacionais aplicáveis:**

- Principal: campo presente em `passed` e em `blocked`.
- Sprint file ilegível: o caminho de erro existente permanece, sem `premissa_count` — `sem AC: caminho de erro preexistente, sem contrato novo`.

**Invariantes e regressões:**

- INV2: o selo continua íntegro; nenhuma alteração no cálculo de hash.
- Não introduzir tool nova (INV3 é fechada no Plano 04, mas este plano não pode violá-la).

**Critérios de aceite:**

- `AC-01.4.1` Aprovar um contrato §7 que contém `origin` nos itens de `acceptance` produz selo válido por `validateAcceptanceSeal`; editar qualquer linha da §7 depois disso produz `tampered: true`. Seam: conformance-sprint; nível: ancorada; golden: N/A; falseia se: incluir `Contrato status`/`Selo do contrato` no bloco hasheado — a aprovação passa a invalidar o próprio selo.
- `AC-01.4.2` `talos_verify_sprint_file` devolve `premissa_count` numérico tanto em `passed` quanto em `blocked`, e o valor bate com a quantidade de linhas marcadas `premissa` no fixture. Seam: gate-mcp-sprint; nível: ancorada; golden: N/A; falseia se: emitir o campo só quando maior que zero — o consumidor não distingue "zero premissas" de "gate antigo".
- `AC-01.4.3` Um sprint file com `derivado:<path>` inexistente, referenciado por um backlog real em `os.tmpdir()`, é reprovado **também** por `talos_verify_backlog_index` (pendência `sprint_file:...:origem_path_inexistente`), e o payload traz `premissa_count`. Seam: gate-mcp-backlog; nível: ancorada com `fs` real; golden: N/A; falseia se: passar `root` só em `verifySprintFile` — o mesmo artefato passa no gate de backlog e reprova no de sprint, e a skill (que chama os dois) entrega dependendo da ordem.

**Evidência esperada:**

- `AC-01.4.1` -> `build/tests/etapa3.test.mjs::selo_integro_com_origin`.
- `AC-01.4.2` -> `packages/mcp-server/server.test.js::verify_sprint_file_premissa_count`.
- `AC-01.4.3` -> `packages/mcp-server/server.test.js::verify_backlog_index_resolve_derivado`.

**Validação focada:**

```bash
node --test packages/mcp-server/server.test.js
node --test build/tests/etapa3.test.mjs
```

### Gates e smoke

```bash
node --test build/tests/etapa3.test.mjs
node --test packages/mcp-server/server.test.js
node build/check-consistency.mjs
git diff --check
```

### Definition of done

- [ ] Implementação segue direção, responsabilidades e fluxo planejados.
- [ ] Regras locais (`AGENTS.md`/`CLAUDE.md`) respeitadas.
- [ ] Critérios de aceite possuem evidência.
- [ ] ACs com surface de runtime são provados no seam correto, com `fs` real.
- [ ] Todo aceite material tem linha de falsificação com red observado.
- [ ] Todo comportamento operacional declarado nas tasks tem AC, ou `sem AC: motivo`.
- [ ] INV1 e INV2 provadas pelos ACs que 2.8 declara.
- [ ] `applyDecisionRow` monta as três colunas completas, nunca subconjunto, tanto ao atualizar linha existente quanto ao inserir linha nova.
- [ ] Fixtures legadas migradas ao schema `0.16.0` (`packages/mcp-server/server.test.js`, `build/tests/etapa3.test.mjs:104,176`); nenhuma validação foi afrouxada para manter fixture antiga verde.
- [ ] `root` chega aos **dois** chamadores da conformance (`verifySprintFile` e `inspectBacklogIndex`).
- [ ] CN2, CN3 e CN5 têm a prova executável declarada em 2.1 criada e passando.
- [ ] VC1 chega ao sink declarado em 2.6, com asserção discriminante.
- [ ] LEG2 morto conforme 2.7.
- [ ] Gates focados passam.
- [ ] Toda obrigação de `Fecha neste plano` promovida a `PROVADO` no `LEDGER.md` pela auditoria.
- [ ] `Impl` registra implementação real, testes, decisões e pendências.

### Registro de implementação

**Impl:** PENDENTE: ainda não executado.

### Auditoria pós-implementação

PENDENTE: ainda não auditado.
