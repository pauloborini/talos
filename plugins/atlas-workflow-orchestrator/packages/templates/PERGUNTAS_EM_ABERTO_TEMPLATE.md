# Perguntas em aberto — {{NOME_DO_PROJETO}}

> **Função deste arquivo:** inventário do que ainda precisa de decisão sua (produto, operação, sequência), com foco no horizonte imediato do backlog.  
> **O que NÃO vai aqui:** opções A/B/C, recomendações, raciocínio longo — isso nasce **na entrevista**, com backlog, código e docs relidos na hora (`*-open-questions-interview` ou pedido explícito de rodada).

---

## Como usar (dois modos)

| Modo | Quem | O que faz | Saída |
|------|------|-----------|--------|
| **Varredura** | Agente (ou você) | Cruza backlog mestre, recorte das próximas sprints, PRDs e planos quando existirem, código e contratos; abre/atualiza/fecha **entradas** no índice | Este arquivo (enxuto) |
| **Entrevista** | Você + agente | Escolhe **1–4 IDs** `aberta`; agente relê âncoras + repositório; pergunta com **AskQuestion** | Decisão no chat → linha no **Histórico** → PRD/backlog/DEC |

**Regra anti-desatualização:** antes de cada rodada de entrevista, o agente **revalida** as âncoras e o código dos IDs escolhidos. Se a evidência mudou, atualiza a lacuna no registro **antes** de perguntar.

**Formato de resposta na entrevista:** `Q-XXX → A` ou `Q-XXX → Outro: …`

**Legenda de severidade:** `❌` bloqueia handoff/implementação honesta · `⚠️` permite avançar com risco documentado  

**Status:** `aberta` · `em entrevista` · `resolvida` · `adiada` · `obsoleta` (código/docs já fecharam o tema)

**Janela de análise:** sprint atual + próximos sprints do backlog, com máximo de 5 sprints no total.

---

## Meta

| Campo | Valor |
|-------|-------|
| **Última varredura** | YYYY-MM-DD |
| **Escopo da varredura** | ex.: backlog mestre §20, PRD HML-01 se existir, sprints S04–S08 |
| **Próxima rodada sugerida** | IDs: `Q-…`, `Q-…` (máx. 4 por sessão ~15 min) |

---

## Índice

<!-- Uma linha por decisão pendente. Manter ordenado por urgência ou fase. Preferir poucas perguntas fortes a volume. -->

| ID | Título curto | Severidade | Bloqueia | Status |
|----|--------------|------------|----------|--------|
| Q-XXX-01 | … | ❌ | … | `aberta` |

**Totais:** `aberta` __ · `em entrevista` __ · `adiada` __

---

## Entradas

<!-- Copie o bloco abaixo por item. Não incluir tabelas de opções nem "Recomendação". Serializar categoria no título, ex.: [contrato] Nome da decisão. -->

### Q-XXX-01 — Título da decisão

| Campo | Valor |
|-------|-------|
| **Status** | `aberta` |
| **Severidade** | ❌ / ⚠️ |
| **Bloqueia** | sprint, PRD, gate, contrato — uma linha. Se útil, prefixar categoria secundária: `[sequencia] ...` |
| **Âncoras** | links relativos: backlog mestre, sprint, PRD se existir, DEC, plano, doc de produto, código ou contrato |
| **Lacuna** | O que falta decidir (2–4 frases). Sem listar alternativas. Descrever decisão pendente, não tarefa de implementação. |
| **Evidência (snapshot)** | Uma linha factual da última varredura (path, migration, status sprint, endpoint, env ou ausência verificável) |
| **Última verificação em entrevista** | _vazio até 1ª rodada_ |

**Decisão registrada:** _preencher só após entrevista_  
**Propagado em:** _PRD §… / backlog DEC-… / outro_

---

### Q-XXX-02 — …

| Campo | Valor |
|-------|-------|
| **Status** | `aberta` |
| **Severidade** | ⚠️ |
| **Bloqueia** | … |
| **Âncoras** | … |
| **Lacuna** | … |
| **Evidência (snapshot)** | … |
| **Última verificação em entrevista** | |

**Decisão registrada:**  
**Propagado em:**

---

## Histórico de resoluções

| Data | ID | Decisão (resumo) | Onde propagado |
|------|-----|------------------|----------------|
| | | | |

---

## Evidências da última varredura

<!-- Lista de paths consultados — sem narrativa longa. Atualizar a cada varredura. Registrar também ausências verificáveis relevantes. -->

- `…`
- `…`

---

## Protocolo do agente

### Varredura (atualizar registro)

1. Ler obrigatoriamente o backlog mestre e o recorte da janela atual; usar PRDs e planos apenas quando existirem.
2. Limitar a análise ao sprint atual e aos próximos sprints, com máximo de 5 sprints no total.
3. Revalidar código, contratos, migrations, envs ou ausências verificáveis antes de abrir pergunta material.
4. Para cada lacuna nova: criar entrada com ID estável (`Q-<FASE>-<NN>` ou `Q-<SPRINT>-<NN>`).
5. Antes de abrir pergunta, tentar invalidá-la: decisão já tomada, código já fechou o tema, falta apenas execução, ou a dúvida existe só porque não há PRD.
6. Para cada lacuna fechada no código/docs: marcar `obsoleta` ou remover do índice e notar no Histórico.
7. Atualizar **Meta**, **Índice**, **Evidências**; **não** escrever opções nem recomendações.

### Entrevista (uma rodada)

1. Usuário indica 1–4 IDs (ou aceita "próxima rodada sugerida").
2. **PREP:** reler âncoras + grep/read nos paths relevantes; ajustar **Lacuna** / **Evidência** se mudou.
3. **PERGUNTA:** `AskQuestion` (até 4 itens); em cada prompt: pergunta + impacto + opções + **recomendação ancorada na evidência lida agora** (skill `*-open-questions-interview`).
4. Parar o turno (`⏸️ Aguardando respostas`).
5. Após respostas: preencher **Decisão registrada**, status `resolvida`, linha no **Histórico**, pedir propagação explícita se necessário (backlog DEC, PRD §5, etc.).

### O que é proibido neste arquivo

- Tabelas `| Opção |` ou blocos **Recomendação** / **Opção A/B/C** por pergunta
- Texto de entrevista já "respondido" no passado sem estar no Histórico
- Duplicar o conteúdo do PRD — só âncoras e lacuna
- Criar novos campos, colunas ou seções para categoria; use a serialização textual nos campos existentes

---

## Agrupamento opcional (âncoras de navegação)

<!-- Títulos `##` por fase/sprint/bloco; entradas `###` abaixo. O índice único continua sendo a fonte de IDs. -->

## {{FASE_OU_BLOCO}} — …

_(entradas Q-… deste bloco)_
