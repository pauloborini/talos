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
**Status:** CONCLUÍDO (2026-08-06)

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

**Impl:**

Modo: PLANO SELECIONADO (01). Gate de entrada: `GUIDE.md` `PRONTO PARA EXECUÇÃO` — liberado.

HEAD inicial = HEAD final = `627e142f2eb763f58e3dc14726542dc57b54cc09` (sem commits; nenhuma promoção em `LEDGER.md`).

**Autoria do worktree (obrigação do orquestrador confirmada):** o working tree já continha, antes desta execução, o núcleo do plano 01 em `packages/skills/_shared/scripts/document_quality.mjs` (+226 linhas), `packages/templates/SPRINT_TEMPLATE.md` e `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`. Tratado como estado de trabalho: nada descartado, nada revertido; conferido contra o contrato do plano e completado. O que já estava presente (não alterado por mim): coluna `Origem`/`origin` nos templates (tasks 01.1), `applyItemField` com `origin`, `validateOriginToken` exportado, `contractDecisionRows`, julgamento de procedência na conformance (`procedencia_ausente`/`procedencia_invalida`/`origem_path_inexistente`/`procedencia_premissa_em_prioridade`), `premissa_count` no retorno da conformance, `parseDecisionRows` por posição de cabeçalho, `INVALID_ORIGIN` em `validateBacklogUpdate`, `applyDecisionRow` de três colunas com preservação/insert e `applyInterviewRound` gravando `usuario`. O que eu alterei: `packages/mcp-server/server.js` (task 01.4), `packages/mcp-server/server.test.js` (migração de fixture + 2 testes novos) e `build/tests/etapa3.test.mjs` (migração de fixtures + 8 testes novos).

#### Tabela por task

| Task | Estado | Implementação real | Arquivos/símbolos |
|------|--------|--------------------|-------------------|
| 01.1 Schema documental | Implementada (preexistente no worktree) | §7.1 com `\| ID \| Decisão \| Origem \|` + legenda enum (3 valores, exemplos preenchidos); §7.3 YAML com `origin:` após `id`; backlog com `Origem` imediatamente antes de `Status` + legenda | `packages/templates/SPRINT_TEMPLATE.md` (L118, L137-147, L152-175), `packages/templates/BACKLOG_MESTRE_TEMPLATE.md` (L134-140) |
| 01.2 Parse e julgamento | Implementada (preexistente) + testes novos (meus) | `applyItemField` (L194) aceita `origin` na cadeia escalar; `validateOriginToken` (L402) com enum e resolução `derivado:` via `fs.existsSync` quando `root` presente, `(novo)` e sem-`root` pulam resolução; conformance emite as 4 pendências por linha (item = `AC-*`/`D<n>`); `parseDecisionRows` (L928) mapeia `Origem` por posição do cabeçalho, `origin: null` se ausente; `INVALID_ORIGIN` no laço de `newDecisions` | `document_quality.mjs` |
| 01.3 Escrita/leitura de 3 colunas | Implementada (preexistente) + testes novos (meus) | `applyDecisionRow` (L1084) monta sempre as 3 células; linha existente preserva a célula `Origem` quando o chamador não informa origem, `origin` explícito vence; insert sob cabeçalho de 3 colunas; cabeçalho de 2 colunas continua em `DECISION_TABLE_MISSING` (D17); `closedDecisionIds` intacta (oráculo de materialização); `applyInterviewRound` (L1128) passa `'usuario'` | `document_quality.mjs` |
| 01.4 Exposição nos gates | Implementada (minha) | `verifySprintFile` (L2021-2031) passa `root: consumerRoot(args)` e emite `premissa_count` (inclusive zero; arquivo vazio = 0; ilegível permanece sem o campo — `sem AC: motivo` declarado); `inspectBacklogIndex` (L2197-2213) passa `root`, expõe `premissa_count` por sprint e total no retorno; `verifyBacklogIndex` (L2245-2257) agrega decisões do backlog (`parseDecisionRows` origem `premissa`) + total dos sprints | `packages/mcp-server/server.js` (import `parseDecisionRows`) |
| Migração de fixtures | Implementada (minha) | `server.test.js`: `sprintDoc` ganha opções `moscow`/`prioridade`/`decisionOrigin`/`acceptanceOrigin`, §7.1 de 3 colunas e `origin` nos ACs; AC-003 de `writeSprintWithManual` ganha `origin`; asserts de 2 células migrados (AC-4.2.1) e replaces de linha migrados. `etapa3.test.mjs`: fixture `backlog()` 6 colunas; fixture de entrevista §7.1 de 3 colunas; nenhuma validação afrouxada | `packages/mcp-server/server.test.js`, `build/tests/etapa3.test.mjs` |

