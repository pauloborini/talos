# Guia — Melhorias incrementais das skills Talos

| Campo | Valor |
|-------|-------|
| **Fonte** | Auditoria das skills canônicas aprovada em 2026-06-22 |
| **Repo** | `talos` |
| **Versão-base observada** | `0.9.1` |
| **Tipo** | Hardening contratual, determinismo e portabilidade |
| **Modo de execução** | Três etapas sequenciais e independentes |
| **Fonte única das skills** | `packages/skills/` + `packages/orchestrator/` |
| **Executor** | `talos-plan-execute` ou implementação bounded equivalente |
| **Validador frio** | `talos-task-validator` |
| **Review opcional** | `talos-slice-review` |

Este documento divide as melhorias em três etapas para execução em chats separados. Cada etapa deve produzir uma slice fechada, validada e revisável antes da próxima. Não executar duas etapas no mesmo chat sem pedido explícito.

## 1. Resultado esperado

Ao final das três etapas:

- cada modo despacha o executor correto sem alterar nomes públicos nem fases MCP existentes;
- ausência de subagente/MCP continua hard-fail, sem degradação inline;
- `state_path` carrega evidência suficiente para validar execução baseada em plano ou contrato direto;
- validator e repair trocam findings estruturados e rastreáveis;
- regras específicas de Flutter deixam de ser tratadas como universais;
- skills documentais atualizam artefatos sem destruir IDs, decisões ou histórico;
- gates usados em runtime dependem apenas de pré-requisitos públicos do produto;
- bundles e catálogos permanecem sincronizados nos cinco hosts.

## 2. Invariantes globais

1. Não alterar os modos públicos: `full`, `direct`, `execute`, `interview-only`.
2. Manter `phase: plan_execute` como fase MCP compartilhada; variar apenas o executor despachado.
3. Manter schema de capabilities v5. Campos novos devem ser aditivos.
4. Manter topologia sibling-only do validator.
5. Não criar fallback inline quando subagente ou MCP estiver indisponível.
6. Não alterar `archive/` nem `raycast/`.
7. Editar fontes canônicas; regenerar mirrors via `bash build/build-plugins.sh`.
8. Não reverter mudanças locais não relacionadas. O início de cada etapa deve registrar `git status --short` e seu boundary.
9. Não fazer bump de versão, commit, push ou release sem pedido explícito.
10. Redução de prosa/tokens só é aceita se preservar capacidade, gates e determinismo.

## 3. Protocolo para cada chat

No início de cada chat:

1. Ler `AGENTS.md`, este guia e os `SKILL.md` citados pela etapa.
2. Inspecionar código/MCP/testes reais antes de editar.
3. Confirmar mudanças locais existentes; nunca reverter trabalho anterior.
4. Executar somente tasks da etapa solicitada.
5. Regenerar todos os hosts quando uma fonte canônica mudar.
6. Rodar os gates da etapa e registrar evidência objetiva.
7. Parar após o relatório da etapa; não iniciar a próxima automaticamente.

Prompt-base para retomada:

```text
Leia AGENTS.md e reports/GUIA_MELHORIAS_INCREMENTAIS_SKILLS_TALOS.md.
Execute somente a ETAPA <1|2|3>, respeitando boundary, invariantes, tasks e gates.
Não faça commit, bump ou release. Ao final, reporte arquivos tocados, checks e riscos residuais.
```

---

## ETAPA 1 — Consistência de roteamento e ownership

**Objetivo:** eliminar contradições entre modos, executores e autoria sem mudar API pública ou schema v5.

**Prioridade:** máxima. Esta etapa desbloqueia as demais.

**Boundary esperado:** orquestrador, executores, interview e testes de roteamento/MCP. Não alterar state schema nem formato de findings nesta etapa.

### Estado atual que motiva a etapa

- `direct_execute` é registrado e validado no preflight, mas o fluxo `direct` manda despachar `plan_execute`.
- `talos-direct-execute` permite self-check local quando subagente não existe, contrariando PREREQ hard-fail.
- `talos-plan-execute` declara que não observa o validator, mas pede `validator outcome` no próprio relatório.
- `interview-only` invoca `talos-prd-interview` sem PRD, enquanto a skill exige PRD existente.
- diagramas resumidos mostram PRD/PLAN como subagentes, contrariando autoria documental no fio principal.

### Tarefas

#### T01. Fechar matriz modo → executor

- **Objetivo:** tornar inequívoco qual agente executa cada modo.
- **Mudança esperada:**
  - `full` → `talos-plan-execute`;
  - `execute` → `talos-plan-execute`;
  - `direct` → `talos-direct-execute`;
  - todos continuam usando `phase: plan_execute` nos gates MCP.
