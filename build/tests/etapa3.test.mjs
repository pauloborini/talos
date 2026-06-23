import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  closedDecisionIds,
  detectStackProfiles,
  pendingInterviewQuestions,
  persistInterviewRound,
  resolveSprintAuthority,
  validateBacklogUpdate,
} from '../../packages/skills/_shared/scripts/document_quality.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLASSIFIER = path.join(ROOT, 'packages/skills/atlas-slice-review/scripts/classify_findings.mjs');

const finding = {
  severity: 'P1', task_id: 'T01', title: 'Falha', file: 'src/a.js', line: 3,
  failure_mode: 'Falha alcançável.', evidence: 'Guard ausente.',
  recommendation: 'Restabelecer guard.', fix_validation: 'Teste negativo.',
};

test('review: gate canônico executa diretamente com Node, sem Python no PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-'));
  const input = path.join(dir, 'findings.json');
  fs.writeFileSync(input, JSON.stringify([finding]));
  const output = execFileSync(process.execPath, [CLASSIFIER, input], { env: { ...process.env, PATH: dir }, encoding: 'utf8' });
  assert.equal(JSON.parse(output)[0].title, 'Falha');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('perfis: Flutter, Node e Python ativam só regras aplicáveis', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-stack-'));
  const fixture = (name, files, commands = []) => {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
    return detectStackProfiles(dir, commands);
  };
  assert.deepEqual(fixture('node', { 'package.json': '{"scripts":{"test":"node --test"}}' }).boundaries[0], {
    boundary: '.', universal: true, flutter_dart: false, node_typescript: true, python: false, getx: false,
  });
  assert.deepEqual(fixture('flutter', { 'pubspec.yaml': 'name: fixture\ndependencies:\n  flutter:\n    sdk: flutter\n' }).boundaries[0], {
    boundary: '.', universal: true, flutter_dart: true, node_typescript: false, python: false, getx: false,
  });
  assert.deepEqual(fixture('python', { 'pyproject.toml': '[project]\nname="fixture"\n' }).boundaries[0], {
    boundary: '.', universal: true, flutter_dart: false, node_typescript: false, python: true, getx: false,
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('perfis: monorepo restringe stack por boundary e GetX exige evidência', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-monorepo-'));
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

function backlog(rows, decisions = '| D1 | Contrato fechado | S02 | Produto | decidido |', changelog = '- 2026-06-22 — baseline.') {
  return `# Backlog\n\n### Decisões bloqueantes\n\n| ID | Decisão | Bloqueia | Dono | Status |\n|---|---|---|---|---|\n${decisions}\n\n## 7. Registro de sprints\n\n| ID | Sprint | Fase-fonte | Objetivo (1 linha) | MoSCoW | Ganho | Esforço | Prioridade | PRD | Depende de | Estado | Gate |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n${changelog ? `\n## Registro de alterações\n\n${changelog}` : ''}\n`;
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
  const prd = '## 3. Decisões de produto (fechadas)\n\n| ID | Decisão |\n|---|---|\n| D1 | Escolha anterior |\n\n## 4. Fluxos\n';
  const questions = [{ decision_id: 'D1' }, { decision_id: 'D2' }];
  assert.deepEqual(pendingInterviewQuestions(prd, questions), [{ decision_id: 'D2' }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-interview-'));
  const prdPath = path.join(dir, 'PRD.md');
  fs.writeFileSync(prdPath, prd);
  const updated = persistInterviewRound(prdPath, [{ decision_id: 'D2', value: 'Nova escolha' }], '2026-06-22');
  assert.equal(fs.readFileSync(prdPath, 'utf8'), updated);
  assert.deepEqual([...closedDecisionIds(updated)].sort(), ['D1', 'D2']);
  assert.deepEqual(pendingInterviewQuestions(updated, questions), []);
  assert.match(updated, /entrevista: D2 persistida/);
  const moduleUrl = new URL('../../packages/skills/_shared/scripts/document_quality.mjs', import.meta.url).href;
  const freshProcess = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { pendingInterviewQuestions } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify(pendingInterviewQuestions(fs.readFileSync(process.argv[1], 'utf8'), [{ decision_id: 'D2' }])));
  `, prdPath], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(freshProcess), []);
  const invalidPath = path.join(dir, 'INVALID.md');
  fs.writeFileSync(invalidPath, '# PRD sem tabela de decisões\n');
  assert.throws(() => persistInterviewRound(invalidPath, [{ decision_id: 'D3', value: 'x' }]), /DECISION_NOT_MATERIALIZED/);
  assert.equal(fs.readFileSync(invalidPath, 'utf8'), '# PRD sem tabela de decisões\n');
  assert.throws(() => persistInterviewRound(path.join(dir, 'missing', 'PRD.md'), [{ decision_id: 'D3', value: 'x' }]), /INTERVIEW_PERSISTENCE_FAILED/);
  fs.rmSync(dir, { recursive: true, force: true });
});
