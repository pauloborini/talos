# S13 QA Matrix Evidence

Status: NO-GO for S14
Date: 2026-06-01
Scope: PRD_S13_qa_matrix.md

## Summary

S13 executed host/plugin readiness smokes and found two blocking packaging issues before the full functional matrix could be executed:

- Codex plugin install failed because `plugin.json` pointed `skills` to a non-existent contract path and inlined `mcpServers`.
- Codex MCP startup failed because the MCP server emitted `Content-Length` framed responses while Codex RMCP expects newline-delimited JSON-RPC.

Both issues were repaired in S13. After repair, Claude, Cursor and Codex host/plugin smokes passed.

Continuation evidence found one more host-specific packaging issue:

- Claude/Cursor plugin loaded from the packaged zip did not expose the bundled MCP server. The plugin had to be unpacked and the Claude manifest had to reference the MCP server with `${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/server.js`.
- Codex CLI usage limit later reset. The installed plugin initially did not expose Talos MCP because the Codex `.mcp.json` launched the server from the consumer workspace. Adding `cwd: "."` to the packaged Codex MCP config made installed-plugin MCP autoexposure work.
- A Codex full run then exposed a state-root mismatch: `cwd: "."` made state land in the plugin cache. The MCP stateful tools now accept `project_root`, preserving portable plugin startup while writing ledger and resolving relative artifacts against the consumer workspace.

The full functional matrix is not green yet. Full/direct/interview-only runs and positive/negative cases per host still require real manual execution with run evidence. S14 remains blocked until that matrix is executed or a product decision explicitly accepts the remaining risk.

## Environment

| Host | Binary | Version/status |
|---|---|---|
| Claude Code | `/Users/pauloborini/.local/bin/claude` | `2.1.159 (Claude Code)` |
| Cursor Agent | `/usr/local/bin/cursor agent` | logged in as `dev2@zavii.com.br` |
| Codex CLI | `/Applications/Codex.app/Contents/Resources/codex` | `codex-cli 0.135.0-alpha.1` |

## Complete Matrix Catalog

Legend: this table is the complete required coverage catalog. Values other than `PENDING` summarize real functional evidence from `S13-F*`; the detailed run evidence remains below.

| Host | Mode | Backlog item | Existing PRD | Idea | Brainstorm |
|---|---|---:|---:|---:|---:|
| Claude | full | PENDING | FAIL / timeout (`S13-F04`) | PENDING | PENDING |
| Claude | direct | PENDING | PASS + expected block (`S13-F01`, `S13-F02`) | PENDING | PENDING |
| Claude | interview-only | PENDING | PENDING | PENDING | PENDING |
| Cursor | full | PENDING | PENDING | PENDING | PENDING |
| Cursor | direct | PENDING | PENDING | PENDING | PENDING |
| Cursor | interview-only | PENDING | PENDING | PENDING | PARTIAL (`S13-F03`) |
| Codex | full | PENDING | PASS (`S13-F07`) | PENDING | PENDING |
| Codex | direct | PENDING | PENDING | PENDING | PENDING |
| Codex | interview-only | PENDING | PENDING | PENDING | PASS MCP gates / no implementation (`S13-F05`, `S13-F06`) |

## Executed Readiness Evidence

