# Revisão fria de backlog e procedência por linha — Guide de Execução e Auditoria (Planos 01-05)

> Pack layout: `GUIDE.md` + `LEDGER.md` + `plans/`

Entrega a versão `0.16.0` do plugin Talos: toda decisão e todo critério de aceite passam a declarar de onde vieram (`Origem`), a ambiguidade é fechada por entrevista estruturada **antes** de o backlog existir em disco, e a skill de geração de backlog encerra despachando um revisor frio que audita e corrige o que ela própria escreveu. Ataca a alucinação onde ela custa mais caro no Talos: backlog e sprint file são a única fonte do PLAN, que nasce no executor.

**Objetivo mensurável:** ao fim de uma execução de `talos-backlog-generator`, (a) nenhuma decisão inferida pelo modelo sustenta aceite de sprint `Must`/`P0` — o gate MCP bloqueia nomeando a linha; (b) nenhum `derivado:<path>` aponta arquivo inexistente; (c) o backlog e todos os sprint files daquela execução foram auditados e corrigidos por um subagente que não recebeu a conversa de origem, e o chamador recebeu o relato do que mudou.

**Escopo:** `packages/templates/` (SPRINT + BACKLOG_MESTRE), `packages/skills/_shared/scripts/document_quality.mjs`, `packages/mcp-server/server.js` (gates `talos_verify_sprint_file`, `talos_verify_backlog_index`, `talos_scan_acceptance`), `packages/skills/talos-backlog-generator/`, versionamento e docs de release.

**Pré-requisitos:** `INTENT.md` deste pack aprovado; `.talos/backlog/` vazio (ciclo anterior concluído e removido); nenhum artefato pré-`0.16.0` a preservar.

**Fontes de verdade:** `INTENT.md` (canônico deste pack); `.app-work/brainstorming/revisao-fria-backlog/BRAINSTORM.md`; `.app-work/brainstorming/revisao-fria-backlog/PERGUNTAS_EM_ABERTO.md` (Q-CBR-01 a Q-CBR-08); `CLAUDE.md` (invariantes do projeto)

**Perfil do projeto:** Node.js sem framework — `package.json` na raiz (sem lockfile commitado), MCP server em `packages/mcp-server/server.js` (CommonJS, 6469 linhas), utilitários de skill em ESM (`packages/skills/_shared/scripts/*.mjs`), testes com `node --test`, build em Bash (`build/build-plugins.sh`) + scripts Node (`build/*.mjs`). Artefatos de distribuição por host são **cópias geradas** e commitadas em `hosts/` e `plugins/`.

**Regras locais aplicadas:** `CLAUDE.md` (raiz — missão, invariantes 1 a 6, regras operacionais), `AGENTS.md` (raiz), `PATCH_PROCEDURE.md`, `NAMING.md`.

**Precedência de regras:** INTENT (intenção deste pack) + decisão explícita do usuário > regras locais (`AGENTS.md`/`CLAUDE.md`) > boas práticas da stack (fallback para edge case sem regra) > padrões do código. Direção não viola regra local dura. GUIDE §1 é índice fino do INTENT — não duplica prosa.

**Status:** PRONTO PARA EXECUÇÃO

**Modos suportados:** PLANO SELECIONADO | GUIDE INTEIRO | AMBOS (padrão)

> O planejador define solução, lógica e invariantes. O executor decide detalhes locais sem alterar essa direção. O auditor compara implementação real contra este contrato e contra os cenários da seção 2.1, que valem mesmo quando o contrato os omite.

---

## 0. Estado real do código

**Auditado em:** 2026-08-06
**Boundary inspecionado:** `packages/skills/_shared/scripts/document_quality.mjs` (951 linhas), `packages/mcp-server/server.js` (handlers `scanAcceptance` L1750, `verifySprintFile` L1989, `verifyBacklogIndex` L2226, `capabilities` L603), `packages/templates/SPRINT_TEMPLATE.md`, `packages/templates/BACKLOG_MESTRE_TEMPLATE.md`, `packages/skills/talos-backlog-generator/SKILL.md`, `build/build-plugins.sh`, `build/test-all.sh`, `build/tests/etapa3.test.mjs`.

### Base existente a preservar

| Capacidade | Responsabilidade/local | Evidência | Invariante |
|------------|------------------------|-----------|------------|
| Selo write-once do contrato §7 | `packages/skills/_shared/scripts/document_quality.mjs:validateAcceptanceSeal` (L437) | Compara `sha256` do bloco §7 normalizado contra `Selo do contrato`; `aprovado` sem selo válido ⇒ `tampered:true` | Contrato aprovado e editado sem re-aprovação continua sendo detectado |
| Hierarquia AC ⊃ EVAL | `document_quality.mjs:validateSprintFileConformance` (L619-640) | Todo `EVAL-*` citado por AC precisa existir no `eval_manifest` §9 | AC não pode referenciar prova inexistente |
| Enum fixo de `critical_review.reasons` | `document_quality.mjs:CRITICAL_REVIEW_REASONS` (L310) | 5 valores congelados; `parseCriticalReview` preserva valor cru para a conformance julgar | Review crítica nunca é inferida por prosa |
| Persistência atômica de entrevista | `document_quality.mjs:persistInterviewRound` (L930) | temp + `renameSync` + readback; divergência lança `READBACK_DIVERGENT` | Resposta de entrevista nunca fica só no chat |
| Detecção de host data-driven | `packages/mcp-server/server.js:capabilities` (L603) | Expõe `subagent_dispatch`, `question_prompt`, `dispatch_capability` por host | Skill nunca hardcoda verbo de subagente nem ferramenta de pergunta |

### Contratos de escrita do boundary

