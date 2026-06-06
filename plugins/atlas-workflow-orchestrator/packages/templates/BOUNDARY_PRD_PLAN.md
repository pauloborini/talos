# Fronteira PRD × PLAN

Política documental para sprints e handoff de execução. Referência: exemplos em [PRD/GARANTIAFACIL/EXEMPLO/](../PRD/GARANTIAFACIL/EXEMPLO/).

## Papéis

| Artefato | Dono mental | Pergunta que responde |
|----------|-------------|------------------------|
| **PRD** | Product Manager | O quê, por quê, para quem, o que não pode quebrar? |
| **PLAN** | Engenharia / executor | Como entregar no código, em que ordem, com que invariantes técnicos? |

## PRD — o que entra (modelo enxuto de 6 seções + apêndice)

- **§1 Contexto e objetivo** — hoje, impacto de não fazer, objetivo, resultado observável, sucesso.
- **§2 Escopo** — em escopo / fora de escopo (sem "Não objetivos"; invariante vira §5).
- **§3 Decisões de produto (D\*)** — casa única; demais seções referenciam por `D-id`.
- **§4 Fluxos e cenários UX** — por cenário, com loading/vazio/erro.
- **§5 Contrato funcional e invariantes** — regras de dados + invariantes de negócio/segurança numa casa só.
- **§6 Critérios de aceite (negócio)** — checklist testável (Produto/UX/Dados/Regressão).
- **§7 Apêndice (opcional)** — riscos, dependências, referências, histórico.

> **Regra anti-repetição:** cada verdade tem uma casa; as demais seções referenciam por `§`/`D-id`, não re-enumeram.

## PRD — o que NÃO entra

- Packages, camadas, clean architecture, GetX, nomes de classes/arquivos.
- `flutter analyze`, comandos de teste, paths do monorepo.
- Tabela “evidências” com dezenas de arquivos `.dart`.
- § “Impacto de arquitetura” — isso é PLAN.
- Repetir o conteúdo do PLAN.

**Teto orientativo:** ~120–150 linhas por sprint média (modelo enxuto).

## PLAN — o que entra

- Link ao PRD + referência `PRD §3` (não recopiar tabela D* inteira).
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
PRD §3 (D*)  ──referência──►  PLAN §2 invariantes + §1 diffs
PRD §4–6     ──referência──►  PLAN §5 (done) + §8 checklist
PRD §5       ──funcional──►  PLAN §6 contratos técnicos
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
3. Execução: `atlas-plan-execute` lê PLAN + PRD §4–6; `project-rules` via AGENTS.

Geradores (`atlas-sprint-prd-generator`, `atlas-plan-handoff`) devem seguir estes templates, não o formato legado (14 seções, ou §X de arquitetura no PRD).
