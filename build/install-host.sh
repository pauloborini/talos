#!/usr/bin/env bash
# Talos — install/update helper para hosts sem marketplace CLI (opencode, pi).
# Copia o catálogo from-source commitado (hosts/<host>/) para a raiz do projeto-alvo.
# Idempotente: rodar de novo atualiza para a versão atual (atende invariante #3 —
# atualização simples, 1 comando). NÃO toca o caminho marketplace de claude/codex/cursor.
#
# Uso: build/install-host.sh <opencode|pi|zcode|vscode|mavis> <target-dir>
#   opencode → copia .opencode/ + opencode.json para <target-dir>/
#   pi       → copia talos/ agents/ skills/ mcp.json para <target-dir>/
#   vscode   → copia .vscode/ agents/ skills/ para <target-dir>/
#   mavis    → instala Plugin V1 do Talos em ~/.minimax/plugins/talos/ e gera
#              5 custom agents em ~/.minimax/agents/talos-*/config.yaml.
#              <target-dir> é a raiz do repo do Talos (lê packages/, agents/).
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
  mavis)
    SRC="$ROOT"  # packager do Mavis lê direto do repo (não usa catálogo from-source)
    VERSION_FILE="$ROOT/VERSION"
    ;;
  *)
    echo "host inválido: '$HOST' (use opencode, pi, zcode, vscode ou mavis)" >&2
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
# Mavis não usa catálogo from-source (Plugin V1 vai pra ~/.minimax/plugins/talos/);
# o target é só referência da raiz do repo.
if [[ "$HOST" != "mavis" ]]; then
  cp -R "$SRC/." "$TARGET/"
fi

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

if [[ "$HOST" == "mavis" ]]; then
  # Mavis usa Plugin V1 próprio. Layout obrigatório:
  #   ~/.minimax/plugins/talos/
  #     .minimax-plugin/plugin.json
  #     icon.png
  #     servers.mcp.json
  #     skills/<talos-*>/SKILL.md
  #   ~/.minimax/agents/talos-<name>/config.yaml  (5 custom agents)
  DATA_DIR="${MINIMAX_DATA_DIR:-$HOME/.minimax}"
  PLUGIN_DIR="$DATA_DIR/plugins/talos"
  AGENTS_DIR="$DATA_DIR/agents"

  echo "instalando Plugin V1 do Talos no Mavis..."
  echo "  DATA_DIR   = $DATA_DIR"
  echo "  PLUGIN_DIR = $PLUGIN_DIR"
  echo "  AGENTS_DIR = $AGENTS_DIR"

  mkdir -p "$PLUGIN_DIR/.minimax-plugin" \
           "$PLUGIN_DIR/skills" \
           "$AGENTS_DIR"

  # 0) Icon — PNG 1×1 RGBA mínimo (67 bytes; spec V1 exige PNG/JPEG/WebP).
  # Sem isso o runtime do Mavis rejeita o plugin (manifest referencia icon que
  # não existe). Garante a referência antes do manifest ser escrito.
  python3 -c "
