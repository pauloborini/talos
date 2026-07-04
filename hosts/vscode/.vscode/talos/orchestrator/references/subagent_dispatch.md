# Despacho de sub-agent

Contrato host-agnóstico para Claude Code, Cursor, Codex App, Antigravity, ZCode, OpenCode e Pi CLI.

## Regra central

Cada fase mapeada a um `skill_id` pela configuração embutida do MCP roda em sub-agent foreground, blocking, um por vez.

A primeira ação do sub-agent deve ser carregar o `SKILL.md` completo do `skill_id` resolvido. Depois disso ele executa a skill.

Proibido:

- "aja como `<skill_id>`" sem carregar o `SKILL.md`;
- copiar resumo da skill para substituir a leitura real;
- executar plano/código/review no fio do orquestrador.

Equivalente aceito: mecanismo nativo do host que injete a skill completa no sub-agent.

## Codex

No Codex, ativar `$talos-task-validator` carrega skill no contexto atual, mas **não** cria isolamento frio. Para validação G4, o orquestrador deve chamar explicitamente o custom agent nativo:

```text
spawn_agent(agent_type: "talos-task-validator", items: [{ type: "text", text: "<state_path>" }])
```

O registro ativo desse agent vive em `CODEX_HOME/agents/talos-task-validator.toml` após `npx github:pauloborini/talos init codex`; o bundle mantém `.codex/agents/` como fonte gerada. O arquivo é gerado por `build/gen-host-agent.mjs` sem pin de modelo, herdando o default suportado pela conta/host. Se o host responder `unknown agent_type` ou rejeitar o despacho, a fase bloqueia (`blocked`/fail-closed). Proibido fallback para `default`, `$talos-task-validator`, execução inline ou validação no fio do orquestrador.

## ZCode

ZCode implementa o Claude Agent SDK. O mecanismo de sub-agent nominal é o **mesmo** do Claude:

```text
Agent(subagent_type: "talos-task-validator", prompt: "<state_path>")
```

O registro ativo do agent vive em `agents/<name>.md` na raiz do plugin (mesmo formato Claude, sem geração extra), descoberto pelo host via `.zcode-plugin/plugin.json`. O ZCode injeta `ZCODE_PLUGIN_ROOT` no env do subprocesso MCP (verificado no bundle `zcode.cjs`). Após `npx github:pauloborini/talos init zcode`, o catálogo `hosts/zcode/` é copiado para `~/.zcode/cli/plugins/cache/zcode-plugins-official/talos/<version>/` e habilitado em `~/.zcode/cli/config.json` (`enabledPlugins`).

### Limitação do host: sub-agentes de plugin não herdam MCP

**Confirmado empiricamente (v0.10.1, 2026-06):** sub-agentes despachados via `subagent_type: "talos-*"` (plugin) **não** recebem as conexões MCP do processo pai — mesmo com `mcp__plugin_talos_talos` declarado explicitamente no frontmatter `tools:`. Qualquer chamada MCP de dentro do subagente falha com `Required MCP server is not connected`. O subagente nativo `general-purpose` herda MCP + tools nativas normalmente. Bug do host (ZCode), não do plugin Talos.

### Workaround: fallback para `general-purpose`

O adapter zcode declara `subagent_dispatch.fallback.enabled: true`. Quando ativo, o orquestrador despacha o subagente **nativo** em vez do nominal:

```text
Agent(subagent_type: "general-purpose", prompt: <prompt_template>)
```

O `prompt_template` (de `talos_capabilities.subagent_dispatch.fallback`) aponta o subagente para ler `agents/<name>.md` (o `talos-<exec>` resolvido) como system prompt, repassando o `<input>` (`state_path` para validator/repair/review, `task` para executores). O contrato continua sendo a fonte única canônica `agents/<name>.md` — só muda quem carrega (subagente nativo em vez do de plugin).

**Por que o Gate G4/sibling permanece válido:** ainda é um subagente irmão isolado, despachado blocking. O `dispatch_token` e `challenge_response` continuam sendo ecoados **do output do irmão** (R19/R20) — nunca fabricados pelo orquestrador. O `lock_validator(start→complete)` opera no mesmo ciclo de vida. Mudou o `subagent_type` (nativo vs plugin), não a topologia.

**Atenção:** O perfil ZCode declara `dispatch_capability: 'unknown'` (DEC-008). Para modos que exigem mutação (`full`, `direct`, `execute`), o orquestrador deve verificar se o subagente tem Write/Edit/Bash e reportar `host_capabilities.dispatch_mutable: true` no `talos_preflight`. Sem esse report, o gate DISPATCH bloqueia no preflight (fail-fast <1s). O fallback não altera este gate — `general-purpose` é mutável, mas o orquestrador ainda precisa reportar. Modos read-only (`audit`, `interview-only`) passam sem report. ZCode é `self_evident` para PREREQ/JOIN, sem dependências externas.

## Payload mínimo

- `skill_id`
- `skill_md_path` ou indicação nativa equivalente da skill
- `prd_path` / `plan_path` / flags da fase
- instrução: "primeira ação: carregar a skill completa; segunda ação: executar a skill"

## Descoberta de `SKILL.md`

1. Mecanismo nativo de skills do host.
2. Diretório local de skills do host.
3. Workspace, apenas como fallback de descoberta.

Se não encontrar a skill `talos-*` exigida, abortar. Não trocar por skill nativa ou variante antiga. Não emular inline.
