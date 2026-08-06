# Plano 05 - Corte seco 0.16.0: versão, cópias por host e migração

**Pack:** ../GUIDE.md

**Objetivo do plano:** publicar `0.16.0` como BREAKING consciente: versão sincronizada, cópias por host regeneradas, CHANGELOG e docs alinhados, e caminho de migração documentado.

**Resultado esperado:** hoje o repo está em `0.15.2` com templates antigos copiados para oito hosts; depois, `main` está instalável em `0.16.0`, com o contrato novo em todas as cópias e a migração escrita para quem tinha backlog em andamento.

**Cenários servidos:** nenhum diretamente: documenta CN5, fechado no Plano 01.

**Fronteira de entrada:** CN4, VC1.

**Fecha neste plano:** INV5.

**Dependências:** Plano 04.
**Natureza:** OBRIGATÓRIO
**Ativação:** sempre
**Risco:** médio
**Status:** CONCLUÍDO (2026-08-06)

### Direção de implementação

Fecha o release. O ponto de atenção não é a versão em si, é a duplicação: `packages/templates/` é fonte única, mas `hosts/` e `plugins/` carregam cópias **commitadas**, geradas por `build/build-plugins.sh`. Mudança de template que não passa pelo build deixa seis a oito cópias divergentes em silêncio, e o usuário que instala por catálogo recebe o schema antigo enquanto o gate cobra o novo — falha que nenhum teste unitário pega.

A migração segue o precedente do `0.15.0`/D19 registrado no `CLAUDE.md`: artefatos do formato anterior não são suportados e a instrução é iniciar backlog e sprints novos.

### Responsabilidades do plano

| Responsabilidade | Local | Implementação planejada |
|------------------|-------|--------------------------|
| Versão | `VERSION`, `.claude-plugin/plugin.json` | `0.16.0` nos dois, sem drift |
| Cópias por host | `build/build-plugins.sh` | Rodar o build e commitar as cópias regeneradas |
| Registro do BREAKING | `CHANGELOG.md` | Entrada com o que quebra e como migrar |
| Estado do projeto | `CLAUDE.md`, `README.md` | Seção de estado atual e contrato documental |

### Invariantes, valores críticos e regressões

- Preservar `INV5`: cópias por host sincronizadas com a fonte, provado por `AC-05.2.1`.
- Regressão provável: editar `packages/templates/` e esquecer o build. O guard de consistência precisa acusar isso, não confiar em disciplina.
- Regressão provável: subir a versão em um arquivo só. `build/check-consistency.mjs` já falha em drift; o plano não pode contorná-lo.

### Tasks

#### 05.1 Versão e registro do BREAKING

**Entrega:** `0.16.0` publicada com o que quebra escrito.

**Implementação planejada:**
Atualizar `VERSION` e `.claude-plugin/plugin.json` para `0.16.0` (o repo usa versão concreta no manifesto, e o guard falha em drift). Acrescentar entrada no `CHANGELOG.md` nomeando: coluna `Origem` obrigatória na §7.1 e nas decisões do backlog; campo `origin` obrigatório em cada `AC-*`; `premissa` proibida em sprint `Must`/`P0`; `derivado:<path>` resolvido contra o disco; §4 `Discussão` obrigatória; revisão fria interna à skill de backlog. Registrar explicitamente o que **não** entrou, para não gerar expectativa: nenhuma tool MCP nova, nenhum gate novo de orquestrador, nenhum selo de revisão.
Atualizar a seção "Estado atual" do `CLAUDE.md` e o `README.md` com o contrato novo, no mesmo formato usado para o `0.15.0`.
A migração é corte seco: backlog e sprint files anteriores a `0.16.0` não são suportados; a instrução é iniciar backlog novo, e o gate do Plano 01 já emite `next_action: 'migrar_para_0_16'` ao encontrar o schema antigo.

**Responsabilidade e integração:** consumido por quem instala pelo marketplace e pelo catálogo de hosts.

**Comportamentos operacionais aplicáveis:**

- Principal: versão consistente entre `VERSION` e o manifesto.

**Invariantes e regressões:**

- Não descrever o release como retrocompatível: ele não é.

**Critérios de aceite:**

- `AC-05.1.1` `VERSION` e `.claude-plugin/plugin.json` declaram `0.16.0`, e `node build/check-consistency.mjs` passa. Seam: N/A (build); nível: ancorada; golden: N/A; falseia se: atualizar só um dos dois — o guard de drift fica vermelho.
- `AC-05.1.2` O `CHANGELOG.md` nomeia cada quebra de contrato documental e a instrução de migração. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: N/A.

**Evidência esperada:**

