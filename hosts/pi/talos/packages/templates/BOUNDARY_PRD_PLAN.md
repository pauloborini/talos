# Fronteira Backlog × Sprint × PRD × PLAN

Política documental para backlog, sprint files, PRDs e handoff de execução. Referência: exemplos em [PRD/GARANTIAFACIL/EXEMPLO/](../PRD/GARANTIAFACIL/EXEMPLO/).

## Papéis

| Artefato | Dono mental | Pergunta que responde |
|----------|-------------|------------------------|
| **Backlog mestre** | Produto / coordenação | Qual é a sequência macro, prioridade, estado e dependência entre sprints? |
| **Sprint file** | Produto + engenharia | Qual é o recorte vivo desta sprint, seus gates, riscos, evidências esperadas e links? |
| **PRD** | Product Manager | O quê, por quê, para quem, o que não pode quebrar? |
| **PLAN** | Engenharia / executor | Como entregar no código, em que ordem, com que invariantes técnicos? |
| **State file** | Executor / validator | O que foi executado, validado e provado em disco? |

## Backlog mestre — o que entra

- Objetivo macro, fases, dependências e prioridade.
- Registro de sprints na seção `## 7. Registro de sprints`.
- Links para `SPRINT_S<NN>_<slug>.md`, PRD, PLAN e state quando existirem.
- Próxima sprint executável e motivo.
- Decisões e riscos macro.

## Backlog mestre — o que NÃO entra

- Critérios completos de aceite da sprint.
- Tasks técnicas do PLAN.
- Logs detalhados de execução.
- Evidências granulares que pertencem ao sprint file ou state.

## Sprint file — o que entra

- Objetivo único, escopo/fora de escopo e limite de tamanho.
- Links bidirecionais com backlog, PRD, PLAN e state.
- Dependências, bloqueios e decisões locais.
- Critérios candidatos para PRD.
- `eval_manifest`, `policy_manifest`, sensores de drift e evidence-to-claim.
- DoR/DoD vivo da sprint.

## Sprint file — o que NÃO entra

- Implementação task-a-task.
- Código, classes, imports, migrations ou comandos detalhados.
- Cópia integral do PRD ou PLAN.
- Roadmap macro que pertence ao backlog.

## PRD — o que entra (modelo enxuto de 6 seções + apêndice)

- **§1 Contexto e objetivo** — hoje, impacto de não fazer, objetivo, resultado observável, sucesso.
- **§2 Escopo** — em escopo / fora de escopo (sem "Não objetivos"; invariante vira §5).
- **§3 Decisões de produto (D\*)** — casa única; demais seções referenciam por `D-id`.
- **§4 Fluxos e cenários UX** — por cenário, com loading/vazio/erro.
- **§5 Contrato funcional e invariantes** — regras de dados + invariantes de negócio/segurança numa casa só.
- **§6 Critérios de aceite (negócio)** — checklist testável (Produto/UX/Dados/Regressão).
- **§7 Apêndice (opcional)** — riscos, dependências, referências, histórico.

> **Regra anti-repetição:** cada verdade tem uma casa; as demais seções referenciam por `§`/`D-id`, não re-enumeram.

O PRD nasce do sprint file, não do macro input cru. O sprint file fornece recorte, contexto, critérios candidatos e `eval_manifest`; o PRD fecha o contrato de produto.

## PRD — o que NÃO entra

- Packages, camadas, clean architecture, GetX, nomes de classes/arquivos.
- `flutter analyze`, comandos de teste, paths do monorepo.
- Tabela “evidências” com dezenas de arquivos `.dart`.
- § “Impacto de arquitetura” — isso é PLAN.
- Repetir o conteúdo do PLAN.
- Duplicar YAML inteiro do `eval_manifest`; referencie IDs EVAL-*.

**Teto orientativo:** ~120–150 linhas por sprint média (modelo enxuto).

## PLAN — o que entra

- Link ao PRD + referência `PRD §3` (não recopiar tabela D* inteira).
- Link ao sprint file + `eval_manifest` usado.
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
- Transformar `eval_manifest` em checklist paralelo desconectado do PRD §6 e PLAN §8.

**Teto orientativo:** ~250–350 linhas (M); até ~450 (L com slices).

## Herança entre documentos

```text
Backlog §7    ──seleção──►    Sprint file SNN
Sprint §7/§9  ──base──►       PRD §2/§6
Sprint §9/§10 ──gates──►      PLAN §2/§8
PRD §3 (D*)   ──referência──► PLAN §2 invariantes + §1 diffs
PRD §4–6      ──referência──► PLAN §5 (done) + §8 checklist
PRD §5        ──funcional──►  PLAN §6 contratos técnicos
PLAN/state    ──evidência──►  Sprint §12 + backlog §7 status
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
- [BACKLOG_MESTRE_TEMPLATE.md](./BACKLOG_MESTRE_TEMPLATE.md)
- [SPRINT_TEMPLATE.md](./SPRINT_TEMPLATE.md)

## Pipeline

1. Backlog seleciona próxima sprint.
2. Sprint file fecha recorte vivo e DoR.
3. PRD aprovado fecha produto.
4. PLAN deriva de PRD + sprint file + código real.
5. Execução: `talos-plan-execute` lê PLAN + PRD §4–6; `project-rules` via AGENTS.
6. Validator/state alimentam sprint file e backlog.

Geradores (`talos-backlog-generator`, `talos-sprint-prd-generator`, `talos-plan-handoff`) devem seguir estes templates, não o formato legado (14 seções, ou §X de arquitetura no PRD).
