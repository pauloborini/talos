# Plano 03 - Entrevista estruturada dentro do backlog-generator

**Pack:** ../GUIDE.md

**Objetivo do plano:** a ambiguidade do backlog é fechada por rodadas estruturadas, com opções e recomendação, antes de qualquer arquivo ser gravado, e cada resposta vira decisão marcada `Origem: usuario`.

**Resultado esperado:** hoje o passo 4 da skill manda "fazer até 3 perguntas objetivas" em texto livre, sem `decision_id` nem persistência; depois, a skill escaneia o rascunho, roda rodadas pelo mecanismo declarado do host e só grava quando as decisões estão fechadas e rotuladas.

**Cenários servidos:** CN1.

**Fronteira de entrada:** VC1.

**Fecha neste plano:** CN1, LEG1.

**Dependências:** Planos 01 e 02.
**Natureza:** OBRIGATÓRIO
**Ativação:** sempre
**Risco:** médio
**Status:** CONCLUÍDO (2026-08-06)

### Direção de implementação

Entrega as etapas 1 e 2 do fluxo de 2.4. A mudança é de skill, não de código: `talos-backlog-generator/SKILL.md` passa a descrever um ciclo escanear → perguntar → persistir, apoiado no que os Planos 01 e 02 tornaram possível. O rigor da entrevista já existe e está escrito em `talos-sprint-interview` (3 opções, recomendada explícita, `decision_id` estável, persistência imediata); este plano traz esse mesmo contrato para a fase de backlog em vez de inventar um segundo formato.

O parâmetro que não pode ser inventado é o mecanismo: número máximo de perguntas e de opções por rodada vêm de `capabilities.question_prompt` — o descritor varia por host (`max_questions: 3` no **Codex App**, `server.js:296`; 4 nos demais, ex.: claude `server.js:271`). Não existe adapter `cursor` em `HOST_ADAPTERS`: Cursor é servido pelo perfil `claude`.

### Responsabilidades do plano

| Responsabilidade | Local | Implementação planejada |
|------------------|-------|--------------------------|
| Ciclo de entrevista | `packages/skills/talos-backlog-generator/SKILL.md` (passo 4) | Escanear rascunho, perguntar em rodadas, persistir, reindexar |
| Mecanismo de pergunta | `packages/mcp-server/server.js:capabilities` (`question_prompt`) | Lido em runtime; nada hardcodado |
| Marcação de procedência | `document_quality.mjs:applyDecisionRow` (3º argumento `origin`) | Resposta de entrevista grava `usuario` |

### Invariantes, valores críticos e regressões

- Valor crítico tocado: VC1, sink `validateSprintFileConformance`. Resposta de entrevista que não chega ao artefato com `Origem: usuario` derrota o propósito do plano.
- Legado tocado: LEG1 (entrevista em texto livre), destino `matar neste plano` — nos **dois** sítios do `SKILL.md`: passo 4 e "Entradas aceitas".
- Regressão provável: transformar a entrevista em bloqueio de pipeline. O Talos tem o princípio de continuação automática — decisão em aberto propaga e continua. A entrevista fecha ambiguidade detectada pelo scan; ela não trava o fluxo quando o usuário não responde.

### Tasks

#### 03.1 Reescrever o passo de fechamento de ambiguidade

**Entrega:** o passo 4 da skill descreve entrevista estruturada e mata o texto livre.

**Implementação planejada:**
Substituir o passo 4 atual ("se uma decisão bloquear a decomposição segura, faça até 3 perguntas objetivas") por um passo que: (1) monta backlog e sprint files em memória; (2) chama `talos_scan_acceptance` com `sprint_markdown` para cada sprint do rascunho; (3) enquanto houver padrão bloqueante, resolve `talos_capabilities.question_prompt` e conduz uma rodada respeitando `max_questions` e `options_per_question` do descritor, com recomendação explícita e `decision_id` `D<n>` estável; (4) aplica cada resposta com `Origem: usuario` **ao fim da rodada em que ela foi dada**, antes de abrir a rodada seguinte; (5) reindexa e recalcula os padrões pendentes, sem repetir decisão já fechada — `pendingInterviewQuestions` é o filtro.
Sobre o "aplicar": enquanto a sprint só existe como rascunho, aplicar é editar o markdown em memória e gravá-lo assim que as rodadas fecharem — `persistInterviewRound` lê o arquivo antes de aplicar (`document_quality.mjs:934`) e, sobre path inexistente, estoura `INTERVIEW_PERSISTENCE_FAILED`. Quando a rodada roda sobre sprint file **já existente em disco** (caminho de atualização de backlog), a escrita é `persistInterviewRound`, rodada a rodada, como na `talos-sprint-interview`. O que está proibido nos dois casos é acumular respostas de várias rodadas para materializar tudo no fim.
Segundo sítio do legado: a seção "Entradas aceitas" do mesmo `SKILL.md` diz "Pergunte antes de salvar somente quando faltar uma das decisões bloqueantes: resultado final esperado, fronteira de escopo ou plataforma/produto alvo". Essa frase contradiz o ciclo escanear → perguntar (limita a entrevista a três assuntos fixos e à ausência de informação, não à ambiguidade detectada) e **não** é alcançada pelo grep de LEG1. Reescrever junto, apontando o scan como gatilho.
O passo declara explicitamente que decisão que o usuário não fecha vira premissa **registrada** (`Origem: premissa`), não pergunta repetida: a consequência de continuar com premissa já é o bloqueio do Plano 01 quando a sprint for `Must`/`P0`.

