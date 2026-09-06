# Perfis de stack (baseline compartilhada)

Fonte de detecção: `../scripts/document_quality.mjs` (`detectStackProfiles(project_root, declared_commands, boundary_paths)`). Este arquivo é o baseline que as skills leem; o oráculo mecânico é a função.

## Regras duras

- Detectar por manifests, deps e comandos **reais** no boundary — não por extensão de arquivo.
- `universal: true` sempre. Perfil específico só vale onde o sinal aparece.
- Monorepo: cada entrada de `boundaries[]` aplica-se **somente** aos arquivos daquele package.
- Não inventar critério fora deste baseline + plano/contrato da slice.

## Sinais de ativação

| Perfil | Sinal |
|---|---|
| `flutter_dart` | `pubspec.yaml` ou comando `flutter`/`dart` |
| `node_typescript` | `package.json` / `tsconfig.json` ou comando `node`/`npm`/`pnpm`/`yarn`/`bun`/`tsc` |
| `python` | `pyproject.toml` / `requirements.txt` / `setup.py` ou comando `python`/`pytest`/`ruff`/`mypy` |
| `go` | `go.mod` ou `go test\|build\|run\|vet\|fmt` |
| `rust` | `Cargo.toml` / `[package]` ou `cargo test\|build\|run\|check\|clippy\|fmt` |
| `java_kotlin` | `pom.xml` / Gradle (`build.gradle*`, `settings.gradle*`) ou `gradle`/`mvn`/`java`/`javac`/`kotlinc` |
| `firebase` | `firebase.json` / `.firebaserc` / deps `firebase*` / pubspec `firebase_*` |
| `supabase` | deps `@supabase/*` / `supabase-js` / pubspec `supabase*` / `postgrest` |
| `rest_openapi` | `openapi.*` / `swagger.*` / deps HTTP-OpenAPI / Spring/Ktor/Retrofit no POM/Gradle/pubspec |
| `getx` | `get:` no `pubspec.yaml` ou import GetX em `.dart` |

## O que cada perfil cobra (skills)

Sempre o baseline universal: segurança/permissões, boundary/contratos, erros/falhas parciais, concorrência/reentrada, cleanup/estado stale, integridade de dados/input e checks declarados.

- `flutter_dart`: lifecycle, rotas/args, null-safety/casts, l10n, analyze/test; GetX só se `getx`.
- `node_typescript`: handles/promises, validação runtime, ESM/CJS/exports/tipos, scripts Node reais.
- `python`: context managers, exceções/async, typing/parsing, ferramentas Python declaradas.
- `go`: context/cancelamento, goroutines, erros retornados, data race, comandos Go declarados.
- `rust`: `Result`/`Option`, ownership/lifetime, unwrap em fronteira recuperável, Cargo declarado.
- `java_kotlin`: nullability, exceptions, resource cleanup, threads/coroutines, Maven/Gradle.
- `firebase`: rules/claims/authz, paths/ownership, listeners, emuladores/checks declarados.
- `supabase`: RLS/auth claims, schema/migrations, RPC/Edge Functions, storage policies.
- `rest_openapi`: request/response, status, paginação, erros, idempotência, contrato OpenAPI se existir.

Fixture Node sem sinal Flutter **não** recebe regra Flutter/GetX.
