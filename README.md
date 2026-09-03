<!-- Language: **English** · [Português](README.pt-BR.md) -->
<p align="center">
  <img src="docs/assets/talos-logo.png" alt="Talos" width="200" height="200">
</p>

# Talos v0.21.2

**Talos** is a deterministic development pipeline: product contract (§7) → plan → isolated execution → cold validation. It ships as one public, free plugin for Claude Code, Cursor, Codex App, Antigravity, ZCode, OpenCode, Pi CLI, VS Code, and MinimaxCode.

**Version:** [`VERSION`](VERSION) (`0.21.2`) · **Command reference:** [COMMANDS.md](COMMANDS.md) · **Portuguese guide:** [README.pt-BR.md](README.pt-BR.md)

## Install

Node.js is required. Use the installer; it configures the selected host and its Talos MCP server.

```bash
npx github:pauloborini/talos init claudecode
npx github:pauloborini/talos init codex
npx github:pauloborini/talos init antigravity
npx github:pauloborini/talos init zcode
npx github:pauloborini/talos init opencode --global
npx github:pauloborini/talos init pi --global --yes
npx github:pauloborini/talos init vscode --global
npx github:pauloborini/talos init minimaxcode   # also: mavis | minimax-code | mmc
```

`--global` is recommended for OpenCode, Pi, and VS Code. For a project-only installation, omit it. Pi requires `pi-mcp-adapter` and `pi-subagents`; `--yes` installs missing dependencies.

Claude Code and Cursor can also use their native marketplace:

```bash
claude plugin marketplace add pauloborini/talos
claude plugin install talos@talos
```

For Codex, use `init codex`: it installs the plugin and the custom `talos-*` agents needed for isolated dispatch. Full install, update, uninstall, paths, and troubleshooting are in [COMMANDS.md](COMMANDS.md).

## Verify the installation

In the host, call:

```text
talos_ping
talos_capabilities
```

`talos_ping` must report the expected host and current version. `talos_capabilities` reports the host adapter and required dispatch/validation capabilities. A host missing required subagent or MCP support fails preflight instead of silently degrading.

## What's new in v0.21.2

Talos `0.21.2` hardens the deterministic slice model introduced in `0.21.0`:

- Direct-mode `reconcile` no longer promotes the internal sentinel `.talos/plans/direct.md` into a real `plan_path`, so a recovered direct slice keeps `contract_kind: direct`.
- Validator completion now resyncs `liveness.slice_commit_sha256` after persisting `acceptance_results`, which keeps the next post-fail commit on the real `repair` path instead of accidentally downgrading it to `reconcile`.
- Public and operational documentation now describe the hardened boundary/repair model explicitly, so release notes, install docs, and orchestrator docs stay aligned with the shipped behavior.

## Use Talos

Use `/talos <mode> <input-type> [input] [flags]` in Claude Code/Cursor. In other hosts, invoke the Talos orchestrator skill with the same arguments.

| Mode | Use it when | Result |
|---|---|---|
| `full` | New backlog item, sprint, or feature | Matures §7, plans, executes, and validates |
| `direct` | §7 is already approved and sealed | Executes without a separate plan-handoff phase |
| `execute` | A `PLAN_*.md` already exists | Validates then executes that plan; never regenerates it |
| `interview-only` | Decisions need to be closed | Interviews §7; does not implement |
| `audit` | You need a diagnosis only | Read-only audit; `--handoff` writes a plan without executing it |

Examples:

```text
/talos full sprint "S05"
/talos direct sprint "S05" --review
/talos full idea "configurable session cache TTL"
/talos execute plan "./.talos/plans/PLAN_S05_login.md"
/talos audit target "apps/web/src/auth" --scope "token renewal"
```

`full` and `direct` require a sprint with an approved §7 contract. `execute` is the only mode that accepts a standalone plan. When input type and typed mode conflict, the artifact type wins so Talos never generates a plan for a plan.

## Guarantees and gates

Talos is intentionally fail-closed. The preflight blocks execution when host capabilities do not satisfy required subagent, MCP, synchronous validator join, or mutable-dispatch gates. Every implementation slice is validated by a cold sibling validator before it can be declared ready.

The pipeline stores consumer-project artifacts under `.talos/`:

- `backlog/` — strategic index and sprint files;
- `plans/` — executable plans;
- `state/<run_id>/` — execution proof and acceptance results;
- `manual-validation/` — human smoke checks when automation is insufficient;
- `traceability/` — optional opt-in requirements ledger (traceability v1).

Automated proof can end at `manual_validation_pending` when a human smoke check remains. Only the human sync flow can validate or waive that check and promote the sprint to `done`.

## Contract, acceptance, and manual validation

Talos v0.21.2 rejects pre-v0.16 artifacts: start a new backlog and sprint rather than migrating an incomplete legacy contract. A sprint's §7 is the frozen product contract. Each acceptance criterion (`AC-*`) has an `origin` (`usuario`, `derivado:<path>`, or `premissa`); an assumption cannot support a Must/P0 acceptance criterion.