**Responsabilidade e integração:** consome os gates dos Planos 01 e 02; nenhuma tool nova.

**Comportamentos operacionais aplicáveis:**

- Principal: rodadas até zerar padrão bloqueante ou o usuário declinar.
- Usuário declina responder: registrar `Origem: premissa` e seguir, sem travar o fluxo.
- Host sem `question_prompt` no descritor: bloquear a rodada em vez de degradar para pergunta livre, como `talos-sprint-interview` já determina.

**Invariantes e regressões:**

- Não repetir decisão já fechada entre rodadas.
- Não inventar limite de perguntas: o número vem do descritor do host.

**Critérios de aceite:**

- `AC-03.1.1` O passo 4 do `SKILL.md` instrui a escanear o rascunho com `sprint_markdown` antes de gravar; a busca por "até 3 perguntas objetivas" não retorna nada **e** a frase de "Entradas aceitas" que restringe a pergunta às três decisões bloqueantes ("Pergunte antes de salvar somente quando faltar") também não. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: matar só a frase do passo 4 — a regra antiga sobrevive em "Entradas aceitas", o executor fica com duas instruções contraditórias e a entrevista volta a depender de faltar informação, não de o scan achar ambiguidade.
- `AC-03.1.2` O passo instrui a ler `max_questions` e `options_per_question` de `talos_capabilities.question_prompt`, sem citar número fixo nem nome de ferramenta de host. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: escrever "faça 4 perguntas" ou citar `AskUserQuestion` — a skill quebra o contrato multi-host do adapter.
- `AC-03.1.3` O passo determina que cada resposta seja aplicada com `Origem: usuario` ao fim da rodada em que foi dada (no rascunho, quando a sprint ainda não existe em disco; via `persistInterviewRound`, quando existe), e que decisão declinada vire `Origem: premissa` sem travar o fluxo. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: acumular respostas de todas as rodadas para materializar no fim — a decisão fechada na rodada 1 não filtra a rodada 2 e a pergunta se repete, além de a interrupção no meio perder tudo.

**Evidência esperada:**

- `AC-03.1.1` -> `grep` no `SKILL.md` + `build/tests/etapa3.test.mjs::skill_backlog_sem_texto_livre`.
- `AC-03.1.2` -> `build/tests/etapa3.test.mjs::skill_backlog_usa_descritor_do_host`.
- `AC-03.1.3` -> leitura do `SKILL.md`.

**Validação focada:**

```bash
node --test build/tests/etapa3.test.mjs
grep -nE "até 3 perguntas objetivas|Pergunte antes de salvar somente quando faltar" packages/skills/talos-backlog-generator/SKILL.md || echo "LEG1 morto nos dois sítios"
```

#### 03.2 Procedência no que a skill escreve

**Entrega:** os artefatos gerados nascem com `Origem` preenchida em toda decisão e todo AC.

**Implementação planejada:**
Estender as regras de qualidade do `SKILL.md` (seção "Qualidade esperada do backlog") para exigir `Origem` em cada decisão do backlog e `origin` em cada `AC-*`, com a instrução de derivar o valor da fonte real: resposta de entrevista vira `usuario`; leitura de código/contrato vira `derivado:<path>` com o path verificado; o resto é `premissa`, declarado como tal em vez de disfarçado. Acrescentar às "Proibições" que marcar como `usuario` ou `derivado:` o que o modelo inferiu é falsificação de procedência — o pior defeito possível neste release, porque desarma justamente o gate que o Plano 01 instalou.

**Responsabilidade e integração:** a validação já existe (Plano 01); esta task garante que a skill produza artefato que passe por mérito, não por preenchimento cosmético.

**Comportamentos operacionais aplicáveis:**

- Principal: toda linha gravada carrega procedência coerente com a fonte.

