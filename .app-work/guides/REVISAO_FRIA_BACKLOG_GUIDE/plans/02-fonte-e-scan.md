# Plano 02 - Fonte de discussão obrigatória e scan sobre rascunho

**Pack:** ../GUIDE.md

**Objetivo do plano:** todo sprint file aponta a fonte de discussão que o originou, e a ambiguidade passa a ser detectável antes de o artefato existir em disco.

**Resultado esperado:** hoje a §4 aceita `Discussão` vazia e `talos_scan_acceptance` só funciona sobre arquivo salvo; depois, o gate recusa sprint sem fonte de discussão e o scan aceita markdown em memória, habilitando a entrevista pré-escrita do Plano 03.

**Cenários servidos:** CN6; habilita CN1 via Plano 03.

**Fronteira de entrada:** VC1.

**Fecha neste plano:** CN6.

**Dependências:** Plano 01.
**Natureza:** OBRIGATÓRIO
**Ativação:** sempre
**Risco:** médio
**Status:** CONCLUÍDO (2026-08-06)

### Direção de implementação

Duas mudanças independentes que servem à mesma etapa do fluxo de 2.4. A primeira fecha o oráculo de intenção do revisor frio: sem a linha `Discussão` preenchida, o agente do Plano 04 não tem contra o que confrontar a intenção, e o pack perde o substituto do INTENT que a decisão D1 aceitou como suficiente. A segunda inverte a ordem entre escrever e perguntar: `scanAcceptance` passa a aceitar o markdown do rascunho, o que permite ao generator escanear antes de gravar.

O ponto delicado é não quebrar o chamador atual. O orquestrador chama o gate com `sprint_path` no passo 2 do Full mode; esse caminho continua sendo o principal e mantém teste próprio.

### Responsabilidades do plano

| Responsabilidade | Local | Implementação planejada |
|------------------|-------|--------------------------|
| Exigência da fonte | `document_quality.mjs:validateSprintFileConformance` | Pendência quando a linha `Discussão` da §4 está ausente, vazia ou em placeholder |
| Schema da §4 | `packages/templates/SPRINT_TEMPLATE.md` | Nota de obrigatoriedade e exemplo preenchido |
| Entrada do scan | `packages/mcp-server/server.js:scanAcceptance` | Aceitar `sprint_markdown` como alternativa a `sprint_path` |

### Invariantes, valores críticos e regressões

- Regressão provável: aceitar os dois parâmetros ao mesmo tempo cria ambiguidade sobre qual conteúdo foi escaneado. A implementação exige exatamente um.
- Regressão provável: remover ou enfraquecer o caminho por `sprint_path` quebra o orquestrador sem nenhum teste acusar. A task 02.2 mantém o teste do caminho antigo junto do novo.

### Tasks

#### 02.1 Linha `Discussão` obrigatória

**Entrega:** sprint file sem fonte de discussão é recusado.

**Implementação planejada:**
Em `validateSprintFileConformance`, ler a §4 (`extractSectionMarkdown(markdown, 4)`) e localizar a linha da tabela cujo primeiro campo é `Discussão`. Emitir a pendência `fonte_discussao_ausente` (categoria `contexto_fontes`, `next_action: 'preencher_fonte_discussao'`) quando a linha não existe, quando a célula de fonte está vazia, ou quando está em placeholder (`[link/resumo]`, `[...]`, `—`, `N/A`). A regra vale para todo sprint file, inclusive standalone: a decisão de autoria fechou "sempre obrigatória" justamente para não depender de detectar a origem da sprint.
> Correção documental (auditoria 2026-08-06): o modelo de pendências de `document_quality.mjs` tem **campo único `category`**, que é o id da pendência (padrão do repo: `procedencia_ausente`, `origem_path_inexistente`, ...). A "categoria `contexto_fontes`" prescrita aqui não tem representação no modelo; o nome da pendência do pack (CN6/AC-02.1.1/02.1.2) prevalece — `category: 'fonte_discussao_ausente'` no código e nos testes.
Em `packages/templates/SPRINT_TEMPLATE.md`, a §4 ganha a nota de obrigatoriedade na linha `Discussão` e um exemplo preenchido com path real de brainstorm. Atenção: a §4 é tabela de **três** colunas (`Tipo | Fonte | Uso nesta sprint`), então `tableValue` — que só casa linha de duas colunas — não serve aqui; o casamento é pelo rótulo da primeira célula.
Nenhuma fixture de teste tem hoje linha `Discussão` (busca no repo: zero ocorrências; as §4 de `packages/mcp-server/server.test.js:1259` e `:1564` não a declaram). Migrar essas fixtures nesta task, junto da mudança: suíte vermelha por schema antigo é consequência esperada da entrega, e afrouxar a regra para mantê-las verdes derruba CN6 e D2 de uma vez.

