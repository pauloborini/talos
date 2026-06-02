# PRD: <Nome da feature / Sprint>

> **Documento de produto.** Comportamento e negócio — sem Dart, packages, paths ou comandos de CI.
>
> Comportamento **alvo** da entrega. Se a feature já estiver no app, use como contrato de aceite e regressão.
>
> Implementação: `PLAN_<ID>_<slug>.md` (gerado após PRD aprovado). Política: [BOUNDARY_PRD_PLAN.md](./BOUNDARY_PRD_PLAN.md).

| Campo | Valor |
|-------|-------|
| **Produto / App** | <GarantiaFácil \| Assina \| Atlas host \| …> |
| **Status** | <Draft \| Em decisão \| Aprovado para planejamento \| Aprovado para implementação \| Implementado \| Arquivado> |
| **Responsável** | <Papel ou nome> |
| **Data** | <YYYY-MM-DD> |
| **Dependências de negócio** | <Entregas anteriores necessárias — ex.: “dashboard com lista”> |
| **Relacionado** | <Regras de negócio, MVP, backlog §X — links> |

---

## 1. Resumo

<2–4 parágrafos curtos: situação, o que muda para o usuário, resultado observável, o que fica explicitamente fora.>

---

## 2. Problema

**Hoje:** <comportamento atual em linguagem de usuário/negócio>

**Se não entregar:** <impacto>

---

## 3. Objetivo

**Principal:** <uma frase>

**Resultado observável**

- <bullet observável pelo usuário ou operação>
- <…>

**Sucesso (negócio):** <como saber que valeu — sem métrica técnica de CI>

---

## 4. Escopo funcional

### Em escopo

- <capacidades fechadas, em linguagem de produto>

### Fora de escopo

- <o que esta entrega não cobre — evita scope creep>

### Não objetivos

- <o que o time não deve “aproveitar” para fazer nesta sprint>

---

## 5. Decisões de produto (fechadas)

| ID | Decisão |
|----|---------|
| D1 | <decisão fechada — produto, não implementação> |
| D2 | <…> |

> Motivo/impacto: só quando a decisão não for óbvia; senão omitir colunas extras.

---

## 6. Regras e invariantes (negócio)

- <regra que não pode ser violada>
- <erros em linguagem de produto; sem códigos técnicos ou stack ao usuário>

---

## 7. Antes e depois

| | Antes | Depois |
|---|--------|--------|
| <dimensão> | <…> | <…> |

**Não muda:** <comportamentos preservados de outras entregas>

---

## 8. Fluxos e cenários UX

### 8.1 <Cenário A — ex.: criar>

- **Entrada:** <de onde o usuário vem>
- **Comportamento:** <passo a passo>
- **Loading / vazio / erro:** <como se comporta>
- **Sucesso:** <o que o usuário vê>

### 8.2 <Cenário B — ex.: editar>

<mesma estrutura>

### 8.3 <Cancelar / voltar / estados gerais>

- <…>

### 8.N <Cenários de borda — ex.: acesso inválido, limite de plano>

- <…>

---

## 9. Contrato funcional (dados)

| Conceito | Regra para o usuário / sistema |
|----------|--------------------------------|
| <campo ou regra> | <validação, formato, default, persistência em termos de negócio> |

> Ex.: “valor em reais na digitação; gravado em centavos inteiros” — não nome de tipo Dart.

---

## 10. Critérios de aceite (negócio)

**Produto**

- [ ] <observável>

**UX**

- [ ] <observável — espelhar §8, inclusive erros e loading>

**Dados**

- [ ] <integridade observável — ex.: exemplos canônicos de valor/data>

**Regressão de produto**

- [ ] <o que já funcionava e deve continuar>

---

## 11. Riscos (produto)

| Risco | Mitigação |
|-------|-----------|
| <expectativa errada do usuário> | <copy, escopo, aceite> |

---

## 12. Dependências

- **<ID entrega>** — <por que bloqueia ou alimenta>
- **<Decisão externa>** — <se houver>

---

## 13. Referências

- <PRD pai, regras de negócio, backlog — sem listar arquivos de código>

---

## 14. Histórico

- <YYYY-MM-DD> — <evento>

---

## Checklist do autor (não publicar no PRD final — opcional)

- [ ] Nenhum package, classe, rota ou migration neste arquivo
- [ ] Todo critério de §10 tem correspondência em §8
- [ ] PLAN será derivado com link `PRD §5` sem recopiar D*