| Mutador (`path:symbol`) | Linhas do corpo | Semântica da escrita | O que acontece com o que fica de fora | Chamadores no boundary |
|-------------------------|-----------------|----------------------|---------------------------------------|------------------------|
| `packages/skills/_shared/scripts/document_quality.mjs:persistInterviewRound` | L930-951 | absoluta | O arquivo inteiro é substituído pelo markdown devolvido por `applyInterviewRound`; qualquer conteúdo ausente desse markdown é apagado | `talos-sprint-interview` (SKILL.md passo 5/7) |
| `packages/skills/_shared/scripts/document_quality.mjs:applyInterviewRound` | L904-928 | merge | Preserva o markdown recebido; altera apenas linhas `D<n>` da §7.1, `Contrato status`, `Selo do contrato` e a linha `**Histórico:**` | `persistInterviewRound` (L935) |
| `packages/skills/_shared/scripts/document_quality.mjs:applyDecisionRow` | L882-897 | upsert | Substitui a linha inteira do `D<n>` por `\| id \| value \|` (**duas colunas fixas**); demais linhas preservadas | `applyInterviewRound` (L920) |
| `packages/skills/_shared/scripts/document_quality.mjs:approveAcceptanceContract` | L874-880 | merge | Escreve `Contrato status: aprovado` e `Selo do contrato`; resto do markdown preservado | `applyInterviewRound` (L926), `talos-sprint-interview` |
| `packages/mcp-server/server.js:updateSprintStatus` | L2513-2798 | merge | Sincroniza linha do backlog + metadados do sprint file; demais seções preservadas | Orquestrador (gate `SPRINT_STATUS_SYNC`) |

`applyDecisionRow` é o mutador crítico desta trilha: ele monta a linha com **duas colunas** (`| D1 | valor |`). A §7.1 ganha uma terceira coluna (`Origem`) no Plano 01; sem alterar esta função no mesmo plano, toda entrevista que persistir uma decisão vai reescrever a linha com 2 colunas numa tabela de 3, destruindo a procedência já gravada — em silêncio, com `persistInterviewRound` retornando sucesso, porque o readback confere o que ela mesma escreveu.

### Gaps comprovados

| Gap | Evidência | Impacto |
|-----|-----------|---------|
| Nenhuma decisão declara procedência | `document_quality.mjs:parseDecisionRows` (L753-759) mapeia exatamente 5 colunas (`ID, Decisão, Bloqueia, Dono, Status`); `applyItemField` (L186-196) aceita apenas `id`, `behavior`, `scenario`, `decisions`, `evals` | Decisão inferida pelo modelo é indistinguível de decisão dada pelo usuário; nada bloqueia aceite apoiado em inferência |
| Path citado no contrato nunca é resolvido contra o disco | `validateSprintFileConformance` (L456-752) não abre nenhum path citado | Sprint pode nomear arquivo inexistente e só falhar na execução |
| Ambiguidade só é escaneada depois do artefato existir | `scanAcceptance` (L1750-1760) exige `sprint_path` e faz `fs.readFileSync` | O generator grava premissas primeiro e pergunta depois — quando pergunta |
| Entrevista do generator é texto livre | `talos-backlog-generator/SKILL.md` passo 4: "faça até 3 perguntas objetivas" | Sem `decision_id` estável, sem opções, sem recomendação, sem persistência estruturada |
| Nada audita o output do generator | `build/test-all.sh` cobre build, unit, smoke e conformance; nenhuma etapa confronta backlog/sprint contra o código | O artefato que alimenta todo o pipeline é o único que ninguém revisa |

### Fluxo atual relevante

O generator lê o pedido, opcionalmente faz até 3 perguntas em texto livre, escreve `BACKLOG_MESTRE_*.md` e os sprint files, e então chama `talos_verify_backlog_index` + `talos_verify_sprint_file` + `talos_select_next_sprint`. Os gates verificam schema, links e enums — nunca verdade sobre o código.

### Seams de contrato do boundary

| Seam | Salto (de -> para) | Natureza | Em escopo? | Golden existente/necessário |
|------|--------------------|----------|------------|-----------------------------|
| parse-aceite | markdown §7.3 -> `document_quality.mjs:parseAcceptanceContract` | determinístico | sim | N/A |
| parse-decisão-backlog | markdown backlog -> `document_quality.mjs:parseDecisionRows` | determinístico | sim | N/A |
| conformance-sprint | objeto AC/decisão -> `document_quality.mjs:validateSprintFileConformance` | determinístico | sim | N/A |
| gate-mcp-sprint | conformance -> `packages/mcp-server/server.js:verifySprintFile` | determinístico | sim | N/A |
| gate-mcp-backlog | índice -> `packages/mcp-server/server.js:verifyBacklogIndex` | determinístico | sim | N/A |
| scan-draft | markdown em memória -> `packages/mcp-server/server.js:scanAcceptance` | determinístico | sim | N/A |
| resolução-de-path | `derivado:<path>` -> `fs.existsSync` no root do consumidor | determinístico | sim | N/A |
| dispatch-revisor | skill -> subagente do host (`capabilities.subagent_dispatch`) | não-determinístico (agente) | sim, o lado do contrato: qual mandato é lido e qual boundary é passado | N/A — o veredito do agente não é golden; o que se prova é que o mandato canônico foi lido do arquivo e o boundary montado a partir do output real |
| agente -> host runtime | verbo nativo do host -> processo do subagente | não-determinístico | não: salto externo ao código do projeto | N/A |

### Baselines preexistentes

| Baseline | Evidência | Tratamento |
|----------|-----------|------------|
| `hosts/` e `plugins/` contêm cópias commitadas de `packages/templates/` | `build/build-plugins.sh` L91/104/178/220/272/311 copia `packages/templates`; `git ls-files` confirma que as cópias são versionadas | preservar o mecanismo: mudança de template exige rodar o build e commitar as cópias regeneradas |
| `applyDecisionRow` só reconhece o cabeçalho de 2 colunas (`ID` + `Decisão`) para **inserir** decisão nova | `document_quality.mjs:L890` — regex literal do cabeçalho seguido da linha separadora; sem esse casamento a função lança `DECISION_TABLE_MISSING:<id>` | corrigir neste guide (Plano 01): sob §7.1 de 3 colunas o insert de um `D<n>` inexistente passa a falhar, e a falha só aparece na entrevista |
| `closedDecisionIds` **não** quebra com 3 colunas | `document_quality.mjs:L862` — a função devolve `new Set([...].map(m => m[1]))`, isto é, descarta o grupo 2; verificado executando a função sobre §7.1 de 2 e de 3 colunas (mesmo resultado) | não tocar sem necessidade: é o oráculo de materialização de `persistInterviewRound` (L936). O que muda com a coluna nova é só o grupo capturado e descartado |
| Artefatos pré-`0.16.0` | `.talos/backlog/` vazio; nenhum consumidor conhecido com backlog ativo | fora de escopo por decisão (corte seco, D17): não há camada de compatibilidade |
| Fixtures de teste no schema pré-`0.16.0` | `packages/mcp-server/server.test.js:1259` e `:1564` têm §4 sem linha `Discussão` (a busca por `Discussão` não retorna nada em nenhum teste); `build/tests/etapa3.test.mjs:176` monta §7.1 de 2 colunas e insere `D2` pelo cabeçalho de 2 colunas; `:104` monta o backlog com 5 colunas de decisão | migrar as fixtures ao schema novo dentro dos Planos 01 e 02 (não é falha preexistente, é consequência da própria entrega). Afrouxar a validação para manter fixture legada verde é violação de D17 |

