#!/usr/bin/env bash
# Launcher stdio do MCP Talos para hosts Claude/Cursor.
# Resolve Node quando o spawn GUI tem PATH capado (ex.: Parall com HOME isolado).
#
# Importante (Parall / paths com espaço):
# o host deve spawnar com command="/bin/bash" e um script -c em args[],
# nunca com command="<path>/run.sh" — path com espaço no campo command
# quebra o spawn (ENOENT em "/Users/.../Library/Application").
# Grok/Cursor nem sempre expandem ${CLAUDE_PLUGIN_ROOT} no JSON; o plugin.json
# usa bash -c para expandir env (CLAUDE_PLUGIN_ROOT/PLUGIN_ROOT) ou achar o cache.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Cursor pode expandir ${CLAUDE_PLUGIN_ROOT} no manifest, mas nem sempre injeta a env no spawn.
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SERVER="$SCRIPT_DIR/server.js"

resolve_node() {
  local candidate
  local -a candidates=()

  if [[ "$(uname -s)" == "Darwin" ]]; then
    candidates+=("/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node")
  fi

  if [[ -n "${CURSOR_NODE:-}" ]]; then
    candidates+=("$CURSOR_NODE")
  fi

  candidates+=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "${HOME:-}/.local/bin/node"
  )

  local path_node
  path_node="$(command -v node 2>/dev/null || true)"
  if [[ -n "$path_node" ]]; then
    candidates+=("$path_node")
  fi

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    printf '%s\n' "$candidate"
    return 0
  done

  return 1
}

if [[ "${1:-}" == "--resolve-node" ]]; then
  resolve_node
  exit $?
fi

if [[ ! -f "$SERVER" ]]; then
  echo "talos-mcp: server ausente em $SERVER" >&2
  exit 1
fi

NODE_BIN="$(resolve_node)" || {
  echo "talos-mcp: Node.js não encontrado (PATH limitado no spawn MCP)." >&2
  echo "talos-mcp: Instale Node >=20 ou defina CURSOR_NODE com o binário do Cursor." >&2
  exit 127
}

export CLAUDE_PLUGIN_ROOT="$ROOT"
# Node compara argv[1] com import.meta.url; symlink no path do spawn quebra o boot stdio.
if command -v python3 >/dev/null 2>&1; then
  SERVER="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$SERVER")"
fi
exec "$NODE_BIN" "$SERVER" "$@"