**Invariantes e regressões:**

- Não transformar `premissa` em rótulo a evitar: premissa declarada é resultado legítimo; premissa disfarçada é o defeito.

**Critérios de aceite:**

- `AC-03.2.1` A seção de qualidade do `SKILL.md` exige `Origem`/`origin` em decisões e ACs, e as proibições nomeiam falsificação de procedência. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: pedir a coluna sem proibir o rótulo falso — a skill preenche `derivado:` sem ter lido o arquivo e o gate do Plano 01 valida um path que existe por acaso.

**Evidência esperada:**

- `AC-03.2.1` -> leitura do `SKILL.md`.

**Validação focada:**

```bash
grep -n "Origem" packages/skills/talos-backlog-generator/SKILL.md
```

### Gates e smoke

```bash
node --test build/tests/etapa3.test.mjs
git diff --check
```

Smoke manual, quando aplicável:

1. Rodar `talos-backlog-generator` sobre um brainstorm curto com uma ambiguidade deliberada.
2. Observar a rodada de perguntas antes de qualquer arquivo aparecer em `.talos/backlog/`.
3. Conferir no sprint file gerado que a decisão respondida está com `Origem: usuario`.

### Definition of done

- [ ] Implementação segue direção, responsabilidades e fluxo planejados.
- [ ] Regras locais respeitadas.
- [ ] Critérios de aceite possuem evidência.
- [ ] Todo aceite material tem linha de falsificação com red observado.
- [ ] Todo comportamento operacional declarado nas tasks tem AC, ou `sem AC: motivo`.
- [ ] CN1 tem a prova executável declarada em 2.1 criada e passando.
- [ ] VC1 chega ao sink com asserção discriminante (procedência sobrevive à persistência).
- [ ] LEG1 morto conforme 2.7, comprovado por busca sem resultado.
- [ ] Gates focados passam.
- [ ] `Impl` registra implementação real, testes, decisões e pendências.

### Registro de implementação

**Impl:** EXECUTADO (2026-08-06) — plano selecionado (03), pack REVISAO_FRIA_BACKLOG_GUIDE.

- **Baseline:** HEAD `bc61b0f` (Plano 02 CONCLUÍDO); worktree limpo exceto `.commandcode/` não rastreada (não tocada). HEAD final: `bc61b0f` — sem commit (proibido nesta etapa).
- **Arquivos e símbolos alterados:** `packages/skills/talos-backlog-generator/SKILL.md` (passo 4 do workflow, seção "Entradas aceitas", seção "Qualidade esperada do backlog", seção "Proibições"); `build/tests/etapa3.test.mjs` (+2 testes novos); `plans/03-entrevista.md` (este Impl); `GUIDE.md` §4 (status do plano 03). Nenhum símbolo de código produtivo alterado — o plano é documental por direção (2.4: "A mudança é de skill, não de código").
- **Fronteira de entrada (VC1) confirmada no código, sem regressão de entrada:** `applyDecisionRow` (`document_quality.mjs` L1116-1136) monta a linha com 3 colunas e preserva a célula `Origem` existente quando o chamador não informa `origin`; insert de linha nova sob o cabeçalho de 3 colunas; cabeçalho de 2 colunas continua lançando `DECISION_TABLE_MISSING`. `persistInterviewRound` (L1170-1191) lê o arquivo antes de aplicar (L1174), grava via temp+rename+readback e embrulha falhas em `INTERVIEW_PERSISTENCE_FAILED` (path inexistente ⇒ falha, nunca criação silenciosa). Sink `validateSprintFileConformance` consome `origin` (provado por AC-01.2.x/AC-01.3.x já verdes).

**Solução e fluxo implementados**

- Passo 4 reescrito como ciclo escanear → perguntar → persistir: (1) `talos_scan_acceptance` com `sprint_markdown` de cada sprint do rascunho, antes de gravar; (2) rodadas enquanto `blocking_count > 0`, com `max_questions`/`options_per_question` lidos de `talos_capabilities.question_prompt` (sem número fixo nem tool name), `decision_id` `D<n>` estável, recomendação explícita e filtro `pendingInterviewQuestions`; (3) resposta aplicada com `Origem: usuario` ao fim da rodada em que foi dada — em memória enquanto a sprint é rascunho (gravação quando as rodadas fecharem), `persistInterviewRound` rodada a rodada quando o sprint file já existe em disco (lê o arquivo antes de aplicar; path inexistente ⇒ `INTERVIEW_PERSISTENCE_FAILED`); proibida acumulação de respostas de várias rodadas; (4) reindexação e recálculo de padrões. Decisão declinada vira `Origem: premissa` registrada, não pergunta repetida, com a consequência declarada (bloqueio de `premissa` em `Must`/`P0` do Plano 01). Host sem `question_prompt` no descritor ⇒ bloqueia a rodada, sem degradar para pergunta livre (mesmo contrato da `talos-sprint-interview` passo 3).
- "Entradas aceitas" reescrito: o gatilho de pergunta passa a ser o scan de ambiguidade do passo 4, não lista fixa de três assuntos.
- "Qualidade esperada do backlog": novo bullet exigindo `Origem` em cada decisão do backlog e `origin` em cada `AC-*` da §7.3, com derivação da fonte real (`usuario` / `derivado:<path>` verificado / `premissa`).
- "Proibições": novo bullet nomeando falsificação de procedência (marcar como `usuario`/`derivado:` o que o modelo inferiu).

