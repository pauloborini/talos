// Ledger MCP de rastreabilidade opt-in `traceability v1` (Guide
// RASTREABILIDADE_MCP_GUIDE, Plano 01).
//
// Regras de produto aplicadas (INTENT D1-D3, D5, D6, D11, D12, D15; INV1, INV6):
// - LEDGER em `.talos/traceability/<slug>.json`, slug = basename do backlog sem
//   extensão (D5: zero coluna nova no índice Markdown; D2: zero hook).
// - Escrita ABSOLUTA do documento completo: a tool monta a lista final
//   (schema + reqs + sprints + pilot_metrics) antes de gravar — chave omitida
//   some do disco (mesma disciplina de `upsertRunState`).
// - `upsert` é insert-or-update pela chave `id`: o payload validado vira o
//   estado inteiro do REQ. Mesmo id atualiza disposition/reason/target/links/
//   sources (D1/D12). Duplicata DENTRO do mesmo write recusa, disco intacto.
// - `external` exige `ref` não vazio (D11/INV6); `deferred` exige motivo +
//   `deferred_target.type` ∈ {sprint (id Sxx), backlog_candidate (name não
//   vazio)}; `rejected` exige motivo (INV1).
// - IO tmp+rename com mode 0o600 (análogo a upsertRunState, server.js).
// - `verify` (Plano 02): destinos/ids + cruzamento com source_refs do §7.3 via
//   `checkTraceabilityGraph` (mesma função pura do conformance — CN4/INV2).
import fs from 'node:fs';
import path from 'node:path';
// Plano 02: a regra do grafo v1 REQ↔AC mora numa única função pura no parser de
// sprint (evita duplicar a regra entre conformance e verify — D4/D13).
import { checkTraceabilityGraph, parseAcceptanceContract } from '../skills/_shared/scripts/document_quality.mjs';

export const TRACEABILITY_SCHEMA_VERSION = 'traceability_v1';

const LEDGER_REL_DIR = path.join('.talos', 'traceability');
const REQ_ID_REGEX = /^REQ-\d+$/;
const SPRINT_ID_REGEX = /^S\d{2}(?:[a-z]|\.\d+)?$/;
const SOURCE_KINDS = new Set(['talos', 'external']);
const DISPOSITIONS = new Set(['included', 'deferred', 'rejected']);
const DEFERRED_TARGET_TYPES = new Set(['sprint', 'backlog_candidate']);

/** Erro determinístico de validação/estado — mesmo contrato de rpcError do server. */
export function traceabilityError(message, code = -32602) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function ledgerRoot(args) {
  const explicit = args?.project_root;
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit);
  return path.resolve(process.cwd());
}

/** Path absoluto do ledger: `<root>/.talos/traceability/<slug>.json`. */
export function traceabilityLedgerPath(backlogPath, root) {
  if (typeof backlogPath !== 'string' || backlogPath.trim() === '') {
    throw traceabilityError('backlog_path obrigatório');
  }
  const slug = path.basename(backlogPath).replace(/\.md$/i, '');
  if (!slug) throw traceabilityError(`backlog_path inválido: ${backlogPath}`);
  return path.join(root, LEDGER_REL_DIR, `${slug}.json`);
}

/** Documento inicial vazio (escrita absoluta: primeiro upsert cria o todo). */
export function emptyTraceabilityLedger() {
  return {
    schema: TRACEABILITY_SCHEMA_VERSION,
    reqs: {},
    sprints: {},
    pilot_metrics: [],
  };
}

/** Leitura defensiva: shape mínimo validado; arquivo ausente = documento vazio. */
export function readTraceabilityLedger(backlogPath, root) {
  const ledgerPath = traceabilityLedgerPath(backlogPath, root);
  if (!fs.existsSync(ledgerPath)) return emptyTraceabilityLedger();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (cause) {
    throw traceabilityError(`Ledger ilegível em ${path.relative(root, ledgerPath)}: ${cause.message}`, -32003);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== TRACEABILITY_SCHEMA_VERSION) {
    throw traceabilityError(
      `Ledger inválido em ${path.relative(root, ledgerPath)}: schema não é ${TRACEABILITY_SCHEMA_VERSION}`,
      -32003,
    );
  }
  return {
    schema: TRACEABILITY_SCHEMA_VERSION,
    reqs: parsed.reqs && typeof parsed.reqs === 'object' && !Array.isArray(parsed.reqs)
      ? parsed.reqs : {},
    sprints: parsed.sprints && typeof parsed.sprints === 'object' && !Array.isArray(parsed.sprints)
      ? parsed.sprints : {},
    pilot_metrics: Array.isArray(parsed.pilot_metrics) ? parsed.pilot_metrics : [],
  };
}

