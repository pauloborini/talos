# Sprint viva — S<NN> — [NOME_DA_SPRINT]

Arquivo vivo da sprint **S<NN>**. Este documento conecta o backlog macro ao PLAN sem inflar nenhum dos dois.

Regra: este arquivo guarda **escopo, estado, decisões locais, dependências, gates, evidência e aprendizado da sprint**, e o **contrato de produto congelado** (§7: decisões D*, cenários UX e aceite binário). O PLAN guarda execução técnica. Variante standalone: `Backlog mestre: Não aplicável (standalone)`.

---

## 1. Metadados

| Campo | Valor |
|---|---|
| Sprint ID | S<NN> |
| Nome | [nome curto] |
| Status | [backlog / ready / doing / review / manual_validation_pending / done / blocked] |
| Backlog mestre | [path + anchor da linha S<NN> — ou `Não aplicável (standalone)`] |
| Contrato status | [draft / aprovado] |
| Selo do contrato | [pendente até aprovação] |
| PLAN | [pendente ou path] |
| State / evidência | [pendente ou path] |
| Revalidação | [false — flag `true` ligada pelo MCP quando `M` falhou em sprint da qual esta depende (cone de revalidação, D2/D20)] |
| Fase | [F0/F1/F2/F3/F4/F5] |
| MoSCoW | [Must / Should / Could / Won't now] |
| Prioridade | [P0/P1/P2/P3] |
| Responsável | [papel/nome] |
| Criado em | [YYYY-MM-DD] |
| Última atualização | [YYYY-MM-DD] |

---

## 2. Objetivo e valor

**Objetivo único:** [uma frase]

**Valor esperado:** [benefício de produto, operação, risco ou desbloqueio]

**Resultado observável:** [o que estará comprovavelmente diferente ao fim]

**Se não fizer:** [impacto de adiar]

---

## 3. Escopo da sprint

### Em escopo

- [ ] [capacidade/entrega 1]
- [ ] [capacidade/entrega 2]
- [ ] [capacidade/entrega 3]

### Fora de escopo

- [ ] [adjacente tentador que não entra]
- [ ] [melhoria futura]
- [ ] [risco de expansão que deve ser evitado]

### Limite de tamanho

- [ ] Objetivo único confirmado.
- [ ] Sem mais de uma entrega vertical complexa.
- [ ] Se o PLAN estimar mais de 8 tasks, quebrar antes de executar.

---

## 4. Contexto e fontes

| Tipo | Fonte | Uso nesta sprint |
|---|---|---|
| Backlog | [path/anchor] | [escopo macro/dependência] |
| Produto | [doc/link] | [regra/decisão] |
| Contrato/API | [doc/link] | [campo/integração] |
| Código real | [path/símbolo opcional] | [padrão/estado atual] |
| Discussão | [link/resumo] | [decisão/contexto] |

Notas:

- Não copiar implementação aqui.
- Se uma fonte virar contrato de produto, refletir na §7.
- Se uma fonte virar task técnica, refletir no PLAN.

---

## 5. Dependências e bloqueios

### Dependências

| ID | Tipo | Descrição | Status | Evidência |
|---|---|---|---|---|
| S<NN-1> | sprint | [dependência] | [done/open/blocked] | [link] |
| DEP-001 | externa | [contrato/acesso/decisão] | [open/done/blocked] | [link] |

### Bloqueios atuais

| ID | Bloqueio | Dono | Ação | Status |
|---|---|---|---|---|
| BLK-001 | [bloqueio] | [dono] | [ação] | [open/resolvido] |

---

## 6. Decisões da sprint

Decisões locais que moldam esta sprint. Decisão de produto que vira aceite deve aparecer na §7.1 (D*).

| ID | Decisão | Fonte | Impacto | Status |
|---|---|---|---|---|
| SD-001 | [decisão] | [fonte] | [impacto] | [proposta/aprovada/revertida] |

---

## 7. Contrato de produto (congelado)

Casa única de produto desta sprint: decisões D*, cenários UX e aceite binário. O validador frio nota código contra este bloco (não contra o PLAN). Fluxo de congelamento: `draft` (maturação) → ao aprovar, gravar `Contrato status: aprovado` + `Selo do contrato: sha256:<hash do §7>`; qualquer edição do bloco aprovado sem re-aprovação é tamper (`FROZEN_ACCEPTANCE_TAMPERED`). Para reeditar: voltar a `draft` (limpa o selo), editar, re-aprovar.

### 7.1 Decisões de produto (D*)

> SSoT das decisões de produto. Demais seções referenciam por `D-id`. Toda decisão declara procedência na coluna `Origem` (v0.16.0).

| ID | Decisão | Origem |
|---|---|---|
| D1 | [decisão fechada — produto, não implementação — dada pelo usuário] | usuario |
| D2 | [decisão lida do código ou contrato real] | derivado:packages/exemplo.js |
| D3 | [decisão inferida pelo modelo — fechar por entrevista antes de sustentar aceite Must/P0] | premissa |

Legenda `Origem` (enum):

- `usuario` — resposta de entrevista ou citação direta do brainstorm.
- `derivado:<path>` — lida do código/contrato real; `<path>` relativo à raiz do repo; sufixo ` (novo)` quando o arquivo ainda será criado (ex.: `derivado:packages/novo_modulo.js (novo)`).
- `premissa` — inferida pelo modelo; não sustenta aceite de sprint `Must`/`P0` enquanto não for confirmada.

### 7.2 Cenários UX

> Por cenário: Entrada / Comportamento (loading · vazio · erro) / Sucesso.

### 7.2.1 [Cenário A — ex.: criar / carregar]

- **Entrada:** [de onde o usuário vem]
- **Comportamento:** [passo a passo; loading / vazio / erro]
- **Sucesso:** [o que o usuário vê]

### 7.2.2 [Cenário B — ex.: editar / dados insuficientes]

- **Entrada:** […]
- **Comportamento:** […]
- **Sucesso:** […]

### 7.3 Aceite binário

> Critérios observáveis e atômicos (`AC-*`). Hierarquia: `AC-*` ⊃ `EVAL-*`. Todo `EVAL-*` do `eval_manifest` §9 deve ser referenciado por ≥1 `AC-*`. Granularidade: ≥1 `AC-*` por cenário §7.2 + ≥1 de regressão quando houver regressão material.

```yaml
acceptance:
  - id: AC-001
    origin: "usuario"
    behavior: "[efeito observável]"
    decisions: [D1]
    scenario: "[cenário §7.2]"
    evals: [EVAL-001]
    evidence:
      required: [I, T-outcome, W]
      manual: null
  - id: AC-002
    origin: "derivado:packages/exemplo.js"
    behavior: "[efeito observável que requer smoke manual]"
    decisions: [D2]
    scenario: "[cenário §7.2]"
    evals: [EVAL-002]
    evidence:
      required: [I, T-outcome, M]
      manual:
        severity: alta
        scenario: "[passos mínimos humanos]"
        expected_evidence: "[resultado observável]"
        impact_paths: ["packages/foo.js"]
```

Todo `AC-*` declara `origin` (mesmo enum da §7.1: `usuario` | `derivado:<path>` | `premissa`). `premissa` não sustenta aceite em sprint `Must`/`P0`: o gate `talos_verify_sprint_file` bloqueia nomeando o `AC-*` até a premissa ser fechada em entrevista.

Tipos de evidência (D4): `I` implementação, `T-outcome` resultado observável (assert de retorno/efeito), `W` wiring, `M` smoke manual. `manual` deve ser `null` quando `required` não inclui `M`; objeto (severity/scenario/expected_evidence/impact_paths) quando inclui.

---

## 8. Definition of Ready

- [ ] Backlog aponta para este sprint file (exceto standalone).
- [ ] Este sprint file aponta para o backlog (ou `Não aplicável (standalone)`).
- [ ] Objetivo único e escopo fechado.
- [ ] Dependências críticas resolvidas.
- [ ] Bloqueios críticos resolvidos ou registrados.
- [ ] Contrato §7 completo (D*, cenários UX, `AC-*` em YAML `acceptance`) e `Contrato status` preenchido.
- [ ] `eval_manifest` mínimo preenchido.
- [ ] Próxima ação explícita.

**Status DoR:** [verde / amarelo / vermelho]

---

## 9. Eval manifest

Manifesto mínimo de avaliação da sprint. Serve para PLAN, executor e validator saberem o que precisa ser comprovado. `EVAL-*` é meio de prova subordinado a `AC-*` via `evals:` na §7.3. Smoke manual (M) mora no `evidence.manual` do AC; não há `manual_checks` solto aqui como autoridade de aceite.

```yaml
eval_manifest:
  sprint_id: "S<NN>"
  objective: "[objetivo curto]"
  must_prove:
    - id: "EVAL-001"
      claim: "[claim verificável]"
      source: "[Sprint §7 / PLAN §8 / state path / teste]"
      evidence_required: "[teste, comando, print, state, log, fixture]"
  regression_guards:
    - "[fluxo/regra que não pode quebrar]"
  negative_paths:
    - "[erro/permissão/vazio/retry relevante]"
```

---

## 10. Policy manifest

Regras locais da sprint. Não substitui AGENTS.md nem regras do projeto.
Áreas previstas pertencem ao escopo da sprint/PLAN; não use lista positiva como lista permitida de arquivos.

```yaml
policy_manifest:
  forbidden_scope:
    - "[área/módulo proibido]"
  data_safety:
    - "[sem apagar dados / sem migrar contrato / sem segredo em log]"
  required_gates:
    - "talos_verify_sprint_file"
    - "talos_verify_template_conformance:plan"
    - "talos-task-validator"
  critical_review:               # opcional — true torna slice-review obrigatória (D06/D09)
    required: false
    reasons: []                  # enum fixo: authorization | payment | data_migration | public_contract | host_adapter_dispatch
```

---

## 11. Guia e sensores

### Guias

- [ ] [padrão de produto/código/processo a seguir]
- [ ] [referência útil]

### Sensores de drift

- [ ] Escopo crescendo além do objetivo único.
- [ ] Contrato §7 copiando implementação.
- [ ] PLAN copiando roadmap.
- [ ] Claim sem evidência.
- [ ] Dependência não-done tratada como pronta.
- [ ] Decisão reaberta sem histórico.

---

## 12. Evidence-to-claim

Tabela viva para fechar o loop entre promessa e prova.

| Claim | Onde foi prometido | Evidência esperada | Evidência real | Status |
|---|---|---|---|---|
| [claim] | [Sprint §7 / PLAN § / backlog] | [teste/gate/state] | [path/link] | [pending/pass/fail] |

---

## 13. PLAN

> O aceite de produto mora na §7 deste sprint file. Esta seção só rastreia o PLAN de execução.

| Campo | Valor |
|---|---|
| Status | [pendente / draft / aprovado / executado] |
| Path | [path] |
| Execution mode | [sequencial / orchestrated-per-slice] |
| Observações | [resumo] |

---

## 14. Execução e validação

### Gates esperados

| Gate | Status | Evidência |
|---|---|---|
| Sprint file válido | [pending/pass/fail] | [path/resultado] |
| Contrato §7 | [pending/pass/fail] | [status + selo] |
| PLAN válido | [pending/pass/fail] | [path/resultado] |
| Execução concluída | [pending/pass/fail] | [state path] |
| Validator frio | [pending/pass/fail] | [veredito/path] |

### Definition of Done

- [ ] Critérios de aceite §7.3 (`AC-*`) verdes.
- [ ] PLAN executado dentro do boundary.
- [ ] Validações locais registradas.
- [ ] Validator frio `pass` ou `pass_with_observations`.
- [ ] Evidence-to-claim completo.
- [ ] Backlog atualizado com status e links.
- [ ] Aprendizados relevantes registrados.

**Status DoD:** [verde / amarelo / vermelho]

---

## 15. Aprendizados e handoff para próximas sprints

| Tipo | Aprendizado | Afeta | Ação |
|---|---|---|---|
| produto | [aprendizado] | [SNN/backlog] | [ação] |
| técnico | [aprendizado] | [PLAN/futura sprint] | [ação] |
| operação | [aprendizado] | [runbook/QA] | [ação] |

---

## 16. Histórico

| Data | Autor | Mudança |
|---|---|---|
| [YYYY-MM-DD] | [nome/agente] | Criação do sprint file |