import struct, zlib
def make_png():
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        c = zlib.crc32(t + d) & 0xffffffff
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', c)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
    raw = b'\x00\x00\x00\x00\x00'
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend
import sys
sys.stdout.buffer.write(make_png())
" > "$PLUGIN_DIR/icon.png"

  # 1) Manifest do Plugin V1
  cat > "$PLUGIN_DIR/.minimax-plugin/plugin.json" <<EOF
{
  "schemaVersion": 1,
  "name": "talos",
  "displayName": "Talos",
  "version": "$VERSION",
  "description": "Pipeline de desenvolvimento determinística (sprint file → plano → execução → validação fria) com MCP local, 5 subagentes e skills de orquestração. Integração com Mavis via Plugin V1.",
  "author": "Paulo Borini",
  "icon": "icon.png",
  "category": "Code",
  "exampleQueries": [
    "Use Talos to drive a sprint file through the deterministic pipeline.",
    "Quero rodar a pipeline do Talos nesse projeto."
  ],
  "apps": [],
  "mcpServers": ["servers.mcp.json"],
  "skills": [
    "skills/talos-audit/SKILL.md",
    "skills/talos-backlog-generator/SKILL.md",
    "skills/talos-direct-execute/SKILL.md",
    "skills/talos-findings-repair/SKILL.md",
    "skills/talos-memory-promote/SKILL.md",
    "skills/talos-plan-execute/SKILL.md",
    "skills/talos-plan-handoff/SKILL.md",
    "skills/talos-slice-review/SKILL.md",
    "skills/talos-sprint-interview/SKILL.md",
    "skills/talos-task-validator/SKILL.md"
  ]
}
EOF

  # 2) servers.mcp.json — MCP stdio com env TALOS_HOST=mavis injetado
  cat > "$PLUGIN_DIR/servers.mcp.json" <<EOF
{
  "schemaVersion": 1,
  "mcpServers": {
    "talos": {
      "type": "stdio",
      "command": "node",
      "args": ["$ROOT/packages/mcp-server/server.js"],
      "env": {
        "TALOS_HOST": "mavis"
      },
      "description": "MCP do Talos (gates, state, slice ledger, validator dispatch, sprint/plan state).",
      "timeout": 30000
    }
  }
}
EOF

  # 3) Skills — copia todos os SKILL.md de packages/skills/<name>/ para o Plugin V1
  if [[ -d "$ROOT/packages/skills" ]]; then
    for skill_dir in "$ROOT/packages/skills"/*/; do
      [[ -d "$skill_dir" ]] || continue
      name="$(basename "$skill_dir")"
      [[ -f "$skill_dir/SKILL.md" ]] || continue
      mkdir -p "$PLUGIN_DIR/skills/$name"
      cp "$skill_dir/SKILL.md" "$PLUGIN_DIR/skills/$name/SKILL.md"
    done
  fi

  # 4) Custom agents Mavis — 1 por agents/<talos-*.md> do Talos.
  # system_prompt = corpo do .md (sem frontmatter YAML).
  # Tool name do MCP no Mavis = mcp__<server>__<tool>. Server name = "talos"
  # (do servers.mcp.json), então o MCP do Talos chega como mcp__talos__<tool>.
  # O frontmatter dos .md canônicos declara mcp__plugin_talos_talos (padrão
  # Claude) só no `tools:` — não é texto que o subagente vê no system_prompt.
  # O Mavis injeta as tools MCP via runtime; o system_prompt continua sendo
  # o corpo do .md, portável entre hosts.
  if [[ -d "$ROOT/agents" ]]; then
    for agent_md in "$ROOT/agents"/talos-*.md; do
      [[ -f "$agent_md" ]] || continue
      name="$(basename "$agent_md" .md)"
      # description do frontmatter (segunda linha, sem aspas)
      description="$(awk '/^description:/{gsub(/^description: */,""); gsub(/^"|"$/,""); print; exit}' "$agent_md")"
      agent_dir="$AGENTS_DIR/$name"
      mkdir -p "$agent_dir"
      # Corpo do .md como system_prompt
      body="$(awk 'BEGIN{p=0} /^---$/{c++; next} c>=2{print}' "$agent_md")"
      # YAML safe quoting: usa single-quoted string (após dobrar single quotes
      # internas). Descriptions dos agents/*.md podem conter ':' e aspas, e
      # concatenar sem quoting quebra o parser (mapping values not allowed).
      desc_q="${description//\'/\'\'}"
      cat > "$agent_dir/config.yaml" <<EOF
name: $name
displayName: $name
description: '$desc_q'
systemPrompt: |
$(printf '%s\n' "$body" | sed 's/^/  /')
EOF
    done
  fi

  echo "Plugin V1 instalado em $PLUGIN_DIR"
  echo "Custom agents criados em $AGENTS_DIR (5 agents talos-*)"
  echo "para o Mavis reconhecer:"
  echo "  - feche a sessão atual e abra uma nova (re-scan automático)"
  echo "  - ou: settings → plugins → re-scan"
  echo "confirme com a tool MCP talos_ping (deve responder status=alive, version=$VERSION, host=mavis)."
fi

echo "ok — confirme com a tool MCP talos_ping (deve responder status=alive, version=$VERSION)."
