# Baseline universal e perfis de stack

Ativação é determinística: inspecione manifests no boundary e comandos realmente declarados no repo/plano. Use `detectStackProfiles(project_root, declared_commands, boundary_paths)`; consuma o array `boundaries` e não deduza stack por extensão isolada.

## Baseline universal — sempre ativo

- segurança, autenticação/autorização e dados sensíveis;
- boundary real, contratos, schemas e consumidores afetados;
- erros, falhas parciais, concorrência, idempotência e reentrada;
- setup/cleanup, recursos, estado stale e persistência;
- integridade de dados, nulos, enums, validação de input;
- checks declarados pelo repo/plano, sem inventar ferramenta.

## Flutter/Dart — `pubspec.yaml` ou comando `flutter`/`dart`

- lifecycle de Widget/Controller/Store, dispose/reset e async stale;
- rotas literais antes de parametrizadas quando o roteador exigir;
- args obrigatórios, null-safety, casts defensivos, coleções `?? []`;
- l10n em todos os locales e geração limpa;
- `flutter analyze`/`flutter test` somente quando declarados/aplicáveis;
- GetX apenas quando dependência/import/regras reais do repo confirmarem GetX.

## Node/TypeScript — `package.json`, `tsconfig.json` ou comando Node real

- lifecycle de processos/handles, abort/cleanup e promises rejeitadas;
- validação runtime nas fronteiras JSON/HTTP/MCP;
- ESM/CJS, exports, tipos e scripts realmente declarados;
- `node --test`, test runner, lint/typecheck apenas se presentes no repo/plano.

## Python — `pyproject.toml`, `requirements.txt`, `setup.py` ou comando Python real

- context managers, cleanup, exceções e async/cancelamento;
- parsing/typing nas fronteiras e mutabilidade de defaults;
- `pytest`, `ruff`, `mypy` ou equivalente apenas se declarados.

## Go — `go.mod` ou comando Go real

- context propagation/cancelamento, goroutine leak, data race e cleanup;
- erros retornados sem swallow, wrapping útil e validação em fronteiras;
- `go test`, `go vet`, `go test -race` e linters somente quando declarados/aplicáveis.

## Rust — `Cargo.toml` ou comando Cargo real

- ownership/lifetime usados para segurança real, não wrappers desnecessários;
- `Result`/`Option` tratados sem `unwrap`/`expect` em fronteiras recuperáveis;
- `cargo test`, `cargo check`, `cargo clippy` e `cargo fmt` somente quando declarados/aplicáveis.

## Java/Kotlin — Maven/Gradle ou comando Java/Kotlin real

- nullability, exceptions, resource cleanup e lifecycle de threads/coroutines;
- boundaries de DTO/entity, serialização e validação de input;
- `mvn test`, `gradle test`, linters/typecheck somente quando declarados.

## Firebase — `firebase.json`, `.firebaserc` ou dependência Firebase real

- regras/claims/authz, paths e ownership de dados;
- falhas offline/retry, listeners/subscriptions e cleanup;
- emuladores/deploy/checks somente quando declarados.

## Supabase — dependência Supabase real

- RLS/auth claims, schema/migrations, RPC/Edge Functions e storage policies;
- sessão/token refresh, SSR/cookies quando aplicável e boundaries de dados;
- CLI/migration/testes somente quando declarados.

## REST/OpenAPI — OpenAPI/Swagger ou servidor/cliente HTTP real

- compatibilidade request/response, status codes, paginação, erros e idempotência;
- validação runtime nas bordas e divergência entre contrato e implementação;
- geração/validação OpenAPI somente quando declarada.

Perfis podem coexistir em monorepo. Regra de perfil nunca vira finding fora do boundary onde seu sinal foi ativado.
