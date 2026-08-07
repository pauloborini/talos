# SPEC_FSM_SIBLING_S02 — Especificação canônica da FSM sibling

> **Documento canônico da FSM sibling.** Fonte de verdade para S04/S05/S07.
>
> **Escopo:** esta spec descreve **exclusivamente** a FSM sibling do ciclo executor↔validador.
> Topologia `nested` está fora de escopo desta spec — é histórico de código (inventariado em AUDITORIA_S01_lock_topologia.md §4) e será removida em S05. Menções a `nested` neste documento existem apenas neste pré-âmbulo de escopo para delimitar o que não pertence à spec.
>
> **Produto:** Talos — sprint S02.
> **Data:** 2026-06-11.
> **Dependências:** AUDITORIA_S01_lock_topologia.md §1/§3/§5 (base de evidência).
> **Alimenta:** S04 (verificação de durabilidade), S05 (remoção nested), S07 (hardening).

---

## Índice de decisões (D-S02-*)

| D-id | Decisão | Seção nesta spec |
|------|---------|-----------------|
| D-S02-1 | FSM descreve apenas topologia sibling | §pré-âmbulo + §1 |
| D-S02-2 | Estados canônicos — conjunto fechado; terminais `passed` e `passed_with_observations` sem re-validação | §1 |
| D-S02-3 | Todo hard-fail → `blocked` com motivo legível; sem degradação silenciosa | §2 |
| D-S02-4 | Contrato de durabilidade: estado persiste atomicamente; sobrevive a re-spun | §3 |
| D-S02-5 | `max_attempts = 2`; contador monotônico; terminais não disparam re-despacho | §4 |
| D-S02-6 | Spec é documento canônico; divergência pós-S02 é defeito da spec | §pré-âmbulo |

---

## 1. Estados e transições da FSM sibling

### 1.1 Conjunto canônico de estados (`cycle.status`)

Os estados abaixo são o **conjunto fechado** do campo `cycle.status` no runtime. Fonte primária: `normalizeValidatorCycle` (`server.js:818`) — default `'idle'` quando o campo não é string (`server.js:823`).

| `cycle.status` | Semântica | Evento de entrada | Transições de saída | Rastreabilidade |
|---------------|-----------|------------------|---------------------|----------------|
| `idle` | Ciclo não iniciado; estado default antes de qualquer despacho | Criação do state file / re-spun sem ciclo ativo | → `running` (via `validatorStart` com `attempts_used < max_attempts`) | `server.js:823` (`normalizeValidatorCycle`) |
| `running` | Validator ativo — dispatch enviado, aguarda retorno | `validatorStart` aceito (gate G4 `status: 'passed'`) | → `passed` · `passed_with_observations` · `repair_required` · `blocked` | `server.js:1833–1868` (`validatorStart`) |
| `passed` | Terminal — validação aprovada sem observações | `validatorComplete` com veredito `pass`/`passed` | **Nenhuma** (terminal; slice fecha). Novo `validatorStart` sobre estado `passed` é hard-fail `blocked` → `encerrar_slice_terminal_aprovada` (ver §2.2 HF-T) | `server.js:1943–1948` (`validatorComplete`) |
| `passed_with_observations` | Terminal — aprovado com observações residuais | `validatorComplete` com veredito `pass_with_observations` | **Nenhuma** (terminal; slice fecha; observações são residuais, não gatilhos de re-despacho). Novo `validatorStart` sobre estado `passed_with_observations` é hard-fail `blocked` → `encerrar_slice_terminal_aprovada` (ver §2.2 HF-T) | `server.js:1931–1948` (`validatorComplete`) |
| `repair_required` | Primeiro `fail`; reparo pendente antes de retry | `validatorComplete` com veredito `fail` E `attempt < max_attempts` | → `repair_running` (via `validatorRepairStart`) · `blocked` (se `repair_required` + novo `validatorStart` sem repair) | `server.js:2016–2020` (`validatorComplete`) |
| `repair_running` | Reparo ativo — `talos-findings-repair` em execução | `validatorRepairStart` aceito | → `ready_for_retry` (via `validatorRepairComplete`) · `blocked` (se novo `validatorStart` antes de concluir) | `server.js:2113, 2117` (`validatorRepairStart`) |
| `ready_for_retry` | Reparo concluído; próximo despacho do validator autorizado | `validatorRepairComplete` aceito | → `running` (via `validatorStart` — segundo e último dispatch) | `server.js:2211` (`validatorRepairComplete`) |
| `blocked` | Hard-fail terminal — ciclo encerrado com erro explícito | Qualquer condição de hard-fail (ver §2) | **Nenhuma** (terminal; exige decisão externa para reiniciar slice) | `server.js:1808–1816`, `server.js:1977–1991` |

