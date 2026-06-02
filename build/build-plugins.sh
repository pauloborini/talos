#!/usr/bin/env bash
# Atlas Workflow — build dos pacotes .plugin (Claude/Cursor + Codex).
# Lê VERSION, monta bundle único (7 skills atlas-* + 1 subagente + orquestrador + templates), gera zips + checksums.
# Idempotente; sem Node/npm. Aborta com exit != 0 em qualquer entrada faltante.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$ROOT/.build-stage"

HOSTS=(claude codex)

# --- Pré-flight (D7 fail-fast) ---
if [[ ! -f "$ROOT/VERSION" ]]; then
  echo "VERSION ausente na raiz do repo" >&2
  exit 2
fi
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
if [[ -z "$VERSION" ]]; then
  echo "VERSION vazio" >&2
  exit 2
fi

REQUIRED_PATHS=(
  "$ROOT/packages/skills"
  "$ROOT/agents"
  "$ROOT/packages/templates"
  "$ROOT/packages/orchestrator"
  "$ROOT/packages/mcp-server"
  "$ROOT/plugin-manifests/claude/plugin.json"
  "$ROOT/plugin-manifests/codex/plugin.json"
)
for p in "${REQUIRED_PATHS[@]}"; do
  if [[ ! -e "$p" ]]; then
    echo "Entrada obrigatória ausente: ${p#$ROOT/}" >&2
    exit 2
  fi
done

echo "lendo VERSION ($VERSION)"

# Guards de consistência (M3 drift do validator + regressões A1/A2)
if command -v node >/dev/null 2>&1; then
  node "$ROOT/build/check-consistency.mjs" || exit $?
else
  echo "aviso: node ausente — pulando check-consistency" >&2
fi

mkdir -p "$DIST"
rm -rf "$STAGE"
mkdir -p "$STAGE"

build_host() {
  local host="$1"
  local stage_host="$STAGE/$host"
  local out="$DIST/atlas-workflow-${host}.plugin"

  echo "montando $host"
  mkdir -p "$stage_host"

  # Bundle compartilhado (idêntico entre hosts)
  cp -R "$ROOT/packages/templates" "$stage_host/"
  cp -R "$ROOT/packages/orchestrator" "$stage_host/"
  cp -R "$ROOT/hooks" "$stage_host/"
  cp -R "$ROOT/packages/skills" "$stage_host/skills"
  rm -rf "$stage_host/skills/atlas-workflow-orchestrator"
  cp -R "$ROOT/packages/orchestrator/skills/atlas-workflow-orchestrator" \
    "$stage_host/skills/atlas-workflow-orchestrator"
  # Subagentes do plugin (descobertos via agents/ na raiz do bundle)
  cp -R "$ROOT/agents" "$stage_host/agents"

  # Paths canônicos v0.3 usados pelas skills/MCP.
  mkdir -p "$stage_host/packages"
  cp -R "$ROOT/packages/skills" "$stage_host/packages/"
  cp -R "$ROOT/packages/templates" "$stage_host/packages/"
  cp -R "$ROOT/packages/mcp-server" "$stage_host/packages/"
  # Testes não vão no bundle do host (rodam só em CI/dev).
  rm -f "$stage_host/packages/mcp-server"/*.test.js
  cp "$ROOT/VERSION" "$stage_host/VERSION"

  if [[ "$host" == "codex" ]]; then
    cat > "$stage_host/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "atlas-workflow": {
      "command": "node",
      "cwd": ".",
      "args": [
        "packages/mcp-server/server.js"
      ],
      "transport": "stdio"
    }
  }
}
JSON
  fi

  # Manifest do host, com VERSION injetada
  local manifest_src="$ROOT/plugin-manifests/$host/plugin.json"
  local manifest_dir
  case "$host" in
    claude) manifest_dir=".claude-plugin" ;;
    codex)  manifest_dir=".codex-plugin"  ;;
    *) echo "host desconhecido: $host" >&2; exit 2 ;;
  esac
  mkdir -p "$stage_host/$manifest_dir"
  sed "s/__VERSION__/${VERSION}/g" "$manifest_src" > "$stage_host/$manifest_dir/plugin.json"

  # Validação mínima do JSON gerado (parse com python3, sem dep extra de runtime)
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$stage_host/$manifest_dir/plugin.json" >/dev/null 2>&1; then
    echo "manifest gerado para $host não é JSON válido" >&2
    exit 3
  fi

  if [[ "$host" == "codex" ]]; then
    local marketplace_plugin="$ROOT/plugins/atlas-workflow-orchestrator"
    echo "sincronizando marketplace Codex em plugins/atlas-workflow-orchestrator"
    rm -rf "$marketplace_plugin"
    cp -R "$stage_host" "$marketplace_plugin"
  fi

  echo "zipando $host"
  rm -f "$out"
  # Build determinístico: ordem fixa, sem timestamps locais variando o zip
  ( cd "$stage_host" && find . -type f | LC_ALL=C sort | zip -X -q "$out" -@ )
}

for h in "${HOSTS[@]}"; do
  build_host "$h"
done

(
  cd "$DIST"
  rm -f SHA256SUMS
  shasum -a 256 atlas-workflow-*.plugin | LC_ALL=C sort > SHA256SUMS
)

rm -rf "$STAGE"

echo "ok — dist/atlas-workflow-claude.plugin dist/atlas-workflow-codex.plugin dist/SHA256SUMS"
