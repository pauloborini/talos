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

Desde v0.15.0: aceite de produto atômico (`AC-*` no §7.3 com YAML `acceptance`, hierarquia AC⊃EVAL). State schema v3 com `acceptance_results`/`proof_refs` por AC. Status `manual_validation_pending` satisfaz DEP; handoff só em `done`. Relatório em `.talos/manual-validation/` com sync MCP (`talos_sync_manual_validation`). Review crítica obrigatória via `policy_manifest.critical_review`.