/** Escrita absoluta do documento completo (tmp+rename, mode 0o600 — como run_state). */
export function writeTraceabilityLedger(ledger, backlogPath, root) {
  const ledgerPath = traceabilityLedgerPath(backlogPath, root);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const tmp = `${ledgerPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, ledgerPath);
  return ledgerPath;
}

/**
 * Validação de um REQ (INV1 + INV6 + shape). Lança `traceabilityError` e nada
 * grava. `deferred` exige `reason` + `deferred_target` tipado (sprint → id Sxx;
 * backlog_candidate → name não vazio); `rejected` exige `reason`; `external`
 * exige `ref` não vazio. Campos fora do enum citados são recusados; campos
 * aditivos (ex.: links N:N do Plano 02) passam intactos no payload validado.
 */
export function validateRequirement(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    throw traceabilityError('req inválido: esperado objeto');
  }
  const { id } = req;
  if (typeof id !== 'string' || !REQ_ID_REGEX.test(id)) {
    throw traceabilityError(`id de REQ inválido: ${id ?? '<ausente>'} (esperado REQ-\\d+)`);
  }
  const sources = req.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw traceabilityError(`REQ ${id} sem sources[]`);
  }
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw traceabilityError(`REQ ${id}: source inválido (esperado objeto {kind, ref?})`);
    }
    if (!SOURCE_KINDS.has(source.kind)) {
      throw traceabilityError(`REQ ${id}: kind de source fora do enum (talos|external): ${source.kind ?? '<ausente>'}`);
    }
    if (source.kind === 'external' && (typeof source.ref !== 'string' || source.ref.trim() === '')) {
      throw traceabilityError(`REQ ${id}: fonte externa exige ref não vazio (path ou URI registrada)`);
    }
  }
  const { disposition } = req;
  if (typeof disposition !== 'string' || !DISPOSITIONS.has(disposition)) {
    throw traceabilityError(`REQ ${id}: disposition fora do enum (included|deferred|rejected): ${disposition ?? '<ausente>'}`);
  }
  if (disposition === 'deferred') {
    if (typeof req.reason !== 'string' || req.reason.trim() === '') {
      throw traceabilityError(`REQ ${id}: deferred exige reason não vazio`);
    }
    const target = req.deferred_target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw traceabilityError(`REQ ${id}: deferred exige deferred_target tipado`);
    }
    if (!DEFERRED_TARGET_TYPES.has(target.type)) {
      throw traceabilityError(`REQ ${id}: deferred_target.type fora do enum (sprint|backlog_candidate): ${target.type ?? '<ausente>'}`);
    }
    if (target.type === 'sprint') {
      if (typeof target.id !== 'string' || !SPRINT_ID_REGEX.test(target.id)) {
        throw traceabilityError(`REQ ${id}: deferred sprint exige deferred_target.id Sxx (ex.: S02)`);
      }
    } else if (typeof target.name !== 'string' || target.name.trim() === '') {
      throw traceabilityError(`REQ ${id}: deferred backlog_candidate exige deferred_target.name não vazio`);
    }
  }
  if (disposition === 'rejected' && (typeof req.reason !== 'string' || req.reason.trim() === '')) {
    throw traceabilityError(`REQ ${id}: rejected exige reason não vazio`);
  }
}

/**
 * Aplica upsert(s) de REQ sobre o ledger em memória e devolve o documento FINAL
 * completo (escrita absoluta do caller). Ids duplicados dentro do mesmo write
 * recusam; id já existente é substituído pelo payload validado (update).
 */
export function applyRequirementUpsert(ledger, reqs) {
  if (!Array.isArray(reqs) || reqs.length === 0) {
    throw traceabilityError('upsert exige reqs[] não vazio');
  }
  const seen = new Set();
  const nextReqs = { ...ledger.reqs };
  for (const req of reqs) {
    validateRequirement(req);
    if (seen.has(req.id)) {
      throw traceabilityError(`REQ duplicado no mesmo write: ${req.id}`);
    }
    seen.add(req.id);
    nextReqs[req.id] = { ...req };
  }
  return {
    schema: ledger.schema,
    reqs: nextReqs,
    sprints: ledger.sprints,
    pilot_metrics: ledger.pilot_metrics,
  };
}

/**
 * Aplica (ou atualiza) o marcador v1 de uma sprint no ledger: `sprints[id] = {schema}`.
 * O par com o metadado `Traceability` da sprint é o que o conformance exige (INV3).
 */
export function applySprintMarker(ledger, sprint) {
  if (!sprint || typeof sprint !== 'object' || Array.isArray(sprint)) {
    throw traceabilityError('sprint inválido: esperado objeto {sprint_id, schema}');
  }
  if (typeof sprint.sprint_id !== 'string' || !SPRINT_ID_REGEX.test(sprint.sprint_id)) {
    throw traceabilityError(`sprint_id inválido: ${sprint.sprint_id ?? '<ausente>'} (esperado Sxx)`);
  }
  if (sprint.schema !== TRACEABILITY_SCHEMA_VERSION) {
    throw traceabilityError(`schema de sprint inválido: ${sprint.schema ?? '<ausente>'} (esperado ${TRACEABILITY_SCHEMA_VERSION})`);
  }
  return {
    schema: ledger.schema,
    reqs: ledger.reqs,
    sprints: { ...ledger.sprints, [sprint.sprint_id]: { schema: sprint.schema } },
    pilot_metrics: ledger.pilot_metrics,
  };
}

/**
 * Verify do Plano 02 (CN4/INV2): além dos destinos/divs do Plano 01, cruza o
 * grafo com `source_refs` dos ACs quando `acceptanceItems` é fornecido (mesma
 * função pura do conformance). `sprintId` habilita o sentido inverso (REQ
 * included atribuído à sprint sem AC). `status` reflete o veredito do report;
 * nunca afirma cobertura quando há buracos.
 */
export function verifyTraceability(ledger, { acceptanceItems = null, sprintId = null } = {}) {
  const reqs = ledger?.reqs && typeof ledger.reqs === 'object' && !Array.isArray(ledger.reqs)
    ? ledger.reqs : {};
  const gaps = [];
  const seen = new Set();
  for (const [id, req] of Object.entries(reqs)) {
    if (seen.has(id)) gaps.push({ req: id, problem: 'id_duplicado_no_ledger' });
    seen.add(id);
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      gaps.push({ req: id, problem: 'req_invalido' });
      continue;
    }
    if (typeof req.disposition !== 'string' || !DISPOSITIONS.has(req.disposition)) {
      gaps.push({ req: id, problem: 'disposition_ausente_ou_invalida' });
      continue;
    }
    if (req.disposition === 'deferred') {
      if (typeof req.reason !== 'string' || req.reason.trim() === '') {
        gaps.push({ req: id, problem: 'deferred_sem_reason' });
      }
      const target = req.deferred_target;
      if (!target || typeof target !== 'object' || Array.isArray(target)
        || !DEFERRED_TARGET_TYPES.has(target.type)) {
        gaps.push({ req: id, problem: 'deferred_sem_target_tipado' });
      }
    }
    if (req.disposition === 'rejected'
      && (typeof req.reason !== 'string' || req.reason.trim() === '')) {
      gaps.push({ req: id, problem: 'rejected_sem_reason' });
    }
  }
  if (Array.isArray(acceptanceItems)) {
    const graph = checkTraceabilityGraph({ acceptanceItems, ledger, sprintId });
    for (const issue of graph.issues) {
      gaps.push({
        req: issue.req ?? issue.ac ?? '<desconhecido>',
        problem: issue.kind,
        ...(issue.ac ? { ac: issue.ac } : {}),
      });
    }
  }
  return {
    valid: gaps.length === 0,
    req_count: Object.keys(reqs).length,
    gaps,
    status: gaps.length === 0 ? 'passed' : 'failed',
  };
}

/**
 * Handler da tool `talos_traceability` (registrado no dispatch do server.js).
 * Actions deste plano: `upsert` (grava documento completo) e `verify` (mínimo).
 * `receipt`/`record_metric` chegam no Plano 03.
 */
export function traceabilityHandler(args = {}) {
  const root = ledgerRoot(args);
  const backlogPath = args.backlog_path;
  if (typeof backlogPath !== 'string' || backlogPath.trim() === '') {
    throw traceabilityError('backlog_path obrigatório');
  }
  const action = args.action ?? 'upsert';
  if (action === 'upsert') {
    const hasReq = args.reqs !== undefined;
    const hasSprint = args.sprint !== undefined;
    if (!hasReq && !hasSprint) {
      throw traceabilityError('upsert exige reqs[] e/ou sprint');
    }
    let next = readTraceabilityLedger(backlogPath, root);
    if (hasReq) next = applyRequirementUpsert(next, args.reqs);
    if (hasSprint) next = applySprintMarker(next, args.sprint);
    const ledgerPath = writeTraceabilityLedger(next, backlogPath, root);
    return {
      action: 'upsert',
      backlog_path: backlogPath,
      ledger_path: path.relative(root, ledgerPath),
      document: next,
    };
  }
  if (action === 'verify') {
    const ledger = readTraceabilityLedger(backlogPath, root);
    const options = {};
    if (typeof args.sprint_path === 'string' && args.sprint_path.trim() !== '') {
      // Plano 02 (CN4/INV2): cruza source_refs do §7.3 da sprint com o ledger.
      // `sprint_id` explícito tem precedência; fallback: metadado Sprint ID.
      const sprintAbsolute = path.resolve(root, args.sprint_path);
      if (!fs.existsSync(sprintAbsolute)) {
        throw traceabilityError(`Sprint file não encontrado: ${args.sprint_path}`, -32002);
      }
      let markdown;
      try {
        markdown = fs.readFileSync(sprintAbsolute, 'utf8');
      } catch (cause) {
        throw traceabilityError(`Sprint file ilegível: ${args.sprint_path}: ${cause.message}`, -32003);
      }
      options.acceptanceItems = parseAcceptanceContract(markdown) ?? [];
      options.sprintId = (typeof args.sprint_id === 'string' && args.sprint_id.trim() !== '')
        ? args.sprint_id
        : (/^\|\s*Sprint ID\s*\|\s*(S\d{2}(?:[a-z]|\.\d+)?)\s*\|/im.exec(markdown)?.[1] ?? null);
    }
    const report = verifyTraceability(ledger, options);
    return {
      action: 'verify',
      backlog_path: backlogPath,
      schema: ledger.schema,
      ...report,
    };
  }
  throw traceabilityError(`Ação inválida para talos_traceability: ${action}`);
}