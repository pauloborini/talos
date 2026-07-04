#!/usr/bin/env bash
# Talos — install/update helper para hosts sem marketplace CLI (opencode, pi).
# Copia o catálogo from-source commitado (hosts/<host>/) para a raiz do projeto-alvo.
# Idempotente: rodar de novo atualiza para a versão atual (atende invariante #3 —
# atualização simples, 1 comando). NÃO toca o caminho marketplace de claude/codex/cursor.
#
# Uso: build/install-host.sh <opencode|pi> <target-dir>
#   opencode → copia .opencode/ + opencode.json para <target-dir>/
#   pi       → copia talos/ agents/ skills/ mcp.json para <target-dir>/
#   vscode   → copia .vscode/ agents/ skills/ para <target-dir>/
#
# Layout/cwd: o MCP roda via path relativo (.opencode/talos/... ou talos/...). O host
# DEVE lançar `node` com cwd em <target-dir>. Ver README (seções opencode/pi).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-}"
TARGET="${2:-}"

if [[ -z "$HOST" || -z "$TARGET" ]]; then
  echo "uso: build/install-host.sh <opencode|pi|zcode|vscode> <target-dir>" >&2
  exit 2
fi

case "$HOST" in
  opencode)
    SRC="$ROOT/hosts/opencode"
    VERSION_FILE="$SRC/.opencode/talos/VERSION"
    ;;
  pi)
    SRC="$ROOT/hosts/pi"
    VERSION_FILE="$SRC/talos/VERSION"
    ;;
  zcode)
    SRC="$ROOT/hosts/zcode"
    VERSION_FILE="$SRC/packages/mcp-server/VERSION"
    ;;
  vscode)
    SRC="$ROOT/hosts/vscode"
    VERSION_FILE="$SRC/.vscode/talos/VERSION"
    ;;
  *)
    echo "host inválido: '$HOST' (use opencode, pi, zcode ou vscode)" >&2
    exit 2
    ;;
esac

if [[ ! -d "$SRC" ]]; then
  echo "catálogo from-source ausente: ${SRC#"$ROOT/"} (rode build/build-plugins.sh)" >&2
  exit 3
fi

VERSION="desconhecida"
if [[ -f "$VERSION_FILE" ]]; then
  VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi

mkdir -p "$TARGET"

echo "instalando talos ($HOST v$VERSION) em $TARGET"

# cp -R do conteúdo do catálogo (inclui dotfiles como .opencode). Sobrescreve a
# instalação anterior — é o caminho de update.
cp -R "$SRC/." "$TARGET/"

if [[ "$HOST" == "pi" ]]; then
  echo "lembrete: pi exige 2 deps externas obrigatórias no host (DEC-005):"
  echo "  - pi-mcp-adapter  (MCP)    → pi install npm:pi-mcp-adapter"
  echo "  - pi-subagents    (subagente) → pi install npm:pi-subagents"
  echo "MCP em '$TARGET/.mcp.json' (descoberto pelo pi-mcp-adapter); subagente em '$TARGET/.pi/agents/'."
  echo "lance o pi com cwd em $TARGET; dispare o validator via tool subagent({agent:\"talos-task-validator\", task:\"<state_path>\"})."
elif [[ "$HOST" == "zcode" ]]; then
  echo "lembrete: copie o conteúdo para o cache do ZCode e registre no marketplace.json:"
  echo "  cp -R . ~/.zcode/cli/plugins/cache/pauloborini/talos/<version>/"
  echo "  e registre em ~/.zcode/cli/plugins/marketplaces/pauloborini/marketplace.json"
  echo "  (ou use: npx github:pauloborini/talos init zcode)"
  echo "Subagente em '$TARGET/agents/'; ative via /plugins enable no ZCode."
elif [[ "$HOST" == "opencode" ]]; then
  echo "registre/mescle '$TARGET/opencode.json'; reinicie o opencode com cwd em $TARGET."
elif [[ "$HOST" == "vscode" ]]; then
  echo "instalação concluída em $TARGET."
  echo "para ativar no VS Code:"
  echo "  1. o MCP já está configurado em '$TARGET/.vscode/mcp.json' (TALOS_HOST=vscode)"
  echo "  2. copie os agentes para o prompt folder do VS Code:"
  echo "     cp -R $TARGET/agents/*.md ~/Library/Application Support/Code/User/prompts/"
  echo "     (ou %APPDATA%\\Code\\User\\prompts\\ no Windows)"
  echo "  3. copie as skills para o skills folder do VS Code:"
  echo "     cp -R $TARGET/skills/* ~/Library/Application Support/Code/User/prompts/"
  echo "  4. reinicie o VS Code ou recarregue a janela (Cmd+Shift+P → Reload Window)"
  echo "confirme com talos_ping (deve responder status=alive, version=$VERSION, host=vscode)."
fi

echo "ok — confirme com a tool MCP talos_ping (deve responder status=alive, version=$VERSION)."