#### Relação AC/invariante -> resultado -> evidência

| AC/INV | Resultado | Evidência |
|--------|-----------|-----------|
| AC-01.1.1 | PASSOU | `grep -n "\| ID \| Decisão \| Origem \|" packages/templates/SPRINT_TEMPLATE.md` → L118; leitura do template (legenda enum) |
| AC-01.1.2 | PASSOU | `grep -n "\| Dono \| Origem \| Status \|" packages/templates/BACKLOG_MESTRE_TEMPLATE.md` → L134 |
| AC-01.2.1 | PASSOU | `build/tests/etapa3.test.mjs::procedência: AC com origin derivado é parseado com evidence intacto (AC-01.2.1)` |
| AC-01.2.2 | PASSOU | `etapa3::procedência: premissa bloqueia AC em sprint standalone Must/P0 (AC-01.2.2)` |
| AC-01.2.3 | PASSOU | `etapa3::procedência: derivado:<path> inexistente bloqueia; (novo) e arquivo real passam (AC-01.2.3)` — `os.tmpdir()` real |
| AC-01.2.4 | PASSOU | `etapa3::procedência: §7.1 sem coluna Origem é schema pré-0.16.0 e bloqueia (AC-01.2.4)` |
| AC-01.2.5 | PASSOU | `etapa3::procedência: decisão de backlog fora do enum reprova o update (AC-01.2.5)` |
| AC-01.3.1 / INV1 | PASSOU | `etapa3::entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)` — `fs` real em tmpdir, readback |
| AC-01.3.2 / LEG2 | PASSOU | `etapa3::entrevista: decisão nova é inserida com as três colunas (AC-01.3.2 / LEG2)`; inclui assert do corte seco: insert em §7.1 de 2 colunas lança `INTERVIEW_PERSISTENCE_FAILED:DECISION_TABLE_MISSING:D3` |
| AC-01.4.1 / INV2 | PASSOU | `etapa3::selo: contrato com origin aprova; editar a §7 quebra o selo (AC-01.4.1 / INV2)` |
| AC-01.4.2 | PASSOU | `packages/mcp-server/server.test.js::talos_verify_sprint_file: premissa_count numérico em passed e blocked (AC-01.4.2)` |
| AC-01.4.3 | PASSOU | `server.test.js::talos_verify_backlog_index: derivado:<path> inexistente reprova também no gate de backlog (AC-01.4.3)` — inclui contraprova com arquivo real |

#### Tabela de falsificação de aceite material

Todos os 10 ACs materiais falsificados com red observado (mutação aplicada → teste focado → red capturado → mutação revertida; `document_quality.mjs` restaurado byte a byte via backup):

| AC | `falseia se` declarado | Falsificador real aplicado | Red observado |
|----|------------------------|---------------------------|---------------|
| AC-01.2.1 | mover `origin` para dentro da cadeia de `evidence` | removida a linha `else if (key === 'origin')` de `applyItemField` | sim — 5 falhas no teste focado (`origin` undefined) |
| AC-01.2.2 | ler prioridade do backlog em vez de `tableValue(markdown,'MoSCoW')` | `prioridadeSprint` lida de `backlogMarkdown` (null no teste standalone → não bloqueia) | sim — 3 falhas (pendência não emitida) |
| AC-01.2.3 | trocar `fs.existsSync` por checagem de formato | `exists = /^packages\//.test(normalized)` | sim — 3 falhas (path inexistente aceito) |
| AC-01.2.4 | tratar coluna ausente como `premissa` implícita | condição `!hasOriginColumn` desativada | sim — 3 falhas (`procedencia_ausente` não emitida) |
| AC-01.2.5 | aceitar qualquer string não vazia como origem | condição aceita origem não vazia | sim — 3 falhas (`INVALID_ORIGIN` ausente) |
| AC-01.3.1 | reverter `applyDecisionRow` para 2 células | `replacement` de 2 células | sim — 3 falhas (coluna `Origem` some) |
| AC-01.3.2 | manter casamento do cabeçalho de 2 colunas | regex do cabeçalho de volta a 2 colunas | sim — 5 falhas (`DECISION_TABLE_MISSING:D2`) |
| AC-01.4.1 | incluir `Contrato status`/`Selo do contrato` no bloco hasheado | `computeAcceptanceSeal` hasheia o markdown inteiro | sim — 3 falhas (selo auto-invalidado) |
| AC-01.4.2 | emitir o campo só quando > 0 | `premissa_count` omitido quando zero | sim — teste `AC-01.4.2` vermelho |
| AC-01.4.3 | passar `root` só em `verifySprintFile` | `root: null` na chamada de `inspectBacklogIndex` | sim — teste `AC-01.4.3` vermelho |

