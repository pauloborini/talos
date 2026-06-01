# Atlas Workflows Configuration

Mapeamento de ferramentas, modos, skills, validadores e defaults para o plugin Atlas Workflow Orchestrator.

Esta config é empacotada no plugin e é a fonte padrão do workflow. Não exige cópia na raiz do repositório usuário.

Arquivos auxiliares empacotados:
- `defaults/paths.md`
- `references/subagent_dispatch.md`

---

## Ferramentas e Skills

### Claude (MVP)

```yaml
claude:
  prd_generator: claude-sprint-prd-generator
  prd_interview: claude-prd-interview
  plan_handoff: claude-plan-handoff
  plan_execute: claude-plan-execute        # id EXATO (G10)
  slice_review: claude-slice-review
  task_validator: claude-task-validator    # sub-agent frio dentro de execute
# G10: estes ids são autoritativos quando <tool>=claude, independente do host.
# Proibido substituir por variante de executor.
```

### Cursor

```yaml
cursor:
  prd_generator: cursor-sprint-prd-generator
  prd_interview: cursor-prd-interview
  plan_handoff: cursor-plan-handoff
  plan_execute: cursor-plan-execute             # id EXATO (G10)
  slice_review: cursor-slice-review
  task_validator: cursor-task-validator         # sub-agent frio dentro de execute
# Família cursor-* só quando <tool>=cursor. Todos os ids são exatos; sem fallback cross-família.
```

### Codex

```yaml
codex:
  prd_generator: codex-sprint-prd-generator
  prd_interview: codex-prd-interview
  plan_handoff: codex-plan-handoff
  plan_execute: codex-plan-execute
  slice_review: codex-slice-review
  task_validator: codex-task-validator
# Família codex-* só quando <tool>=codex. Todos os ids são exatos; sem fallback cross-família.
```

---

## Modos e Sequências

### Full Mode

Sequência completa: PRD generation → validação → entrevista (condicional) → plano → executor → review (condicional)

```yaml
full:
  sequence:
    - prd_generator          # artefato: PRD_*.md          (gate G1)
    - validate_prd           # scan determinístico         (gate G5)
    - prd_interview (if ambiguidades OR --interview flag)   # artefato: PRD_*.md atualizado (gate G1)
    - plan_handoff           # artefato: PLAN_*.md          (gate G1+G2)
    - validate_plan
    - plan_execute (com task-validator frio via sub-agent)  # artefato: diff + relatório validador (gate G3+G4)
    - slice_review (if --review flag)
  required_artifacts: [PRD_*.md, PLAN_*.md, code_diff, validator_report]
  hard_gates: [G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11]
  subagent_order: [prd_generator, plan_handoff, plan_execute → task-validator, slice_review (if --review)]
  after_plan_rule: "PLAN_*.md validado => próxima ação obrigatória é despachar plan_execute blocking; output final antes do executor = violação G11"

  decision_on_plan_gap:
    - option_a: volta_para_entrevista
    - option_b: continua_com_recomendacoes (TBD marcado)
    - option_c: adia_decisoes
```

### Direct Mode

Sequência enxuta: PRD → validação → entrevista (condicional) → executor → review (condicional)

```yaml
direct:
  sequence:
    - prd_generator (ou usa existente)   # artefato: PRD_*.md (gate G1)
    - validate_prd                       # scan determinístico (gate G5)
    - prd_interview (if ambiguidades OR --interview flag)
    - plan_execute (sem handoff, task-validator frio via sub-agent)  # artefato: diff + relatório (gate G3+G4)
    - slice_review (if --review flag)
  required_artifacts: [PRD_*.md, code_diff, validator_report]
  hard_gates: [G1, G3, G4, G5, G6, G7, G8, G9, G10]   # G2 não se aplica: direct não produz PLAN_*.md por design
  subagent_order: [prd_generator, plan_execute → task-validator, slice_review (if --review)]
  nota: "se o escopo exigir handoff formal, avisar usuário e sugerir full — nunca fabricar PLAN_*.md ad hoc"
```

