#!/usr/bin/env node
// Guards de consistência pré-build. Falha (exit != 0) em drift ou regressão.
// 1. M3: contrato do validator (bloco JSON de veredito + Severity Model) deve ser
//    idêntico entre o agente canônico (agents/) e o SKILL.md.
// 2. A1: nenhum `subagent_type: true` em SKILL.md (campo inexistente/no-op).
// 3. A2: nenhum `display_name: "Codex` residual em agents/openai.yaml.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { errors.push(`ausente: ${rel}`); return null; }
  return fs.readFileSync(p, 'utf8');
}

function agentText(rel) {
  const text = read(rel);
  if (text == null || !rel.endsWith('.toml')) return text;
  const m = text.match(/^developer_instructions\s*=\s*(".*")$/m);
  if (!m) { errors.push(`${rel}: developer_instructions ausente`); return text; }
  try { return JSON.parse(m[1]); } catch { errors.push(`${rel}: developer_instructions inválido`); return text; }
}

// Extrai o bloco ```json que contém "verdict", normalizado (sem espaços).
function verdictBlock(text, label) {
  if (text == null) return null;
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map(m => m[1]);
  const block = fences.find(b => b.includes('"verdict"'));
  if (!block) { errors.push(`${label}: bloco JSON de veredito não encontrado`); return null; }
  return block.replace(/\s+/g, '');
}

// Conjunto de códigos de severidade definidos (presença, não prosa — a descrição
// pode legitimamente variar de idioma entre o agente Claude e o SKILL.md).
function severitySet(text, label) {
  if (text == null) return null;
  const codes = new Set([...text.matchAll(/`(P[123])`/g)].map(m => m[1]));
  const missing = ['P1', 'P2', 'P3'].filter(c => !codes.has(c));
  if (missing.length) { errors.push(`${label}: Severity Model sem ${missing.join('/')}`); return null; }
  return [...codes].sort().join(',');
}

const agent = read('agents/atlas-task-validator.md');
const skill = read('packages/skills/atlas-task-validator/SKILL.md');

const aVerdict = verdictBlock(agent, 'agents/atlas-task-validator.md');
const sVerdict = verdictBlock(skill, 'SKILL.md');
if (aVerdict && sVerdict && aVerdict !== sVerdict) {
  errors.push('M3 drift: bloco JSON de veredito difere entre agents/atlas-task-validator.md e SKILL.md');
}

const aSev = severitySet(agent, 'agents/atlas-task-validator.md');
const sSev = severitySet(skill, 'SKILL.md');
if (aSev && sSev && aSev !== sSev) {
  errors.push('M3 drift: conjunto de severidades difere entre agents/atlas-task-validator.md e SKILL.md');
}

// A1: subagent_type: true em qualquer SKILL.md
const skillsDir = path.join(ROOT, 'packages/skills');
if (fs.existsSync(skillsDir)) {
  for (const d of fs.readdirSync(skillsDir)) {
    const sp = path.join(skillsDir, d, 'SKILL.md');
    if (fs.existsSync(sp) && /^subagent_type:\s*true/m.test(fs.readFileSync(sp, 'utf8'))) {
      errors.push(`A1 regressão: subagent_type: true em ${path.relative(ROOT, sp)} (campo inexistente)`);
    }
    const yaml = path.join(skillsDir, d, 'agents/openai.yaml');
    if (fs.existsSync(yaml) && /display_name:\s*"Codex/.test(fs.readFileSync(yaml, 'utf8'))) {
      errors.push(`A2 regressão: display_name "Codex" em ${path.relative(ROOT, yaml)}`);
    }
  }
}

// Catálogo Codex from-source deve existir no repo (GitHub público).
for (const rel of [
  '.agents/plugins/marketplace.json',
  'plugins/atlas-workflow-orchestrator/.codex-plugin/plugin.json',
  'plugins/atlas-workflow-orchestrator/.mcp.json',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    errors.push(`ausente: ${rel} (rode build/build-plugins.sh e commite plugins/atlas-workflow-orchestrator/)`);
  }
}

