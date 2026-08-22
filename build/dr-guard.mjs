// Guards DR01–04 da trilha enxugar-state — onda 1 (GUIDE §2.1 CN7 / design spec
// 2026-08-19 §6.1): falham o `check-consistency` se as skills de execução
// (plan-execute / direct-execute / findings-repair) — canônicas em
// `packages/skills/` e espelhos `hosts/**`/`plugins/**` — reensinaram âncoras
// mortas do blob (writer LLM do JSON de slice).
//
// Allowlist do design spec §6.1: `packages/templates/STATE_FILE_SCHEMA.md`,
// `packages/mcp-server/**`, `packages/skills/talos-task-validator/**`, testes —
// esses caminhos ficam fora do glob varrido aqui (task-validator LÊ o state e cita
// o schema legitimamente; execute/direct/repair não podem).
//
// Módulo puro (sem side effects de CLI): `check-consistency.mjs` importa e varre o
// repo; `check-consistency.guard.test.mjs` importa para plantar fixtures e provar
// que as skills canônicas pós-Plano 2 passam (AC-3.1.1).
import fs from 'node:fs';
import path from 'node:path';

export const EXECUTE_SKILLS = ['talos-plan-execute', 'talos-direct-execute', 'talos-findings-repair'];

// DR02 detecta instrução de ESCRITA do blob (capturar/persistir/escrever os
// snapshots de worktree, ou JSON-key de exemplo), não menção de leitura para
// contexto — a skill repair canônica cita `worktree_baseline`/`worktree_final`
// apenas como leitura (Plano 02, AC-2.1.2) e precisa passar o guard.
const DR02_VERB = '(?:captur|persist|write|wrote|writ|recomput|recaptur|preench|escrev|grav|preserv)\\w*';
const DR_ANCHORS = [
  { id: 'DR01', label: 'STATE_FILE_SCHEMA.md', re: /STATE_FILE_SCHEMA\.md/ },
  {
    id: 'DR02',
    label: 'worktree_baseline/worktree_final como instrução de escrita (blob)',
    re: new RegExp(
      `(?:^|[^\\w])${DR02_VERB}[^\\n]{0,80}worktree_(?:baseline|final)` +
        `|worktree_(?:baseline|final)[^\\n]{0,80}(?:^|[^\\w])${DR02_VERB}` +
        `|"worktree_(?:baseline|final)"\\s*:`,
      'i',
    ),
  },
  {
    id: 'DR03',
    label: 'checkpoints mortos (executor_started/skill_loaded/plan_loaded/handoff_accepted/task_started/state_path_created)',
    re: /executor_started|skill_loaded|plan_loaded|handoff_accepted|task_started|state_path_created/,
  },
  { id: 'DR04', label: '"acceptance_results"', re: /"acceptance_results"/ },
];

// IDs DR* violados por um texto, na ordem do spec §6.1.
export function matchDrAnchors(text) {
  return DR_ANCHORS.filter(({ re }) => re.test(text)).map(({ id }) => id);
}

// Diretórios das skills de execução: canônicos em packages/skills/<s> mais toda
// cópia com o mesmo nome sob hosts/** e plugins/** (espelhos gerados).
export function collectExecuteSkillDirs(root) {
  const dirs = new Set();
  for (const s of EXECUTE_SKILLS) {
    dirs.add(path.join(root, 'packages', 'skills', s));
  }
  for (const base of ['hosts', 'plugins']) {
    const abs = path.join(root, base);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length > 0) {
      const cur = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const p = path.join(cur, entry.name);
        if (!entry.isDirectory()) continue;
        if (EXECUTE_SKILLS.includes(entry.name)) dirs.add(p);
        else stack.push(p);
      }
    }
  }
  return [...dirs];
}

// Todos os arquivos abaixo de um diretório (glob `**`).
export function walkFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
}

// Varre um diretório de skill e devolve as violações {rel, dr} encontradas.
export function scanDirDr(root, dir) {
  const violations = [];
  for (const file of walkFiles(dir)) {
    const rel = path.relative(root, file);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const dr of matchDrAnchors(text)) {
      violations.push({ rel, dr });
    }
  }
  return violations;
}