| ID | Host | Command class | Result | Evidence |
|---|---|---|---|---|
| S13-R01 | Claude | bare CLI | PASS | `CLAUDE_BARE_OK` |
| S13-R02 | Claude | plugin smoke | PASS | `CLAUDE_PLUGIN_OK` |
| S13-R03 | Cursor | bare CLI | PASS | `CURSOR_BARE_OK` |
| S13-R04 | Cursor | plugin smoke, text output | OBSERVATION | no output after 90s; process killed |
| S13-R05 | Cursor | plugin smoke, `stream-json` | PASS | session `c523fc93-192a-4e27-8473-48b88498ace6`, result `CURSOR_PLUGIN_STREAM_OK` |
| S13-R06 | Codex | bare CLI | PASS | session `019e8155-39d7-79e0-88fa-d27023a2c906`, result `CODEX_BARE_OK` |
| S13-R07 | Codex | plugin install before repair | FAIL | `missing or invalid plugin.json` |
| S13-R08 | Codex | plugin install after repair | PASS | cache path under `.codex/plugins/cache/talos-s13/.../0.2.0-dev` |
| S13-R09 | Codex | plugin smoke after install | PASS | session `019e815e-e821-7b42-9805-b1b725cc2a43`, result `CODEX_PLUGIN_OK_3` |
| S13-R10 | Claude | plugin MCP from zip | FAIL | `MCP_NOT_AVAILABLE` |
| S13-R11 | Claude | plugin MCP from unpacked dir after path repair | PASS | `talos_ping` returned `status: alive`, `version: 0.2.0-dev`, 9 capabilities |
| S13-R12 | Codex | MCP via explicit `mcp_servers.*` config + approval bypass | PASS | session `019e8350-13cf-7a01-b5b6-7edac9ac8269`; `talos_ping` returned `status: alive`, `version: 0.2.0-dev`, 9 capabilities |
| S13-R13 | Codex | installed plugin MCP autoexposure before `cwd` repair | FAIL | session `019e8350-b437-7e33-bbe0-51f3139dc1a8`; `tool_search` found 0 Talos tools, MCP resources/templates empty |
| S13-R14 | Codex | installed plugin MCP autoexposure after `cwd: "."` repair | PASS | session `019e8358-5be8-7d03-abe1-0dba0773b004`; `talos_ping` returned `status: alive`, `version: 0.2.0-dev`, 9 capabilities |
| S13-R15 | Codex | installed plugin full run with explicit `project_root` | PASS | session `019e8365-4e3b-7042-a1d6-abbe05e45f77`; final `CODEX_FULL_POSITIVE_PROJECT_ROOT_OK`; ledger created under the consumer workspace state directory |

## Repairs Applied

| Finding | Severity | Repair |
|---|---:|---|
| Codex plugin manifest used invalid install contract | P1 | `plugin-manifests/codex/plugin.json` now points `skills` to `./skills/` and `mcpServers` to `./.mcp.json`; build creates both. |
| Codex MCP could not parse server responses | P1 | `packages/mcp-server/server.js` now emits newline-delimited JSON-RPC responses. Input parser accepts newline-delimited requests plus `Content-Length` frames with CRLF or LF-only headers. |
| Claude/Cursor plugin did not expose MCP from packaged path | P1 | `plugin-manifests/claude/plugin.json` now resolves the MCP server through `${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/server.js`. |
| Codex installed plugin did not expose bundled MCP from consumer workspace | P1 | `build/build-plugins.sh` now emits `.mcp.json` with `cwd: "."`, so Codex launches `packages/mcp-server/server.js` relative to the installed plugin root. |
| Codex installed plugin wrote ledger to plugin cache after `cwd: "."` | P1 | Stateful MCP tools now accept optional `project_root`; Codex host runs can keep portable MCP startup and still write state in the consumer workspace. |

## Functional Matrix Evidence

| ID | Host | Mode | Input type | Result | Evidence |
|---|---|---|---|---|---|
| S13-F01 | Claude | direct | existing PRD | PASS | `run_id=talos-s13-qa-20260601`; state ledger present; `qa-output.txt` contains `QA_OK`; G10/G1/G5/template_conformance passed |
| S13-F02 | Claude | direct | ambiguous PRD | PASS expected block | `run_id=run-s13-qa-20260601-001`; state ledger present; G5 blocked with 7 ambiguity matches; template_conformance blocked with 4 pendencies; no requested implementation executed |
| S13-F03 | Cursor | interview-only | brainstorm | PARTIAL | Legacy v0.2 evidence; family lock tool removed in v0.3; final status `interview_completed_recommendations`; user confirmation still pending |
| S13-F04 | Claude | full | existing PRD | FAIL / timeout | no output after 4 minutes; process killed; no completed full ledger |
| S13-F05 | Codex | interview-only | brainstorm | BLOCKED host dependency | initial Codex CLI returned usage limit: `try again at 5:39 AM`; no functional Codex run executed |
| S13-F06 | Codex | interview-only | brainstorm | PASS MCP gates / no implementation | Legacy v0.2 evidence; family lock tool removed in v0.3; implementation_performed `false` |
| S13-F07 | Codex | full | existing PRD | PASS | session `019e8365-4e3b-7042-a1d6-abbe05e45f77`; final `CODEX_FULL_POSITIVE_PROJECT_ROOT_OK`; `run_id=talos-s13-codex-full-positive-project-root-20260601`; state ledger present; `qa-output.txt` is exactly 5 bytes `QA_OK`; G10/G1/G5/template_conformance/G7/G11 expected block/G8 passed |