**Responsabilidade e integração:** a mesma função que julga procedência; nenhum consumidor novo.

**Comportamentos operacionais aplicáveis:**

- Principal: pendência única por sprint file, com a linha da §4 no campo `line`.
- §4 ausente por completo: a pendência de seção obrigatória preexistente já cobre — `sem AC: comportamento preexistente da lista `requiredSections``.

**Invariantes e regressões:**

- Não confundir com a linha `Backlog` da mesma tabela: o casamento é pelo rótulo `Discussão`, não por posição.

**Critérios de aceite:**

- `AC-02.1.1` Sprint file com a §4 completa mas `Discussão` em placeholder produz `fonte_discussao_ausente`; o mesmo arquivo com um path real na célula passa. Seam: conformance-sprint; nível: ancorada; golden: N/A; falseia se: aceitar qualquer célula não-vazia — o placeholder `[link/resumo]` do template volta a passar, e todo sprint file recém-criado é aceito sem fonte.
- `AC-02.1.2` Sprint standalone (`Backlog mestre: Não aplicável (standalone)`) sem `Discussão` também é recusada. Seam: conformance-sprint; nível: ancorada; golden: N/A; falseia se: condicionar a regra à presença de backlog — o caminho standalone, que é o que tem menos rede, fica descoberto.

**Evidência esperada:**

- `AC-02.1.1` -> `build/tests/etapa3.test.mjs::discussao_placeholder_bloqueia`.
- `AC-02.1.2` -> `build/tests/etapa3.test.mjs::discussao_obrigatoria_standalone`.

**Validação focada:**

```bash
node --test build/tests/etapa3.test.mjs
```

#### 02.2 Scan sobre rascunho em memória

**Entrega:** `talos_scan_acceptance` escaneia markdown que ainda não foi salvo.

**Implementação planejada:**
Em `scanAcceptance` (L1750), tornar `sprint_path` opcional e aceitar `sprint_markdown`. A resolução do conteúdo passa a ser: se `sprint_markdown` está presente e `sprint_path` também, devolver erro de uso (`status: 'blocked'`, `next_action: 'usar_um_dos_dois'`); se nenhum está presente, o erro de argumento obrigatório existente; se só `sprint_markdown`, usar o conteúdo direto e reportar `sprint_path: null` com `source: 'draft'` no payload; se só `sprint_path`, o comportamento atual, com `source: 'file'`.
A lista canônica de padrões e as exclusões permanecem intactas — muda apenas de onde vem o texto. O schema da tool em `L6061` ganha a propriedade `sprint_markdown` e deixa `sprint_path` fora dos obrigatórios.

**Responsabilidade e integração:** consumido pelo generator no Plano 03 e pelo orquestrador (que continua usando path). Escopo do scan: **sprint file**. `scanSectionPatterns` (`server.js:1683`) só lê `sections.section_7_aceite`, então passar o rascunho do backlog mestre devolveria zero por ausência de §7, não por ausência de ambiguidade — D8 é coberta pelo lado das sprints, e a ambiguidade do índice macro é fechada pela mesma rodada de entrevista. Não simular cobertura chamando o scan com markdown de backlog.

**Comportamentos operacionais aplicáveis:**

- Principal: mesmo payload de hoje, com `source` indicando a procedência do texto.
- Rascunho vazio: mesma pendência de arquivo vazio já implementada (`blocking_count: 1`) — coberto por `AC-02.2.1` (rascunho `sprint_markdown` explicitamente vazio → `blocking_count: 1`, `source: 'draft'`; sem markdown e sem path segue o erro de argumento obrigatório).
- Os dois parâmetros juntos: erro de uso explícito.

**Invariantes e regressões:**

- O caminho por `sprint_path` é o que o orquestrador usa em produção e não pode regredir.

**Critérios de aceite:**

