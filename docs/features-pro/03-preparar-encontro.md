# Feature Pro: Preparar pro Encontro

Coach de preparação para encontros presenciais. Usuário descreve quando/onde vai ser — bot entrega um plano prático em 4 mensagens.

## Plano

**Wingman Pro only** — sem teaser para Wingman básico.

## Trigger

Detecção de keyword no texto (regex `PREDATE_COACH_KEYWORDS`):
- "tenho encontro", "marquei encontro", "vou encontrar ela"
- "encontro amanhã/hoje/sábado/..."
- "encontro marcado", "encontro essa semana"
- Comando explícito: "preparar encontro"

## Mini-entrevista (4 perguntas)

Perguntas em sequência, uma por vez:

1. Quando é o encontro? (data/hora)
2. Onde vai ser? (tipo de lugar)
3. É a primeira vez que vocês se encontram pessoalmente?
4. Tem alguma coisa específica te preocupando?

Estado guardado em `userContext.predateCoachState` (in-memory).

## Output — 4 mensagens WhatsApp

**Msg 1 — Checklist do dia:**
- Roupa certa pro local/horário (Haiku gera specific)
- Detalhes: barba, perfume, cartão/dinheiro
- Checklist de chegada: 5 min antes, celular no bolso

**Msg 2 — Conversa:**
- 3-4 tópicos personalizados (usa perfil dela se houver)
- Tópicos a evitar
- Limite de bebida
- Duração ideal + como encerrar em alta

**Msg 3 — Pós-encontro:**
- Mensagem específica pra mandar em 1-3h
- "NÃO manda carta longa / NÃO insiste"

**Msg 4 — Incentivo:**
- 2-4 linhas, tom de amigo direto
- Pode mencionar coragem do encontro se for primeiro

## Lembretes agendados

Disparados automaticamente se o bot consegue parsear a data (`parsearDataEncontro` via Gemini Flash Lite):

| Lembrete | Timing | Conteúdo |
|----------|--------|----------|
| Dia anterior | encontroDate - 24h | Dica de roupa + confirmar local (personalizada da sessão) |
| 2h antes | encontroDate - 2h | "Guarda o celular quando ela chegar, foca nela" |
| Debrief | encontroDate + 10h | "Como foi? Me conta →" (trigger pro Debrief) |

Usuário pode cancelar com: **PARAR**

## Tom — regras absolutas

- Pé-no-chão, prático, brasileiro
- PROIBIDO: "respira fundo", "conecta com seu eu interior", "trabalhe sua autoestima"
- Tópicos de conversa sempre específicos — nunca genéricos
- Roupa: casual-arrumado é o padrão; adapta pro local

## Loop de aprendizado

O Coach Pré-Date injeta o contexto do último Debrief na análise:
```js
const lastDebriefCtx = await getLastDebriefInsight(phone);
// → "Último encontro: avaliação 'good'. Melhorar: criou tensão tarde demais."
// Enviado como contexto adicional pro Haiku
```

## Persistência

Tabela: `predate_sessions`
- `interview_answers` (JSONB)
- `assessment_result` (JSONB com JSON completo do Haiku)
- `date_parsed` (TIMESTAMPTZ — parseado pelo Gemini)
- `location_type`, `location_summary`, `is_first_date`
- `debrief_sent_at` (quando o follow-up foi enviado)

## Feature flags

```env
ENABLE_PREDATE_COACH=false   # false | test | all
PREDATE_COACH_TEST_PHONE=    # número de teste quando ENABLE_PREDATE_COACH=test
```

## Custo estimado

- Haiku 4.5: ~600 tokens input + ~600 output = ~$0.004 USD ≈ R$0,02
- Gemini Flash Lite (parse de data): ~50 tokens = desprezível
- Total por sessão: < R$0,05 (target: < R$0,80)

## Critérios de aceitação

- [ ] 5 sessões de teste com datas diferentes (amanhã, semana que vem, sem data)
- [ ] Lembretes disparando nos horários corretos
- [ ] Tom honesto e direto validado
- [ ] Loop com Debrief retornando insight correto
- [ ] Custo médio < R$0,80/sessão

## Arquivos relevantes

```
src/lib/predateCoach.js          — lógica Haiku, formatação, persistência
src/followup/followupScheduler.js — schedulePredateReminders()
src/followup/followupWorker.js   — predate_reminder_*, predate_debrief
src/followup/followupMessages.js — textos dos lembretes
migrations/007_predate_sessions.sql
```
