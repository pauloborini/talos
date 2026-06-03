#!/usr/bin/env node
// Gera o arquivo de subagente de um host a partir do agente canônico Claude
// (agents/atlas-task-validator.md), preservando o CORPO (system prompt + contrato
// de veredito) e trocando só o frontmatter para o formato do host. Fonte única do
// corpo → sem drift do contrato do validator entre hosts (guard S10 verifica).
//
// Uso: node build/gen-host-agent.mjs <host> <out-file>
//   host: opencode | pi
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , host, outFile] = process.argv;

if (!host || !outFile) {
  console.error('uso: node build/gen-host-agent.mjs <host> <out-file>');
  process.exit(2);
}

const canonical = fs.readFileSync(path.join(ROOT, 'agents/atlas-task-validator.md'), 'utf8');
const fm = canonical.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!fm) {
  console.error('agente canônico sem frontmatter reconhecível');
  process.exit(3);
}
const frontmatter = fm[1];
const body = fm[2];
const get = (key) => (frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
const name = get('name') || 'atlas-task-validator';
const description = get('description') || '';

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
} else if (host === 'pi') {
  // pi: subagente via extensão pi-subagents — frontmatter name + description + tools.
  // tools read-only (read/grep/find/ls/bash, sem write/edit): casa com o contrato do
  // validator (lê código e roda checagens, nunca corrige). Sem write/edit por design.
  // model omitido de propósito: pi-subagents herda o modelo default do host.
  header = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'tools: read, grep, find, ls, bash',
    '---',
  ].join('\n');
} else {
  console.error(`host desconhecido: ${host}`);
  process.exit(2);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${header}\n${body}`, 'utf8');
console.log(`gerado: ${path.relative(ROOT, outFile)} (host=${host})`);
