# Narrativa Progressiva — MandaAssim (v2)

Sistema de mensagens proativas baseadas em comportamento. Copy vive em arquivos `.md`, nunca em JS. Engine roda a cada 15min e avalia usuários criados nos últimos 7 dias.

---

## Arquitetura

```
src/narrative/
  engine.js          — cron 15min, avalia todos usuários elegíveis
  acts.js            — catálogo dos 13 atos com triggers, variantes, templateVars
  sender.js          — envia array de mensagens com delay 1.5–3s entre cada uma
  triggerContext.js  — TriggerContext: queries lazy, helpers de contexto
  copyLoader.js      — lê .md de docs/narrative/, cache 5min, parse vars [CHAVE]
  journeyEvents.js   — logJourneyEvent (fire-and-forget), checkMilestones
  narrativeLog.js    — logActSent, recordOutcome, getNarrativeStats

docs/narrative/
  README.md          — este arquivo
  acts/              — um .md por variante principal
  variants/          — variantes B dos atos com A/B test

migrations/
  013_narrative_system.sql       — tabelas base (user_journey_events, narrative_messages_log)
  015_narrative_schema_update.sql — índices + colunas copy_used, response_at, conversion_at
```

---

## Copy — regras do arquivo .md

```
# comentário de dev — linha inteira ignorada
// também ignorada
[CHAVE]           → substituída pelo templateVars do ato

---               → separador: tudo acima = mensagem 1, abaixo = mensagem 2
```

Cada bloco separado por `---` vira uma mensagem WhatsApp distinta. Delay aleatório de 1.5–3s entre elas.

---

## Planos

| DB (`users.plan`) | Exibido na copy |
|-------------------|-----------------|
| `trial`           | trial           |
| `free`            | free            |
| `parceiro`        | Parceiro        |
| `parceiro_pro`    | Parceiro Pro    |

Aliases legados (`wingman`, `wingman_pro`, `premium`, `pro`) são normalizados automaticamente pelo `TriggerContext`. Condições dos atos usam `'parceiro'`/`'parceiro_pro'`.

---

## Catálogo de Atos

| # | ID | Tipo | Janela | Plano alvo | A/B |
|---|----|------|--------|-----------|-----|
| 1  | `act_01_hook_diagnostico`         | Proativo | após `first_message_sent` | todos | — |
| 2  | `act_02_promessa_mecanismo`        | Proativo | 0–30min após Ato 1        | todos | 4 variantes (persona) |
| 3  | `act_03_first_analysis_template`  | **Inline** | 1ª análise entregue      | todos | — |
| 4  | `act_04_reveal_papo`              | Proativo | 2–8h após signup, 3+ interações | todos | — |
| 5  | `act_05_identificacao_amplificada`| Proativo | 12–24h, 5+ interações    | todos | 50/50 |
| 6  | `act_06_reveal_audit`             | Proativo | 24–36h, 2+ prints, ≠ pro | trial/free/direto | 50/50 |
| 7  | `act_07_reveal_analise_dela`      | Proativo | 30–48h, após audit ou 30h| ≠ pro | — |
| 8  | `act_08_reveal_predate`           | Proativo | 36–60h, menção de encontro| ≠ pro | — |
| 9  | `act_09_sumario_uso`              | Proativo | 60–66h                   | trial/free | — |
| 10 | `act_10_oferta`                   | Proativo | 66–70h                   | trial/free | 50/50 |
| 11 | `act_11_objecao_garantia`         | Proativo | 2h após oferta, ou 1h após link | trial/free | — |
| 12 | `act_12_ultima_chamada`           | Proativo | 71.5–72h (trial)         | trial | — |
| 13 | `act_13_reoferta_d1`              | Proativo | D+1 do free, ao bater limite | free | — |

Ato 3 é inline: não entra na engine, é chamado diretamente pelo fluxo de análise em `index.js`.

---

## Feature Flags

Todos os atos são **OFF por default**. Ligue 1 a 1 no `.env`:

```env
ENABLE_ACT_01_HOOK_DIAGNOSTICO=true
ENABLE_ACT_02_PROMESSA_MECANISMO=true
ENABLE_ACT_03_FIRST_ANALYSIS_TEMPLATE=true
ENABLE_ACT_04_REVEAL_PAPO=true
ENABLE_ACT_05_IDENTIFICACAO_AMPLIFICADA=true
ENABLE_ACT_06_REVEAL_AUDIT=true
ENABLE_ACT_07_REVEAL_ANALISE_DELA=true
ENABLE_ACT_08_REVEAL_PREDATE=true
ENABLE_ACT_09_SUMARIO_USO=true
ENABLE_ACT_10_OFERTA=true
ENABLE_ACT_11_OBJECAO_GARANTIA=true
ENABLE_ACT_12_ULTIMA_CHAMADA=true
ENABLE_ACT_13_REOFERTA_D1=true
```

