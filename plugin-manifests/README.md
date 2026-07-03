Manifests/configs fonte por host. A versão concreta é injetada do `VERSION` na raiz pelo build.

- `claude/` — manifest Claude Code; Cursor usa o mesmo artefato Claude.
- `codex/` — manifest Codex App.
- `opencode/` — config/catálogo from-source para opencode.
- `pi/` — config/catálogo from-source para pi cli.
- `zcode/` — manifest `.zcode-plugin` para ZCode.
- `vscode/` — MCP config (`.vscode/mcp.json`) para VS Code Copilot Chat.

Antigravity é instalado por `init antigravity` em `~/.gemini/config/` e não tem subdiretório em `plugin-manifests/`; o instalador gera a config necessária a partir das fontes do repo.
VS Code usa `mcp.json` padrão com `TALOS_HOST=vscode` injetado; o instalador `init vscode` coloca o runtime em `.vscode/talos/` (projeto) ou `~/.vscode-talos/` (global) e mescla o MCP no `settings.json` do usuário.
