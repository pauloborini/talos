> **Supersedido em DEC-049:** não há `legacy_sealed`. Sprint aberta migra §1+L2; linha de intenção ausente falha `stub`. **Não executar este plano** — o corpo abaixo é histórico (ainda descreve o atalho removido).

# Saturação de intenção SDD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline Talos satura intenção na §2 do sprint file (L1 recorte / L2 eixo) e recusa plano/direct sem `plan_ready`, sem criar `INTENT.md`.

**Architecture:** Gates moram no MCP + `document_quality.mjs` (limiar `stub`/`plan_ready`, selo §2, `intent_refs`). Skills só perguntam/persistem. Fonte canônica = `packages/`; catálogos `hosts/` e `plugins/talos/` saem de `build/build-plugins.sh`. Disco slice v3 e schema capabilities v5 intactos.

**Tech Stack:** Node (MCP `packages/mcp-server/server.js`, `node --test`), markdown templates, skills Talos, `build/check-consistency.mjs`.

**Spec:** `_app-vault/specs/SPEC_INTENT_SATURATION_SDD.md` (D-INT-1–18, DEC-040–048).

## Global Constraints

- Fonte de edição: só `packages/`, `_app-vault/`, `build/check-consistency.mjs`, `CHANGELOG.md`, `VERSION`/`package.json` no bump. **Proibido** editar `hosts/**` e `plugins/talos/**` à mão.
- Schema MCP capabilities v5: sem campo novo de host. Params aditivos em tools existentes (`require` em `talos_verify_sprint_file`).
- Disco slice v3 intacto. Sem `INTENT.md`. Sem renumerar §7–§16.
- `require` omitido = `plan_ready` (caller legado não afrouxa).
- `inspectBacklogIndex` valida sprint files com `require: 'stub'` — senão todo draft vira `invalid` e `select_next` morre.
- Stub: linha `Intenção status` ausente = `rascunho` (compat). `plan_ready` exige campo + `saturada` + selo íntegro.
- `legacy_sealed`: `Status` ∈ {`doing`,`review`} **e** contrato `aprovado` + selo §7 íntegro **e** intenção ausente/`rascunho`. `backlog`/`ready`/`draft` nunca são legacy.
- G11 continua: `full` executa após PLAN. Recorte PLAN ⊆ §2 é TC (`require_sprint_file:true`) + `assertAfterPlan` quando houver `plan_path` real (não sentinel direct).
- Quantidade de sprints: nunca perguntar. Sugestão do usuário vence.
- G5=0 não pula L2. Frase `entrevista pulada` some do orquestrador para intenção.
- Testes: estender `packages/mcp-server/server.test.js` (suite já existe). Não criar harness novo.
- **Não commitar** sem pedido explícito do usuário nesta sessão.
- Respostas/artefatos em pt-BR. Compact no chat; este plano é o contrato de impl.
- Bump: `0.22.0` → `0.23.0` BREAKING (DEC-009) **só na Task 8**, depois de gates+skills verdes.
- Após editar `packages/`, última ação da entrega: `bash build/build-plugins.sh` (não no meio).

## File map

| Arquivo | Papel |
|---------|--------|
| `packages/templates/SPRINT_TEMPLATE.md` | §1 intenção status/selo; §2 eixo/SF/AS/R1/aferição; DoR checkbox |
| `packages/templates/PLAN_TEMPLATE.md` | linha `intent_refs` em cada `#### Tnn.` |
| `packages/skills/_shared/scripts/document_quality.mjs` | selo §2, T* mecânicos parciais, limiar stub/plan_ready, persistência §2, `verifyIntentRefs` |
| `packages/mcp-server/server.js` | `require` + `maturity`; `selectNextSprint` fila maturação sem `--loop`; TC + G11 `intent_refs` |
| `packages/mcp-server/server.test.js` | testes dos gates; `sprintDoc` + `CONFORMANT_PLAN_DOC` |
| `packages/skills/talos-backlog-generator/SKILL.md` + `references/COLD_BACKLOG_REVIEW_PROMPT.md` | L1 |
| `packages/skills/talos-sprint-interview/SKILL.md` | L2 fase 1 então §7 |
| `packages/skills/talos-plan-handoff/SKILL.md` | exige `plan_ready`; escreve `intent_refs` |
| `packages/skills/talos-direct-execute/SKILL.md` | `require: plan_ready` |
| `packages/orchestrator/skills/talos/SKILL.md` | G5 não pula L2; `select_next` sem loop matura stub; verify com `require` |
| `build/check-consistency.mjs` | tokens novos (template, skills, proibição `INTENT.md` / quantidade) |
| `CHANGELOG.md`, `VERSION`, `package.json`, `packages/mcp-server/package.json`, `.claude-plugin/plugin.json` | bump 0.23.0 |
| `_app-vault/docs/decisions/*`, `INDEX.md` | já escritos; só alinhar versão se o changelog citar DEC |