---

## Engine — como funciona

```
client.on('ready') → startNarrativeEngine(client)
  └─ aguarda 2min → tick() a cada 15min
       └─ busca usuários criados nos últimos 7 dias
            └─ evaluateUserActs(user) por usuário
                 ├─ verifica horário seguro (8–21h BRT)
                 ├─ verifica limite 1 ato/usuário/dia
                 ├─ verifica conversa ativa (<5min última mensagem → skip)
                 └─ avalia PROACTIVE_ACTS em ordem
                      └─ fireAct(user, act, ctx)
                           ├─ selectVariant (persona ou hash A/B)
                           ├─ loadAndApplyCopy (substituição [CHAVE])
                           ├─ logActSent (idempotência — UNIQUE no banco)
                           ├─ sendNarrativeMessages (delay 1.5–3s)
                           └─ logJourneyEvent 'narrative_act_sent'
```

---

## A/B Test

Variante determinística: `parseInt(phone.slice(-4), 16) % 100 < splitPercent`.

- Mesmo usuário sempre vê a mesma variante
- Para atos com `abTestSplit: [50, 50]`: metade A, metade B
- Resultado: `npm run narrative-stats`

---

## Variante por Persona (Ato 2)

1. Ato 1 envia diagnóstico com 4 opções (1–4)
2. Usuário responde → `index.js` detecta e chama `act01.onResponse(ctx, text)`
3. `onResponse` grava evento `act_01_persona_selected { choice: '1'|'2'|'3'|'4' }`
4. Na próxima tick da engine, Ato 2 lê persona via `ctx.getUserPersona()`
5. Seleciona variante com `personaCondition === persona`

---

## Eventos de Jornada

| Evento | Quando dispara |
|--------|----------------|
| `signup` | Novo usuário na 1ª mensagem |
| `first_message_sent` | 1ª mensagem do usuário |
| `first_response_suggestion_received` | 1ª sugestão de mensagem entregue |
| `first_print_analyzed` | 1º print de conversa analisado |
| `third_print_analyzed` | 3º print analisado |
| `first_profile_audit_done` | 1ª auditoria de perfil próprio |
| `first_her_profile_analyzed` | 1ª análise de perfil dela |
| `encounter_mentioned` | Usuário mencionou encontro/date |
| `hit_daily_limit_response` | Free bateu limite de mensagens |
| `hit_daily_limit_print` | Free bateu limite de print |
| `trial_ended` | Trial expirou → plano virou free |
| `upgraded_parceiro` | Plano ativado: Parceiro |
| `upgraded_pro` | Plano ativado: Parceiro Pro |
| `subscribed_parceiro` | Alias de upgraded_parceiro (para narrativa) |
| `subscribed_parceiro_pro` | Alias de upgraded_pro (para narrativa) |
| `act_01_persona_selected` | Usuário escolheu 1-4 no Ato 1 |
| `narrative_act_sent` | Qualquer ato proativo disparado |

---

## CLIs

```bash
# Preview de um ato (sem envio real)
npm run narrative-preview -- --phone=5511999999999 --act=act_05_identificacao_amplificada
npm run narrative-preview -- --phone=5511999999999 --act=act_10_oferta --variant=B
npm run narrative-preview -- --list   # lista todos os atos com status ON/OFF

# Relatório de performance (últimos 30 dias)
npm run narrative-stats
npm run narrative-stats -- --since=2026-05-01
npm run narrative-stats -- --since=2026-04-01 --until=2026-04-30
```

---

## Migrations

Rode no Supabase SQL Editor antes de ligar qualquer ato:

```
migrations/013_narrative_system.sql       — tabelas base
migrations/015_narrative_schema_update.sql — índices e colunas adicionais
```

---

## Como adicionar um ato novo

1. Crie o `.md` em `docs/narrative/acts/act_NN_nome.md`
2. Adicione a entrada em `src/narrative/acts.js` (ACTS array)
3. Defina a `featureFlag` e adicione ao `.env` (OFF por default)
4. Se proativo: engine vai detectar automaticamente via `PROACTIVE_ACTS`
5. Se inline: chame `loadAndApplyCopy` + `sendNarrativeMessages` diretamente no fluxo

---

## Editar copy

**Nunca edite texto diretamente em `.js`.**

Edite o `.md` correspondente em `docs/narrative/acts/` ou `docs/narrative/variants/`. Deploy e PM2 restart não necessários — cache é de 5min (30s em dev com `NODE_ENV=development`).