> **Nota sobre terminais:** `passed`, `passed_with_observations` e `blocked` não têm transições de saída no ciclo corrente. `passed`/`passed_with_observations` fecham a slice com sucesso; `blocked` fecha com falha.

> **Subciclo de reparo (`cycle.repair.status`):** campo separado do `cycle.status` principal. Valores: `not_needed` → `required` → `running` → `completed` (ou `exhausted` se `max_attempts` atingido na falha). Não confundir com `cycle.status`.

### 1.2 Diagrama de transições (textual)

```
idle
 └─→ running  (validatorStart: attempt <= max_attempts)
      ├─→ passed               [TERMINAL — slice ok]
      ├─→ passed_with_observations  [TERMINAL — slice ok, observações residuais]
      ├─→ repair_required      (fail + attempt < max_attempts)
      │    └─→ repair_running  (validatorRepairStart)
      │         └─→ ready_for_retry  (validatorRepairComplete)
      │              └─→ running  (validatorStart — 2ª e última tentativa)
      └─→ blocked              [TERMINAL — hard-fail]

blocked  ←── qualquer hard-fail (ver §2)  [TERMINAL]
```

### 1.3 Invariante de terminais (D-S02-2)

`passed` e `passed_with_observations` são **terminais sem transição de saída**. Observações retornadas em `passed_with_observations` são **residuais** — não disparam re-despacho do validator nem reabertura da slice. Registrar observações no relatório final do executor; não editar código para "resolver observação" pós-terminal.

---

## 2. Catálogo de hard-fails (condições fail-closed → `blocked`)

Todo hard-fail produz `status: 'blocked'` na resposta do tool com campo `error` legível. Nunca resulta em degradação silenciosa ou fallback para modo alternativo.

### 2.1 Hard-fails em `talos_preflight` (gate PREREQ)

| ID | Gatilho | Fase | Estado resultante | Motivo explícito | Rastreabilidade |
|----|---------|------|------------------|-----------------|----------------|
| HF-01 | Pré-requisito essencial ausente no host (`subagent` ou `mcp_available` não confirmado) | PREREQ (preflight) | `blocked` | `"Pré-requisito de determinismo ausente no host '${host}': ${missing.join(', ')}"` | `server.js:1406–1420`, `server.js:347–382` |
| HF-02 | Host `must_report` (`pi` ou `generic`) que não reportou `host_capabilities` explicitamente | PREREQ (preflight) | `blocked` | `cause: 'host_nao_reportou_disponibilidade'` | `server.js:350`, `server.js:367–380` |

> Observação de escopo: os 4 guards de topologia (`server.js:1761`, `1880`, `2044`, `2141`) que bloqueiam quando `cap.validator_dispatch.topology !== 'sibling'` **não são estados da FSM sibling** — são guards de topologia que deixam de existir após S05. Não entram como hard-fails desta spec.

### 2.2 Hard-fails em `validatorStart` (gate G4)

