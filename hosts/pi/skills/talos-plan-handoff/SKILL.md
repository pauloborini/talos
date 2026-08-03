---
name: talos-plan-handoff
description: Skill `talos-plan-handoff`. Produz um handoff executável da família Talos, fechando prefixo, modo de execução e gates no próprio artefato para consumo por `talos-plan-execute` e `talos-slice-review`.
---

# Talos Plan Handoff

Use esta skill quando o usuário pedir um plano executável da cadeia `talos-*`.

O artefato segue `PLAN_TEMPLATE.md` e `BOUNDARY_SPRINT_PLAN.md` — **localize ambos em `<raiz-do-plugin>/packages/templates/`**. O plano **não** depende de memória do chat para prefixo, modo ou executor.

Fontes obrigatórias do PLAN — duas combinações válidas, conforme `source_mode`:

- **`sprint-bound`** (sprint file com backlog real): sprint file vivo com contrato §7 (preferência `aprovado` + selo íntegro) + `eval_manifest`/`policy_manifest` + código real do repo no boundary da sprint.
- **`standalone`** (sprint file declara `Backlog mestre: Não aplicável (standalone)`): sprint file com §7 (D*, cenários UX, aceite binário) suficiente para derivar Eval/Policy + código real do repo no boundary da entrega.

Sem sprint file com contrato §7 e código real, não gerar plano executável. Backlog mestre é índice/status; não substitui o sprint file. Não há PRD na cadeia — aceite/produto mora na §7.

