import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  approveAcceptanceContract,
  closedDecisionIds,
  computeAcceptanceSeal,
  detectStackProfiles,
  parseAcceptanceContract,
  pendingInterviewQuestions,
  persistInterviewRound,
  resolveSprintAuthority,
  validateAcceptanceSeal,
  validateBacklogUpdate,
  validateSprintFileConformance,
} from '../../packages/skills/_shared/scripts/document_quality.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLASSIFIER = path.join(ROOT, 'packages/skills/talos-slice-review/scripts/classify_findings.mjs');

const finding = {
  severity: 'P1', task_id: 'T01', title: 'Falha', file: 'src/a.js', line: 3,
  failure_mode: 'Falha alcançável.', evidence: 'Guard ausente.',
  recommendation: 'Restabelecer guard.', fix_validation: 'Teste negativo.',
};

test('review: gate canônico executa diretamente com Node, sem Python no PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-review-'));
  const input = path.join(dir, 'findings.json');
  fs.writeFileSync(input, JSON.stringify([finding]));
  const output = execFileSync(process.execPath, [CLASSIFIER, input], { env: { ...process.env, PATH: dir }, encoding: 'utf8' });
  assert.equal(JSON.parse(output)[0].title, 'Falha');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('perfis: Flutter, Node e Python ativam só regras aplicáveis', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-stack-'));
  const fixture = (name, files, commands = []) => {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
    return detectStackProfiles(dir, commands);
  };
  assert.deepEqual(pickProfile(fixture('node', { 'package.json': '{"scripts":{"test":"node --test"}}' }).boundaries[0]), {
    boundary: '.', flutter_dart: false, node_typescript: true, python: false, go: false, rust: false, java_kotlin: false,
    firebase: false, supabase: false, rest_openapi: false, getx: false,
  });
  assert.deepEqual(pickProfile(fixture('flutter', { 'pubspec.yaml': 'name: fixture\ndependencies:\n  flutter:\n    sdk: flutter\n' }).boundaries[0]), {
    boundary: '.', flutter_dart: true, node_typescript: false, python: false, go: false, rust: false, java_kotlin: false,
    firebase: false, supabase: false, rest_openapi: false, getx: false,
  });
  assert.deepEqual(pickProfile(fixture('python', { 'pyproject.toml': '[project]\nname="fixture"\n' }).boundaries[0]), {
    boundary: '.', flutter_dart: false, node_typescript: false, python: true, go: false, rust: false, java_kotlin: false,
    firebase: false, supabase: false, rest_openapi: false, getx: false,
  });
  fs.rmSync(root, { recursive: true, force: true });
});

function pickProfile(profile) {
  const {
    boundary, flutter_dart, node_typescript, python, go, rust, java_kotlin,
    firebase, supabase, rest_openapi, getx,
  } = profile;
  return {
    boundary, flutter_dart, node_typescript, python, go, rust, java_kotlin,
    firebase, supabase, rest_openapi, getx,
  };
}

