---
name: atlas-audit
description: Skill/mode universal de auditoria Atlas. Use para `/workflow audit <target>` com flags opcionais `--handoff` e `--scope <descrição>`. Audita código contra regras locais, boas práticas da stack detectada e complexidade acidental estilo Ponytail, sem corrigir código nem executar plano.
---

# Atlas Audit

Auditoria universal, framework-agnóstica. Esta skill lê o repositório real, audita o `target` informado e entrega relatório de achados. Opcionalmente gera handoff Atlas-style para correção futura. **Nunca altera código. Nunca executa plano.**

## Sintaxe

```text
/workflow audit <target>
/workflow audit <target> --handoff
/workflow audit <target> --scope <descrição>
```

`target` pode ser arquivo, diretório, pacote, módulo, feature, PRD/plano como referência ou descrição que aponte para um boundary localizável. Se não for possível resolver o boundary em disco, pare e peça um target mais preciso.

## Contrato duro

- Auditar o target informado, não o repo inteiro por padrão.
- Diagnóstico factual vem antes de proposta de correção.
- Todo achado precisa de evidência concreta `arquivo:linha`.
- Não criar finding por preferência genérica sem evidência local.
- Regras locais reais prevalecem sobre boas práticas genéricas.
- Não migrar lógica especialista de Flutter/Dart para o core universal.
- Adapters por stack/backend são opcionais; fallback universal deve funcionar.
- Não inventar comandos de validação: usar apenas manifests/configs/scripts reais.
- `--handoff` gera artefato de plano, mas não chama executor.

## Fluxo obrigatório

1. **Resolver boundary**
   - Identificar `project_root`, `target`, paths reais e exclusões óbvias (`node_modules`, `build`, `dist`, `.git`, caches).
   - Se `--scope` existir, tratar como recorte adicional, não expansão automática para repo inteiro.
   - Registrar limitações se parte do target estiver ausente, gerada ou ilegível.

2. **Ler regras locais reais**
   - Procurar e consultar, quando existirem e forem relevantes ao boundary: `AGENTS.md`, `CLAUDE.md`, `README.md`, docs de rules, `project-rules/`, configs de lint/format/typecheck/test, manifests e arquivos de workspace.
   - Não copiar regras integralmente no relatório; listar só fontes consultadas e regras aplicáveis.

3. **Detectar stack/perfis**
   - Usar `../_shared/references/stack-profiles.md` como baseline.
   - Detectar por manifests/configs/comandos reais, não só por extensão.
   - Perfis esperados quando houver sinal: Dart/Flutter, TypeScript/Node, Python, Go, Rust, Java/Kotlin, Firebase, Supabase, REST/OpenAPI.
   - Se múltiplos perfis coexistirem, aplicar cada regra só ao boundary onde o sinal foi ativado.

4. **Entender arquitetura antes de julgar**
   - Mapear camadas reais, fluxo de dados, contratos, entrypoints, DI, estado, side effects, testes e consumidores afetados.
   - Comparar com padrões existentes do repo antes de classificar algo como violação.

5. **Auditar por lentes**
   - Arquitetura e ownership.
   - Contrato/dados/schemas/mappers/DTOs.
   - Erros, falhas parciais, retries, cleanup.
   - Segurança, authz/authn, segredos, trust boundaries.
   - Estado, concorrência, lifecycle, idempotência.
   - Fluxos previstos e imprevistos.
   - Testes e validação declarada.
   - Observabilidade, logs e diagnóstico.
   - Manutenção/DX.

6. **Ponytail pass final**
   - Procurar abstração inútil, wrapper sem valor, código morto, duplicação simples, dependência excessiva, branching/config acidental e complexidade que não protege segurança/contrato/dados.
   - Só registrar se houver simplificação clara e segura, com evidência local.

## Severidade

- `P0`: quebra crítica, perda/corrupção de dados, bypass de segurança, execução impossível.
- `P1`: bug provável em fluxo principal, contrato errado, regressão relevante, risco alto.
- `P2`: gap importante, cenário não coberto, arquitetura frágil, teste/validação faltante com risco real.
- `P3`: melhoria localizada, simplificação Ponytail, DX/manutenção, observação de baixo risco.

## Formato do achado

```md
### AUDIT-001 — P1 — <categoria>
- Arquivo: `path/to/file.ext:123`
- Evidência: <fato observado no código>
- Impacto: <falha/risco concreto>
- Correção proposta: <direção, sem implementar>
- Dependências/bloqueios: <se houver>
- Status: `open`
```

Se não houver linha precisa, não promova a finding; registre em limitações ou perguntas.

## Relatório de auditoria

Responder em pt-BR com:

```md
# Auditoria Atlas — <target>

## Stack detectada
...

## Regras locais consultadas
...

## Boundary auditado
...

## Achados
### P0
...
### P1
...
### P2
...
### P3
...

## Gaps por área
- Contrato/dados:
- Segurança:
- Testes:
- Arquitetura:

## Limitações
...

## Próximo passo seguro
...
```

Se zero achados, diga explicitamente `Nenhum achado P0/P1/P2/P3 com evidência suficiente no boundary auditado` e liste risco residual/limitações.

## `--handoff`

Quando `--handoff` estiver presente, anexar um plano Atlas-style consumível depois por `/workflow execute plan <PLAN_*.md>` ou por uso standalone de `atlas-plan-execute`. O plano só pode conter tasks derivadas dos achados evidenciados.

Metadados obrigatórios:

```md
## Metadados de execução
- Plan prefix: `atlas`
- Execution mode: `sequencial (T01→TN)` | `orchestrated-per-slice`
- Executor skill: `atlas-plan-execute`
- Internal validator: `atlas-task-validator`
- Source audit: `<título/path/data do relatório>`
```

Estrutura mínima:

- `Scope boundary`
- `Non-goals`
- `Stop conditions`
- Tasks `T01..TN` com objetivo, referência ao achado, mudança esperada, invariantes, não mudar, dependências, riscos, done e validação local.
- `Checklist validator`

Regras do handoff:

- Incluir apenas validações derivadas de manifests/configs reais.
- Não usar task vaga como "refatorar geral".
- Não incluir achado sem `arquivo:linha`.
- Não chamar executor automaticamente.

