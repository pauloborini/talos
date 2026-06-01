# Changelog

## v0.2.0 - 2026-06-01

Tipo: release

Resumo: publica a linha v0.2 do Atlas Workflow Orchestrator como plugin operacional reproduzivel.

Mudancas:
- consolida 21 skills, templates canonicos, orquestrador e MCP server em dois artefatos `.plugin`;
- define `atlas-workflow-claude.plugin` como artefato para Claude Code e Cursor;
- define `atlas-workflow-codex.plugin` como artefato para Codex;
- adiciona checksums `SHA256SUMS` gerados pelo build;
- adiciona workflow GitHub Actions para build e publicacao em tags `v*`;
- atualiza README com pre-requisitos, instalacao por host e resultado esperado;
- atualiza PATCH_PROCEDURE para manutencao da linha v0.2.

Impacto:
- usuarios podem identificar a versao publica unica `0.2.0`;
- instalacao passa a ter artefato e checksum inequivocos por host;
- Cursor consome o pacote Claude Code na v0.2, sem artefato proprio;
- skills standalone, marketplace publico, migracao local e remocao de skills nativas ficam fora da S14.

Arquivos/artefatos:
- `VERSION`;
- `.github/workflows/release.yml`;
- `build/build-plugins.sh`;
- `dist/atlas-workflow-claude.plugin`;
- `dist/atlas-workflow-codex.plugin`;
- `dist/SHA256SUMS`;
- `README.md`;
- `PATCH_PROCEDURE.md`;
- `CHANGELOG.md`.

Validacao:
- `build/build-plugins.sh`;
- `(cd dist && shasum -a 256 -c SHA256SUMS)`;
- `unzip -t dist/atlas-workflow-claude.plugin`;
- `unzip -t dist/atlas-workflow-codex.plugin`;
- `unzip -p ... plugin.json` para manifests Claude e Codex.

## v0.1.10 - 2026-05-31

Tipo: runtime

Resumo: torna o workflow autocontido no pacote, exige skill real no sub-agent e remove referências a executor inexistente.

Mudancas:
- adiciona `defaults/paths.md` e `references/subagent_dispatch.md` nas duas cópias versionadas;
- atualiza G3 para exigir carregamento do `SKILL.md` real pelo sub-agent;
- ajusta G5 com exclusão estreita para falso positivo `depende de plano`;
- remove menções ao executor inexistente e mantém `plan_execute` exato por família;
- atualiza versão para `0.1.10`.

Impacto:
- o workflow não depende de config na raiz do repositório usuário;
- sub-agent por fase passa a ter contrato verificável de skill carregada;
- ambiguidades reais continuam bloqueando entrevista, com exceção configurada e logada.

Arquivos/artefatos:
- `atlas-workflow-orchestrator/**`;
- `plugins/atlas-workflow-orchestrator/**`;
- `README.md`, `PATCH_PROCEDURE.md`, `CHANGELOG.md`;
- `atlas-workflow-orchestrator.plugin`.

Validacao:
- `rtk rg -n "Sem config|usa defaults|0\\.1\\.9" .`;
- diffs espelhados entre fonte e cópia Codex;
- validação JSON dos manifests;
- validação do pacote `.plugin`.

## 2026-05-30 - patch-procedure

Tipo: docs

Resumo: cria procedimento obrigatorio para patches/versionamento do Atlas Workflow Orchestrator.

Mudancas:
- adiciona `PATCH_PROCEDURE.md`;
- define pontos obrigatorios de versionamento;
- define regra de changelog para todo patch;
- define sincronizacao fonte Claude/copia Codex;
- define validacoes minimas e stop conditions.

Impacto:
- nao altera contrato runtime do plugin;
- torna rastreabilidade obrigatoria antes de patches maiores.

Arquivos/artefatos:
- `PATCH_PROCEDURE.md`;
- `CHANGELOG.md`;
- `README.md`.

Validacao:
- `rtk rg -n "version|Plugin version|Novidades|Changelog|v0\\.|0\\.1\\.9|Last updated|marketplace|plugin\\.json|atlas-workflow-orchestrator\\.plugin|README|codex-plugin|claude-plugin" .`;
- `rtk find . -maxdepth 4 -type f`;
- `rtk git status --short`.
