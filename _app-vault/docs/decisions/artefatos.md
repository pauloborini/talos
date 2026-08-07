# Artefatos

Afeta: [backlog, sprint, generator]

### DEC-021 — Backlog em duas camadas

Backlog mestre enxuto (índice estratégico) em `.talos/backlog/BACKLOG_MESTRE_<produto>.md`; sprint files vivos em `.talos/backlog/sprints/SNN_<slug>.md` (fonte primária de contexto por sprint + contrato §7 congelado). Templates canônicos em `packages/templates/`.

### DEC-022 — Procedência por linha (0.16.0)

Toda decisão e todo critério de aceite declaram de onde vieram. Coluna `Origem` obrigatória na §7.1 do sprint file e nas decisões do backlog. Campo `origin` obrigatório em cada `AC-*` do §7.3 (enum `usuario` | `derivado:<path>` | `premissa`). Artefatos pré-0.16 não são suportados (corte seco).

### DEC-023 — premissa não sustenta Must/P0

`premissa` não sustenta aceite de sprint `Must`/`P0`. O gate `talos_verify_sprint_file` bloqueia nomeando o `AC-*` e a linha.

### DEC-024 — derivado resolvido no disco

`derivado:<path>` é resolvido contra o disco no root do consumidor. Path inexistente recusa a sprint/backlog antes da execução.

### DEC-025 — Discussão obrigatória na §4

§4 `Discussão` é obrigatória em todo sprint file (sempre, inclusive standalone). É a fonte que o revisor frio usa como oráculo de intenção.

### DEC-026 — Entrevista estruturada no backlog-generator

O `talos-backlog-generator` substitui texto livre por entrevista estruturada via `question_prompt`. O rascunho é escaneado em memória (`talos_scan_acceptance` com `sprint_markdown`) e cada resposta vira decisão com `Origem: usuario`.

### DEC-027 — Revisão fria interna ao generator

O passo final do `talos-backlog-generator` lê o mandato de `references/COLD_BACKLOG_REVIEW_PROMPT.md`, despacha subagente genérico do host por `capabilities.subagent_dispatch` (incondicional, foreground), audita e corrige artefatos, regateia gates sobre artefatos corrigidos e entrega relatório ao chamador. O revisor não muta código do produto — só markdown de backlog/sprint.
