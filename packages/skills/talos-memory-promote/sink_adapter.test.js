import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSink,
  promoteCandidates,
  rememberCallShape,
  SINKS,
} from './scripts/sink_adapter.mjs';

test('detectSink → argus_remember quando tool remember presente', () => {
  assert.equal(detectSink(['remember']), SINKS.ARGUS_REMEMBER);
  assert.equal(detectSink({ tools: [{ name: 'remember' }] }), SINKS.ARGUS_REMEMBER);
  assert.equal(detectSink({ remember: true }), SINKS.ARGUS_REMEMBER);
  assert.equal(detectSink({ tools: ['argus_memory_remember'] }), SINKS.ARGUS_REMEMBER);
});

test('detectSink → none sem Argus remember', () => {
  assert.equal(detectSink([]), SINKS.NONE);
  assert.equal(detectSink({ tools: ['search', 'explore'] }), SINKS.NONE);
  assert.equal(detectSink(null), SINKS.NONE);
  assert.equal(detectSink(undefined), SINKS.NONE);
});

test('atlas_memory_graph nunca é auto-selecionado por detectSink', () => {
  assert.notEqual(detectSink({ tools: ['atlas_memory_graph'] }), SINKS.ATLAS_MEMORY_GRAPH);
  assert.equal(detectSink({ tools: ['atlas_memory_graph'] }), SINKS.NONE);
});

test('soft-fail none preserva handoff_path', async () => {
  const result = await promoteCandidates({
    sink: SINKS.NONE,
    candidates: [{ claim: 'x', ancora: { tipo: 'EVAL', valor: 'E1' }, motivo: 'm' }],
    handoff_path: '.talos/memory/HANDOFF_demo_20260801.md',
  });
  assert.equal(result.ok, false);
  assert.equal(result.soft, true);
  assert.equal(result.sink, SINKS.NONE);
  assert.equal(result.handoff_path, '.talos/memory/HANDOFF_demo_20260801.md');
  assert.match(result.message, /Argus|sink/i);
  assert.ok(Array.isArray(result.next_steps));
  assert.ok(result.next_steps.some((s) => /Atlas/i.test(s)));
});

test('0 candidatos com none = sucesso sem soft-fail', async () => {
  const result = await promoteCandidates({
    sink: SINKS.NONE,
    candidates: [],
    handoff_path: '.talos/memory/HANDOFF_zero_20260801.md',
  });
  assert.equal(result.ok, true);
  assert.equal(result.promoted_count, 0);
  assert.match(result.message, /0 candidatos/i);
});

test('argus_remember com mock conta chamadas ≤3', async () => {
  const calls = [];
  const candidates = [
    { claim: 'a', ancora: { tipo: 'EVAL', valor: 'EVAL-001' }, motivo: 'm1' },
    { claim: 'b', ancora: { tipo: 'symbol', valor: 'detectSink' }, motivo: 'm2', ref: 'x.mjs' },
  ];
  const result = await promoteCandidates({
    sink: SINKS.ARGUS_REMEMBER,
    candidates,
    handoff_path: '.talos/memory/HANDOFF_ok_20260801.md',
    rememberFn: async (args) => {
      calls.push(args);
      return { stored: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.promoted_count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].claim, 'a');
  assert.equal(calls[0].anchor_type, 'EVAL');
  assert.deepEqual(rememberCallShape(candidates[1]).args.anchor_value, 'detectSink');
});

test('argus_remember sem rememberFn devolve shapes (agente executa)', async () => {
  const result = await promoteCandidates({
    sink: SINKS.ARGUS_REMEMBER,
    candidates: [{ claim: 'c', ancora: { tipo: 'id', valor: 'ID-1' }, motivo: 'm' }],
    handoff_path: '.talos/memory/HANDOFF_shapes_20260801.md',
  });
  assert.equal(result.ok, true);
  assert.equal(result.pending_agent_calls, true);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].tool, 'remember');
});
