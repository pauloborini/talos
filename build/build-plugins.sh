#!/usr/bin/env bash
# Atlas Workflow — build dos pacotes .plugin (Claude/Cursor + Codex).
# Lê VERSION, monta bundle único (10 skills atlas-* + subagentes + orquestrador + templates), gera zips + checksums.
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

# Sub-agents despachados pelo orquestrador (Agent tool) — cada um precisa de arquivo
# de agente nativo no host. validator (frio) + executores (plan/direct, mutam código) +
# review (--review). handoff/interview/generator/orchestrator NÃO entram (autoria
# documental no fio principal). Fonte canônica: agents/<name>.md.
DISPATCHED_AGENTS=(
  atlas-task-validator
  atlas-findings-repair
  atlas-plan-execute
  atlas-direct-execute
  atlas-slice-review
)

copy_mcp_runtime() {
  local destination_parent="$1"
  cp -R "$ROOT/packages/mcp-server" "$destination_parent/"
  rm -f "$destination_parent/mcp-server"/*.test.js
  rm -rf "$destination_parent/mcp-server/fixtures"
  rm -rf "$destination_parent/mcp-server/.atlas"
}

assert_no_runtime_state() {
  local stage="$1"
  local leaked
  leaked="$(find "$stage" -type d -name .atlas -print -quit)"
  if [[ -n "$leaked" ]]; then
    echo "Estado local .atlas não pode entrar no bundle: ${leaked#$stage/}" >&2
    exit 4
  fi
}

# Guard de consistência roda no FIM (depois de sincronizar catálogos from-source),
# para que rebuild de catálogo stale não trave no próprio guard que ele corrige.

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
  # Subagentes do plugin (Claude/Cursor: agents/ na raiz do bundle)
  cp -R "$ROOT/agents" "$stage_host/agents"

  # Paths canônicos v0.3 usados pelas skills/MCP.
  mkdir -p "$stage_host/packages"
  cp -R "$ROOT/packages/skills" "$stage_host/packages/"
  cp -R "$ROOT/packages/templates" "$stage_host/packages/"
  # Testes e estado local não vão no bundle do host (rodam só em CI/dev).
  copy_mcp_runtime "$stage_host/packages"
  cp "$ROOT/VERSION" "$stage_host/VERSION"

  if [[ "$host" == "codex" ]]; then
    # Codex native subagents: custom agents in .codex/agents. These are generated
    # from the same canonical shims as Claude/opencode/pi, not from agents/openai.yaml
    # (that file remains skill UI/implicit-invocation metadata only).
    mkdir -p "$stage_host/.codex/agents"
    for ag in "${DISPATCHED_AGENTS[@]}"; do
      node "$ROOT/build/gen-host-agent.mjs" codex "$stage_host/.codex/agents/$ag.toml"
    done

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

  # Validação mínima do JSON gerado com Node, runtime já obrigatório.
  if ! node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$stage_host/$manifest_dir/plugin.json" >/dev/null 2>&1; then
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
  assert_no_runtime_state "$stage_host"
  rm -f "$out"
  # Build determinístico: ordem fixa, sem timestamps locais variando o zip
  ( cd "$stage_host" && find . -type f | LC_ALL=C sort | zip -X -q "$out" -@ )
}

# Build do host opencode (estrutura nativa .opencode/ + opencode.json), distinta
# do bundle plugin.json de claude/codex. Subagente gerado do canônico; MCP local
# com ATLAS_HOST=opencode injetado (detecção determinística). Catálogo from-source
# commitado em hosts/opencode/ (install via GitHub público — DEC-008).
build_opencode() {
  local stage="$STAGE/opencode"
  local out="$DIST/atlas-workflow-opencode.plugin"
  echo "montando opencode"
  mkdir -p "$stage/.opencode/agents" "$stage/.opencode/skills" "$stage/.opencode/atlas/packages"

  # Runtime bundlado sob .opencode/atlas/ (server lê ../../VERSION = .opencode/atlas/VERSION)
  copy_mcp_runtime "$stage/.opencode/atlas/packages"
  cp -R "$ROOT/packages/templates" "$stage/.opencode/atlas/packages/"
  cp -R "$ROOT/packages/orchestrator" "$stage/.opencode/atlas/"
  cp "$ROOT/VERSION" "$stage/.opencode/atlas/VERSION"

  # Skills (SKILL.md) sob .opencode/skills/
  cp -R "$ROOT/packages/skills/." "$stage/.opencode/skills/"
  rm -rf "$stage/.opencode/skills/atlas-workflow-orchestrator"
  cp -R "$ROOT/packages/orchestrator/skills/atlas-workflow-orchestrator" \
    "$stage/.opencode/skills/atlas-workflow-orchestrator"

  # Subagentes no formato opencode (gerados dos agentes canônicos — fonte única do corpo)
  for ag in "${DISPATCHED_AGENTS[@]}"; do
    node "$ROOT/build/gen-host-agent.mjs" opencode "$stage/.opencode/agents/$ag.md"
  done

  # Config MCP opencode (mcp local, ATLAS_HOST=opencode)
  cp "$ROOT/plugin-manifests/opencode/opencode.json" "$stage/opencode.json"

  echo "zipando opencode"
  assert_no_runtime_state "$stage"
  rm -f "$out"
  ( cd "$stage" && find . -type f | LC_ALL=C sort | zip -X -q "$out" -@ )

  echo "sincronizando catálogo opencode em hosts/opencode"
  rm -rf "$ROOT/hosts/opencode"
  mkdir -p "$ROOT/hosts"
  cp -R "$stage" "$ROOT/hosts/opencode"
}

# Build do host pi (pi cli). Estrutura: agents/ (pi-subagents), skills/, atlas/
# (runtime), mcp.json (pi-mcp-adapter, formato MCP padrão com ATLAS_HOST=pi).
# Requer as 2 deps obrigatórias no host (DEC-005); doc de integração cobre.
build_pi() {
  local stage="$STAGE/pi"
  local out="$DIST/atlas-workflow-pi.plugin"
  echo "montando pi"
  # pi-subagents descobre agentes em .pi/agents/**/*.md; pi-mcp-adapter lê .mcp.json
  # (paths reais das deps, verificados no pi real — não 'agents/'/'mcp.json' no root).
  mkdir -p "$stage/.pi/agents" "$stage/skills" "$stage/atlas/packages"

  copy_mcp_runtime "$stage/atlas/packages"
  cp -R "$ROOT/packages/templates" "$stage/atlas/packages/"
  cp -R "$ROOT/packages/orchestrator" "$stage/atlas/"
  cp "$ROOT/VERSION" "$stage/atlas/VERSION"

  cp -R "$ROOT/packages/skills/." "$stage/skills/"
  rm -rf "$stage/skills/atlas-workflow-orchestrator"
  cp -R "$ROOT/packages/orchestrator/skills/atlas-workflow-orchestrator" \
    "$stage/skills/atlas-workflow-orchestrator"

  # Subagentes no formato pi-subagents (gerados do canônico) em .pi/agents/ (path de descoberta)
  for ag in "${DISPATCHED_AGENTS[@]}"; do
    node "$ROOT/build/gen-host-agent.mjs" pi "$stage/.pi/agents/$ag.md"
  done

  # Config MCP pi (pi-mcp-adapter lê .mcp.json no root do projeto; ATLAS_HOST=pi)
  cp "$ROOT/plugin-manifests/pi/mcp.json" "$stage/.mcp.json"

  echo "zipando pi"
  assert_no_runtime_state "$stage"
  rm -f "$out"
  ( cd "$stage" && find . -type f | LC_ALL=C sort | zip -X -q "$out" -@ )

  echo "sincronizando catálogo pi em hosts/pi"
  rm -rf "$ROOT/hosts/pi"
  mkdir -p "$ROOT/hosts"
  cp -R "$stage" "$ROOT/hosts/pi"
}