An execution state uses schema v3. `done` requires every `AC-*` to be proved and no pending manual check. When automated proof is complete but a human smoke check remains, Talos records `manual_validation_pending`: dependencies may proceed, but no handoff is emitted. Complete the report in `.talos/manual-validation/` with `talos_sync_manual_validation`; it either promotes the sprint to `done` or blocks the source when the smoke check fails.

```text
validator pass → manual_validation_pending
→ human completes MV-* report → talos_sync_manual_validation
→ done + HANDOFF_*.md
```

### Requirements traceability (opt-in, traceability v1)

A sprint can opt into requirements traceability by setting `Traceability: v1` in its metadata. Each requirement (`REQ-*`) is then recorded in the ledger `.talos/traceability/<backlog-slug>.json` through the single `talos_traceability` MCP tool (`upsert`, `verify`, `receipt`, `record_metric`), and each `AC-*` may declare `source_refs` pointing back to its requirements.

Closing a v1 sprint as `done` is gated: every requirement marked `included` must be linked to proved acceptance criteria, and the ledger markers must match the sprint markers in both directions. The closure receipt (coverage per requirement, exceptions, blockers) is a read-only projection returned by `talos_traceability receipt` — the orchestrator echoes it and never claims coverage itself. Sprints without the marker (legacy) keep the previous behavior unchanged.

## Backlog and execution model

Talos separates a concise strategic `BACKLOG_MESTRE_*.md` from live sprint files. The sprint file contains scope and its §7 contract; the MCP validates both artifacts, resolves dependencies, and selects the next action deterministically.

The normal chain is `talos-sprint-interview` → `talos-plan-handoff` → executor → `talos-task-validator`; `talos-findings-repair` runs only after a failed validator, and `talos-slice-review` runs with `--review` or when `critical_review.required` is set. The primary orchestrator authors the contract and plan, but never implementation code: mutations happen only in an isolated executor, then a sibling validator performs cold validation.

With `--loop`, sprints are pulled serially and review residuals self-correct in-loop (introduced in `0.20.0`, hardened in `0.21.2`): P0/P1 opens a repair with origin `slice_review`, a punctual verification executes the declared checks before judging and echoes a per-finding verdict (`resolved`/`not_resolved`/`regression`); persistent residuals go to the `talos-escalation-repair` sidecar (origin `escalation`), P2/P3 becomes a `PD-<sprint>-<NN>` entry in `PENDENCIAS_<slug>.md` (MCP-only writer) drained on demand, and an unrecoverable sprint is parked as `detached_repair`. There is never a second validator or a full re-review on the review branch.

Use direct skills only for their narrow purpose: `talos-backlog-generator` organizes demand; `talos-sprint-interview` seals §7; `talos-plan-handoff` creates a plan; `talos-audit` diagnoses without patching (and may write a handoff with `--handoff`); `talos-memory-promote` is an explicit post-`done` action. Never invoke `talos-task-validator` manually.

## Gates

The preflight verifies required subagent, MCP, synchronous validator join, mutable dispatch, version consistency, and lock availability. Additional gates validate the input, backlog, sprint file, dependencies, templates, acceptance scan, and execution order. A blocked gate stops the pipeline; Talos does not replace a missing deterministic result with prose.

The sibling validation loop is bounded: executor writes a state path, the orchestrator dispatches a cold sibling validator, and a P0/P1/P2 failure allows one repair and one final validator. A second failure ends as blocked. `critical_review` requires a green slice review before any sprint status can close. The review branch keeps its own bounded correction chain (repair with provenance → verification → escalation sidecar → `detached_repair` parking under `--loop`), with budget 1 per provenance enforced by the MCP.

## References

The MCP exposes 18 tools for preflight, artifacts, contracts, locks, state, sprint status, manual-validation sync, and requirements traceability. The detailed adapter contract is in [host adapters](packages/orchestrator/references/host-adapters.md); implementation-level references remain in Portuguese while the public installation and operational path is fully covered here and in [COMMANDS.md](COMMANDS.md).

## Hosts

| Host | Recommended path | Required extra dependency |
|---|---|---|
| Claude Code / Cursor | native marketplace | — |
| Codex App | `init codex` | — |
| Antigravity | `init antigravity` | — |
| ZCode | `init zcode` | — |
| OpenCode | `init opencode --global` | — |
| Pi CLI | `init pi --global --yes` | `pi-mcp-adapter`, `pi-subagents` |
| VS Code | `init vscode --global` | — |
| MinimaxCode | `init minimaxcode` | — |

Host adapters describe native differences; the pipeline contract stays portable. See [host adapters](packages/orchestrator/references/host-adapters.md).

## Repository map

- [`packages/`](packages/) — skills, templates, MCP;
- [`agents/`](agents/) — isolated execution and validation agents;
- [`hosts/`](hosts/) and [`plugin-manifests/`](plugin-manifests/) — host packaging;
- [`build/`](build/) — package generation, conformance, and smoke checks;
- [`CHANGELOG.md`](CHANGELOG.md) — releases and migrations;
- [COMMANDS.md](COMMANDS.md) — install/update/removal/troubleshooting reference.

## License

See [LICENSE](LICENSE).