| Task | Estado | Implementação real | Arquivos/símbolos |
|------|--------|--------------------|-------------------|
| 03.1 | IMPLEMENTADA | Passo 4 + "Entradas aceitas" reescritos; LEG1 morto nos dois sítios; ciclo escanear→perguntar→persistir com descritor do host e `Origem: usuario`/`premissa` | `SKILL.md` (passo 4, Entradas aceitas) |
| 03.2 | IMPLEMENTADA | `Origem`/`origin` obrigatórios com derivação da fonte; proibição de falsificação de procedência | `SKILL.md` (Qualidade esperada, Proibições) |

**ACs e evidência**

| AC | Resultado | Evidência |
|----|-----------|-----------|
| AC-03.1.1 | PASSOU | `etapa3::skill_backlog_sem_texto_livre` + `grep -nE "até 3 perguntas objetivas\|Pergunte antes de salvar somente quando faltar" SKILL.md` sem resultado (exit 1) |
| AC-03.1.2 | PASSOU | `etapa3::skill_backlog_usa_descritor_do_host` |
| AC-03.1.3 | PASSOU | Leitura do `SKILL.md`: "ao fim da rodada em que foi dada", "persistInterviewRound", "Origem: premissa", "não degrade para pergunta livre" presentes (grep green) |
| AC-03.2.1 | PASSOU | Leitura do `SKILL.md`: bullet de `Origem`/`origin` na qualidade e "falsificar procedência" nas proibições (grep green) |

**Falsificação de aceite material (red observado)**

| AC | `falseia se` declarado | Falsificador real do teste | Red observado | Resultado |
|----|------------------------|----------------------------|---------------|-----------|
| AC-03.1.1 | Matar só a frase do passo 4 — a regra antiga sobrevive em "Entradas aceitas" | Teste assere ausência das DUAS frases legadas + presença de `talos_scan_acceptance`/`sprint_markdown` no passo 4 | Teste escrito antes da implementação; run contra o SKILL.md pré-edição: `AssertionError: passo 4 ainda instrui entrevista em texto livre` (+ falharia no sítio 2 e no scan) — 19 pass / 2 fail | VERMELHO capturado; verde após a edição |
| AC-03.1.2 | Escrever "faça 4 perguntas" ou citar `AskUserQuestion` | Teste assere `talos_capabilities`/`question_prompt`/`max_questions`/`options_per_question` no passo 4 e ausência de número fixo e de nomes de tool de host (`AskUserQuestion`, `request_user_input`, `interactive_prompt`, `native_structured_question`) | Mesmo run: `AssertionError: passo 4 não chama talos_capabilities` | VERMELHO capturado; verde após a edição |
| AC-03.1.3 | Acumular respostas de todas as rodadas para materializar no fim | Asserção de leitura (grep documental): "ao fim da rodada em que foi dada" + "nunca acumule respostas de várias rodadas" + premissa registrada | `git show HEAD:SKILL.md` sem nenhuma das sentenças obrigatórias (7/7 ausentes — red empírico por leitura do estado pré-edição) | VERMELHO demonstrado; verde após a edição |
| AC-03.2.1 | Pedir a coluna sem proibir o rótulo falso | Asserção de leitura: bullet de `Origem`/`origin` com derivação da fonte + proibição nomeando falsificação | Mesma demonstração: "falsificar procedência" ausente no HEAD | VERMELHO demonstrado; verde após a edição |

**Prova executável de CN1 (2.1) — estado por perna**

| Perna declarada em 2.1 | Prova real | Estado |
|------------------------|------------|--------|
| `server.test.js::scan_acceptance_draft_em_memoria` (scan antes do arquivo) | `talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)` (server.test.js L1420) — criada no Plano 02 | passando (pré-existente) |
| `etapa3::skill_backlog_sem_texto_livre` (rodada estruturada substitui o texto livre) | `skill_backlog: texto livre morto nos dois sítios; scan do rascunho antecede a gravação (AC-03.1.1 / LEG1)` — criada neste plano | passando (red observado) |
| `etapa3::persist_preserva_origem` (resposta chega ao artefato como `usuario`) | `entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)` — nome difere do declarado em 2.1; mapeada pelo AC-01.3.1 no LEDGER | passando (pré-existente) |