---

## 1. Decisões

### Fechadas

| ID | Decisão | Fonte | Consequência técnica |
|----|---------|-------|----------------------|
| D1 | Sem artefato de intenção no Talos | `INTENT §1 D1` | Nenhum arquivo novo no fluxo; a §4 do sprint file carrega o ponteiro de origem |
| D2 | Linha `Discussão` da §4 obrigatória — **sempre**, sem detectar origem | `INTENT §1 D2` + entrevista 2026-08-06 | `validateSprintFileConformance` exige a linha preenchida e não-placeholder em todo sprint file |
| D3 | `Origem` com enum `usuario` \| `derivado:<path>` \| `premissa` | `INTENT §1 D3` | Coluna nova na §7.1 e nas decisões do backlog; campo `origin:` no YAML §7.3 |
| D4 | `premissa` não sustenta aceite de sprint `Must`/`P0` | `INTENT §1 D4` | Bloqueio derivado de `MoSCoW`/`Prioridade` da §1 do próprio sprint file |
| D5 | `derivado:<path>` resolvido contra disco; `(novo)` para arquivo a criar | `INTENT §1 D5` | `validateSprintFileConformance` passa a receber o root do consumidor |
| D6 | Gates devolvem contagem de `premissa` | `INTENT §1 D6` | `premissa_count` no payload de `verifySprintFile` e `verifyBacklogIndex` |
| D7 | Entrevista estruturada no generator via `question_prompt` | `INTENT §1 D7` | Substitui "até 3 perguntas objetivas"; persiste com `Origem: usuario` |
| D8 | Scan de aceite roda no rascunho, antes de salvar | `INTENT §1 D8` | `scanAcceptance` aceita conteúdo em memória além de `sprint_path` |
| D9 | Revisão interna à skill, subagente genérico do host, mandato versionado | `INTENT §1 D9` | Sem agente declarado, sem fase de orquestrador, sem tool MCP |
| D10 | Boundary = todo o output da execução; revisão é o último passo | `INTENT §1 D10` | Entrevista → escrita → revisão → entrega |
| D14 | Relatório estruturado destinado ao chamador | `INTENT §1 D14` | Findings por severidade + veredito; nada consumido por gate |
| D15 | Revisor nunca muta código do produto | `INTENT §1 D15` | Boundary de escrita do mandato exclui código |
| D16 | Release único | `INTENT §1 D16` | Cinco planos, uma versão |
| D17 | Corte seco, sem retrocompat | `INTENT §1 D17` | Nenhum branch de legado; ausência de `Origem` é falha |
| D18 | Versão `0.16.0` | `INTENT §1 D18` | `VERSION` + `.claude-plugin/plugin.json` + CHANGELOG + migração |
| D19 | Revisor audita **e** corrige | `INTENT §1 D19` | Mandato com boundary de escrita nos artefatos revisados |
| D20 | Relatório não vira arquivo | `INTENT §1 D20` | Nenhum diretório novo sob `.talos/` |
| D21 | Entrevista de sprint na execução não re-dispara revisão | `INTENT §1 D21` | É o ponto de atualização da §7 contra drift de estado, por design |
| D22 | Todos os hosts suportados têm subagente genérico capaz de mutar arquivos | entrevista 2026-08-06 | Nenhum branch por `dispatch_capability`; falha de dispatch bloqueia a entrega, não degrada. `dispatch_capability: 'unknown'` (`server.js:418`) significa "não verificado em produção com mutação real", não "incapaz"; o gate DISPATCH/DEC-008 protege mutação de **código** no pipeline de execução e não alcança esta fase documental, cujo boundary de escrita é markdown de backlog/sprint (D15) |

### Pendentes

| ID | Decisão | Recomendação | Default de execução | Planos afetados |
|----|---------|-------------|---------------------|-----------------|
| P1 | Budget de passagens internas de reparo do revisor | 2, espelhando o revisor frio do `create-guide` e o `repair_budget: 1` do caminho pós-validator | 2 passagens; findings restantes vão no relatório ao chamador | Plano 04 |

O executor usa o default quando o usuário não tiver fechado outra escolha e registra a decisão no `Impl`.

---

## 2. Solução alvo

### 2.1 Cenários de aceite do usuário