test('perfis: Go, Rust, Java/Kotlin, Firebase, Supabase e REST/OpenAPI são detectáveis', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-stack-extra-'));
  const fixture = (name, files) => {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
    return detectStackProfiles(dir).boundaries[0];
  };
  assert.equal(fixture('go', { 'go.mod': 'module example.com/app\n' }).go, true);
  assert.equal(fixture('rust', { 'Cargo.toml': '[package]\nname="app"\n' }).rust, true);
  assert.equal(fixture('java', { 'pom.xml': '<project><dependencies></dependencies></project>\n' }).java_kotlin, true);
  assert.equal(fixture('firebase', { 'firebase.json': '{"firestore":{}}\n' }).firebase, true);
  assert.equal(fixture('supabase', { 'package.json': '{"dependencies":{"@supabase/supabase-js":"latest"}}\n' }).supabase, true);
  assert.equal(fixture('openapi', { 'openapi.yaml': 'openapi: 3.0.0\ninfo:\n  title: API\n  version: 1\n' }).rest_openapi, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('perfis: monorepo restringe stack por boundary e GetX exige evidência', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-monorepo-'));
  fs.mkdirSync(path.join(root, 'packages/node'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/flutter'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/getx'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages/node/package.json'), '{}');
  fs.writeFileSync(path.join(root, 'apps/flutter/pubspec.yaml'), 'name: plain\ndependencies:\n  flutter:\n    sdk: flutter\n');
  fs.writeFileSync(path.join(root, 'apps/getx/pubspec.yaml'), 'name: getx\ndependencies:\n  flutter:\n    sdk: flutter\n  get: ^4.7.0\n');
  const profiles = detectStackProfiles(root, [], ['packages/node', 'apps/flutter', 'apps/getx']);
  assert.deepEqual(profiles.boundaries.map(({ boundary, node_typescript, flutter_dart, getx }) => (
    { boundary, node_typescript, flutter_dart, getx }
  )), [
    { boundary: 'packages/node', node_typescript: true, flutter_dart: false, getx: false },
    { boundary: 'apps/flutter', node_typescript: false, flutter_dart: true, getx: false },
    { boundary: 'apps/getx', node_typescript: false, flutter_dart: true, getx: true },
  ]);
  assert.throws(() => detectStackProfiles(root, [], ['../outside']), /BOUNDARY_OUTSIDE_PROJECT/);
  fs.rmSync(root, { recursive: true, force: true });
});

function backlog(rows, decisions = '| D1 | Contrato fechado | S02 | Produto | usuario | decidido |', changelog = '- 2026-06-22 — baseline.') {
  return `# Backlog\n\n### Decisões bloqueantes\n\n| ID | Decisão | Bloqueia | Dono | Origem | Status |\n|---|---|---|---|---|---|\n${decisions}\n\n## 7. Registro de sprints\n\n| ID | Sprint | Fase-fonte | Objetivo (1 linha) | MoSCoW | Ganho | Esforço | Prioridade | PRD | Depende de | Estado | Gate |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n${changelog ? `\n## Registro de alterações\n\n${changelog}` : ''}\n`;
}

const done = '| S01 | Base | F0 | Fechar base | Must | Alto | Baixo | P0 | `PRD_S01_base.md` | — | done | ✅ |';
const todo = '| S02 | Próxima | F1 | Entregar próxima | Must | Alto | Médio | P0 | `PRD_S02_proxima.md` | S01 | backlog | — |';

test('backlog update: preserva sprint done, decisão fechada e itens não relacionados', () => {
  const before = backlog([done, todo]);
  const after = backlog(
    [done, todo, '| S03 | Extra | F2 | Entregar extra | Should | Médio | Baixo | P1 | `PRD_S03_extra.md` | S01 | backlog | — |'],
    undefined,
    '- 2026-06-22 — baseline.\n- 2026-06-22 — S03 adicionada.',
  );
  assert.deepEqual(validateBacklogUpdate(before, after), { valid: true, errors: [] });
  const destructive = backlog([done.replace('Base', 'Base reescrita'), todo]);
  assert.ok(validateBacklogUpdate(before, destructive).errors.includes('DONE_SPRINT_CHANGED:S01'));
});

test('backlog update: bloqueia dependência cíclica', () => {
  const before = backlog([done, todo]);
  const cyclic = backlog([
    '| S01 | Base | F0 | Fechar base | Must | Alto | Baixo | P0 | `PRD_S01_base.md` | S02 | backlog | — |',
    '| S02 | Próxima | F1 | Entregar próxima | Must | Alto | Médio | P0 | `PRD_S02_proxima.md` | S01 | backlog | — |',
  ]);
  assert.ok(validateBacklogUpdate(before, cyclic).errors.some((error) => error.startsWith('DEPENDENCY_CYCLE:')));
});

test('backlog update: bloqueia dependência inexistente, mudança não autorizada e histórico reescrito', () => {
  const before = backlog([done, todo]);
  const missing = backlog(
    [done, todo.replace('S01 | backlog', 'S99 | backlog')], undefined,
    '- 2026-06-22 — baseline.\n- 2026-06-22 — dependência alterada.',
  );
  assert.ok(validateBacklogUpdate(before, missing, { authorizedIds: ['S02'] }).errors.includes('DEPENDENCY_NOT_FOUND:S02:S99'));
  const unauthorized = backlog(
    [done, todo.replace('Próxima', 'Reescrita')], undefined,
    '- 2026-06-22 — baseline.\n- 2026-06-22 — S02 alterada.',
  );
  assert.ok(validateBacklogUpdate(before, unauthorized).errors.includes('UNAUTHORIZED_SPRINT_CHANGED:S02'));
  const rewritten = backlog(
    [done, todo, '| S03 | Extra | F2 | Entregar extra | Should | Médio | Baixo | P1 | p | S01 | backlog | — |'],
    undefined,
    '- 2026-06-22 — histórico substituído.',
  );
  assert.ok(validateBacklogUpdate(before, rewritten).errors.includes('CHANGELOG_REWRITTEN'));
});

test('Sprint PRD: múltiplos backlogs conflitantes bloqueiam autoridade', () => {
  assert.throws(() => resolveSprintAuthority({
    sprintId: 'S03', candidates: [
      { path: '/repo/a/BACKLOG_MESTRE.md', sprints: ['S03'] },
      { path: '/repo/b/BACKLOG_MESTRE.md', sprints: ['S03'] },
    ],
  }), /AMBIGUOUS_BACKLOG_AUTHORITY/);
  assert.equal(resolveSprintAuthority({
    sprintId: 'S03', explicitPath: '/repo/b/BACKLOG_MESTRE.md', candidates: [
      { path: '/repo/a/BACKLOG_MESTRE.md', sprints: ['S03'] },
      { path: '/repo/b/BACKLOG_MESTRE.md', sprints: ['S03'] },
    ],
  }).path, path.resolve('/repo/b/BACKLOG_MESTRE.md'));
});

test('interview: persiste resposta e não repete decisão fechada', () => {
  const sprint = [
    '## 1. Metadados',
    '| Campo | Valor |',
    '|---|---|',
    '| Contrato status | draft |',
    '| Selo do contrato | pendente até aprovação |',
    '',
    '## 7. Contrato de produto (congelado)',
    '### 7.1 Decisões de produto (D*)',
    '| ID | Decisão | Origem |',
    '|---|---|---|',
    '| D1 | Escolha anterior | usuario |',
    '',
  ].join('\n');
  const questions = [{ decision_id: 'D1' }, { decision_id: 'D2' }];
  assert.deepEqual(pendingInterviewQuestions(sprint, questions), [{ decision_id: 'D2' }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-interview-'));
  const sprintPath = path.join(dir, 'SPRINT.md');
  fs.writeFileSync(sprintPath, sprint);
  const updated = persistInterviewRound(sprintPath, [{ decision_id: 'D2', value: 'Nova escolha' }], '2026-06-22');
  assert.equal(fs.readFileSync(sprintPath, 'utf8'), updated);
  assert.deepEqual([...closedDecisionIds(updated)].sort(), ['D1', 'D2']);
  assert.deepEqual(pendingInterviewQuestions(updated, questions), []);
  assert.match(updated, /entrevista: D2 persistida/);
  const moduleUrl = new URL('../../packages/skills/_shared/scripts/document_quality.mjs', import.meta.url).href;
  const freshProcess = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { pendingInterviewQuestions } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify(pendingInterviewQuestions(fs.readFileSync(process.argv[1], 'utf8'), [{ decision_id: 'D2' }])));
  `, sprintPath], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(freshProcess), []);
  const invalidPath = path.join(dir, 'INVALID.md');
  fs.writeFileSync(invalidPath, '# Sprint sem tabela de decisões\n');
  assert.throws(
    () => persistInterviewRound(invalidPath, [{ decision_id: 'D3', value: 'x' }]),
    /INTERVIEW_PERSISTENCE_FAILED:DECISION_TABLE_MISSING:D3/,
  );
  assert.equal(fs.readFileSync(invalidPath, 'utf8'), '# Sprint sem tabela de decisões\n');
  assert.throws(
    () => persistInterviewRound(path.join(dir, 'missing', 'SPRINT.md'), [{ decision_id: 'D3', value: 'x' }]),
    /INTERVIEW_PERSISTENCE_FAILED/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Plano 01 — procedência por linha (v0.16.0) ────────────────────────────────

/**
 * Sprint file completo no schema 0.16.0 (todas as 16 seções, manifests e
 * evidence-to-claim) — passa em `validateSprintFileConformance` exceto pelas
 * pendências de procedência que cada teste quiser provocar via opções.
 */
function sprintFixture({
  moscow = 'Must',
  prioridade = 'P0',
  backlog = 'Não aplicável (standalone)',
  contratoStatus = 'draft',
  decisionOrigin = 'usuario',
  acceptanceOrigin = 'usuario',
  decisionRows = null,
  acceptanceItems = null,
  /** v0.16.0 (CN6): célula `Fonte` da linha `Discussão` da §4; `null` omite a linha */
  discussao = '.app-work/brainstorming/fixture/BRAINSTORM.md',
  /** Plano 01 (RASTREABILIDADE_MCP_GUIDE): metadado `Traceability` da §1; `null` omite a linha */
  traceabilityMark = null,
} = {}) {
  const decisionTable = decisionRows ?? [
    '| ID | Decisão | Origem |',
    '|---|---|---|',
    `| D1 | Escolha fechada | ${decisionOrigin} |`,
  ];
  const acceptance = acceptanceItems ?? [
    '  - id: AC-001',
    `    origin: "${acceptanceOrigin}"`,
    '    behavior: "Comportamento observável"',
    '    decisions: [D1]',
    '    scenario: "Cenário 1"',
    '    evals: [EVAL-001]',
    '    evidence:',
    '      required: [I, T-outcome]',
    '      manual: null',
  ];
  return [
    '# Sprint viva — S01 — Fixture',
    '',
    '## 1. Metadados',
    '| Campo | Valor |',
    '|---|---|',
    '| Sprint ID | S01 |',
    '| Nome | Fixture |',
    '| Status | ready |',
    `| Backlog mestre | ${backlog} |`,
    `| Contrato status | ${contratoStatus} |`,
    '| Selo do contrato | pendente até aprovação |',
    '| PRD | pendente |',
    '| PLAN | pendente |',
    '| State / evidência | pendente |',
    '| Fase | F0 |',
    `| MoSCoW | ${moscow} |`,
    `| Prioridade | ${prioridade} |`,
    ...(traceabilityMark === null ? [] : [`| Traceability | ${traceabilityMark} |`]),
    '',
    '## 2. Objetivo e valor',
    'Objetivo único.',
    '## 3. Escopo da sprint',
    '- [ ] Entrega',
    '## 4. Contexto e fontes',
    '| Tipo | Fonte | Uso nesta sprint |',
    '|---|---|---|',
    '| Backlog | fonte | escopo |',
    ...(discussao === null ? [] : [`| Discussão | ${discussao} | decisão/contexto |`]),
    '## 5. Dependências e bloqueios',
    '| ID | Tipo | Descrição | Status | Evidência |',
    '|---|---|---|---|---|',
    '| DEP-001 | interna | nada | done | link |',
    '## 6. Decisões da sprint',
    '| ID | Decisão | Fonte | Impacto | Status |',
    '|---|---|---|---|---|',
    '| SD-001 | seguir | backlog | baixo | aprovada |',
    '## 7. Contrato de produto (congelado)',
    '### 7.1 Decisões de produto (D*)',
    ...decisionTable,
    '### 7.2 Cenários UX',
    '### 7.2.1 Cenário 1',
    '- **Entrada:** entrada',
    '- **Comportamento:** comportamento',
    '- **Sucesso:** sucesso',
    '### 7.3 Aceite binário',
    '```yaml',
    'acceptance:',
    ...acceptance,
    '```',
    '## 8. Definition of Ready',
    '- [ ] Próxima ação explícita.',
    '## 9. Eval manifest',
    '```yaml',
    'eval_manifest:',
    '  sprint_id: "S01"',
    '  objective: "fixture"',
    '  must_prove:',
    '    - id: "EVAL-001"',
    '      claim: "gate passa"',
    '      source: "SPRINT"',
    '      evidence_required: "node --test"',
    '  regression_guards:',
    '    - "parser antigo preservado"',
    '  negative_paths:',
    '    - "manifest ausente falha"',
    '```',
    '## 10. Policy manifest',
    '```yaml',
    'policy_manifest:',
    '  forbidden_scope:',
    '    - "hosts"',
    '  required_gates:',
    '    - "talos_verify_sprint_file"',
    '```',
    '## 11. Guia e sensores',
    '- [ ] Guia',
    '## 12. Evidence-to-claim',
    '| Claim | Onde foi prometido | Evidência esperada | Evidência real | Status |',
    '|---|---|---|---|---|',
    '| gate passa | sprint | node --test | pendente | pending |',
    '## 13. PLAN',
    '| Campo | Valor |',
    '|---|---|',
    '| Status | pendente |',
    '## 14. Execução e validação',
    '| Gate | Status | Evidência |',
    '|---|---|---|',
    '| Sprint file válido | pending | pendente |',
    '## 15. Aprendizados e handoff para próximas sprints',
    '| Tipo | Aprendizado | Afeta | Ação |',
    '|---|---|---|---|',
    '| técnico | nada | S02 | registrar |',
    '## 16. Histórico',
    '| Data | Autor | Mudança |',
    '|---|---|---|',
    '| 2026-06-29 | Talos | Criação |',
  ].join('\n');
}

test('procedência: AC com origin derivado é parseado com evidence intacto (AC-01.2.1)', () => {
  const markdown = sprintFixture({
    acceptanceItems: [
      '  - id: AC-001',
      '    origin: "derivado:packages/mcp-server/server.js"',
      '    behavior: "Gate observável"',
      '    decisions: [D1]',
      '    scenario: "Carregar harness"',
      '    evidence:',
      '      required: [I, T-outcome, W]',
      '      manual: null',
    ],
  });
  const items = parseAcceptanceContract(markdown);
  assert.equal(items[0].origin, 'derivado:packages/mcp-server/server.js');
  assert.deepEqual(items[0].evidence.required, ['I', 'T-outcome', 'W']);
  assert.equal(items[0].evidence.manual, null);
  // Conformance com o root real do repo: o path citado existe → sem pendência de origem.
  const r = validateSprintFileConformance(markdown, { root: ROOT });
  assert.ok(!r.pendencies.some((p) => p.category === 'procedencia_ausente' || p.category === 'origem_path_inexistente'),
    JSON.stringify(r.pendencies));
});

test('procedência: premissa bloqueia AC em sprint standalone Must/P0 (AC-01.2.2)', () => {
  const markdown = sprintFixture({
    moscow: 'Must',
    prioridade: 'P0',
    backlog: 'Não aplicável (standalone)',
    acceptanceOrigin: 'premissa',
  });
  const r = validateSprintFileConformance(markdown);
  assert.equal(r.valid, false);
  const pendency = r.pendencies.find((p) => p.category === 'procedencia_premissa_em_prioridade');
  assert.ok(pendency, JSON.stringify(r.pendencies));
  assert.equal(pendency.item, 'AC-001');
  assert.equal(pendency.next_action, 'fechar_premissa_em_entrevista');
  // Contraprova: sprint não-prioritária com a mesma premissa não bloqueia.
  const ok = validateSprintFileConformance(sprintFixture({
    moscow: 'Should',
    prioridade: 'P1',
    backlog: 'Não aplicável (standalone)',
    acceptanceOrigin: 'premissa',
  }));
  assert.equal(ok.valid, true, JSON.stringify(ok.pendencies));
  assert.ok(!ok.pendencies.some((p) => p.category === 'procedencia_premissa_em_prioridade'));
});

test('procedência: derivado:<path> inexistente bloqueia; (novo) e arquivo real passam (AC-01.2.3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-origem-'));
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages/existe.js'), 'export const real = true;\n');
  const missing = validateSprintFileConformance(sprintFixture({
    moscow: 'Should',
    prioridade: 'P1',
    decisionOrigin: 'derivado:packages/nao/existe.js',
  }), { root });
  const pendency = missing.pendencies.find((p) => p.category === 'origem_path_inexistente');
  assert.ok(pendency, JSON.stringify(missing.pendencies));
  assert.equal(pendency.item, 'D1');
  assert.equal(pendency.next_action, 'corrigir_origem_path');
  // Sufixo ` (novo)`: arquivo ainda será criado → aceito mesmo inexistente.
  const novo = validateSprintFileConformance(sprintFixture({
    moscow: 'Should',
    prioridade: 'P1',
    decisionOrigin: 'derivado:packages/novo_modulo.js (novo)',
  }), { root });
  assert.ok(!novo.pendencies.some((p) => p.category === 'origem_path_inexistente'),
    JSON.stringify(novo.pendencies));
  // Arquivo real no root: aceito.
  const real = validateSprintFileConformance(sprintFixture({
    moscow: 'Should',
    prioridade: 'P1',
    decisionOrigin: 'derivado:packages/existe.js',
  }), { root });
  assert.ok(!real.pendencies.some((p) => p.category === 'origem_path_inexistente'),
    JSON.stringify(real.pendencies));
  fs.rmSync(root, { recursive: true, force: true });
});

test('procedência: §7.1 sem coluna Origem é schema pré-0.16.0 e bloqueia (AC-01.2.4)', () => {
  const legacy = sprintFixture({
    decisionRows: [
      '| ID | Decisão |',
      '|---|---|',
      '| D1 | Decisão antiga |',
    ],
  });
  const r = validateSprintFileConformance(legacy);
  assert.equal(r.valid, false);
  const pendency = r.pendencies.find((p) => p.category === 'procedencia_ausente' && p.item === '§7.1');
  assert.ok(pendency, JSON.stringify(r.pendencies));
  assert.equal(pendency.next_action, 'migrar_para_0_16');
});

test('procedência: decisão de backlog fora do enum reprova o update (AC-01.2.5)', () => {
  const before = backlog([done, todo]);
  const withInvalid = backlog([done, todo], '| D1 | Contrato fechado | S02 | Produto | inventado | decidido |');
  const r = validateBacklogUpdate(before, withInvalid);
  assert.ok(r.errors.includes('INVALID_ORIGIN:D1:inventado'), JSON.stringify(r.errors));
  // Contraprova: decisão com origem válida no enum passa.
  const same = backlog([done, todo]);
  assert.deepEqual(validateBacklogUpdate(same, same), { valid: true, errors: [] });
});

test('entrevista: persistir rodada preserva Origem em §7.1 de 3 colunas (AC-01.3.1 / INV1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-persist-origem-'));
  const sprintPath = path.join(dir, 'SPRINT.md');
  fs.writeFileSync(sprintPath, sprintFixture({ decisionOrigin: 'usuario' }));
  const updated = persistInterviewRound(sprintPath, [{ decision_id: 'D1', value: 'Escolha reescrita' }], '2026-06-22');
  const line = updated.split('\n').find((l) => /^\|\s*D1\s*\|/.test(l));
  assert.match(line, /^\|\s*D1\s*\|\s*Escolha reescrita\s*\|\s*usuario\s*\|$/);
  assert.equal(fs.readFileSync(sprintPath, 'utf8'), updated);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('entrevista: decisão nova é inserida com as três colunas (AC-01.3.2 / LEG2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talos-persist-insert-'));
  const sprintPath = path.join(dir, 'SPRINT.md');
  fs.writeFileSync(sprintPath, sprintFixture({ decisionOrigin: 'usuario' }));
  const updated = persistInterviewRound(sprintPath, [{ decision_id: 'D2', value: 'Nova decisão' }], '2026-06-22');
  const line = updated.split('\n').find((l) => /^\|\s*D2\s*\|/.test(l));
  assert.match(line, /^\|\s*D2\s*\|\s*Nova decisão\s*\|\s*usuario\s*\|$/);
  const d1 = updated.split('\n').find((l) => /^\|\s*D1\s*\|/.test(l));
  assert.match(d1, /^\|\s*D1\s*\|\s*Escolha fechada\s*\|\s*usuario\s*\|$/);
  assert.equal(fs.readFileSync(sprintPath, 'utf8'), updated);
  // Corte seco (D17): tabela com cabeçalho de 2 colunas é schema pré-0.16.0 e
  // continua caindo em DECISION_TABLE_MISSING na inserção.
  const legacyPath = path.join(dir, 'LEGACY.md');
  fs.writeFileSync(legacyPath, sprintFixture({
    decisionRows: [
      '| ID | Decisão |',
      '|---|---|',
      '| D1 | Decisão antiga |',
    ],
  }));
  assert.throws(
    () => persistInterviewRound(legacyPath, [{ decision_id: 'D3', value: 'x' }]),
    /INTERVIEW_PERSISTENCE_FAILED:DECISION_TABLE_MISSING:D3/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('selo: contrato com origin aprova; editar a §7 quebra o selo (AC-01.4.1 / INV2)', () => {
  const approved = approveAcceptanceContract(sprintFixture({ contratoStatus: 'draft' }));
  assert.equal(validateAcceptanceSeal(approved).tampered, false);
  assert.equal(validateAcceptanceSeal(approved).sealed, true);
  const tampered = approved.replace(
    '| D1 | Escolha fechada | usuario |',
    '| D1 | Escolha alterada | usuario |',
  );
  const seal = validateAcceptanceSeal(tampered);
  assert.equal(seal.sealed, true);
  assert.equal(seal.tampered, true);
});

// ── Plano 02 — fonte de discussão obrigatória (CN6/D2) ───────────────────────

test('discussão: placeholder na linha Discussão da §4 bloqueia; path real passa (AC-02.1.1)', () => {
  for (const placeholder of ['[link/resumo]', '[...]', '—', 'N/A', '']) {
    const r = validateSprintFileConformance(sprintFixture({ discussao: placeholder }));
    const pendency = r.pendencies.find((p) => p.category === 'fonte_discussao_ausente');
    assert.ok(pendency, JSON.stringify(r.pendencies));
    assert.equal(pendency.item, 'Discussão');
    assert.equal(pendency.next_action, 'preencher_fonte_discussao');
    assert.equal(typeof pendency.line, 'number');
    // Pendência única por sprint file.
    assert.equal(r.pendencies.filter((p) => p.category === 'fonte_discussao_ausente').length, 1);
  }
  // Mesmo arquivo com um path real na célula passa.
  const ok = validateSprintFileConformance(sprintFixture({
    discussao: '.app-work/brainstorming/revisao-fria-backlog/BRAINSTORM.md',
  }));
  assert.equal(ok.valid, true, JSON.stringify(ok.pendencies));
  assert.ok(!ok.pendencies.some((p) => p.category === 'fonte_discussao_ausente'));
});

test('discussão: sprint standalone sem linha Discussão é recusada (AC-02.1.2)', () => {
  const standalone = sprintFixture({ backlog: 'Não aplicável (standalone)', discussao: null });
  const r = validateSprintFileConformance(standalone);
  assert.equal(r.valid, false);
  const pendency = r.pendencies.find((p) => p.category === 'fonte_discussao_ausente');
  assert.ok(pendency, JSON.stringify(r.pendencies));
  assert.equal(pendency.item, 'Discussão');
  assert.equal(pendency.next_action, 'preencher_fonte_discussao');
  assert.equal(pendency.line, null); // linha ausente → sem número de linha
});

// ── Plano 03 — entrevista estruturada no talos-backlog-generator (CN1/LEG1) ──

const BACKLOG_SKILL = () => fs.readFileSync(
  path.join(ROOT, 'packages/skills/talos-backlog-generator/SKILL.md'),
  'utf8',
);

test('skill backlog: texto livre morto nos dois sítios; scan do rascunho antecede a gravação (AC-03.1.1 / LEG1)', () => {
  const skill = BACKLOG_SKILL();
  // LEG1, sítio 1 (passo 4 do workflow): entrevista em texto livre morreu.
  assert.ok(!/até 3 perguntas objetivas/.test(skill),
    'passo 4 ainda instrui entrevista em texto livre ("até 3 perguntas objetivas")');
  // LEG1, sítio 2 (Entradas aceitas): a regra antiga que restringe a pergunta às
  // três decisões bloqueantes sobreviveu — executor com duas instruções contraditórias.
  assert.ok(!/Pergunte antes de salvar somente quando faltar/.test(skill),
    '"Entradas aceitas" ainda restringe a pergunta a faltar informação, não a ambiguidade detectada');
  // O passo 4 instrui a escanear o rascunho em memória (sprint_markdown) antes de gravar.
  const workflow = skill.slice(skill.indexOf('## Workflow obrigatório'));
  const step4 = workflow.slice(0, workflow.indexOf('5. **'));
  assert.match(step4, /talos_scan_acceptance/, 'passo 4 não nomeia o gate de scan');
  assert.match(step4, /sprint_markdown/, 'passo 4 não instrui o scan sobre o rascunho em memória');
});

test('skill backlog: rodada usa o descritor question_prompt do host, sem número fixo nem tool name (AC-03.1.2)', () => {
  const skill = BACKLOG_SKILL();
  const workflow = skill.slice(skill.indexOf('## Workflow obrigatório'));
  const step4 = workflow.slice(0, workflow.indexOf('5. **'));
  // O mecanismo vem do descritor do host, não de constante da skill.
  assert.match(step4, /talos_capabilities/, 'passo 4 não chama talos_capabilities');
  assert.match(step4, /question_prompt/, 'passo 4 não lê question_prompt do descritor');
  assert.match(step4, /max_questions/, 'passo 4 não instrui a ler max_questions do descritor');
  assert.match(step4, /options_per_question/, 'passo 4 não instrui a ler options_per_question do descritor');
  // Proibido citar número fixo ou nome de ferramenta de host (multi-host por adapter).
  assert.ok(!/faça 4 perguntas|faça até 3 perguntas|no máximo 4 perguntas/.test(step4),
    'número fixo de perguntas hardcodado na skill');
  assert.ok(!/AskUserQuestion|request_user_input|interactive_prompt|native_structured_question/.test(skill),
    'nome de ferramenta de host hardcodado na skill');
});

// ── Plano 04 — revisão fria como último passo da skill (CN4/VC2/VC3/INV3/INV4) ──

const COLD_REVIEW_PROMPT = () => fs.readFileSync(
  path.join(ROOT, 'packages/skills/talos-backlog-generator/references/COLD_BACKLOG_REVIEW_PROMPT.md'),
  'utf8',
);

/**
 * Passo final (14) do workflow da skill de backlog, onde a revisão fria despacha.
 * Delimitado entre o marcador `14. **` e o fim da seção Workflow obrigatório.
 */
function finalStep(skill) {
  const workflow = skill.slice(skill.indexOf('## Workflow obrigatório'));
  return workflow.slice(workflow.indexOf('14. **'), workflow.indexOf('\n---\n'));
}

test('mandato revisão: arquivo canônico com as cláusulas obrigatórias (AC-04.1.1 a 04.1.4 / VC2)', () => {
  const mandato = COLD_REVIEW_PROMPT();
  // AC-04.1.1 — boundary de escrita: artefatos editáveis, código read-only.
  assert.match(mandato, /pode editar/, 'mandato não declara o boundary de escrita dos artefatos');
  assert.match(mandato, /read-only/, 'mandato não declara código read-only');
  // AC-04.1.1 — ordem obrigatória de leitura: discussão → código → artefatos.
  assert.match(mandato, /fontes de discussão/, 'mandato não nomeia as fontes de discussão');
  assert.match(mandato, /código real/, 'mandato não manda ler o código real');
  assert.match(mandato, /só então julgar/i, 'mandato não impõe a ordem discussão → código → artefatos');
  // AC-04.1.1 — enum de veredito com os quatro valores.
  for (const verdict of ['pass', 'pass_with_observations', 'fail', 'interview_required']) {
    assert.ok(mandato.includes(verdict), `veredito ${verdict} ausente do enum`);
  }
  // AC-04.1.2 — §7 com Contrato status aprovado é read-only e vira ENTREVISTA NECESSÁRIA.
  assert.match(mandato, /Contrato status: aprovado/, 'mandato não trata §7 aprovada');
  assert.match(mandato, /ENTREVISTA NECESSÁRIA/, 'mandato não classifica ENTREVISTA NECESSÁRIA');
  // AC-04.1.3 — aplicar reparáveis nos artefatos; proibir devolução ao chamador.
  assert.match(mandato, /REPARÁVEL/, 'mandato não classifica REPARÁVEL');
  assert.match(mandato, /reparável para quem chamou corrigir/, 'mandato não proíbe devolver finding reparável');
  // AC-04.1.4 — cláusula delimitando o escopo do julgamento.
  assert.match(mandato, /DISPATCH\/DEC-008/, 'mandato não nomeia o gate de execução que não se aplica');
  assert.match(mandato, /dispatch_capability/, 'mandato não nomeia dispatch_capability fora de escopo');
  assert.match(mandato, /inválido por construção/, 'mandato não declara over-reach como finding inválido');
});

test('skill backlog: passo final monta boundary com todos os paths escritos (AC-04.2.1)', () => {
  const step = finalStep(BACKLOG_SKILL());
  assert.match(step, /sprint file criado ou alterado/, 'boundary não enumera todos os sprint files');
  assert.match(step, /não apenas a sprint selecionada/, 'boundary não exclui explicitamente o recorte por sprint selecionada');
  assert.match(step, /backlog mestre/, 'boundary não inclui o backlog mestre');
});

test('skill backlog: passo final lê o mandato do arquivo e proíbe reescrita de memória (AC-04.2.2)', () => {
  const step = finalStep(BACKLOG_SKILL());
  assert.match(step, /COLD_BACKLOG_REVIEW_PROMPT\.md/, 'passo final não instrui a ler o arquivo do mandato');
  assert.match(step, /substitua apenas/, 'passo final não limita a substituição a parâmetros');
  assert.match(step, /reescreva o mandato de memória|reescrevê-lo de memória/, 'passo final não proíbe reescrever o mandato de memória');
});

test('skill backlog: relatório ao chamador, sem arquivo (AC-04.2.4)', () => {
  const step = finalStep(BACKLOG_SKILL());
  assert.match(step, /findings por severidade/, 'passo final não repassa findings por severidade');
  assert.match(step, /com path/, 'passo final não exige path no que foi alterado');
  assert.match(step, /veredito/, 'passo final não repassa o veredito');
  assert.match(step, /nunca é materializado em arquivo/, 'passo final não proíbe arquivo de relatório');
  assert.match(step, /\.talos\//, 'passo final não cita a superfície documental proibida');
});

test('skill backlog: regate dos gates sobre artefatos alterados pelo revisor (AC-04.2.5)', () => {
  const step = finalStep(BACKLOG_SKILL());
  assert.match(step, /talos_verify_sprint_file/, 'passo final não reexecuta o gate de sprint file');
  assert.match(step, /talos_verify_backlog_index/, 'passo final não reexecuta o gate de backlog');
  assert.match(step, /antes de entregar/, 'passo final não condiciona o regate à entrega');
});

test('skill backlog: nenhum nome de ferramenta de host como instrução (AC-04.3.2 / INV4)', () => {
  const corpus = `${BACKLOG_SKILL()}\n${COLD_REVIEW_PROMPT()}`;
  for (const token of ['AskUserQuestion', 'Agent', 'Task', 'runSubagent', 'request_user_input', 'interactive_prompt']) {
    assert.ok(!corpus.includes(token), `nome de ferramenta de host hardcodado: ${token}`);
  }
  // Os descritores do host são a única fonte do verbo (multi-host por adapter).
  assert.match(BACKLOG_SKILL(), /question_prompt/, 'skill não aponta question_prompt');
  assert.match(BACKLOG_SKILL(), /subagent_dispatch/, 'skill não aponta subagent_dispatch');
});

// ── Plano 01 (RASTREABILIDADE_MCP_GUIDE) — marcas v1 consistência (INV3) ──────

const TRACE_LEDGER_V1 = {
  schema: 'traceability_v1', reqs: {},
  sprints: { S01: { schema: 'traceability_v1' } }, pilot_metrics: [],
};
const TRACE_LEDGER_V1_SEM_S01 = {
  schema: 'traceability_v1', reqs: {},
  sprints: {}, pilot_metrics: [],
};

test('traceability: mismatch de marcas bloqueia nos dois sentidos; par v1 passa (AC-1.2.1 / INV3 / VC4)', () => {
  // Sprint com metadado Traceability: v1 e ledger sem sprints[S01] → blocked.
  const onlySprint = validateSprintFileConformance(
    sprintFixture({ traceabilityMark: 'v1' }),
    { traceability: TRACE_LEDGER_V1_SEM_S01 },
  );
  assert.equal(onlySprint.valid, false);
  // INV3: o bloqueio de marcas é semântico (ação alinhar_marcadores_traceability),
  // não a presença de qualquer pendência de rastreabilidade — sob mutação "um
  // lado só como v1", o grafo poderia mascarar o mismatch com pendências de
  // source_refs. Assert pela ação, não por ordem de pendências.
  const sprintSide = onlySprint.pendencies.find(
    (p) => p.category === 'rastreabilidade' && p.next_action === 'alinhar_marcadores_traceability' && p.item === 'S01',
  );
  assert.ok(sprintSide, JSON.stringify(onlySprint.pendencies));
  assert.equal(sprintSide.next_action, 'alinhar_marcadores_traceability');
  // Ledger sprints[S01].schema = traceability_v1 e sprint sem metadado → blocked.
  const onlyLedger = validateSprintFileConformance(
    sprintFixture(),
    { traceability: TRACE_LEDGER_V1 },
  );
  assert.equal(onlyLedger.valid, false);
  const ledgerSide = onlyLedger.pendencies.find(
    (p) => p.category === 'rastreabilidade' && p.next_action === 'alinhar_marcadores_traceability' && p.item === 'S01',
  );
  assert.ok(ledgerSide, JSON.stringify(onlyLedger.pendencies));
  // Par consistente (os dois lados) → modo v1, sem pendência de marcas. O ramo
  // v1 do Plano 02 também exige source_refs nos ACs — o filtro isola o gate de
  // marcas (INV3); a exigência de refs é coberta pelos testes do Plano 02.
  const bothV1 = validateSprintFileConformance(
    sprintFixture({ traceabilityMark: 'v1' }),
    { traceability: TRACE_LEDGER_V1 },
  );
  assert.ok(!bothV1.pendencies.some((p) => p.category === 'rastreabilidade' && p.next_action === 'alinhar_marcadores_traceability'),
    JSON.stringify(bothV1.pendencies));
});

test('traceability: sprint sem marca não exige ledger (AC-1.2.2 / CN10 / VC4)', () => {
  // Sem metadado e sem entrada no ledger: contrato atual (legacy) — passa.
  const legacy = validateSprintFileConformance(
    sprintFixture(),
    { traceability: TRACE_LEDGER_V1_SEM_S01 },
  );
  assert.equal(legacy.valid, true, JSON.stringify(legacy.pendencies));
  // Chamador que não conhece o ledger (opção ausente): comportamento idêntico.
  const noOption = validateSprintFileConformance(sprintFixture());
  assert.equal(noOption.valid, true, JSON.stringify(noOption.pendencies));
});

// ── Plano 02 (RASTREABILIDADE_MCP_GUIDE) — source_refs, conformance e selo ─────

/** AC completo do §7.3 com `source_refs` opcional (Plano 02). */
function traceAc({ id = 'AC-001', refs = null, origin = 'usuario' } = {}) {
  return [
    `  - id: ${id}`,
    `    origin: "${origin}"`,
    '    behavior: "Comportamento observável"',
    '    decisions: [D1]',
    '    scenario: "Cenário 1"',
    ...(refs === null ? [] : [`    source_refs: [${refs.join(', ')}]`]),
    '    evals: [EVAL-001]',
    '    evidence:',
    '      required: [I, T-outcome]',
    '      manual: null',
  ];
}

/** REQ do ledger (shape do upsert do Plano 01), atribuído à sprint S01. */
function traceReqLedger(id, { disposition = 'included', links = null } = {}) {
  const req = {
    id,
    sources: [{ kind: 'talos', ref: 'sprint:S01' }],
    criticality: 'alta',
    disposition,
  };
  if (links !== null) req.links = links;
  return req;
}

function traceLedgerWith(reqs) {
  return {
    schema: 'traceability_v1',
    reqs,
    sprints: { S01: { schema: 'traceability_v1' } },
    pilot_metrics: [],
  };
}

test('traceability: parseAcceptanceContract lê source_refs do YAML (AC-2.1.1 / CN2 / VC3)', () => {
  const markdown = sprintFixture({
    acceptanceItems: traceAc({ id: 'AC-001', refs: ['REQ-001', 'REQ-002'] }),
  });
  const items = parseAcceptanceContract(markdown);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].source_refs, ['REQ-001', 'REQ-002'], 'array sobrevive ao parse');
  // VC3: sprint sem o campo continua sem source_refs (ausência ≠ lista vazia).
  const legacy = parseAcceptanceContract(sprintFixture());
  assert.ok(!('source_refs' in legacy[0]), 'sprint sem o campo não ganha source_refs');
});