CN1 completo: as três pernas existem e passam na suite real.

**Valor crítico consumido (VC1)**

| Valor | Sink declarado | Sink real | Situação do leitor antigo | Prova discriminante |
|-------|----------------|-----------|---------------------------|---------------------|
| Procedência (`usuario`/`derivado:<path>`/`premissa`) | `validateSprintFileConformance` | `validateSprintFileConformance` (mesmo) | `applyDecisionRow` legado de 2 colunas já morto no Plano 01 (LEG2 PROVADO); nenhum leitor antigo novo no caminho | `etapa3::entrevista: persistir rodada preserva Origem...` (AC-01.3.1): falharia se a linha voltasse a 2 colunas (F6/F7 do Plano 01); neste plano, o passo 4 da skill exige aplicar `Origem: usuario` por rodada (grep green) |

**Cutover de legado (LEG1)** — `Morre em`: Plano 03

| Linha | Situação | Evidência |
|-------|----------|-----------|
| LEG1 (passo 4 + "Entradas aceitas") | morto nos dois sítios | `grep -nE "até 3 perguntas objetivas\|Pergunte antes de salvar somente quando faltar" packages/skills/talos-backlog-generator/SKILL.md` → sem resultado (exit 1); passo reescrito citando `question_prompt`; busca no repo inteiro: `grep -rn "até 3 perguntas objetivas" packages/` sem resultado |

**Delta de ledger proposto** (promoção é ato de auditoria — não gravado no LEDGER)

| Obrigação | Estado proposto | Onde ficou |
|-----------|-----------------|------------|
| CN1 | PRONTO (prova executável completa) | `server.test.js::talos_scan_acceptance... (AC-02.2.1)` + `etapa3::skill_backlog_sem_texto_livre` (nova) + `etapa3::entrevista: ... (AC-01.3.1)` |
| LEG1 | morto | grep dos dois sítios sem resultado; passo 4 reescrito |

Nenhuma `regressão de entrada` encontrada (VC1 confirmado no código, idêntico ao que o LEDGER declara).

**Gates e resultados**

| Gate | Resultado |
|------|-----------|
| `node --test build/tests/etapa3.test.mjs` | 21 pass / 0 fail (inclui os 2 novos e todos os ACs dos Planos 01/02) |
| `grep` de LEG1 (validação focada 03.1) | exit 1 — morto nos dois sítios |
| `node --test packages/mcp-server/server.test.js` | 264 pass / 22 fail — **falha pré-existente de ambiente**, idêntica com e sem este recorte (verificado por stash): `copyfile` de `.talos/memory/HANDOFF_TEMPLATE.md` (ENOENT; arquivo não rastreado no repo) derruba os testes de handoff/update_sprint_status. Não é regressão deste plano |
| `node build/check-consistency.mjs` | exit 0 — "check-consistency: ok" |
| `git diff --check` | limpo |

**Comportamentos operacionais (task 03.1) vs AC**

| Comportamento | Cobertura |
|---------------|-----------|
| Rodadas até zerar padrão bloqueante ou usuário declinar | Passo 4 (enquanto `blocking_count > 0`; declinada vira premissa) — AC-03.1.3 |
| Usuário declina ⇒ `Origem: premissa` sem travar | Passo 4 — AC-03.1.3 |
| Host sem `question_prompt` ⇒ bloquear rodada, sem pergunta livre | Passo 4 ("bloqueie a rodada: não degrade para pergunta livre") — sem AC dedicado no plano; motivo: seam documental, espelha o contrato já existente da `talos-sprint-interview` (passo 3), que também não tem AC próprio nesta trilha |

**Smoke manual (passo 1-3 do plano):** NÃO EXECUTADO — N/A neste ambiente: exige host com MCP `talos_scan_acceptance` + `question_prompt` em runtime; as partes determinísticas do cenário estão cobertas pelas três pernas automatizadas de CN1.

**Desvios técnicos:** nenhum. Nomes dos testes novos seguem exatamente os declarados no plano (`skill_backlog_sem_texto_livre`, `skill_backlog_usa_descritor_do_host`).

**Lacunas descobertas:** nenhuma lacuna estrutural no código. Nota: o nome do teste de persistência declarado em 2.1 (`persist_preserva_origem`) difere do nome real criado no Plano 01 (`entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)`) — mapeamento registrado acima para a auditoria; sem impacto funcional.