### Interview-Only Mode

Entrevista direta:

```yaml
interview_only:
  sequence:
    - prd_interview (direto, sem PRD anterior)
  
  output:
    - prd_draft (se aplicável)
    - decisions_resolved
```

---

## Validadores de Ambiguidade (PRD)

Plugin escaneia PRD para detectar ambiguidades automaticamente:

```yaml
validation:
  prd_ambiguity_patterns:
    section_3_objective:
      - "TBD"
      - "a confirmar"
      - "talvez"
      - "não definido"
    
    section_4_scope:
      - "pode ser"
      - "depende de"
      - "ainda não"
      - "incompleto"
    
    section_5_decisions:
      - "(empty or minimal content)"
      - "vago"
    
    section_8_experience:
      - "a definir"
      - "gap"
      - "depende de"
    
    section_9_contracts:
      - "ainda não definido"
      - "mock apenas"
      - "a confirmar"
  
  # Se encontra >= 1 padrão, dispara entrevista automaticamente
  threshold: 1

  # Gate G5 — decisão determinística, sem escape hatch.
  # Exceção estreita: ocorrências em frases de sucesso/resultado que apenas descrevem
  # dependência operacional já planejada não contam como bloqueantes.
  exclude_if_line_contains:
    - "depende de plano"
  # Pular entrevista SÓ é válido se scan retornar 0 padrões E o resultado for logado no output.
  # Não existe "pular porque tenho certeza". --interview sempre força.
  skip_rule: "skip_only_if(blocking_matches == 0) AND log('Ambiguity scan: 0 padrões bloqueantes — entrevista pulada')"
  force_flag: "--interview"
```

---

## Gates Duros (HARD GATES)

Regras inegociáveis aplicadas pela SKILL. Violação = parar, não contornar.

```yaml
hard_gates:
  G1_artifact_before_advance:
    rule: "fase só conclui se o arquivo que ela produz existir em disco; verificar com Read/ls, nunca auto-relato"
    applies: all
  G2_no_code_before_plan:
    rule: "em full, proibido escrever código (Dart) antes de PLAN_*.md validado existir; sem plano = usar direct"
    applies: full
  G3_real_skill_invocation:
    rule: "cada fase invoca a skill real; sub-agent deve carregar o SKILL.md do id resolvido antes de agir; proibido emular/absorver inline (plano no §10 do PRD NÃO substitui PLAN_*.md)"
    applies: all
  G4_cold_validator:
    rule: "task-validator roda como sub-agent filho de plan_execute, recebe git diff + plano, devolve findings ao executor e alimenta reparo limitado; orquestrador só verifica despachabilidade no pré-flight"
    applies: execution
  G5_deterministic_scan:
    rule: "ver validation.skip_rule — pular entrevista só com 0 padrões logados"
    applies: prd_validation
  G6_verified_status:
    rule: "✅ só após confirmar artefato em disco; artefato exigido ausente => status 'incomplete', nunca 'completed'"
    applies: output
  G7_forced_subagent_dispatch:
    rule: "plan_handoff e plan_execute despachados como sub-agent (Agent tool), NUNCA no fio do orquestrador; PLAN_*.md deve conformar ao template plan_handoff (§2 invariantes, §10 contratos, §11 riscos, §14 checklist, tasks T01..Tn)"
    applies: [plan, execution]
    rationale: "GF07 não disparou sub-agent p/ plano => plano sem template, terrível"
  G8_validation_order:
    rule: "task-validator ANTES (dentro/antes do relatório do executor); slice-review POR ÚLTIMO (só após executor 100%, como sub-agent despachado — G7); JAMAIS em paralelo"
    applies: [validation, review]
    rationale: "GF07 rodou task-validator e slice-review concorrentes — funções e ordem distintas"
  G9_orchestrator_hands_off:
    rule: "após Fase 0, orquestrador NÃO edita arquivo, NÃO escreve código, NÃO roda comando mutante (flutter/test/git write), NÃO implementa em paralelo; só despacha sub-agent (blocking, 1 por vez), lê artefato, reporta. Proibido run_in_background para fases do pipeline"
    applies: orchestrator
    rationale: "GF08 — orquestrador implementou inline em paralelo ao sub-agent de execução (contexto 87%)"
  G10_tool_authoritative_routing:
    rule: "família de skills = <tool> do comando, NUNCA o host; família única por run; id exato sempre; skill ausente => aborta"
    applies: routing
    rationale: "GF09 — 'claude' roteou pra cursor-* e misturou famílias"
  G11_full_must_execute_after_plan:
    rule: "em full, depois que PLAN_*.md existir e passar gates G1/G2/G7, a próxima ação do orquestrador é obrigatoriamente despachar plan_execute como sub-agent blocking; proibido finalizar, resumir, pedir validação humana ou marcar completed só com handoff"
    applies: full
    rationale: "GF11.5 — Codex gerou handoff e parou; full precisa executar pós-plano"
```

