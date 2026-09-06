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

§4 `Discussão` é obrigatória em todo sprint file (sempre, inclusive standalone). É a fonte de procedência da conversa; o oráculo de intenção saturada é §2 ∪ §4 (DEC-044).

### DEC-026 — Entrevista estruturada no backlog-generator

O `talos-backlog-generator` substitui texto livre por entrevista estruturada via `question_prompt`. O rascunho é escaneado em memória (`talos_scan_acceptance` com `sprint_markdown`) e cada resposta vira decisão com `Origem: usuario`.

### DEC-027 — Revisão fria interna ao generator

O passo final do `talos-backlog-generator` lê o mandato de `references/COLD_BACKLOG_REVIEW_PROMPT.md`, despacha subagente genérico do host por `capabilities.subagent_dispatch` (incondicional, foreground), audita e corrige artefatos, regateia gates sobre artefatos corrigidos e entrega relatório ao chamador. O revisor não muta código do produto — só markdown de backlog/sprint.

### DEC-028 — Rastreabilidade v1 opt-in por sprint (0.19.0)

Sprint entra no modo com metadado `Traceability: v1` no sprint file; sem a marca (legacy), comportamento atual intacto. Requisitos (`REQ-*`) vivem no ledger `.talos/traceability/<backlog-slug>.json`, escrito só pela tool única `talos_traceability` (`upsert`/`verify`/`receipt`/`record_metric`). Cada `AC-*` pode declarar `source_refs` no YAML do §7.3; sprint v1 exige grafo REQ↔AC consistente no conformance (refs válidas, sem órfãs, `included` com caminho até AC, N:N com motivo). Fechamento `done` em sprint v1 é gated: REQ `included` exige todos os AC ligados `proved`; marcadores inconsistentes em qualquer sentido (sprint marcada sem ledger / ledger marcado sem sprint) bloqueiam (`alinhar_marcadores_traceability`). Receipt de fechamento é projeção read-only do MCP — o orquestrador ecoa o payload, nunca reclama cobertura própria. Chamada sob demanda: nada no boot, nenhum hook, sem coluna nova no backlog, state v3 e schema MCP v5 inalterados.

### DEC-041 — Entrevista dual: recorte no backlog, saturação na sprint

Duas entrevistas, mesmo `question_prompt`. L1 (`talos-backlog-generator`) satura recorte do ciclo (tema, fora, MoSCoW, sequência só se o eixo exigir) — não completude de AC YAML. L2 (`talos-sprint-interview`) satura a §2 no eixo da sprint e **só então** deriva a §7. `talos_scan_acceptance` com zero padrões não pula L2. Spec: `_app-vault/specs/SPEC_INTENT_SATURATION_SDD.md`.

### DEC-042 — Quantidade de sprints não é pergunta

Entrevista nunca pergunta quantas sprints. Decomposição segue objetivo único e limite de tamanho do template. Se o usuário sugerir N, nomear sprints ou recortar IDs, gravar `Origem: usuario` e não sobrescrever. Silêncio → a LLM decompõe pelo escopo do backlog.

### DEC-046 — Pergunta dirigida por tema ∩ eixo ∩ T*

Rodada de entrevista escolhe a próxima pergunta pela interseção: objetivo único (tema) × eixo da §2 × gatilho T* ainda aberto. Pack genérico (UX+dados+estrutura em toda sprint) é defeito. Stem cita o tema; opções são efeitos de produto mutuamente exclusivos; recomendação corta escopo ou segue regra do repo. Catálogo do inútil e roteiro: spec §5. Saturação = T*=0, não número de rodadas.

### DEC-047 — `verify_sprint_file` limiar `stub` vs `plan_ready`

A mesma tool. Default `require: plan_ready` (callers antigos não afrouxam). Generator e `select_next` usam `require: stub`: §7 sem YAML `acceptance` é válido; DoR amarelo. **Todo** sprint file (inclusive stub) declara `Intenção status` (`rascunho`|`saturada`) e `Selo da intenção` (`pendente até saturação` ou `sha256:`); linha ausente ou placeholder bloqueia. Plano/direct/`assert_after_plan` exigem `plan_ready` (dois selos + AC). Sem `legacy_sealed`. Spec §9.1. DEC-049.

### DEC-049 — Sem atalho de compatibilidade de intenção

Sprint em `doing`/`review` com §7 selada **não** dispensa saturação §2. Artefato pré-0.23 sem as linhas de intenção na §1 é inválido: migrar o sprint file (copiar campos do template 0.23 + L2 se for executar) ou recomeçar a sprint. `done` não é tocado. Spec D-INT-12.

### DEC-048 — Maturação de stub sem `--loop`; CN7 intacto na esteira

`talos_select_next_sprint` sem `loop` inclui `state=backlog` com file `stub` válido, deps satisfeitas e DoR amarelo/verde; essa fila precede `ready`; `next_action: sprint_interview`. `--loop` continua sendo só a esteira de execução (review sempre, drain, serial). Spec §9.2.