ACs não materiais (documentais): AC-01.1.1/AC-01.1.2 — `falseia se: N/A` declarado no plano.

#### Provas executáveis de cenário (2.1)

| Cenário | Prova declarada | Prova real | Estado |
|---------|-----------------|------------|--------|
| CN2 | `build/tests/etapa3.test.mjs::premissa_bloqueia_must_p0` | `etapa3::procedência: premissa bloqueia AC em sprint standalone Must/P0 (AC-01.2.2)` — fixture standalone (`Não aplicável (standalone)`), `MoSCoW: Must`, `origin: premissa` → `procedencia_premissa_em_prioridade` nomeando o AC; contraprova Should/P1 passa | criada e passando |
| CN3 | `etapa3::derivado_path_inexistente_bloqueia` | `etapa3::procedência: derivado:<path> inexistente bloqueia; (novo) e arquivo real passam (AC-01.2.3)` — resolução em tmpdir real | criada e passando |
| CN5 | `etapa3::schema_pre_016_rejeitado` | `etapa3::procedência: §7.1 sem coluna Origem é schema pré-0.16.0 e bloqueia (AC-01.2.4)` — pendência `procedencia_ausente` com `next_action: migrar_para_0_16` | criada e passando |

#### Valores críticos consumidos

| Valor | Sink declarado | Sink real | Leitor antigo | Prova discriminante |
|-------|----------------|-----------|---------------|---------------------|
| VC1 — procedência de decisão/AC | `document_quality.mjs:validateSprintFileConformance` | idem (L526) — consome `origin` dos itens §7.3 e `Origem` das linhas §7.1 | `applyDecisionRow` (escrevia 2 colunas fixas e apagaria a procedência) — morto: AC-01.3.1 prova persistência em §7.1 de 3 colunas preserva `usuario`; AC-01.3.2 prova insert de 3 colunas; falsificadores F6/F7 vermelhos | teste que persiste rodada sobre §7.1 de 3 colunas e relê o arquivo: linha reescrita com 3 células e `Origem: usuario`; falha se a linha voltar a 2 colunas |

#### Cutover do livro-razão (2.7) com prazo neste plano

| Linha | Situação | Evidência |
|-------|----------|-----------|
| LEG2 — `applyDecisionRow` cabeçalho literal de 2 colunas no caminho de inserção | morto | AC-01.3.2: insert de `D<n>` inexistente em §7.1 de 3 colunas funciona (3 células) e cabeçalho de 2 colunas segue em `DECISION_TABLE_MISSING` (D17); falsificador F7 (reverter para casamento de 2 colunas) fica vermelho |

`closedDecisionIds` não tocada (executada sobre §7.1 de 2 e 3 colunas devolve o mesmo conjunto; é oráculo de materialização de `persistInterviewRound`/`pendingInterviewQuestions`) — conforme a task 01.3.

#### Delta de ledger proposto

| Obrigação | Estado proposto | Onde ficou |
|-----------|-----------------|------------|
| CN2 | PRONTO PARA AUDITORIA (propor PROVADO) | prova executável criada (etapa3 `premissa_bloqueia_must_p0`) |
| CN3 | PRONTO PARA AUDITORIA (propor PROVADO) | prova executável criada (etapa3 `derivado_path_inexistente_bloqueia`) |
| CN5 | PRONTO PARA AUDITORIA (propor PROVADO) | prova executável criada (etapa3 `schema_pre_016_rejeitado`) |
| VC1 | PRONTO PARA AUDITORIA (propor PROVADO) | sink `validateSprintFileConformance` consome procedência; leitor legado `applyDecisionRow` morto com prova discriminante (AC-01.3.1/01.3.2) |
| LEG2 | PRONTO PARA AUDITORIA (propor PROVADO) | morto conforme 2.7 (AC-01.3.2 + falsificador F7) |
| INV1 | PRONTO PARA AUDITORIA (propor PROVADO) | AC-01.3.1 (persistir rodada nunca destrói procedência gravada) |
| INV2 | PRONTO PARA AUDITORIA (propor PROVADO) | AC-01.4.1 (selo íntegro sob schema novo; edição → `tampered:true`) |