- `AC-05.1.1` -> `node build/check-consistency.mjs`.
- `AC-05.1.2` -> leitura do `CHANGELOG.md`.

**Validação focada:**

```bash
node build/check-consistency.mjs
```

#### 05.2 Cópias por host regeneradas

**Entrega:** todas as cópias distribuídas carregam os templates novos.

**Implementação planejada:**
Rodar `bash build/build-plugins.sh` e commitar as cópias regeneradas sob `hosts/` e `plugins/`. São **seis** cópias versionadas de cada template (`git ls-files | grep SPRINT_TEMPLATE.md`): `hosts/opencode`, `hosts/pi`, `hosts/vscode`, `hosts/zcode` e duas dentro de `plugins/talos/` (`templates/` e `packages/templates/`, escritas por `build_host` em `build/build-plugins.sh:91` e `:104`). Os oito hosts suportados não têm oito árvores: Claude Code, Cursor e Codex App consomem `plugins/talos/` pelo marketplace-from-source, e Antigravity não tem árvore própria em `hosts/`. Confirmar que cada cópia de `SPRINT_TEMPLATE.md` e `BACKLOG_MESTRE_TEMPLATE.md` contém a coluna `Origem`, e que `git status` fica limpo depois do build — cópia divergente após rodar o build significa que algum caminho de cópia do script não foi atualizado.

**Responsabilidade e integração:** distribuição por marketplace e por catálogo `hosts/`.

**Comportamentos operacionais aplicáveis:**

- Principal: build idempotente, `git status` limpo após rodar duas vezes.

**Invariantes e regressões:**

- Não editar cópia à mão: a fonte é `packages/templates/`.

**Critérios de aceite:**

- `AC-05.2.1` Depois de `bash build/build-plugins.sh`, toda cópia de `SPRINT_TEMPLATE.md` sob `hosts/` e `plugins/` contém a coluna `Origem`, e rodar o build de novo não produz diff. Seam: N/A (build); nível: ancorada; golden: N/A; falseia se: editar `packages/templates/` sem rodar o build — a busca encontra cópia sem a coluna e o teste fica vermelho.

**Evidência esperada:**

- `AC-05.2.1` -> `grep -rL "| ID | Decisão | Origem |" hosts plugins --include=SPRINT_TEMPLATE.md` sem resultado + `git status --porcelain` vazio após segundo build.

**Validação focada:**

```bash
bash build/build-plugins.sh
grep -rL "Origem" --include=SPRINT_TEMPLATE.md hosts plugins || echo "todas as cópias sincronizadas"
git status --porcelain
```

#### 05.3 Suíte completa

**Entrega:** a trilha inteira verde no runner real.

**Implementação planejada:**
Rodar `bash build/test-all.sh`, que encadeia build + guard, `node --test` do MCP e dos testes de skill, smoke por host, matriz de conformance, smoke de install/uninstall e checksums. Registrar no `Impl` qualquer falha preexistente separada de regressão nova.

**Responsabilidade e integração:** espelha o CI.

**Comportamentos operacionais aplicáveis:**

- Principal: suíte verde.
- Falha preexistente: registrada como baseline, não como regressão — `sem AC: separar baseline de regressão é obrigação de registro do executor, não comportamento de produto`.

**Invariantes e regressões:**

- Não declarar pronto com a suíte vermelha (invariante 6 do `CLAUDE.md`: validar antes de declarar pronto).

**Critérios de aceite:**

- `AC-05.3.1` `bash build/test-all.sh` termina em "OK — suíte completa verde", e `claude plugin validate ./ --strict` passa. Seam: N/A (gate agregado); nível: ancorada; golden: N/A; falseia se: N/A.

**Evidência esperada:**

- `AC-05.3.1` -> saída dos dois comandos.

**Validação focada:**

```bash
bash build/test-all.sh
```

### Gates e smoke

```bash
node build/check-consistency.mjs
bash build/test-all.sh
git diff --check
```

Smoke manual, quando aplicável:

1. Instalar o plugin num host limpo pelo marketplace-from-source.
2. Rodar `talos_ping` e conferir a versão `0.16.0`.
3. Gerar um backlog curto e confirmar que o sprint file nasce com a coluna `Origem`.

### Definition of done

- [x] Implementação segue direção, responsabilidades e fluxo planejados.
- [x] Regras locais respeitadas; o BREAKING está versionado e documentado.
- [x] Critérios de aceite possuem evidência.
- [x] INV5 provada pelo AC que 2.8 declara.
- [x] Cópias por host regeneradas pelo build, não editadas à mão.
- [x] Gates focados e agregados passam, ou o baseline está documentado.
- [x] `Impl` registra implementação real, testes, decisões e pendências.

