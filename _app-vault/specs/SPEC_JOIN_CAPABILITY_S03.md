# SPEC_JOIN_CAPABILITY_S03 — Contrato de join síncrono por host

> **Documento canônico do contrato de join síncrono.** Fonte de verdade para S06 (preflight hard-fail).
>
> **Escopo:** define como o runtime **detecta**, **declara** e **verifica** a capability de *join síncrono* (orquestrador aguarda retorno de uma folha irmã e recebe valor de retorno) por host, e a regra de hard-fail quando ausente. Não redefine a FSM (ver `SPEC_FSM_SIBLING_S02.md`) nem implementa a remoção nested (S05).
>
> **Produto:** Talos — sprint S03.
> **Data:** 2026-06-11.
> **Dependências:** `AUDITORIA_S01_lock_topologia.md` §3 (veredito D2), `SPEC_FSM_SIBLING_S02.md`.
> **Alimenta:** S05 (remoção nested — substitui `topology` por join), S06 (preflight gate).

---

## Índice de decisões (D-S03-*)

| D-id | Decisão | Seção |
|------|---------|-------|
| D-S03-1 | "Join síncrono" é a única premissa de portabilidade do sibling; sem ele, host é rejeitado | §1 |
| D-S03-2 | Capability declarada em `validator_dispatch.join` (campo aditivo, schema v3→v4) | §2 |
| D-S03-3 | Detecção segue a política de prereq existente: `self_evident` (nativo) vs `must_report` (reportado) | §3 |
| D-S03-4 | Token de retorno da folha é o `dispatch_token` da FSM (S02 §3); join não introduz token novo | §4 |
| D-S03-5 | Host sem join verificado → `blocked` no preflight, sem fallback nested (DEC-SIB-003) | §5 |
| D-S03-6 | `topology` é substituído por `join` na migração; pós-S05 sibling é implícito, join é o discriminante | §2.3 |

---

## 1. Definição de join síncrono

**Join síncrono** = o orquestrador consegue:

1. **Despachar** uma folha irmã (validator / findings-repair) como subagente isolado;
2. **Bloquear-aguardar** o término dessa folha antes de prosseguir;
3. **Receber um valor de retorno** estruturado (veredito + token) dessa folha.

É a **única premissa de portabilidade** do modelo sibling. Em `nested` (removido em S05), o executor fazia o join do validador-filho; em `sibling`, quem faz o join é o **orquestrador**. Sem join síncrono, o dispatch vira *fire-and-forget* e a invariante "máx 1 validator ativo" não pode ser imposta — o slot vaza (risco R2 do backlog).

> **Contraste com `nested`:** join síncrono sempre existiu como premissa implícita; `nested` apenas movia o joiner para o executor. Como `nested` deixa de existir (DEC-SIB-001), o join passa a ser **explicitamente** do orquestrador e **verificável** no preflight.

---

## 2. Declaração da capability (`validator_dispatch.join`)

### 2.1 Campo no `HOST_ADAPTERS`

Cada host declara um objeto `join` dentro de `validator_dispatch`:

```js
validator_dispatch: {
  join: {
    sync: 'self_evident' | 'must_report',   // como a disponibilidade é estabelecida
    confidence: 'confirmed' | 'presumed' | 'reported_required',  // grau de evidência (S01 §3)
    mechanism: '<como o orquestrador aguarda e recebe retorno>',
  },
  dispatcher: 'orchestrator',   // único valor pós-S05 (sibling)
}
```

Removidos na migração (S05): `topology`, `nested_subagent_available`, `repair_loop`. O `dispatcher` colapsa para `'orchestrator'` em todos os hosts.

### 2.2 Schema bump

`CAPABILITIES_SCHEMA_VERSION` v3 → **v4** (aditivo): adiciona `validator_dispatch.join`; remove `topology`/`nested_subagent_available`/`repair_loop`. Como há remoção de campo + mudança de semântica, é bump **consciente** com nota de migração (não puramente aditivo). Consumidores antigos que liam `topology` devem migrar para `join`.

### 2.3 `topology` → `join`

Pós-S05 não há discriminante de topologia (sibling é o único modo). O discriminante operacional passa a ser **join disponível ou não**. Onde o runtime hoje faz `if (topology !== 'sibling') → blocked` (4 guards), passa a fazer `if (!join.verified) → blocked` no preflight (S06) — o gate sai das 4 tools de lock e centraliza no preflight.

