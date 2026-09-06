// Guards permanentes do loop de sprints com auto-correção (pack
// LOOP_SPRINTS_AUTOCORRECAO, Plano 06). Funções puras (texto -> violações[])
// consumidas por check-consistency.mjs e por check-consistency.guard.test.mjs.
//
// As skills do Talos são prosa contratual (sem runtime próprio): regressão de
// texto é invisível a qualquer suíte de runtime. Estas guards blinda a semântica
// nova do loop (CN8/INV1/INV2/INV4/INV10/INV12 e LEG1) por âncora de SEÇÃO/RAMO —
// nunca por ocorrência global de termo, para não falso-positivar:
//   - a linha G4 (ramo do validator), que legitima o "2º e último" validator (R2);
//   - as próprias proibições citadas na skill de review ("não chama
//     talos_commit_state", "É proibido reabrir a review completa").
// Os falsificadores são exercidos por fixtures no guard test; o repo canônico é
// verificado apenas por leitura (texto correto não produz violação).

// Catálogo canônico de sub-agentes despachados pelo orquestrador (shim em 5
// hosts). Fonte única usada pelo shim-drift do check-consistency e pela guard de
// catálogo (D7/CN3): o sidecar `talos-escalation-repair` entra aqui e, a partir
// daí, os guards M4/M3/shim-drift existentes cobrem o id novo em 5 hosts.
export const DISPATCHED_EXEC_AGENTS = [
  'talos-plan-execute',
  'talos-direct-execute',
  'talos-findings-repair',
  'talos-slice-review',
  'talos-escalation-repair',
];

