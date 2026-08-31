#!/usr/bin/env node
// Gate de presença das fixtures §9 da proposta v0.15.0 (itens 1–8) na suíte.
// Determinístico, sem LLM/API: lê `packages/mcp-server/server.test.js` do disco
// e exige que cada fixture red/green declarada na proposta exista como teste
// nomeado — o comportamento é exercitado pela própria suite (server.test.js roda
// em `build/test-all.sh`); este gate garante que nenhum item §9 fique órfão da
// coleta sem acusar (AC-7.1.2: falseia se fixture §9 ausente da suíte).
//
// Item 9 (§9) — build/consistência/packaging dos oito hosts — é a própria
// pipeline `build/test-all.sh` (build-plugins + smoke-hosts + conformance-matrix
// + smoke-install + checksums + check-consistency), executada no gate agregado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUITE_REL = 'packages/mcp-server/server.test.js';
const suite = fs.readFileSync(path.join(ROOT, SUITE_REL), 'utf8');

// Itens 1–8 da proposta §9 → âncoras (nomes exatos de teste em server.test.js).
const FIXTURES = [
  {
    item: 1,
    label: 'AC-* ausente/duplicado/sem evidência/tipo inválido ou EVAL órfão → falha no sprint file',
    anchors: [
      'validateSprintFileConformance: sem bloco acceptance → pendência aceite (AC-1.2.3)',
      'validateSprintFileConformance: EVAL órfão (sem AC) → pendência hierarquia AC⊃EVAL (AC-1.1.2)',
      'validateSprintFileConformance: contrato §7 completo → valid:true (AC-1.2.1)',
    ],
  },
  {
    item: 2,
    label: 'T-outcome: exercita sem assert → unproved; asserta retorno/efeito → proved',
    anchors: [
      'AC-2.2.1: proof_ref a teste sem assert de outcome → AC status unproved',
      'AC-2.2.2: proof_ref a teste com assert de retorno/efeito → proved',
      'talos_lock_validator complete: sprint_file_path exige acceptance_results (VC5 sink)',
    ],
  },
  {
    item: 3,
    label: 'manual_validation_pending só com provas auto verdes + M válido',
    anchors: [
      'AC-2.2.1 complementar: provas auto verdes + M aberto → manual_pending',
      'talos_update_sprint_status: manual_validation_pending exige validator terminal e acceptance_results',
    ],
  },
  {
    item: 4,
    label: 'Relatório inválido, item não declarado, waiver sem justificativa, escrita concorrente → falha sem drift',
    anchors: [
      'talos_sync_manual_validation: relatório inválido bloqueia sem drift (fix_manual_validation_report)',
      'talos_sync_manual_validation: item fantasma sem AC correspondente no §7.3 bloqueia (AC-4.1.2)',
      'talos_sync_manual_validation: waiver sem justificativa bloqueia (AC-4.1.1)',
      'talos_sync_manual_validation: lock por backlog bloqueia sync concorrente (D15)',
    ],
  },
  {
    item: 5,
    label: 'MVP satisfaz DEP; M falho liga flag no cone; correção libera execução, não done sem revalidação',
    anchors: [
      'manual_validation_pending satisfaz DEP e não emite handoff (CN2)',
      'M failed liga revalidation_required no cone (CN4 / AC-5.2.1)',
      'update_sprint_status: done bloqueado com revalidation_required ligada (AC-5.1.2)',
      'talos_select_next_sprint: flag revalidation_required não exclui candidata (AC-5.2.2)',
    ],
  },
  {
    item: 6,
    label: 'Review crítica P0/P1: repair → validator → nova review; falha mantém bloqueio',
    anchors: [
      'orquestrador SKILL G8: critical_review.required:true exige slice-review ANTES de talos_update_sprint_status (AC-6.1.2 / CN5 sink)',
      'requiresCriticalReview/parseCriticalReview: parse determinístico do policy_manifest (AC-6.1.2 helper)',
    ],
  },
  {
    item: 7,
    label: 'Smoke resolvido não deixa relatório vazio; mudança em AC/impact path reabre só o item afetado',
    anchors: [
      'talos_sync_manual_validation: sync parcial mantém MVP e relatório com pendências abertas (D12)',
      'sync manual validated promove done (AC-4.2.1 / CN3)',
      'sync com M failed na origem e M validated no dependente: dependente done limpa a flag no mesmo sync (CN3 x CN4)',
    ],
  },
  {
    item: 8,
    label: 'update_sprint_status(MVP) não emite handoff; done emite',
    anchors: [
      'talos_update_sprint_status: manual_validation_pending com M pendente não emite handoff (AC-3.1.2)',
      'update_sprint_status done emite handoff quando AC proved sem M (AC-3.2.1 / CN1)',
    ],
  },
];

for (const { item, label, anchors } of FIXTURES) {
  test(`proposta §9 item ${item}: ${label}`, () => {
    for (const anchor of anchors) {
      assert.ok(
        suite.includes(`test('${anchor}'`) || suite.includes(`test("${anchor}"`),
        `fixture §9 ausente da suíte (${SUITE_REL}): "${anchor}"`,
      );
    }
  });
}