### Política de dispatch

```yaml
dispatch_policy:
  mode: blocking            # despacha 1 sub-agent, ESPERA retorno, então segue
  concurrency: 1            # nunca 2 sub-agents simultâneos
  background: forbidden     # run_in_background proibido para fases do pipeline
  contract_file: references/subagent_dispatch.md
  subagent_first_action: read_skill_md
  orchestrator_tools_after_phase0: [dispatch_subagent, read_artifact, emit_output]
  orchestrator_forbidden: [edit_file, write_code, mutating_bash, parallel_impl]
  full_after_plan_next_action: dispatch_plan_execute_blocking
```

---

## Pré-flight (Fase 0)

```yaml
preflight:
  steps:
    - parse_args                 # inválido/--help => mostra sintaxe e para
    - load_plugin_bundle_config  # atlas_workflows_config.md + defaults/ + references/
    - select_family_from_tool    # <tool> AUTORITATIVO define a família (G10)
    - resolve_exact_skill_ids    # ids exatos da família, sem variante de executor
    - resolve_skill_md_paths     # sub-agent precisa carregar a skill real
    - verify_subagent_dispatch   # cada id despachável via Agent tool neste host?
    - declare_execution_plan     # modo, família, ids, ORDEM dos sub-agents, artefatos, gates
    - reject_mode_mismatch       # se usuário pediu "sem patch"/"só plano" junto com full/direct, aborta e pede modo adequado
  family_selection:
    rule: "família = <tool> do comando (claude=>claude-*, cursor=>cursor-*, codex=>codex-*)"
    host_role: "host só executa; NÃO escolhe família. Cursor despacha claude-*/cursor-*/codex-*"
    forbidden: "trocar família por causa do host; misturar famílias numa run (G10)"
    rationale: "GF09 — comando 'claude' roteou pra cursor-* porque a regra antiga olhava o host"
  variant_policy:
    rule: "usar SEMPRE o id exato mapeado; proibido substituir por variante de executor"
    rationale: "executor oficial do pipeline é sempre o plan_execute mapeado para a família"
  on_missing_skill:
    action: "ABORTAR"
    forbidden_fallbacks:
      - "trocar a família inteira por causa de uma skill ausente"
      - "usar skill de outra família"
      - "implementação direta inline"
      - "contratos equivalentes no fio do orquestrador"
    rationale: "famílias completas; fallback inline proibido (G7); troca de família proibida (G10)"
  mode_mismatch:
    rule: "se o input trouxer 'sem patch', 'sem editar codigo', 'planejamento apenas', 'handoff only' ou equivalente junto com mode full/direct, NÃO gerar plano e parar; reportar conflito: full/direct executam plan_execute. Usuário deve rodar modo de planejamento explícito fora deste pipeline."
    forbidden: "interpretar full como plan-only"
```

