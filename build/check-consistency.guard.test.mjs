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

// matchDrAnchors é a unidade que o guard usa — cobertura direta dos 4 IDs.
test('matchDrAnchors: 4 âncoras individuais', () => {
  assert.deepEqual(matchDrAnchors('schema em STATE_FILE_SCHEMA.md'), ['DR01']);
  assert.deepEqual(matchDrAnchors('capture worktree_baseline before mutation'), ['DR02']);
  assert.deepEqual(matchDrAnchors('emit state_path_created before handoff'), ['DR03']);
  assert.deepEqual(matchDrAnchors('payload com "acceptance_results"'), ['DR04']);
  assert.deepEqual(matchDrAnchors('first_write e talos_commit_state'), []);
  assert.deepEqual(matchDrAnchors('O executor nunca monta o JSON'), []);
});