| ID | Cenário observável | Efeito final e sink (`path:symbol`) | Planos que contribuem | Fecha em | Como traçar no código | Prova executável |
|----|--------------------|--------------------------------------|-----------------------|----------|-----------------------|------------------|
| CN1 | Usuário pede um backlog a partir de um brainstorm; **antes de qualquer arquivo existir**, recebe perguntas de múltipla escolha com recomendação, e vê cada resposta virar decisão marcada `Origem: usuario` | Rascunho escaneado em memória por `packages/mcp-server/server.js:scanAcceptance` devolve `blocking_count > 0` e força a rodada | 02, 03 | Plano 03 | `talos-backlog-generator/SKILL.md` passo 4 → `scanAcceptance` com `sprint_markdown` → rodada via `capabilities.question_prompt` → decisão gravada com `Origem: usuario` | `packages/mcp-server/server.test.js::scan_acceptance_draft_em_memoria` (scan antes do arquivo) + `build/tests/etapa3.test.mjs::skill_backlog_sem_texto_livre` (rodada estruturada substitui o texto livre) + `build/tests/etapa3.test.mjs::persist_preserva_origem` (a resposta chega ao artefato como `usuario`) |
| CN2 | Usuário tenta avançar uma sprint `Must`/`P0` cujo critério de aceite se apoia em suposição do modelo; o gate recusa nomeando o `AC-*` e a linha `premissa` | Pendência emitida por `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` | 01 | Plano 01 | §1 `MoSCoW`/`Prioridade` + `origin` do AC → `validateSprintFileConformance` → `verifySprintFile` `status:blocked` | `build/tests/etapa3.test.mjs::premissa_bloqueia_must_p0` |
| CN3 | Usuário (ou o modelo) cita um arquivo que não existe como origem de uma decisão; a sprint é recusada antes de chegar ao executor | Pendência de path emitida por `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` | 01 | Plano 01 | `derivado:<path>` → resolução contra o root do consumidor → pendência `origem_path_inexistente` | `build/tests/etapa3.test.mjs::derivado_path_inexistente_bloqueia` |
| CN4 | Ao fim da geração, o usuário recebe o backlog e os sprint files **já corrigidos** por um agente que não viu a conversa, junto do relato do que foi alterado e por quê | Mandato lido de `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md:Mandato` e despachado pelo verbo de `capabilities.subagent_dispatch` | 04 | Plano 04 | `SKILL.md` passo final → lê o mandato do arquivo → monta boundary com os paths escritos na execução → despacha → relatório ao chamador | `smoke manual: o veredito do agente não é determinístico; o que é automatizável (mandato existe, é lido do arquivo, boundary cobre todo o output) está em `build/tests/etapa3.test.mjs::mandato_revisao_canonico`` |
| CN5 | Usuário com sprint file no formato anterior a `0.16.0` recebe recusa explícita com instrução de reinício, em vez de passar despercebido | Pendência de schema emitida por `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` | 01, 05 | Plano 01 | §7.1 sem coluna `Origem` → pendência `procedencia_ausente` com `next_action` de reinício | `build/tests/etapa3.test.mjs::schema_pre_016_rejeitado` |
| CN6 | Usuário recebe uma sprint recusada quando ela não diz de qual discussão nasceu — a fonte que o revisor frio vai usar como oráculo de intenção deixa de ser opcional | Pendência `fonte_discussao_ausente` emitida por `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` | 02 | Plano 02 | §4 linha `Discussão` vazia/placeholder → pendência → `verifySprintFile` `status:blocked` | `build/tests/etapa3.test.mjs::discussao_placeholder_bloqueia`, `::discussao_obrigatoria_standalone` |

### 2.2 Responsabilidades e localização da lógica

| Responsabilidade | Local/owner | Como integra |
|------------------|-------------|--------------|
| Schema documental do contrato | `packages/templates/SPRINT_TEMPLATE.md`, `packages/templates/BACKLOG_MESTRE_TEMPLATE.md` | Fonte única; cópias por host são geradas por `build/build-plugins.sh` |
| Parse e validação de procedência | `packages/skills/_shared/scripts/document_quality.mjs` | Consumido pelo MCP e pelos testes |
| Exposição dos gates | `packages/mcp-server/server.js:verifySprintFile`, `:verifyBacklogIndex`, `:scanAcceptance` | Payload consumido pelo orquestrador e pela skill |
| Condução da entrevista e da revisão | `packages/skills/talos-backlog-generator/SKILL.md` | Usa `capabilities.question_prompt` e `capabilities.subagent_dispatch` |
| Mandato da revisão fria | `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` | Lido do arquivo a cada execução, nunca reescrito de memória |

### 2.3 Estrutura relevante

```txt
packages/
  templates/{SPRINT_TEMPLATE.md,BACKLOG_MESTRE_TEMPLATE.md}
  skills/
    _shared/scripts/document_quality.mjs
    talos-backlog-generator/{SKILL.md,references/COLD_BACKLOG_REVIEW_PROMPT.md}
  mcp-server/{server.js,server.test.js}
build/{build-plugins.sh,check-consistency.mjs,tests/etapa3.test.mjs}
```

### 2.4 Fluxo planejado

Uma execução de `talos-backlog-generator` passa a ter quatro etapas em ordem fixa:

1. **Entender e escanear o rascunho.** A skill monta o backlog e os sprint files em memória e chama `scanAcceptance` com o markdown do rascunho **de cada sprint** (não com um path). O scan devolve os padrões bloqueantes sobre texto que ainda não existe em disco. O rascunho de **backlog mestre** não passa pelo scan: `packages/mcp-server/server.js:scanSectionPatterns` (L1683) só lê `sections.section_7_aceite`, isto é, a estrutura §7 de sprint file — rodar o scan sobre o índice macro devolveria zero por ausência de seção, não por ausência de ambiguidade. A ambiguidade do backlog é fechada pela mesma rodada de entrevista, alimentada pelo scan das sprints (cobertura parcial de D8, declarada aqui em vez de simulada).
2. **Entrevistar.** Enquanto houver padrão bloqueante, a skill roda rodadas estruturadas pelo mecanismo de `capabilities.question_prompt` (máximo de perguntas e opções vêm do descritor do host, não de constante da skill). Cada resposta vira decisão com `Origem: usuario` e `decision_id` estável, **aplicada ao rascunho imediatamente ao fim da rodada** — nunca acumulada até o fim de todas as rodadas. Enquanto a sprint ainda não existe em disco, aplicar significa editar o rascunho em memória e gravá-lo assim que as rodadas fecharem; quando a rodada é sobre sprint file **já existente** (caminho de atualização), a escrita é `persistInterviewRound`, que exige arquivo em disco (`document_quality.mjs:934` lê o arquivo antes de aplicar). O pack não pede persistência incremental em arquivo inexistente: seria contradição com a própria razão de o scan aceitar markdown.
3. **Escrever e gatear.** Os artefatos são gravados e verificados por `talos_verify_backlog_index`, `talos_verify_sprint_file` e `talos_select_next_sprint`. Os dois primeiros agora recusam procedência inválida, `premissa` sustentando `Must`/`P0`, `derivado:<path>` inexistente e schema pré-`0.16.0`, e devolvem `premissa_count`.
4. **Revisar a frio e entregar.** A skill lê o mandato de `references/COLD_BACKLOG_REVIEW_PROMPT.md`, monta o boundary com **todos** os paths escritos naquela execução, despacha um subagente pelo verbo de `capabilities.subagent_dispatch` e aguarda. O revisor audita contra a §4 `Discussão`, o código e as regras locais, corrige o que comprovou nos artefatos e devolve o relatório. Como o revisor escreve **depois** dos gates da etapa 3, a skill reexecuta `talos_verify_sprint_file`/`talos_verify_backlog_index` sobre os paths que ele alterou antes de entregar — artefato corrigido e não regateado é artefato não verificado, e é justamente onde uma correção do revisor poderia quebrar procedência, selo ou link de backlog. Só então a skill repassa o relatório ao chamador e entrega.

### 2.5 Contratos técnicos materiais