### Registro de implementação

**Impl:** PRONTO PARA AUDITORIA (2026-08-06) — executor: `execute-guide-plan`, modo PLANO SELECIONADO (plano 05).

**HEAD inicial:** `25464091300fe38ae07e55873b731020327c6ab5` (branch `feat/revisao-fria-backlog-guide`); worktree inicial limpo, exceto `?? .commandcode/` (pré-existente, intocado). HEAD final: mesmo (nenhum commit, conforme regra do executor).

**Fronteira de entrada conferida no código (sem regressão):**
- **CN4** (LEDGER `PROVADO`): `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` existe com o bloco `## Prompt` (mandato com cláusulas); `SKILL.md` passo 14 lê o mandato do disco ("leia do disco … nunca reescreva o mandato de memória"), monta boundary com backlog + cada sprint file ("não apenas a sprint selecionada"), despacha por `talos_capabilities.subagent_dispatch` incondicional em foreground, regateia gates sobre artefatos alterados e repassa relatório ao chamador. Confere com o estado declarado.
- **VC1** (LEDGER `PROVADO`): sink `packages/skills/_shared/scripts/document_quality.mjs:validateSprintFileConformance` consome `origin` (L674-710 p/ AC §7.3; L817-846 p/ decisões §7.1) via `validateOriginToken` com resolução de `derivado:<path>`; `applyDecisionRow` (L1107-1130) monta as 3 colunas. Confere com o estado declarado.

**Tasks:**

| Task | Estado | Implementação real | Arquivos/símbolos |
|------|--------|--------------------|-------------------|
| 05.1 | PASSOU | Bump `0.15.2 → 0.16.0` via `node build/bump-version.mjs 0.16.0` (ferramenta canônica do repo — precedente CHANGELOG 0.15.0/0.15.2): VERSION, `.claude-plugin/plugin.json`, `package.json`, `packages/mcp-server/package.json`, `plugins/talos/.codex-plugin/plugin.json`, README/COMMANDS/MCP README/orchestrator README (`Plugin version`)/AGENTS/CLAUDE. Passos narrativos manuais: `CHANGELOG.md` (entrada `## 0.16.0 - 2026-08-06` nomeando as quebras e o corte seco), `packages/orchestrator/README.md` (`### Novidades v0.16.0` + `Last updated: 2026-08-06`), seção "Estado atual" de `AGENTS.md`/`CLAUDE.md` (0.16.0 corrente, 0.15.0/0.14.x histórico, formato do 0.15.0), `README.md` (seção "Procedência 0.16 e revisão fria do backlog" + dica `v0.16+`). Migração documentada como corte seco (pré-0.16 não suportado; gate já emite `migrar_para_0_16` — `document_quality.mjs:812`) | `VERSION`, `.claude-plugin/plugin.json`, `package.json`, `packages/mcp-server/package.json`, `CHANGELOG.md`, `README.md`, `COMMANDS.md`, `AGENTS.md`, `CLAUDE.md`, `packages/mcp-server/README.md`, `packages/orchestrator/README.md` |
| 05.2 | PASSOU | `bash build/build-plugins.sh` rodado 3× (1× dentro do bump + 2× explícitos); regenera `plugins/talos/` (passo `build_host` codex, L151-156) e `hosts/{opencode,pi,zcode,vscode}/`; build idempotente: 2º build não produz diff (mesmo conjunto de 71 paths modificados antes/depois). As 6 cópias versionadas de `SPRINT_TEMPLATE.md` e `BACKLOG_MESTRE_TEMPLATE.md` contêm `Origem`; nenhuma cópia editada à mão | `hosts/{opencode,pi,zcode,vscode}/**`, `plugins/talos/**` (cópias geradas); `dist/**` + `SHA256SUMS` regenerados (gitignored) |
| 05.3 | PASSOU | `bash build/test-all.sh` — "OK — suíte completa verde" (exit 0): build+guard, `node --test` `server.test.js` 287/287, `classify-findings`+`etapa3`+`fixtures-s9` 37/37, `smoke-hosts` ok, `conformance-matrix` ok (6 hosts × 10), `smoke-install` ok, checksums 6/6 OK. `claude plugin validate ./ --strict` → "✔ Validation passed" | — |

**Relação AC/invariante → resultado → evidência:**

