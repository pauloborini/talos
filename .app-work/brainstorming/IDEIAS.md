# Ideias — Talos

	⁠Caderno de ideias e melhorias candidatas. Não é compromisso nem roadmap fechado — é onde as ideias ficam concentradas antes de virar (ou não) trabalho. Cada item deve dizer *o quê, **por quê* e *status*.

## Status possíveis

•⁠  ⁠⁠ rascunho ⁠ — ideia solta, ainda precisa amadurecer.
•⁠  ⁠⁠ em-análise ⁠ — sendo avaliada (viabilidade/impacto).
•⁠  ⁠⁠ aprovada ⁠ — decidida, pronta pra virar tarefa/PR.
•⁠  ⁠⁠ descartada ⁠ — avaliada e recusada (manter com o motivo).

---

## 1. Aproveitar o todo do pi quando ⁠ pi-todotools ⁠ estiver instalado

•⁠  ⁠*Status:* rascunho
•⁠  ⁠*Contexto:* o pi cli é minimalista por design e *não tem todo nativo* (doc oficial: "It intentionally does not include built-in MCP, sub-agents, plan mode, to-dos…"). Todo só existe via extensão externa (ex.: ⁠ pi-todotools ⁠, que registra ⁠ todowrite ⁠/⁠ todoread ⁠). Hoje o Talos reporta corretamente ⁠ todo_available: false ⁠ / ⁠ todo_tool: null ⁠ para o pi.
•⁠  ⁠*Ideia:* modelar o todo do pi como *capability opcional reportada* — quando o usuário tiver o ⁠ pi-todotools ⁠ instalado, o orquestrador reporta isso via ⁠ host_capabilities ⁠ no preflight (mesmo padrão ⁠ must_report ⁠ já usado para as deps essenciais do pi), e o Talos passa a espelhar o plano no ⁠ todowrite ⁠ do pi.
•⁠  ⁠*Por quê:* paridade de experiência com opencode/claude/codex (mirror de plano → todo) para quem já usa a extensão, sem quebrar quem não usa.
•⁠  ⁠*Cuidados / invariantes:*
  - Continua *não-essencial* — nunca bloqueia o preflight (invariante 4). Ausência = segue sem mirror.
  - Não é mudança de correção, é *feature nova*. Não confundir com o fix do opencode.
  - Manter data-driven em ⁠ HOST_ADAPTERS ⁠ + ⁠ host_capabilities ⁠; sem ramo ⁠ if host== ⁠.
•⁠  ⁠*Origem:* discussão durante o fix do ⁠ todo_available ⁠ do opencode (2026-06-05).

---

<!-- Próximas ideias abaixo. Copie o bloco do item 1 como modelo. -->