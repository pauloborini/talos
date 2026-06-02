#!/usr/bin/env node
// Guards de consistência pré-build. Falha (exit != 0) em drift ou regressão.
// 1. M3: contrato do validator (bloco JSON de veredito + Severity Model) deve ser
//    idêntico entre o agente Claude (agents/) e o SKILL.md (usado pelo Codex).
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
  'hosts/pi/mcp.json',
  'hosts/pi/agents/atlas-task-validator.md',
  'hosts/pi/atlas/packages/mcp-server/server.js',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    errors.push(`ausente: ${rel} (rode build/build-plugins.sh e commite hosts/)`);
  }
}

// Contrato do validator por host (S10): o bloco JSON de veredito dos agentes
// gerados (opencode/pi) deve ser idêntico ao canônico — catálogo stale = drift.
for (const rel of [
  'hosts/opencode/.opencode/agents/atlas-task-validator.md',
  'hosts/pi/agents/atlas-task-validator.md',
]) {
  const hostAgent = read(rel);
  const hostVerdict = verdictBlock(hostAgent, rel);
  if (aVerdict && hostVerdict && aVerdict !== hostVerdict) {
    errors.push(`M3 drift: veredito de ${rel} difere do canônico agents/atlas-task-validator.md (rode build/build-plugins.sh)`);
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
const HOST_VERBS = [/TodoWrite/, /Agent\(subagent_type/, /\$atlas-task-validator/];
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

if (errors.length) {
  console.error('check-consistency: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(3);
}
console.log('check-consistency: ok (validator sincronizado cross-host; catálogos opencode/pi presentes+versão; skills sem hardcode; sem regressão A1/A2)');
