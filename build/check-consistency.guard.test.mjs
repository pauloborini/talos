// AC-3.1.1 (OUT:CN7, plano 03): o guard DR01–04 falha se uma skill de execução
// (plan-execute / direct-execute / findings-repair), canônica ou espelho
// hosts/plugins, reensinar âncora morta do blob — e passa para as skills canônicas
// pós-Plano 02.
//
// Falsificador declarado no plano: "glob execute não é varrido" — se
// `collectExecuteSkillDirs` deixar de incluir um diretório de skill (ou o guard
// não escanear), a âncora plantada some e o teste fica vermelho.
//
// Fixtures em memória/temp FORA das skills reais: o repo canônico é verificado
// apenas por leitura (skills pós-Plano 2 devem passar o guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXECUTE_SKILLS,
  matchDrAnchors,
  collectExecuteSkillDirs,
  scanDirDr,
} from './dr-guard.mjs';
import {
  extractSkillReferencePaths,
  scanSkillReferenceGaps,
} from './skill-refs-guard.mjs';
import {
  DISPATCHED_EXEC_AGENTS,
  guardReviewReadonly,
  guardReviewBranch,
  guardNoReopen,
  guardViolatedP0,
  guardVerificationAnchor,
  guardEnumCatalog,
  guardHandoffLoop,
} from './loop-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── fixtures temporárias que mimetizam a árvore do repo ──────────────────────
function makeFixtureTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-guard-'));
  for (const s of EXECUTE_SKILLS) {
    fs.mkdirSync(path.join(root, 'packages', 'skills', s), { recursive: true });
    // espelho host + plugin (mesma estrutura dos catálogos gerados)
    fs.mkdirSync(path.join(root, 'hosts', 'zcode', 'skills', s), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugins', 'talos', 'skills', s), { recursive: true });
  }
  return root;
}

