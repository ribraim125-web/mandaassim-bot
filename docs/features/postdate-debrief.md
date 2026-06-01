# Camada 5 — Debrief Pós-Date

## Visão Geral

Após o encontro, o bot ajuda o usuário a analisar como foi de forma honesta: o que funcionou, o que errou, o que ela sinalizou e qual é o próximo passo certo.

**Princípio absoluto: HONESTIDADE BRUTAL > BAJULAÇÃO**

## Fluxo

```
Trigger (A, B ou C)
    ↓
Verificação de plano (Free → upsell, Premium 1/mês, Pro ilimitado)
    ↓
Mini-entrevista: 6 perguntas (state machine em index.js)
    ↓
Haiku 4.5 analisa (SYSTEM_PROMPT_DEBRIEF com anti-padrões proibidos)
    ↓
4 mensagens de WhatsApp: avaliação, sinais, performance, próximo passo
    ↓
Salva em postdate_sessions (fire-and-forget)
    ↓
Loop de aprendizado: insight alimenta Camada 4 (Pré-Date) na próxima sessão
```

## Triggers

| Trigger | Condição |
|---------|----------|
| **A — Proativo** | Worker envia `predate_debrief` followup → `temDebriefPendente()` = true quando usuário responder |
| **B — Explícito** | `POSTDATE_DEBRIEF_KEYWORDS` regex: "como foi o encontro", "debrief", "analisar encontro", etc. |
| **C — Detectado** | `POSTDATE_AUTO_TRIGGER_PATTERNS` regex: "o encontro foi bem/mal", "voltei do encontro", etc. |

## Mini-Entrevista (6 Perguntas)

1. Como foi o encontro no geral — deu certo, foi ok, ou foi mal?
2. Qual foi o clima entre vocês?
3. Teve algum momento que você sentiu que esfriou?
4. Vocês já combinaram de se ver de novo, ou ficou em aberto?
5. Você mandou mensagem depois? Se sim, como ela reagiu?
6. O que você acha que foi bem e o que poderia ter sido diferente?

## Schema JSON (Haiku 4.5)

```json
{
  "encounter_quality_assessment": "great" | "good" | "neutral" | "poor" | "unclear",
  "quality_rationale": "string",
  "her_interest_signals": ["string"],
  "her_disinterest_signals": ["string"],
  "user_performance_feedback": {
    "what_worked": ["string"],
    "what_to_improve": ["string"],
    "biggest_mistake": "string | null"
  },
  "next_step_recommendation": "string",
  "next_step_timing": "now" | "24h" | "48h-72h" | "wait",
  "lessons_for_next_time": ["string"],
  "red_flags_observed": ["string"],
  "honest_truth_if_needed": "string | null"
}
```

## Anti-Padrões Proibidos (no system prompt)

- "Você merece alguém melhor"
- "Foque em você primeiro"
- "Talvez não fosse a pessoa certa"
- "Mulher é complicada mesmo"
- "O importante é que você tentou"
- "Cada experiência é um aprendizado" (genérico)
- Qualquer frase de autoajuda que não resolve o problema concreto

## Limites por Plano

| Plano | Limit |
|-------|-------|
| Free/Trial | Upsell → Premium |
| Premium | 1 sessão/mês |
| Pro | Ilimitado |

## Loop de Aprendizado (Camada 5 → Camada 4)

`getLastDebriefInsight(phone)` retorna um resumo do último debrief (qualidade, lições, o que melhorar).

Este insight é injetado no contexto de `analisarPreDateComHaiku()` como `CONTEXTO DO ÚLTIMO ENCONTRO DELE`, permitindo que o Pré-Date Coach referencie erros anteriores e personalize as recomendações para o próximo encontro.

## Feature Flag

```
ENABLE_POSTDATE_DEBRIEF=false    # desabilitado
ENABLE_POSTDATE_DEBRIEF=test     # só POSTDATE_DEBRIEF_TEST_PHONE
ENABLE_POSTDATE_DEBRIEF=beta     # 10% dos usuários premium/pro (hash-based)
ENABLE_POSTDATE_DEBRIEF=all      # todos
```

## Banco de Dados

Tabela: `postdate_sessions`
- `id`, `phone`, `predate_session_id` (FK opcional para predate_sessions)
- `interview_answers` (JSONB), `assessment_result` (JSONB)
- `outcome_summary` (text curto para loop de aprendizado)
- `encounter_quality`, `next_step`, `model_used`, `created_at`

Migration: `migrations/008_postdate_sessions.sql`

## Custo Estimado

Haiku 4.5 com system prompt cacheado: ~$0.002–0.004 por sessão (~R$0.01–0.02)