| ID | Gatilho | Condição no código | Estado resultante | Rastreabilidade |
|----|---------|-------------------|------------------|----------------|
| HF-03 | Fase ativa não é `plan_execute` | `context.dispatch.active?.phase !== 'plan_execute'` | `blocked` (`next_action: 'manter_plan_execute_ativo_antes_da_validacao'`) | `server.js:1772–1782` |
| HF-04 | Validator já está ativo (slot `cycle.active` não nulo) | `cycle.active` truthy | `blocked` (`next_action: 'aguardar_validator_ativo'`) | `server.js:1784–1793` |
| HF-05 | Teto de `max_attempts` já atingido ao iniciar | `cycle.attempts_used >= cycle.max_attempts` | `blocked` (`next_action: 'tratar_como_blocked_final_validator_failed'`) | `server.js:1796–1806` |
| HF-06 | Ciclo já está em `blocked` | `cycle.status === 'blocked'` | `blocked` (`next_action: 'encerrar_run_ou_reiniciar_slice_com_decisao_explicita'`) | `server.js:1808–1817` |
| HF-07 | Repair não concluído antes de retry (`repair_required` ou `repair_running`) | `cycle.status === 'repair_required' \|\| cycle.status === 'repair_running'` | `blocked` (`next_action: 'complete_findings_repair'`) | `server.js:1819–1831` |
| HF-08a | Ciclo já em estado terminal aprovado (`passed` ou `passed_with_observations`) ao tentar novo `validatorStart` | `VALIDATOR_PASSED_STATUSES.has(cycle.status)` | `blocked` (`next_action: 'encerrar_slice_terminal_aprovada'`, campo `validator_status` com o terminal atual). **Precede HF-05 em código** — quando o terminal é atingido no último attempt (`attempts_used == max_attempts`), este guard dispara primeiro para garantir causa correta; HF-05 só se aplica a ciclos ainda em andamento. | `server.js` — guard terminal antes do HF-05 |

> **Nota de ordenação de guards (fix S12/P2):** HF-08a é verificado ANTES de HF-05. Sem essa precedência, um ciclo que passou no attempt 2 (último) teria `attempts_used == max_attempts == 2`, fazendo HF-05 disparar com mensagem enganosa ("Terceiro validator proibido") sobre uma slice que na verdade foi aprovada.

### 2.3 Hard-fails em `validatorComplete` (gate G4)

| ID | Gatilho | Condição no código | Estado resultante | Rastreabilidade |
|----|---------|-------------------|------------------|----------------|
| HF-08 | Nenhum validator ativo para concluir | `!cycle.active` | `blocked` (`next_action: 'start_validator_primeiro'`) | `server.js:1891–1900` |
| HF-09 | `validator_run_id` não corresponde ao slot ativo | `cycle.active.run_id !== activeValidatorRunId` | `blocked` (`next_action: 'aguardar_ou_descartar_retorno_stale_do_validator'`) | `server.js:1902–1913` |
| HF-10 | `state_path` diverge do slot ativo | `cycle.active.state_path !== statePathValue` | `blocked` (`next_action: 'corrigir_payload_do_validator'`) | `server.js:1915–1927` |
| HF-10a | `dispatch_token` ausente no retorno do validator | `dispatchToken === undefined` | `blocked`; slot permanece ativo (`next_action: 'reler_validator_recovery_e_reenviar_token'`) | `validatorComplete` |
| HF-11 | Veredito inválido (não pertence ao enum `{pass, passed, pass_with_observations, passed_with_observations, fail}`) | `normalizedVerdict !== 'fail' && !VALIDATOR_PASSED_STATUSES.has(normalizedVerdict)` | `blocked` (`next_action: 'corrigir_output_do_validator'`) | `server.js:1965–1975` |
| HF-12 | Segundo validator falhou + teto atingido | `cycle.active.attempt >= cycle.max_attempts` e veredito `fail` | `cycle.status = 'blocked'`, `repair.status = 'exhausted'` (`next_action: 'encerrar_com_blocked_final_validator_failed'`) | `server.js:1977–2005` |

### 2.4 Hard-fails em `validatorRepairStart` (gate G4)

| ID | Gatilho | Rastreabilidade |
|----|---------|----------------|
| HF-13 | Validator ainda ativo ao iniciar repair | `server.js:2055–2065` |
| HF-14 | Repair já está ativo | `server.js:2067–2078` |
| HF-15 | `cycle.status !== 'repair_required'` (repair fora de ordem) | `server.js:2080–2089` |
| HF-16 | `state_path` diverge do registrado no `fail` | `server.js:2091–2102` |

### 2.5 Hard-fails em `validatorRepairComplete` (gate G4)

