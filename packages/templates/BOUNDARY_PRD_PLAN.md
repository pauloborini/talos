# Fronteira PRD × PLAN

Política documental para sprints e handoff de execução. Referência: exemplos em [PRD/GARANTIAFACIL/EXEMPLO/](../PRD/GARANTIAFACIL/EXEMPLO/).

## Papéis

| Artefato | Dono mental | Pergunta que responde |
|----------|-------------|------------------------|
| **PRD** | Product Manager | O quê, por quê, para quem, o que não pode quebrar? |
| **PLAN** | Engenharia / executor | Como entregar no código, em que ordem, com que invariantes técnicos? |

## PRD — o que entra

- Resumo, problema, objetivo, escopo funcional, decisões **D*** (produto).
- Regras e invariantes de **negócio** e UX.
- Fluxos por tela/cenário (loading, vazio, erro).
- Contrato **funcional** (regras de dados em linguagem de produto).
- Critérios de aceite de **negócio** (checklist testável pelo PM/QA).
- Riscos e dependências de **produto/sprint**.

## PRD — o que NÃO entra

- Packages, camadas, clean architecture, GetX, nomes de classes/arquivos.
- `flutter analyze`, comandos de teste, paths do monorepo.
- Tabela “evidências” com dezenas de arquivos `.dart`.
- § “Impacto de arquitetura” — isso é PLAN.
- Repetir o conteúdo do PLAN.

**Teto orientativo:** ~180–220 linhas por sprint média.

## PLAN — o que entra

- Link ao PRD + referência `PRD §5` (não recopiar tabela D* inteira).
- Tradução executiva (padrão de referência no monorepo + diffs vs módulo espelho).
- Invariantes de **execução** derivados do PRD.
- Pitfalls (anti-padrão → correto).
- Estado na **abertura da sprint** (3–6 bullets); se já implementado, checklist de verificação.
- **Tarefas T01…** no schema abaixo (detalhadas).
- Contratos técnicos só onde o PRD deixa ambiguidade.
- Validação única + checklist do validator.
- **Slices** (opcional) se `execution_mode: orchestrated-per-slice`.

## PLAN — o que NÃO entra

- Handoff prompt no final (“leia o plano e execute…”).
- Gate de prontidão do autor do plano.
- Lista §3 com todas as rules do `project-rules` (o executor carrega AGENTS).
- Cópia integral do escopo/fora de escopo do PRD.
- Inventário global de todos os arquivos tocados (o executor descobre no repo).
- Duplicar três checklists idênticas.

**Teto orientativo:** ~250–350 linhas (M); até ~450 (L com slices).

## Herança entre documentos

```text
PRD §5 (D*)  ──referência──►  PLAN §2 invariantes + §1 diffs
PRD §8–10    ──referência──►  PLAN §5 (done) + §8 checklist
PRD §9       ──funcional──►  PLAN §6 contratos técnicos
```

## Schema de task (PLAN §5)

Cada `#### TNN.` deve ter, quando aplicável:

- **Objetivo**
- **Referência** (módulo/padrão no monorepo — não lista de 10 arquivos)
- **Pré-condições**
- **Mudança esperada**
- **Invariantes preservados** / **Não mudar** / **Não fazer**
- **Dependências**
- **Riscos** (se não óbvio)
- **Critério de done**
- **Validação local** (comando — na task de teste ou na final)
- **Quality gates** (opcional em tasks críticas)
- **Casos mínimos** (tasks de teste)

## Templates

- [PRD_TEMPLATE.md](./PRD_TEMPLATE.md)
- [PLAN_TEMPLATE.md](./PLAN_TEMPLATE.md)

## Pipeline

1. PRD aprovado (produto).
2. PLAN derivado do PRD + código (uma passagem de leitura no repo).
3. Execução: `atlas-plan-execute` lê PLAN + PRD §8–10; `project-rules` via AGENTS.

Geradores (`atlas-sprint-prd-generator`, `atlas-plan-handoff`) devem seguir estes templates, não o formato legado de 15 seções com §10 arquitetura no PRD.
