import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPolicyCandidate,
  proposePolicyCandidates,
  resolvePolicyTarget,
} from './scripts/policy_promote.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixtures, name), 'utf8');
}

function makeTempProject() {
  const tmp = fs.mkdtempSync(path.join(here, '.tmp-policy-'));
  const sprints = path.join(tmp, '.talos', 'backlog', 'sprints');
  fs.mkdirSync(sprints, { recursive: true });
  const sprintPath = path.join(sprints, 'SPRINT_S99_policy_fixture.md');
  const sprintBody = `# Sprint S99 fixture

## 10. Policy manifest

\`\`\`yaml
policy_manifest:
  forbidden_scope:
    - "archive/"
  data_safety:
    - "sem auto-write"
  required_gates:
    - "talos-task-validator"
\`\`\`
`;
  fs.writeFileSync(sprintPath, sprintBody, 'utf8');
  return { tmp, sprintPath, sprintRel: '.talos/backlog/sprints/SPRINT_S99_policy_fixture.md' };
}

function handoffForSprint(sprintId, candidatesBody) {
  return `# HANDOFF — policy fixture

## Metadados

| Campo | Valor |
|---|---|
| sprint_id | ${sprintId} |
| data | 2026-08-02 |
| status_pos_validator | pass |
| origem | test |

---

## Candidatos (0–3)

${candidatesBody}
`;
}

const ONE_CANDIDATE = `### Candidato 1
claim: Candidata policy exige OK humano antes de gravar.
âncora.tipo: EVAL
âncora.valor: EVAL-001
ref: packages/skills/talos-memory-promote/scripts/policy_promote.mjs
motivo: prova list-before-write Q3/D3.
`;

test('EVAL-001: propose não altera arquivo; apply confirmed grava promoted', () => {
  const { tmp, sprintPath, sprintRel } = makeTempProject();
  try {
    const before = fs.readFileSync(sprintPath, 'utf8');
    const md = handoffForSprint('S99', ONE_CANDIDATE);

    const proposed = proposePolicyCandidates({
      projectRoot: tmp,
      handoffMarkdown: md,
    });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.candidates.length, 1);
    assert.equal(proposed.candidates[0].anchor, 'EVAL:EVAL-001');
    assert.equal(proposed.target.target_path, sprintRel);
    assert.equal(fs.readFileSync(sprintPath, 'utf8'), before, 'propose não muta disco');

    const applied = applyPolicyCandidate({
      projectRoot: tmp,
      target_path: proposed.target.target_path,
      candidate: {
        claim: proposed.candidates[0].claim,
        anchor: proposed.candidates[0].anchor,
        source_handoff: '.talos/memory/HANDOFF_fixture.md',
        confirmed_at: '2026-08-02',
      },
      confirmed: true,
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.wrote, true);

    const after = fs.readFileSync(sprintPath, 'utf8');
    assert.notEqual(after, before);
    assert.match(after, /promoted:/);
    assert.match(after, /Candidata policy exige OK humano antes de gravar/);
    assert.match(after, /anchor:\s*EVAL:EVAL-001/);
    assert.match(after, /forbidden_scope:/);
    assert.match(after, /required_gates:/);
    assert.match(after, /data_safety:/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('EVAL-002: confirmed=false soft-fail; bytes do alvo iguais; handoff intacto', () => {
  const { tmp, sprintPath } = makeTempProject();
  try {
    const before = fs.readFileSync(sprintPath, 'utf8');
    const md = handoffForSprint('S99', ONE_CANDIDATE);
    const proposed = proposePolicyCandidates({ projectRoot: tmp, handoffMarkdown: md });
    assert.equal(proposed.ok, true);

    const refused = applyPolicyCandidate({
      projectRoot: tmp,
      target_path: proposed.target.target_path,
      candidate: proposed.candidates[0],
      confirmed: false,
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.soft, true);
    assert.equal(refused.wrote, false);
    assert.equal(fs.readFileSync(sprintPath, 'utf8'), before);
    assert.equal(md, handoffForSprint('S99', ONE_CANDIDATE), 'handoff MD intacto');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('EVAL-002: path inválido / sem fence → soft-fail', () => {
  const { tmp, sprintPath } = makeTempProject();
  try {
    const before = fs.readFileSync(sprintPath, 'utf8');

    const missing = resolvePolicyTarget({
      projectRoot: tmp,
      sprintId: 'S00',
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.soft, true);
    assert.equal(missing.code, 'target_unresolved');

    const badApply = applyPolicyCandidate({
      projectRoot: tmp,
      target_path: '.talos/backlog/sprints/DOES_NOT_EXIST.md',
      candidate: { claim: 'x', anchor: 'EVAL:EVAL-001' },
      confirmed: true,
    });
    assert.equal(badApply.ok, false);
    assert.equal(badApply.soft, true);

    const forbidden = applyPolicyCandidate({
      projectRoot: tmp,
      target_path: '.talos/policy/rules.yaml',
      candidate: { claim: 'x', anchor: 'EVAL:EVAL-001' },
      confirmed: true,
    });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.soft, true);
    assert.equal(forbidden.code, 'target_forbidden');
    assert.equal(fs.readFileSync(sprintPath, 'utf8'), before);
    assert.ok(!fs.existsSync(path.join(tmp, '.talos', 'policy')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('EVAL-003: 0 candidatas → sucesso sem write', () => {
  const { tmp, sprintPath } = makeTempProject();
  try {
    const before = fs.readFileSync(sprintPath, 'utf8');
    const md = handoffForSprint(
      'S99',
      '0 candidatos — nenhum fato durável pós-validator. Sucesso.\n',
    );
    const proposed = proposePolicyCandidates({
      projectRoot: tmp,
      handoffMarkdown: md,
    });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.candidates.length, 0);
    assert.match(proposed.message, /0 candidatas/i);
    assert.equal(fs.readFileSync(sprintPath, 'utf8'), before);

    // fixture zero do pacote também
    const fromFixture = proposePolicyCandidates({
      projectRoot: tmp,
      handoffMarkdown: readFixture('handoff_zero.md').replace('S04', 'S99'),
    });
    assert.equal(fromFixture.ok, true);
    assert.equal(fromFixture.candidates.length, 0);
    assert.equal(fs.readFileSync(sprintPath, 'utf8'), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('apply idempotente: claim+anchor duplicado = no-op sucesso', () => {
  const { tmp } = makeTempProject();
  try {
    const md = handoffForSprint('S99', ONE_CANDIDATE);
    const proposed = proposePolicyCandidates({ projectRoot: tmp, handoffMarkdown: md });
    const cand = {
      claim: proposed.candidates[0].claim,
      anchor: proposed.candidates[0].anchor,
      confirmed_at: '2026-08-02',
    };
    const first = applyPolicyCandidate({
      projectRoot: tmp,
      target_path: proposed.target.target_path,
      candidate: cand,
      confirmed: true,
    });
    assert.equal(first.wrote, true);
    const mid = fs.readFileSync(path.join(tmp, proposed.target.target_path), 'utf8');
    const second = applyPolicyCandidate({
      projectRoot: tmp,
      target_path: proposed.target.target_path,
      candidate: cand,
      confirmed: true,
    });
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.wrote, false);
    assert.equal(fs.readFileSync(path.join(tmp, proposed.target.target_path), 'utf8'), mid);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
