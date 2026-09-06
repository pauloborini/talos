# Pipeline

Afeta: [pipeline, orquestrador, validator, sprint, plano]

### DEC-001 — Pipeline determinístico

Talos é uma pipeline de desenvolvimento determinística (sprint §7 → plano → execução → validação fria). O pipeline decide por contrato (JSON, gates MCP, veredito estruturado), nunca por prosa ou improviso. Isolamento de contexto via subagente é parte do determinismo.

### DEC-002 — Plugin público, gratuito e instalável

O plugin é público e gratuito no GitHub, instalável por qualquer pessoa. Qualidade de distribuição é requisito de produto, não detalhe.

### DEC-009 — Regressão é falha

Toda expansão preserva o comportamento anterior. Breaking change só com bump de versão consciente e caminho de migração documentado. Regressão é falha, não trade-off.

### DEC-010 — main sempre instalável

`main` é a base estável e instalável a qualquer momento (`claude plugin marketplace add pauloborini/talos`). Trabalho em progresso vive em feature branches; nunca deixa `main` num estado quebrado.

### DEC-011 — Validar antes de declarar pronto

"Pronto" exige smoke real: build + `claude plugin validate ./ --strict` + instalação no host + `talos_ping` + dispatch do validator. Código verde no repo ≠ funciona no host.

### DEC-012 — Topologia sibling-only

Topologia sibling (v0.7.0+): validador e executor são subagentes irmãos isolados; orquestrador faz join síncrono. Topologia `nested` não existe mais.

### DEC-013 — Contrato de produto no sprint file

Desde v0.14.0 o artefato `PRD_*.md` não existe como etapa do pipeline. O sprint file absorve o contrato de produto na §7 ("Contrato de produto (congelado)") com decisões D*, cenários UX e aceite binário. Contrato `aprovado` é write-once protegido por `Selo do contrato: sha256:<hash>`. Validador frio nota código contra a §7 do sprint file.

### DEC-014 — Aceite atômico e validação manual

Desde v0.15.0: aceite de produto atômico (`AC-*` no §7.3 com YAML `acceptance`, hierarquia AC⊃EVAL). State schema v3 com `acceptance_results`/`proof_refs` por AC. Status `manual_validation_pending` satisfaz DEP; transição permitida com ACs `manual_pending` ou `unproved` (sem `violated`) sob veredito terminal do validator. Qualquer AC da sprint pode ser objeto de validação manual (`validated`) ou dispensa fundamentada (`waived`) no relatório `.talos/manual-validation/`. Promoção a `done` via `talos_sync_manual_validation` com emissão canônica de `HANDOFF_*.md` e ledger. Proibida edição manual de backlog/sprint para forçar status. Review crítica obrigatória via `policy_manifest.critical_review`.

### DEC-038 — Worktree dirty da slice é válido

A slice não exige commit git do código do produto. `files_changed` segue DEC-031 (porcelain Δ t0 ∪ range git). Exigir commit git dos files da slice é pack/DEC futura, não este contrato.

### DEC-040 — Intenção saturada mora na §2 do sprint file

Não existe artefato `INTENT.md` na cadeia Talos. Intenção (eixo, `SF-*`, `AS-*`, `R1`, regras do repo) vive no corpo da §2 do sprint file. `Intenção status` e `Selo da intenção` moram na §1 (fora do hash), igual ao contrato §7. §7–§10 não são renumeradas. Spec: `_app-vault/specs/SPEC_INTENT_SATURATION_SDD.md`.

### DEC-043 — Densidade de intenção é Talos, não piso de 10 Dx

Entrevista de intenção dispara por gatilhos T1–T7 da spec (campos vazios, `premissa`/comportamento `derivado:`, superfície sem efeito, recusa tautológica, anti-escopo genérico, regra do repo sem seguir/exceção, `misto` sem Must). Não se copia o piso pack-intent de 10 decisões `usuario:`. Pular só com zero gatilho, campos preenchidos e motivo gravado na §2.

### DEC-044 — Oráculo frio documental é §2 ∪ §4

DEC-025 permanece: §4 Discussão é obrigatória. Revisor frio de backlog/sprint confronta intenção na §2 saturada **e** a Discussão. Código do produto no validator frio de execução continua notando contra a §7 (DEC-013).

### DEC-045 — Plano e direct não expandem a §2

`talos-plan-handoff` e `talos-direct-execute` exigem selo de intenção íntegro (`plan_ready`). Task cujo lastro é só inferência ou que cita `AS-*` em `intent_refs` é defeito. G11 permanece. Recorte PLAN ⊆ §2 é mecânico: cada `#### Tnn` declara `intent_refs` só com `SF-*`/`R1` existentes; todo `SF-*` e `R1` têm ≥1 task; o MCP julga (`talos_assert_after_plan` + TC). Spec §9.3.