// Catálogos from-source dos hosts opencode/pi devem existir (install via GitHub
// público — DEC-008). Stale/ausente => host não instala pelo caminho primário.
for (const rel of [
  'hosts/opencode/opencode.json',
  'hosts/opencode/.opencode/agents/atlas-task-validator.md',
  'hosts/opencode/.opencode/atlas/packages/mcp-server/server.js',
  'hosts/pi/.mcp.json',
  'hosts/pi/.pi/agents/atlas-task-validator.md',
  'hosts/pi/atlas/packages/mcp-server/server.js',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    errors.push(`ausente: ${rel} (rode build/build-plugins.sh e commite hosts/)`);
  }
}

// Contrato do validator por host (S10): o bloco JSON de veredito dos agentes
// gerados (opencode/pi) deve ser idêntico ao canônico — catálogo stale = drift.
for (const rel of [
  'plugins/atlas-workflow-orchestrator/.codex/agents/atlas-task-validator.toml',
  'hosts/opencode/.opencode/agents/atlas-task-validator.md',
  'hosts/pi/.pi/agents/atlas-task-validator.md',
]) {
  const hostAgent = agentText(rel);
  const hostVerdict = verdictBlock(hostAgent, rel);
  if (aVerdict && hostVerdict && aVerdict !== hostVerdict) {
    errors.push(`M3 drift: veredito de ${rel} difere do canônico agents/atlas-task-validator.md (rode build/build-plugins.sh)`);
  }
}

