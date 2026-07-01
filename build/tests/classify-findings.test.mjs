import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFindings } from '../../packages/skills/talos-slice-review/scripts/classify_findings.mjs';

const valid = () => ({
  severity: 'P1', task_id: 'T01', title: 'Finding', file: 'a.js', line: 1,
  failure_mode: 'falha', evidence: 'evidência', recommendation: 'corrigir', fix_validation: 'testar',
});

test('classificador aceita finding completo e array vazio', () => {
  assert.equal(classifyFindings([valid()])[0].recommendation, 'corrigir');
  assert.deepEqual(classifyFindings([]), []);
});

test('classificador rejeita severidade, linha e campos inválidos', () => {
  assert.throws(() => classifyFindings([{ ...valid(), severity: 'high' }]), /invalid severity/);
  assert.throws(() => classifyFindings([{ ...valid(), line: 0 }]), /invalid line/);
  const missing = valid(); delete missing.recommendation;
  assert.throws(() => classifyFindings([missing]), /recommendation/);
});