function plant(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test('AC-3.1.1: âncora DR01 plantada no glob de skill é reportada (falsificador: glob não varrido)', () => {
  const root = makeFixtureTree();
  plant(root, 'packages/skills/talos-plan-execute/SKILL.md',
    'Create `.talos/state/<run_id>/<slice>.json` following `packages/templates/STATE_FILE_SCHEMA.md`.\n');
  plant(root, 'packages/skills/talos-direct-execute/SKILL.md',
    'Use this skill to write code.\n');
  plant(root, 'packages/skills/talos-findings-repair/SKILL.md',
    'Fix findings.\n');
  // Espelhos carregam a mesma âncora.
  plant(root, 'hosts/zcode/skills/talos-plan-execute/SKILL.md',
    'Following `packages/templates/STATE_FILE_SCHEMA.md`.\n');
  plant(root, 'plugins/talos/skills/talos-plan-execute/SKILL.md',
    'Following `packages/templates/STATE_FILE_SCHEMA.md`.\n');

  const dirs = collectExecuteSkillDirs(root);
  for (const s of EXECUTE_SKILLS) {
    assert.ok(dirs.some((d) => d === path.join(root, 'packages', 'skills', s)), `glob inclui packages/skills/${s}`);
    assert.ok(dirs.some((d) => d === path.join(root, 'hosts', 'zcode', 'skills', s)), `glob inclui espelho host de ${s}`);
    assert.ok(dirs.some((d) => d === path.join(root, 'plugins', 'talos', 'skills', s)), `glob inclui espelho plugin de ${s}`);
  }

  const violations = dirs.flatMap((d) => scanDirDr(root, d));
  const dr01 = violations.filter((v) => v.dr === 'DR01');
  // 3 cópias plantadas (canônica + host + plugin) — qualquer uma sumida = glob não varrido.
  assert.equal(dr01.length, 3, `DR01 deve acusar nas 3 cópias, achou ${dr01.length}`);
  assert.ok(dr01.every((v) => v.rel.includes('talos-plan-execute')), 'DR01 reporta o path da skill');
});

test('AC-3.1.1: DR02–04 plantados são reportados com o ID certo', () => {
  const root = makeFixtureTree();
  plant(root, 'packages/skills/talos-direct-execute/SKILL.md',
    'Persist the full contract: `worktree_baseline` and `worktree_final` must equal the diff.\n');
  plant(root, 'packages/skills/talos-plan-execute/SKILL.md',
    'First, emit `executor_started`, then `skill_loaded`.\n');
  plant(root, 'packages/skills/talos-findings-repair/SKILL.md',
    'The state must include "acceptance_results" from the executor.\n');

  const violations = collectExecuteSkillDirs(root).flatMap((d) => scanDirDr(root, d));
  assert.ok(violations.some((v) => v.dr === 'DR02' && v.rel.includes('talos-direct-execute')), 'DR02 acusa instrução de persist de worktree_*');
  assert.ok(violations.some((v) => v.dr === 'DR03' && v.rel.includes('talos-plan-execute')), 'DR03 acusa checkpoints mortos');
  assert.ok(violations.some((v) => v.dr === 'DR04' && v.rel.includes('talos-findings-repair')), 'DR04 acusa "acceptance_results"');
});

test('AC-4.3.1: DR05 plantado é reportado (baseline no first_write / filtrar files_changed por proofs)', () => {
  const root = makeFixtureTree();
  plant(root, 'packages/skills/talos-plan-execute/SKILL.md',
    'O checkpoint grava baseline no first_write antes de mutar.\n');
  plant(root, 'packages/skills/talos-direct-execute/SKILL.md',
    'Necessário filtrar files_changed por proofs no retorno.\n');

  const violations = collectExecuteSkillDirs(root).flatMap((d) => scanDirDr(root, d));
  assert.ok(violations.some((v) => v.dr === 'DR05' && v.rel.includes('talos-plan-execute')), 'DR05 acusa baseline no first_write');
  assert.ok(violations.some((v) => v.dr === 'DR05' && v.rel.includes('talos-direct-execute')), 'DR05 acusa filtrar files_changed por proofs');
});


test('AC-3.1.1: leitura de worktree_* para contexto NÃO é DR02 (skill repair canônica)', () => {
  const root = makeFixtureTree();
  // Mesma redação da skill repair pós-Plano 02: leitura para contexto, atualização é do MCP.
  plant(root, 'packages/skills/talos-findings-repair/SKILL.md',
    'Capture também `state_schema_version`, `base_sha`, `head_sha`, `check_table`, `task_evidence`, `repair_evidence`, `worktree_baseline` e `worktree_final` do state (leitura para contexto — a atualização desses campos é do MCP).\n');
  const violations = collectExecuteSkillDirs(root).flatMap((d) => scanDirDr(root, d));
  assert.ok(!violations.some((v) => v.dr === 'DR02'), 'leitura de worktree_* não é âncora DR02');
});

test('AC-3.1.1: allowlist — talos-task-validator (cita schema) não é varrido; MCP/testes fora do glob', () => {
  const root = makeFixtureTree();
  // Task-validator legitima cita STATE_FILE_SCHEMA.md e worktree_* — fora da allowlist
  // do design spec §6.1, não deve ser reportado.
  plant(root, 'packages/skills/talos-task-validator/SKILL.md',
    'Read the JSON file using the schema in `packages/templates/STATE_FILE_SCHEMA.md`.\n');
  const dirs = collectExecuteSkillDirs(root);
  assert.ok(!dirs.some((d) => d.includes('talos-task-validator')), 'allowlist: task-validator fora do glob');
  const violations = dirs.flatMap((d) => scanDirDr(root, d));
  assert.equal(violations.length, 0, 'árvore limpa não produz DR*');
});

test('AC-3.1.1: skills canônicas pós-Plano 02 + espelhos hosts/plugins passam o guard no repo real', () => {
  const dirs = collectExecuteSkillDirs(ROOT);
  for (const s of EXECUTE_SKILLS) {
    assert.ok(dirs.some((d) => d === path.join(ROOT, 'packages', 'skills', s)), `canônica ${s} no glob`);
  }
  const violations = dirs.flatMap((d) => scanDirDr(ROOT, d));
  assert.deepEqual(violations, [], 'repo pós-Plano 2 não tem âncora DR* nas skills de execução (canônicas + espelhos)');
});

// matchDrAnchors é a unidade que o guard usa — cobertura direta dos 5 IDs.
test('matchDrAnchors: 5 âncoras individuais', () => {
  assert.deepEqual(matchDrAnchors('schema em STATE_FILE_SCHEMA.md'), ['DR01']);
  assert.deepEqual(matchDrAnchors('capture worktree_baseline before mutation'), ['DR02']);
  assert.deepEqual(matchDrAnchors('emit state_path_created before handoff'), ['DR03']);
  assert.deepEqual(matchDrAnchors('payload com "acceptance_results"'), ['DR04']);
  assert.deepEqual(matchDrAnchors('grava baseline no first_write'), ['DR05']);
  assert.deepEqual(matchDrAnchors('necessário filtrar files_changed por proofs'), ['DR05']);
  assert.deepEqual(matchDrAnchors('first_write e talos_commit_state'), []);
  assert.deepEqual(matchDrAnchors('O executor nunca monta o JSON'), []);
});

// ── Loop de sprints: fixtures dos falsificadores (Plano 06 — AC-06.1.x/AC-06.2.1) ──
// Cada teste planta o texto-regressão e exige violação da guard; o repo canônico é
// verificado por leitura (texto correto não produz violação). "Remover a guarda"
// (falsificador do AC) deixa a fixture sem reprovação → teste vermelho.
const ORCH_SKILL = fs.readFileSync(path.join(ROOT, 'packages/orchestrator/skills/talos/SKILL.md'), 'utf8');
const REVIEW_SKILL = fs.readFileSync(path.join(ROOT, 'packages/skills/talos-slice-review/SKILL.md'), 'utf8');
const SERVER_JS = fs.readFileSync(path.join(ROOT, 'packages/mcp-server/server.js'), 'utf8');
const BACKLOG_TMPL = fs.readFileSync(path.join(ROOT, 'packages/templates/BACKLOG_MESTRE_TEMPLATE.md'), 'utf8');

test('guard review read-only (AC-06.1.1/INV1): instrução de mutação é reprovada; repo passa', () => {
  // Falsificador 1: instrução de chamada de talos_commit_state injetada na review.
  const comCommit = REVIEW_SKILL + '\nAo fim, execute `talos_commit_state` para gravar o veredito no state.\n';
  const v1 = guardReviewReadonly(comCommit);
  assert.ok(v1.some((v) => v.includes('instrução de chamada de talos_commit_state')), `guard INV1 reprova chamada: ${JSON.stringify(v1)}`);
  // Falsificador 2: instrução de Write de state injetada.
  const comWrite = REVIEW_SKILL + '\nEscreva o state file diretamente via Write antes de devolver o relatório.\n';
  const v2 = guardReviewReadonly(comWrite);
  assert.ok(v2.some((v) => v.includes('instrução de Write')), `guard INV1 reprova Write de state: ${JSON.stringify(v2)}`);
  // Falsificador 3: regra read-only removida da skill.
  const semRegra = REVIEW_SKILL.replace(/Read-only:[^\n]*talos_commit_state[^\n]*/, 'Read-only: regra removida.');
  const v3 = guardReviewReadonly(semRegra);
  assert.ok(v3.some((v) => v.includes('regra read-only')), `guard INV1 reprova ausência da regra: ${JSON.stringify(v3)}`);
  // Proibições legítimas (texto atual) não são falso-positivo.
  assert.deepEqual(guardReviewReadonly(REVIEW_SKILL), [], 'repo correto não produz violação de read-only');
});

test('guard ramo review (AC-06.1.2/INV2/LEG1): ramo antigo é reprovado; G4 sem 2º validator é reprovado; repo passa', () => {
  // Falsificador 1: ramo morto reinjetado no bloco EXEC (review → 2º validator → nova review).
  const ramoAntigo = ORCH_SKILL.replace(
    '**Residual — a mesma cadeia em loop e standalone (D13, sem condicional de `--loop`):**',
    '**Residual — a mesma cadeia em loop e standalone (D13, sem condicional de `--loop`):** P0/P1 na review → talos-findings-repair → 2º validator → nova review completa. (ramo antigo reinjetado)',
  );
  assert.notEqual(ramoAntigo, ORCH_SKILL, 'âncora da mutação existe no texto real');
  const v1 = guardReviewBranch(ramoAntigo);
  assert.ok(v1.some((v) => v.includes('ramo review do orquestrador cita')), `guard LEG1 reprova ramo antigo: ${JSON.stringify(v1)}`);
  // Falsificador 2: cutover excessivo — G4 perde o "2º e último" validator (R2).
  const g4Cortado = ORCH_SKILL.replace('fecha o repair e executa o **2º e último** validator', 'fecha o repair e executa o validator final');
  assert.notEqual(g4Cortado, ORCH_SKILL, 'âncora G4 existe no texto real');
  const v2 = guardReviewBranch(g4Cortado);
  assert.ok(v2.some((v) => v.includes('perdeu o "2º e último" validator')), `guard reprova cutover excessivo: ${JSON.stringify(v2)}`);
  // Falsificador 3: despacho de task-validator dentro do ramo review (INV2).
  const comDispatch = ORCH_SKILL.replace(
    '**Review crítica (CN5/D06) e cadeia de fechamento (D3/D4/D13):**',
    '**Review crítica (CN5/D06) e cadeia de fechamento (D3/D4/D13):** ao residual, despachar talos-task-validator para recobrir a slice.',
  );
  const v3 = guardReviewBranch(comDispatch);
  assert.ok(v3.some((v) => v.includes('despacha talos-task-validator')), `guard INV2 reprova dispatch no ramo review: ${JSON.stringify(v3)}`);
  // Falso-positivo do repo correto: G8/G4/EXEC legítimos (proibições + cadeia nova) passam.
  assert.deepEqual(guardReviewBranch(ORCH_SKILL), [], 'repo correto não produz violação no ramo review');
});

test('guard sem reabertura (AC-06.1.3/INV10): exceção de reabertura é reprovada; repo passa', () => {
  // Falsificador: condição de reabertura de review por finding novo.
  const comReabertura = REVIEW_SKILL + '\nSe um finding novo aparecer fora do delta, reabra a review completa para recobrir a slice.\n';
  const v1 = guardNoReopen(comReabertura);
  assert.ok(v1.some((v) => v.includes('condição de reabertura')), `guard INV10 reprova reabertura: ${JSON.stringify(v1)}`);
  // Falsificador real do AC-03.2.2 (recibo do Plano 03): infinitivo "reabrir" em
  // linha própria — /reabr\w*/ não casa "reabrir" (r-e-a-b-i-r); a âncora precisa
  // de /reab\w*/ para cobrir todas as flexões do verbo.
  const comReabrirInfinitivo = REVIEW_SKILL + '\nSe o finding novo for relevante o bastante, o revisor pode reabrir a review completa para cobrir o caso.\n';
  const v1b = guardNoReopen(comReabrirInfinitivo);
  assert.ok(v1b.some((v) => v.includes('condição de reabertura')), `guard INV10 reprova "reabrir" infinitivo: ${JSON.stringify(v1b)}`);
  // Falsificador 2: proibição removida da skill.
  const semProibicao = REVIEW_SKILL.replace('É proibido reabrir a review completa', 'A review pode ser reaberta quando necessário');
  const v2 = guardNoReopen(semProibicao);
  assert.ok(v2.some((v) => v.includes('proibição de reabrir')), `guard INV10 reprova ausência da proibição: ${JSON.stringify(v2)}`);
  assert.deepEqual(guardNoReopen(REVIEW_SKILL), [], 'repo correto não produz violação de reabertura');
});

test('guard violated para P0 (AC-06.1.4/INV12): regra ausente é reprovada; repo passa', () => {
  // Falsificador: regra violated⇒P0 removida (tabela + bullet da verification).
  const semRegra = REVIEW_SKILL
    .replace(/\n\| AC `violated` no state[^\n]*\|/, '')
    .replace(/\n- `violated` no state ⇒ residual P0 mecânico \(INV12\)\./, '');
  assert.notEqual(semRegra, REVIEW_SKILL, 'âncoras da regra violated⇒P0 existem no texto real');
  const v1 = guardViolatedP0(semRegra);
  assert.ok(v1.some((v) => v.includes('residual P0 mecânico')), `guard INV12 reprova ausência: ${JSON.stringify(v1)}`);
  assert.deepEqual(guardViolatedP0(REVIEW_SKILL), [], 'repo correto não produz violação violated→P0');
});

test('guard verification eco, âncora e roteamento (AC-06.1.5/INV4): exigências ausentes ou juízo do revisor são reprovados; repo passa', () => {
  // Falsificador 1: cláusula de eco removida.
  const semEco = REVIEW_SKILL.replace('### Saída: eco obrigatório do veredito (VC4/D21)', '### Saída');
  assert.notEqual(semEco, REVIEW_SKILL, 'âncora do eco existe no texto real');
  assert.ok(guardVerificationAnchor(semEco).some((v) => v.includes('eco obrigatório')), 'guard reprova eco ausente');
  // Falsificador 2: âncora de checks removida.
  const semAncora = REVIEW_SKILL.replace('**checks executados ANTES do veredito; sem execução não há veredito.**', 'a ordem fica a cargo do revisor.');
  assert.ok(guardVerificationAnchor(semAncora).some((v) => v.includes('checks antes do veredito') || v.includes('sem execução não há veredito')), 'guard reprova âncora ausente');
  // Falsificador 3: roteamento por severidade removido.
  const semRoteamento = REVIEW_SKILL.replace('### Roteamento do residual por severidade declarada (D6/INV4)', '### Roteamento do residual');
  assert.ok(guardVerificationAnchor(semRoteamento).some((v) => v.includes('roteamento declarado')), 'guard reprova roteamento ausente');
  // Falsificador 4: roteamento por juízo do revisor (D6/R4).
  const comJuizo = REVIEW_SKILL + '\nDestino do residual: a critério do revisor.\n';
  assert.ok(guardVerificationAnchor(comJuizo).some((v) => v.includes('a critério do revisor')), 'guard reprova juízo do revisor');
  assert.deepEqual(guardVerificationAnchor(REVIEW_SKILL), [], 'repo correto não produz violação de verification');
});

test('guard enum e catálogo loop (AC-06.2.1): drift de enum/catálogo é reprovado; repo passa', () => {
  // Falsificador 1: detached_repair removido de BACKLOG_STATES.
  const semEstado = SERVER_JS.replace("'manual_validation_pending', 'done', 'blocked', 'detached_repair'", "'manual_validation_pending', 'done', 'blocked'");
  assert.notEqual(semEstado, SERVER_JS, 'âncora do enum existe no server real');
  assert.ok(guardEnumCatalog({ server: semEstado, template: BACKLOG_TMPL }).some((v) => v.includes('BACKLOG_STATES')), 'guard reprova enum sem detached_repair');
  // Falsificador 2: linha detached_repair removida do template de backlog.
  const semLinha = BACKLOG_TMPL.replace(/^\|\s*detached_repair[^\n]*\n/m, '');
  assert.notEqual(semLinha, BACKLOG_TMPL, 'âncora da tabela existe no template real');
  assert.ok(guardEnumCatalog({ server: SERVER_JS, template: semLinha }).some((v) => v.includes('BACKLOG_MESTRE_TEMPLATE')), 'guard reprova template sem detached_repair');
  // Falsificador 3: id do sidecar removido de WORKFLOW_CONFIG.skills.
  const semCatalogo = SERVER_JS.replace("escalation_repair: 'talos-escalation-repair',", '');
  assert.notEqual(semCatalogo, SERVER_JS, 'âncora do catálogo existe no server real');
  assert.ok(guardEnumCatalog({ server: semCatalogo, template: BACKLOG_TMPL }).some((v) => v.includes('WORKFLOW_CONFIG')), 'guard reprova catálogo sem sidecar');
  // Falso-positivo: id do sidecar fora de DISPATCHED_EXEC_AGENTS.
  assert.ok(DISPATCHED_EXEC_AGENTS.includes('talos-escalation-repair'), 'sidecar registrado em DISPATCHED_EXEC_AGENTS (5 hosts via shim-drift/M4)');
  assert.deepEqual(guardEnumCatalog({ server: SERVER_JS, template: BACKLOG_TMPL }), [], 'repo correto não produz violação de enum/catálogo');
});

test('guard handoff loop: skill sem drain/reset é reprovada; repo passa', () => {
  const semDrain = ORCH_SKILL.replaceAll('drain_pendencies', 'drenar_pendencias');
  assert.notEqual(semDrain, ORCH_SKILL);
  assert.ok(guardHandoffLoop(semDrain).some((v) => v.includes('drain_pendencies')), `guard reprova skill sem drain: ${JSON.stringify(guardHandoffLoop(semDrain))}`);
  const semReset = ORCH_SKILL.replaceAll('validator_cycle', 'ciclo_validator');
  assert.ok(guardHandoffLoop(semReset).some((v) => v.includes('validator_cycle')), `guard reprova skill sem reset de ciclo: ${JSON.stringify(guardHandoffLoop(semReset))}`);
  assert.deepEqual(guardHandoffLoop(ORCH_SKILL), [], 'repo correto não produz violação de handoff loop');
  assert.deepEqual(guardHandoffLoop(null), ['guard handoff loop: SKILL do orquestrador ausente']);
});

test('skill refs: citação packages/skills/.../references/ ausente no espelho falha', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-refs-'));
  plant(root, 'packages/skills/talos-backlog-generator/SKILL.md',
    'leia `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md`\n');
  plant(root, 'packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md', 'mandato\n');
  plant(root, 'hosts/zcode/skills/talos-backlog-generator/SKILL.md',
    'leia `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md`\n');
  const gaps = scanSkillReferenceGaps(root);
  assert.ok(gaps.some((g) => g.rel.includes('hosts/zcode') && g.cited.includes('COLD_BACKLOG_REVIEW_PROMPT')),
    `espelho sem references/ deve falhar, gaps=${JSON.stringify(gaps)}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('skill refs: ../_shared/references citado e presente passa; ausente falha', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-refs-shared-'));
  plant(root, 'packages/skills/talos-task-validator/SKILL.md',
    'baseline `../_shared/references/stack-profiles.md`\n');
  const missing = scanSkillReferenceGaps(root);
  assert.ok(missing.some((g) => g.cited.includes('stack-profiles.md')), 'shared ausente falha');
  plant(root, 'packages/skills/_shared/references/stack-profiles.md', '# perfis\n');
  assert.deepEqual(scanSkillReferenceGaps(root), [], 'shared presente passa');
  fs.rmSync(root, { recursive: true, force: true });
});

test('skill refs: extract cobre packages/skills e _shared', () => {
  const paths = extractSkillReferencePaths(
    'a `packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md` e `../_shared/references/stack-profiles.md`',
  );
  assert.deepEqual(paths.sort(), [
    '../_shared/references/stack-profiles.md',
    'packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md',
  ]);
});