- **Arquivos prováveis:**
  - `packages/orchestrator/skills/talos/SKILL.md`;
  - `packages/mcp-server/server.js` quando houver routing mecanizado;
  - testes MCP/consistência.
- **Não fazer:** criar fase `direct_execute`, renomear modo ou duplicar FSM.
- **Critério de done:** teste prova modo efetivo, executor esperado e fase MCP preservada.

#### T02. Remover degradação do direct executor

- **Objetivo:** alinhar `talos-direct-execute` ao gate PREREQ.
- **Mudança esperada:** indisponibilidade de subagente/MCP retorna `blocked`; nunca self-check como substituto do validator.
- **Arquivos prováveis:** `packages/skills/talos-direct-execute/SKILL.md` e mirrors gerados.
- **Critério de done:** busca contratual não encontra caminho `validator not run` como fallback permitido em pipeline.

#### T03. Corrigir ownership do relatório do executor

- **Objetivo:** impedir que `talos-plan-execute` reporte veredito que não recebe.
- **Mudança esperada:** executor termina em `validator_handoff_required`, reportando tasks/checks/state path; orquestrador reporta validator/veredito final.
- **Arquivos prováveis:** `packages/skills/talos-plan-execute/SKILL.md`, `talos-direct-execute/SKILL.md` e orquestrador.
- **Critério de done:** nenhuma skill executora exige conhecer resultado do validator após handoff.

#### T04. Tornar `interview-only` coerente

- **Objetivo:** manter a CLI existente sem invocar PRD interview com input inválido.
- **Mudança recomendada:** quando input for brainstorm sem PRD, o orquestrador cria draft mínimo pelo template e só então invoca `talos-prd-interview` sobre esse artefato.
- **Não fazer:** transformar `talos-prd-interview` em brainstorming genérico ou pular template.
- **Critério de done:** teste/fixture cobre brainstorm sem PRD e comprova que interview recebe path válido.

#### T05. Alinhar documentação executável

- **Objetivo:** corrigir diagramas, tabela de skills e exemplos para refletirem autoria documental no pai e execução/validação em subagentes.
- **Critério de done:** `rg` não encontra trechos dizendo que PRD/PLAN são obrigatoriamente subagentes nem que `direct` usa `plan_execute`.

### Gates da etapa 1

```bash
node --test packages/mcp-server/server.test.js
node build/check-consistency.mjs
node build/smoke-hosts.mjs
node build/conformance-matrix.mjs
bash build/build-plugins.sh
git diff --check
claude plugin validate ./ --strict
```

### Saída obrigatória do chat 1

- matriz modo→executor antes/depois;
- arquivos tocados;
- testes novos/alterados;
- confirmação de schema v5 intacto;
- resultado cross-host;
- riscos residuais levados para etapa 2.

---

## ETAPA 2 — Evidência determinística, validator e repair

**Pré-condição:** etapa 1 concluída e validada.

**Objetivo:** tornar o `state_path` suficiente para validação fria e fechar o ciclo finding→repair com dados estruturados.

**Boundary esperado:** state schema, plan/direct executors, task validator, findings repair, MCP e testes. Não fazer neutralização completa de framework nesta etapa.

### Estado atual que motiva a etapa

- state file contém arquivos, diff stat e refs, mas não fixa base/head nem materializa obrigações do contrato direto.
- `talos-direct-execute` afirma que obrigações/probes estão no state, porém o schema não possui esses campos.
- validator entrega apenas `severity/file/line/msg`; repair precisa reconstruir causa, recomendação e validação.
- repair pode tocar arquivo adjacente, mas atualização de `files_changed`/`diff_stat` é apenas condicional e vaga.

### Decisão de compatibilidade

Manter todos os campos atuais. Adicionar campos de forma aditiva. Readers antigos continuam aceitando o schema mínimo; writers novos passam a preencher a extensão conforme `executor_skill`.

### Tarefas

#### T01. Estender state schema de forma aditiva

- **Objetivo:** permitir boundary reproduzível e contrato direto validável.
- **Campos recomendados:**
  - `base_sha` e `head_sha`;
  - `contract_kind: plan | direct`;
  - `obligations[]` com ID e evidência esperada;
  - `invariants[]`;
  - `scenario_probes[]` e `risk_probes[]`;
  - `validation_map[]`;
  - `task_evidence[]` com task, arquivos, checks e resultados.
