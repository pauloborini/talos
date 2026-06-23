#!/usr/bin/env bash
# Suíte completa local (espelha o CI): build+guard, testes, smoke, conformance.
# Uso: bash build/test-all.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== build + check-consistency =="
bash "$ROOT/build/build-plugins.sh" >/dev/null
echo "== unit (node --test) =="
node --test "$ROOT/packages/mcp-server/server.test.js" 2>&1 | grep -E "ℹ (tests|pass|fail)"
echo "== unit (slice review findings gate) =="
node --test "$ROOT/build/tests/classify-findings.test.mjs" "$ROOT/build/tests/etapa3.test.mjs"
echo "== smoke por host =="
node "$ROOT/build/smoke-hosts.mjs" | tail -1
echo "== conformance multi-host =="
node "$ROOT/build/conformance-matrix.mjs" | tail -1
echo "== smoke install/uninstall =="
node "$ROOT/build/smoke-install.mjs" | tail -1
echo "== checksums =="
( cd "$ROOT/dist" && shasum -a 256 -c SHA256SUMS )
echo "OK — suíte completa verde"
