// Testes de unidade do núcleo portável do MCP (S04 / F2-A6).
// Cobre: detecção de host (registry data-driven + precedência), contrato
// atlas_capabilities (schema_version, flags, known_hosts) e hard-fail de
// pré-requisitos (DEC-004). Rodar: node --test packages/mcp-server/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOST_NAMES,
  PREREQUISITES,
  CAPABILITIES_SCHEMA_VERSION,
  detectHost,
  capabilities,
  checkPrerequisites,
} from './server.js';

test('detectHost: arg host explícito tem prioridade máxima', () => {
  const r = detectHost({ host: 'codex' }, { CLAUDE_PLUGIN_ROOT: '/x' });
  assert.equal(r.host, 'codex');
  assert.equal(r.detected_via, 'arg');
});

test('detectHost: ATLAS_HOST sobrepõe sinais de env nativos', () => {
  const r = detectHost({}, { ATLAS_HOST: 'codex', CLAUDE_PLUGIN_ROOT: '/x' });
  assert.equal(r.host, 'codex');
  assert.equal(r.detected_via, 'env:ATLAS_HOST');
});

test('detectHost: env nativo Claude/Codex via registry', () => {
  assert.equal(detectHost({}, { CLAUDE_PLUGIN_ROOT: '/x' }).host, 'claude');
  assert.equal(detectHost({}, { CODEX_HOME: '/y' }).host, 'codex');
  assert.equal(detectHost({}, { CODEX_PLUGIN_ROOT: '/y' }).host, 'codex');
});

test('detectHost: sem sinal cai em generic', () => {
  const r = detectHost({}, {});
  assert.equal(r.host, 'generic');
  assert.equal(r.detected_via, 'default');
});

test('detectHost: host inválido em arg/env é ignorado (cai em generic)', () => {
  assert.equal(detectHost({ host: 'inexistente' }, {}).host, 'generic');
  assert.equal(detectHost({}, { ATLAS_HOST: 'inexistente' }).host, 'generic');
});

test('capabilities: schema_version atual e campos do contrato v2', () => {
  const cap = capabilities({ host: 'claude' });
  assert.equal(cap.schema_version, CAPABILITIES_SCHEMA_VERSION);
  assert.equal(cap.schema_version, 2);
  assert.ok(cap.capabilities_flags);
  assert.ok(cap.hooks);
  assert.deepEqual(cap.prerequisites, PREREQUISITES);
  assert.deepEqual(cap.known_hosts, HOST_NAMES);
});

test('detectHost: opencode via ATLAS_HOST injetado pelo packaging', () => {
  const r = detectHost({}, { ATLAS_HOST: 'opencode' });
  assert.equal(r.host, 'opencode');
  assert.equal(r.detected_via, 'env:ATLAS_HOST');
});

test('capabilities: perfil opencode (subagente @, mcp local, todo nativo todowrite)', () => {
  const cap = capabilities({ host: 'opencode' });
  assert.equal(cap.host, 'opencode');
  assert.equal(cap.capabilities_flags.subagent_available, true);
  assert.equal(cap.capabilities_flags.mcp_available, true);
  assert.equal(cap.capabilities_flags.todo_available, true);
  assert.equal(cap.todo_tool, 'todowrite');
  assert.match(cap.subagent_dispatch.registration, /\.opencode\/agents/);
});

test('checkPrerequisites: opencode qualificado passa', () => {
  assert.equal(checkPrerequisites({ host: 'opencode' }).status, 'passed');
});

test('HOST_NAMES inclui opencode', () => {
  assert.ok(HOST_NAMES.includes('opencode'));
});

test('detectHost: pi via ATLAS_HOST injetado pela config do pi-mcp-adapter', () => {
  const r = detectHost({}, { ATLAS_HOST: 'pi' });
  assert.equal(r.host, 'pi');
});

test('capabilities: perfil pi expõe required_deps obrigatórias (DEC-005)', () => {
  const cap = capabilities({ host: 'pi' });
  assert.equal(cap.host, 'pi');
  assert.deepEqual(cap.required_deps, ['pi-mcp-adapter', 'pi-subagents']);
  assert.equal(cap.capabilities_flags.todo_available, false);
});

test('capabilities: hosts sem deps externas têm required_deps vazio', () => {
  for (const h of ['claude', 'codex', 'opencode', 'generic']) {
    assert.deepEqual(capabilities({ host: h }).required_deps, []);
  }
});