- `AC-02.2.1` `talos_scan_acceptance` chamado com `sprint_markdown` contendo padrão bloqueante devolve `blocking_count > 0`, `source: 'draft'` e `sprint_path: null`, sem tocar o disco. Seam: scan-draft; nível: ancorada; golden: N/A; falseia se: gravar o markdown num arquivo temporário e reusar o caminho de path — o gate deixa de ser utilizável antes de existir artefato, que é o motivo da mudança.
- `AC-02.2.2` `talos_scan_acceptance` chamado com `sprint_path` continua lendo o arquivo e devolvendo o mesmo payload de hoje, com `source: 'file'`. Seam: scan-draft; nível: ancorada; golden: N/A; falseia se: remover o branch de `sprint_path` — o passo 2 do Full mode do orquestrador quebra.
- `AC-02.2.3` Chamada com `sprint_path` e `sprint_markdown` juntos devolve erro de uso com `next_action: 'usar_um_dos_dois'`. Seam: scan-draft; nível: ancorada; golden: N/A; falseia se: precedência silenciosa de um sobre o outro — o chamador não sabe qual conteúdo foi escaneado.

**Evidência esperada:**

- `AC-02.2.1` -> `packages/mcp-server/server.test.js::scan_acceptance_draft_em_memoria`.
- `AC-02.2.2` -> `packages/mcp-server/server.test.js::scan_acceptance_por_path`.
- `AC-02.2.3` -> `packages/mcp-server/server.test.js::scan_acceptance_argumentos_exclusivos`.

**Validação focada:**

```bash
node --test packages/mcp-server/server.test.js
```

### Gates e smoke

```bash
node --test packages/mcp-server/server.test.js
node --test build/tests/etapa3.test.mjs
git diff --check
```

### Definition of done

- [ ] Implementação segue direção, responsabilidades e fluxo planejados.
- [ ] Regras locais respeitadas.
- [ ] Critérios de aceite possuem evidência.
- [ ] ACs com surface de runtime são provados no seam correto.
- [ ] Todo aceite material tem linha de falsificação com red observado.
- [ ] Todo comportamento operacional declarado nas tasks tem AC, ou `sem AC: motivo`.
- [ ] O caminho por `sprint_path` continua verde.
- [ ] CN6 tem as provas executáveis declaradas em 2.1 criadas e passando.
- [ ] Fixtures de sprint file migradas com linha `Discussão` real; nenhuma validação afrouxada para acomodar fixture antiga.
- [ ] Gates focados passam.
- [ ] `Impl` registra implementação real, testes, decisões e pendências.

### Registro de implementação

**Impl:**

Modo: PLANO SELECIONADO (02). Gate de entrada: `GUIDE.md` `PRONTO PARA EXECUÇÃO` — liberado.

HEAD inicial = HEAD final = `8457c2f` (sem commits; nenhuma promoção em `LEDGER.md`). Worktree inicial limpo (apenas `.commandcode/` não rastreado, não tocado).

**Fronteira de entrada (VC1) conferida no código:** sink real `document_quality.mjs:validateSprintFileConformance` (L526) consome `origin` dos itens §7.3 (L643-683) e das linhas §7.1 (L784-827) — idêntico ao declarado em GUIDE 2.6; leitor legado `applyDecisionRow` segue morto (3 colunas, L1084, único chamador `applyInterviewRound`). LEDGER `PROVADO` coerente com o código. **Nenhuma regressão de entrada.**

#### Tabela por task

