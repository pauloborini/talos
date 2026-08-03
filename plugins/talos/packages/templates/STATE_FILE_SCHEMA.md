# State File Schema

Boundary canônico executor → validator. Também é a **context layer mínima** para retomar uma pipeline quebrada em outro host/LLM.

Objetivo: determinismo com baixo custo de token. O arquivo deve conter só dados verificáveis: IDs, paths, checks, hashes, status e referências. Não registrar narrativa, raciocínio, resumo longo, diff inline, plano copiado, contrato §7 copiado, logs completos ou transcript.

Path:

```text
.talos/state/<run_id>/<slice>.json
```

Formato físico:

- JSON objeto único. Escrita compacta (`JSON.stringify(obj) + "\n"`) é preferida.
- Chaves em ordem canônica: campos obrigatórios primeiro, extensão depois, metadados no fim.
- Arrays vazios são `[]`; não criar placeholders verbosos.
- Cada item de evidência deve ser curto e auditável. Texto livre longo pertence ao PLAN/sprint §7 referenciado, não ao state.

Schema legado mínimo (reader compatível): removido em 0.15. `state_schema_version: 3` é obrigatório; v1/v2 são hard-fail (D19: artefatos pré-0.15 não suportados).

Schema v3 compacto (writer atual, ordem canônica):

```json
{
  "state_schema_version": 3,
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
  "prd_path": null,
  "contract_ids": {
    "obligations": ["O1"],
    "invariants": ["I1"],
    "scenarios": ["S1"],
    "risks": ["R1"]
  },
  "eval_results": [{"id": "EVAL-001", "status": "passed", "evidence": ["path/test/check"], "checks": [0]}],
  "proof_refs": {
    "AC-001": {"checks": [0], "files": [0]},
    "AC-002": {"checks": [1], "files": [0, 1]}
  },
  "acceptance_results": [{"id": "AC-001", "status": "proved", "proof_types": ["T-outcome:proved", "I:present"]}],
  "policy_scope": {"forbidden_scope": ["path"], "required_gates": ["talos_verify_sprint_file", "talos-task-validator"]},
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
- Writers atuais devem escrever `state_schema_version:3`. Readers rejeitam v1 e v2 (hard-fail); v3 é normalizado internamente para o shape canônico antes dos gates. Artefatos pré-0.15 não são suportados (D19).
- `contract_kind` é obrigatório em v3 (plan ou direct); o caminho legacy mínimo sem extensão foi removido.
- `base_sha` e `head_sha` são obrigatórios em v3; `worktree_baseline` e `worktree_final` também.
- `contract_ids` referencia IDs autoritativos do PLAN/Sprint (§7). Não copiar texto de `requirement`, `scenario`, `risk` ou `expected_evidence` para o state. Alternativamente, `obligations`/`invariants`/`scenario_probes`/`risk_probes` podem ser arrays de objetos `{id}` na forma expandida.
- `contract_kind=direct` exige `contract_ids.obligations` (ou `obligations`) não vazio; `plan` mantém o contrato autoritativo em `plan_path`.
- Quando a execução nasce de sprint file, writers preenchem `sprint_id`, `sprint_file_path`, `eval_results` e `policy_scope`. Campo `prd_path` é **legado opcional** (pré-0.14); writers novos omitem ou gravam `null` — o aceite mora no §7 via `sprint_file_path`.
- `eval_results` é a fonte única para claims `EVAL-*`; não persistir `evidence_to_claim` no v3. Todo `EVAL-*` do `eval_manifest` da sprint deve ter `status:"passed"` e evidência real. Claim ausente, `failed`, `blocked` ou sem evidência invalida o boundary.
- `proof_refs` (v0.15) mapeia cada `AC-NNN` do §7.3 para `{ checks: [índices de check_table], files: [índices de files_changed] }`. É a evidência citada por AC que o validator LLM localiza e o MCP classifica via oráculo mecânico (D22). Sem `proof_refs` para um AC que exige prova automática → `unproved`.
- `acceptance_results` (v0.15) é emitido pelo validator no `complete` e **persistido pelo MCP no state em disco** após a confrontação do eco com o oráculo mecânico: `[{ id: "AC-NNN", status: "proved"|"unproved"|"violated"|"manual_pending", proof_types: [...] }]`. Shape inválido → fail estrutural (como findings). Quando `sprint_file_path` está presente no state, o validator deve emitir `acceptance_results` cobrindo todos os `AC-*` do §7.3. O gate de status de `talos_update_sprint_status` (CN2/VC1) lê `acceptance_results` **deste state em disco** — a persistência do MCP é o que fecha a cadeia (executor grava `proof_refs`; validator ecoa; MCP valida e persiste; status consome).
- `manual_validation_report` (v0.15, **opcional**, escrito pelo MCP) é a referência do relatório humano `.talos/manual-validation/<backlog-slug>.md` que sincronizou este state (D24): `talos_sync_manual_validation` grava o resultado de `M` no `acceptance_results` (`M:validated`/`M:waived` → `proved`; `M:failed` → `violated`), atualiza este campo e mantém o histórico append-only no ledger `data.manual_validation` do run state. O executor não escreve este campo.
- `policy_scope` é o resumo executável do `policy_manifest`; arquivo em `forbidden_scope` não pode aparecer em `files_changed`. `allowed_scope`, quando lido de state legado, é informativo e nunca funciona como lista permitida.
- `check_table` deduplica comandos/checks longos. Campos `checks` em `eval_results`, `validation_map`, `task_evidence`, `repair_evidence` e `proof_refs` referenciam índices dessa tabela.
- `task_evidence.files` e `repair_evidence.files` referenciam índices de `files_changed`. `proof_refs[id].files` também.
- Writers capturam `worktree_baseline` antes da primeira mutação e `worktree_final` imediatamente antes do handoff. Ambos usam tuplas únicas/ordenadas `[path,status,sha256]`; `status` é `A|M|D|R|C|T|U`, delete usa `sha256:null`, symlink usa SHA-256 do target textual.
- `base_sha` e `head_sha` são commits explícitos; não inferir base pelo nome da branch. `files_changed` e os arquivos de `task_evidence`/`repair_evidence` devem ser exatamente o diff `base_sha...head_sha` somado ao delta `worktree_baseline→worktree_final`. Dirty preexistente byte/status-idêntico fica fora.
- `repair_evidence` é aditivo e obrigatório por finding P0/P1 estruturado após repair; o segundo validator correlaciona pelo mesmo `finding_id`.
- Limites de output: `task_evidence`, `validation_map`, `eval_results`, `contract_ids`, `proof_refs` e `acceptance_results` devem registrar somente o necessário para o validator localizar a prova. Se a prova já está no `plan_path`, `sprint_file_path`, comando de teste ou arquivo alterado, referencie o path/id; não reescreva o conteúdo. `prd_path` legado, se presente, só como referência histórica.
- Proibido usar este arquivo como relatório humano. Relatório final fica na resposta do orquestrador; ledger de run fica em `run.json`; boundary frio fica aqui.