| AC/INV | Resultado | Evidência |
|--------|-----------|-----------|
| AC-05.1.1 (versão sincronizada + guard) | PASSOU | `node build/check-consistency.mjs` ok (4 execuções: bump, 2 builds, explícita); red observado por mutação controlada (`plugin.json` → 0.15.2 ⇒ "Drift de versão: .claude-plugin/plugin.json (0.15.2) != VERSION (0.16.0)"; revertido e re-verificado verde) |
| AC-05.1.2 (CHANGELOG nomeia quebras + migração) | PASSOU | Leitura do `CHANGELOG.md` `## 0.16.0 - 2026-08-06`: 7 quebras nomeadas (`Origem` §7.1/backlog, `origin` §7.3, `premissa` Must/P0, `derivado:<path>` vs disco, §4 `Discussão`, entrevista estruturada, revisão fria), "não entrou" (sem tool MCP nova, sem gate de orquestrador, sem selo de revisão) e migração corte seco |
| AC-05.2.1 / INV5 (cópias sincronizadas, build idempotente) | PASSOU | `grep -rL "| ID | Decisão | Origem |" hosts plugins --include=SPRINT_TEMPLATE.md` sem resultado; idem `--include=BACKLOG_MESTRE_TEMPLATE.md`; 2º build sem diff novo em `git status --porcelain`; red observado: pré-build as 6 cópias estavam sem `Origem` (grep acusou as 6 — exatamente o falsificador "editar template sem rodar o build") |
| AC-05.3.1 (suíte completa verde + plugin validate) | PASSOU | `bash build/test-all.sh` → "OK — suíte completa verde" (exit 0); `claude plugin validate ./ --strict` → "✔ Validation passed" |

**Falsificação dos aceites materiais:**

| AC | falseia se (declarado) | Falsificador real | Red observado | Resultado |
|----|------------------------|-------------------|---------------|-----------|
| AC-05.1.1 | atualizar só um dos dois — guard de drift fica vermelho | guard `check-consistency.mjs` compara `VERSION` × manifests | Sim, por mutação: `.claude-plugin/plugin.json` → 0.15.2 ⇒ guard `FALHOU` com a linha de drift nomeada; revertido, guard verde | PASSOU |
| AC-05.2.1 | editar `packages/templates/` sem rodar o build — busca encontra cópia sem a coluna | `grep -rL "| ID | Decisão | Origem |" hosts plugins` | Sim, por estado real: antes do build as 6 cópias versionadas sem a coluna (grep acusou as 6); pós-build zero resultados | PASSOU |
| AC-05.3.1 | N/A (declarado no plano) | — | Red ambiental observado no baseline: 287 testes, 22 falhas ENOENT `HANDOFF_TEMPLATE.md`; após restauração do fixture, 287/287 | PASSOU |

**Valores críticos consumidos:** nenhum VC fecha no Plano 05 (2.6: VC1→01, VC2/VC3→04); INV5 é invariante provada pela AC-05.2.1. Fronteira VC1 re-conferida no sink (ver Fronteira de entrada). Sem leitor antigo novo no caminho.

**Provas executáveis de cenário (2.1):** plano declara "Cenários servidos: nenhum diretamente — documenta CN5, fechado no Plano 01". N/A: nenhum cenário completa neste plano; CN5 já tem prova executável do Plano 01 (`etapa3::schema_pre_016_rejeitado`), e a migração documentada aponta o mesmo `next_action`.

**Cutover de legado (2.7):** nenhuma linha com "Morre em: Plano 05". N/A.

**Gates:**

| Gate | Resultado |
|------|-----------|
| `node build/check-consistency.mjs` | ok (exit 0, 4 execuções) |
| `bash build/build-plugins.sh` | ok (3 execuções); idempotente (2º build sem diff novo) |
| `bash build/test-all.sh` | "OK — suíte completa verde" (exit 0) |
| `claude plugin validate ./ --strict` | "✔ Validation passed" |
| `git diff --check` | exit 0 |
| `grep -rL "| ID | Decisão | Origem |" hosts plugins --include=SPRINT_TEMPLATE.md` | sem resultado |

**Smoke manual (release em host limpo, quando aplicável):** NÃO EXECUTADO — N/A com motivo: instalação real via marketplace-from-source exigiria mutar o ambiente do usuário (`claude plugin marketplace add`/install) e depende do publish na main; o precedente do 0.15.0 (CHANGELOG) deixa o smoke de release para humano/Plano F. Cobertura automatizada equivalente verde: `smoke-hosts` (boot + detecção + capabilities + ping por host), gates e cópias com `Origem` verificadas.

**Desvios técnicos:**