| Superfície | Entrada | Saída/estado | Regra |
|------------|---------|--------------|-------|
| §7.1 do sprint file | tabela `\| ID \| Decisão \| Origem \|` | decisões com procedência | `applyDecisionRow` monta as 3 colunas; `closedDecisionIds` casa a linha independentemente da contagem de colunas |
| §7.3 do sprint file | item YAML com `origin:` | AC com procedência | `applyItemField` reconhece `origin`; ausência é pendência |
| Decisões do backlog | tabela `\| ID \| Decisão \| Bloqueia \| Dono \| Origem \| Status \|` | decisões com procedência | `parseDecisionRows` mapeia a coluna nova; `validateBacklogUpdate` valida o enum |
| `talos_scan_acceptance` | `sprint_path` **ou** `sprint_markdown` | mesmo payload de hoje | Exatamente um dos dois; os dois juntos, ou nenhum, é erro de uso |
| `talos_verify_sprint_file` | idem hoje | payload + `premissa_count` | Contagem sempre presente, inclusive zero |

### 2.6 Fluxo de valor crítico até o sink

| ID | Valor crítico | Origem (`path:symbol`) | Sink de produção (`path:symbol`) | Fecha em | Leitor concorrente/legado a matar ou provar inerte | Prova de que o sink recebe o valor certo |
|----|---------------|------------------------|----------------------------------|----------|---------------------------------------------------|------------------------------------------|
| VC1 | Procedência de cada decisão e AC (enum `usuario` / `derivado:<path>` / `premissa`) | `packages/skills/_shared/scripts/document_quality.mjs:applyDecisionRow` | `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` | Plano 01 | `packages/skills/_shared/scripts/document_quality.mjs:applyDecisionRow` — hoje escreve 2 colunas fixas e apagaria a procedência ao persistir entrevista | Teste que persiste uma rodada de entrevista sobre §7.1 com 3 colunas e relê o arquivo: a coluna `Origem` da linha reescrita continua `usuario`, e falha se a linha voltar a ter 2 colunas |
| VC2 | Mandato canônico da revisão fria | `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md:Mandato` | `packages/skills/talos-backlog-generator/SKILL.md:passo_revisao_fria` | Plano 04 | nenhum | Teste que lê o arquivo do mandato e confirma as cláusulas obrigatórias (boundary de escrita, código read-only, ordem discussão-código-artefatos, enum de veredito); falha se o arquivo sumir ou perder cláusula |
| VC3 | Verbo de dispatch do subagente | `packages/mcp-server/server.js:capabilities` | `packages/skills/talos-backlog-generator/SKILL.md:passo_revisao_fria` | Plano 04 | nenhum | Busca que comprova ausência de nome de ferramenta de host hardcodado na skill e no mandato, com a instrução apontando o descritor `subagent_dispatch` |

### 2.7 Livro-razão de coexistência de legado

| ID | Símbolo legado (`path:symbol`) | Caminho onde vive | Substituto novo | Morre em | Prova de morte ou de inércia |
|----|--------------------------------|-------------------|-----------------|----------|------------------------------|
| LEG1 | `packages/skills/talos-backlog-generator/SKILL.md:passo 4` ("faça até 3 perguntas objetivas") — **e o segundo sítio na seção "Entradas aceitas"**: "Pergunte antes de salvar somente quando faltar uma das decisões bloqueantes..." | Fechamento de ambiguidade durante a geração do backlog | Entrevista estruturada via `capabilities.question_prompt`, disparada pelo scan | Plano 03 | `grep -nE "até 3 perguntas objetivas\|Pergunte antes de salvar somente quando faltar" packages/skills/talos-backlog-generator/SKILL.md` sem resultado, e o passo reescrito citando `question_prompt` |
| LEG2 | `packages/skills/_shared/scripts/document_quality.mjs:applyDecisionRow` (L890 — regex literal do cabeçalho de 2 colunas, `ID` + `Decisão` e mais nada) | Único caminho de **inserção** de decisão nova na §7.1; sem casar o cabeçalho a função lança `DECISION_TABLE_MISSING:<id>` e `persistInterviewRound` embrulha em `INTERVIEW_PERSISTENCE_FAILED` | Mesmo reconhecimento sobre o cabeçalho de 3 colunas (`ID`, `Decisão`, `Origem`) | Plano 01 | Teste que persiste em §7.1 de 3 colunas uma decisão `D<n>` que **ainda não existe na tabela** e relê o arquivo: a linha aparece com as 3 células. Falha se o cabeçalho literal antigo for mantido (`DECISION_TABLE_MISSING`) |

### 2.8 Invariantes da trilha

| ID | Invariante | Onde é observável (`path:symbol`) | Como comprovar | AC que prova | Fecha em |
|----|------------|-----------------------------------|----------------|--------------|----------|
| INV1 | Persistir uma rodada de entrevista nunca destrói a procedência já gravada | `document_quality.mjs:applyDecisionRow` | Teste ancorado: persistir `D1` sobre §7.1 de 3 colunas e reler | `AC-01.3.1` | Plano 01 |
| INV2 | Selo do contrato §7 continua íntegro sob o schema novo | `document_quality.mjs:validateAcceptanceSeal` | Aprovar contrato com `origin` na §7.3 e validar selo; editar a §7 e confirmar `tampered:true` | `AC-01.4.1` | Plano 01 |
| INV3 | Nenhuma tool MCP nova e nenhuma fase nova de orquestrador entram neste release | `packages/mcp-server/server.js` (registro de tools: 16 entradas, de `talos_ping` L6008 a `talos_assert_after_plan` L6278) e `packages/orchestrator/skills/talos/SKILL.md` | Contagem de tools registradas idêntica antes/depois; ausência de gate novo no orquestrador | `AC-04.3.1` | Plano 04 |
| INV4 | A skill nunca hardcoda ferramenta de host | `packages/skills/talos-backlog-generator/SKILL.md` | Busca por nomes de ferramenta; instrução aponta `question_prompt` e `subagent_dispatch` | `AC-04.3.2` | Plano 04 |
| INV5 | Cópias por host permanecem sincronizadas com `packages/templates/` | `build/build-plugins.sh` | Rodar o build e confirmar que `git status` não deixa cópia divergente | `AC-05.2.1` | Plano 05 |

### 2.9 Seams e estratégia de prova

