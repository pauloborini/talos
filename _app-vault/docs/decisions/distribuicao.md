# Distribuição

Afeta: [distribuicao, install, hosts]

### DEC-015 — Marketplace-from-source é caminho primário

Instalar e atualizar em 1–2 comandos. Marketplace-from-source (GitHub público) é o caminho primário; artefato `.plugin`/release é secundário. Manifests crus na raiz são lidos direto do GitHub, sem build no cliente.

### DEC-016 — Expansão multi-host não quebra hosts existentes

Adicionar host = adicionar manifest/catálogo próprio na raiz + entrada em `HOST_ADAPTERS`. Nunca alterar o que Claude/Cursor/Codex já leem hoje. Cada host novo é caminho novo ao lado, não substituição.

### DEC-017 — Oito hosts suportados

Hosts: Claude Code, Cursor, Codex App, Antigravity (Gemini), opencode, pi cli, zcode e VS Code. Claude/Cursor/Codex via marketplace-from-source; Antigravity/opencode/pi/vscode via catálogo from-source em `hosts/` com `build/install-host.sh`. zcode via cache `~/.zcode/cli/plugins/cache/` (instalador `init zcode`) + ativação `/plugins enable`. pi exige `pi-mcp-adapter` + `pi-subagents` (ver DEC-005 em `determinismo.md`).

### DEC-018 — Versão concreta sincronizada

`.claude-plugin/plugin.json` e manifests de bundle (`plugins/talos/.codex-plugin/plugin.json`, cópias por host) têm versão concreta sincronizada com `VERSION`. `build/check-consistency.mjs` falha em drift. `plugins/talos/` e catálogos em `hosts/` são gerados por `build/build-plugins.sh` e precisam estar commitados em sincronia.

### DEC-019 — Mecanismo Claude/Cursor vs Codex

Claude Code e Cursor compartilham `.claude-plugin/` (mesmo manifest). Codex lê `.agents/plugins/marketplace.json` com source apontando para `plugins/talos/` commitado. Mexer em `.claude-plugin/` afeta Claude e Cursor ao mesmo tempo.

### DEC-039 — v0.21.0 BREAKING do procedimento de boundary

Skills 0.20 que ensinam baseline de `files_changed` no `first_write` e filtro por `proofs.files` não servem o 0.21. Semântica 0.18 nesse ponto é defeito (incidente loop S02). Disco v3 e schema MCP v5 podem permanecer se a projeção caber. Bump consciente + migração (DEC-009). Feature branch até `main` instalável (DEC-010).
