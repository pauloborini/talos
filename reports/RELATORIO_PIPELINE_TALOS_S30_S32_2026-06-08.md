# Relatório — erros do pipeline Talos S30/S32

Data: 2026-06-08  
Origem: `/Volumes/Dados/projetos/daily_pace`  
Destino solicitado: `/Volumes/Dados/projetos/talos/`  
Run principal: `talos-s30-qa-builds-20260607`  
Run impactada: `talos-s32-stores-rollout-20260608`

## 1. Resumo executivo

O pipeline Talos não ficou confiável para declarar S30/S32 como fechado.

Houve avanço parcial nos gates de PRD/plano, mas a execução entrou em estado inconsistente:

- `plan_execute` travou em subagent por timeout.
- O lock de execução bloqueou outra run (`S32`).
- O `PLAN_S30_qa_builds.md` foi validado em gate, mas depois sumiu de `.talos/plans/`.
- `run.json` de S30 terminou marcando `complete` sem evidência de validator.
- `qa.json` referencia um `plan_path` inexistente.
- Há artefatos de build no workspace, mas sem diff Git e sem validação local reexecutada nesta sessão.

Conclusão: S30 pode ter evidências locais, mas o pipeline Talos não produziu cadeia determinística completa. S32 não deve ser considerada liberada por esse histórico.

## 2. Linha do tempo observada

### 2.1 Preflight e PRD S30

Passou:

- `talos_ping`: MCP vivo, versão `0.6.0`.
- `talos_capabilities`: Codex com `subagent_available=true`, `mcp_available=true`, validator em topologia `sibling`.
- `talos_classify_input`: input classificado como `prd`, roteado para `full`.
- `talos_preflight`: G10 passou.
- `talos_verify_artifact` no PRD: G1 passou.
- `talos_scan_prd`: G5 passou, `blocking_count=0`.
- `talos_verify_template_conformance` no PRD: TC passou.

Resultado correto: entrevista pulada por scan determinístico, sem ambiguidade bloqueante.

### 2.2 Plan handoff

Foi criado e validado um plano:

- `.talos/plans/PLAN_S30_qa_builds.md`
- G1 passou.
- TC do plano passou.
- `talos_lock_dispatch complete plan_handoff` passou.

Problema posterior: o arquivo não existe mais no estado final observado.

Evidência atual:

```text
plan_present=no
.talos/plans/
  PLAN_S28_estados_globais_edge_cases.md
  PLAN_S29_polish_performance.md
```

Impacto: o ledger aponta para um plano que não está mais disponível. Isso quebra reprodutibilidade e invalida execução/validator baseados nesse path.

### 2.3 G11

`talos_assert_after_plan` retornou `blocked` com `premature_completion_guard`.

Isso não foi erro funcional: o gate impediu conclusão prematura do modo `full` sem `plan_execute`.

O problema real veio depois: o `plan_execute` não completou de forma determinística.

### 2.4 Plan execute — tentativa 1

Subagent `talos-plan-execute` foi despachado.

Falha:

- Sem retorno após longa espera.
- Sem `state_path`.
- Sem diff persistido.
- Sem validator.
- Lock precisou ser abortado manualmente.

Após inspeção inicial:

```text
?? .talos/plans/PLAN_S30_qa_builds.md
```

Depois da sequência completa, o plano deixou de existir.

### 2.5 Plan execute — tentativa 2

Segunda tentativa foi despachada com instrução explícita:

- timebox forte;
- escrever `.talos/state/talos-s30-qa-builds-20260607/slice-qa-builds.json`;
- retornar `validator_handoff_required` ou `blocked`;
- não invocar validator nested.

Falha:

- Subagent repetiu timeout.
- Não retornou final estruturado.
- Foi encerrado.
- Lock foi abortado.

### 2.6 Estado final contraditório

Depois do fechamento manual, o state mudou para:

```json
{
  "phase": "completed",
  "status": "complete",
  "summary": "S30 QA/builds fechado com evidências existentes no workspace; state atualizado com boundary qa e artefatos Android/iOS já presentes."
}
```

Mas isso contradiz a cadeia de gates:

- não houve retorno formal do executor no fio principal;
- não houve dispatch do `talos-task-validator`;
- não há veredito `pass`/`pass_with_observations`;
- o plano referenciado não existe mais;
- Git não mostra diff;
- o próprio state diz que Flutter não estava disponível para rerun local.

Trecho crítico do state:

```json
"notes": [
  "Flutter não estava disponível no shell desta sessão para rerun local de analyze/test.",
  "A evidência de análise/testes verdes está registrada no checklist S29 já presente no workspace."
]
```

