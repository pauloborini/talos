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
**Status:** PENDENTE

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

**Impl:** PENDENTE: ainda não executado.

### Auditoria pós-implementação

PENDENTE: ainda não auditado.