test('checkPrerequisites: pi sem pi-subagents é hard-fail com next_action pi', () => {
  const r = checkPrerequisites({ host: 'pi', host_capabilities: { subagent_available: false } });
  assert.equal(r.status, 'blocked');
  assert.match(r.next_action, /pi-mcp-adapter/);
});

test('HOST_NAMES inclui pi', () => {
  assert.ok(HOST_NAMES.includes('pi'));
});

test('capabilities: flags por host', () => {
  for (const h of ['claude', 'codex']) {
    const f = capabilities({ host: h }).capabilities_flags;
    assert.equal(f.subagent_available, true);
    assert.equal(f.mcp_available, true);
    assert.equal(f.todo_available, true);
  }
  const g = capabilities({ host: 'generic' }).capabilities_flags;
  assert.equal(g.subagent_available, true);
  assert.equal(g.mcp_available, true);
  assert.equal(g.todo_available, false);
});

test('checkPrerequisites: host qualificado passa', () => {
  const r = checkPrerequisites({ host: 'claude' });
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.missing, []);
});

test('checkPrerequisites: subagente ausente é hard-fail', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: false, mcp_available: true } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available']);
});

test('checkPrerequisites: MCP ausente é hard-fail', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { mcp_available: false } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['mcp_available']);
});

test('checkPrerequisites: todo ausente NÃO bloqueia (não-essencial)', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { todo_available: false } });
  assert.equal(r.status, 'passed');
});

test('checkPrerequisites: override não-booleano é ignorado', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { subagent_available: 'nope' } });
  assert.equal(r.status, 'passed');
});

test('generic: EXIGE subagente+MCP — host MCP-only (sem subagente) é hard-fail (DEC-004)', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: false, mcp_available: true } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available']);
});

test('generic: host sem MCP é hard-fail', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: true, mcp_available: false } });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['mcp_available']);
});

test('generic: host com subagente+MCP reportados passa (todo ausente não bloqueia)', () => {
  const r = checkPrerequisites({ host: 'generic', host_capabilities: { subagent_available: true, mcp_available: true } });
  assert.equal(r.status, 'passed');
});

// Fail-closed (must_report): generic/pi sem report afirmativo são bloqueados — a
// garantia de determinismo vira contrato, não otimismo do perfil.
test('generic: sem host_capabilities é hard-fail (fail-closed)', () => {
  const r = checkPrerequisites({ host: 'generic' });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available', 'mcp_available']);
  assert.equal(r.cause, 'host_nao_reportou_disponibilidade');
});

test('pi: sem host_capabilities é hard-fail (fail-closed)', () => {
  const r = checkPrerequisites({ host: 'pi' });
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.missing, ['subagent_available', 'mcp_available']);
  assert.equal(r.cause, 'host_nao_reportou_disponibilidade');
  assert.match(r.next_action, /pi-mcp-adapter/);
});

test('pi: qualificado com report afirmativo passa', () => {
  const r = checkPrerequisites({ host: 'pi', host_capabilities: { subagent_available: true, mcp_available: true } });
  assert.equal(r.status, 'passed');
  assert.deepEqual(r.missing, []);
});

test('override: chave desconhecida não vaza para effective_flags', () => {
  const r = checkPrerequisites({ host: 'claude', host_capabilities: { foo: true } });
  assert.equal(r.status, 'passed');
  assert.equal(r.effective_flags.foo, undefined);
});

test('capabilities: prereq_policy must_report em pi/generic, self_evident nos nativos', () => {
  assert.equal(capabilities({ host: 'pi' }).prereq_policy, 'must_report');
  assert.equal(capabilities({ host: 'generic' }).prereq_policy, 'must_report');
  for (const h of ['claude', 'codex', 'opencode']) {
    assert.equal(capabilities({ host: h }).prereq_policy, 'self_evident');
  }
});

test('PREREQUISITES: subagente e mcp são essenciais; todo não', () => {
  assert.ok(PREREQUISITES.essential.includes('subagent_available'));
  assert.ok(PREREQUISITES.essential.includes('mcp_available'));
  assert.ok(PREREQUISITES.non_essential.includes('todo_available'));
  assert.ok(!PREREQUISITES.essential.includes('todo_available'));
});