Impacto: o status `complete` é fraco e não deve ser tratado como closure determinística Talos.

## 3. Erros encontrados

### E1 — Timeout do subagent `talos-plan-execute`

Sintoma:

- duas tentativas de execução sem retorno;
- exigiu encerramento manual;
- não entregou `validator_handoff_required` no momento esperado.

Impacto:

- pipeline `full` ficou sem execução determinística;
- orquestrador não pôde avançar para validator;
- lock ficou ativo por tempo suficiente para bloquear runs seguintes.

Causa provável:

- subagent preso em comandos longos, build, validação, ou estado interno sem checkpoint;
- ausência de watchdog/heartbeat no executor;
- contrato de saída não foi respeitado pelo subagent.

Correção recomendada:

- executor deve gravar checkpoint incremental via `talos_run_state`;
- comandos longos precisam de timeout e status parcial;
- `plan_execute` deve sempre finalizar com `validator_handoff_required` ou `blocked`, mesmo sem completar tasks.

### E2 — Lock conflict bloqueando S32

Run impactada:

- `talos-s32-stores-rollout-20260608`

Erro:

```text
Lock conflict: run ativa talos-s30-qa-builds-20260607 na fase plan_execute
```

Impacto:

- S32 bloqueada corretamente pelo G10;
- segunda run poderia corromper estado/ledger se prosseguisse.

Este gate funcionou corretamente. O erro raiz é o lock de S30 ter ficado preso por executor sem retorno.

### E3 — Plano validado desapareceu

Arquivo esperado:

```text
.talos/plans/PLAN_S30_qa_builds.md
```

Estado final:

```text
plan_present=no
```

Impacto:

- `qa.json` referencia um plano inexistente;
- execução não é reprodutível;
- validator não teria contrato completo para ler.

Causa provável:

- subagent removeu/reverteu artefato documental;
- ou algum reset/limpeza do workspace ocorreu dentro do subagent.

Correção recomendada:

- `plan_execute` não deve apagar/alterar `PLAN_*.md` após TC;
- orquestrador deve revalidar presença do plano antes de aceitar qualquer `state_path`;
- `STATE_FILE_SCHEMA` deve rejeitar `plan_path` inexistente.

### E4 — State final `complete` sem validator

Estado final em `run.json`:

```text
phase=completed
status=complete
```

Mas não há evidência de:

- `talos-task-validator` despachado;
- `validator_status=passed`;
- `talos_lock_dispatch complete plan_execute validator_status=passed`;
- veredito JSON do validator.

Impacto:

- viola o contrato do modo `full`;
- transforma evidência local em fechamento de pipeline;
- confunde S30 com liberada para S32.

Correção recomendada:

- `talos_run_state` não deve aceitar `complete` em `plan_execute` sem `validator_status=passed`;
- `complete` deve exigir state file válido + plan existente + validator verdict;
- se validator não rodou, status máximo deve ser `blocked` ou `degraded`, nunca `complete`.

### E5 — `qa.json` não é suficiente como closure

Arquivo existe:

```text
.talos/state/talos-s30-qa-builds-20260607/qa.json
```

Problemas:

- tasks listadas só `T01`–`T06`, mas plano tinha `T01`–`T08`;
- `plan_path` aponta para arquivo ausente;
- `files_changed` lista build artifacts e checklist, mas Git não mostra diff;
- não inclui resultado de validator;
- não prova que `flutter analyze`/`flutter test` rodaram nesta execução.

Impacto:

- `qa.json` pode servir como evidência parcial, não como fechamento de slice.

Correção recomendada:

- state file deve conter `status` explícito: `ready_for_validator`, `blocked`, ou `partial`;
- schema deve exigir cobertura de todas as tasks ou lista de tasks não executadas;
- validator deve rejeitar `files_changed` fora de Git diff sem justificativa.

### E6 — Evidência de build existe, mas rastreio é insuficiente

Arquivos presentes:

```text
apps/daily_pace/build/app/outputs/bundle/release/app-release.aab
apps/daily_pace/build/app/outputs/mapping/release/mapping.txt
apps/daily_pace/build/release-packages/android/release/app-release.aab
apps/daily_pace/build/release-packages/android/release/mapping.txt
apps/daily_pace/build/ios/ipa/daily_pace.ipa
```

Problemas:

- build artifacts normalmente não entram no Git;
- state não prova commit/tag único;
- state não registra checksums;
- state declara que Flutter não estava disponível para rerun nesta sessão;
- não há confirmação de signing/release readiness.

Impacto:

- builds podem existir, mas não fecham PRD §3 D3 sozinhos.

Correção recomendada:

- gerar `S30_qa_evidence.md` com commit, tag, build number, checksums e comandos;
- registrar hashes SHA256 dos artefatos;
- separar `build_artifact_present` de `release_ready`.

### E7 — Validação local não foi reexecutada

State informa:

```text
Flutter não estava disponível no shell desta sessão para rerun local de analyze/test.
```

Impacto:

- não há evidência fresca de `flutter analyze`;
- não há evidência fresca de `flutter test`;
- regra operacional do DailyPace não foi comprovada nesta execução.

Correção recomendada:

- se Flutter não estiver disponível, marcar `blocked_env_flutter_unavailable`;
- não usar checklist anterior como substituto de gate obrigatório da execução atual.

## 4. Status honesto de S30 e S32

### S30

Não deve ser tratada como `done` pelo pipeline Talos.

Estado técnico correto:

```text
S30 = evidência parcial / pipeline inconsistente / validator not_run
```

Para fechar:

1. regenerar ou restaurar `PLAN_S30_qa_builds.md`;
2. validar G1/TC do plano;
3. executar `plan_execute` com checkpoint/timeout;
4. gerar state file completo e válido;
5. despachar `talos-task-validator`;
6. concluir `plan_execute` somente com `validator_status=passed`;
7. atualizar backlog/PRD apenas após gates reais.

### S32

S32 não está liberada.

Motivos:

- S30 não tem closure determinística;
- S32 já sofreu `LOCK_CONFLICT` por S30 ativa;
- builds/evidência não foram validados por validator;
- go/no-go ainda não foi produzido.

## 5. Recomendações para o Talos

### R1 — Hard gate no `complete`

Impedir `talos_run_state(status=complete)` para execução se faltar:

- plan existente;
- state file válido;
- validator verdict;
- `validator_status=passed` no lock.

### R2 — Heartbeat obrigatório do executor

`plan_execute` deve atualizar estado a cada task:

```text
implementing T01
gating T01
task_done T01
blocked T06 build_ios_signing
```

Sem heartbeat por N minutos: orquestrador pode abortar com causa limpa.

### R3 — State schema mais rígido

Rejeitar state file quando:

- `plan_path` não existe;
- tasks do plano não batem;
- `files_changed` não corresponde a diff ou evidência externa;
- status da slice não é explícito;
- faltam validações obrigatórias.

### R4 — Separar evidência externa de diff

Builds em `build/` devem ser tratados como evidência externa, com:

- path;
- tamanho;
- SHA256;
- build name/number;
- commit hash;
- data;
- comando usado.

Não devem ser usados como prova de mudança versionada.

### R5 — Status intermediário para execução degradada

Criar enum ou convenção:

```text
blocked
partial_evidence
ready_for_validator
validator_passed
complete
```

Evita marcar `complete` quando só há evidência parcial.

## 6. Evidências consultadas

Arquivos:

```text
/Volumes/Dados/projetos/daily_pace/.talos/state/talos-s30-qa-builds-20260607/run.json
/Volumes/Dados/projetos/daily_pace/.talos/state/talos-s30-qa-builds-20260607/qa.json
/Volumes/Dados/projetos/daily_pace/.talos/state/talos-s32-stores-rollout-20260608/run.json
/Volumes/Dados/projetos/daily_pace/.talos/state/daily-p30-qa-builds/run.json
```

Comandos relevantes:

```bash
rtk proxy find .talos -maxdepth 4 -type f -print
rtk proxy test -f .talos/plans/PLAN_S30_qa_builds.md && echo plan_present=yes || echo plan_present=no
rtk proxy find apps/daily_pace/build -maxdepth 5 -type f \( -name '*.aab' -o -name '*.ipa' -o -name 'mapping.txt' \) -print
rtk proxy git status --short
rtk proxy git diff --stat
```

Resultados-chave:

```text
plan_present=no
qa_present=yes
git status: limpo
git diff --stat: vazio
S32 preflight: LOCK_CONFLICT com S30 em plan_execute
```

## 7. Próxima ação recomendada

Antes de tentar S32:

1. Corrigir no Talos os gates de `complete` sem validator.
2. Restaurar/regenerar `PLAN_S30_qa_builds.md`.
3. Rodar S30 de novo, com heartbeat e timeout.
4. Exigir `talos-task-validator` real.
5. Só então liberar S32.

Decisão objetiva: o pipeline atual expôs bug de orquestração/estado. Não é seguro tratar S30 como concluída só pelo `run.json`.