1. Bump via `node build/bump-version.mjs 0.16.0` (toca VERSION + todos os manifests/docs de versão e roda build + guard) em vez de editar só `VERSION`/`.claude-plugin/plugin.json` à mão: o guard `check-consistency.mjs` exige os demais arquivos (package.json, mcp-server/package.json, README/COMMANDS/MCP README/orchestrator README/AGENTS/CLAUDE) e o script é o caminho canônico do repo (CHANGELOG 0.15.0/0.15.2). Mesma entrega do plano, menor risco de drift.
2. Restauração do fixture ambiental `<repo-root>/.talos/memory/HANDOFF_TEMPLATE.md` (gitignored — zero diff tracked), reconstruído a partir da estrutura exigida por `emitMemoryHandoff` (`server.js` L2487-2530: linhas `sprint_id`/`data`/`status_pos_validator`/`origem`, seções `## Regras do filtro` / `## Candidatos (0–3)` / `## Exemplos`) e do fixture real `packages/skills/talos-memory-promote/fixtures/handoff_valid.md`. Necessário para a AC-05.3.1 (suíte verde) — ver Lacunas.

**Lacunas descobertas:**

1. `packages/mcp-server/server.test.js::writeHandoffTemplateFixture` (L2120-2128) depende de `<repo-root>/.talos/memory/HANDOFF_TEMPLATE.md` — arquivo gitignored e nunca versionado (`git log --all -- .talos` vazio). Removido junto com o `.talos/` (pré-requisito do pack: "ciclo anterior concluído e removido"), deixou 22 testes ENOENT. Remediação ambiental feita neste plano (arquivo restaurado no workspace); a fragilidade estrutural — teste dependente de arquivo fora do repo, sem `.github/` no repo para CI acusar — fica como fato para o auditor. Fato observado, sem veredito.
2. Cópias de `SKILL.md`/`references/`/templates em `hosts/`/`plugins/` defasadas desde os planos 01-04 (incluindo o mandato `COLD_BACKLOG_REVIEW_PROMPT.md` novo) — obrigação deste plano (INV5), resolvida pelo build; sem ação residual.

**Baselines e pendências:**

- Baseline capturado em HEAD `25464091`: `node --test server.test.js` → 265 pass / 22 fail (ENOENT `HANDOFF_TEMPLATE.md`) — dívida pré-existente (pré-plano 01), não regressão deste plano.
- P3 herdado (22 ENOENT) resolvido neste plano como remediação ambiental, porque a AC-05.3.1 exige suíte verde e `test-all.sh` aborta em suíte vermelha.
- `?? .commandcode/` pré-existente, intocado.
- Smoke manual de host real: pendência declarada (N/A, ver acima).

**Delta de ledger proposto:**

| Obrigação | Estado atual | Estado proposto | Onde ficou |
|-----------|--------------|-----------------|------------|
| INV5 | pendente | PROVADO | Cópias `hosts/`/`plugins/` regeneradas pelo build com `Origem` (6 cópias de cada template); `grep -rL` sem resultado; 2º build sem diff; red observado (6 cópias stale pré-build). Prova: AC-05.2.1 |

Nenhuma regressão de entrada encontrada: CN4 e VC1 conferidos no código no estado que o LEDGER declara.

**Histórico**

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Execução do Plano 05 (corte seco 0.16.0): bump via `bump-version.mjs` + builds + CHANGELOG/docs; fronteira CN4/VC1 conferida no código; dívida ENOENT (22 falhas) diagnosticada e remediada no workspace (fixture `HANDOFF_TEMPLATE.md` restaurado, gitignored); red da AC-05.1.1 observado por mutação controlada; INV5 provada (6 cópias com `Origem`, build idempotente); gates verdes (check-consistency, test-all "OK — suíte completa verde", `claude plugin validate ./ --strict` passed, `git diff --check`); smoke de host real declarado N/A; delta de ledger proposto: INV5 → PROVADO | `node build/bump-version.mjs 0.16.0`, `bash build/build-plugins.sh` ×3, `bash build/test-all.sh`, `node --test` (287/287 + 37/37), `claude plugin validate`, `git diff --check`, `grep -rL` das cópias |

### Auditoria pós-implementação

**Veredito: CONCLUÍDO (2026-08-06).** 3 tasks, 4 ACs (1 com falsificador por mutação re-executado, 2 com red por estado real/leitura, 1 gate agregado por saída de comando), 1 invariante (INV5 — única dívida `Fecha neste plano`), fronteira CN4/VC1 reconferida no código, 6 gates confrontados. Nenhum finding P0/P1/P2 em aberto; 2 observações P3 registradas. Nenhuma correção necessária no recorte.

#### Fase A0 — dívida, fronteira e delta