| ID | Gatilho | Rastreabilidade |
|----|---------|----------------|
| HF-17 | Validator ativo ao fechar repair | `server.js:2152–2162` |
| HF-18 | `cycle.status !== 'repair_running'` (reparo fora de ordem) | `server.js:2164–2173` |
| HF-19 | Nenhum repair ativo | `server.js:2175–2183` |
| HF-20 | `repair_run_id` não corresponde ao repair ativo | `server.js:2186–2196` |
| HF-21 | `state_path` do `repair_complete` diverge do repair ativo | `cycle.repair.active.state_path !== statePathValue` | `blocked`; repair permanece ativo. O reparador atualiza o arquivo original em lugar. |

> **Invariante D-S02-3:** todo hard-fail (HF-01 a HF-21) resulta em `status: 'blocked'` com campo `error` não vazio. Nunca em degradação silenciosa, fallback de topologia ou modo alternativo.

---

## 3. Contrato de durabilidade (D-S02-4)

A FSM sibling presume as seguintes garantias de persistência. S04 verifica estas garantias empiricamente.

### 3.1 Path em disco

```
<consumerRoot>/.talos/state/<runId>/run.json
```

- `consumerRoot` é o diretório raiz do projeto consumidor (`server.js:448`).
- `runId` é o identificador único da run, validado por `validateRunId` (`server.js:497–498`).
- Rastreabilidade: `server.js:8` (`RUN_DIR = path.join('.talos', 'state')`), `server.js:497–500` (`statePath`).

### 3.2 Escrita atômica

O estado do ciclo é persistido via padrão `tmp-then-rename`:

```
server.js:694  const target = statePath(runId, args);
server.js:695  const tmp = `${target}.${process.pid}.tmp`;
server.js:696  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
server.js:697  fs.renameSync(tmp, target);
```

**Garantia:** o leitor nunca vê um `run.json` parcialmente escrito. `renameSync` é atômica no sistema de arquivos — o arquivo ou contém o estado completo anterior ou o estado completo novo. Permissão `0o600`: leitura/escrita exclusiva do processo dono.

### 3.3 Reconstituição do disco em re-spun

Ao reiniciar, a próxima chamada a qualquer tool que execute `upsertState` lê `previous = readState(runId)` (`server.js:674`). `readState` faz `JSON.parse(readFileSync(file))` (`server.js:642`, conforme AUDITORIA_S01 §1.4). O ciclo é reconstituído via `normalizeValidatorCycle(previous.data?.validator_cycle ?? {})` (`server.js:851`).

**Garantia:** não há estado crítico do `validator_cycle` mantido exclusivamente em memória. Após re-spun, o estado persiste e o ciclo continua de onde parou — sem recomeçar do zero nem duplicar despacho do validator.

**Limite de escopo (D-S02-4):** esta spec declara o contrato; a verificação de token monotônico e reconciliação idempotente em re-spun é responsabilidade de S04.

---

## 4. Contrato max-2 e semântica de terminais (D-S02-5)

### 4.1 Teto de validações por slice

**`max_attempts = 2`** (constante em código — não configurável por runtime).

```
server.js:65  const VALIDATOR_MAX_ATTEMPTS = 2;
```

Inicializado em `normalizeValidatorCycle` (`server.js:821`): `cycle.max_attempts = VALIDATOR_MAX_ATTEMPTS` quando o campo não é inteiro.

### 4.2 Contador monotônico por slice

`cycle.attempts_used` é incrementado em `validatorStart` ao aceitar um novo despacho:

```
server.js:1833  const attempt = cycle.attempts_used + 1;
server.js:1849  attempts_used: attempt,   // persiste no validator_cycle
```

O contador é **monotônico dentro da slice**: nunca decrementado. Verificado em dois pontos:
- Ao iniciar: `cycle.attempts_used >= cycle.max_attempts` → HF-05 (`server.js:1796`).
- Ao fechar com `fail` no 2º attempt: `cycle.active.attempt >= cycle.max_attempts` → HF-12 (`server.js:1977`).

### 4.3 Conjunto de vereditos terminais

```
server.js:66  const VALIDATOR_PASSED_STATUSES = new Set(['passed', 'passed_with_observations']);
```

Normalização de alias em `validatorComplete` (`server.js:1929–1933`):
- `'pass'` → `'passed'` (alias → canônico)
- `'pass_with_observations'` → `'passed_with_observations'` (alias → canônico)

Ambas as formas curtas são **aliases de input** aceitos no payload do validador; o valor persistido em `cycle.status` é sempre o canônico (`passed` / `passed_with_observations`, membros de `VALIDATOR_PASSED_STATUSES`, `server.js:66`).