| Seam | Entrada real | Saída observável | Nível de prova | Golden (id + proveniência) | Teste |
|------|--------------|------------------|----------------|----------------------------|-------|
| parse-aceite | YAML §7.3 com `origin:` | item com campo `origin` | ancorada | N/A | `build/tests/etapa3.test.mjs::parse_origin_ac` |
| conformance-sprint | markdown de sprint file | lista de pendências devolvida por `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` | ancorada | N/A | `build/tests/etapa3.test.mjs::premissa_bloqueia_must_p0`, `::derivado_path_inexistente_bloqueia`, `::schema_pre_016_rejeitado`, `::discussao_placeholder_bloqueia`, `::discussao_obrigatoria_standalone` |
| parse-decisão-backlog | markdown de backlog | linhas com `origin` | ancorada | N/A | `build/tests/etapa3.test.mjs::parse_origem_backlog` |
| resolução-de-path | `derivado:<path>` + root real | existe / não existe | ancorada (tmpdir real, sem mock de `fs`) | N/A | `build/tests/etapa3.test.mjs::derivado_path_inexistente_bloqueia` |
| gate-mcp-sprint | args do MCP | payload com `premissa_count` e `status` | ancorada | N/A | `packages/mcp-server/server.test.js::verify_sprint_file_premissa_count` |
| gate-mcp-backlog | backlog real em tmpdir + sprint files apontados | pendências agregadas por `inspectBacklogIndex` e `premissa_count` | ancorada com `fs` real | N/A | `packages/mcp-server/server.test.js::verify_backlog_index_resolve_derivado` |
| scan-draft | markdown em memória | `blocking_count` | ancorada | N/A | `packages/mcp-server/server.test.js::scan_acceptance_draft_em_memoria` |
| persistência-entrevista | sprint file em tmpdir + respostas (linha existente e linha nova) | arquivo relido com 3 colunas nos dois casos | ancorada | N/A | `build/tests/etapa3.test.mjs::persist_preserva_origem`, `::persist_insere_decisao_nova_tres_colunas` |
| dispatch-revisor | mandato + boundary | prompt montado e despachado por `packages/skills/talos-backlog-generator/SKILL.md:passo_revisao_fria` | ancorada no lado do contrato (arquivo do mandato e boundary montado); o veredito do agente é smoke | N/A | `build/tests/etapa3.test.mjs::mandato_revisao_canonico` |

Cobertura: os sinks de VC1, VC2 e VC3 aparecem como saída observável de `conformance-sprint`, `dispatch-revisor` e `dispatch-revisor`, respectivamente.

### 2.10 Alertas de regressão

- Ao adicionar a coluna `Origem` na §7.1, alterar `applyDecisionRow` **no mesmo plano**, porque a função monta a linha com duas colunas fixas e apagaria a procedência na primeira entrevista persistida.
- Ao adicionar `origin` ao parser de AC, preservar o comportamento de `evidence`/`manual`: `applyItemField` é chamado tanto no nível do item quanto após o submapa, e um campo novo mal posicionado captura chave de `evidence`.
- Ao mexer em `packages/templates/`, rodar `build/build-plugins.sh` antes de commitar: `hosts/` e `plugins/` carregam cópias versionadas e ficam divergentes em silêncio.
- Ao estender `scanAcceptance`, manter `sprint_path` funcionando: o orquestrador chama o gate com path em `full`/`direct` (passo 2 do Full mode).
- Ao dar `root` a `validateSprintFileConformance`, alimentar **os dois** chamadores: `verifySprintFile` (L2021) e `inspectBacklogIndex` (L2197). Só o primeiro está no caminho de `talos_verify_sprint_file`; o segundo é o que `talos_verify_backlog_index` usa, e sem `root` a resolução de `derivado:<path>` fica silenciosamente inerte lá.
- Ao tornar `Origem`/`origin`/`Discussão` obrigatórios, migrar as fixtures existentes no mesmo plano (ver Baselines). Nenhuma fixture de teste tem linha `Discussão` hoje; deixar a suíte vermelha convida o executor a afrouxar a validação, que é a única forma de perder D17 sem ninguém notar.

---

## 3. Validação comum

```bash
node --test packages/mcp-server/server.test.js
node --test build/tests/etapa3.test.mjs
node build/check-consistency.mjs
git diff --check
```

Gate agregado no último plano:

```bash
bash build/test-all.sh
```

Regras de evidência:

- Teste citado precisa ser coletado pelo runner real (`node --test` sobre o path exato).
- Asserção deve provar comportamento do aceite, não apenas execução sem erro.
- Asserção sobre procedência precisa ser discriminante: falharia se a linha voltasse a duas colunas ou se `premissa` passasse em sprint `Must`.
- Smoke manual é escape, não default: aqui cobre apenas o veredito do subagente, que não é determinístico.
- Falha preexistente fica separada de regressão nova.

### Disciplina de prova de comportamento

Aceite com surface de runtime passa por duas perguntas independentes, nesta ordem:

**1. O seam está certo?** Para procedência, o seam é `validateSprintFileConformance`, não o template: markdown bem formatado não prova que o gate recusa. Para o dispatch, o seam do contrato é a leitura do mandato e a montagem do boundary; o veredito do agente fica além da fronteira.

**2. A topologia está certa?** Prova ancorada em todos os seams determinísticos, com `fs` real em `os.tmpdir()` — o padrão que `build/tests/etapa3.test.mjs` já usa. Nenhum mock de `fs` e nenhum stub de `document_quality`.

**Proxies proibidos:** mockar `validateSprintFileConformance` e afirmar que o gate bloqueia; validar só o markdown do template; testar `premissa` sem `MoSCoW: Must` no fixture (não discrimina); afirmar que o mandato existe sem ler suas cláusulas.

---

## 4. Ordem de execução

```txt
plans/01-procedencia.md -> plans/02-fonte-e-scan.md -> plans/03-entrevista.md -> plans/04-revisao-fria.md -> plans/05-release.md -> plans/F-fechamento.md
```