Regressões de entrada: **nenhuma** — a `Fronteira de entrada` do plano é "nenhuma" (primeiro plano da trilha) e o `LEDGER.md` declara todas as obrigações `pendente`, coerente com o código.

#### Gates e resultados

| Gate | Resultado |
|------|-----------|
| `node --test build/tests/etapa3.test.mjs` | PASS — 17/17 |
| `node --test packages/mcp-server/server.test.js` | 261 pass / 22 fail — as 22 falhas são **pré-existentes** (mesmo conjunto, nomes e causas no HEAD puro `627e142`, verificado via `git archive` em `/tmp/talos-head`): `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` no helper `writeHandoffTemplateFixture` (testes de handoff/update_sprint_status/sync_manual_validation/revalidation). `.talos/` é gitignored e o arquivo não existe no repo; fora do escopo do plano 01 (nenhuma relação com procedência) |
| `node build/check-consistency.mjs` | ok (exit 0) |
| `git diff --check` | ok |
| `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs build/tests/fixtures-s9.test.mjs` | PASS — 27/27 |

#### Desvios técnicos

- Nenhum desvio de direção. Detalhes locais decididos: `sprintDoc`/`sprintFixture` ganharam opções de origem/prioridade para os testes; `verifyBacklogIndex` relê o arquivo do backlog para agregar decisões `premissa` (segunda leitura `fs` real, sem custo relevante); `inspectBacklogIndex` expõe `premissa_count` por sprint e total no retorno (superfície de saída aditiva).
- O branch de arquivo vazio em `verifySprintFile` ganhou `premissa_count: 0` (o plano pede o campo "em passed e em blocked"; o caminho de erro de leitura permanece sem o campo, conforme `sem AC: motivo` declarado na task 01.4).
- Cópias de template em `hosts/`/`plugins/` **não** foram regeneradas: a task 01.1 declara explicitamente que o build roda no Plano 05 (INV5 fecha lá).

#### Lacunas descobertas

- Nenhuma lacuna estrutural: os sinks declarados em 2.6 (conformance) e os chamadores em 2.10 (`verifySprintFile` L2021 e `inspectBacklogIndex` L2197) existem onde o plano supôs; `applyDecisionRow` era exatamente o leitor legado descrito.
- Fato de baseline (não lacuna do plano): 22 testes de `server.test.js` falham no HEAD puro por `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` (ambiente: `.talos/` não versionado; pré-requisito do pack diz ciclo anterior removido). Não tocado neste plano; separado das regressões novas.

#### Pendências

- Nenhuma pendência do recorte. 22 falhas pré-existentes de ambiente permanecem (não introduzidas por este plano; sem relação com o contrato de procedência).
- P1 (budget de reparo do revisor) permanece aberta — vence no Plano 04.

#### Histórico

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Execução do Plano 01: conferido o diff preexistente (núcleo de 01.1-01.3), implementada a task 01.4 (root + `premissa_count` nos gates), migradas as fixtures de `server.test.js`/`etapa3.test.mjs`, criados 10 testes novos (8 etapa3 + 2 server), falsificados os 10 ACs materiais com red observado e revertido, gates rodados | `git diff`, `node --test` × 3, `check-consistency`, falsificações F1-F10 |

### Auditoria pós-implementação

**Veredito: CONCLUÍDO (2026-08-06).** 4 tasks, 12 ACs (10 materiais + 2 documentais), 2 invariantes (INV1, INV2), 3 cenários (CN2, CN3, CN5), 1 valor crítico (VC1), 1 linha de legado (LEG2) e 5 gates confrontados — nenhum finding P0/P1/P2 em aberto.

#### Cenários traçados neste recorte

