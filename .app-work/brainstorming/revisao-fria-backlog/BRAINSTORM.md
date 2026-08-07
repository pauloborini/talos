# Brainstorm — Revisão fria de backlog/sprint no Talos

**Tema:** `revisao-fria-backlog`
**Data:** 2026-08-06
**Origem:** conversa de design (sem arquivo prévio); condensada aqui para servir de fonte citável ao `INTENT.md` do pack `REVISAO_FRIA_BACKLOG_GUIDE`.
**Produto alvo:** plugin Talos (`/Users/pauloborini/Documents/projetos/talos`), versão vigente `0.15.2`.

---

## 1. Problema observado

Aprendizados vindos do sistema Guide (`pre-guide` → `create-guide` → revisor frio) apontam alucinação na fase de planejamento. No Guide o remédio foi duplo:

1. `$pre-guide` produz `INTENT.md` — âncora de intenção anterior ao GUIDE.
2. Revisor frio (`COLD_REVIEW_PROMPT.md`) confronta INTENT × GUIDE/plans × código em contexto novo, com mandato de finding + reparo.

No Talos o desenho é diferente: **não existe artefato de plano produzido por skill de planejamento separada** — o PLAN nasce no executor a partir do backlog mestre + sprint file (§7 contrato + §9 eval manifest) + código real. Consequência: **backlog e sprint file concentram todo o peso**. Alucinação na §7 vira código errado sem etapa intermediária que a pegue.

Estado atual do Talos nessa fronteira:

- Gates mecânicos existem: `talos_verify_backlog_index`, `talos_verify_sprint_file`, `talos_scan_acceptance`, selo `sha256` do §7.
- Revisão fria existe **só pós-execução**: `talos-task-validator` (sibling obrigatório, G4) e `talos-slice-review` (condicional / obrigatória sob `policy_manifest.critical_review`).
- Entrevista existe (`talos-sprint-interview`), mas é **reativa**: dispara só se `talos_scan_acceptance` achar padrão bloqueante ou se `--interview` for passado, e só **depois** do sprint file existir.
- `talos-backlog-generator` passo 4 fecha ambiguidade com "até 3 perguntas objetivas" em texto livre — sem mecanismo estruturado (`talos_capabilities.question_prompt`), sem procedência.

Buraco: nada confronta backlog/sprint recém-criados contra código real em contexto frio antes de executar.

---

## 2. Caminho descartado — INTENT no Talos

Proposta inicial: portar o `INTENT.md` do Guide para o Talos como artefato canônico pré-backlog.

**Descartado pelo usuário.** Motivo: o Talos já tem bloco de decisões próprio (decisões do backlog mestre + §6 do sprint file + §7.1 `D*`). Criar INTENT seria duplicar um bloco existente, não melhorar. Talos já carrega backlog mestre + sprint file + §7 + `eval_manifest` + `policy_manifest` + PLAN + state + handoff; mais um artefato aumenta superfície documental sem ganho proporcional.

Consequência aceita: sem INTENT, o revisor frio perde a capacidade de detectar **omissão de intenção** (superfície que o usuário quis no brainstorm e que ninguém escreveu). Mitigação escolhida: usar campo que já existe — a linha `Discussão` da §4 "Contexto e fontes" do `SPRINT_TEMPLATE.md` — como ponteiro para a fonte bruta. O revisor lê essa fonte como oráculo de intenção. INTENT vira ponteiro numa célula, não artefato.

---

## 3. Direção acordada

Três frentes, num único release.

### 3.1 Procedência por linha (mecânico)

Coluna/campo `Origem` com enum fechado:

| valor | significado |
|---|---|
| `usuario` | veio de resposta de entrevista ou citação direta do brainstorm |
| `derivado:<path>` | lido do código/contrato real |
| `premissa` | o modelo inferiu |

Alvos: decisões do `BACKLOG_MESTRE_TEMPLATE.md`, §7.1 (`D*`) e §7.3 (`AC-*`, campo `origin:` no YAML `acceptance`) do `SPRINT_TEMPLATE.md`.