test('traceability: v1 — source_refs ausente/malformada/órfã bloqueiam conformance (AC-2.1.2 / CN3)', () => {
  const ledger = traceLedgerWith({ 'REQ-001': traceReqLedger('REQ-001') });
  // (a) AC sem source_refs em sprint v1 → blocked nomeando o AC.
  const semRefs = validateSprintFileConformance(
    sprintFixture({ traceabilityMark: 'v1', acceptanceItems: traceAc({ id: 'AC-001' }) }),
    { traceability: ledger },
  );
  assert.equal(semRefs.valid, false);
  const pSemRefs = semRefs.pendencies.find(
    (p) => p.category === 'rastreabilidade' && p.item === 'AC-001' && /source_refs/.test(p.message),
  );
  assert.ok(pSemRefs, JSON.stringify(semRefs.pendencies));
  assert.equal(pSemRefs.next_action, 'preencher_source_refs');
  // (b) ref fora do formato REQ-\d+ → blocked.
  const malformada = validateSprintFileConformance(
    sprintFixture({ traceabilityMark: 'v1', acceptanceItems: traceAc({ id: 'AC-001', refs: ['REQ-x1'] }) }),
    { traceability: ledger },
  );
  assert.equal(malformada.valid, false);
  assert.ok(malformada.pendencies.some(
    (p) => p.category === 'rastreabilidade' && p.item === 'AC-001' && /inválido/.test(p.message),
  ), JSON.stringify(malformada.pendencies));
  // (c) REQ-999 ausente do ledger → blocked (falsificador: selo/conformance passar).
  const orfa = validateSprintFileConformance(
    sprintFixture({ traceabilityMark: 'v1', acceptanceItems: traceAc({ id: 'AC-001', refs: ['REQ-999'] }) }),
    { traceability: ledger },
  );
  assert.equal(orfa.valid, false);
  const pOrfa = orfa.pendencies.find((p) => p.category === 'rastreabilidade' && /REQ-999/.test(p.message));
  assert.ok(pOrfa, JSON.stringify(orfa.pendencies));
  assert.equal(pOrfa.next_action, 'registrar_req_no_ledger');
  // Contraprova: REQ-999 registrado no ledger → esse check some; par v1 fecha.
  const comReq = validateSprintFileConformance(
    sprintFixture({ traceabilityMark: 'v1', acceptanceItems: traceAc({ id: 'AC-001', refs: ['REQ-999'] }) }),
    { traceability: traceLedgerWith({ 'REQ-999': traceReqLedger('REQ-999') }) },
  );
  assert.equal(comReq.valid, true, JSON.stringify(comReq.pendencies));
});