---

### Task 1: Template sprint + plano

**Files:**
- Modify: `packages/templates/SPRINT_TEMPLATE.md`
- Modify: `packages/templates/PLAN_TEMPLATE.md`
- Test: `packages/mcp-server/server.test.js` (asserts de template já existentes ~1730 e ~2073)

**Interfaces:**
- Consumes: D-INT-2/3, DEC-040
- Produces: linhas §1 `Intenção status` / `Selo da intenção`; corpo §2 com placeholders `SF-01`, `AS-01`, `R1`; task PLAN com `intent_refs`

- [ ] **Step 1: Teste falhando — template §1/§2/DoR**

Em `server.test.js`, junto dos testes `SPRINT_TEMPLATE:`, acrescentar:

```javascript
test('SPRINT_TEMPLATE: §1 intenção + §2 IDs SF/AS/R1 (DEC-040)', () => {
  const template = fs.readFileSync(SPRINT_TEMPLATE_PATH, 'utf8');
  assert.match(template, /^\|\s*Intenção status\s*\|\s*\[rascunho \/ saturada\]\s*\|/m);
  assert.match(template, /^\|\s*Selo da intenção\s*\|\s*\[pendente até saturação\]\s*\|/m);
  assert.match(template, /\*\*Eixo do ataque:\*\*\s*`dados`\s*\\\|\s*`ux`/);
  assert.match(template, /\*\*SF-01\*\*/);
  assert.match(template, /\*\*AS-01\*\*/);
  assert.match(template, /\*\*R1:\*\*/);
  assert.match(template, /Intenção saturada \(selo §1\)/);
  assert.doesNotMatch(template, /INTENT\.md/);
});

test('PLAN_TEMPLATE: intent_refs nas tasks (D-INT-18)', () => {
  const plan = fs.readFileSync(new URL('../templates/PLAN_TEMPLATE.md', import.meta.url), 'utf8');
  assert.match(plan, /intent_refs:\s*\[SF-01,\s*R1\]/);
});
```

- [ ] **Step 2: Rodar — deve FAIL**

Run: `node --test --test-name-pattern "SPRINT_TEMPLATE: §1 intenção|PLAN_TEMPLATE: intent_refs" packages/mcp-server/server.test.js`

Expected: FAIL (regex não casa).

- [ ] **Step 3: Editar `SPRINT_TEMPLATE.md`**

Na tabela §1, **imediatamente após** `Selo do contrato`, inserir:

```markdown
| Intenção status | [rascunho / saturada] |
| Selo da intenção | [pendente até saturação] |
```

Substituir o corpo da `## 2. Objetivo e valor` (manter os quatro campos atuais) por este bloco **depois** de `**Se não fizer:**`:

```markdown
**Eixo do ataque:** `dados` \| `ux` \| `estrutura` \| `contrato` \| `misto` — [premissa / usuario / derivado:<path>]

**Aferição T\*:** [T1–T7 disparados / zerados — uma linha]

**Entrevista:** [pendente \| dispensada: <motivo>]

**Superfícies (SF-\*):**
- **SF-01** — [enunciado; path:symbol só com `[não verificado]`] — [usuario / derivado:<path> / premissa]

**Anti-escopo tentador (AS-\*):**
- **AS-01** — [tentação concreta de implementação/eixo; genérico não conta] — [usuario / derivado:<path> / premissa]

**Recusa:**
- **R1:** eu recuso a sprint se [efeito observável] — [usuario / derivado:<path> / premissa]

**Regras do repo:** [seguir <path> \| exceção usuario: <motivo> \| N/A (eixo não toca produto)]
```

Em §8 DoR, após o checkbox do contrato §7, adicionar:

```markdown
- [ ] Intenção saturada (selo §1) — obrigatório para DoR verde / `plan_ready`.
```

Parágrafo da §7: **não** mudar numeração. Acrescentar uma frase: aceite §7 deriva da §2 saturada; validador de código continua notando contra §7.

- [ ] **Step 4: Editar `PLAN_TEMPLATE.md`**

Em `#### T01` (e no comentário de T02/TNN), após `**Objetivo:**`, adicionar:

```markdown
- **intent_refs:** [SF-01, R1]
```

Em TNN (validação final) também `intent_refs: [R1]` (a recusa tem dono). Texto de **Fonte de recorte** já cita §2 — manter.

- [ ] **Step 5: Rodar testes do Step 1 — PASS**