| Task | Estado | Implementação real | Arquivos/símbolos |
|------|--------|--------------------|-------------------|
| 02.1 Linha `Discussão` obrigatória | Implementada | Bloco novo em `validateSprintFileConformance` (L562-588): extrai a §4 (`extractSectionMarkdown(markdown, 4)`), casa a linha pelo rótulo da primeira célula (`/^\|\s*Discussão\s*\|\s*([^|\n]*)/im`) — não por posição e não via `tableValue` (que só casa linha de 2 colunas); emite `fonte_discussao_ausente` (category `fonte_discussao_ausente` — ver correção documental na task 02.1; `next_action: 'preencher_fonte_discussao'`, item `Discussão`, `line` = linha da §4) quando a linha não existe, a célula está vazia ou em placeholder (`[link/resumo]`, `[...]`, `—`, `N/A`). Regra vale para todo sprint file, inclusive standalone (D2). §4 ausente por completo não emite a pendência nova: a `seção_obrigatória` preexistente cobre (`sem AC: motivo` declarado na task). Template §4: nota de obrigatoriedade + exemplo preenchido com path real de brainstorm. Fixtures migradas com linha `Discussão` real em `sprintDoc` (server.test.js) e `sprintFixture` (etapa3) | `document_quality.mjs:validateSprintFileConformance` (L562-588), `packages/templates/SPRINT_TEMPLATE.md` §4, `packages/mcp-server/server.test.js:sprintDoc` (L1271-1275), `build/tests/etapa3.test.mjs:sprintFixture` (L272-277) |
| 02.2 Scan sobre rascunho em memória | Implementada | `scanAcceptance` (L1751) reescrito: `sprint_path` deixa de ser obrigatório; aceita `sprint_markdown`. Resolução: os dois juntos → resultado `status:'blocked'` com `next_action:'usar_um_dos_dois'` (erro de uso explícito, nenhum conteúdo escaneado); nenhum → `requiredString(args,'sprint_path')` (erro de argumento obrigatório existente, inalterado); só `sprint_markdown` → conteúdo direto, `sprint_path: null`, `source: 'draft'`, sem tocar o disco; só `sprint_path` → comportamento atual com `source: 'file'`. Rascunho vazio → mesma pendência de arquivo vazio (`blocking_count: 1`). Lista canônica de padrões e exclusões intactas (`scanSectionPatterns` inalterado). Schema da tool `talos_scan_acceptance` (L6123): `required` vira `['run_id']` e ganha `sprint_markdown` | `packages/mcp-server/server.js:scanAcceptance` (L1751-1847), `toolsList` schema (L6123-6138) |

#### Relação AC/invariante -> resultado -> evidência

| AC/INV | Resultado | Evidência |
|--------|-----------|-----------|
| AC-02.1.1 | PASSOU | `build/tests/etapa3.test.mjs::discussão: placeholder na linha Discussão da §4 bloqueia; path real passa (AC-02.1.1)` — placeholders `[link/resumo]`, `[...]`, `—`, `N/A` e célula vazia → `fonte_discussao_ausente` com `line` numérico e pendência única; path real → `valid:true` |
| AC-02.1.2 | PASSOU | `etapa3::discussão: sprint standalone sem linha Discussão é recusada (AC-02.1.2)` — `Backlog mestre: Não aplicável (standalone)` sem a linha → `fonte_discussao_ausente` com `line: null` |
| AC-02.2.1 | PASSOU | `packages/mcp-server/server.test.js::talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)` — markdown com TBD → `blocked`, `source:'draft'`, `sprint_path:null`, `blocking_count>=1`, `SPRINT.md` não criado; contraprova sem TBD → `passed` |
| AC-02.2.2 | PASSOU | `server.test.js::talos_scan_acceptance: sprint_path continua lendo o arquivo com source file (AC-02.2.2)` — path limpo → `passed`/`source:'file'`; path com TBD → `blocked`/`source:'file'` |
| AC-02.2.3 | PASSOU | `server.test.js::talos_scan_acceptance: sprint_path e sprint_markdown juntos → erro de uso (AC-02.2.3)` — `blocked`, `next_action:'usar_um_dos_dois'`; nenhum dos dois → `sprint_path obrigatório` (throw) |

#### Tabela de falsificação de aceite material

Todos os 5 ACs materiais falsificados com red observado (mutação aplicada → teste focado → red capturado → restauração byte a byte via backup, `cmp` confirmado):

| AC | `falseia se` declarado | Falsificador real aplicado | Red observado |
|----|------------------------|---------------------------|---------------|
| AC-02.1.1 | aceitar qualquer célula não-vazia (placeholder `[link/resumo]` volta a passar) | remoção dos checks de placeholder em `semFonte` (restou só `linha ausente || vazia`) | sim — `discussão: ... placeholder ... (AC-02.1.1)` vermelho (1 falha) |
| AC-02.1.2 | condicionar a regra à presença de backlog (standalone fica descoberto) | `if (section4 != null && !isStandaloneBacklog(tableValue(markdown,'Backlog mestre')))` | sim — `discussão: sprint standalone ... (AC-02.1.2)` vermelho (2 falhas: o placeholder também passa a aceitar standalone) |
| AC-02.2.1 | gravar o markdown num arquivo temporário e reusar o caminho de path | branch `sprint_markdown` grava `.talos-draft-<run>.md` no root e força `source:'file'` | sim — `...sprint_markdown escaneia rascunho... (AC-02.2.1)` vermelho (23 falhas = 22 pré-existentes + 1) |
| AC-02.2.2 | remover o branch de `sprint_path` (passo 2 do Full mode quebra) | chamada sem markdown vira `requiredString(args,'sprint_markdown')` | sim — `...sprint_path continua lendo o arquivo... (AC-02.2.2)` vermelho + 4 testes legados de path vermelhos (29 falhas = 22 + 7) |
| AC-02.2.3 | precedência silenciosa de um sobre o outro | bloco de exclusividade removido (rascunho vence) | sim — `...juntos → erro de uso (AC-02.2.3)` vermelho (23 falhas = 22 + 1) |

