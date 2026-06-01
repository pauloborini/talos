# Atlas Workflow MCP Server

Servidor MCP mínimo do plugin Atlas Workflow v0.2.

## Tools

- `atlas_ping`: retorna saúde, identidade, versão e capacidades mínimas.
- `atlas_run_state`: cria, atualiza ou consulta estado de run em `.atlas-run/` no cwd do projeto consumidor.

## Contratos

- Transporte: stdio.
- Sem porta de rede.
- Persistência: `.atlas-run/<run_id>.json`.
- Log local: `.atlas-run/mcp.log`.
- Erro bloqueante: entradas inválidas, run inexistente ou falha de estado retornam erro JSON-RPC.