Run: mesmo comando. Expected: PASS.

- [ ] **Step 6: Commit** — só se o usuário pedir.

---

### Task 2: Selo §2 + limiar `stub`/`plan_ready` em `document_quality.mjs`

**Files:**
- Modify: `packages/skills/_shared/scripts/document_quality.mjs`
- Modify: `packages/mcp-server/server.js` (`verifySprintFile` + schema)
- Modify: `packages/mcp-server/server.test.js` (`sprintDoc`, testes verify)
- Test: `packages/mcp-server/server.test.js`

**Interfaces:**
- Consumes: `extractAcceptanceBlock` / `computeAcceptanceSeal` / `validateAcceptanceSeal` / `tableValue` / `validateSprintFileConformance`
- Produces:
  - `extractIntentBlock(markdown)` — `## 2.` até antes de `## 3.` (mesma normalização de `normalizeAcceptanceBlock`)
  - `computeIntentSeal(markdown)` → `sha256:<hex>` \| `null`
  - `validateIntentSeal(markdown)` → `{ sealed, tampered }` — `saturada` exige selo; `rascunho`/ausente → `{sealed:false, tampered:false}`
  - `approveIntentSaturation(markdown)` — seta `Intenção status: saturada` + selo (espelha `approveAcceptanceContract`)
  - `validateSprintFileConformance(md, { require: 'stub'|'plan_ready', ... })` default **`plan_ready`**
  - retorno extra: `{ maturity: 'stub'|'plan_ready'|'legacy_sealed', valid, pendencies, premissa_count }`
  - `verifySprintFile` args `require` enum; result inclui `maturity` e `require`

Regras mecânicas (código, não prosa T4 tautológica completa — T4/T5 genéricos restantes na skill):

**Sempre (stub e plan_ready):** seções 1–16, §4 Discussão, IDs, Backlog mestre, `Contrato status` draft|aprovado. **Não** exigir D* nem YAML `acceptance` quando `require==='stub'`.

**`require==='stub'`:** pular blocos atuais que exigem `| D\\d+ |` e `parseAcceptanceContract`. Selo §7 só se `aprovado` (tamper igual hoje). Intenção ausente → tratar `rascunho`.

**`require==='plan_ready'`:** regras atuais de §7 **mais**:
1. eixo regex `^(dados|ux|estrutura|contrato|misto)$` no corpo §2
2. ≥1 `SF-NN`, ≥1 `AS-NN`, exatamente um `R1`
3. `Intenção status` = `saturada` e `validateIntentSeal.sealed && !tampered`
4. contrato `aprovado` + selo §7 íntegro
5. **exceto** `legacy_sealed` → passed, `maturity: 'legacy_sealed'`, sem exigir selo de intenção

**`require` inválido:** `rpcError(-32602, 'invalid_params: require deve ser stub|plan_ready.')`

`inspectBacklogIndex`: passar `{ require: 'stub' }` em `validateSprintFileConformance`. Preencher `info.intencao_status`, `info.intencao_sealed`, `info.maturity` (projeção: se stub-valid e não plan_ready e não legacy → `stub`).

- [ ] **Step 1: Testes falhando**

Atualizar `sprintDoc` com defaults:

```javascript
  intencaoStatus = 'rascunho',
  seloIntencao = undefined, // igual selo §7: auto se saturada
  includeIntentBody = false, // true gera eixo+SF-01+AS-01+R1
```

Na tabela §1 de `sprintDoc`, após `Selo do contrato`:

```javascript
    `| Intenção status | ${intencaoStatus} |`,
```

e selo de intenção análogo ao contrato (`pendente até saturação` se não saturada).

Novos testes (nomes estáveis):

```javascript
test('talos_verify_sprint_file: default require=plan_ready bloqueia stub draft', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), sprintDoc({ contratoStatus: 'draft' }));
  const r = verifySprintFile({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT_S01.md', sprint_id: 'S01' });
  assert.equal(r.status, 'blocked');
  assert.equal(r.require, 'plan_ready');
});

test('talos_verify_sprint_file: require=stub passa draft sem YAML de eixo saturado', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), sprintDoc({
    status: 'backlog', contratoStatus: 'draft', omitDecisions: true, omitAceiteBlock: true,
  }));
  const r = verifySprintFile({
    run_id: 'r1', project_root: root, sprint_path: 'SPRINT_S01.md', sprint_id: 'S01', require: 'stub',
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.maturity, 'stub');
});

test('talos_verify_sprint_file: require omitido não aceita stub (caller legado)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), sprintDoc({ status: 'backlog', contratoStatus: 'draft' }));
  const r = verifySprintFile({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT_S01.md', sprint_id: 'S01' });
  assert.equal(r.status, 'blocked');
});

test('talos_verify_sprint_file: legacy_sealed doing+aprovado sem intenção', () => {
  const root = tmpRoot();
  const doc = sprintDoc({ status: 'doing', contratoStatus: 'aprovado' });
  fs.writeFileSync(path.join(root, 'SPRINT_S01.md'), doc);
  const r = verifySprintFile({ run_id: 'r1', project_root: root, sprint_path: 'SPRINT_S01.md', sprint_id: 'S01' });
  assert.equal(r.status, 'passed');
  assert.equal(r.maturity, 'legacy_sealed');
});

test('talos_verify_sprint_file: require inválido → -32602', () => {
  assert.throws(
    () => verifySprintFile({ run_id: 'r1', project_root: tmpRoot(), sprint_path: 'x.md', require: 'verde' }),
    (err) => err?.code === -32602,
  );
});
```