Gates em `talos_verify_sprint_file` / `talos_verify_backlog_index`: valida enum; resolve `derivado:<path>` contra disco (allowlist para arquivo a criar, marcado `(novo)`); bloqueia `premissa` sustentando sprint `Must`/`P0`; devolve contagem de `premissa` no resultado.

Racional: alucinação deixa de ser invisível — fica rotulada por construção, com custo zero de token.

### 3.2 Entrevista promovida a gate de primeira classe

- `talos-backlog-generator` passo 4 vira entrevista **estruturada** via `talos_capabilities.question_prompt` (3 opções, recomendada explícita, `decision_id` estável), persistindo com `Origem: usuario`.
- `talos_scan_acceptance` passa a rodar também sobre backlog/sprint **draft antes de salvar**, não só depois do sprint file existir.

Racional do usuário: entrevista tem que ser "mais disparada, mais importante do que apenas receber algumas informações do prompt". Brainstorm sempre precede a implementação; as decisões já existem antes do backlog — o que falta é capturá-las como `usuario` em vez de o generator re-inferir.

### 3.3 Revisor frio sibling `talos-backlog-review`

Subagente novo, contexto frio, mesmo modelo do planejador. Recebe **só paths** (backlog, sprint file, fonte de discussão da §4, raiz do repo) — nunca a conversa de criação, que é o viés a eliminar.

Racional do usuário: mais caro, mas evita refatoração. Não garante 100%, garante qualidade melhor. Pega brechas que o agente que criou backlog/sprints não pegou. Como herda contexto frio e o mesmo modelo (mais inteligente), a qualidade de backlog e sprints sobe.

Mandato proposto (ordem obrigatória: fonte de discussão → código → backlog/sprint):

- toda linha `premissa` primeiro;
- `AC-*` não-falseável;
- `EVAL-*` órfão;
- AC inalcançável no código real;
- sprint com mais de um objetivo;
- dependências declaradas vs reais;
- `critical_review.reasons` vs o que a sprint efetivamente toca.

Ancoragem no pipeline: roda **depois da entrevista fechar, antes do selo** da §7 — rodar antes queima tokens em findings que a entrevista resolveria sozinha.

Gate `COLD_BACKLOG`: §7 não sela sem veredito terminal registrado. `Selo de revisão: sha256:<hash §7> @ <run_id>` — §7 editada depois da revisão → hash quebra → revisão caduca sozinha.

Lock `talos_lock_backlog_review` no MCP, reusando o padrão G4/R19/R20 (slot, `dispatch_token` de proveniência, challenge sha256): revisor que não leu o boundary não fecha o slot.

---

## 4. Decisões de processo

- **Release único, não faseado.** Motivo do usuário: sair do estado atual para o estado desejado de uma vez torna o teste mais fácil; evolução progressiva diluiria o resultado percebido.
- **Corte seco, sem retrocompat.** Nenhuma camada de compatibilidade, nenhuma detecção de schema antigo, nenhum modo legacy. Artefatos no formato anterior não são suportados — mesmo padrão do BREAKING anterior do projeto (v0.15.0 / D19: "artefatos pré-v0.15 não são suportados; iniciar backlog/sprint novo").
- **Versão `0.16.0`** (minor com BREAKING de contrato documental, seguindo o precedente do `0.15.0`), não patch: adiciona gate duro, campo obrigatório em template canônico e subagente novo. `PATCH_PROCEDURE.md` cobre correção sem mudança de contrato.
- **Backlog anterior do repo (`BACKLOG_MESTRE_licoes_pos_validacao` + `sprints/S01–S10`) foi concluído e removido.** `.talos/backlog/` está vazio. Este ciclo é planejado pelo sistema Guide, não pelo backlog do Talos.

---

## 5. Fonte

Conversa de design entre usuário e agente, 2026-08-06. Nenhuma decisão aqui foi inferida sem afirmação explícita do usuário, exceto as marcadas como recomendação do agente ainda não confirmada (ver `PERGUNTAS_EM_ABERTO.md` deste tema).
