# Ledger de obrigações da trilha

Painel de estado. Não repete 2.1/2.6/2.7/2.8. Só IDs e estado.
`PROVADO` só por audit-guide-plan.

| ID | Tipo | Fecha em | Estado | Promovido por | Evidência |
|----|------|----------|--------|---------------|-----------|
| CN1 | cenário | Plano 03 | PROVADO | audit-guide-plan Plano 03 (2026-08-06) | trace: SKILL.md passo 4 (`sprint_markdown` → `scanAcceptance` source draft → `question_prompt` → `Origem: usuario`/`premissa`) + 3 pernas verdes: `server.test.js::AC-02.2.1` (scan em memória), `etapa3::skill_backlog_sem_texto_livre` (rodada estruturada no lugar do texto livre), `etapa3::entrevista: persistir rodada preserva Origem... (AC-01.3.1 / INV1)` (persistência relida com `usuario`) |
| CN2 | cenário | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | `build/tests/etapa3.test.mjs::premissa_bloqueia_must_p0` + `server.test.js::verify_sprint_file_premissa_count` (blocked); falsificador F2 vermelho |
| CN3 | cenário | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | `etapa3::derivado_path_inexistente_bloqueia` (tmpdir real) + `server.test.js::verify_backlog_index_resolve_derivado`; F3 vermelho |
| CN4 | cenário | Plano 04 | pendente | — | — |
| CN5 | cenário | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | `etapa3::schema_pre_016_rejeitado` (`procedencia_ausente` §7.1, `migrar_para_0_16`); F4 vermelho |
| CN6 | cenário | Plano 02 | PROVADO | audit-guide-plan Plano 02 (2026-08-06) | `etapa3::discussão: placeholder... (AC-02.1.1)` + `::discussão: sprint standalone... (AC-02.1.2)` — pendência `fonte_discussao_ausente` no sink `validateSprintFileConformance` até `verifySprintFile` blocked; F1/F2 vermelhos |
| VC1 | valor crítico | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | sink `validateSprintFileConformance` consome `origin` §7.3/§7.1; leitor legado `applyDecisionRow` morto (AC-01.3.1/01.3.2, F6/F7 vermelhos) |
| VC2 | valor crítico | Plano 04 | pendente | — | — |
| VC3 | valor crítico | Plano 04 | pendente | — | — |
| LEG1 | legado | Plano 03 | PROVADO | audit-guide-plan Plano 03 (2026-08-06) | morto nos dois sítios nomeados em 2.7 (passo 4 + "Entradas aceitas"): grep `até 3 perguntas objetivas`/`Pergunte antes de salvar somente quando faltar` no sítio canônico exit 1; passo reescrito citando `question_prompt`; HEAD pré-edição comprovando a substituição; cópias geradas em `hosts/`/`plugins/` regeneradas no Plano 05 (INV5) |
| LEG2 | legado | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | AC-01.3.2: insert de 3 colunas funciona; cabeçalho de 2 colunas em `DECISION_TABLE_MISSING`; sem outro chamador no repo |
| INV1 | invariante | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | AC-01.3.1: persistir rodada preserva `usuario` no arquivo relido (fs real); F6 vermelho |
| INV2 | invariante | Plano 01 | PROVADO | audit-guide-plan Plano 01 (2026-08-06) | AC-01.4.1: selo íntegro com `origin`; editar §7 → `tampered:true`; F8 vermelho |
| INV3 | invariante | Plano 04 | pendente | — | — |
| INV4 | invariante | Plano 04 | pendente | — | — |
| INV5 | invariante | Plano 05 | pendente | — | — |
