# Sprint viva — S<NN> — [NOME_DA_SPRINT]

Arquivo vivo da sprint **S<NN>**. Este documento conecta o backlog macro ao PRD/PLAN sem inflar nenhum dos dois.

Regra: este arquivo guarda **escopo, estado, decisões, dependências, gates, evidência e aprendizado da sprint**. O PRD guarda produto/aceite. O PLAN guarda execução técnica.

---

## 1. Metadados

| Campo | Valor |
|---|---|
| Sprint ID | S<NN> |
| Nome | [nome curto] |
| Status | [backlog / ready / doing / review / done / blocked] |
| Backlog mestre | [path + anchor da linha S<NN>] |
| PRD | [pendente ou path] |
| PLAN | [pendente ou path] |
| State / evidência | [pendente ou path] |
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
- Se uma fonte virar contrato de produto, refletir no PRD.
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

Decisões locais que moldam esta sprint. Decisão de produto que vira aceite deve aparecer no PRD.

| ID | Decisão | Fonte | Impacto | Status |
|---|---|---|---|---|
| SD-001 | [decisão] | [fonte] | [impacto] | [proposta/aprovada/revertida] |

---

## 7. Critérios candidatos para PRD

Pré-PRD. Depois que o PRD existir, ele vira a fonte de verdade de produto/aceite; manter aqui só resumo e link.

### Produto

- [ ] [critério observável candidato]

### UX / operação

- [ ] [loading/empty/error/success/permissão, se aplicável]

### Dados / contrato funcional

- [ ] [integridade/regra observável]

### Regressão

- [ ] [fluxo existente que não pode quebrar]

---

## 8. Definition of Ready

- [ ] Backlog aponta para este sprint file.
- [ ] Este sprint file aponta para o backlog.
- [ ] Objetivo único e escopo fechado.
- [ ] Dependências críticas resolvidas.
- [ ] Bloqueios críticos resolvidos ou registrados.
- [ ] Critérios candidatos suficientes para gerar PRD.
- [ ] `eval_manifest` mínimo preenchido.
- [ ] Próxima ação explícita.

**Status DoR:** [verde / amarelo / vermelho]

---

## 9. Eval manifest

Manifesto mínimo de avaliação da sprint. Serve para PRD, PLAN, executor e validator saberem o que precisa ser comprovado.

```yaml
eval_manifest:
  sprint_id: "S<NN>"
  objective: "[objetivo curto]"
  must_prove:
    - id: "EVAL-001"
      claim: "[claim verificável]"
      source: "[PRD §6 / PLAN §8 / state path / teste]"
      evidence_required: "[teste, comando, print, state, log, fixture]"
  regression_guards:
    - "[fluxo/regra que não pode quebrar]"
  negative_paths:
    - "[erro/permissão/vazio/retry relevante]"
  manual_checks:
    - "[check manual mínimo, se aplicável]"
```

---

## 10. Policy manifest

Regras locais da sprint. Não substitui AGENTS.md nem regras do projeto.

```yaml
policy_manifest:
  allowed_scope:
    - "[área/módulo permitido]"
  forbidden_scope:
    - "[área/módulo proibido]"
  data_safety:
    - "[sem apagar dados / sem migrar contrato / sem segredo em log]"
  required_gates:
    - "talos_verify_sprint_file"
    - "talos_verify_template_conformance:prd"
    - "talos_verify_template_conformance:plan"
    - "talos-task-validator"
```

---

## 11. Guia e sensores

### Guias

- [ ] [padrão de produto/código/processo a seguir]
- [ ] [referência útil]

### Sensores de drift

- [ ] Escopo crescendo além do objetivo único.
- [ ] PRD copiando implementação.
- [ ] PLAN copiando roadmap.
- [ ] Claim sem evidência.
- [ ] Dependência não-done tratada como pronta.
- [ ] Decisão reaberta sem histórico.

---

## 12. Evidence-to-claim

Tabela viva para fechar o loop entre promessa e prova.

| Claim | Onde foi prometido | Evidência esperada | Evidência real | Status |
|---|---|---|---|---|
| [claim] | [PRD § / PLAN § / backlog] | [teste/gate/state] | [path/link] | [pending/pass/fail] |

---

## 13. PRD e PLAN

### PRD

| Campo | Valor |
|---|---|
| Status | [pendente / draft / aprovado / implementado] |
| Path | [path] |
| Geração | [manual / talos-sprint-prd-generator] |
| Observações | [resumo] |

### PLAN

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
| PRD válido | [pending/pass/fail] | [path/resultado] |
| PLAN válido | [pending/pass/fail] | [path/resultado] |
| Execução concluída | [pending/pass/fail] | [state path] |
| Validator frio | [pending/pass/fail] | [veredito/path] |

### Definition of Done

- [ ] Critérios do PRD verdes.
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