// Negação que legitima a menção a um ato proibido (proibição/descrição de insumo).
const NEGACAO = /(não\s|nao\s|proibido|nunca|never|do not|don't|nem\s)/i;

// Contexto que protege uma menção a "2º validator/nova review" no ramo de review:
// a frase proibindo (Nunca/nem/proibido) ou a frase que preserva o G4 (mantém o).
const CONTEXTO_PROTEGIDO = /(nunca|não\s|nao\s|nem\s|proibido|jamais|mant[eé]m o)/i;

// Ramo antigo morto (LEG1): review → findings-repair → 2º validator → nova review.
const RAMO_ANTIGO = /(?:2º|segundo)[^.\n|]{0,24}(?:task-)?validator|nova\s+review/gi;

/**
 * INV1 (review read-only / D2): a SKILL de slice-review (qualquer fase,
 * verification inclusive) não pode instruir mutação de state — nem chamada de
 * `talos_commit_state`, nem instrução de Write/gravação de state. Menções
 * legitimas são as proibições (negadas) e a descrição do insumo produzido por
 * OUTRO agente. Âncora positiva: a regra read-only tem de estar presente
 * (removê-la já é regressão).
 */
export function guardReviewReadonly(text) {
  if (text == null) {
    return ['review read-only violada (verification não pode mutar): SKILL de slice-review ausente (INV1/D2)'];
  }
  const violations = [];
  if (!/Read-only:[^\n]*talos_commit_state/.test(text)) {
    violations.push('review read-only violada (verification não pode mutar): regra read-only (não chamar talos_commit_state) ausente na SKILL de slice-review (INV1/D2)');
  }
  const VERBO_CHAMADA = /\b(chame|chamar|execute|executar|rode|rodar|invoke|call|run)\b/i;
  const VERBO_ESCRITA = /\b(write|escreva|escrever|grave|gravar)\b/i;
  const ALVO_STATE = /(\bstate file\b|state de slice|run\.json|state_path|o state\b)/i;
  for (const line of text.split('\n')) {
    if (!NEGACAO.test(line) && /talos_commit_state/.test(line) && VERBO_CHAMADA.test(line)) {
      violations.push('review read-only violada (verification não pode mutar): instrução de chamada de talos_commit_state na SKILL de slice-review (INV1/D2)');
    }
    if (!NEGACAO.test(line) && VERBO_ESCRITA.test(line) && ALVO_STATE.test(line)) {
      violations.push('review read-only violada (verification não pode mutar): instrução de Write/gravação de state na SKILL de slice-review (INV1/D2)');
    }
  }
  return violations;
}

/**
 * INV2 + LEG1: o ramo de review do orquestrador (linha G8 + trecho de review
 * crítica do bloco EXEC) não pode citar o ramo morto (2º validator / nova review
 * completa / despacho de task-validator) como fluxo — e precisa da cadeia nova
 * (verification + escalation/sidecar). A linha G4 (ramo do validator) DEVE
 * continuar contendo o "2º e último" validator (R2 — cutover excessivo é
 * regressão). Âncora por ramo: ocorrência global de termo falso-positivaria o G4.
 */
export function guardReviewBranch(text) {
  if (text == null) {
    return ['LEG1 guard: SKILL do orquestrador ausente (INV2/LEG1)'];
  }
  const violations = [];
  const linhas = text.split('\n');
  const g8Row = linhas.find((line) => /^\|\s*G8\s*\|/.test(line)) ?? '';
  const g4Row = linhas.find((line) => /^\|\s*G4\s*\|/.test(line)) ?? '';
  if (!/2º e último/.test(g4Row)) {
    violations.push('LEG1 guard: linha G4 do orquestrador perdeu o "2º e último" validator (ramo do validator é vigente — R2; cutover excessivo)');
  }
  // Recorte do ramo review no bloco EXEC: do marcador de review crítica até o fim
  // do parágrafo [EXEC] — o trecho do validator (G4) fica antes do marcador.
  const execStart = text.indexOf('### [EXEC]');
  const execSection = execStart >= 0 ? text.slice(execStart).split(/\n### /)[0] : '';
  const marker = execSection.indexOf('**Review crítica');
  const execReview = marker >= 0 ? execSection.slice(marker) : '';
  const branch = `${g8Row}\n${execReview}`;
  if (!/verification/i.test(branch) || !/escalation/i.test(branch)) {
    violations.push('guard ramo review: cadeia verification/sidecar (escalation) ausente no ramo review do orquestrador (INV2/D3/D4)');
  }
  for (const line of branch.split('\n')) {
    for (const m of line.matchAll(RAMO_ANTIGO)) {
      const before = line.slice(Math.max(0, m.index - 60), m.index);
      if (!CONTEXTO_PROTEGIDO.test(before)) {
        violations.push(`LEG1 guard: ramo review do orquestrador cita "${m[0]}" como fluxo (ramo morto voltou — review → 2º validator → nova review)`);
      }
    }
    // Parágrafo [EXEC] é uma linha só: a negação que legitima é a LOCAL ao trecho
    // (janela de 60 chars antes do match), não a presença de "nunca/não" em
    // qualquer lugar da linha.
    for (const m of line.matchAll(/despach\w+\s+(?:o\s+|um\s+)?`?talos-task-validator/gi)) {
      const before = line.slice(Math.max(0, m.index - 60), m.index);
      if (!CONTEXTO_PROTEGIDO.test(before)) {
        violations.push('INV2 guard: ramo review do orquestrador despacha talos-task-validator (task-validator ⟂ slice-review)');
      }
    }
  }
  return violations;
}

/**
 * INV10 (D11/R10): finding novo fora do delta não reabre a review completa.
 * A proibição tem de estar na SKILL de slice-review, e nenhuma linha pode
 * condicionar reabertura sem negação.
 */
export function guardNoReopen(text) {
  if (text == null) {
    return ['guard reabertura: SKILL de slice-review ausente (INV10/D11)'];
  }
  const violations = [];
  if (!/proibido reabrir a review completa/i.test(text)) {
    violations.push('guard reabertura: proibição de reabrir a review completa por finding novo ausente na SKILL de slice-review (INV10/D11)');
  }
  for (const line of text.split('\n')) {
    if (/reabr\w*/i.test(line) && !NEGACAO.test(line)) {
      violations.push(`guard reabertura: condição de reabertura de review fora da proibição — "${line.trim().slice(0, 90)}" (INV10/D11)`);
    }
  }
  return violations;
}

/**
 * INV12 (D4/R12): `violated` no state ⇒ residual P0 mecânico — classificação por
 * campo do state, sem juízo do revisor. A regra tem de estar na SKILL de
 * slice-review (mapa violated→P0).
 */
export function guardViolatedP0(text) {
  if (text == null) {
    return ['guard violated→P0: SKILL de slice-review ausente (INV12)'];
  }
  const violations = [];
  if (!/violated[^\n]{0,120}P0/i.test(text)) {
    violations.push('guard violated→P0: regra "AC violated ⇒ residual P0 mecânico" ausente na SKILL de slice-review (INV12/D4/R12)');
  }
  if (!/classificação por campo do state|sem juízo do revisor/i.test(text)) {
    violations.push('guard violated→P0: classificação mecânica (campo do state, sem juízo do revisor) ausente na SKILL de slice-review (INV12)');
  }
  return violations;
}

/**
 * INV4 (D5/D6/D21/CN2): a fase de verification precisa manter as três exigências
 * de contrato — eco obrigatório do veredito no formato de `repair_complete`,
 * âncora de execução de checks antes do veredito e roteamento do residual por
 * severidade declarada (P0/P1 → sidecar; P2/P3 → PD). Roteamento "a critério do
 * revisor" é juízo do modelo (R4) e é reprovado.
 */
export function guardVerificationAnchor(text) {
  if (text == null) {
    return ['guard verification: SKILL de slice-review ausente (INV4/CN2)'];
  }
  const violations = [];
  if (!/eco obrigatório do veredito/i.test(text)) {
    violations.push('guard verification eco: cláusula de eco obrigatório do veredito ausente na fase de verification (D21/VC4)');
  }
  if (!/repair_complete,\s*data\.verification/i.test(text)) {
    violations.push('guard verification eco: eco não aponta talos_lock_validator(action=repair_complete, data.verification) (D21/VC4)');
  }
  if (!/checks executados ANTES do veredito|executar os checks antes de julgar/i.test(text)) {
    violations.push('guard verification âncora: execução de checks antes do veredito ausente na fase de verification (D5/INV3)');
  }
  if (!/sem execução não há veredito/i.test(text)) {
    violations.push('guard verification âncora: cláusula "sem execução não há veredito" ausente na fase de verification (D5/INV3)');
  }
  if (!/roteamento do residual por severidade declarada/i.test(text)) {
    violations.push('guard roteamento por severidade: roteamento declarado ausente na fase de verification (D6/INV4)');
  }
  if (!/severidade P0\/P1[^|\n]*\|[^|\n]*sidecar/i.test(text) || !/severidade P2\/P3[^|\n]*\|[^|\n]*(?:talos_pendencies|PD)/i.test(text)) {
    violations.push('guard roteamento por severidade: destino P0/P1→sidecar ou P2/P3→PD ausente/invertido na fase de verification (D6/INV4)');
  }
  if (/a critério do revisor/i.test(text)) {
    violations.push('guard roteamento por severidade: roteamento "a critério do revisor" na SKILL de slice-review (D6/R4 — juízo do modelo)');
  }
  return violations;
}

/**
 * Enum/catálogo do loop (D7/D8 — CN5/CN3): `detached_repair` precisa existir em
 * `BACKLOG_STATES` (server) e na tabela de estados do template de backlog;
 * `talos-escalation-repair` precisa existir em `WORKFLOW_CONFIG.skills` (server)
 * e em `DISPATCHED_EXEC_AGENTS` (este módulo — os shims do id novo em 5 hosts
 * passam a ser cobertos pelos guards shim-drift/M4/M3 existentes).
 */
export function guardEnumCatalog({ server, template }) {
  const violations = [];
  if (server == null) {
    violations.push('guard enum/catálogo loop: server.js ausente (D7/D8)');
  } else {
    if (!/BACKLOG_STATES\s*=\s*new Set\([^\n]*detached_repair/.test(server)) {
      violations.push('guard enum/catálogo loop: detached_repair ausente de BACKLOG_STATES em server.js (D8/CN5)');
    }
    if (!/escalation_repair:\s*'talos-escalation-repair'/.test(server)) {
      violations.push('guard enum/catálogo loop: talos-escalation-repair ausente de WORKFLOW_CONFIG.skills em server.js (D7/CN3)');
    }
  }
  if (template == null) {
    violations.push('guard enum/catálogo loop: BACKLOG_MESTRE_TEMPLATE.md ausente (D8/CN5)');
  } else if (!/^\|\s*detached_repair\s*\|/m.test(template)) {
    violations.push('guard enum/catálogo loop: linha detached_repair ausente da tabela de estados do BACKLOG_MESTRE_TEMPLATE.md (D8/CN5)');
  }
  if (!DISPATCHED_EXEC_AGENTS.includes('talos-escalation-repair')) {
    violations.push('guard enum/catálogo loop: talos-escalation-repair ausente de DISPATCHED_EXEC_AGENTS (shims 5 hosts — D7/CN3)');
  }
  return violations;
}

/**
 * Handoff --loop (S03→S04): skill do orquestrador precisa do verbo de drain,
 * do close-and-reselect (não retry G4), da proibição de hops e do reset de
 * ciclo no mesmo run_id. Sem isso o MCP pode estar certo e o orquestrador
 * reimproviza a empacada.
 */
export function guardHandoffLoop(text) {
  if (text == null) {
    return ['guard handoff loop: SKILL do orquestrador ausente'];
  }
  const violations = [];
  if (!/drain_pendencies/.test(text)) {
    violations.push('guard handoff loop: next_action drain_pendencies ausente na SKILL do orquestrador');
  }
  if (!/close_pendencies_and_reselect/.test(text)) {
    violations.push('guard handoff loop: close_pendencies_and_reselect ausente na SKILL do orquestrador');
  }
  if (!/advance_blocked/.test(text)) {
    violations.push('guard handoff loop: advance_blocked ausente na SKILL do orquestrador');
  }
  if (!/sem hops/.test(text)) {
    violations.push('guard handoff loop: proibição de hops no fechamento ausente na SKILL do orquestrador');
  }
  if (!/validator_cycle/.test(text)) {
    violations.push('guard handoff loop: reset de validator_cycle no mesmo run_id ausente na SKILL do orquestrador');
  }
  return violations;
}