---

## 3. Detecção / declaração por host

Segue a política de prereq já existente (`prereq_policy`, `server.js`). Join não cria mecanismo novo de report — reaproveita o `host_capabilities` do preflight.

| Host | `join.sync` | `confidence` | Base (S01 §3) | Ação preflight |
|------|-------------|--------------|----------------|----------------|
| `codex` | `self_evident` | `confirmed` | sibling opera em produção hoje | passa (nativo) |
| `claude` | `self_evident` | `presumed` | `Agent()` bloqueante por design do host | passa (nativo); confirmar smoke S13 |
| `opencode` | `self_evident` | `presumed` | `@<name>` bloqueante presumido | passa (nativo); confirmar smoke S13 |
| `pi` | `must_report` | `reported_required` | depende de `pi-subagents`; evidência insuficiente | hard-fail se `host_capabilities` não reportar join disponível |
| `generic` | `must_report` | `reported_required` | mecanismo indeterminado | hard-fail se não reportar |

**Regra de detecção:**
- `self_evident`: o runtime presume join disponível (host nativo conhecido). Não exige report.
- `must_report`: fail-closed. Só passa se o caller reportar afirmativamente join disponível em `host_capabilities` (alinhado ao `prereq_policy: 'must_report'` que pi/generic já têm).

`confidence: 'presumed'` não bloqueia (não degrada determinismo do gate), mas marca claude/opencode como pendentes de confirmação empírica em S13 (smoke). É observabilidade, não gate.

---

## 4. Token de retorno

O "valor de retorno" do join **é** o pacote da FSM sibling (S02 §3), não um token novo:

- A folha (validator) retorna `{ verdict, dispatch_token }`.
- O `dispatch_token` é o token monotônico do slot ativo (S02 §4, S04).
- O orquestrador valida `dispatch_token == cycle.active.token` antes de aplicar o veredito (anti-stale, S10).

Join e token são ortogonais: join é **capability de transporte** (consigo aguardar+receber); token é **correção de conteúdo** (o que recebi é do slot certo). S03 cobre o transporte; S02/S04/S10 cobrem o conteúdo. Nenhum token novo é introduzido por esta spec.

---

## 5. Hard-fail no preflight (alimenta S06)

Regra canônica (DEC-SIB-003, invariante 4 do `CLAUDE.md`): **host sem join síncrono verificado é rejeitado no preflight, não degradado.**

```
preflight(host, host_capabilities):
  join = HOST_ADAPTERS[host].validator_dispatch.join
  if join.sync == 'must_report':
     if not host_capabilities.join_sync_available:    # report afirmativo ausente
        → blocked { reason: "host <h> não reportou join síncrono; sibling exige join (DEC-SIB-003)",
                    next_action: "instalar deps de subagente síncrono ou usar host nativo" }
  # self_evident: passa sem report
```

- Sem fallback nested. Sem warning-em-vez-de-gate. Determinismo > alcance.
- pi/generic já são `must_report` no `prereq_policy`; S06 estende a verificação para a flag específica de join.
- O hard-fail é **idempotente** e legível (mesma forma dos demais `blocked` do preflight).

---

## 6. Matriz de aceite (deriva S06 e testes S12)

| Cenário | Host | `host_capabilities` | Resultado esperado |
|---------|------|---------------------|--------------------|
| Nativo confirmado | codex | qualquer | passa |
| Nativo presumido | claude/opencode | qualquer | passa (marca pendente S13) |
| Reportado ok | pi | `join_sync_available: true` | passa |
| Reportado ausente | pi | `join_sync_available` ausente/false | `blocked` |
| Indeterminado sem report | generic | ausente | `blocked` |
| Indeterminado com report | generic | `join_sync_available: true` | passa |

Critério de evidência: assert em teste unitário do preflight (S12) + smoke real claude/opencode/pi (S13).

---

## 7. Saída da sprint

- [x] Contrato `validator_dispatch.join` definido (campo, semântica, schema bump v4).
- [x] Política de detecção `self_evident` vs `must_report` mapeada por host.
- [x] Token de retorno esclarecido (reaproveita `dispatch_token`; sem token novo).
- [x] Regra de hard-fail no preflight especificada (alimenta S06).
- [x] Matriz de aceite derivável sem inferência (alimenta S06/S12/S13).
