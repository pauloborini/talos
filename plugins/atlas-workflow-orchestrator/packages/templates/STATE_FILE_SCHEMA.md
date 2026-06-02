# State File Schema

Boundary canônico executor → validator.

Path:

```text
.atlas/state/<run_id>/<slice>.json
```

Schema mínimo:

```json
{
  "run_id": "string (uuid ou slug)",
  "slice": "string (ex.: 'A', 'B', 'C')",
  "tasks": ["T01", "T02"],
  "files_changed": ["packages/foo.js"],
  "diff_stat": "N files, +X -Y",
  "plan_path": ".atlas/plans/<id>.plan.md",
  "boundary_refs": ["§2.I3", "§5.T11"],
  "executed_at": "ISO8601",
  "executor_skill": "atlas-plan-execute"
}
```

Regras:

- `run_id`, `slice`, `tasks`, `files_changed`, `diff_stat`, `plan_path`, `boundary_refs`, `executed_at` e `executor_skill` são obrigatórios.
- `files_changed` contém paths relativos ao repositório consumidor.
- `boundary_refs` aponta para invariantes, contratos ou tasks do plano que delimitam a validação.
- O arquivo é uma projeção de boundary para o validator; estado de run continua tendo `atlas_run_state` como fonte primária quando MCP estiver disponível.