**Migração de testes existentes que esperam `passed` sem `require`:** os que usam `sprintDoc()` draft (`talos_verify_sprint_file: válido passa…`, sub-sprint decimal, etc.) devem passar `require: 'stub'` **ou** fixture `plan_ready` completa. Preferir `require: 'stub'` quando o teste prova estrutura/backlink, não saturação.

Helper `planReadySprintDoc(overrides)`: `includeIntentBody: true`, `intencaoStatus: 'saturada'`, `contratoStatus: 'aprovado'`, selos auto via `computeAcceptanceSeal` + `computeIntentSeal` (depois de implementados; no teste vermelho pode selar depois do impl).

- [ ] **Step 2: Rodar recorte verify — FAIL**

Run: `node --test --test-name-pattern "talos_verify_sprint_file" packages/mcp-server/server.test.js`

Expected: FAIL (schema rejeita `require` e/ou default ainda passa draft).

- [ ] **Step 3: Implementar funções de selo §2**

Espelhar §7. `extractIntentBlock`:

```javascript
export function extractIntentBlock(markdown) {
  const start = /^##\s+2\.\s/im.exec(markdown);
  if (!start) return null;
  const tail = markdown.slice(start.index);
  const afterHeading = tail.slice(start[0].length);
  const next = /\n##\s/.exec(afterHeading);
  const raw = next ? tail.slice(0, start[0].length + next.index) : tail;
  return normalizeAcceptanceBlock(raw);
}

export function computeIntentSeal(markdown) {
  const block = extractIntentBlock(markdown);
  if (block == null) return null;
  const hash = crypto.createHash('sha256').update(block, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
```

`validateIntentSeal`: se status ≠ `saturada` → não tampered. Se saturada sem `sha256:[a-f0-9]{64}` → tampered. Se hash diverge → tampered.

`isLegacySealed(markdown)`: `Status` doing|review AND `validateAcceptanceSeal.sealed` AND (`Intenção status` ≠ saturada OU selo intenção ausente/pendente).

No início de `validateSprintFileConformance`:

```javascript
  const requireLevel = opts.require ?? 'plan_ready';
  if (requireLevel !== 'stub' && requireLevel !== 'plan_ready') {
    throw new Error('INVALID_REQUIRE');
  }
```

MCP captura `INVALID_REQUIRE` → `-32602`.

Envolver o bloco D* + acceptance (hoje linhas ~763+) com `if (requireLevel === 'plan_ready' && !isLegacySealed(markdown))`.

Após isso, se `plan_ready && !legacy`: checar eixo/SF/AS/R1/selo intenção.

Setar `validation.maturity`:
- legacy → `legacy_sealed`
- senão se passaria plan_ready → `plan_ready`
- senão se stub-clean → `stub`
- se inválido no limiar pedido → maturity do maior que satisfaz, ou `stub`

`verifySprintFile`: ler `args.require`, default `'plan_ready'`; schema:

```javascript
require: { type: 'string', enum: ['stub', 'plan_ready'] },
```

Incluir `require` e `maturity` no result.

Exportar novas fns no `import` de `server.js` se G11/TC precisarem (Task 4 pode reexportar).

- [ ] **Step 4: `inspectBacklogIndex` usa stub**

```javascript
        const validation = validateSprintFileConformance(sprintMarkdown, {
          ...,
          require: 'stub',
        });
        info.intencao_status = sprintMetadataValue(sprintMarkdown, 'Intenção status');
        const intentSeal = validateIntentSeal(sprintMarkdown);
        info.intencao_sealed = intentSeal.sealed && !intentSeal.tampered;
        info.maturity = validation.maturity;
```

Pendências de sprint file no índice: só as do limiar stub (já vem filtradas).

- [ ] **Step 5: Rodar verify + testes que quebraram por default**

