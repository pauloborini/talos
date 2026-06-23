# State File Schema

Boundary canônico executor → validator.

Path:

```text
.atlas/state/<run_id>/<slice>.json
```

Schema legado mínimo (reader compatível):

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

Extensão determinística (writer atual):

```json
{
  "base_sha": "40-char git commit SHA",
  "head_sha": "40-char git commit SHA",
  "contract_kind": "plan | direct",
  "obligations": [{"id": "O1", "requirement": "...", "expected_evidence": ["path/test/check"]}],
  "invariants": [{"id": "I1", "requirement": "...", "expected_evidence": ["path/check"]}],
  "scenario_probes": [{"id": "S1", "scenario": "...", "expected": "..."}],
  "risk_probes": [{"id": "R1", "risk": "...", "probe": "..."}],
  "validation_map": [{"obligation_ids": ["O1"], "checks": ["node --test ..."], "status": "passed"}],
  "task_evidence": [{"task": "T01", "files": ["packages/foo.js"], "checks": ["node --test ..."], "result": "passed"}],
  "repair_evidence": [{"finding_id": "F-001", "files_touched": ["packages/foo.js"], "checks_run": ["node --test ..."], "status": "resolved"}],
  "worktree_baseline": [{"path": "preexisting.txt", "status": "M", "sha256": "<64 hex>"}],
  "worktree_final": [{"path": "preexisting.txt", "status": "M", "sha256": "<64 hex>"}]
}
```

Regras:

- `run_id`, `slice`, `tasks`, `files_changed`, `diff_stat`, `plan_path`, `boundary_refs`, `executed_at` e `executor_skill` são obrigatórios.
- `files_changed` contém paths relativos ao repositório consumidor.
- `boundary_refs` aponta para invariantes, contratos ou tasks do plano que delimitam a validação.
- O arquivo é uma projeção de boundary para o validator; estado de run continua tendo `atlas_run_state` como fonte primária quando MCP estiver disponível.
- Writers atuais sempre preenchem a extensão. `contract_kind=direct` exige `obligations` não vazio; `plan` mantém o contrato autoritativo em `plan_path`.
- Writers capturam `worktree_baseline` antes da primeira mutação e `worktree_final` imediatamente antes do handoff. Ambos usam entradas únicas/ordenadas `{path,status,sha256}`; `status` é `A|M|D|R|C|T|U`, delete usa `sha256:null`, symlink usa SHA-256 do target textual.
- Readers aceitam temporariamente o schema legado mínimo somente para `atlas-plan-execute` sem `contract_kind`. `atlas-direct-execute` nunca degrada para legado.
- `base_sha` e `head_sha` são commits explícitos; não inferir base pelo nome da branch. `files_changed` e os arquivos de `task_evidence`/`repair_evidence` devem ser exatamente o diff `base_sha...head_sha` somado ao delta `worktree_baseline→worktree_final`. Dirty preexistente byte/status-idêntico fica fora.
- `repair_evidence` é aditivo e obrigatório por finding P0/P1 estruturado após repair; o segundo validator correlaciona pelo mesmo `finding_id`.
