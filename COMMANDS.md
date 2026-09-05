<!-- Language: **English** · [Português](COMMANDS.pt-BR.md) -->

# Talos — command reference

Commands below install, update, or remove only Talos artifacts. Existing user configuration, skills, and MCP servers are preserved.

## Update

```bash
# Claude Code / Cursor
claude plugin marketplace update talos
claude plugin update talos@talos

# Other hosts: reinstall the current runtime
npx github:pauloborini/talos init codex
npx github:pauloborini/talos init antigravity
npx github:pauloborini/talos init zcode
npx github:pauloborini/talos init opencode --global
npx github:pauloborini/talos init pi --global --yes
npx github:pauloborini/talos init vscode --global
npx github:pauloborini/talos init minimaxcode
```

After an update, call `talos_ping` and `talos_capabilities` in the host. `talos_ping` should report `version: 0.23.0`.

## Install

```bash
# Detect and install every available host
npx github:pauloborini/talos init all

# Individual hosts
npx github:pauloborini/talos init claudecode   # Cursor uses the same marketplace
npx github:pauloborini/talos init codex
npx github:pauloborini/talos init antigravity
npx github:pauloborini/talos init zcode
npx github:pauloborini/talos init opencode --global
npx github:pauloborini/talos init pi --global --yes
npx github:pauloborini/talos init vscode --global
npx github:pauloborini/talos init minimaxcode   # also: mavis | minimax-code | mmc
```

Omit `--global` for a project-only OpenCode, Pi, or VS Code installation. Use `--dry-run` to inspect changes without applying them.

## Uninstall

```bash
npx github:pauloborini/talos uninstall all
npx github:pauloborini/talos uninstall claudecode
npx github:pauloborini/talos uninstall codex
npx github:pauloborini/talos uninstall antigravity
npx github:pauloborini/talos uninstall zcode
npx github:pauloborini/talos uninstall opencode --global
npx github:pauloborini/talos uninstall pi --global
npx github:pauloborini/talos uninstall vscode --global
npx github:pauloborini/talos uninstall minimaxcode
```

For a project-only install, omit `--global` for OpenCode, Pi, or VS Code.

## Flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--global`, `-g` | OpenCode, Pi, VS Code | Install for all projects |
| `--dir <dir>` | Project-only installs | Select target directory |
| `--yes`, `-y` | Pi `init` | Install missing required dependencies |
| `--dry-run` | all | Print changes without writing |
| `-h`, `--help` | all | Show command help |

## Smoke test

Do not invoke `talos-task-validator` directly: Talos dispatches it with a real state file during a pipeline run.

```text
talos_ping
talos_capabilities
```

For a sprint requiring manual smoke validation, update its report under `.talos/manual-validation/` and call `talos_sync_manual_validation`; do not invent a verdict in the state file.

## Documentation check

```bash
node build/check-public-docs.mjs
```

Checks that each public English/Portuguese document pair exists and cross-links from its header.

## Troubleshooting

`Failed to finalize marketplace cache` or `EACCES` under the Claude marketplace usually means a prior installation created files as `root`. Do not run Talos with `sudo`; repair ownership/cache according to your host policy, then rerun `init claudecode` without `sudo`.

## Platforms

macOS and Linux are supported. Windows paths are handled by the installer; the runtime smoke is not yet fully validated there.
