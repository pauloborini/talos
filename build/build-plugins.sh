#!/usr/bin/env bash
# Atlas Workflow — build dos pacotes .plugin (Claude + Codex).
# Lê VERSION, monta bundle único (21 skills + orquestrador + templates), gera 2 zips.
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
  "$ROOT/packages/skills-claude"
  "$ROOT/packages/skills-cursor"
  "$ROOT/packages/skills-codex"
  "$ROOT/packages/templates"
  "$ROOT/packages/orchestrator"
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
  cp -R "$ROOT/packages/skills-claude" "$stage_host/"
  cp -R "$ROOT/packages/skills-cursor" "$stage_host/"
  cp -R "$ROOT/packages/skills-codex" "$stage_host/"
  cp -R "$ROOT/packages/templates" "$stage_host/"
  cp -R "$ROOT/packages/orchestrator" "$stage_host/"

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

  echo "zipando $host"
  rm -f "$out"
  # Build determinístico: ordem fixa, sem timestamps locais variando o zip
  ( cd "$stage_host" && find . -type f | LC_ALL=C sort | zip -X -q "$out" -@ )
}

for h in "${HOSTS[@]}"; do
  build_host "$h"
done

rm -rf "$STAGE"

echo "ok — dist/atlas-workflow-claude.plugin dist/atlas-workflow-codex.plugin"
