---
name: claude-task-validator
description: Skill `claude-task-validator`. Validador frio de slice executada por `claude-plan-execute`. Invocada como subagent pelo executor antes do relatório final. Recebe boundary da slice (git diff) + plano (Seção 2/Invariantes, Seção 6/Contratos, Seção 8/Checklist) + lista de tasks executadas. Compara código real vs plano e retorna findings P1/P2/P3 estruturados com evidência (path:linha), violação e fix sugerido em 1-2 linhas de texto (sem diff). Não corrige código. Não inventa critérios fora do plano.
---

# Claude Task Validator

Use esta skill **como subagent interno** invocado por `claude-plan-execute` após a execução de todas as tasks da slice, antes de fechar e reportar.

Objetivo: **revisão fria e estruturada** da slice contra o plano que serviu de contrato. O executor (principal) consome o output e decide o reparo dentro de um loop bounded.

---

## Contrato de Invocação

Quando invocada como subagent, a skill recebe **inputs obrigatórios** do executor principal:

1. **Boundary da slice** — saída de `git diff --name-only main...HEAD` + `git diff --stat`.
2. **Plano** — caminho do arquivo `.claude/plans/<nome>.md` OU as seções do plano coladas inline (especialmente Seção 2 - Invariantes de Execução, Seção 6 - Contratos Técnicos, Seção 8 - Validação e Checklist (§14)).
3. **Lista de tasks executadas** — IDs e títulos (T01..Tn).
4. **Lista de tasks bloqueadas** — IDs e motivo curto.
5. **Contexto frio explícito** — "você não viu execução; lê código atual e compara com plano".

Se algum input estiver ausente, pare e informe a pendência estruturalmente.

---

## Resolução Canônica de Templates

* Fonte única: `packages/templates/` empacotado no plugin Atlas Workflow.
* Antes da validação, resolver `PLAN_TEMPLATE.md` e `BOUNDARY_PRD_PLAN.md` a partir da raiz do plugin/bundle.
* Template local do repo consumidor nunca sobrepõe o template empacotado.
* Se `packages/templates/PLAN_TEMPLATE.md` ou `packages/templates/BOUNDARY_PRD_PLAN.md` não existir, abortar com erro claro: `Template canônico ausente: <nome-do-template>`.
* Não usar fallback silencioso para cópias antigas, vault local ou templates globais.

## Conformidade de Template via MCP

* Para PRD ou PLAN validado como artefato documental da slice, consumir o resultado `atlas_verify_template_conformance`.
* Resultado `passed` com `pending_count: 0` é pré-condição para aceitar conformidade documental.
* Resultado ausente, `blocked` ou com pendências vira finding bloqueante contra o contrato da slice; citar categoria, pendência e `next_action`.
* Não recriar regra paralela em texto quando o MCP já retornou pendências rastreáveis no estado da run.

---

## Regras de Operação

1. **Lê código real de cada arquivo da boundary.** Abre, lê, compara.
2. **Para cada invariante da Seção 2 (Invariantes de Execução):** aponta arquivo+linha que cumpre OU viola.
3. **Para cada contrato da Seção 6 (Contratos Técnicos):** confere assinatura, comportamento e retorno.
4. **Para cada item da Seção 8 (Validação e Checklist) (§14):** marca pass/fail com evidência.
5. **Caça cross-task ativa:** state shared entre stores, args incompletos (UUIDs vazios), ordem de registro de rotas, failure paths sem compensação, gate de UI sem match no backend.
6. **Não inventar critérios fora do plano.** Se algo parece ruim mas o plano não declara o invariante, registra como `Observação`, não como `Finding`.
7. **Não propor diffs nem alterar código.** O fix sugerido deve ter **1-2 linhas de texto**.

---

## Checklist Baseline (Sempre Aplicado, mesmo se Seção 8 omitir)

Estes checks são universais e devem ser executados independentemente de constar no plano:
* **Naming cross-layer:** Leitura sem efeito colateral usa prefixo `get*`. Mutação usa verbo próprio (`create`, `update`, `delete`, `add`, `remove`). Nomes mantêm a mesma raiz entre camadas.
* **State lifecycle:** Stores GetX resetam campos/estado em `init()` ou na transição de múltiplos modos.
* **Args de navegação:** Valida campos required; navegação passa todos os IDs necessários (nunca UUID vazio `''`).
* **Failure paths:** Operações que encadeiam mutações dão feedback em caso de falha parcial para o usuário não perder o progresso.
* **Backend ↔ UI gate match:** Toda mutação sensível tem barreira server-side. Toggle/botão de ação privilegiada não é renderizado para usuário sem permissão (Page lê `canManage` da Store).
* **Registro de rotas:** Rotas literais são registradas antes de rotas com parâmetro (`/:id`, `/:id/edit`) para evitar match incorreto.
* **Localização (i18n):** Novas keys em todos os ARBs do projeto; `flutter gen-l10n` sem erro.
* **Analyzer:** `flutter analyze` sem warnings/issues no escopo tocado.
* **Casts em payloads:** Casts de respostas RPC/HTTP usam padrão seguro de defesa; nulos em listas tratados com `?? []`.

---

## Output (Estrutura Fixa)

A skill **deve** produzir output exatamente neste shape. O principal parseia por seções:

```markdown
## Findings

### P1 — <título curto>
- **Task:** T0N (ou cross-task se atravessa múltiplas)
- **Arquivo:** `path/relativo/arquivo.dart:linha`
- **Evidência:**
  ```
  <trecho de código real, 3-8 linhas>
  ```
- **Violação:** <qual invariante de Seção 2 / contrato de Seção 6 / item de Seção 8 (§14) está sendo violado — citar pelo nome>
- **Modo de falha:** <o que quebra em runtime, qual UX o usuário vê>
- **Fix sugerido:** <1-2 linhas de texto, sem diff>

### P2 — <título curto>
[mesmo formato]

### P3 — <título curto>
[mesmo formato]

---

## Observações (fora do plano)

- <observação 1 — coisa que parece ruim mas não viola plano de execução>
- <observação 2>

(Se nenhuma, escrever "Nenhuma.")

---

## Veredito

<um dos três valores exatos>:
- `pass` — nenhum finding, ou apenas P3 não-bloqueadores
- `fail-com-P1` — pelo menos um P1; principal deve reparar e re-validar
- `fail-com-P2-only` — apenas P2/P3; principal decide reparar agora ou registrar follow-up
```

Não adicionar conclusões narrativas nem pedir confirmações.

---

## Modelo de Severidade

| Nível | Definição |
|-------|-----------|
| **P1** | Bug bloqueante: fluxo principal quebrado, UUID vazio enviado a backend, invariante crítico de Seção 2 violado, mutação sensível sem gate backend |
| **P2** | Bug recomendado-corrigir: state shared sem reset, failure path sem compensação, gate de UI ausente quando backend rejeita |
| **P3** | Cleanup: ordem de rotas, naming inconsistente menor |

Achados de segurança crítica/perda de dados recebem prefixo `[P0-equivalente em slice-review]` no fix sugerido do P1, recomendando parar e reabrir o plano.