#### Provas executáveis de cenário (2.1)

| Cenário | Prova declarada | Prova real | Estado |
|---------|-----------------|------------|--------|
| CN6 | `build/tests/etapa3.test.mjs::discussao_placeholder_bloqueia`, `::discussao_obrigatoria_standalone` | `etapa3::discussão: placeholder na linha Discussão da §4 bloqueia; path real passa (AC-02.1.1)` (placeholder → `fonte_discussao_ausente`, path real → passa) + `etapa3::discussão: sprint standalone sem linha Discussão é recusada (AC-02.1.2)` (standalone sem a linha → recusada) | criadas e passando |

Cenário CN1 não fecha neste plano (Plano 03); o scan em memória é o habilitador, coberto por `AC-02.2.1`.

#### Valores críticos consumidos

| Valor | Sink declarado | Sink real | Leitor antigo | Prova discriminante |
|-------|----------------|-----------|---------------|---------------------|
| VC1 (fronteira de entrada, `Fecha em` Plano 01 — não vence aqui) | `document_quality.mjs:validateSprintFileConformance` | idem (L526) — consome `origin` §7.3/§7.1 | `applyDecisionRow` — morto desde o Plano 01 (AC-01.3.1/01.3.2) | conferência de fronteira: sink real = declarado; sem leitor antigo no caminho; nenhuma regressão |

Nenhum valor crítico vence neste plano (VC1 foi fechado no Plano 01); o consumo no sink foi apenas reconferido como fronteira de entrada.

#### Cutover do livro-razão (2.7) com prazo neste plano

Nenhuma linha morre no Plano 02 (LEG1 morre no 03; LEG2 morreu no 01). Busca por `Discussão` no repo antes da mudança: zero ocorrências em fixtures (só o template) — coerente com a task; após a mudança, fixtures migradas em `sprintDoc`/`sprintFixture`.

#### Delta de ledger proposto

| Obrigação | Estado proposto | Onde ficou |
|-----------|-----------------|------------|
| CN6 | PRONTO PARA AUDITORIA (propor PROVADO) | provas executáveis criadas (`etapa3::discussão: placeholder... (AC-02.1.1)`, `etapa3::discussão: sprint standalone... (AC-02.1.2)`); pendência `fonte_discussao_ausente` no sink `validateSprintFileConformance`; falsificadores F1/F2 vermelhos |

Regressões de entrada: **nenhuma** — VC1 (fronteira) conferida no código no estado que o LEDGER declara (`PROVADO`).

#### Goldens e provas de seam

Nenhum golden (todos os seams determinísticos, nível ancorada — N/A conforme o plano). Seam `scan-draft` exercitado com implementação real dos dois lados (markdown em memória e path real em `os.tmpdir()`), sem mock.

#### Gates e resultados

| Gate | Resultado |
|------|-----------|
| `node --test build/tests/etapa3.test.mjs` | PASS — 19/19 (17 pré-existentes + 2 novos) |
| `node --test packages/mcp-server/server.test.js` | 264 pass / 22 fail — as 22 falhas são **pré-existentes** (conjunto idêntico ao HEAD puro `8457c2f` verificado via `git archive` em `/tmp/talos-head2`: 261 pass/22 fail, mesmos nomes, mesma causa `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` em `writeHandoffTemplateFixture`); os 3 a mais são os testes novos do plano |
| `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs build/tests/fixtures-s9.test.mjs` | PASS — 29/29 |
| `node build/check-consistency.mjs` | ok (exit 0) |
| `git diff --check` | ok |

#### Desvios técnicos