- **Dívida vencida (`Fecha neste plano`):** INV5 — verificada e promovida abaixo (AC-05.2.1).
- **Fronteira de entrada (CN4, VC1) no código, sem regressão:** CN4 — `SKILL.md` passo 14 lê `references/COLD_BACKLOG_REVIEW_PROMPT.md` do disco ("substitua apenas" os 4 parâmetros, "nunca reescreva o mandato de memória"), boundary = backlog mestre + cada sprint file escrito ("não apenas a sprint selecionada"), dispatch por `talos_capabilities.subagent_dispatch` incondicional em foreground, regate de `talos_verify_sprint_file`/`talos_verify_backlog_index` sobre artefatos alterados, relatório ao chamador sem materializar em arquivo; arquivo do mandato presente (6252 bytes). VC1 — sink `document_quality.mjs:validateSprintFileConformance` consome `origin` (L674-710 ACs §7.3, L817-846 decisões §7.1) via `validateOriginToken` com resolução de `derivado:<path>`; `applyDecisionRow` (L1116+) monta as 3 colunas. Confere com o estado que o LEDGER declara.
- **Delta contra o já provado:** o diff do recorte toca apenas `VERSION`, manifests de versão (`package.json`, `.claude-plugin/plugin.json`, `packages/mcp-server/package.json`, `plugins/talos/.codex-plugin/plugin.json`, `hosts/*/VERSION`/manifests), docs (`CHANGELOG.md`, `README.md`, `COMMANDS.md`, `AGENTS.md`, `CLAUDE.md`, `packages/mcp-server/README.md`, `packages/orchestrator/README.md`) e as cópias geradas em `hosts/**`/`plugins/**`. Nenhum arquivo de código produtivo da fonte alterado (`server.js`, `document_quality.mjs`, `packages/templates/`, `SKILL.md` fora do diff) — nenhuma obrigação PROVADO dos Planos 01-04 tocada com efeito observável. Cópias geradas verificadas byte-a-byte idênticas às fontes (`diff -q` em 25 cópias de SKILL.md/document_quality.mjs/server.js + 12 de templates).

#### Cenários traçados neste recorte

| Cenário | Trace no código real | Fronteira alcançada | Prova executável |
|---------|----------------------|---------------------|------------------|
| CN4 (fronteira) | `SKILL.md` passo 14 re-lido integralmente: leitura do mandato do disco, boundary completo, dispatch incondicional, regate, relatório ao chamador; mandato presente | confere com o trace do Plano 04; nenhum segmento alterado pelo recorte (SKILL.md fora do diff) | `etapa3::mandato revisão...` + `::skill_backlog_*` verdes na suíte re-rodada (37/37) |
| VC1 (fronteira) | `document_quality.mjs:validateSprintFileConformance` re-lido nos dois pontos de consumo (L674-710, L817-846) + `applyDecisionRow` (L1116-1130) | confere com o LEDGER; `document_quality.mjs` fora do diff do recorte | `etapa3::procedência:...` + `::entrevista:...` verdes (37/37) |

Nenhum cenário de 2.1 completa neste plano (plano declara "Cenários servidos: nenhum diretamente — documenta CN5"); CN5 já tem prova executável do Plano 01 (`etapa3::schema_pre_016_rejeitado`) e a migração documentada aponta o mesmo `next_action: 'migrar_para_0_16'` (`document_quality.mjs:812` conferido).

#### Consumo no sink e mutadores

Nenhum VC fecha neste plano; nenhum mutador de §0 tocado (fonte de `document_quality.mjs`/`server.js` fora do diff — só cópias geradas regeneradas, idênticas à fonte). A superfície declarativa de versão (oráculo A6) é consistente: `VERSION` = `0.16.0` em 11 pontos verificados (VERSION, `.claude-plugin/plugin.json`, `package.json`, `packages/mcp-server/package.json`, `plugins/talos/VERSION`, `plugins/talos/.codex-plugin/plugin.json`, `hosts/{opencode,pi,vscode,zcode}` VERSION/manifestos); runtime lê do disco (`server.js:readVersionInfo`), nada hardcoded; `check-consistency.mjs` falha em drift (mutação re-executada abaixo).

#### Falsificação de aceite material (re-executada nesta auditoria)