Run: `node --test --test-name-pattern "talos_verify_sprint_file|validateAcceptanceSeal|SPRINT_TEMPLATE" packages/mcp-server/server.test.js`

Expected: PASS. Se `válido passa com vínculo` ainda blocked → faltou `require:'stub'` no teste.

- [ ] **Step 6: Commit** — só se pedido.

---

### Task 3: `select_next` matura stub sem `--loop`

**Files:**
- Modify: `packages/mcp-server/server.js` (`selectNextSprint`, `nextActionForSelectedSprint`)
- Modify: `packages/mcp-server/server.test.js`
- Test: testes `talos_select_next_sprint:*`

**Interfaces:**
- Consumes: `info` com `intencao_status` / `intencao_sealed` / `contrato_*` / `state` / `dor_status` / `sprint_file_status` (valid no limiar stub)
- Produces: fila maturação **sempre** precede `ready`; `next_action: sprint_interview` se backlog **ou** intenção não saturada (e não legacy)

Lógica alvo (substitui o gate `loop && state===backlog` como único caminho):

```javascript
    const maturationEligible = info.state === 'backlog';
    if (info.state !== 'ready' && !maturationEligible) reasons.push(`state=${info.state}`);
    // unmet + sprint_file valid iguais
    const dorAllowed = maturationEligible
      ? (info.dor_status === 'amarelo' || info.dor_status === 'verde')
      : info.dor_status === 'verde';
    if (reasons.length === 0) {
      if (maturationEligible) maturationCandidates.push(info);
      else candidates.push(info);
    }
    const orderedCandidates = [...maturationCandidates, ...candidates];
```

`loop:true` **não** muda essa ordem (CN7 continua no orquestrador: execução serial + review + drain). Manter `args.loop` no schema.

`nextActionForSelectedSprint`:

```javascript
  const contratoOk = /^aprovado$/i.test(info?.contrato_status ?? '') && info?.contrato_sealed === true;
  const intentOk = /^saturada$/i.test(info?.intencao_status ?? '') && info?.intencao_sealed === true;
  const legacy = info?.maturity === 'legacy_sealed';
  if (info?.state === 'backlog') return 'sprint_interview';
  if (!contratoOk || mode === 'interview-only') return 'sprint_interview';
  if (!intentOk && !legacy) return 'sprint_interview';
  if (mode === 'direct') return 'plan_execute';
  if (hasPlan) return 'plan_execute';
  return 'plan_handoff';
```

`selected.reason`:
- backlog + `loop===true`: manter prefixo `loop: sprint backlog maturável + ...` (testes atuais)
- backlog + sem loop: `backlog maturável + deps done/manual_validation_pending + sprint file válido (stub) + DoR amarelo/verde + maior prioridade determinística`

Mensagem de pendência “Nenhuma sprint executável”: atualizar texto para incluir fila de maturação.

- [ ] **Step 1: Inverter o teste que documenta o comportamento velho**

Substituir `talos_select_next_sprint: sem loop preserva bloqueio de backlog com DoR amarelo` por:

```javascript
test('talos_select_next_sprint: sem loop seleciona backlog stub para sprint_interview', () => {
  const root = tmpRoot();
  writeSprintFixture(root, 'S02', { status: 'backlog', dorStatus: 'amarelo', contratoStatus: 'draft' });
  fs.writeFileSync(path.join(root, 'BACKLOG.md'), backlogWithRows([
    '| S02 | Sem opt-in | F0 | objetivo | Must | Alto | Baixo | P0 | — | — | backlog | — | `.talos/backlog/sprints/SPRINT_S02_runtime.md` | pendente | pendente |',
  ]));
  const r = selectNextSprint({ run_id: 'r1', project_root: root, backlog_path: 'BACKLOG.md', mode: 'full' });
  assert.equal(r.status, 'passed');
  assert.equal(r.selected.sprint_id, 'S02');
  assert.equal(r.next_action, 'sprint_interview');
  assert.match(r.selected.reason, /backlog maturável/);
  assert.doesNotMatch(r.selected.reason, /^loop:/);
});
```

Acrescentar: sem loop, backlog P3 maturável **antes** de ready P0 (espelha o teste de loop já existente, `loop: false`).

Acrescentar: ready + contrato selado + intenção rascunho → `sprint_interview` (não `plan_handoff`).

- [ ] **Step 2: FAIL**

Run: `node --test --test-name-pattern "talos_select_next_sprint: sem loop" packages/mcp-server/server.test.js`

Expected: FAIL (`blocked` ainda).

- [ ] **Step 3: Implementar seleção + next_action**

- [ ] **Step 4: Suite select_next**