test('traceability: legacy sem source_refs e sem marca valida como hoje; selo do §7 estável (AC-2.2.1 / CN7)', () => {
  // ≥4 artefatos legacy em memória — nenhum arquivo selado de produto é tocado
  // (o template real é coberto pelos testes SPRINT_TEMPLATE de server.test.js).
  const legacyCases = [
    sprintFixture(),
    sprintFixture({ moscow: 'Should', prioridade: 'P1' }),
    sprintFixture({ traceabilityMark: 'legacy' }),
    sprintFixture({ acceptanceItems: traceAc({ id: 'AC-002', refs: ['REQ-007'] }) }),
  ];
  for (const [index, markdown] of legacyCases.entries()) {
    const r = validateSprintFileConformance(markdown, { root: ROOT });
    assert.equal(r.valid, true, `caso legacy ${index} deve passar; pendências: ${JSON.stringify(r.pendencies)}`);
    assert.ok(!r.pendencies.some((p) => p.category === 'rastreabilidade'),
      `caso legacy ${index} não pode exigir grafo v1; pendências: ${JSON.stringify(r.pendencies)}`);
  }
  // Selo de um §7 sem o campo: hash estável (constante no teste; falsificador:
  // parser/conformance exigir source_refs fora do ramo v1 muda o hash ou o veredito).
  const seal = computeAcceptanceSeal(sprintFixture());
  assert.equal(seal, 'sha256:63671be3dfcaf662e701f2979346422cc4e193826280fe7ce59ccb8909cc9f88', 'hash do bloco §7 sem source_refs permanece estável');
});