| AC | `falseia se` declarado | Confronto nesta auditoria | Red |
|----|------------------------|---------------------------|-----|
| AC-05.1.1 | atualizar só um dos dois — guard de drift fica vermelho | **Re-executado por mutação:** `.claude-plugin/plugin.json` → 0.15.2 ⇒ `check-consistency` `FALHOU` exit 3 com `Drift de versão: .claude-plugin/plugin.json (0.15.2) != VERSION (0.16.0)`; revertido e re-verificado verde (exit 0) | VERMELHO por mutação, revertido |
| AC-05.1.2 | N/A (documental) | Leitura do `CHANGELOG.md` `## 0.16.0 - 2026-08-06`: 7 quebras nomeadas (Origem §7.1/backlog, origin §7.3, premissa Must/P0, derivado:<path>, §4 Discussão, entrevista estruturada, revisão fria) + "Não entrou" (sem tool MCP nova, sem gate de orquestrador, sem selo de revisão) + Migração corte seco (`migrar_para_0_16`); AGENTS/CLAUDE "Estado atual" e README/orchestrator README consistentes com o contrato 0.16 | N/A (documental, conforme plano) |
| AC-05.2.1 / INV5 | editar `packages/templates/` sem rodar o build — busca encontra cópia sem a coluna | **Re-executado:** `grep -rL "| ID | Decisão | Origem |" hosts plugins --include=SPRINT_TEMPLATE.md` e idem BACKLOG sem resultado; 6 cópias versionadas de cada template byte-idênticas à fonte (`diff -q` OK); build re-rodado nesta auditoria — `git status --porcelain` idêntico antes/depois (73 entradas), zero diff novo (idempotente) | Red por estado real: o próprio diff do recorte mostra as cópias de `hosts/`/`plugins/` stale em HEAD (auditoria do Plano 04 registrou como P3 "cópias defasadas") e agora regeneradas |
| AC-05.3.1 | N/A (gate agregado) | `bash build/test-all.sh` re-rodado: "OK — suíte completa verde" (exit 0) — `server.test.js` 287/287 (re-rodado isolado), etapa3+classify+fixtures-s9 37/37, smoke-hosts ok, conformance-matrix ok (6 hosts × 10), smoke-install ok, checksums 6/6 OK; `claude plugin validate ./ --strict` → "✔ Validation passed" (exit 0) | Red ambiental no baseline (22 ENOENT `HANDOFF_TEMPLATE.md`), pré-existente e documentado abaixo |

Nenhum proxy: ACs de build/documental têm lastro em saída real de comando e leitura de arquivos; AC-05.3.1 é gate agregado executado nesta auditoria.

#### Invariantes (INV5)

INV5 — cópias por host sincronizadas com `packages/templates/`: 6 cópias versionadas de `SPRINT_TEMPLATE.md` e `BACKLOG_MESTRE_TEMPLATE.md` (hosts/opencode, hosts/pi, hosts/vscode, hosts/zcode, plugins/talos/packages/templates, plugins/talos/templates) byte-idênticas à fonte com a coluna `Origem`; build idempotente (2ª execução nesta auditoria sem diff novo); `grep -rL` sem resultado. Provada por AC-05.2.1.

#### Remediação ambiental do fixture (avaliação do auditor)

A restauração de `<repo>/.talos/memory/HANDOFF_TEMPLATE.md` (gitignored, zero diff tracked; `git log --all -- .talos` vazio — nunca versionado) é remediação legítima, não mascaramento de regressão: (1) a dívida é pré-existente — auditoria do Plano 04 confirmou o baseline por stash (265 pass/22 fail idênticos a HEAD pré-recorte, todos `ENOENT` em `copyfile` de `writeHandoffTemplateFixture`); (2) o arquivo restaurado é estruturalmente compatível com `emitMemoryHandoff` (`server.js` L2487-2530 exige a tabela de metadados `sprint_id`/`data`/`status_pos_validator`/`origem` e as seções `## Regras do filtro` / `## Candidatos (0–3)` / `## Exemplos` — todas presentes); (3) os 22 testes exercitam comportamento real (asserções sobre backlog/sprint file/handoff emitidos), não passam vacuamente; (4) `test-all.sh` aborta em suíte vermelha (`set -euo pipefail`), logo o verde atual reflete o estado real com o fixture presente. A fragilidade estrutural (suíte dependente de arquivo fora do repo, sem CI no repo) permanece como fato registrado — dívida de ambiente, não deste plano.

#### Comportamentos operacionais (tasks) vs AC

| Comportamento | Cobertura |
|---------------|-----------|
| Versão consistente entre `VERSION` e o manifesto | AC-05.1.1 (guard) |
| Build idempotente, `git status` limpo após rodar duas vezes | AC-05.2.1 |
| Não editar cópia à mão (fonte é `packages/templates/`) | AC-05.2.1 + verificação byte-a-byte das 20 cópias de código e 12 de templates nesta auditoria |
| Suíte verde | AC-05.3.1 |
| Falha preexistente registrada como baseline | `sem AC: separar baseline de regressão é obrigação de registro do executor` (declarado no plano) — cumprida no Impl (baseline 22 ENOENT) |
| Não descrever o release como retrocompatível | AC-05.1.2 (CHANGELOG/README/AGENTS/CLAUDE declaram corte seco) |
| Não declarar pronto com a suíte vermelha (invariante 6 do CLAUDE.md) | AC-05.3.1 verde |

