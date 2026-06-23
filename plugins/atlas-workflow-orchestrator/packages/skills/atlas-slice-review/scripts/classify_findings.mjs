#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SEVERITY_ORDER = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
export const REQUIRED_TEXT_FIELDS = Object.freeze([
  'task_id', 'title', 'file', 'failure_mode', 'evidence', 'recommendation', 'fix_validation',
]);

export function normalizeFinding(finding, index) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    throw new Error(`Finding ${index} must be a JSON object`);
  }
  if (!(finding.severity in SEVERITY_ORDER)) {
    throw new Error(`Finding ${index} has invalid severity: ${JSON.stringify(finding.severity)}`);
  }
  const missing = REQUIRED_TEXT_FIELDS.filter(
    (field) => typeof finding[field] !== 'string' || !finding[field].trim(),
  );
  if (missing.length) throw new Error(`Finding ${index} missing required fields: ${missing.join(', ')}`);
  if (!Number.isInteger(finding.line) || finding.line < 1) {
    throw new Error(`Finding ${index} has invalid line: ${JSON.stringify(finding.line)}`);
  }
  return {
    severity: finding.severity,
    task_id: finding.task_id,
    title: finding.title,
    file: finding.file,
    line: finding.line,
    summary: typeof finding.summary === 'string' ? finding.summary : '',
    failure_mode: finding.failure_mode,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
    fix_validation: finding.fix_validation,
    diff_attributed: finding.diff_attributed !== false,
  };
}

export function classifyFindings(payload) {
  if (!Array.isArray(payload)) throw new Error('Findings input must be a JSON array');
  return payload.map(normalizeFinding).sort((a, b) => (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      || a.task_id.localeCompare(b.task_id)
      || a.file.localeCompare(b.file)
      || a.line - b.line
  ));
}

export function run(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('Usage: node classify_findings.mjs <findings.json>');
  const payload = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
  process.stdout.write(`${JSON.stringify(classifyFindings(payload), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { run(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
