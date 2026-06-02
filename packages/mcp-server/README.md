# Atlas Workflow MCP Server

Servidor MCP mínimo do plugin Atlas Workflow v0.3.

## Tools

- `atlas_ping`: retorna saúde, identidade, versão e capacidades mínimas.
- `atlas_run_state`: cria, atualiza ou consulta estado de run em `.atlas/state/` no cwd do projeto consumidor.
- `atlas_verify_artifact`: Gate G1; verifica se artefato obrigatório existe e é legível.
- `atlas_scan_prd`: Gate G5; escaneia PRD por padrões determinísticos de ambiguidade bloqueante.
- `atlas_preflight`: Gate G10; valida modo, versão, lock ativo e mapa oficial de skills atlas-*.
- `atlas_lock_dispatch`: Gates G7/G8; controla fase ativa, ordem de dispatch e validator antes de review.
- `atlas_assert_after_plan`: Gate G11; bloqueia encerramento prematuro do modo full após plano validado.

## Contratos

- Transporte: stdio.
- Sem porta de rede.
- Persistência: `.atlas/state/<run_id>/run.json`.
- Log local: `.atlas/state/mcp.log`.
- Gates: resultados persistidos em `data.gates`.
- Roteamento: lock persistido em `data.routing`.
- Dispatch: fase ativa, próxima ação e histórico persistidos em `data.dispatch`.
- Erro bloqueante: entradas inválidas, run inexistente ou falha de estado retornam erro JSON-RPC; gate bloqueado retorna `status: "blocked"` e `next_action`.
