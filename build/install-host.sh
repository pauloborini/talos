#!/usr/bin/env bash
# Atlas Workflow — install/update helper para hosts sem marketplace CLI (opencode, pi).
# Copia o catálogo from-source commitado (hosts/<host>/) para a raiz do projeto-alvo.
# Idempotente: rodar de novo atualiza para a versão atual (atende invariante #3 —
# atualização simples, 1 comando). NÃO toca o caminho marketplace de claude/codex/cursor.
#
# Uso: build/install-host.sh <opencode|pi> <target-dir>
#   opencode → copia .opencode/ + opencode.json para <target-dir>/
#   pi       → copia atlas/ agents/ skills/ mcp.json para <target-dir>/
#
# Layout/cwd: o MCP roda via path relativo (.opencode/atlas/... ou atlas/...). O host
# DEVE lançar `node` com cwd em <target-dir>. Ver README (seções opencode/pi).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-}"
TARGET="${2:-}"

if [[ -z "$HOST" || -z "$TARGET" ]]; then
  echo "uso: build/install-host.sh <opencode|pi> <target-dir>" >&2
  exit 2
fi

case "$HOST" in
  opencode)
    SRC="$ROOT/hosts/opencode"
    VERSION_FILE="$SRC/.opencode/atlas/VERSION"
    ;;
  pi)
    SRC="$ROOT/hosts/pi"
    VERSION_FILE="$SRC/atlas/VERSION"
    ;;
  *)
    echo "host inválido: '$HOST' (use opencode ou pi)" >&2
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

echo "instalando atlas-workflow ($HOST v$VERSION) em $TARGET"

# cp -R do conteúdo do catálogo (inclui dotfiles como .opencode). Sobrescreve a
# instalação anterior — é o caminho de update.
cp -R "$SRC/." "$TARGET/"

if [[ "$HOST" == "pi" ]]; then
  echo "lembrete: pi exige 2 deps externas obrigatórias no host (DEC-005):"
  echo "  - pi-mcp-adapter  (MCP)    → pi install npm:pi-mcp-adapter"
  echo "  - pi-subagents    (subagente) → pi install npm:pi-subagents"
  echo "MCP em '$TARGET/.mcp.json' (descoberto pelo pi-mcp-adapter); subagente em '$TARGET/.pi/agents/'."
  echo "lance o pi com cwd em $TARGET; dispare o validator via tool subagent({agent:\"atlas-task-validator\", task:\"<state_path>\"})."
else
  echo "registre/mescle '$TARGET/opencode.json'; reinicie o opencode com cwd em $TARGET."
fi

echo "ok — confirme com a tool MCP atlas_ping (deve responder status=alive, version=$VERSION)."
