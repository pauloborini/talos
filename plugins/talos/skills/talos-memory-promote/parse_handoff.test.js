import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHandoffMarkdown,
  parseHandoffFile,
  isSprintOrBacklogOnlyAnchor,
} from './scripts/parse_handoff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

test('0 candidatos = zero_success sem candidatos', () => {
  const md = fs.readFileSync(path.join(fixtures, 'handoff_zero.md'), 'utf8');
  const result = parseHandoffMarkdown(md);
  assert.equal(result.zero_success, true);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.discarded.length, 0);
});

test('candidatos válidos com âncora forte', () => {
  const result = parseHandoffFile(path.join(fixtures, 'handoff_valid.md'));
  assert.equal(result.zero_success, false);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].ancora.tipo, 'EVAL');
  assert.equal(result.candidates[0].ancora.valor, 'EVAL-001');
  assert.equal(result.candidates[0].ref, 'packages/skills/talos-plan-execute/SKILL.md');
  assert.equal(result.candidates[1].ancora.tipo, 'finding');
  assert.equal(result.candidates[1].ref, undefined);
});

test('descarta âncora sprint_path e 4º candidato', () => {
  const result = parseHandoffFile(path.join(fixtures, 'handoff_invalid_anchor.md'));
  assert.equal(result.candidates.length, 2);
  assert.ok(result.discarded.some((d) => d.reason === 'anchor_sprint_path_only'));
  assert.ok(result.discarded.some((d) => d.reason === 'over_cap'));
  assert.deepEqual(
    result.candidates.map((c) => c.ancora.valor),
    ['EVAL-003', 'detectSink'],
  );
});

test('isSprintOrBacklogOnlyAnchor reconhece paths', () => {
  assert.equal(isSprintOrBacklogOnlyAnchor('SPRINT_S04_skill_memory_promote.md'), true);
  assert.equal(
    isSprintOrBacklogOnlyAnchor('.talos/backlog/sprints/SPRINT_S01_x.md'),
    true,
  );
  assert.equal(isSprintOrBacklogOnlyAnchor('EVAL-001'), false);
  assert.equal(isSprintOrBacklogOnlyAnchor('detectSink'), false);
});

test('rejeita âncora tipo inválido e claim vazio', () => {
  const md = `## Candidatos (0–3)

### Candidato 1
claim:
âncora.tipo: sprint_path
âncora.valor: SPRINT_S01.md
motivo: x
`;
  const result = parseHandoffMarkdown(md);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.discarded.some((d) => d.reason === 'claim_empty' || d.reason === 'anchor_type_invalid'));
});
