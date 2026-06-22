---
name: atlas-plan-handoff
description: Skill `atlas-plan-handoff`. Produz um handoff executável da família Atlas, fechando prefixo, modo de execução e gates no próprio artefato para consumo por `atlas-plan-execute` e `atlas-slice-review`.
---

# Atlas Plan Handoff

Use esta skill quando o usuário pedir um plano executável da cadeia `atlas-*`.

O artefato segue `PLAN_TEMPLATE.md` e `BOUNDARY_PRD_PLAN.md` — **localize ambos em `<raiz-do-plugin>/packages/templates/`**. O plano **não** depende de memória do chat para prefixo, modo ou executor.

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Resolver `PLAN_TEMPLATE.md` e `BOUNDARY_PRD_PLAN.md` a partir da raiz do plugin/bundle, antes de olhar qualquer arquivo do repo consumidor.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PLAN_TEMPLATE.md` ou `packages/templates/BOUNDARY_PRD_PLAN.md` não existir, abortar com erro claro: `Template canônico ausente: <nome-do-template>`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

## State persistence

Use `atlas_run_state` como fonte primária de estado da run. Não leia/escreva estado por file IO direto. Se o MCP estiver indisponível, avise que o gate não pode ser comprovado e aborte a fase em vez de seguir por fallback narrativo.

## Plan path resolution

Os paths são fornecidos pelo adapter de host: consultar `atlas_capabilities` e ler `plan_paths` (`write` + `read_order`). Referência canônica: `packages/orchestrator/references/host-adapters.md`. Valores atuais (iguais em todo host):

Escrita de novos planos: somente `.atlas/plans/`.

Leitura/migração por 1 release (ordem de `plan_paths.read_order`):

1. `.atlas/plans/`
2. `.cursor/plans/` com warning de depreciação
3. `.codex/plans/` com warning de depreciação

Se um plano legado for lido, o próximo artefato gerado deve ser salvo em `.atlas/plans/`.

## Cadeia de execução

```text
atlas-plan-handoff → atlas-plan-execute → atlas-task-validator → atlas-slice-review (opcional, via `--review`)
```

No workflow `full`, `atlas-plan-handoff` é autoria documental do agente principal/orquestrador. O primeiro sub-agent da cadeia só nasce em `atlas-plan-execute`.

---

## Fluxo obrigatório

1. **Classificação da tarefa:** feature, ui, contract, navigation, shared, security, diagnostic, refactoring, testing. Leia instruções reais aplicáveis do repo; `project-rules/` é apenas um formato possível, nunca requisito universal.
2. **Grounding no código:** confirme padrões, contratos, manifests e comandos reais antes de inferir. Resolva baseline/perfis via `../_shared/references/stack-profiles.md` + `detectStackProfiles(project_root, declared_commands, boundary_paths)`; não presuma Flutter nem aplique perfil fora do package correspondente.
3. **Decisões estáveis:** sanar bloqueios com perguntas ao usuário; registrar no plano (não recopiar tabela D* do PRD — referenciar `PRD §3`).
4. **Escrita:** artefato markdown no path canônico `.atlas/plans/`. Teto orientativo ~250–350 linhas (até ~450 com slices).

---

## Metadados obrigatórios (topo do artefato)

```md
## Metadados de execução
- Plan prefix: `atlas`
- Execution mode: `sequencial (T01→TN)` | `orchestrated-per-slice`
- Executor skill: `atlas-plan-execute`
- Internal validator: `atlas-task-validator`
- External review: `atlas-slice-review` (optional)
```

Regras:

- `Plan prefix` é sempre `atlas`.
- Se o modo não estiver decidido, o plano **não** está pronto para execução.
- Deixe explícito por que o modo escolhido é adequado, checks por task vs fechamento de slice e quando parar em `blocked`.

---

## Estrutura do plano (seções 1 a 8)

### 1. Tradução executiva

- O que será implementado e o resultado observável técnico.
- Padrão de referência no monorepo e tabela **referência vs esta entrega** (ligar a `PRD §3` D*, não recopiar a tabela).
- Link ao PRD: `PRD §2` escopo, `PRD §3` decisões.

### 2. Invariantes de execução (derivados do PRD)

- Invariantes técnicos inegociáveis (ex.: sem refetch ao filtrar).
- Referenciar IDs: `PRD §3 D12` — não colar a tabela D* inteira.

### 3. Pitfalls

- `anti-padrão observado` → `padrão canônico correto` (ancorado no repo).

### 4. Estado na abertura da sprint (pré-implementação)

- 3–6 bullets sobre o código hoje (comportamento/ausência — não inventário global de arquivos).
- Se já implementado: tratar como checklist de verificação.

### 5. Tarefas de execução

Tarefas `#### T01.` … `#### TNN.` com schema de `BOUNDARY_PRD_PLAN.md` canônico empacotado:

- **Objetivo**
- **Referência** (módulo/padrão no monorepo — evite listas longas de paths; o executor descobre no repo)
- **Pré-condições**
- **Mudança esperada**
- **Invariantes preservados**
- **Não mudar** / **Não fazer**
- **Dependências**
- **Riscos** (se não óbvio)
- **Critério de done**
- **Validação local** (comando com path do package)
- **Quality gates** (opcional em tasks críticas)
- **Casos mínimos** (somente em tasks de teste)

**Regra de minimalismo estrutural (autoria de task):** ao redigir `Mudança esperada`, prefira a forma mínima viável que cumpre o `Critério de done` — reusar módulo/símbolo já existente no repo antes de introduzir nova abstração; usar stdlib/feature nativa antes de dependência nova; evitar indireção, factory, wrapper, camada ou opção de config não exigida por PRD/invariante. A regra recai **somente** sobre abstração/indireção/arquivo/dependência nova. **Nunca** reduz: validação de trust-boundary, error-handling, data-loss, invariantes §2, cobertura de cenário/teste e negative paths. Em dúvida entre enxuto e seguro, escolha seguro.

Última task típica: **Validação final** (checks reais da stack ativa e passos manuais alinhados a **PRD §4–6**). Flutter usa `flutter analyze/test`; Node e Python usam somente scripts/ferramentas declarados no repo/plano.

### 6. Contratos técnicos (só ambiguidade PRD → código)

- Assinaturas, shapes e mapeamentos onde o PRD §5 não fecha implementação.

### 7. Slices (somente se `execution_mode: orchestrated-per-slice`)

- Tabela: slice, tasks, objetivo, boundary de diff esperado.

### 8. Validação e checklist (validator)

- Critérios derivados de **PRD §6** + invariantes **§2** deste plano.
- Título recomendado: `## 8. Validação e checklist (validator)`.
- Comandos globais aplicáveis ao package, derivados de manifests/scripts reais; nunca inventar `flutter`, `npm` ou `pytest`.

---

## Seção opcional

### 9. Perguntas em aberto e bloqueios reais

- Só bloqueios que impedem execução segura. O executor **para** se houver itens ativos aqui.
- **Não** confundir com PRD §7 Apêndice (Referências).

---

## O que NÃO incluir (propositalmente)

- Handoff prompt final no artefato (o executor lê o arquivo; ver `BOUNDARY_PRD_PLAN.md` no repo ativo).
- Gate de prontidão do autor do plano.
- Lista integral de rules do `project-rules` (o executor carrega via `AGENTS.md`).
- Cópia integral do escopo/fora de escopo do PRD.
- Inventário global de todos os arquivos tocados.

---

## Uso standalone vs protocolo interno no workflow (PRD D10/D11)

Esta skill é de **autoria documental** (redigir um `PLAN_*.md`). A fronteira de determinismo do Atlas é a **mutação de código** (PRD D10): como redigir um plano não muta código, **autoria é livre, execução é gateada**.

### (a) Uso standalone permitido

Você pode invocar `atlas-plan-handoff` diretamente, fora do pipeline, para escrever um plano. Não há restrição: autoria documental não muta o produto. O `PLAN_*.md` resultante é livre para existir e ser editado.

### (b) O artefato NÃO é confiável só por existir

Um plano escrito standalone **não vale como gate aprovado** só porque existe — nem mesmo com nome `PLAN_*.md`. Ao entrar em execução (modos `full`/`direct`/`execute`), o plano é **re-gateado obrigatoriamente** por `atlas_verify_artifact` + `atlas_verify_template_conformance` (TC); no modo `execute`, essa reverificação na entrada é o equivalente ao gate pós-plano (PRD D13). Plano velho, manual, renomeado ou fora de conformidade **trava na entrada da execução**, não na autoria. Esta skill não declara o plano "executável de forma determinística" só por tê-lo escrito.

### (c) Standalone vs protocolo interno no workflow

- **Standalone:** o usuário conduz a skill diretamente; o produto é o `PLAN_*.md`, sujeito a re-validação na entrada de execução.
- **No workflow:** quem conduz a fase de plano é o **orquestrador principal** (agente principal), que despacha/autora o plano antes de validá-lo e roda os gates MCP. Uma vez que o plano passa `atlas_verify_artifact` + TC, o orquestrador fica de mãos atadas (não edita mais o plano). A skill é a mesma; o que muda é quem orquestra e os gates que cercam a fase.

> **Invariante:** autoria é livre, execução é gateada. Um plano só vira confiável para execução após `atlas_verify_artifact` + TC na entrada (PRD D11).

---

## Consistência da cadeia

O próximo agente, só lendo o artefato, deve saber:

- usar apenas skills `atlas-*` declaradas nos metadados;
- respeitar `execution_mode`;
- rodar `atlas-task-validator` antes de fechar a slice;
- usar `atlas-slice-review` como segunda camada fria, não substituto do validator interno;
- cruzar aceite de negócio com **PRD §4–6** quando o checklist do §8 for fino.
