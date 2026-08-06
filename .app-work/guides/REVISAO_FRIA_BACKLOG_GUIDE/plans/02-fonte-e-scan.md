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
**Status:** PENDENTE

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
- Rascunho vazio: mesma pendência de arquivo vazio já implementada (`blocking_count: 1`).
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

**Impl:** PENDENTE: ainda não executado.

### Auditoria pós-implementação

PENDENTE: ainda não auditado.