| ID | Arquivo | Natureza | Ativação | Entrega | Dependência | Fecha | Fronteira | Status |
|----|---------|----------|----------|---------|-------------|-------|-----------|--------|
| 01 | `plans/01-procedencia.md` | OBRIGATÓRIO | sempre | `Origem` no schema, no parser e nos gates, com bloqueio de `premissa` em Must/P0 e resolução de path | nenhuma | CN2, CN3, CN5, VC1, LEG2, INV1, INV2 | nenhuma | PENDENTE |
| 02 | `plans/02-fonte-e-scan.md` | OBRIGATÓRIO | sempre | §4 `Discussão` obrigatória e scan de aceite sobre rascunho em memória | 01 | CN6 | VC1 | PENDENTE |
| 03 | `plans/03-entrevista.md` | OBRIGATÓRIO | sempre | Entrevista estruturada no generator, persistindo `Origem: usuario` | 01, 02 | CN1, LEG1 | VC1 | PENDENTE |
| 04 | `plans/04-revisao-fria.md` | OBRIGATÓRIO | sempre | Mandato canônico + dispatch do revisor como último passo da skill | 03 | CN4, VC2, VC3, INV3, INV4 | CN1 | PENDENTE |
| 05 | `plans/05-release.md` | OBRIGATÓRIO | sempre | Corte seco `0.16.0`: versão, cópias por host, CHANGELOG, migração e docs | 04 | INV5 | CN4, VC1 | PENDENTE |
| F | `plans/F-fechamento.md` | FECHAMENTO | sempre | trilha verificada e fechada | todos os anteriores | — | todas `PROVADO` em `LEDGER.md` | PENDENTE |

O estado vivo das obrigações transversais vive em `LEDGER.md`. O contrato + Impl + auditoria de cada incremento vive em `plans/*.md`.

---

## 6. Revisão do autor

- [x] Toda obrigação de 2.1, 2.6, 2.7 e 2.8 tem linha em `LEDGER.md` com `Fecha em` apontando plano concreto; nenhuma órfã.
- [x] Para cada obrigação, o plano nomeado em `Fecha em` a lista em `Fecha neste plano`, e vice-versa; a coluna `Fecha` do índice §4 espelha esses IDs.
- [x] A `Fronteira de entrada` de cada plano é fechada por algum plano anterior; nenhuma exige o que ninguém entrega.
- [x] A união dos `Fecha neste plano` cobre `LEDGER.md` inteiro ao fim do Plano 05.
- [x] `plans/F-fechamento.md` existe e é o último.
- [x] Os cenários de 2.1 derivam do objetivo mensurável e do INTENT, e são observáveis pelo usuário.
- [x] Todo valor crítico tem sink real nomeado em 2.6, com leitor legado identificado e prova discriminante planejada.
- [x] Toda coexistência de legado autorizada tem linha em 2.7 com prazo e prova.
- [x] Nenhum seam interno determinístico foi marcado fora de escopo por proximidade com fronteira externa — o salto agente→host é o único externo.
- [x] Cada aceite com surface de runtime aponta seam correto, nível de prova e golden.
- [x] Cada aceite material declara `falseia se` com mutação concreta de código.
- [x] Cada `falseia se` viola a decisão ou invariante que aquele AC protege.
- [x] Todo mutador de estado do caminho tem linha em §0 com linhas do corpo lidas e semântica declarada.
- [x] Nenhum pseudocódigo de task contradiz a direção do plano, as decisões ou as invariantes.
- [x] Cada invariante de 2.8 nomeia o AC que a prova.
- [x] Cada comportamento operacional declarado em task tem AC ou `sem AC: motivo`.
- [x] Cada cenário de 2.1 declara prova executável, e quatro dos cinco são automatizados.
- [x] Responsabilidade e local de cada lógica material estão claros.
- [x] A lógica ponta a ponta aparece uma vez, em 2.4.
- [x] Executor possui liberdade local sem poder reinterpretar arquitetura.
- [x] Invariantes citam ponto de código observável.
- [x] Guardrails negativos são poucos, específicos e justificados.
- [x] Direção respeita `CLAUDE.md`; o BREAKING é consciente, versionado e com migração documentada (invariante 1 do projeto).
- [x] Decisões abertas possuem recomendação e default executável (P1).

---

## 6.5 Pre-mortem do autor

**Se eu executasse este pack plano a plano até o fim, qual obrigação chegaria ao `Plano F` sem dono?** Percorrido o `LEDGER.md` inteiro: o encaixe mais frágil é **VC1**, cujo `Fecha em` é o Plano 01, mas cujo leitor legado (`applyDecisionRow`) só é exercitado de verdade pela entrevista, implementada no Plano 03. O risco é o Plano 01 fechar VC1 com o teste de conformance verde e a destruição de procedência só aparecer quando o Plano 03 rodar uma entrevista real. Mitigado por `AC-01.3.1`, que exige o teste de persistência **dentro do Plano 01**, não do 03.

**Se eu executasse este pack como está, o que daria errado?**

- **P0 plausível 1:** o executor adiciona a coluna `Origem` à §7.1 do template e ao validador, mas não toca `applyDecisionRow`; a primeira entrevista persistida reescreve a linha com duas colunas e apaga a procedência, com `persistInterviewRound` retornando sucesso porque o readback confere o que ela mesma escreveu. **Mitigação:** `plans/01-procedencia.md:AC-01.3.1` (task 01.3) exige teste que persiste rodada sobre §7.1 de 3 colunas e relê o arquivo. **Falsificador:** reverter `applyDecisionRow` para `\| ${decisionId} \| ${value} \|` — o teste tem que ficar vermelho.
- **P0 plausível 2:** o bloqueio de `premissa` é implementado lendo o MoSCoW da linha do **backlog** em vez do `MoSCoW`/`Prioridade` da §1 do sprint file; sprint standalone (sem backlog) passa a nunca bloquear, e o caminho com menos rede fica descoberto. **Mitigação:** `plans/01-procedencia.md:AC-01.2.2` exige fixture standalone (`Backlog mestre: Não aplicável (standalone)`) com `MoSCoW: Must` e `origin: premissa`. **Falsificador:** trocar a leitura para a linha do backlog — o teste standalone fica vermelho.
- **P0 plausível 3:** a revisão fria é descrita em prosa dentro do `SKILL.md` em vez de lida do arquivo de mandato; cada execução improvisa o rigor, e o boundary passa a ser "a sprint selecionada" em vez de todo o output, contrariando D10. **Mitigação:** `plans/04-revisao-fria.md:AC-04.1.2` exige que o passo instrua a **ler** `references/COLD_BACKLOG_REVIEW_PROMPT.md` e proíba reescrita de memória, e `AC-04.2.1` exige que o boundary enumere todos os paths escritos. **Falsificador:** remover o arquivo de mandato — `build/tests/etapa3.test.mjs::mandato_revisao_canonico` fica vermelho.
- **P0 plausível 4:** `scanAcceptance` passa a aceitar markdown em memória e alguém remove o caminho de `sprint_path`; o orquestrador, que chama o gate com path no passo 2 do Full mode, quebra em produção sem nenhum teste acusar. **Mitigação:** `plans/02-fonte-e-scan.md:AC-02.2.2` mantém teste do caminho por path junto do novo. **Falsificador:** remover o branch de `sprint_path` — o teste antigo fica vermelho.

