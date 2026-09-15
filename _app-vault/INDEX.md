---
vault_version: 1
updated: 2026-09-15
scope: Plugin Talos — pipeline determinística multi-host
---

# Talos — índice do vault

## Domínios

- [artefatos](docs/decisions/artefatos.md) — artefatos
- [determinismo](docs/decisions/determinismo.md) — determinismo
- [distribuicao](docs/decisions/distribuicao.md) — distribuição
- [pipeline](docs/decisions/pipeline.md) — pipeline
- [marca](docs/decisions/marca.md) — marca e ecossistema

## Features válidas

`pipeline`, `orquestrador`, `validator`, `sprint`, `plano`, `backlog`, `generator`, `distribuicao`, `install`, `hosts`, `mcp`

## Por feature

- backlog → artefatos
- distribuicao → distribuicao, marca
- generator → artefatos
- hosts → determinismo, distribuicao
- install → distribuicao
- mcp → determinismo
- orquestrador → determinismo, pipeline
- pipeline → determinismo, marca, pipeline
- plano → pipeline
- sprint → artefatos, pipeline
- validator → pipeline

## Histórico

- 2026-08-06 — Migração AppVault (`vault-migrate` passos 1–6). `DEC-006` nunca atribuído (lacuna intencional na numeração legada).
- 2026-08-30 — `DEC-028` atribuído: rastreabilidade v1 opt-in por sprint (0.19.0), domínio `artefatos`.
- 2026-09-03 — `DEC-029`–`DEC-037` (determinismo: evidência de slice, G4/G12, repair, loop); `DEC-038` (pipeline: dirty worktree válido); `DEC-039` (distribuição: 0.21.0 BREAKING boundary).
- 2026-09-05 — `DEC-040`/`043`–`045` (pipeline: intenção §2, densidade T*, oráculo frio, plano⊆§2); `DEC-041`/`042`/`046`–`049` (artefatos: entrevista dual, sem N, pergunta dirigida, stub/plan_ready, select_next, sem legacy_sealed); spec `_app-vault/specs/SPEC_INTENT_SATURATION_SDD.md`.
- 2026-09-15 — `DEC-050` atribuído: identidade dos produtos do ecossistema (domínio novo `marca`). Promovida da decisão de marca que vivia na raiz (`NAMING.md`, ID legado `DEC-ECO-001`); a casca foi para o espelho de processo.