**Pendências conhecidas:** (1) 22 falhas pré-existentes em `server.test.js` por `.talos/memory/HANDOFF_TEMPLATE.md` ausente — ambiente, fora do recorte; (2) smoke manual da rodada de entrevista em host real não executado (sem host MCP neste ambiente) — coberto pelas provas automatizadas de CN1; (3) P1 do GUIDE (budget de reparo do revisor) permanece para o Plano 04.

### Auditoria pós-implementação

**Veredito: CONCLUÍDO (2026-08-06).** 2 tasks, 4 ACs (todos documentais, Seam N/A conforme o plano), 1 cenário (CN1), 1 linha de legado (LEG1, dois sítios), fronteira VC1 reconferida no código, 5 gates confrontados. Nenhum finding P0/P1/P2 em aberto; 3 observações P3 registradas.

#### Fase A0 — dívida, fronteira e delta

- **Dívida vencida (`Fecha neste plano`):** CN1 e LEG1 — ambos verificados e promovidos abaixo.
- **Fronteira de entrada (VC1) no código, sem regressão:** `applyDecisionRow` (`document_quality.mjs` L1116-1136) monta sempre as 3 células; linha existente preserva a célula `Origem` quando o chamador não informa `origin` (`resolvedOrigin = origin ?? (cells.length >= 3 && cells[2] !== '' ? cells[2] : 'usuario')`), insert sob cabeçalho de 3 colunas, cabeçalho de 2 colunas em `DECISION_TABLE_MISSING` (D17). `applyInterviewRound` (L1143-1168) passa `'usuario'` para toda resposta. `persistInterviewRound` (L1170-1191) lê o arquivo antes de aplicar (L1174), temp+rename+readback, embrulha em `INTERVIEW_PERSISTENCE_FAILED` — path inexistente falha, nunca cria em silêncio, nunca apaga procedência (pre-mortem P0 plausível 1 do GUIDE: não materializado; a sutileza CN1 confere). Sink `validateSprintFileConformance` consome `origin` dos itens §7.3 (L675-710) e das linhas §7.1 (L817-846) via `validateOriginToken` (L402). LEDGER `PROVADO` coerente com o código.
- **Delta contra o já provado (CN2/CN3/CN5/CN6/VC1/LEG2/INV1/INV2):** o diff do recorte toca apenas `SKILL.md`, `etapa3.test.mjs` (+2 testes, adições puras), `GUIDE.md` §4 e este plano. Nenhum símbolo de código de produto alterado (`document_quality.mjs`, `server.js`, templates fora do diff) — nenhuma linha promovida por Planos 01/02 quebrada ou tocada com efeito observável.

#### Cenários traçados neste recorte

| Cenário | Trace no código real | Fronteira alcançada | Prova executável |
|---------|----------------------|---------------------|------------------|
| CN1 — perguntas de múltipla escolha antes de existir arquivo; resposta vira decisão `Origem: usuario` | `SKILL.md` passo 4: `talos_scan_acceptance` com `sprint_markdown` de cada sprint do rascunho → `server.js:scanAcceptance` (L1751-1862, `source:'draft'`, sem tocar disco) → `blocking_count > 0` → rodada via `talos_capabilities` → `capabilities.question_prompt` (L614; `max_questions`/`options_per_question` por host, L272-527) → resposta aplicada ao fim da rodada com `Origem: usuario` (rascunho: markdown em memória, gravação quando as rodadas fecham; sprint file existente: `persistInterviewRound` rodada a rodada) → decisão declinada vira `Origem: premissa` registrada, sem travar; sem `question_prompt` no descritor, a rodada bloqueia (contrato espelhado da `talos-sprint-interview` passo 3, L45) | completa neste recorte (skill documental + gates/descritores já existentes dos Planos 01/02); continuidade p/ Plano 04 (CN1 é fronteira do 04) garantida por plano nomeado | 3 pernas, todas verdes: `server.test.js::talos_scan_acceptance: sprint_markdown escaneia rascunho em memória (AC-02.2.1)` (L1420, Plano 02) + `etapa3::skill backlog: texto livre morto nos dois sítios; scan do rascunho antecede a gravação (AC-03.1.1 / LEG1)` (nova) + `etapa3::entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)` (L454, Plano 01). Nota: o nome declarado em 2.1 (`persist_preserva_origem`) difere do nome real — mapeamento registrado no Impl; o cenário está de fato coberto (persiste rodada real em tmpdir, relê o arquivo e assere `\| D1 \| ... \| usuario \|`) |

