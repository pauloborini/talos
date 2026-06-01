# Atlas Workflow MCP Server

Servidor MCP mínimo do plugin Atlas Workflow v0.2.

## Tools

- `atlas_ping`: retorna saúde, identidade, versão e capacidades mínimas.
- `atlas_run_state`: cria, atualiza ou consulta estado de run em `.atlas-run/` no cwd do projeto consumidor.
- `atlas_verify_artifact`: Gate G1; verifica se artefato obrigatório existe e é legível.
- `atlas_scan_prd`: Gate G5; escaneia PRD por padrões determinísticos de ambiguidade bloqueante.
- `atlas_preflight`: Gate G10; valida família, modo e mapa oficial de skills pela config empacotada.
- `atlas_lock_family`: Gate G10; bloqueia troca de família ou skill fora do mapa oficial.

## Contratos

- Transporte: stdio.
- Sem porta de rede.
- Persistência: `.atlas-run/<run_id>.json`.
- Log local: `.atlas-run/mcp.log`.
- Gates: resultados persistidos em `data.gates`.
- Roteamento: lock persistido em `data.routing`.
- Erro bloqueante: entradas inválidas, run inexistente ou falha de estado retornam erro JSON-RPC; gate bloqueado retorna `status: "blocked"` e `next_action`.
