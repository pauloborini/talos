import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPromoteFlow } from './scripts/promote_flow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixtures, name), 'utf8');
}

test('EVAL-003: 0 candidatos → sucesso, 0 promote', async () => {
  const calls = [];
  const result = await runPromoteFlow({
    projectRoot: process.cwd(),
    handoffPath: '(inline)',
    markdown: readFixture('handoff_zero.md'),
    capabilities: { tools: ['remember'] },
    rememberFn: async (args) => {
      calls.push(args);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.promoted_count, 0);
  assert.equal(calls.length, 0);
  assert.equal(result.parse.zero_success, true);
});

test('EVAL-002: sem sink → soft-fail + handoff_path', async () => {
  const result = await runPromoteFlow({
    projectRoot: process.cwd(),
    handoffPath: '.talos/memory/HANDOFF_fixture_valid.md',
    markdown: readFixture('handoff_valid.md'),
    capabilities: { tools: ['explore', 'search'] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.soft, true);
  assert.equal(result.sink, 'none');
  assert.equal(result.handoff_path, '.talos/memory/HANDOFF_fixture_valid.md');
  assert.match(result.message, /Argus|sink|HANDOFF/i);
});

test('EVAL-001: com sink mock → promove válidos; descarta sprint_path', async () => {
  const calls = [];
  const result = await runPromoteFlow({
    projectRoot: process.cwd(),
    handoffPath: '.talos/memory/HANDOFF_fixture_mixed.md',
    markdown: readFixture('handoff_invalid_anchor.md'),
    capabilities: ['remember'],
    rememberFn: async (args) => {
      calls.push(args);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sink, 'argus_remember');
  assert.equal(result.promoted_count, 2);
  assert.equal(calls.length, 2);
  assert.ok(result.parse.discarded.some((d) => d.reason === 'anchor_sprint_path_only'));
  assert.ok(result.parse.discarded.some((d) => d.reason === 'over_cap'));
  assert.ok(
    calls.every(
      (c) =>
        !JSON.stringify(c.tags ?? []).includes('SPRINT_S04_skill_memory_promote.md')
        && !String(c.content ?? '').includes('SPRINT_S04_skill_memory_promote.md'),
    ),
  );
  assert.ok(calls.every((c) => c.type === 'decision' && Array.isArray(c.tags) && c.tags.includes('talos-handoff')));
});

test('resolveHandoffPath: mais recente sob .talos/memory/', async () => {
  const tmp = fs.mkdtempSync(path.join(here, '.tmp-promote-'));
  try {
    const memory = path.join(tmp, '.talos', 'memory');
    fs.mkdirSync(memory, { recursive: true });
    const older = path.join(memory, 'HANDOFF_old_20260101.md');
    const newer = path.join(memory, 'HANDOFF_new_20260801.md');
    fs.writeFileSync(older, '## Candidatos (0–3)\n\n0 candidatos — nenhum fato. Sucesso.\n');
    fs.writeFileSync(newer, '## Candidatos (0–3)\n\n0 candidatos — nenhum fato. Sucesso.\n');
    const past = Date.now() - 60_000;
    fs.utimesSync(older, past / 1000, past / 1000);

    const result = await runPromoteFlow({
      projectRoot: tmp,
      capabilities: {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.handoff_path, '.talos/memory/HANDOFF_new_20260801.md');
    assert.equal(result.promoted_count, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