#### Gates

| Gate | Resultado nesta auditoria |
|------|---------------------------|
| `node build/check-consistency.mjs` | ok (exit 0) ×3 (incluindo após a mutação revertida) |
| `bash build/build-plugins.sh` | ok (exit 0); idempotente — `git status` idêntico antes/depois (73 entradas) |
| `bash build/test-all.sh` | "OK — suíte completa verde" (exit 0): 287/287 + 37/37 + smoke-hosts + conformance 6×10 + smoke-install + checksums 6/6 |
| `claude plugin validate ./ --strict` | "✔ Validation passed" (exit 0) |
| `git diff --check` | limpo |
| `grep -rL "| ID | Decisão | Origem |" hosts plugins --include=SPRINT_TEMPLATE.md` (e BACKLOG) | sem resultado |

Smoke manual de host limpo (instalar pelo marketplace-from-source, `talos_ping` → 0.16.0): NÃO EXECUTADO — N/A aceito com motivo. O plano condiciona o smoke a "quando aplicável"; instalação real mutaria o ambiente do usuário e depende do publish na `main`; precedente 0.15.0/0.15.2 (CHANGELOG) deixa o smoke de release para humano/Plano F; cobertura automatizada equivalente verde (smoke-hosts com boot+ping por host, smoke-install em tmpdir, conformance-matrix, checksums, `claude plugin validate`).

#### Promoção de ledger

| Obrigação | Estado | Evidência |
|-----------|--------|-----------|
| INV5 | PROVADO | 6 cópias versionadas de cada template com coluna `Origem`, byte-idênticas à fonte; `grep -rL` sem resultado (SPRINT e BACKLOG); build idempotente re-verificado (2º build sem diff novo nesta auditoria); red por estado real (cópias stale em HEAD, regeneradas); falsificador de AC-05.2.1 ("editar template sem rodar o build") re-executado na prática — o estado pré-build em HEAD é exatamente a mutação; prova: AC-05.2.1 |

Nenhuma linha rebaixada: fronteira CN4/VC1 conferida no código no estado que o LEDGER declara (`PROVADO`) e nenhuma obrigação de plano anterior quebrada pelo recorte (delta sem toque em código produtivo da fonte).

#### Observações (P3, não bloqueiam)

1. Suíte `server.test.js` depende de `<repo>/.talos/memory/HANDOFF_TEMPLATE.md` — arquivo gitignored e nunca versionado (fragilidade estrutural pré-existente, sem CI no repo para acusar). Remediação ambiental feita pelo executor (arquivo restaurado no workspace) é legítima e não mascara regressão deste plano; a fragilidade fica como dívida de ambiente para o Plano F/orquestrador decidir (ex.: versionar o template ou derivá-lo de fixture do repo).
2. Smoke manual de instalação em host limpo não executado — N/A com motivo (mutação de ambiente do usuário + dependência de publish; precedente 0.15.0/0.15.2); cobertura automatizada equivalente verde (ver Gates).

**Promovido a CONCLUÍDO (2026-08-06) nesta auditoria; Status espelhado no §4 do GUIDE.md.**

**Histórico**

| Data | Evento | Fonte/evidência |
|------|--------|-----------------|
| 2026-08-06 | Auditoria fria do Plano 05: A0 (INV5 dívida; fronteira CN4/VC1 reconferida no código; delta sem toque em código produtivo da fonte); falsificadores re-executados (mutação do guard de drift ⇒ `FALHOU` exit 3 com a linha nomeada, revertido; `grep -rL` das 12 cópias sem resultado; build idempotente — status idêntico antes/depois); gates re-rodados (check-consistency ×3, test-all "OK — suíte completa verde" 287/287 + 37/37 + smoke-hosts + conformance 6×10 + smoke-install + checksums 6/6, `claude plugin validate ./ --strict` passed, `git diff --check` limpo); versão 0.16.0 consistente em 11 pontos; remediação do fixture `HANDOFF_TEMPLATE.md` avaliada como legítima (dívida pré-existente, estrutura compatível com `emitMemoryHandoff`, testes não-vacuosos); smoke de host real aceito N/A com motivo; LEDGER: INV5 → PROVADO | `node build/check-consistency.mjs`, `bash build/build-plugins.sh`, `bash build/test-all.sh`, `node --test packages/mcp-server/server.test.js` (287/287), `claude plugin validate ./ --strict`, `git diff --check`, `grep -rL`, `diff -q` das cópias, leitura de SKILL.md passo 14, mandato, CHANGELOG e docs |