Run: `node --test --test-name-pattern "talos_select_next_sprint" packages/mcp-server/server.test.js`

Expected: PASS. Ajustar testes que assumem `ready`+draft → interview (já é o caso) e os que assumem `aprovado` sem intenção → `plan_handoff` (passam a interview). Procurar `contratoStatus: 'aprovado'` + `next_action, 'plan_handoff'` e exigir fixture de intenção saturada **ou** aceitar interview.

- [ ] **Step 5: Commit** — só se pedido.

---

### Task 4: PLAN ⊆ §2 (`intent_refs`) no TC e no G11

**Files:**
- Modify: `packages/skills/_shared/scripts/document_quality.mjs` (`verifyIntentRefs`)
- Modify: `packages/mcp-server/server.js` (`verifyPlanConformance`, `verifyTemplateConformance`, `assertAfterPlan`)
- Modify: `packages/mcp-server/server.test.js` (`CONFORMANT_PLAN_DOC` quando `require_sprint_file`)
- Test: `server.test.js`

**Interfaces:**
- Consumes: IDs `SF-NN`, `AS-NN`, `R1` no bloco §2; tasks `#### Tnn.`
- Produces: `verifyIntentRefs(planMarkdown, sprintMarkdown)` → pendências

Algoritmo:

```javascript
export function parseIntentIds(sprintMarkdown) {
  const block = extractIntentBlock(sprintMarkdown) ?? '';
  const sf = [...block.matchAll(/\*\*SF-(\d+)\*\*/g)].map((m) => `SF-${m[1].padStart(2, '0') === m[1] ? m[1] : m[1]}`);
  // Preferir match estável:
  const surfaces = [...block.matchAll(/\bSF-\d+\b/g)].map((m) => m[0]);
  const antis = [...block.matchAll(/\bAS-\d+\b/g)].map((m) => m[0]);
  const hasR1 = /\bR1\b/.test(block);
  return { sf: [...new Set(surfaces)], as: [...new Set(antis)], hasR1 };
}

export function verifyIntentRefs(planMarkdown, sprintMarkdown) {
  const pendencies = [];
  const { sf, as, hasR1 } = parseIntentIds(sprintMarkdown);
  const tasks = [...planMarkdown.matchAll(/^####\s+(T\d+)\./gm)].map((m) => m[1]);
  // Para cada task, extrair bloco até próximo #### ou ##
  // Exigir linha intent_refs: [ID, ID]
  // Regras D-INT-18: não vazio; só SF-* ou R1; nenhum AS-*; todo SF da §2 em ≥1 task; R1 em ≥1 task
  return pendencies;
}
```

Parser da linha: `/^\s*[-*]\s+\*\*intent_refs:\*\*\s*\[([^\]]+)\]/im` **ou** `/intent_refs:\s*\[([^\]]+)\]/` (template usa a segunda forma na skill; template Task 1 usa `- **intent_refs:** [SF-01, R1]`). Aceitar **os dois**.

`verifyPlanConformance(content, { requireSprintFile, sprintMarkdown })`:
- se `!requireSprintFile` → **não** julgar `intent_refs` (standalone TC frouxo permanece)
- se `requireSprintFile && !sprintMarkdown` → pendência `intent_sprint_ausente`
- senão `pendencies.push(...verifyIntentRefs(content, sprintMarkdown))`

`verifyTemplateConformance`: se `requireSprintFile`, resolver path do campo `**Sprint file**` (markdown link ou path relativo ao `project_root` / dirname do plano). Ler arquivo; passar markdown.

`assertAfterPlan`: **não** enfraquecer G11. Após montar `result` passed no ramo `full && plan_validated && attemptedAction===dispatch_plan_execute`, se `dispatch`/`ledger` tiver `plan_path` ≠ sentinel direct, ler plano+sprint e se `verifyIntentRefs` ≠ [] → `status:'blocked'`, `next_action` não executa. Se `plan_path` ausente neste gate, TC já é o juiz obrigatório do orquestrador (`require_sprint_file:true` antes de G11).

- [ ] **Step 1: Testes**

`CONFORMANT_PLAN` (sem `require_sprint_file`) **não** ganha `intent_refs` — continua passing.

O teste `modo sprint exige Sprint file/EVAL` (`require_sprint_file: true` + `CONFORMANT_PLAN_DOC`): passa a precisar de sprint em disco `plan_ready` (ou pelo menos §2 com SF-01 + R1) **e** `intent_refs` em T01.

```javascript
test('talos_verify_template_conformance: AS-* em intent_refs bloqueia', () => {
  // plano T01 intent_refs: [AS-01] + sprint com AS-01/SF-01/R1 → blocked category intent_refs
});

test('talos_verify_template_conformance: SF sem lastro bloqueia', () => {
  // §2 tem SF-01 e SF-02; plano só cita SF-01 → blocked
});
```