// Sub-agents executores/review (P1): plan-execute/direct-execute mutam código e
// slice-review revisa — todos são DESPACHADOS pelo orquestrador e por isso precisam
// de registro de agente nativo por host. Ausência = orquestrador cai pro fio principal
// (Gate G9 violado). O corpo é um SHIM fino que DEVE citar o skill_id carregado.
const DISPATCHED_EXEC_AGENTS = ['atlas-plan-execute', 'atlas-direct-execute', 'atlas-findings-repair', 'atlas-slice-review'];
const AGENT_DIRS = [
  ['claude', 'agents'],
  ['codex', 'plugins/atlas-workflow-orchestrator/.codex/agents'],
  ['opencode', 'hosts/opencode/.opencode/agents'],
  ['pi', 'hosts/pi/.pi/agents'],
];
for (const skillId of DISPATCHED_EXEC_AGENTS) {
  for (const [host, dir] of AGENT_DIRS) {
    const ext = host === 'codex' ? 'toml' : 'md';
    const rel = `${dir}/${skillId}.${ext}`;
    const text = agentText(rel); // read() registra 'ausente: <rel>' se faltar
    if (text == null) continue;
    if (!new RegExp(`\\b${skillId}\\b`).test(text)) {
      errors.push(`shim drift: ${rel} (${host}) não cita o skill_id '${skillId}' (shim aponta pra skill errada?)`);
    }
    // Shim fino: não deve embutir corpo de skill com veredito JSON (isso é do validator).
    // EXCEÇÃO pi: pi não tem loader de skills no subagente, então o gerador EMBUTE o
    // SKILL.md canônico no agente pi por design (build/gen-host-agent.mjs). Fonte única
    // continua sendo o SKILL.md; o agente pi é cópia gerada. Demais hosts seguem shim fino.
    if (host !== 'pi' && /```json[\s\S]*"verdict"/.test(text)) {
      errors.push(`shim drift: ${rel} (${host}) embute bloco de veredito — executor/review é shim fino, não cópia do SKILL.md`);
    }
  }
}

// Versão dos manifests/catálogos from-source deve casar com VERSION
// (instalação via GitHub público lê manifests crus na raiz, sem build).
const versionFile = read('VERSION');
if (versionFile != null) {
  const want = versionFile.trim();
  for (const rel of [
    '.claude-plugin/plugin.json',
    'plugins/atlas-workflow-orchestrator/.codex-plugin/plugin.json',
    'package.json',
    // Fonte de versão lida pelo server em runtime (SERVER_DIR/package.json):
    // drift aqui bloqueia o preflight (VERSION_DRIFT), então tem que casar.
    'packages/mcp-server/package.json',
  ]) {
    const raw = read(rel);
    if (raw == null) continue;
    let got = null;
    try { got = JSON.parse(raw).version; } catch { errors.push(`${rel}: JSON inválido`); continue; }
    if (got != null && got !== want) {
      errors.push(`Drift de versão: ${rel} (${got}) != VERSION (${want})`);
    }
  }
  // Catálogos opencode/pi carregam VERSION crua (não plugin.json).
  for (const rel of ['hosts/opencode/.opencode/atlas/VERSION', 'hosts/pi/atlas/VERSION']) {
    const raw = read(rel);
    if (raw != null && raw.trim() !== want) {
      errors.push(`Drift de versão: ${rel} (${raw.trim()}) != VERSION (${want})`);
    }
  }
}

// Skills host-agnósticas (S10/F4-A4): se uma skill nomear um verbo nativo de host
// (TodoWrite, tasks, Agent(subagent_type, $<skill>), DEVE ancorar em atlas_capabilities
// — senão é hardcode de host. O orquestrador é exceção (coordena e cita hosts).
const HOST_VERBS = [/TodoWrite/, /Agent\(subagent_type/, /\$atlas-task-validator/, /spawn_agent\(agent_type/];
if (fs.existsSync(skillsDir)) {
  for (const d of fs.readdirSync(skillsDir)) {
    const sp = path.join(skillsDir, d, 'SKILL.md');
    if (!fs.existsSync(sp)) continue;
    const text = fs.readFileSync(sp, 'utf8');
    const namesHostVerb = HOST_VERBS.some((re) => re.test(text));
    if (namesHostVerb && !/atlas_capabilities/.test(text)) {
      errors.push(`F4-A4 hardcode de host: ${path.relative(ROOT, sp)} nomeia verbo nativo sem ancorar em atlas_capabilities`);
    }
  }
}

// Anti-regressão de prosa (S10/DEC-004 hardening): o fail-closed de PREREQ para hosts
// must_report (pi/generic) depende do orquestrador apurar e reportar host_capabilities
// no preflight. Se esse passo sumir do SKILL, a garantia de determinismo se perde
// silenciosamente. O SKILL DEVE citar host_capabilities E atlas_preflight.
const orchestratorSkill = read('packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md');
if (orchestratorSkill != null) {
  for (const token of ['host_capabilities', 'atlas_preflight']) {
    if (!orchestratorSkill.includes(token)) {
      errors.push(`PREREQ prosa-regressão: SKILL do orquestrador não cita '${token}' (passo de report sustenta o fail-closed)`);
    }
  }
  for (const token of ['dispatch_token', 'repair_run_id', 'repair_budget: 1']) {
    if (!orchestratorSkill.includes(token)) {
      errors.push(`G4 prosa-regressão: SKILL do orquestrador não cita '${token}'`);
    }
  }
}

const validatorAgent = read('agents/atlas-task-validator.md');
if (validatorAgent != null && !/"dispatch_token"\s*:/.test(validatorAgent)) {
  errors.push('G4 contrato-regressão: output do atlas-task-validator não inclui dispatch_token');
}

const findingsRepairSkill = read('packages/skills/atlas-findings-repair/SKILL.md');
if (findingsRepairSkill != null) {
  for (const token of ['repair_run_id', 'repair_budget: 1', 'Não trocar o `state_path`']) {
    if (!findingsRepairSkill.includes(token)) {
      errors.push(`G4 repair-regressão: atlas-findings-repair não cita '${token}'`);
    }
  }
}

if (errors.length) {
  console.error('check-consistency: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(3);
}
console.log('check-consistency: ok (validator sincronizado cross-host; catálogos opencode/pi presentes+versão; skills sem hardcode; sem regressão A1/A2)');
