# Plano 05 - Corte seco 0.16.0: versão, cópias por host e migração

**Pack:** ../GUIDE.md

**Objetivo do plano:** publicar `0.16.0` como BREAKING consciente: versão sincronizada, cópias por host regeneradas, CHANGELOG e docs alinhados, e caminho de migração documentado.

**Resultado esperado:** hoje o repo está em `0.15.2` com templates antigos copiados para oito hosts; depois, `main` está instalável em `0.16.0`, com o contrato novo em todas as cópias e a migração escrita para quem tinha backlog em andamento.

**Cenários servidos:** nenhum diretamente: documenta CN5, fechado no Plano 01.

**Fronteira de entrada:** CN4, VC1.

**Fecha neste plano:** INV5.

**Dependências:** Plano 04.
**Natureza:** OBRIGATÓRIO
**Ativação:** sempre
**Risco:** médio
**Status:** PENDENTE

### Direção de implementação

Fecha o release. O ponto de atenção não é a versão em si, é a duplicação: `packages/templates/` é fonte única, mas `hosts/` e `plugins/` carregam cópias **commitadas**, geradas por `build/build-plugins.sh`. Mudança de template que não passa pelo build deixa seis a oito cópias divergentes em silêncio, e o usuário que instala por catálogo recebe o schema antigo enquanto o gate cobra o novo — falha que nenhum teste unitário pega.

A migração segue o precedente do `0.15.0`/D19 registrado no `CLAUDE.md`: artefatos do formato anterior não são suportados e a instrução é iniciar backlog e sprints novos.

### Responsabilidades do plano

| Responsabilidade | Local | Implementação planejada |
|------------------|-------|--------------------------|
| Versão | `VERSION`, `.claude-plugin/plugin.json` | `0.16.0` nos dois, sem drift |
| Cópias por host | `build/build-plugins.sh` | Rodar o build e commitar as cópias regeneradas |
| Registro do BREAKING | `CHANGELOG.md` | Entrada com o que quebra e como migrar |
| Estado do projeto | `CLAUDE.md`, `README.md` | Seção de estado atual e contrato documental |

### Invariantes, valores críticos e regressões

- Preservar `INV5`: cópias por host sincronizadas com a fonte, provado por `AC-05.2.1`.
- Regressão provável: editar `packages/templates/` e esquecer o build. O guard de consistência precisa acusar isso, não confiar em disciplina.
- Regressão provável: subir a versão em um arquivo só. `build/check-consistency.mjs` já falha em drift; o plano não pode contorná-lo.

### Tasks

#### 05.1 Versão e registro do BREAKING

**Entrega:** `0.16.0` publicada com o que quebra escrito.

**Implementação planejada:**
Atualizar `VERSION` e `.claude-plugin/plugin.json` para `0.16.0` (o repo usa versão concreta no manifesto, e o guard falha em drift). Acrescentar entrada no `CHANGELOG.md` nomeando: coluna `Origem` obrigatória na §7.1 e nas decisões do backlog; campo `origin` obrigatório em cada `AC-*`; `premissa` proibida em sprint `Must`/`P0`; `derivado:<path>` resolvido contra o disco; §4 `Discussão` obrigatória; revisão fria interna à skill de backlog. Registrar explicitamente o que **não** entrou, para não gerar expectativa: nenhuma tool MCP nova, nenhum gate novo de orquestrador, nenhum selo de revisão.
Atualizar a seção "Estado atual" do `CLAUDE.md` e o `README.md` com o contrato novo, no mesmo formato usado para o `0.15.0`.
A migração é corte seco: backlog e sprint files anteriores a `0.16.0` não são suportados; a instrução é iniciar backlog novo, e o gate do Plano 01 já emite `next_action: 'migrar_para_0_16'` ao encontrar o schema antigo.

**Responsabilidade e integração:** consumido por quem instala pelo marketplace e pelo catálogo de hosts.

**Comportamentos operacionais aplicáveis:**

- Principal: versão consistente entre `VERSION` e o manifesto.

**Invariantes e regressões:**

- Não descrever o release como retrocompatível: ele não é.

**Critérios de aceite:**

- `AC-05.1.1` `VERSION` e `.claude-plugin/plugin.json` declaram `0.16.0`, e `node build/check-consistency.mjs` passa. Seam: N/A (build); nível: ancorada; golden: N/A; falseia se: atualizar só um dos dois — o guard de drift fica vermelho.
- `AC-05.1.2` O `CHANGELOG.md` nomeia cada quebra de contrato documental e a instrução de migração. Seam: N/A (documental); nível: ancorada; golden: N/A; falseia se: N/A.

**Evidência esperada:**

- `AC-05.1.1` -> `node build/check-consistency.mjs`.
- `AC-05.1.2` -> leitura do `CHANGELOG.md`.