- Nenhum desvio de direção. Detalhes locais decididos: item da pendência `fonte_discussao_ausente` = `'Discussão'` (rótulo da linha — o plano não fixava o item); placeholder tratado genericamente por `/^\[.*\]$/` além dos exemplos nomeados (`[link/resumo]`, `[...]`) — coberto pelos mesmos critérios; `discussao` como opção das fixtures (`sprintDoc`/`sprintFixture`) com default = path real de brainstorm para não ferir as suítes existentes.
- `scanAcceptance` reescrito num fluxo único (resolução de conteúdo → ramos de resultado) em vez do try/catch aninhado: mesmo payload e ramos, com `source` aditivo em todos os resultados (draft/file), inclusive no ramo de erro de leitura e no de arquivo vazio.
- Cópias de template em `hosts/`/`plugins/` **não** foram regeneradas: mesmo precedente do Plano 01 (task 01.1) — o build roda no Plano 05 (INV5 fecha lá; baseline §0 "mudança de template exige rodar o build" é cumprida no Plano 05, que é o dono da regeneração e do commit das cópias).

#### Lacunas descobertas

- Nenhuma lacuna estrutural: o sink de VC1 e o handler `scanAcceptance` (L1751) existem onde o plano supôs; nenhum leitor antigo do scan encontrado (o orquestrador chama o gate com `sprint_path` via MCP `tools/call` — caminho preservado e com teste próprio).
- Fato de baseline (não lacuna do plano): 22 testes de `server.test.js` falham no HEAD puro por `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` (mesmo conjunto do Plano 01, re-verificado via `git archive`). Não tocado neste plano.

#### Pendências

- Nenhuma pendência do recorte. 22 falhas pré-existentes de ambiente permanecem (fora do escopo do plano 02; deverão ser resolvidas antes do gate agregado `test-all.sh` no Plano 05/fechamento).
- P1 (budget de reparo do revisor) permanece aberta — vence no Plano 04.

#### Histórico

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Execução do Plano 02: task 02.1 (pendência `fonte_discussao_ausente` no sink da conformance + template §4 + migração de fixtures), task 02.2 (`scanAcceptance` com `sprint_markdown` exclusivo e `source` draft/file + schema da tool), 5 testes novos (2 etapa3 + 3 server), falsificados os 5 ACs materiais com red observado e revertido, gates rodados | `git diff`, `node --test` × 3, `check-consistency`, falsificações F1-F5 |

### Auditoria pós-implementação

**Veredito: CONCLUÍDO (2026-08-06).** 2 tasks, 5 ACs (todos materiais), 1 cenário (CN6), fronteira VC1 reconferida, 5 gates confrontados. Nenhum finding P0/P1 em aberto; 2 findings P2 corrigidos no recorte (abaixo); observações P3 registradas.

#### Cenários traçados neste recorte

| Cenário | Trace no código real | Fronteira alcançada | Prova executável |
|---------|----------------------|---------------------|------------------|
| CN6 — sprint sem fonte de discussão é recusada | §4 linha `Discussão` → `document_quality.mjs:validateSprintFileConformance` (L570-588): casamento pelo rótulo da primeira célula, placeholders `[link/resumo]`/`[...]`/`—`/`N/A`/vazia ou linha ausente → pendência `fonte_discussao_ausente` (item `Discussão`, `line` da §4, `next_action: preencher_fonte_discussao`) → pass-through sem filtro em `server.js:verifySprintFile` (L2075-2090) → `status: 'blocked'`; também agregada por `inspectBacklogIndex` (L2247) no gate de backlog | completa neste plano (sink = conformance + gate) | `build/tests/etapa3.test.mjs::discussão: placeholder na linha Discussão da §4 bloqueia; path real passa (AC-02.1.1)` + `::discussão: sprint standalone sem linha Discussão é recusada (AC-02.1.2)` — criadas e passando (19/19) |
| CN1 (habilitador, fecha no Plano 03) | `talos_scan_acceptance` com `sprint_markdown` → `server.js:scanAcceptance` (L1751-1862) → `scanSectionPatterns` sobre texto em memória → `blocking_count > 0` com `source: 'draft'`, `sprint_path: null`, nada gravado em disco | segmento do scan completo neste plano; rodada de entrevista estruturada (`question_prompt`) + persistência `Origem: usuario` são tasks nomeadas do Plano 03 (continuidade garantida) | `server.test.js::talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)` — passando |

Retraçado integralmente nesta auditoria (primeiro trace deste recorte). CN2/CN3/CN5 (Plano 01) não são servidos por este plano; fixtures que os exercitam (`sprintDoc`/`sprintFixture`) migradas com a linha `Discussão` real continuam verdes (19/19 etapa3; 264 pass server.test.js).