test('traceability: vínculo N:N exige motivo; 1:1 segue livre (AC-2.3.1 / INV7)', () => {
  // Dois ACs no mesmo REQ (count(REQ→AC) = 2) sem reason → blocked.
  const ledgerUmReq = traceLedgerWith({ 'REQ-001': traceReqLedger('REQ-001') });
  const doisAcs = sprintFixture({
    traceabilityMark: 'v1',
    acceptanceItems: [...traceAc({ id: 'AC-001', refs: ['REQ-001'] }), ...traceAc({ id: 'AC-002', refs: ['REQ-001'] })],
  });
  const r = validateSprintFileConformance(doisAcs, { traceability: ledgerUmReq });
  assert.equal(r.valid, false);
  const nn = r.pendencies.filter((p) => p.category === 'rastreabilidade' && /N:N/.test(p.message));
  assert.equal(nn.length, 2, JSON.stringify(r.pendencies));
  assert.ok(nn.every((p) => p.next_action === 'declarar_reason_no_link'));
  // Com reason nos dois links do ledger → esse check passa.
  const comReason = validateSprintFileConformance(doisAcs, {
    traceability: traceLedgerWith({
      'REQ-001': traceReqLedger('REQ-001', {
        links: [
          { ac_id: 'AC-001', reason: 'origem comum' },
          { ac_id: 'AC-002', reason: 'visão de aceite distinta' },
        ],
      }),
    }),
  });
  assert.equal(comReason.valid, true, JSON.stringify(comReason.pendencies));
  // AC com dois REQs (count(AC→REQ) = 2): idem — sem reason bloqueia, com reason passa.
  const ledgerDoisReqs = traceLedgerWith({
    'REQ-001': traceReqLedger('REQ-001'),
    'REQ-002': traceReqLedger('REQ-002'),
  });
  const acDoisReqs = sprintFixture({
    traceabilityMark: 'v1',
    acceptanceItems: traceAc({ id: 'AC-001', refs: ['REQ-001', 'REQ-002'] }),
  });
  const r2 = validateSprintFileConformance(acDoisReqs, { traceability: ledgerDoisReqs });
  assert.equal(r2.valid, false);
  assert.equal(r2.pendencies.filter((p) => p.category === 'rastreabilidade' && /N:N/.test(p.message)).length, 2,
    JSON.stringify(r2.pendencies));
  const ok2 = validateSprintFileConformance(acDoisReqs, {
    traceability: traceLedgerWith({
      'REQ-001': traceReqLedger('REQ-001', { links: [{ ac_id: 'AC-001', reason: 'x' }] }),
      'REQ-002': traceReqLedger('REQ-002', { links: [{ ac_id: 'AC-001', reason: 'y' }] }),
    }),
  });
  assert.equal(ok2.valid, true, JSON.stringify(ok2.pendencies));
  // 1:1 sem links segue livre (sem pendência N:N nem included sem AC).
  const umParaUm = sprintFixture({
    traceabilityMark: 'v1',
    acceptanceItems: traceAc({ id: 'AC-001', refs: ['REQ-001'] }),
  });
  const ok3 = validateSprintFileConformance(umParaUm, { traceability: ledgerUmReq });
  assert.equal(ok3.valid, true, JSON.stringify(ok3.pendencies));
});