Retraçado integralmente nesta auditoria (sem registro anterior neste plano). CN2/CN3/CN5/CN6 (Planos 01/02) não são servidos por este recorte; suítes que os exercitam continuam verdes (etapa3 21/21; server.test.js 264 pass).

#### Consumo no sink (VC1) e mutadores

- VC1 (fronteira): sink `validateSprintFileConformance` consome `origin` de §7.3/§7.1; prova discriminante da persistência re-lida (teste AC-01.3.1: falharia se a linha voltasse a 2 colunas). Nenhum leitor antigo novo no caminho.
- Mutadores: nenhum tocado pelo recorte. A semântica descrita no passo 4 da skill confere com o corpo real de `persistInterviewRound` (lê antes de aplicar; path inexistente ⇒ `INTERVIEW_PERSISTENCE_FAILED`) e de `applyDecisionRow` (3 colunas completas, preservação de `Origem`) — a instrução da skill não descreve comportamento que o código desminta.

#### Reachability do legado (LEG1)

- Sítio canônico (`packages/skills/talos-backlog-generator/SKILL.md`): `grep -nE "até 3 perguntas objetivas|Pergunte antes de salvar somente quando faltar"` → exit 1 (morto nos **dois** sítios nomeados no contrato 2.7: passo 4 e "Entradas aceitas"). Passo 4 reescrito citando `question_prompt`; "Entradas aceitas" reescrito apontando o scan como gatilho. Busca repo-wide: as frases só aparecem em cópias **geradas** (`hosts/`, `plugins/` — produzidas por `build/build-plugins.sh` L94/103/177/183/219/224/264/271/310/316), nos arquivos do pack (histórico/contrato) e nas mensagens de asserção dos testes novos. Cópias geradas serão regeneradas pelo build no Plano 05 (INV5/AC-05.2.1) — mesmo precedente dos templates nos Planos 01/02; P3, não bloqueia.
- Inércia comprovada por leitura: o HEAD pré-edição (`git show HEAD:SKILL.md`) continha "até 3 perguntas objetivas" e nenhuma das sentenças do ciclo estruturado (0/4 sentenças-chave) — a substituição é real, não cosmética.

#### Falsificação de aceite material (re-executada nesta auditoria)

ACs documentais (Seam N/A declarado no plano; evidência declarada = leitura/grep do `SKILL.md`). Conferidos `falseia se` × teste real × red:

| AC | `falseia se` declarado | Confronto nesta auditoria | Red |
|----|------------------------|---------------------------|-----|
| AC-03.1.1 | Matar só a frase do passo 4 — a regra antiga sobrevive em "Entradas aceitas" | Teste `skill_backlog_sem_texto_livre` assere ausência das DUAS frases legadas + presença de `talos_scan_acceptance`/`sprint_markdown` no passo 4 — discrimina os dois sítios | VERMELHO real (teste escrito antes da implementação; run pré-edição 19 pass/2 fail); confirmado por leitura do HEAD |
| AC-03.1.2 | Escrever "faça 4 perguntas" ou citar `AskUserQuestion` | Teste `skill_backlog_usa_descritor_do_host` assere `talos_capabilities`/`question_prompt`/`max_questions`/`options_per_question` no passo 4 e ausência de número fixo e de tool names de host (`AskUserQuestion`, `request_user_input`, `interactive_prompt`, `native_structured_question`) | VERMELHO real (pré-edição) |
| AC-03.1.3 | Acumular respostas de todas as rodadas para materializar no fim | Leitura: sentenças presentes — "ao fim da rodada em que foi dada, antes de abrir a rodada seguinte", "nunca acumule respostas de várias rodadas", `pendingInterviewQuestions` (filtro de decisão fechada), declinada ⇒ `Origem: premissa` registrada sem travar, sem `question_prompt` ⇒ bloqueia rodada | VERMELHO por estado pré-edição (HEAD: 0 sentenças obrigatórias — verificado nesta auditoria); evidência declarada no plano = leitura, coerente |
| AC-03.2.1 | Pedir a coluna sem proibir o rótulo falso | Leitura: bullet "Qualidade esperada do backlog" exige `Origem`/`origin` com derivação da fonte real (`usuario`/`derivado:<path>` verificado/`premissa`); "Proibições" nomeia "Não falsificar procedência" | VERMELHO por estado pré-edição (HEAD sem "falsificar procedência" — verificado nesta auditoria) |

Nenhum proxy: os dois ACs com teste automatizado leem o arquivo real da skill (`fs.readFileSync` no runner `node --test`); os dois ACs de leitura têm lastro no estado pré-edição verificado por `git show`.

#### Comportamentos operacionais (task 03.1) vs AC