| Cenário | Trace no código real | Fronteira alcançada | Prova executável |
|---------|----------------------|---------------------|------------------|
| CN2 — `premissa` não sustenta Must/P0 | §1 `MoSCoW`/`Prioridade` → `document_quality.mjs:validateSprintFileConformance` (L535-537 `prioridadeSprint`) → item AC §7.3 (L671-682) ou linha D<n> §7.1 (L814-825) → pendência `procedencia_premissa_em_prioridade` nomeando `AC-*`/`D<n>` com `next_action: fechar_premissa_em_entrevista` → `server.js:verifySprintFile` `status: blocked` (L2034) | completa neste plano (sink = conformance + gate) | `build/tests/etapa3.test.mjs::procedência: premissa bloqueia AC em sprint standalone Must/P0 (AC-01.2.2)` + `server.test.js::talos_verify_sprint_file: premissa_count numérico em passed e blocked (AC-01.4.2)` (caso blocked) — passando |
| CN3 — `derivado:<path>` inexistente recusa a sprint | `derivado:<path>` → `validateOriginToken` (L402-435) com `root` do consumidor (`consumerRoot`) → `fs.existsSync` real → pendência `origem_path_inexistente` (`next_action: corrigir_origem_path`) → bloqueia em `verifySprintFile` **e** em `verifyBacklogIndex` via `inspectBacklogIndex` (L2203-2212, root nos dois chamadores — alerta 2.10) | completa neste plano | `etapa3::procedência: derivado:<path> inexistente bloqueia; (novo) e arquivo real passam (AC-01.2.3)` (tmpdir real) + `server.test.js::talos_verify_backlog_index: derivado:<path> inexistente reprova também no gate de backlog (AC-01.4.3)` — passando |
| CN5 — schema pré-0.16.0 recusado com instrução de reinício | §7.1 sem coluna `Origem` → `contractDecisionRows` (`hasOriginColumn: false`) → pendência `procedencia_ausente` item `§7.1` com `next_action: migrar_para_0_16` (L774-783) → `verifySprintFile` `blocked` | completa neste plano | `etapa3::procedência: §7.1 sem coluna Origem é schema pré-0.16.0 e bloqueia (AC-01.2.4)` — passando |

Retraçado integralmente nesta auditoria (sem registro anterior — primeira auditoria da trilha). Nenhum cenário servido por outro plano toca este recorte.

#### Consumo no sink (VC1) e mutadores

- VC1: sink real `document_quality.mjs:validateSprintFileConformance` consome `origin` dos itens §7.3 (L643-682) e das linhas §7.1 (L772-827). Leitor legado `applyDecisionRow` (2 colunas fixas) morto: reescrito para 3 células (L1084-1104), único chamador `applyInterviewRound` (L1128) passa `'usuario'`. Prova discriminante: `persist_preserva_origem` relê o arquivo e assere a linha `| D1 | ... | usuario |`; reverte para 2 células → vermelho (F6 re-executado nesta auditoria, 3 falhas).
- Mutadores: `applyDecisionRow` — upsert de 3 colunas completas, nunca subconjunto (linha existente preserva célula `Origem` salvo `origin` explícito; insert só sob cabeçalho de 3 colunas; cabeçalho de 2 colunas segue em `DECISION_TABLE_MISSING`, D17). `applyItemField` — `origin` na cadeia escalar, fora do submapa `evidence` (L194). `persistInterviewRound`/`closedDecisionIds`/`approveAcceptanceContract` intactos (diff confirma).

#### Reachability do legado (LEG2)

- Busca em todo o repo: `applyDecisionRow` privado, único chamador `applyInterviewRound` (que passa `'usuario'`); nenhum outro sítio com regex literal de cabeçalho de 2 colunas (grep `| ID | Decisão |` sem resultado em código/templates/testes). Inércia do caminho antigo comprovada: insert em §7.1 de 2 colunas lança `DECISION_TABLE_MISSING` (assert em AC-01.3.2) — comportamento D17, não tolerância.

#### Falsificação de aceite material (re-executada nesta auditoria)

Todos os 10 falsificadores reaplicados por mutação → teste focado → red capturado → restauração byte a byte (backup `cmp` confirmado): F1-F10 todos vermelhos (rc=1, 3 falhas cada). Divergência registrada: F1 aplicado como "remover a linha `else if (key === 'origin')`" (declarado: "mover para a cadeia de evidence") — mesma capacidade discriminante (parse de `origin` no nível do item), registrada no Impl pelo executor.

#### Gates

