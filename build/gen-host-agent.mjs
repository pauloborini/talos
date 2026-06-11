#!/usr/bin/env node
// Gera o arquivo de subagente de um host a partir do agente canônico Claude
// (agents/<name>.md), preservando o CORPO (system prompt / shim) e trocando só o
// frontmatter para o formato do host. Fonte única do corpo → sem drift entre hosts
// (guard check-consistency verifica existência + alvo do shim).
//
// O nome do agente é derivado do basename do <out-file> (ex.: atlas-plan-execute.md
// → agents/atlas-plan-execute.md como canônico).
//
// Uso: node build/gen-host-agent.mjs <host> <out-file>
//   host: codex | opencode | pi
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , host, outFile] = process.argv;

if (!host || !outFile) {
  console.error('uso: node build/gen-host-agent.mjs <host> <out-file>');
  process.exit(2);
}

const agentName = path.basename(outFile).replace(/\.(md|toml)$/u, '');
const canonicalPath = path.join(ROOT, `agents/${agentName}.md`);
if (!fs.existsSync(canonicalPath)) {
  console.error(`agente canônico ausente: agents/${agentName}.md`);
  process.exit(3);
}
const canonical = fs.readFileSync(canonicalPath, 'utf8');
const fm = canonical.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!fm) {
  console.error(`agente canônico sem frontmatter reconhecível: ${agentName}`);
  process.exit(3);
}
const frontmatter = fm[1];
const body = fm[2];
const get = (key) => (frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
const name = get('name') || agentName;
const description = get('description') || '';

// Tools do pi por agente (pi-subagents lista tools no frontmatter).
//  - validator/review: read-only (lê código e roda checagens, nunca corrige/despacha).
//  - executores (plan/direct): write/edit para mutar código.
// NÃO listar `subagent` aqui: no pi essa tool é ambiente (provida pelo pi-subagents) e
// listá-la explicitamente faz o agente FALHAR no load ("Failed to load extension
// pi-subagents/..."). Confirmado em smoke real: agentes com `subagent` em tools não
// carregam; o validator (read-only, sem `subagent`) carrega e despacha normalmente. O
// executor dispara o validador frio (Gate G4) usando a tool ambiente, sem declará-la.
// model omitido: pi-subagents herda o default do host. opencode NÃO lista tools (herda
// do host por convenção do repo) — o SKILL.md governa read-only vs executor.
const PI_TOOLS = {
  'atlas-task-validator': 'read, grep, find, ls, bash',
  'atlas-findings-repair': 'read, write, edit, grep, find, ls, bash',
  'atlas-slice-review': 'read, grep, find, ls, bash',
  'atlas-plan-execute': 'read, write, edit, grep, find, ls, bash',
  'atlas-direct-execute': 'read, write, edit, grep, find, ls, bash',
};

let header;
if (host === 'opencode') {
  // opencode: .opencode/agents/<name>.md — frontmatter description + mode: subagent.
  header = [
    '---',
    `description: ${description}`,
    'mode: subagent',
    'temperature: 0.1',
    '---',
  ].join('\n');
} else if (host === 'codex') {
  // Codex: .codex/agents/<name>.toml custom agents. Keep the canonical shim body
  // as developer_instructions; Codex loads custom agents as spawned sessions.
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(body.trim())}`,
  ];
  header = lines.join('\n');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${header}\n`, 'utf8');
  console.log(`gerado: ${path.relative(ROOT, outFile)} (host=${host})`);
  process.exit(0);
} else if (host === 'pi') {
  // pi: subagente via extensão pi-subagents — frontmatter name + description + tools.
  const tools = PI_TOOLS[name] || 'read, grep, find, ls, bash';
  header = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `tools: ${tools}`,
    '---',
  ].join('\n');
  // pi NÃO tem loader de skills nativo no contexto de subagente: o shim fino dos
  // executores/review ("carregue o SKILL.md") não tem como carregar o contrato e o
  // executor falha antes do Gate G4 (confirmado em smoke real). O validator já é
  // auto-contido (corpo canônico = contrato). Para os 3 shims, EMBUTIR o SKILL.md
  // canônico no corpo gerado (mesmo padrão auto-contido), mantendo fonte única:
  // o contrato continua vivendo só em packages/skills/<name>/SKILL.md; aqui é cópia
  // gerada (regenerável), nunca editada à mão.
  const PI_EMBED_SHIMS = new Set(['atlas-plan-execute', 'atlas-direct-execute', 'atlas-slice-review', 'atlas-findings-repair']);
  let piBody = body;
  if (PI_EMBED_SHIMS.has(name)) {
    const skillPath = path.join(ROOT, `packages/skills/${name}/SKILL.md`);
    if (!fs.existsSync(skillPath)) {
      console.error(`SKILL.md ausente para embed pi: packages/skills/${name}/SKILL.md`);
      process.exit(3);
    }
    const skillRaw = fs.readFileSync(skillPath, 'utf8');
    const skillBody = skillRaw.replace(/^---\n[\s\S]*?\n---\n/u, '').trim();
    // Remove a instrução "use o mecanismo nativo de skills" (inexistente no pi) e
    // aponta para o contrato embutido logo abaixo, evitando contradição no corpo.
    piBody = body.replace(
      /^- \*\*Outros hosts:\*\*.*$/mu,
      '- **pi (sem loader de skills):** o contrato completo está embutido abaixo (seção "Contrato completo da skill"); siga-o integralmente como se fosse o `SKILL.md` carregado.',
    );
    piBody += `\n\n---\n\n## Contrato completo da skill (embutido — fonte única: \`packages/skills/${name}/SKILL.md\`, gerado por build/gen-host-agent.mjs; não editar à mão)\n\n${skillBody}\n`;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${header}\n${piBody}`, 'utf8');
  console.log(`gerado: ${path.relative(ROOT, outFile)} (host=${host})`);
  process.exit(0);
} else {
  console.error(`host desconhecido: ${host}`);
  process.exit(2);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${header}\n${body}`, 'utf8');
console.log(`gerado: ${path.relative(ROOT, outFile)} (host=${host})`);
