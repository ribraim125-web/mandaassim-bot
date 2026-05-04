# Narrativa Progressiva — MandaAssim

Sistema de mensagens proativas baseadas em comportamento. Bot descobre features pro usuário no momento certo — não como tutorial, como carta de vendas performada ao longo da jornada.

## Arquitetura

```
src/narrative/
  journeyEvents.js    — log de eventos comportamentais (fire-and-forget)
  narrativeLog.js     — log de atos enviados, variante A/B, outcomes
  narrativeInline.js  — atos disparados dentro do fluxo de mensagem
  narrativeWorker.js  — worker de atos agendados (mesmo padrão do followupWorker)
  acts/
    act_1_welcome_diagnosis.js   — boas-vindas com diagnóstico de persona
    act_2_mechanism_intro.js     — apresenta Leitura de Intenção pós-persona
    act_3_first_analysis.js      — sufixo narrativo na primeira análise
    act_5_profile_audit_reveal.js — upsell Pro via auditoria de perfil (36-96h)
    act_6_trial_ending.js        — oferta de upgrade 2h antes do trial acabar
    act_7_free_friction.js       — A/B de copy no limite diário free
```

## Feature flags

Todos os atos são OFF por default. Ligue 1 a 1 após testar com seu usuário.

```env
# .env
ENABLE_ACT_1=false
ENABLE_ACT_2=false
ENABLE_ACT_3=false
ENABLE_ACT_5=false
ENABLE_ACT_6=false
ENABLE_ACT_7=false
```

Para ligar só pro seu número de teste:
```env
ENABLE_ACT_5=true
# O worker dispara pra todos os usuários elegíveis quando está 'true'
# Para testar isolado, force pelo Supabase ou crie um flag de phone-test
```

## Catálogo de atos

| Ato | Tipo | Trigger | Plano alvo |
|-----|------|---------|-----------|
| 1 | Inline | Signup (boas-vindas) | Todos |
| 2 | Inline | Resposta ao Ato 1 (<5min) | Todos |
| 3 | Inline | Primeira análise entregue | Todos |
| 5 | Agendado (30min) | 2+ prints, janela 36-96h, plano ≠ pro | trial/free/wingman |
| 6 | Agendado (5min) | Trial expirando em <2h | trial |
| 7 | Inline | Free bate limite diário | free |

## Como editar copy

**Nunca toque em `narrativeWorker.js` ou `narrativeInline.js` pra mudar texto.**

Edite diretamente no arquivo do ato:
```
src/narrative/acts/act_5_profile_audit_reveal.js → campo variants.A.message
src/narrative/acts/act_6_trial_ending.js         → campo variants.A.message / variants.B.message
```

Deploy → PM2 restart → novo copy ativo.

## Worker — como funciona

O `narrativeWorker` é iniciado junto com o bot:

```
client.on('ready') → startNarrativeWorker(client)
```

- **A cada 30min**: avalia usuários elegíveis pro Ato 5 (janela 36-96h)
- **A cada 5min**: avalia usuários com trial expirando pro Ato 6
- **Horário**: só envia entre 8h-21h BRT
- **Cooldown**: nunca envia 2 atos pro mesmo usuário no mesmo dia (20h de gap)
- **Idempotência**: `UNIQUE(phone, act_id)` na tabela — nunca duplica

## A/B test

Variante atribuída deterministicamente pelo hash do telefone:
- Mesmo usuário sempre recebe A ou B (não muda entre sessões)
- Com 2 variantes: A para hash par, B para hash ímpar
- Para ver qual está ganhando: `npm run narrative-stats`

## Relatório

```bash
# Últimos 30 dias
npm run narrative-stats

# Período específico
npm run narrative-stats -- --since=2026-05-01
npm run narrative-stats -- --since=2026-04-01 --until=2026-04-30
```

Output inclui:
- Eventos de jornada registrados no período
- Por ato: enviados, responderam, response rate
- Vencedor A/B (quando N ≥ 5 por variante)
- Distribuição de outcomes

## Migrations necessárias

Rode no Supabase SQL Editor antes de ligar qualquer ato:
```
migrations/013_narrative_system.sql
```

Tabelas criadas:
- `user_journey_events` — todos os eventos comportamentais
- `narrative_messages_log` — atos enviados com variante e outcome

## Eventos de jornada rastreados

| Evento | Quando dispara |
|--------|---------------|
| `signup` | Novo usuário na primeira mensagem |
| `first_print_analyzed` | Primeiro print de conversa analisado |
| `third_print_analyzed` | Terceiro print do dia analisado |
| `first_profile_audit_done` | Primeira auditoria de perfil próprio |
| `hit_daily_limit_response` | Free bate limite de mensagens |
| `hit_daily_limit_print` | Free bate limite de print |
| `upgraded_wingman` | Pagamento aprovado plano Wingman |
| `upgraded_pro` | Pagamento aprovado plano Pro |
| `act_1_persona_selected` | Usuário respondeu 1-4 no Ato 1 |
| `first_response_suggestion_received` | Ato 3 entregue (primeira análise) |
| `narrative_act_X_sent` | Ato X enviado com sucesso |
