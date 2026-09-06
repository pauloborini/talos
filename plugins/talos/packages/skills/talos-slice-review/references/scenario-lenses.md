# Scenario Lenses

Use these lenses to find hidden bugs in the executed slice. Apply only the relevant ones.

## State and orchestration

- Can the state machine enter a half-updated state?
- Are loading, success, empty, and error states all representable?
- What happens on repeated triggers or rapid taps?
- Is cleanup symmetrical with setup?
- Can stale async results overwrite newer state?

## Business rules

- Which negative path did the plan imply but the code does not implement?
- Are closed decisions from the plan really enforced?
- Did the implementation honor the plan's resolved source-of-truth decisions?
- If roles differ by resource, can any actor mutate a resource the matrix forbids?
- Is there any fallback that weakens a business invariant?
- Does the implementation silently infer data that the plan said must be explicit?

## View and rendering

- Can the UI render a shape the store never guarantees?
- Can the store produce a shape the UI does not handle?
- Are empty, null, partial, and reordered inputs rendered safely?
- Is user feedback tied to the real pipeline or only to a local shortcut?

## Contracts and integration

- Did any field, enum, or payload meaning drift from the plan?
- Are all relevant consumers updated after a shape change?
- Does the code assume a backend guarantee that is not actually enforced?
- Is retry or re-entry behavior still coherent after this slice?
- Did generated files, localization keys, imports, routes, RPC signatures, or schemas match the verified repo convention?

## Mecânica da mudança

- Qual invariante cada guard, validação, cleanup, error path ou teste removido/substituído protegia, e onde ele foi restabelecido?
- Callers e callees alterados ainda concordam sobre pré-condições, shapes de retorno, erros, timing e ordem?
- A mudança corrige o componente proprietário do invariante ou adiciona um caso especial local frágil?
- Algum novo problema de reuse, simplificação ou eficiência tem custo comportamental, operacional ou de manutenção concreto?
- As instruções aplicáveis do repo expõem uma violação exata, atribuível a uma linha e com impacto concreto?

## Security and safety

- Did the slice weaken permission, ownership, or visibility checks?
- Can an untrusted input reach a sensitive path without validation?
- Was any auth, session, or cleanup invariant softened?
- Did logging or observability leak sensitive information?

## Validation and tests

- Do the tests cover only the happy path?
- Which regression would still pass the current tests?
- Was a required manual check skipped or replaced by weaker evidence?
- Did the executor claim closure despite an environment-limited validation gap?
