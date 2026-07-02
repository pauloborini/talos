# State File Schema

Boundary canônico executor → validator. Também é a **context layer mínima** para retomar uma pipeline quebrada em outro host/LLM.

Objetivo: determinismo com baixo custo de token. O arquivo deve conter só dados verificáveis: IDs, paths, checks, hashes, status e referências. Não registrar narrativa, raciocínio, resumo longo, diff inline, plano copiado, PRD copiada, logs completos ou transcript.

Path:

```text
.talos/state/<run_id>/<slice>.json
```

Formato físico:

- JSON objeto único. Escrita compacta (`JSON.stringify(obj) + "\n"`) é preferida.
- Chaves em ordem canônica: campos obrigatórios primeiro, extensão depois, metadados no fim.
- Arrays vazios são `[]`; não criar placeholders verbosos.
- Cada item de evidência deve ser curto e auditável. Texto livre longo pertence ao PRD/PLAN referenciado, não ao state.

Schema legado mínimo (reader compatível):

```json
{
  "run_id": "string (uuid ou slug)",
  "slice": "string (ex.: 'A', 'B', 'C')",
  "tasks": ["T01", "T02"],
  "files_changed": ["packages/foo.js"],
  "diff_stat": "N files, +X -Y",
  "plan_path": ".talos/plans/<id>.plan.md",
  "boundary_refs": ["§2.I3", "§5.T11"],
  "executed_at": "ISO8601",
  "executor_skill": "talos-plan-execute"
}
```

Schema v2 compacto (writer atual, ordem canônica):

```json
{
  "state_schema_version": 2,
  "run_id": "string",
  "slice": "string",
  "base_sha": "40-char git commit SHA",
  "head_sha": "40-char git commit SHA",
  "contract_kind": "plan | direct",
  "tasks": ["T01"],
  "files_changed": ["packages/foo.js"],
  "diff_stat": "N files, +X -Y",
  "plan_path": ".talos/plans/<id>.plan.md",
  "boundary_refs": ["§2.I3", "§5.T11", "Sprint §9 EVAL-001"],
  "sprint_id": "S01",
  "sprint_file_path": ".talos/backlog/sprints/SPRINT_S01_slug.md",
  "prd_path": ".talos/prd/PRD_S01_slug.md",
  "contract_ids": {
    "obligations": ["O1"],
    "invariants": ["I1"],
    "scenarios": ["S1"],
    "risks": ["R1"]
  },
  "eval_results": [{"id": "EVAL-001", "status": "passed", "evidence": ["path/test/check"], "checks": [0]}],
  "policy_scope": {"allowed_scope": ["path"], "forbidden_scope": ["path"], "required_gates": ["talos_verify_sprint_file", "talos-task-validator"]},
  "check_table": ["node --test ..."],
  "validation_map": [{"obligation_ids": ["O1"], "checks": [0], "status": "passed"}],
  "task_evidence": [{"task": "T01", "files": [0], "checks": [0], "result": "passed"}],
  "repair_evidence": [{"finding_id": "F-001", "files": [0], "checks": [0], "status": "resolved"}],
  "worktree_baseline": [["preexisting.txt", "M", "<64 hex>"]],
  "worktree_final": [["packages/foo.js", "A", "<64 hex>"]],
  "executed_at": "ISO8601",
  "executor_skill": "talos-plan-execute"
}
```

Regras:

- `run_id`, `slice`, `tasks`, `files_changed`, `diff_stat`, `plan_path`, `boundary_refs`, `executed_at` e `executor_skill` são obrigatórios.
- `files_changed` contém paths relativos ao repositório consumidor.
- `boundary_refs` aponta para invariantes, contratos ou tasks do plano que delimitam a validação.
- O arquivo é uma projeção de boundary para o validator; estado de run continua tendo `talos_run_state` como fonte primária quando MCP estiver disponível.
- Writers atuais devem escrever `state_schema_version:2` em JSON compacto. Readers aceitam v1 e v2; v2 é normalizado internamente para o shape canônico antes dos gates.
- `contract_ids` referencia IDs autoritativos do PRD/PLAN/Sprint. Não copiar texto de `requirement`, `scenario`, `risk` ou `expected_evidence` para o state.
- `contract_kind=direct` exige `contract_ids.obligations` não vazio; `plan` mantém o contrato autoritativo em `plan_path`.
- Quando a execução nasce de sprint file, writers preenchem `sprint_id`, `sprint_file_path`, `prd_path`, `eval_results` e `policy_scope`.
- `eval_results` é a fonte única para claims `EVAL-*`; não persistir `evidence_to_claim` no v2. Todo `EVAL-*` do `eval_manifest` da sprint deve ter `status:"passed"` e evidência real. Claim ausente, `failed`, `blocked` ou sem evidência invalida o boundary.
- `policy_scope` é o resumo executável do `policy_manifest`; arquivo em `forbidden_scope` não pode aparecer em `files_changed`.
- `check_table` deduplica comandos/checks longos. Campos `checks` em `eval_results`, `validation_map`, `task_evidence` e `repair_evidence` referenciam índices dessa tabela.
- `task_evidence.files` e `repair_evidence.files` referenciam índices de `files_changed`.
- Writers capturam `worktree_baseline` antes da primeira mutação e `worktree_final` imediatamente antes do handoff. Ambos usam tuplas únicas/ordenadas `[path,status,sha256]`; `status` é `A|M|D|R|C|T|U`, delete usa `sha256:null`, symlink usa SHA-256 do target textual.
- Readers aceitam temporariamente o schema legado mínimo somente para `talos-plan-execute` sem `contract_kind`. `talos-direct-execute` nunca degrada para legado.
- `base_sha` e `head_sha` são commits explícitos; não inferir base pelo nome da branch. `files_changed` e os arquivos de `task_evidence`/`repair_evidence` devem ser exatamente o diff `base_sha...head_sha` somado ao delta `worktree_baseline→worktree_final`. Dirty preexistente byte/status-idêntico fica fora.
- `repair_evidence` é aditivo e obrigatório por finding P0/P1 estruturado após repair; o segundo validator correlaciona pelo mesmo `finding_id`.
- Limites de output: `task_evidence`, `validation_map`, `eval_results` e `contract_ids` devem registrar somente o necessário para o validator localizar a prova. Se a prova já está no `plan_path`, `sprint_file_path`, `prd_path`, comando de teste ou arquivo alterado, referencie o path/id; não reescreva o conteúdo.
- Proibido usar este arquivo como relatório humano. Relatório final fica na resposta do orquestrador; ledger de run fica em `run.json`; boundary frio fica aqui.