- **Regra:** extensão direct obrigatória quando `executor_skill=talos-direct-execute`; plano continua referenciável por `plan_path`.
- **Não fazer:** remover campos atuais ou alterar capabilities schema v5.

#### T02. Produzir state completo nos dois executores

- **Objetivo:** sincronizar `talos-plan-execute` e `talos-direct-execute`.
- **Mudança esperada:** ambos capturam SHAs, boundary real e evidência; direct persiste compact contract completo.
- **Critério de done:** fixtures dos dois executores passam no mesmo validator de state, com regras condicionais por `contract_kind`.

#### T03. Enriquecer findings do validator

- **Objetivo:** tornar findings diretamente consumíveis por review humana e repair.
- **Shape recomendado:**

```json
{
  "id": "F-001",
  "severity": "P1",
  "file": "path",
  "line": 1,
  "failure_mode": "...",
  "evidence": "...",
  "recommendation": "...",
  "fix_validation": "..."
}
```

- **Compatibilidade:** manter `msg` por uma release, derivado do finding estruturado; marcar depreciação.
- **Gate:** MCP rejeita incoerência entre severidades e veredito.

#### T04. Fechar contrato do repair

- **Objetivo:** reparar somente findings recebidos e atualizar boundary integralmente.
- **Mudança esperada:**
  - input usa IDs e recommendations estruturadas;
  - output contém finding→arquivo→check→status;
  - todo arquivo tocado entra em `files_changed`;
  - `diff_stat` e `head_sha` são recomputados;
  - `repair_complete` falha se P0/P1 alvo não tiver evidência de resolução.
- **Critério de done:** segundo validator lê o mesmo state path atualizado e consegue correlacionar cada repair.

#### T05. Validar boundary real

- **Objetivo:** impedir state stale/incompleto.
- **Mudança esperada:** validator compara `base_sha...head_sha` e conjunto real de arquivos com state; divergência vira finding/boundary violation determinístico.
- **Não fazer:** inferir base pelo nome da branch.

### Gates da etapa 2

```bash
node --test packages/mcp-server/server.test.js
node build/check-consistency.mjs
node build/smoke-hosts.mjs
node build/conformance-matrix.mjs
bash build/test-all.sh
git diff --check
claude plugin validate ./ --strict
```

Casos mínimos adicionais:

1. state legado mínimo ainda é lido quando permitido;
2. direct novo sem obligations bloqueia;
3. SHAs divergentes bloqueiam;
4. P1 com verdict pass é rejeitado;
5. repair que toca arquivo novo atualiza boundary;
6. segundo validator correlaciona finding e repair.

### Saída obrigatória do chat 2

- schema antes/depois;
- política de compatibilidade;
- fixtures plan/direct/repair;
- resultados dos dois ciclos do validator;
- risco de migração residual.

---

## ETAPA 3 — Portabilidade e qualidade documental

**Pré-condição:** etapas 1 e 2 concluídas.

**Objetivo:** eliminar dependências runtime não declaradas, separar regras universais de perfis por stack e endurecer autoria documental sem alterar entry points.

**Boundary esperado:** slice review, task validator, plan handoff, PRD/backlog/interview, templates, helpers portáveis, docs e testes.

### Estado atual que motiva a etapa

- gate obrigatório da slice review usa Python, mas Python não é pré-requisito público do plugin.
- validator chama regras Flutter/GetX de baseline universal.
- plan handoff presume `flutter analyze/test` e `project-rules`.
- backlog update não define preservação de histórico/IDs.
- sprint PRD não define precedência quando múltiplos backlogs contêm a sprint.
- interview hardcoda `AskUserQuestion` e não fecha persistência/revalidação por rodada.

### Tarefas

#### T01. Tornar gate da slice review portátil

- **Objetivo:** usar somente runtime já obrigatório.
- **Mudança recomendada:** migrar validação/classificação para Node ou MCP.
- **Compatibilidade:** manter wrapper Python por uma release, sem torná-lo requisito; fonte canônica passa a ser Node/MCP.
- **Critério de done:** gate roda em Linux/macOS/Windows sem Python.

#### T02. Criar baseline universal + perfis de stack

- **Objetivo:** impedir findings falsos fora de Flutter.
- **Núcleo universal:** segurança, boundary, contrato, erro, concorrência, cleanup, dados e checks declarados no repo.
- **Perfis iniciais:** Flutter/Dart, Node/TypeScript e Python; ativação por manifests/comandos reais.
- **Arquivos principais:** `talos-task-validator`, `talos-plan-handoff`, references compartilhadas e testes.
- **Critério de done:** fixture Node não recebe regra GetX/Flutter; fixture Flutter preserva cobertura atual.

