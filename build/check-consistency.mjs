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

// Guard de bit +x: scripts .sh em build/ precisam ser executáveis quando invocados
// diretamente (./script.sh). actions/checkout@v4 em Linux respeita o file mode do
// index do git, então se um chmod local não for commitado o runner chega sem +x e
// o shell retorna exit 126 (permission denied) sem mensagem útil. Workflows já
// invocam via `bash` explícito (imune), mas devs e o test-all.sh chamam diretamente
// — falha aqui vira erro legível em vez de 126. Só checa .sh: os .mjs são invocados
// via `node`, que não depende do bit +x.
const buildDir = path.join(ROOT, 'build');
if (fs.existsSync(buildDir)) {
  for (const f of fs.readdirSync(buildDir)) {
    if (!f.endsWith('.sh')) continue;
    const abs = path.join(buildDir, f);
    try {
      fs.accessSync(abs, fs.constants.X_OK);
    } catch {
      errors.push(
        `+x ausente: build/${f} (rode 'chmod +x build/${f}' e commite o file mode — git update-index --chmod=+x build/${f})`
      );
    }
  }
}

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

function tomlStringValue(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*=\\s*(".*")$`, 'm'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
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
  const codes = new Set([...text.matchAll(/`(P[0-3])`/g)].map(m => m[1]));
  const missing = ['P0', 'P1', 'P2', 'P3'].filter(c => !codes.has(c));
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

// Catálogos from-source dos hosts opencode/pi/zcode devem existir (install via GitHub
// público — DEC-008). Stale/ausente => host não instala pelo caminho primário.
for (const rel of [
  'hosts/opencode/opencode.json',
  'hosts/opencode/.opencode/agents/atlas-task-validator.md',
  'hosts/opencode/.opencode/atlas/packages/mcp-server/server.js',
  'hosts/pi/.mcp.json',
  'hosts/pi/.pi/agents/atlas-task-validator.md',
  'hosts/pi/atlas/packages/mcp-server/server.js',
  'hosts/zcode/.zcode-plugin/plugin.json',
  'hosts/zcode/agents/atlas-task-validator.md',
  'hosts/zcode/packages/mcp-server/server.js',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    errors.push(`ausente: ${rel} (rode build/build-plugins.sh e commite hosts/)`);
  }
}

const zcodeValidatorAgent = read('hosts/zcode/agents/atlas-task-validator.md');
if (zcodeValidatorAgent != null) {
  if (!/^name:\s*atlas-task-validator$/m.test(zcodeValidatorAgent) || !/^tools:\s*Read, Grep, Glob, Bash, mcp__plugin_atlas-workflow-orchestrator_atlas-workflow$/m.test(zcodeValidatorAgent)) {
    errors.push('zcode packaging-regressão: agents/atlas-task-validator.md deve manter frontmatter Claude/ZCode canônico (tools com MCP)');
  }
  if (/^mode:\s*subagent$/m.test(zcodeValidatorAgent)) {
    errors.push('zcode packaging-regressão: agents/atlas-task-validator.md não pode usar frontmatter opencode (mode: subagent)');
  }
}

// M4: todo agente cuja SKILL chama atlas_* precisa do servidor MCP declarado em
// tools: (hosts que respeitam frontmatter — Claude Code — restringem ao declarar;
// sem o MCP no frontmatter, o subagente perde acesso ao state/lock e quebra em G4).
// Não cobre opencode (não lista tools) nem pi (formato próprio, sem mcp em tools).
const MCP_SERVER = 'mcp__plugin_atlas-workflow-orchestrator_atlas-workflow';
for (const agentName of ['atlas-task-validator', 'atlas-findings-repair', 'atlas-slice-review']) {
  const skillPath = `packages/skills/${agentName}/SKILL.md`;
  const skillText = read(skillPath);
  const agentPath = `agents/${agentName}.md`;
  const agentTextRaw = read(agentPath);
  if (skillText && agentTextRaw && /\batlas_[a-z_]+\b/.test(skillText)) {
    const toolsLine = (agentTextRaw.match(/^tools:\s*(.+)$/m) || [])[1] || '';
    if (!toolsLine.includes(MCP_SERVER)) {
      errors.push(`M4 regressão: ${agentPath} lista tools: sem ${MCP_SERVER}, mas packages/skills/${agentName}/SKILL.md chama atlas_* (frontmatter precisa do MCP)`);
    }
  }
}

// Contrato do validator por host (S10): o bloco JSON de veredito dos agentes
// gerados (opencode/pi/zcode) deve ser idêntico ao canônico — catálogo stale = drift.
for (const rel of [
  'plugins/atlas-workflow-orchestrator/.codex/agents/atlas-task-validator.toml',
  'hosts/opencode/.opencode/agents/atlas-task-validator.md',
  'hosts/pi/.pi/agents/atlas-task-validator.md',
  'hosts/zcode/agents/atlas-task-validator.md',
]) {
  const hostAgent = agentText(rel);
  const hostVerdict = verdictBlock(hostAgent, rel);
  if (aVerdict && hostVerdict && aVerdict !== hostVerdict) {
    errors.push(`M3 drift: veredito de ${rel} difere do canônico agents/atlas-task-validator.md (rode build/build-plugins.sh)`);
  }
}

// Codex validator precisa ser custom agent explícito. Não pinamos modelo: contas
// ChatGPT-backed podem rejeitar modelos fixos; isolamento sibling + gates MCP
// sustentam G4.
const codexValidatorRel = 'plugins/atlas-workflow-orchestrator/.codex/agents/atlas-task-validator.toml';
const codexValidatorRaw = read(codexValidatorRel);
if (codexValidatorRaw != null) {
  const expected = {
    name: 'atlas-task-validator',
  };
  for (const [key, want] of Object.entries(expected)) {
    const got = tomlStringValue(codexValidatorRaw, key);
    if (got !== want) {
      errors.push(`Codex validator config: ${codexValidatorRel} ${key} (${got ?? 'ausente'}) != ${want}`);
    }
  }
  for (const forbidden of ['model', 'model_reasoning_effort']) {
    const got = tomlStringValue(codexValidatorRaw, forbidden);
    if (got != null) errors.push(`Codex validator config: ${codexValidatorRel} não deve pinçar ${forbidden} (${got})`);
  }
}
for (const rel of [
  'agents/atlas-task-validator.md',
  'hosts/opencode/.opencode/agents/atlas-task-validator.md',
  'hosts/pi/.pi/agents/atlas-task-validator.md',
]) {
  const raw = read(rel);
  if (raw != null && /gpt-5\.4|model_reasoning_effort/.test(raw)) {
    errors.push(`Codex-only model pin vazou para host não-Codex: ${rel}`);
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
  ['zcode', 'hosts/zcode/agents'],
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
  // Catálogos opencode/pi/zcode carregam VERSION crua (não plugin.json).
  for (const rel of [
    'hosts/opencode/.opencode/atlas/VERSION',
    'hosts/pi/atlas/VERSION',
    'hosts/zcode/packages/mcp-server/VERSION',
  ]) {
    const raw = read(rel);
    if (raw != null && raw.trim() !== want) {
      errors.push(`Drift de versão: ${rel} (${raw.trim()}) != VERSION (${want})`);
    }
  }

  // Validação de versão estática nos READMEs, docs e comandos para evitar drift
  const readme = read('README.md');
  if (readme != null) {
    if (!readme.includes(`v${want}`) || !readme.includes(`(\`${want}\`)`)) {
      errors.push(`Drift de versão em README.md: deve conter "v${want}" e "(\`${want}\`)"`);
    }
  }

  const commands = read('COMMANDS.md');
  if (commands != null) {
    if (!commands.includes(`version: ${want}`)) {
      errors.push(`Drift de versão em COMMANDS.md: deve conter "version: ${want}"`);
    }
  }

  const mcpReadme = read('packages/mcp-server/README.md');
  if (mcpReadme != null) {
    if (!mcpReadme.includes(`v${want}`)) {
      errors.push(`Drift de versão em packages/mcp-server/README.md: deve conter "v${want}"`);
    }
  }

  const orchestratorReadme = read('packages/orchestrator/README.md');
  if (orchestratorReadme != null) {
    if (!orchestratorReadme.includes(`**Plugin version:** ${want}`)) {
      errors.push(`Drift de versão em packages/orchestrator/README.md: deve conter "**Plugin version:** ${want}"`);
    }
  }

  const agentsMd = read('AGENTS.md');
  if (agentsMd != null) {
    if (!agentsMd.includes(`Versão: \`${want}\``)) {
      errors.push(`Drift de versão em AGENTS.md: deve conter "Versão: \`${want}\`"`);
    }
  }

  const claudeMd = read('CLAUDE.md');
  if (claudeMd != null) {
    if (!claudeMd.includes(`Versão: \`${want}\``)) {
      errors.push(`Drift de versão em CLAUDE.md: deve conter "Versão: \`${want}\`"`);
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

// Anti-regressão de prosa (S10/DEC-004/DEC-008 hardening): o fail-closed de PREREQ
// e DISPATCH depende do orquestrador apurar e reportar host_capabilities no preflight.
// Se esse passo sumir do SKILL, a garantia de determinismo se perde silenciosamente.
// O SKILL DEVE citar host_capabilities, dispatch_mutable e atlas_preflight.
const orchestratorSkill = read('packages/orchestrator/skills/atlas-workflow-orchestrator/SKILL.md');
if (orchestratorSkill != null) {
  for (const token of ['host_capabilities', 'dispatch_mutable', 'atlas_preflight']) {
    if (!orchestratorSkill.includes(token)) {
      errors.push(`preflight prosa-regressão: SKILL do orquestrador não cita '${token}' (passo de report sustenta o fail-closed)`);
    }
  }
  for (const token of ['dispatch_token', 'repair_run_id', 'repair_budget: 1', 'challenge_response']) {
    if (!orchestratorSkill.includes(token)) {
      errors.push(`G4 prosa-regressão: SKILL do orquestrador não cita '${token}'`);
    }
  }
}

const validatorAgent = read('agents/atlas-task-validator.md');
if (validatorAgent != null && !/"dispatch_token"\s*:/.test(validatorAgent)) {
  errors.push('G4 contrato-regressão: output do atlas-task-validator não inclui dispatch_token');
}
// P1.1: o validador irmão DEVE devolver challenge_response (proof-of-work) e ler o
// challenge do recovery. Sem isso, a slice bloqueia em challenge_failed em runtime.
if (validatorAgent != null && !/"challenge_response"\s*:/.test(validatorAgent)) {
  errors.push('G4 contrato-regressão: output do atlas-task-validator não inclui challenge_response (proof-of-work)');
}
if (validatorAgent != null && !/validator_recovery\.challenge|challenge\.file/.test(validatorAgent)) {
  errors.push('G4 contrato-regressão: atlas-task-validator não lê o challenge de proof-of-work do recovery');
}

const findingsRepairSkill = read('packages/skills/atlas-findings-repair/SKILL.md');
if (findingsRepairSkill != null) {
  for (const token of ['repair_run_id', 'repair_budget: 1', 'Não trocar o `state_path`']) {
    if (!findingsRepairSkill.includes(token)) {
      errors.push(`G4 repair-regressão: atlas-findings-repair não cita '${token}'`);
    }
  }
}

// Etapa 3: gate da review é Node canônico; entrevista usa adapter; backlog é prioridade
// documental para macro input e permanece fora de execução mutante.
const sliceReviewSkill = read('packages/skills/atlas-slice-review/SKILL.md');
const nodeFindingsGate = read('packages/skills/atlas-slice-review/scripts/classify_findings.mjs');
if (sliceReviewSkill != null && !/node scripts\/classify_findings\.mjs/.test(sliceReviewSkill)) {
  errors.push('portabilidade-regressão: slice review não invoca gate Node canônico');
}
if (nodeFindingsGate == null) errors.push('portabilidade-regressão: gate Node de findings ausente');

const interviewSkill = read('packages/skills/atlas-prd-interview/SKILL.md');
if (interviewSkill != null) {
  if (/AskUserQuestion/.test(interviewSkill)) errors.push('interview-regressão: skill hardcoda AskUserQuestion');
  for (const token of ['atlas_capabilities', 'question_prompt', 'persistInterviewRound', 'pendingInterviewQuestions']) {
    if (!interviewSkill.includes(token)) errors.push(`interview-regressão: contrato não cita '${token}'`);
  }
}
const backlogSkill = read('packages/skills/atlas-backlog-generator/SKILL.md');
if (backlogSkill != null) {
  for (const token of ['routing.document_flow.priority = backlog_first', 'próxima sprint executável', 'atlas_verify_backlog_index', 'atlas_select_next_sprint', 'Não gerar PRD/plano/código']) {
    if (!backlogSkill.includes(token)) {
      errors.push(`backlog-regressão: atlas-backlog-generator não cita '${token}'`);
    }
  }
}
if (orchestratorSkill != null) {
  for (const token of ['routing.document_flow.priority = backlog_first', 'atlas-backlog-generator', 'atlas_verify_backlog_index', 'atlas_select_next_sprint', 'atlas_update_sprint_status', 'Não gerar PRD direto do macro input']) {
    if (!orchestratorSkill.includes(token)) {
      errors.push(`backlog-regressão: orquestrador não cita '${token}'`);
    }
  }
}

const sprintTemplate = read('packages/templates/SPRINT_TEMPLATE.md');
if (sprintTemplate != null) {
  for (const token of ['eval_manifest:', 'policy_manifest:', 'Evidence-to-claim', 'Backlog mestre', 'State / evidência']) {
    if (!sprintTemplate.includes(token)) {
      errors.push(`sprint-template-regressão: SPRINT_TEMPLATE.md não contém '${token}'`);
    }
  }
}
const documentQuality = read('packages/skills/_shared/scripts/document_quality.mjs');
if (documentQuality != null) {
  for (const token of ['validateSprintFileConformance', 'sprint_file:', 'state_file:', 'policy_manifest']) {
    if (!documentQuality.includes(token)) {
      errors.push(`sprint-harness-regressão: document_quality.mjs não contém '${token}'`);
    }
  }
}
const mcpServer = read('packages/mcp-server/server.js');
if (mcpServer != null) {
  for (const token of ['atlas_verify_sprint_file', 'verifySprintFile', 'sprint_file_conformance', 'atlas_verify_backlog_index', 'atlas_select_next_sprint', 'atlas_update_sprint_status', 'verifyBacklogIndex', 'selectNextSprint', 'updateSprintStatus', 'require_sprint_file', 'eval_results', 'evidence_to_claim', 'policy_scope']) {
    if (!mcpServer.includes(token)) {
      errors.push(`sprint-harness-regressão: server.js não contém '${token}'`);
    }
  }
}
const stateSchema = read('packages/templates/STATE_FILE_SCHEMA.md');
if (stateSchema != null) {
  for (const token of ['sprint_file_path', 'eval_results', 'evidence_to_claim', 'policy_scope']) {
    if (!stateSchema.includes(token)) {
      errors.push(`state-schema-regressão: STATE_FILE_SCHEMA.md não contém '${token}'`);
    }
  }
}

// Codex custom agents não podem depender apenas do bundle do plugin: o instalador
// precisa copiar os atlas-*.toml para CODEX_HOME/agents, que é o caminho nativo que
// `spawn_agent(agent_type)` carrega. Regressão aqui volta ao erro `unknown agent_type`.
const atlasInit = read('build/cli/atlas-init.mjs');
if (atlasInit != null) {
  for (const token of ['CODEX_HOME', "'.codex'", "'agents'", "['.toml']", 'copyAtlasAgents(srcAgents, agentsDir']) {
    if (!atlasInit.includes(token)) {
      errors.push(`Codex agent install-regressão: atlas-init.mjs não contém '${token}'`);
    }
  }
}
const smokeInstall = read('build/smoke-install.mjs');
if (smokeInstall != null) {
  for (const token of ['makeCodexMock', 'CODEX_HOME', 'agents/atlas-plan-execute.toml', 'sem model pinado']) {
    if (!smokeInstall.includes(token)) {
      errors.push(`Codex smoke-regressão: smoke-install.mjs não cobre '${token}'`);
    }
  }
}

if (errors.length) {
  console.error('check-consistency: FALHOU');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(3);
}
console.log('check-consistency: ok (validator sincronizado cross-host; catálogos opencode/pi presentes+versão; skills sem hardcode; sem regressão A1/A2)');