# Build do host zcode (ZCode — Claude Agent SDK compat). Estrutura: .zcode-plugin/
# (manifest), agents/ (subagentes canônicos, mesmo formato claude .md), skills/,
# packages/ (MCP server + templates + orchestrator). MCP local com stdio; o host
# injeta ZCODE_PLUGIN_ROOT no env (comprovado no bundle zcode.cjs).
# Catálogo from-source commitado em hosts/zcode/ (install via GitHub público — DEC-008).
build_zcode() {
  local stage="$STAGE/zcode"
  local out="$DIST/atlas-workflow-zcode.plugin"
  echo "montando zcode"
  mkdir -p "$stage/.zcode-plugin" "$stage/agents" "$stage/skills" "$stage/packages"

  # Subagentes canônicos (mesmo formato claude — .md com frontmatter).
  # ZCode é Claude Agent SDK: descobre agents/ na raiz do plugin automaticamente.
  cp -R "$ROOT/agents/." "$stage/agents/"

  # Skills
  cp -R "$ROOT/packages/skills/." "$stage/skills/"
  rm -rf "$stage/skills/atlas-workflow-orchestrator"
  cp -R "$ROOT/packages/orchestrator/skills/atlas-workflow-orchestrator" \
    "$stage/skills/atlas-workflow-orchestrator"

  # Runtime + templates + orchestrator
  copy_mcp_runtime "$stage/packages"
  cp -R "$ROOT/packages/templates" "$stage/packages/"
  cp -R "$ROOT/packages/orchestrator" "$stage/packages/"
  cp "$ROOT/VERSION" "$stage/packages/mcp-server/VERSION"

  # Manifest .zcode-plugin (com VERSION injetada)
  local manifest_src="$ROOT/plugin-manifests/zcode/plugin.json"
  mkdir -p "$stage/.zcode-plugin"
  sed "s/__VERSION__/${VERSION}/g" "$manifest_src" > "$stage/.zcode-plugin/plugin.json"

  # Validação mínima do JSON gerado
  if ! node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$stage/.zcode-plugin/plugin.json" >/dev/null 2>&1; then
    echo "manifest gerado para zcode não é JSON válido" >&2
    exit 3
  fi

  echo "zipando zcode"
  assert_no_runtime_state "$stage"
  rm -f "$out"
  ( cd "$stage" && find . -type f | LC_ALL=C sort | zip -X -q "$out" -@ )

  echo "sincronizando catálogo zcode em hosts/zcode"
  rm -rf "$ROOT/hosts/zcode"
  mkdir -p "$ROOT/hosts"
  cp -R "$stage" "$ROOT/hosts/zcode"
}

for h in "${HOSTS[@]}"; do
  build_host "$h"
done

build_opencode
build_pi
build_zcode

(
  cd "$DIST"
  rm -f SHA256SUMS
  shasum -a 256 atlas-workflow-*.plugin | LC_ALL=C sort > SHA256SUMS
)

rm -rf "$STAGE"

# Guard final: catálogos from-source frescos, contrato validator cross-host,
# versão sincronizada, skills sem hardcode (M3/A1/A2 + S10).
if command -v node >/dev/null 2>&1; then
  node "$ROOT/build/check-consistency.mjs" || exit $?
else
  echo "aviso: node ausente — pulando check-consistency" >&2
fi

echo "ok — dist/atlas-workflow-{claude,codex,opencode,pi,zcode}.plugin dist/SHA256SUMS + hosts/{opencode,pi,zcode}/"
