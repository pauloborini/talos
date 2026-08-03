import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPromoteFlow } from './scripts/promote_flow.mjs';

const CLAIM = 'Path A full-sprint-S09-20260802 promove shape compatível com recall Argus.';
const SEEDED_HANDOFF = `# HANDOFF — E2E Path A

## Candidatos (0–3)

### Candidato 1
claim: ${CLAIM}
âncora.tipo: EVAL
âncora.valor: EVAL-001
ref: packages/skills/talos-memory-promote/e2e_path_a.test.js
motivo: prova E2E do shape consumido pelo smoke S08.
`;

test('EVAL-001 E2E: handoff seeded promove shape compatível com recall Argus S08', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-e2e-path-a-'));
  const handoffPath = path.join(projectRoot, '.talos', 'memory', 'HANDOFF_S09_path_a.md');
  const remembered = [];

  try {
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(handoffPath, SEEDED_HANDOFF);

    const result = await runPromoteFlow({
      projectRoot,
      capabilities: { tools: ['remember'] },
      rememberFn: async (args) => {
        remembered.push(args);
        return { state: 'sucesso', fts_indexed: true };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.soft, false);
    assert.equal(result.sink, 'argus_remember');
    assert.equal(result.promoted_count, 1);
    assert.equal(result.handoff_path, '.talos/memory/HANDOFF_S09_path_a.md');
    assert.deepEqual(remembered, [{
      content: `${CLAIM} — prova E2E do shape consumido pelo smoke S08.`,
      type: 'decision',
      tags: ['talos-handoff', 'anchor:EVAL:EVAL-001'],
      links: ['packages/skills/talos-memory-promote/e2e_path_a.test.js'],
    }]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