## Direct MCP Contract Probes

These probes exercise the MCP contract directly. They are not substitutes for host-level functional QA.

| ID | Scope | Result | Evidence |
|---|---|---|---|
| S13-MCP-FULL-01 | full flow gate sequence | PASS contract / not host QA | fresh workspace `/private/tmp/talos-s13-full-probe-clean2`; `run_id=talos-s13-full-mcp-probe-clean2-20260601`; `talos_preflight`, PRD G1/G5/template_conformance, PLAN G1/template_conformance, `talos_lock_dispatch` plan_handoff start/complete, `talos_assert_after_plan` expected block for `completed_without_execute`, and plan_execute start/complete with validator `passed` all returned expected statuses |

## Checks

| Check | Result |
|---|---|
| `node --check packages/mcp-server/server.js` | PASS |
| MCP newline initialize probe | PASS |
| MCP `Content-Length` initialize probe with CRLF header | PASS |
| MCP `Content-Length` initialize probe with LF-only header | PASS |
| `build/build-plugins.sh` | PASS |
| `unzip -t dist/talos-codex.plugin` | PASS |
| Claude plugin smoke | PASS |
| Cursor plugin smoke via `stream-json` | PASS |
| Codex plugin install + smoke | PASS |
| Claude unpacked plugin MCP ping | PASS |
| Claude direct positive workflow with MCP ledger | PASS |
| Claude direct ambiguous workflow with expected MCP block | PASS |
| Cursor interview-only workflow with MCP ledger | PARTIAL |
| Claude full workflow | FAIL / timeout |
| Codex functional workflow | PARTIAL / full matrix incomplete |
| Codex explicit MCP config `talos_ping` with approval bypass | PASS |
| Codex installed plugin MCP autoexposure | PASS |
| Codex installed plugin interview-only MCP gates | PASS |
| Codex installed plugin full workflow with `project_root` ledger | PASS |
| Direct MCP full gate sequence | PASS contract / not host QA |

## Dist Evidence

| Artifact | Evidence |
|---|---|
| `dist/talos-claude.plugin` | `unzip -p ... .claude-plugin/plugin.json` contains `${CLAUDE_PLUGIN_ROOT}/packages/mcp-server/server.js`; `unzip -l` contains `orchestrator/references/qa_s13_matrix.md`; `unzip -t` passed |
| `dist/talos-codex.plugin` | `unzip -p ... .mcp.json` contains `cwd: "."`; `packages/mcp-server/server.js` accepts `project_root`; `unzip -t` passed; `unzip -l` contains `orchestrator/references/qa_s13_matrix.md` |

## Go/No-Go

NO-GO for S14.

Reason: PRD S13 requires the critical subset to cover at least one positive and one negative path per host and to validate full/direct/interview-only behavior. This run now proves Claude direct positive/negative, Cursor interview-only partial behavior with live MCP evidence, Codex installed-plugin MCP exposure, Codex interview-only MCP gates, and Codex full positive flow, but it still does not prove one positive and one negative functional workflow per host.

Required next action:

1. Re-run full mode with bounded timeout and verify `PLAN_*.md`, `talos_assert_after_plan`, execution and validator evidence.
2. Complete Cursor interview with explicit user answer or mark it as intentionally waived by product.
3. Execute at least one positive and one negative functional workflow run per host.
4. Reclassify go/no-go only after the critical subset is green or explicitly waived.