---

## 7. Histórico

| Data | Plano/guide | Evento | Fonte/evidência |
|------|-------------|--------|-----------------|
| 2026-08-06 | Pack | Criado a partir de `INTENT.md` (Q-CBR-01 a Q-CBR-08) e da auditoria do código `0.15.2` | `.app-work/brainstorming/revisao-fria-backlog/`, `packages/skills/_shared/scripts/document_quality.mjs`, `packages/mcp-server/server.js` |
| 2026-08-06 | Pack | Entrevista de autoria: §4 `Discussão` sempre obrigatória (D2); sem branch por `dispatch_capability` (D22) | entrevista 2026-08-06 |
| 2026-08-06 | Pack | **Revisão fria** (INTENT + código antes do GUIDE). Levantados 2 P0, 9 P1 e 5 P2 contra INTENT + código. Corrigidos: contradição entre CN1 ("antes de qualquer arquivo existir") e a persistência incremental exigida por AC-03.1.3, com `persistInterviewRound` lendo o arquivo antes de aplicar (2.4 passo 2, task 03.1); fixtures legadas sem `Discussão`/`origin` sem plano de migração (§0 Baselines, 2.10, tasks 01.2/01.3/02.1); LEG2 reancorada no cabeçalho de 2 colunas de `applyDecisionRow` — `closedDecisionIds` foi executada sobre §7.1 de 2 e 3 colunas e devolve o mesmo conjunto, logo AC-01.3.2 antigo não discriminava e o caminho de **insert** ficava sem AC; `root` ausente em `inspectBacklogIndex` (AC-01.4.3); D19/D14/D20 sem AC (AC-04.1.3, AC-04.2.4); artefato corrigido pelo revisor entregue sem regate (AC-04.2.5); D2 sem obrigação no ledger (CN6); LEG1 vivo num segundo sítio do `SKILL.md`; D8 coberta só do lado da sprint, agora declarado; `max_questions: 3` é Codex App, não Cursor; contagem de cópias de template; linhas do registro de tools; prova de CN1. Recusados: exit code de `grep -rL` (correto), guards de `check-consistency.mjs` (não quebram), coleta dos testes por `test-all.sh` (ok), §0 "Contratos de escrita" (confere com o corpo real). **Entrevistas acionadas e fechadas em 2026-08-06:** (1) dispatch do revisor em host com `dispatch_capability: unknown` → **despachar sempre, sem checar**: `unknown` quer dizer "não verificado em produção com mutação real" (`server.js:418`), não "incapaz", e o gate DISPATCH/DEC-008 protege mutação de código no pipeline de execução, não uma fase documental cujo boundary é markdown (D15); (2) identidade do subagente genérico → **sem campo novo no adapter e sem skill nova**: mandato em `references/` despachado ao subagente genérico/default do host, exatamente como o `create-guide` faz, com o verbo vindo de `subagent_dispatch` (schema v5 e INV3 intactos). Consequência: os dois findings de entrevista viram **RECUSADOS** — o P0 de D22 (a decisão não é contradita pelo código) e o P1 de descritor (não há contrato a mudar). D22 restaurada sem marca; `AC-04.3.2` reescrito para proibir **nome de ferramenta** e não a descrição em prosa do subagente genérico. Saldo final: 1 P0, 8 P1 e 5 P2 corrigidos; 2 findings recusados por decisão do usuário; 4 recusados por refutação técnica. Validador: `validate_guide.py --require-intent` e `validate_plan.py` em 6 planos, exit 0 | `packages/mcp-server/server.js`, `packages/skills/_shared/scripts/document_quality.mjs`, `packages/skills/talos-backlog-generator/SKILL.md`, `packages/mcp-server/server.test.js`, `build/tests/etapa3.test.mjs`, `build/build-plugins.sh` |

| 2026-08-06 | Plano 04 | **Adição pós-revisão (autor).** O mandato ganha cláusula que delimita o escopo do julgamento: o revisor de backlog julga contrato de produto contra código real e **não** aplica ao artefato documental as políticas de mutação de código (gate DISPATCH/DEC-008, `dispatch_capability`, locks, topologia sibling); exigir campo novo em `talos_capabilities` ou gate MCP para o próprio dispatch é finding inválido por construção. Motivo: a revisão fria deste pack cometeu exatamente esse erro e produziu dois bloqueios sobre uma não-questão — sem a cláusula, o revisor que este release instala no `talos-backlog-generator` reproduz o defeito em produção. Coberta por `AC-04.1.4`. Validadores reexecutados após a edição | `plans/04-revisao-fria.md` task 04.1; sessão de revisão 2026-08-06 |
| 2026-08-06 | Pack | **Avisos aceitos com motivo registrado.** 7 avisos `INT06W` (D1, D6, D15, D16, D18, D20, D21): a coluna `Cobertura no GUIDE` do INTENT cita o plano e o AC concreto que fecham a decisão, em vez de `CN`/`fora`/`P#`. Mantidos: essas decisões não têm cenário de usuário próprio — são contrato interno (D1, D16), payload de gate (D6), boundary do mandato (D15), versionamento (D18), formato do relatório (D20) e regra de não-disparo (D21). Cobertura por AC nomeado é mais forte que marca de cenário, e trocar por `fora` seria falso: elas estão dentro do escopo. Nenhum aviso indica lacuna real de cobertura | `validate_guide.py --require-intent`; `INTENT.md` §1 |

---

## 8. Referências

- Template: `references/GUIDE_TEMPLATE.md` da skill `create-guide`.
- Regras: `CLAUDE.md`, `AGENTS.md`, `PATCH_PROCEDURE.md`, `NAMING.md`.
- Arquitetura/contratos: `packages/mcp-server/server.js`, `packages/skills/_shared/scripts/document_quality.mjs`, `packages/templates/`.
- Testes/smoke: `build/test-all.sh`, `packages/mcp-server/server.test.js`, `build/tests/etapa3.test.mjs`.
