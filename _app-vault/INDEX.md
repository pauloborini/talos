---
vault_version: 1
updated: 2026-09-03
scope: Plugin Talos — pipeline determinística multi-host
---

# Talos — índice do vault

## Domínios

- [pipeline](docs/decisions/pipeline.md) — missão, invariantes, topologia, aceite e contrato de produto
- [distribuicao](docs/decisions/distribuicao.md) — install, hosts, packaging e versão
- [determinismo](docs/decisions/determinismo.md) — gates PREREQ/DISPATCH, adapters e join
- [artefatos](docs/decisions/artefatos.md) — backlog, sprint file e procedência 0.16

## Features válidas

`pipeline`, `orquestrador`, `validator`, `sprint`, `plano`, `backlog`, `generator`, `distribuicao`, `install`, `hosts`, `mcp`

## Por feature

- pipeline → pipeline, determinismo
- orquestrador → pipeline, determinismo
- validator → pipeline, determinismo
- sprint → pipeline, artefatos
- plano → pipeline, artefatos
- backlog → artefatos
- generator → artefatos
- distribuicao → distribuicao
- install → distribuicao
- hosts → distribuicao, determinismo
- mcp → determinismo

## Histórico

- 2026-08-06 — Migração AppVault (`vault-migrate` passos 1–6). `DEC-006` nunca atribuído (lacuna
  intencional na numeração legada).
- 2026-08-30 — `DEC-028` atribuído: rastreabilidade v1 opt-in por sprint (0.19.0), domínio `artefatos`.
- 2026-09-03 — `DEC-029`–`DEC-037` (determinismo: evidência de slice, G4/G12, repair, loop);
  `DEC-038` (pipeline: dirty worktree válido); `DEC-039` (distribuição: 0.21.0 BREAKING boundary).
