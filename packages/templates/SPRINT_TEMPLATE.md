# Sprint viva — S<NN> — [NOME_DA_SPRINT]

Arquivo vivo da sprint **S<NN>**. Este documento conecta o backlog macro ao PLAN sem inflar nenhum dos dois.

Regra: este arquivo guarda **escopo, estado, decisões locais, dependências, gates, evidência e aprendizado da sprint**, e o **contrato de produto congelado** (§7: decisões D*, cenários UX e aceite binário). O PLAN guarda execução técnica. Variante standalone: `Backlog mestre: Não aplicável (standalone)`.

---

## 1. Metadados

| Campo | Valor |
|---|---|
| Sprint ID | S<NN> |
| Nome | [nome curto] |
| Status | [backlog / ready / doing / review / done / blocked] |
| Backlog mestre | [path + anchor da linha S<NN> — ou `Não aplicável (standalone)`] |
| Contrato status | [draft / aprovado] |
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

Casa única de produto desta sprint: decisões D*, cenários UX e aceite binário. O validador frio nota código contra este bloco (não contra o PLAN). Enquanto `Contrato status: draft`, o bloco pode madurar; ao virar `aprovado`, congela (selo no Plano 2).

### 7.1 Decisões de produto (D*)

> SSoT das decisões de produto. Demais seções referenciam por `D-id`.

| ID | Decisão |
|---|---|
| D1 | [decisão fechada — produto, não implementação] |
| D2 | […] |

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

> Critérios observáveis e binários. Derivados de §7.1/§7.2 e do `eval_manifest` §9.

**Produto**

- [ ] [observável]

**UX**

- [ ] [observável — espelhar §7.2, inclusive erros e loading]

**Dados**

- [ ] [integridade observável — referencie D* em vez de re-derivar]

**Regressão de produto**

- [ ] [o que já funcionava e deve continuar]

---

## 8. Definition of Ready

- [ ] Backlog aponta para este sprint file (exceto standalone).
- [ ] Este sprint file aponta para o backlog (ou `Não aplicável (standalone)`).
- [ ] Objetivo único e escopo fechado.
- [ ] Dependências críticas resolvidas.
- [ ] Bloqueios críticos resolvidos ou registrados.
- [ ] Contrato §7 completo (D*, cenários UX, 4 grupos de aceite) e `Contrato status` preenchido.
- [ ] `eval_manifest` mínimo preenchido.
- [ ] Próxima ação explícita.

**Status DoR:** [verde / amarelo / vermelho]

---

## 9. Eval manifest

Manifesto mínimo de avaliação da sprint. Serve para PLAN, executor e validator saberem o que precisa ser comprovado (o aceite de produto mora na §7).

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
  manual_checks:
    - "[check manual mínimo, se aplicável]"
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

## 13. PRD e PLAN

> O aceite de produto mora na §7 deste sprint file (não em PRD). A subseção PRD abaixo é legado de transição até a remoção completa do artefato.

### PRD

| Campo | Valor |
|---|---|
| Status | [pendente / draft / aprovado / implementado] |
| Path | [path] |
| Geração | [manual / talos-sprint-prd-generator] |
| Observações | [resumo — preferir §7 como SSoT de aceite] |

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
| Contrato §7 | [pending/pass/fail] | [status + selo] |
| PRD válido | [pending/pass/fail] | [path/resultado — legado] |
| PLAN válido | [pending/pass/fail] | [path/resultado] |
| Execução concluída | [pending/pass/fail] | [state path] |
| Validator frio | [pending/pass/fail] | [veredito/path] |

### Definition of Done

- [ ] Critérios de aceite §7.3 verdes.
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