#### Fronteira de entrada (VC1) e delta contra o provado

- VC1 (fronteira, `Fecha em` Plano 01): sink real `validateSprintFileConformance` (L526) continua consumindo `origin` dos itens §7.3 (L671-682) e das linhas §7.1 (L800-855) via `validateOriginToken`; os dois chamadores (`verifySprintFile` L2067, `inspectBacklogIndex` L2247) seguem passando `root: consumerRoot(args)`; leitor legado `applyDecisionRow` (L1084, 3 colunas, único chamador `applyInterviewRound`) intocado — `git diff` do recorte não o altera. LEDGER `PROVADO` coerente com o código. **Nenhuma regressão de entrada.**
- Delta do recorte: o bloco novo de CN6 adiciona pendência ao mesmo sink sem tocar o fluxo de procedência; fixtures migradas não alteram asserções de CN2/CN3/CN5 (suítes verdes confirmam).

#### Consumo no sink e mutadores

- Nenhum valor crítico vence neste plano; VC1 reconferido como fronteira (acima).
- Mutadores tocados: nenhum. `applyDecisionRow`/`applyInterviewRound`/`persistInterviewRound`/`updateSprintStatus` fora do diff do recorte (confirmado em `git diff HEAD`).

#### Reachability do legado (2.7)

- Nenhuma linha morre no Plano 02 (LEG1 → 03, LEG2 → 01). Busca `Discussão` pré-mudança: zero ocorrências em fixtures; pós-mudança, fixtures migradas em `sprintDoc`/`sprintFixture`. Nenhum chamador novo de caminho legado.

#### Falsificação de aceite material (re-executada nesta auditoria)

F1-F5 reaplicados por mutação → teste focado → red capturado → restauração byte a byte (`md5`/`cmp` confirmado), sobre o código já corrigido:

| AC | Falsificador | Red nesta auditoria |
|----|--------------|---------------------|
| AC-02.1.1 | remover checks de placeholder em `semFonte` | sim — `AC-02.1.1` vermelho (1 falha) |
| AC-02.1.2 | condicionar a regra à presença de backlog | sim — `AC-02.1.2` (e `AC-02.1.1`) vermelhos (2 falhas) |
| AC-02.2.1 | branch `sprint_markdown` grava em disco e força `source:'file'` | sim — `AC-02.2.1` vermelho (23 = 22 baseline + 1) |
| AC-02.2.2 | remover o branch de `sprint_path` (falsificador declarado) | sim — `AC-02.2.2` vermelho + 5 testes legados de path (28 = 22 + 6) |
| AC-02.2.3 | remover o bloco de exclusividade | sim — `AC-02.2.3` vermelho (23 = 22 + 1) |

Nota de divergência registrada: o falsificador registrado no Impl para AC-02.2.2 ("chamada sem markdown vira `requiredString(args,'sprint_markdown')`"), lido literalmente, não reproduz o red alegado sobre AC-02.2.2 (com essa mutação o teste que fica vermelho é AC-02.2.3, pela asserção da mensagem de erro); o falsificador **declarado** no AC (remover o branch de path) discrimina o aceite corretamente e foi o aplicado aqui. Mesma capacidade discriminante do aceite; mecânica registrada diverge da declarada — P3, não bloqueia.

#### Correções desta auditoria (P2, dentro do recorte)

1. **Pendency id `fonte_discussao_ausente` (P2).** O contrato nomeia a pendência `fonte_discussao_ausente` (CN6 no GUIDE, task 02.1, AC-02.1.1/02.1.2), mas o código emitia só `category: 'contexto_fontes'` (a "categoria" do plano não tem campo no modelo — `category` é o id da pendência, padrão do repo) e o Impl afirmava emitir o nome do pack. Corrigido: `document_quality.mjs` emite `category: 'fonte_discussao_ausente'`; testes de AC-02.1.1/02.1.2 atualizados para o id do contrato. Red re-confirmado (F1/F2) sobre o código corrigido. Correção documental registrada na task 02.1.
2. **Rascunho vazio (P2).** A task 02.2 declara "Rascunho vazio: mesma pendência de arquivo vazio (`blocking_count: 1`)" sem AC nem `sem AC: motivo`; o código lançava `sprint_path obrigatório` para `sprint_markdown` vazio (indistinguível de ausente no guard antigo). Corrigido: guard em `scanAcceptance` passa a tratar `sprint_markdown` explicitamente vazio como rascunho vazio (`blocking_count: 1`, `source: 'draft'`, `pattern: '(empty file)'`), preservando o erro de argumento para ausência real; cobertura adicionada ao teste de AC-02.2.1; comportamento marcado como coberto na task 02.2. Falsificado: reverter o guard → `AC-02.2.1` vermelho (23 = 22 + 1).

