#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const RUN_DIR = path.join('.atlas', 'state');
const BLOCK = 2;
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PLAN_ARTIFACT_RE = /(^|[/\\])PLAN_[^/\\]+\.md$/;
const READ_ONLY_BASH_RE = /^\s*(pwd|ls|find|rg|grep|sed|cat|head|tail|wc|stat|git\s+(status|diff|show|log|rev-parse|ls-files)|node\s+--version|npm\s+--version)(\s+[^;&|<>]*)?\s*$/;
const MUTATING_BASH_RE = /\b(apply_patch|rm|mv|cp|mkdir|touch|tee|git\s+(add|commit|push|checkout|switch|reset|merge|rebase)|npm\s+(install|ci|run)|pnpm\s+(install|run)|yarn\s+(install|run)|python3?\b.*\b(open|write_text|unlink|rename)|dart\s+format|flutter\s+test|build\/build-plugins\.sh)\b|[;&|<>]/;

function block(message, details = {}) {
  const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : '';
  process.stderr.write(`Atlas Workflow hook blocked.\n${message}${suffix}\n`);
  process.exit(BLOCK);
}

function readStdinJson() {
  const input = fs.readFileSync(0, 'utf8').trim();
  if (!input) return {};
  try {
    return JSON.parse(input);
  } catch {
    block('Estado do hook ilegivel. Proxima acao: reexecutar com payload JSON valido ou desativar o backstop opcional.');
  }
}

function candidateCwd(payload) {
  return payload.cwd || payload.workspace || payload.project_dir || process.cwd();
}

function readLatestState(cwd) {
  const dir = path.resolve(cwd, RUN_DIR);
  if (!fs.existsSync(dir)) return { active: false };

  let files;
  try {
    files = fs.readdirSync(dir)
      .map((name) => path.join(dir, name, 'run.json'))
      .filter((file) => fs.existsSync(file));
  } catch {
    block('Nao foi possivel ler .atlas/state. Estado nao comprovado; hook nao aprova implicitamente.');
  }

  if (files.length === 0) return { active: false };

  let latest = null;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { file, mtimeMs: stat.mtimeMs };
    } catch {
      block('Nao foi possivel inspecionar estado .atlas/state. Estado nao comprovado; hook nao aprova implicitamente.', { file });
    }
  }

  try {
    const state = JSON.parse(fs.readFileSync(latest.file, 'utf8'));
    if (!state?.data?.routing) return { active: false };
    return { active: true, file: latest.file, state };
  } catch {
    block('Estado .atlas/state corrompido ou ilegivel. Proxima acao: recuperar o estado MCP antes de continuar.', { file: latest.file });
  }
}

function toolName(payload) {
  return payload.tool_name || payload.tool?.name || payload.name || '';
}

function toolInput(payload) {
  return payload.tool_input || payload.input || payload.params || {};
}

function writePath(input) {
  return input.file_path || input.path || input.notebook_path || '';
}

function isPlanArtifact(input) {
  const target = writePath(input);
  return target && PLAN_ARTIFACT_RE.test(target);
}

function isMutatingBash(command) {
  if (!command) return false;
  if (MUTATING_BASH_RE.test(command)) return true;
  return !READ_ONLY_BASH_RE.test(command);
}

function assertPreToolUse(payload, context) {
  if (!context.active) return;

  const { state } = context;
  const routing = state.data.routing || {};
  const dispatch = state.data.dispatch || {};
  const tool = toolName(payload);
  const input = toolInput(payload);
  const command = input.command || '';
  const mutatingTool = MUTATING_TOOLS.has(tool) || (tool === 'Bash' && isMutatingBash(command));

  if (!mutatingTool) return;

  if (routing.mode === 'full' && !dispatch.plan_validated && !isPlanArtifact(input)) {
    block('G2/S11: escrita antes de PLAN validado em modo full. Proxima acao: despachar/validar plan_handoff; nao escrever produto agora.', {
      run_id: state.run_id,
      tool,
      current_phase: dispatch.active?.phase || null,
      next_action: dispatch.next_action || 'dispatch_plan_handoff',
      source: context.file,
    });
  }

  if (dispatch.active?.phase === 'plan_handoff' && isPlanArtifact(input)) return;
  if (!dispatch.active?.phase && dispatch.next_phase === 'plan_handoff' && isPlanArtifact(input)) return;

  if (dispatch.active?.phase && dispatch.active.phase !== 'plan_execute') {
    block('G9/S11: acao mutante enquanto orquestrador deve coordenar fase despachada. Proxima acao: aguardar ou concluir fase ativa via MCP.', {
      run_id: state.run_id,
      tool,
      active_phase: dispatch.active.phase,
      next_action: `complete_${dispatch.active.phase}`,
      source: context.file,
    });
  }

  if (!dispatch.active?.phase && dispatch.next_phase && dispatch.next_phase !== 'plan_execute') {
    block('G9/S11: acao mutante fora da fase executora. Proxima acao: despachar a fase esperada pelo MCP.', {
      run_id: state.run_id,
      tool,
      expected_phase: dispatch.next_phase,
      next_action: dispatch.next_action || `dispatch_${dispatch.next_phase}`,
      source: context.file,
    });
  }
}

function blockedGate(state) {
  const gates = state.data?.gates || {};
  return Object.entries(gates).find(([, value]) => value?.status === 'blocked');
}

function assertStop(context) {
  if (!context.active) return;

  const { state } = context;
  const routing = state.data.routing || {};
  const dispatch = state.data.dispatch || {};
  const blocked = blockedGate(state);

  if (dispatch.active?.phase) {
    block('S11 Stop: encerramento bloqueado com fase ativa. Proxima acao: concluir ou abortar a fase via MCP.', {
      run_id: state.run_id,
      active_phase: dispatch.active.phase,
      next_action: `complete_${dispatch.active.phase}`,
      source: context.file,
    });
  }

  if (routing.mode === 'full' && dispatch.plan_validated && !dispatch.execution_completed) {
    block('G11/S11 Stop: full nao pode encerrar apos plano validado sem execucao. Proxima acao: dispatch_plan_execute_blocking.', {
      run_id: state.run_id,
      current_phase: dispatch.previous_phase || null,
      expected_phase: 'plan_execute',
      source: context.file,
    });
  }

  if (blocked) {
    block('S11 Stop: gate bloqueado nao pode virar sucesso. Proxima acao: resolver gate MCP antes de concluir.', {
      run_id: state.run_id,
      gate: blocked[0],
      next_action: blocked[1]?.next_action || 'corrigir_gate',
      source: context.file,
    });
  }
}

const event = process.argv[2];
const payload = readStdinJson();
const context = readLatestState(candidateCwd(payload));

if (event === 'pre-tool-use') {
  assertPreToolUse(payload, context);
} else if (event === 'stop') {
  assertStop(context);
} else {
  block('Evento de hook desconhecido. Use pre-tool-use ou stop.', { event });
}