Um plano `standalone` só é consumível pelo modo `execute` do orquestrador (lê plano pronto, sem gate `SPRINT_FILE` rígido de backlog, TC sem `require_sprint_file`). Os modos `full`/`direct` exigem `require_sprint_file=true` na entrada — um plano `standalone` reentrando por `full` será re-gateado e bloqueado por design ("autoria é livre, execução é gateada"). Se um plano `standalone` precisar virar sprint formal com backlog, o caminho é vincular backlog e reescrever o plano como `sprint-bound`, não forçar passagem por `full`.

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Talos.
* Resolver `PLAN_TEMPLATE.md` e `BOUNDARY_SPRINT_PLAN.md` a partir da raiz do plugin/bundle, antes de olhar qualquer arquivo do repo consumidor.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PLAN_TEMPLATE.md` ou `packages/templates/BOUNDARY_SPRINT_PLAN.md` não existir, abortar com erro claro: `Template canônico ausente: <nome-do-template>`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

## State persistence

Use `talos_run_state` como fonte primária de estado da run. Não leia/escreva estado por file IO direto. Se o MCP estiver indisponível, avise que o gate não pode ser comprovado e aborte a fase em vez de seguir por fallback narrativo.

## Plan path resolution

Os paths são fornecidos pelo adapter de host: consultar `talos_capabilities` e ler `plan_paths` (`write` + `read_order`). Referência canônica: `packages/orchestrator/references/host-adapters.md`. Valores atuais (iguais em todo host):

Escrita de novos planos: somente `.talos/plans/`.

Leitura/migração por 1 release (ordem de `plan_paths.read_order`):

1. `.talos/plans/`
2. `.cursor/plans/` com warning de depreciação
3. `.codex/plans/` com warning de depreciação

Se um plano legado for lido, o próximo artefato gerado deve ser salvo em `.talos/plans/`.

## Cadeia de execução

```text
talos-plan-handoff → talos-plan-execute → talos-task-validator → talos-slice-review (opcional via `--review`; obrigatória quando `critical_review.required:true` — G8)
```

No workflow `full`, `talos-plan-handoff` é autoria documental do agente principal/orquestrador. O primeiro sub-agent da cadeia só nasce em `talos-plan-execute`.

---

## Fluxo obrigatório

1. **Classificação da tarefa:** feature, ui, contract, navigation, shared, security, diagnostic, refactoring, testing. Leia instruções reais aplicáveis do repo; `project-rules/` é apenas um formato possível, nunca requisito universal.
2. **Validar fontes documentais e detectar `source_mode`:**
   - Ler o **sprint file**. Detecção é mecânica, por campo explícito nos metadados — nunca por inferência de prosa:
     - Campo `Backlog mestre` aponta para um path/backlog real → `source_mode: sprint-bound`.
     - Campo `Backlog mestre` com valor literal `Não aplicável (standalone)` → `source_mode: standalone`.
     - Nenhum dos dois padrões reconhecível → bloquear: sprint file precisa declarar explicitamente um dos dois.
   - Chamar `talos_verify_sprint_file`; se sprint file estiver ausente, inválido, sem contrato §7, sem `eval_manifest`/`policy_manifest` (quando exigido) ou com gate bloqueado/indisponível, bloquear com ação corretiva. Preferir `Contrato status: aprovado` com selo íntegro; se `draft` com gaps bloqueantes, encaminhar a `talos-sprint-interview`.
   - Em `standalone`: validar que a §7 tem D*, cenários UX e aceite binário observáveis suficientes para derivar Eval/Policy. §7 insuficiente bloqueia com ação corretiva.
3. **Grounding no código:** confirme padrões, contratos, manifests e comandos reais antes de inferir. Resolva baseline/perfis via `../_shared/references/stack-profiles.md` + `detectStackProfiles(project_root, declared_commands, boundary_paths)`; não presuma Flutter nem aplique perfil fora do package correspondente.
4. **Decisões estáveis:** sanar bloqueios com perguntas ao usuário; registrar no plano (não recopiar tabela D* da §7 — referenciar `Sprint §7.1`; não copiar YAML integral — referenciar `Sprint §9/§10` e IDs).
5. **Escrita:** artefato markdown no path canônico `.talos/plans/`. Teto orientativo ~250–350 linhas (até ~450 com slices).

---

## Metadados obrigatórios (topo do artefato)

```md
## Metadados de execução
- Plan prefix: `talos`
- Source mode: `sprint-bound` | `standalone`
- Execution mode: `sequencial (T01→TN)` | `orchestrated-per-slice`
- Executor skill: `talos-plan-execute`
- Internal validator: `talos-task-validator`
- External review: `talos-slice-review` (optional)
```

Regras:

- `Plan prefix` é sempre `talos`.
- `Source mode` reflete a detecção do passo 2 do fluxo obrigatório. `standalone` é destinado a entrar em execução pelo modo `execute` do orquestrador — não pelo pipeline `full`/`direct`.
- Se o modo não estiver decidido, o plano **não** está pronto para execução.
- Em ambos os modos, o topo do plano deve linkar `**Sprint file**` e declarar `Eval source: Sprint §7 + §9` (aceite/produto na §7; eval claims na §9). Em `standalone` sem §9 útil, declarar `Eval source: Sprint §7` e derivar checklist da §7.3.
- Deixe explícito por que o modo escolhido é adequado, checks por task vs fechamento de slice e quando parar em `blocked`.

---

## Estrutura do plano (seções 1 a 8)

### 1. Tradução executiva

- O que será implementado e o resultado observável técnico.
- Padrão de referência no monorepo e tabela **referência vs esta entrega** (ligar a `Sprint §7.1` D*, não recopiar a tabela).
- Link ao sprint file: `Sprint §2` objetivo/escopo, `Sprint §7` contrato.

### 2. Invariantes de execução (derivados do sprint)

- Invariantes técnicos inegociáveis (ex.: sem refetch ao filtrar).
- Em `sprint-bound`: invariantes/gates derivados de `Sprint §9 eval_manifest` e `Sprint §10 policy_manifest`, ancorados em `Sprint §7.1` D*. Referenciar IDs: `Sprint §7.1 D12`, `Sprint §9 EVAL-001`, `Sprint §10 policy_manifest` — não colar a tabela D* nem YAML inteiro.
- Em `standalone`: invariantes/gates derivados direto de `Sprint §7` (+ §9 se presente). Referenciar `Sprint §7.1 D12`, `Sprint §7.3` — sem exigir backlog.

### 3. Pitfalls

- `anti-padrão observado` → `padrão canônico correto` (ancorado no repo).

### 4. Estado na abertura da sprint (pré-implementação)

- 3–6 bullets sobre o código hoje (comportamento/ausência — não inventário global de arquivos).
- Se já implementado: tratar como checklist de verificação.

### 5. Tarefas de execução

Tarefas `#### T01.` … `#### TNN.` com schema de `BOUNDARY_SPRINT_PLAN.md` canônico empacotado:

- **Objetivo**
- **Referência** (módulo/padrão no monorepo — evite listas longas de paths; o executor descobre no repo)
- **Pré-condições**
- **Mudança esperada**
- **Invariantes preservados**
- **Eval/Policy** (`Sprint §9 EVAL-*` / `Sprint §10 policy` relevante; em `standalone` também `Sprint §7.3`)
- **Não mudar** / **Não fazer**
- **Dependências**
- **Riscos** (se não óbvio)
- **Critério de done**
- **Validação local** (comando com path do package)
- **Quality gates** (opcional em tasks críticas)
- **Casos mínimos** (somente em tasks de teste)