| Gate | Resultado nesta auditoria |
|------|---------------------------|
| `node --test build/tests/etapa3.test.mjs` | 17/17 pass |
| `node --test packages/mcp-server/server.test.js` | 261 pass / 22 fail — conjunto **idêntico** ao HEAD puro (verificado via `git archive` em `/tmp/talos-head`: 259 pass / 22 fail, mesmas 22 falhas ENOENT `.talos/memory/HANDOFF_TEMPLATE.md` em `writeHandoffTemplateFixture`); os 2 a mais são os testes novos do plano |
| `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs build/tests/fixtures-s9.test.mjs` | 27/27 pass |
| `node build/check-consistency.mjs` | exit 0 |
| `git diff --check` | limpo |

#### Promoção de ledger

| Obrigação | Estado | Evidência |
|-----------|--------|-----------|
| CN2 | PROVADO | `etapa3::premissa_bloqueia_must_p0` (fixture standalone Must/P0, pendência nomeia AC-001, contraprova Should/P1 passa) + `server.test.js::AC-01.4.2` caso blocked; falsificador F2 vermelho |
| CN3 | PROVADO | `etapa3::derivado_path_inexistente_bloqueia` (tmpdir real: inexistente bloqueia, `(novo)` e real passam) + `server.test.js::AC-01.4.3` (reprova também no gate de backlog, contraprova com arquivo real passa); falsificador F3 vermelho |
| CN5 | PROVADO | `etapa3::schema_pre_016_rejeitado` (`procedencia_ausente` item `§7.1`, `next_action: migrar_para_0_16`); falsificador F4 vermelho |
| VC1 | PROVADO | Sink `validateSprintFileConformance` consome `origin` de §7.3 e §7.1; leitor legado `applyDecisionRow` morto com prova discriminante (AC-01.3.1/01.3.2, F6/F7 vermelhos) |
| LEG2 | PROVADO | AC-01.3.2: insert de `D<n>` inexistente em §7.1 de 3 colunas funciona; cabeçalho de 2 colunas em `DECISION_TABLE_MISSING`; busca sem outro chamador |
| INV1 | PROVADO | AC-01.3.1: persistir rodada em §7.1 de 3 colunas preserva `usuario` no arquivo relido (fs real em tmpdir); F6 vermelho |
| INV2 | PROVADO | AC-01.4.1: contrato com `origin` aprova (`sealed:true, tampered:false`); editar §7 → `tampered:true`; F8 vermelho |

Nenhuma linha rebaixada: a `Fronteira de entrada` do plano é "nenhuma" e nenhuma obrigação de plano anterior foi tocada ou quebrada (LEDGER estava integralmente `pendente`).

#### Observações (P3, não bloqueiam)

1. 22 falhas pré-existentes em `server.test.js` (ENOENT `.talos/memory/HANDOFF_TEMPLATE.md` — `.talos/` é gitignored e o template não existe no repo). Verificadas por mim no HEAD puro via `git archive` em `/tmp/talos-head` (mesmo conjunto, mesmos nomes, mesma causa). Dívida de ambiente sem dono no pack; deverá ser resolvida antes do gate agregado `test-all.sh` (Plano 05/fechamento). Fora do recorte de procedência — não corrigida aqui.
2. Cópias de template em `hosts/`/`plugins/` (12 arquivos) seguem no schema antigo — delegação explícita da task 01.1 ("cópias regeneradas pelo build no Plano 05"); INV5 (AC-05.2.1) fecha no Plano 05. Estado intermediário por design, sem ação neste plano.
3. F1: falsificador aplicado difere do declarado na mecânica (remover linha vs mover para a cadeia de evidence) — registrado no Impl; mesma capacidade discriminante, red reproduzido.

**Promovido a CONCLUÍDO (2026-08-06) nesta auditoria; Status espelhado no §4 do GUIDE.md.**

**Histórico**

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Auditoria fria do Plano 01: baseline das 22 falhas confirmada no HEAD (`/tmp/talos-head`, 259 pass/22 fail idênticos); 10 falsificações re-executadas com red reproduzido e restauração byte a byte; cenários CN2/CN3/CN5 traçados no código até o sink; VC1/LEG2/INV1/INV2 confirmados; gates re-rodados (17/17, 261+22, 27/27, check-consistency, diff --check); LEDGER promovido (CN2, CN3, CN5, VC1, LEG2, INV1, INV2 → PROVADO) | `git diff`, `node --test` × 3, `check-consistency`, falsificações F1-F10 reaplicadas |
