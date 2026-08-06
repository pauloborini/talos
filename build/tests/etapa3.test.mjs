import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  approveAcceptanceContract,
  closedDecisionIds,
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