**Regra de minimalismo estrutural (autoria de task):** ao redigir `Mudança esperada`, prefira a forma mínima viável que cumpre o `Critério de done` — reusar módulo/símbolo já existente no repo antes de introduzir nova abstração; usar stdlib/feature nativa antes de dependência nova; evitar indireção, factory, wrapper, camada ou opção de config não exigida por contrato §7/invariante. A regra recai **somente** sobre abstração/indireção/arquivo/dependência nova. **Nunca** reduz: validação de trust-boundary, error-handling, data-loss, invariantes §2, cobertura de cenário/teste e negative paths. Em dúvida entre enxuto e seguro, escolha seguro.

Toda task que prova claim ou toca boundary sensível deve trazer `Eval/Policy`. Última task típica: **Validação final** (checks reais da stack ativa e passos manuais alinhados a **Sprint §7.2–§7.3**; em `sprint-bound` também a `Sprint §9`). Flutter usa `flutter analyze/test`; Node e Python usam somente scripts/ferramentas declarados no repo/plano.

### 6. Contratos técnicos (só ambiguidade §7 → código)

- Assinaturas, shapes e mapeamentos onde o Sprint §7 não fecha implementação.

### 7. Slices (somente se `execution_mode: orchestrated-per-slice`)

- Tabela: slice, tasks, objetivo, boundary de diff esperado.

### 8. Validação e checklist (validator)

- Critérios derivados de **Sprint §7.3** + invariantes **§2** deste plano. Em `sprint-bound`, soma `eval_manifest` do sprint file. Declarar `Eval source: Sprint §7 + §9`.
- Título recomendado: `## 8. Validação e checklist (validator)`.
- Comandos globais aplicáveis ao package, derivados de manifests/scripts reais; nunca inventar `flutter`, `npm` ou `pytest`.

---

## Seção opcional

### 9. Perguntas em aberto e bloqueios reais

- Só bloqueios que impedem execução segura. O executor **para** se houver itens ativos aqui.
- **Não** confundir com histórico/aprendizados do sprint file.

---

## O que NÃO incluir (propositalmente)

- Handoff prompt final no artefato (o executor lê o arquivo; ver `BOUNDARY_SPRINT_PLAN.md` no repo ativo).
- Gate de prontidão do autor do plano.
- Lista integral de rules do `project-rules` (o executor carrega via `AGENTS.md`).
- Cópia integral do escopo/fora de escopo do sprint file.
- Inventário global de todos os arquivos tocados.

---

## Uso standalone vs protocolo interno no workflow

Esta skill é de **autoria documental** (redigir um `PLAN_*.md`). A fronteira de determinismo do Talos é a **mutação de código**: como redigir um plano não muta código, **autoria é livre, execução é gateada**.

### (a) Uso standalone permitido

Você pode invocar `talos-plan-handoff` diretamente, fora do pipeline, para escrever um plano. Não há restrição: autoria documental não muta o produto. O `PLAN_*.md` resultante é livre para existir e ser editado.

### (b) O artefato NÃO é confiável só por existir

Um plano escrito standalone **não vale como gate aprovado** só porque existe — nem mesmo com nome `PLAN_*.md`. Ao entrar em execução, o plano é **re-gateado obrigatoriamente** por `talos_verify_artifact` + `talos_verify_template_conformance` (TC). Em `full`/`direct`, TC usa `require_sprint_file=true` — um plano com `Source mode: standalone` reentrando por esses modos **trava aqui**, por design. No modo `execute`, TC roda sem exigir sprint file de backlog — é o destino natural de um plano `Source mode: standalone`. Plano velho, manual, renomeado ou fora de conformidade **trava na entrada da execução**, não na autoria.

### (c) Standalone vs protocolo interno no workflow

> Atenção: "standalone" aqui descreve **quem conduz a autoria** (fora do orquestrador) — conceito distinto de `Source mode: standalone` nos metadados do plano (que descreve a **fonte documental**, backlog não aplicável). Os dois são ortogonais.

- **Standalone (condução):** o usuário conduz a skill diretamente; o produto é o `PLAN_*.md`, sujeito a re-validação na entrada de execução.
- **No workflow:** quem conduz a fase de plano é o **orquestrador principal**, que despacha/autora o plano antes de validá-lo e roda os gates MCP.

> **Invariante:** autoria é livre, execução é gateada. Um plano só vira confiável para execução após `talos_verify_artifact` + TC na entrada.

---

## Consistência da cadeia

O próximo agente, só lendo o artefato, deve saber:

- usar apenas skills `talos-*` declaradas nos metadados;
- respeitar `execution_mode`;
- rodar `talos-task-validator` antes de fechar a slice;
- usar `talos-slice-review` como segunda camada fria, não substituto do validator interno;
- cruzar aceite de negócio com **Sprint §7** (contrato congelado) quando o checklist do §8 for fino — nunca contra um PRD.