**Validação focada:**

```bash
node build/check-consistency.mjs
```

#### 05.2 Cópias por host regeneradas

**Entrega:** todas as cópias distribuídas carregam os templates novos.

**Implementação planejada:**
Rodar `bash build/build-plugins.sh` e commitar as cópias regeneradas sob `hosts/` e `plugins/`. São **seis** cópias versionadas de cada template (`git ls-files | grep SPRINT_TEMPLATE.md`): `hosts/opencode`, `hosts/pi`, `hosts/vscode`, `hosts/zcode` e duas dentro de `plugins/talos/` (`templates/` e `packages/templates/`, escritas por `build_host` em `build/build-plugins.sh:91` e `:104`). Os oito hosts suportados não têm oito árvores: Claude Code, Cursor e Codex App consomem `plugins/talos/` pelo marketplace-from-source, e Antigravity não tem árvore própria em `hosts/`. Confirmar que cada cópia de `SPRINT_TEMPLATE.md` e `BACKLOG_MESTRE_TEMPLATE.md` contém a coluna `Origem`, e que `git status` fica limpo depois do build — cópia divergente após rodar o build significa que algum caminho de cópia do script não foi atualizado.

**Responsabilidade e integração:** distribuição por marketplace e por catálogo `hosts/`.

**Comportamentos operacionais aplicáveis:**

- Principal: build idempotente, `git status` limpo após rodar duas vezes.

**Invariantes e regressões:**

- Não editar cópia à mão: a fonte é `packages/templates/`.

**Critérios de aceite:**

- `AC-05.2.1` Depois de `bash build/build-plugins.sh`, toda cópia de `SPRINT_TEMPLATE.md` sob `hosts/` e `plugins/` contém a coluna `Origem`, e rodar o build de novo não produz diff. Seam: N/A (build); nível: ancorada; golden: N/A; falseia se: editar `packages/templates/` sem rodar o build — a busca encontra cópia sem a coluna e o teste fica vermelho.

**Evidência esperada:**

- `AC-05.2.1` -> `grep -rL "| ID | Decisão | Origem |" hosts plugins --include=SPRINT_TEMPLATE.md` sem resultado + `git status --porcelain` vazio após segundo build.

**Validação focada:**

```bash
bash build/build-plugins.sh
grep -rL "Origem" --include=SPRINT_TEMPLATE.md hosts plugins || echo "todas as cópias sincronizadas"
git status --porcelain
```

#### 05.3 Suíte completa

**Entrega:** a trilha inteira verde no runner real.

**Implementação planejada:**
Rodar `bash build/test-all.sh`, que encadeia build + guard, `node --test` do MCP e dos testes de skill, smoke por host, matriz de conformance, smoke de install/uninstall e checksums. Registrar no `Impl` qualquer falha preexistente separada de regressão nova.

**Responsabilidade e integração:** espelha o CI.

**Comportamentos operacionais aplicáveis:**

- Principal: suíte verde.
- Falha preexistente: registrada como baseline, não como regressão — `sem AC: separar baseline de regressão é obrigação de registro do executor, não comportamento de produto`.

**Invariantes e regressões:**

- Não declarar pronto com a suíte vermelha (invariante 6 do `CLAUDE.md`: validar antes de declarar pronto).

**Critérios de aceite:**

- `AC-05.3.1` `bash build/test-all.sh` termina em "OK — suíte completa verde", e `claude plugin validate ./ --strict` passa. Seam: N/A (gate agregado); nível: ancorada; golden: N/A; falseia se: N/A.

**Evidência esperada:**

- `AC-05.3.1` -> saída dos dois comandos.

**Validação focada:**

```bash
bash build/test-all.sh
```

### Gates e smoke

```bash
node build/check-consistency.mjs
bash build/test-all.sh
git diff --check
```

Smoke manual, quando aplicável:

1. Instalar o plugin num host limpo pelo marketplace-from-source.
2. Rodar `talos_ping` e conferir a versão `0.16.0`.
3. Gerar um backlog curto e confirmar que o sprint file nasce com a coluna `Origem`.

### Definition of done

- [ ] Implementação segue direção, responsabilidades e fluxo planejados.
- [ ] Regras locais respeitadas; o BREAKING está versionado e documentado.
- [ ] Critérios de aceite possuem evidência.
- [ ] INV5 provada pelo AC que 2.8 declara.
- [ ] Cópias por host regeneradas pelo build, não editadas à mão.
- [ ] Gates focados e agregados passam, ou o baseline está documentado.
- [ ] `Impl` registra implementação real, testes, decisões e pendências.

### Registro de implementação

**Impl:** PENDENTE: ainda não executado.

### Auditoria pós-implementação

PENDENTE: ainda não auditado.