### 4.4 Regra de não re-despacho em veredito não-`fail`

**`passed` e `passed_with_observations` são terminais.** O validator lê `validator_recovery.expected_dispatch_token` via `talos_run_state` e devolve esse inteiro no output. `validatorComplete` só aplica o veredito quando `validator_run_id`, `state_path` e `dispatch_token` correspondem ao slot ativo. Ao receber qualquer veredito em `VALIDATOR_PASSED_STATUSES`, retorna `next_action: 'complete_plan_execute'` e define `cycle.status` = veredito. Não há transição de saída para nova rodada de validação.

**Observações em `passed_with_observations`** são residuais: devem ser registradas no relatório final do executor, nunca usadas como gatilho para editar código e re-validar. Reabrir a slice após `passed_with_observations` é proibido pela skill `talos-plan-execute` (SKILL.md §9).

---

## 5. Cobertura de cenários UX (PRD §4)

| Cenário PRD §4 | Estado(s) envolvidos | Transição chave |
|----------------|---------------------|----------------|
| §4.1 Caminho feliz | `idle` → `running` → `passed`/`passed_with_observations` | `validatorStart` aceito; `validatorComplete` com veredito positivo |
| §4.2 Reparo e retry | `running` → `repair_required` → `repair_running` → `ready_for_retry` → `running` → `passed`/`blocked` | `validatorComplete` fail; reparo; `validatorRepairComplete`; 2ª rodada |
| §4.3 Preflight ausente | `idle` (ciclo não iniciado) → pipeline `blocked` no gate PREREQ | HF-01/HF-02 (`checkPrerequisites`) |
| §4.4 Veredito inválido | `running` → `blocked` | HF-11 (`validatorComplete` veredito fora do enum) |
| §4.5 Re-spun no meio do ciclo | Estado ativo no disco → reconstituído via `normalizeValidatorCycle` | `readState` + `normalizeValidatorCycle` (§3.3) |

---

## 6. Índice de rastreabilidade `server.js`

| Referência | Função | Descrição |
|-----------|--------|-----------|
| `server.js:65` | constante | `VALIDATOR_MAX_ATTEMPTS = 2` |
| `server.js:66` | constante | `VALIDATOR_PASSED_STATUSES` |
| `server.js:497–500` | `statePath` | Caminho do `run.json` em disco |
| `server.js:694–697` | `upsertState` | Escrita atômica (tmp + renameSync) |
| `server.js:818–847` | `normalizeValidatorCycle` | Default de campos + estado `idle` |
| `server.js:823` | `normalizeValidatorCycle` | Default `cycle.status = 'idle'` |
| `server.js:1406–1420` | `talos_preflight` | Gate PREREQ → HF-01/HF-02 |
| `server.js:1754` | `validatorStart` | Entrada do handler start |
| `server.js:1796–1806` | `validatorStart` | HF-05 — teto attempts na entrada |
| `server.js:1808–1817` | `validatorStart` | HF-06 — ciclo já `blocked` |
| `server.js:1819–1831` | `validatorStart` | HF-07 — repair não concluído |
| `server.js:1833–1868` | `validatorStart` | Atribuição `status = 'running'` + `attempts_used++` |
| `server.js:1871` | `validatorComplete` | Entrada do handler complete |
| `server.js:1929–1933` | `validatorComplete` | Normalização de alias de veredito |
| `server.js:1935–1962` | `validatorComplete` | Transição → `passed`/`passed_with_observations` |
| `server.js:1965–1975` | `validatorComplete` | HF-11 — veredito inválido |
| `server.js:1977–2005` | `validatorComplete` | HF-12 — 2º fail + teto → `blocked` |
| `server.js:2008–2034` | `validatorComplete` | Transição → `repair_required` |
| `server.js:2037` | `validatorRepairStart` | Entrada do handler repair_start |
| `server.js:2104–2131` | `validatorRepairStart` | Atribuição `status = 'repair_running'` |
| `server.js:2134` | `validatorRepairComplete` | Entrada do handler repair_complete |
| `server.js:2199–2223` | `validatorRepairComplete` | Atribuição `status = 'ready_for_retry'` |
