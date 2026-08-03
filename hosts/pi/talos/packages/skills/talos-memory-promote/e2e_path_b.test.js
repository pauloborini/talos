import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPromoteFlow } from './scripts/promote_flow.mjs';

const SEEDED_HANDOFF = `# HANDOFF — E2E Path B

## Candidatos (0–3)

### Candidato 1
claim: Path B full-sprint-S09-20260802 preserva o handoff sem sink.
âncora.tipo: EVAL
âncora.valor: EVAL-002
ref: packages/skills/talos-memory-promote/e2e_path_b.test.js
motivo: prova E2E do soft-fail independente de Argus.
`;

test('EVAL-002 E2E: handoff seeded sem sink faz soft-fail e preserva o MD', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-e2e-path-b-'));
  const handoffPath = path.join(projectRoot, '.talos', 'memory', 'HANDOFF_S09_path_b.md');

  try {
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(handoffPath, SEEDED_HANDOFF);

    const result = await runPromoteFlow({
      projectRoot,
      capabilities: { tools: ['explore', 'search'] },
    });

    assert.equal(result.ok, false);
    assert.equal(result.soft, true);
    assert.equal(result.sink, 'none');
    assert.equal(result.handoff_path, '.talos/memory/HANDOFF_S09_path_b.md');
    assert.equal(fs.existsSync(handoffPath), true);
    assert.match(fs.readFileSync(handoffPath, 'utf8'), /full-sprint-S09-20260802/);
    assert.ok(result.promote.next_steps.length > 0);
    assert.match(
      result.message,
      /pipeline Talos já pode estar `done`/,
      'soft-fail não reverte uma sprint já concluída',
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