- [ ] **Step 2: FAIL → impl → PASS**

Run: `node --test --test-name-pattern "talos_verify_template_conformance|talos_assert_after_plan" packages/mcp-server/server.test.js`

- [ ] **Step 3: Commit** — só se pedido.

---

### Task 5: Skills L1 / L2 / handoff / direct / orquestrador

**Files:**
- Modify: `packages/skills/talos-backlog-generator/SKILL.md`
- Modify: `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` (se existir; senão o path real sob `references/`)
- Modify: `packages/skills/talos-sprint-interview/SKILL.md`
- Modify: `packages/skills/talos-plan-handoff/SKILL.md`
- Modify: `packages/skills/talos-direct-execute/SKILL.md`
- Modify: `packages/orchestrator/skills/talos/SKILL.md`
- Modify: `build/check-consistency.mjs`

**Interfaces:**
- Consumes: `question_prompt`, `persistInterviewRound`, `talos_verify_sprint_file`, `talos_select_next_sprint`, T1–T7 / catálogo §5.4 da spec
- Produces: comportamento documental (não schema v5)

**L1 generator**
- Gatilho de pergunta = recorte/tema/MoSCoW, **não** `talos_scan_acceptance` blocking em stub. Remover/rebaixar “enquanto `blocking_count > 0` inflar AC”.
- Proibido perguntar quantidade de sprints; se o usuário sugerir N/nomes/IDs → `Origem: usuario`, não sobrescrever.
- Stubs: `state=backlog`, `Intenção status: rascunho`, `Contrato status: draft`, §7 **sem** YAML `acceptance` obrigatório.
- Verificar com `talos_verify_sprint_file` **`require: stub`**.
- Cold review: §2 rascunho + T* → `interview_required`; proibido inventar R1.

**L2 interview** (mesma skill, ordem rígida)
1. Classificar eixo; loop T* via `question_prompt`; persistir §2 (`applyIntentRound` — Task 2 deve exportar persistência de campos §2 **ou** a skill edita markdown com `setTableValue` + corpo §2 e chama `approveIntentSaturation` quando T*=0). Se `document_quality` ainda só persiste D*, nesta task adicionar `applyIntentField` mínimo: upsert linhas SF/AS/R1/eixo no corpo §2 e `approveIntentSaturation`.
2. Só então §7 (fluxo atual D*/UX/AC + `approveAcceptanceContract`).
3. `scan=0` **não** declara entrevista pulada. `--interview` força as duas fases.
4. Sem `question_prompt` → bloqueia rodada.
5. Catálogo §5.4 + stem com tema; parar quando T*=0.
6. Índice provisório inclui eixo / T* / Intenção status.

**Handoff / direct**
- Antes de escrever PLAN ou mutar código: `talos_verify_sprint_file` sem `require` (default `plan_ready`) ou explícito `plan_ready`. Blocked → não gerar.
- Handoff **escreve** `intent_refs` em cada Tnn (só `SF-*`/`R1`).
- Direct lê anti-escopo §2; proibido task só de inferência contra AS/R1.

**Orquestrador**
- G5: scan §7 continua; **zero padrões não pula L2**. Substituir `Ambiguity scan: 0 padrões bloqueantes — entrevista pulada` por: entrevista se `maturity !== plan_ready && !== legacy_sealed` **ou** `--interview` **ou** G5>0. Ecoar `next_action` do `select_next`.
- Texto SELECT_NEXT_SPRINT: sem `--loop` a fila de maturação existe (DEC-048). `--loop` = esteira de execução, não o único jeito de entrevistar.
- Chamadas `talos_verify_sprint_file`: generator/`select` aceitam stub; plan/direct/assert exigem default.
- G11 intacto (já é).

**check-consistency.mjs** (novos tokens, falha se sumirem):

```javascript
// sprint template
'Intenção status', 'Selo da intenção', 'SF-01', 'R1:'
// interview
'Intenção status', 'Eixo do ataque', 'catálogo do inútil' // ou 'nunca perguntar'
// backlog
'quantas sprints' must NOT appear as instruction to ask — guard:
if (/perguntar.*quantas sprints/i.test(backlogSkill) && !/Proibido perguntar.*quantas sprints/.test(backlogSkill))
  errors.push(...)
// orchestrator
if (orchestratorSkill.includes('entrevista pulada'))
  errors.push('orquestrador-regressão: G5 não pode pular L2 com frase entrevista pulada');
if (/INTENT\.md/.test(interviewSkill) && !/proibido/i.test(interviewSkill))
  errors.push(...)
```