#### Gates

| Gate | Resultado nesta auditoria |
|------|---------------------------|
| `node --test build/tests/etapa3.test.mjs` | 19/19 pass (após correções) |
| `node --test packages/mcp-server/server.test.js` | 264 pass / 22 fail — conjunto de falhas **idêntico** ao HEAD puro `8457c2f` (verificado via `git archive` em `/tmp/talos-head-02`: 261 pass / 22 fail, mesmos 22 nomes, mesma causa `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` em `writeHandoffTemplateFixture`); os 3 a mais são os testes novos do plano; nenhuma regressão nova |
| `node --test build/tests/classify-findings.test.mjs build/tests/etapa3.test.mjs build/tests/fixtures-s9.test.mjs` | 29/29 pass |
| `node build/check-consistency.mjs` | exit 0 |
| `git diff --check` | limpo |

#### Promoção de ledger

| Obrigação | Estado | Evidência |
|-----------|--------|-----------|
| CN6 | PROVADO | `etapa3::discussão: placeholder... (AC-02.1.1)` (placeholders `[link/resumo]`, `[...]`, `—`, `N/A`, vazia → `fonte_discussao_ausente` com `line` numérico e pendência única; path real passa) + `etapa3::discussão: sprint standalone... (AC-02.1.2)` (standalone sem a linha → recusada, `line: null`); trace até `verifySprintFile` `status:blocked` (pass-through sem filtro); falsificadores F1/F2 vermelhos |

Nenhuma linha rebaixada: fronteira VC1 conferida no código no estado que o LEDGER declara (`PROVADO`) e nenhuma obrigação de plano anterior quebrada ou tocada com efeito observável.

#### Observações (P3, não bloqueiam)

1. 22 falhas pré-existentes em `server.test.js` (ENOENT `.talos/memory/HANDOFF_TEMPLATE.md`) — dívida de ambiente já conhecida do Plano 01, sem dono no pack; deverá ser resolvida antes do gate agregado `test-all.sh` (Plano 05/fechamento). Não tocadas.
2. Cópias de template em `hosts/`/`plugins/` seguem no schema antigo — delegação explícita: task 01.1 e INV5 (AC-05.2.1) fecham a regeneração no Plano 05; mesmo precedente do Plano 01. O contrato do Plano 02 não exige regenerar (task 02.1 não instrui; Impl declara a delegação).
3. F4: mecânica registrada no Impl diverge do falsificador declarado (ver tabela de falsificação acima); capacidade discriminante confirmada pelo falsificador declarado.
4. Schema da tool `talos_scan_acceptance`: `required` passou de `['run_id','sprint_path']` para `['run_id']` com `sprint_markdown` opcional aditivo — mudança **retrocompatível**: chamadas do orquestrador com `sprint_path` (Full mode passo 2) continuam válidas com `source: 'file'`; sem nenhum dos dois, o erro de argumento obrigatório existente permanece (teste cobre). Nenhum campo do schema v5 de capabilities alterado; contagem de tools registradas segue 16 (INV3 não violada por este plano).

**Promovido a CONCLUÍDO (2026-08-06) nesta auditoria; Status espelhado no §4 do GUIDE.md.**

**Histórico**

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Auditoria fria do Plano 02: A0 (CN6 dívida; VC1 fronteira; delta) sem regressão; trace CN6 até o sink + gate; F1-F5 re-executados (red reproduzido, restauração byte a byte); baseline das 22 falhas confirmada no HEAD (`/tmp/talos-head-02`); corrigidos 2 P2 no recorte (pendency id `fonte_discussao_ausente`; rascunho vazio em `scanAcceptance`) com falsificação própria; gates re-rodados (19/19, 264+22, 29/29, check-consistency, diff --check); LEDGER: CN6 → PROVADO | `git diff`, `node --test` × 3, `check-consistency`, falsificações F1-F5 + guard do rascunho vazio |
