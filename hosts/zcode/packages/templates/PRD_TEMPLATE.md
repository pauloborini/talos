# PRD: <Nome da feature / Sprint>

> **Documento de produto.** Comportamento e negócio — sem Dart, packages, paths ou comandos de CI.
>
> Comportamento **alvo** da entrega. Se a feature já estiver no app, use como contrato de aceite e regressão.
>
> Implementação: `PLAN_<ID>_<slug>.md` (gerado após PRD aprovado). Política: [BOUNDARY_PRD_PLAN.md](./BOUNDARY_PRD_PLAN.md).
>
> **Regra de ouro (anti-repetição):** cada verdade tem **uma casa**; as demais seções **referenciam** por `§`/`D-id` em vez de re-enumerar. Enxugar conteúdo nunca remove a demarcação (separadores, rótulos, subcabeçalhos).

| Campo | Valor |
|-------|-------|
| **Produto / App** | <GarantiaFácil \| Assina \| Atlas host \| …> |
| **Status** | <Draft \| Em decisão \| Aprovado para planejamento \| Aprovado para implementação \| Implementado \| Arquivado> |
| **Responsável** | <Papel ou nome> |
| **Data** | <YYYY-MM-DD> |
| **Dependências de negócio** | <Entregas anteriores necessárias — ex.: “dashboard com lista”> |
| **Relacionado** | <Regras de negócio, MVP, backlog §X, DEC-*, Q-* — links> |
| **Fonte da sprint** | <path explícito do backlog autoritativo + anchor único SNN> |

### Metadados de execução

- Plan prefix: `<atlas>` · Planner: `<atlas-plan-handoff>` · Executor: `<atlas-plan-execute>`
- Internal validator: `<atlas-task-validator>` · External review: `<atlas-slice-review>` (optional)

---

## 1. Contexto e objetivo

**Hoje:** <comportamento atual em linguagem de usuário/negócio>

**Se não entregar:** <impacto de não fazer>

**Objetivo principal:** <uma frase>

**Resultado observável**

- <bullet observável pelo usuário ou operação — referencie D* em vez de re-enumerar entregáveis>

**Sucesso (negócio):** <como saber que valeu — sem métrica técnica de CI>

---

## 2. Escopo

### Em escopo

- <capacidades fechadas, em linguagem de produto — referencie o conjunto de §3 D* quando aplicável>

### Fora de escopo

- <adjacentes tentadores que NÃO entram nesta entrega — previne scope creep>
- <anti-goal oportunista ("não aproveitar para fazer X"); invariante que é regra de negócio vai para §5, não aqui>

---

## 3. Decisões de produto (fechadas)

> Casa única das decisões. As demais seções referenciam por `D-id`, não recopiam.

| ID | Decisão |
|----|---------|
| D1 | <decisão fechada — produto, não implementação. É a SSoT do que esta sprint entrega> |
| D2 | <…> |

> Motivo/impacto: só quando a decisão não for óbvia; senão omitir.

---

## 4. Fluxos e cenários UX

> Quando vários cenários compartilham comportamento, declare uma vez e referencie.

### 4.1 <Cenário A — ex.: criar / carregar>

- **Entrada:** <de onde o usuário vem>
- **Comportamento:** <passo a passo; loading / vazio / erro>
- **Sucesso:** <o que o usuário vê>

### 4.2 <Cenário B — ex.: editar / dados insuficientes>

<mesma estrutura>

### 4.N <Cenários de borda — ex.: acesso inválido, limite de plano, falha de leitura>

- <…>

---

## 5. Contrato funcional e invariantes

> Casa única de **dados + regras/segurança de negócio**. §4 e §6 referenciam, não repetem.

| Conceito | Regra para o usuário / sistema |
|----------|--------------------------------|
| <campo ou regra> | <validação, formato, default, persistência em termos de negócio> |

> Ex.: “valor em reais na digitação; gravado em centavos inteiros” — não nome de tipo Dart.

**Invariantes (negócio/segurança)**

- <regra que não pode ser violada; erros em linguagem de produto, sem códigos técnicos ou stack ao usuário>

---

## 6. Critérios de aceite (negócio)

**Produto**

- [ ] <observável>

**UX**

- [ ] <observável — espelhar §4, inclusive erros e loading>

**Dados**

- [ ] <integridade observável — referencie §5/D* em vez de re-derivar fontes>

**Regressão de produto**

- [ ] <o que já funcionava e deve continuar>

---

## 7. Apêndice (opcional)

> Metadados leves. Omitir blocos que não agregam nesta entrega.

**Riscos**

| Risco | Mitigação |
|-------|-----------|
| <expectativa errada do usuário> | <copy, escopo, aceite — referencie D*/§ quando couber> |

**Dependências:** <ID entrega — por que bloqueia ou alimenta> · <decisão externa, se houver>

**Referências:** <PRD pai, regras de negócio, backlog autoritativo + anchor; anchors de contrato/código usados na validação, sem copiar implementação>

**Histórico:** <YYYY-MM-DD — evento>

---

## Checklist do autor (não publicar no PRD final — opcional)

- [ ] Nenhum package, classe, rota ou migration neste arquivo
- [ ] Cada verdade tem UMA casa; demais seções referenciam por §/D-id (sem re-enumerar)
- [ ] Todo critério de §6 tem correspondência em §4 (UX) ou §5 (dados)
- [ ] "Fora de escopo" nomeia os adjacentes tentadores, não o complemento infinito
- [ ] Demarcação preservada: `---`, `**Label:**`, `### N.x`, headers de tabela, grupos de aceite