Ajuste fino: o guard do generator deve **exigir** a frase `Proibido perguntar` + `quantas sprints`.

- [ ] **Step 1:** Editar skills + guards (skills não têm unit test; o guard é o teste).
- [ ] **Step 2:** `node build/check-consistency.mjs` — PASS (pode falhar versão até Task 8; se o script checa VERSION drift, não bump ainda — só tokens).
- [ ] **Step 3:** Commit — só se pedido.

---

### Task 6: Fixture `sprintDoc` plan_ready + regressão de selo intenção

**Files:**
- Modify: `packages/mcp-server/server.test.js`

Fecha buracos: `planReadySprintDoc` usado por um teste ponta-a-ponta verify `passed` + `maturity==='plan_ready'` com os dois selos; adulterar §2 com status saturada → `FROZEN` equivalente (`tampered` intenção, category a nomear `intencao_congelada` / item `FROZEN_INTENT_TAMPERED`).

```javascript
test('talos_verify_sprint_file: saturada com §2 adulterada → blocked FROZEN_INTENT_TAMPERED', () => {
  // gerar doc plan_ready, trocar uma palavra no corpo §2, manter selo antigo
});
```

Reeditar §2 exige voltar a `rascunho` (espelhar teste de contrato).

- [ ] Rodar: `node --test packages/mcp-server/server.test.js` — PASS completo (lento; obrigatório antes do bump).
- [ ] Commit — só se pedido.

---

### Task 7: Docs de produto mínimas + INDEX

**Files:**
- Modify: `_app-vault/INDEX.md` (já cita spec; acrescentar link do plano)
- Modify: `packages/mcp-server/README.md` (params `require`, `maturity`; `intent_refs` no TC)
- Modify: `CHANGELOG.md` **rascunho da entrada 0.23.0** só na Task 8; aqui uma linha no INDEX:

```markdown
- 2026-09-05 — plano `_app-vault/plans/2026-09-05-intent-saturation.md` (impl saturação §2).
```

Não reescrever DECs 040–048 (já no vault).

- [ ] Commit — só se pedido.

---

### Task 8: Bump 0.23.0 + sync de catálogos

**Files:** `VERSION`, `package.json`, `packages/mcp-server/package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`, via `node build/bump-version.mjs` se o script aceitar o alvo; senão `PATCH_PROCEDURE.md`.

**Não** bump no meio. Ordem:

1. `node --test packages/mcp-server/server.test.js`
2. `node build/check-consistency.mjs` (pode falhar se VERSION ainda 0.22 e skills já falam 0.23 — por isso bump imediatamente antes do consistency final)
3. Bump 0.22.0 → 0.23.0 BREAKING: não pular L2 quando G5=0; `verify_sprint_file` default `plan_ready`; `select_next` matura stub sem `--loop`; PLAN exige `intent_refs` com `require_sprint_file`.
4. `bash build/build-plugins.sh`
5. `node build/check-consistency.mjs`
6. `claude plugin validate ./ --strict` se o binário existir no ambiente; senão anotar no relatório.

CHANGELOG (pt-BR): breaking + migração (`legacy_sealed`; sprints `backlog`/`ready` precisam L2).

- [ ] Commit — só se pedido (mensagem sugerida: `breaking: saturar intenção na §2 antes do plano (0.23.0)`).

---

## Self-review (spec → task)

| D-INT | Task |
|-------|------|
| 1 SDD etapas | 5 |
| 2 casa §2 / sem INTENT.md | 1, 5, 8 |
| 3 sem renumerar §7 | 1 |
| 4 L1/L2 | 5 |
| 5 sem N sprints | 5 + guard |
| 6 G5 ≠ pular L2 | 5 |
| 7 ordem eixo→§2→§7→plano | 5 |
| 8 T1–T7 | 5 (mecânico parcial na 2) |
| 9 sem 3ª skill | 5 |
| 10 usabilidade pack sem artefatos | 5 |
| 11/13/18 PLAN ⊆ §2 + G11 | 4, 5 |
| 12 legacy | 2 |
| 14–15 roteiro/catálogo | 5 |
| 16 stub/plan_ready | 2 |
| 17 select_next | 3 |

Fora de escopo da spec (não planejado): copiar validador Python pack-intent; rastreabilidade v1; ranking MoSCoW interno.

Placeholders: nenhum TBD. Commits bloqueados até o usuário autorizar git.

---

## Ordem de execução

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. 3 depende de 2 (`require:stub` no inspect). 4 pode em paralelo a 5 depois de 2, mas 5 cita `approveIntentSaturation` da 2. 8 por último.