| Comportamento | Cobertura |
|---------------|-----------|
| Rodadas até zerar padrão bloqueante ou usuário declinar | Passo 4 (`blocking_count > 0`; declinada vira premissa) — AC-03.1.3 |
| Usuário declina ⇒ `Origem: premissa` sem travar | Passo 4 — AC-03.1.3 |
| Host sem `question_prompt` ⇒ bloquear rodada, sem pergunta livre | Passo 4 — `sem AC: motivo` registrado; conferido contra `talos-sprint-interview/SKILL.md` passo 3 (L45): mesmo contrato, sem AC próprio na trilha — justificativa procedente |

#### Gates

| Gate | Resultado nesta auditoria |
|------|---------------------------|
| `node --test build/tests/etapa3.test.mjs` | 21/21 pass (inclui os 2 novos) |
| `node --test packages/mcp-server/server.test.js` | 264 pass / 22 fail — conjunto **idêntico** ao baseline das auditorias 01/02 (re-verificado nesta auditoria: todas as 22 com `ENOENT .talos/memory/HANDOFF_TEMPLATE.md` em `copyfile` — testes de handoff/update_sprint_status/manual_validation; `.talos/` é gitignored). Nenhuma regressão nova |
| `node build/check-consistency.mjs` | exit 0 — "check-consistency: ok" |
| `git diff --check` | limpo |

Smoke manual (passos 1-3 do plano): NÃO EXECUTADO — N/A aceito. O plano condiciona o smoke a "quando aplicável"; não há host MCP neste ambiente. As partes determinísticas de CN1 estão cobertas pelas 3 pernas automatizadas (scan em memória no seam real `server.test.js`; texto da skill; persistência com `fs` real em tmpdir), e 2.1 declara prova executável automatizada para CN1, não smoke. O único trecho não automatizável (round-trip do `question_prompt` do host) é salto externo ao código do projeto.

#### Promoção de ledger

| Obrigação | Estado | Evidência |
|-----------|--------|-----------|
| CN1 | PROVADO | Trace completo no recorte (skill passo 4 → `scanAcceptance` `sprint_markdown` → `question_prompt` → persistência `Origem: usuario`/`premissa`); 3 pernas de prova executável verdes (`server.test.js::AC-02.2.1` scan em memória; `etapa3::skill_backlog_sem_texto_livre`; `etapa3::entrevista: persistir rodada preserva Origem...` com asserção discriminante) |
| LEG1 | PROVADO (morto) | grep dos dois sítios nomeados em 2.7 sem resultado no sítio canônico (exit 1); passo 4 e "Entradas aceitas" reescritos citando `question_prompt`/scan; HEAD pré-edição comprova a substituição; cópias geradas em `hosts/`/`plugins/` regeneradas no Plano 05 (INV5) |

Nenhuma linha rebaixada: fronteira VC1 conferida no código no estado que o LEDGER declara (`PROVADO`) e nenhuma obrigação de plano anterior quebrada.

#### Observações (P3, não bloqueiam)

1. 22 falhas pré-existentes em `server.test.js` (ENOENT `.talos/memory/HANDOFF_TEMPLATE.md`) — dívida de ambiente já conhecida dos Planos 01/02, sem dono no pack; deve ser resolvida antes do gate agregado `test-all.sh` (Plano 05/fechamento). Não tocadas.
2. Cópias geradas de `SKILL.md` em `hosts/`/`plugins/` ainda carregam a frase legada de LEG1 — regeneradas pelo build no Plano 05 (INV5/AC-05.2.1); mesmo precedente das cópias de template nos Planos 01/02. Estado intermediário por design.
3. Nome de teste declarado em 2.1 para CN1 (`persist_preserva_origem`) difere do nome real (`entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)` — criado no Plano 01); divergência registrada no Impl e o cenário está coberto pelo teste real. Sem impacto funcional.

**Promovido a CONCLUÍDO (2026-08-06) nesta auditoria; Status espelhado no §4 do GUIDE.md.**

**Histórico**

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Auditoria fria do Plano 03: A0 (CN1/LEG1 dívida; VC1 fronteira; delta sem regressão); trace CN1 até o sink; reachability LEG1 (sítio canônico morto nos dois sítios; cópias geradas → Plano 05); ACs 03.1.1-03.2.1 confrontados com red verificado (testes pré-edição + HEAD); baseline das 22 falhas re-verificada (264 pass/22 fail, ENOENT HANDOFF_TEMPLATE.md); gates re-rodados (21/21, 264+22, check-consistency, diff --check); LEDGER: CN1, LEG1 → PROVADO | `git diff`, `node --test` × 2, `check-consistency`, `git show HEAD` do SKILL.md, greps de LEG1 |