#### T03. Endurecer update do backlog

- **Objetivo:** atualizar sem destruir estado histórico.
- **Regras:** preservar IDs, sprints done, decisões fechadas e itens não relacionados; registrar alterações; validar dependências/ciclos/enums/placeholders.
- **Invariante:** `talos-backlog-generator` permanece explicit-only e fora da cadeia automática.

#### T04. Resolver autoridade do Sprint PRD

- **Objetivo:** selecionar fonte sem heurística silenciosa.
- **Precedência:** path explícito → backlog canônico referenciado → match único.
- **Bloqueio:** múltiplos matches conflitantes sem autoridade definida.
- **Complemento:** preservar IDs D* e registrar anchors de backlog/código ao atualizar PRD.

#### T05. Tornar interview host-agnostic e persistente

- **Objetivo:** usar mecanismo estruturado do host sem hardcode Claude.
- **Mudança esperada:** descriptor/capability para perguntas; após cada rodada, persistir respostas no PRD, reexecutar índice e evitar perguntas repetidas.
- **Regra:** manter rodadas curtas e recomendação ancorada em evidência atual.

#### T06. Compactar somente após conformance

- **Objetivo:** remover duplicação no orquestrador/skills sem perder gates.
- **Método:** centralizar matrizes modo→fase→agente e referências compartilhadas; gerar/validar mirrors.
- **Não fazer:** resumir regras duras em linguagem ambígua ou remover failure paths.

### Gates da etapa 3

```bash
node --test packages/mcp-server/server.test.js
bash build/test-all.sh
node build/check-consistency.mjs
node build/smoke-hosts.mjs
node build/conformance-matrix.mjs
bash build/build-plugins.sh
(cd dist && shasum -a 256 -c SHA256SUMS)
git diff --check
claude plugin validate ./ --strict
```

Casos mínimos adicionais:

1. gate review funciona sem Python;
2. perfis Flutter/Node/Python ativam apenas regras aplicáveis;
3. backlog update preserva sprint done;
4. dependência cíclica no backlog bloqueia;
5. múltiplos backlogs conflitantes bloqueiam PRD generator;
6. entrevista persiste resposta e não repete decisão fechada.

### Saída obrigatória do chat 3

- matriz de portabilidade por host/OS/stack;
- prova de backlog/PRD update não destrutivo;
- comparação de baseline universal vs perfis;
- tamanho/duplicação antes/depois sem perda de gates;
- resultado final de build, instalação e conformance.

---

## 4. Matriz de dependência

| Etapa | Depende de | Motivo |
|-------|------------|--------|
| 1 — Routing/ownership | nenhuma | Corrige quem executa cada fluxo |
| 2 — Evidência/validator/repair | etapa 1 | State precisa refletir executor correto |
| 3 — Portabilidade/documentos | etapas 1 e 2 | Perfis e compactação dependem do contrato estabilizado |

Ordem obrigatória: **Etapa 1 → Etapa 2 → Etapa 3**.

## 5. Checklist final do programa

- [ ] `direct` despacha `talos-direct-execute`.
- [ ] PREREQ nunca degrada para execução/validação inline.
- [ ] `interview-only` entrega PRD válido ao interview.
- [ ] executores não reportam verdict que não receberam.
- [ ] state direct materializa obrigações e probes.
- [ ] boundary contém base/head reproduzíveis.
- [ ] validator emite findings estruturados e coerentes com verdict.
- [ ] repair atualiza o mesmo state path e todo arquivo tocado.
- [ ] gate da review não exige Python.
- [ ] baseline universal não contém regras exclusivas de Flutter.
- [ ] backlog update preserva histórico e IDs.
- [ ] PRD generator resolve autoridade da fonte.
- [ ] perguntas da interview são host-agnostic e persistidas.
- [ ] fontes e mirrors cross-host estão idênticos.
- [ ] build, testes, smoke, conformance, checksums e strict validate verdes.

## 6. Stop conditions

Parar a etapa atual quando:

- a correção exigir breaking change em modo público ou schema v5;
- surgir conflito entre skill, MCP e comportamento já publicado sem caminho compatível;
- um teste demonstrar dependência de host não coberta;
- o boundary precisar invadir etapa futura;
- mudanças locais de outro trabalho sobrepuserem os mesmos arquivos sem reconciliação segura;
- validação determinística não puder ser executada.

Nesses casos, registrar causa, impacto, opções compatíveis e próxima ação; não improvisar widening.