### Defaults empacotados

```yaml
embedded_defaults:
  paths_file: defaults/paths.md
  dispatch_contract_file: references/subagent_dispatch.md
  config_source: plugin_bundle
  repo_root_config_required: false
```

---

## Input Types e Resolução

### backlog-item

```yaml
backlog_item:
  input_format: 
    - sprint_id (ex: "S05", "S12")
    - indicacao_direta (ex: "implementar login com 2FA")
  
  resolution:
    - Se sprint_id: busca no BACKLOG_MESTRE.md
    - Se indicação: cria contexto de sprint implícito
  
  output:
    - sprint_context { sprint_id, title, phase, dependencies }
```

### idea

```yaml
idea:
  input_format: "indicação curta ou brainstorm"
  
  output:
    - idea_context { description, scope_estimate }
```

### prd

```yaml
prd:
  input_format:
    - "/path/to/PRD_SXX_slug.md"
    - "PRD_SXX_slug.md" (busca relativo)
  
  resolution:
    - Valida se arquivo existe
    - Valida se tem estrutura PRD_TEMPLATE.md
  
  output:
    - prd_path (absoluto ou relativo resolvido)
```

### brainstorm

```yaml
brainstorm:
  input_format: "texto livre"
  
  allowed_modes: ["interview-only"]
  
  output:
    - brainstorm_text (passado direto pra prd-interview)
```

---

## Flags

```yaml
flags:
  interview:
    description: "Força prd-interview mesmo sem ambiguidades"
    type: "boolean"
    default: false
  
  review:
    description: "Executa slice-review ao final"
    type: "boolean"
    default: false
  
  help:
    description: "Mostra sintaxe e exemplos"
    type: "boolean"
    default: false
```

---

## Output Standard

Todos os modos retornam:

```
✅ Workflow: <tool> <mode> <input-type> completed

📄 PRD: <path>
📋 Plan: <path> (se aplicável)
🚀 Output: <summary 1-2 linhas>

Status:
  ✅/❌ PRD valid
  ✅/❌ Ambiguidades (resolvidas/pendentes)
  ✅/❌ Plano generated (se aplicável)
  ✅/❌ Executor output ready (obrigatório em full/direct; sem executor => incomplete)
  ⏭️  Slice review: (executed/not executed)

Próximo passo:
  - [ ] Validar output
  - [ ] Rodar slice-review (se necessário)
  - [ ] Avançar para próxima sprint
```

Regra de status: em `full`, `completed` exige `PLAN_*.md` verificado **e** retorno de `plan_execute`. `PLAN_*.md` sem executor = `incomplete` por G11.

---

## Integração com PERGUNTAS_EM_ABERTO.md

Durante validação de PRD, plugin verifica:

```
PERGUNTAS_EM_ABERTO.md
  ↓
  Tem Q-… abertas para esta sprint?
  ├─ SIM: informa ao usuário e para/aguarda decisão
  │       (não despacha open-questions automaticamente)
  └─ NÃO: continua
```

---

## Error Handling Standard

| Erro | Ação |
|------|------|
| Sprint não encontrado | Reporta sprints disponíveis, pede confirmação |
| Arquivo PRD não existe | Reporta path tentado, oferece criar novo |
| Skill falha | Para, mostra erro, oferece retry/skip/abort |
| PRD inválido (mal formatado) | Reporta sections faltando, opção continuar com warning |
| Ambiguidades não resolvidas | Pergunta: volta? continua TBD? adia? |
| Network/timeout | Retry automático com backoff, depois reporta |

---

## Próximas fases de expansão

- **v0.2** Cursor hardening (mesmo config, skills do cursor)
- **v0.3** Codex hardening
- **v1.0** Full parity, smart tool detection
