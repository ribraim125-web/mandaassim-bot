# Audit — Predate Coach + Postdate Debrief
**Data:** 2026-05-05  
**Auditado por:** Claude (spike/vision-features)

---

## Conclusão principal

> **O routing JÁ ESTÁ implementado no index.js.** State machines, keywords, upsells, imports das libs — tudo presente. A spec descrevia trabalho que já foi feito. Há apenas 3 blockers reais para a feature funcionar.

---

## Blockers ativos (os únicos 3 problemas reais)

| # | Problema | Impacto | Fix |
|---|----------|---------|-----|
| 1 | `isPreDateCoachEnabled` e `isPostdateDebriefEnabled` testam modes `'all'/'test'/'beta'` mas a flag lê `true`/`false` — `ENABLE_PREDATE_COACH=true` vira mode `'true'`, cai em `default: return false` | Feature nunca ativa mesmo com flag ligada | Adicionar `case 'true': return true;` nos dois switches — **1 linha cada** |
| 2 | Migration 008 não rodada — tabela `postdate_sessions` não existe | `postdateDebrief.js` quebra em runtime ao tentar salvar sessão | Rodar `migrations/008_postdate_sessions.sql` no Supabase |
| 3 | `ENABLE_PREDATE_COACH` e `ENABLE_POSTDATE_DEBRIEF` não estão no `.env` do servidor | Feature sempre desligada em produção | Adicionar as vars com valor `false` ao `.env` |

---

## a) src/lib/predateCoach.js

### Funções exportadas

| Função | Parâmetros | Retorno |
|--------|------------|---------|
| `INTERVIEW_QUESTIONS_PREDATE` | — (array constante) | `string[]` — 4 perguntas |
| `analisarPreDateComHaiku(answers, girlContext, phone)` | `answers: {0:str, 1:str, 2:str, 3:str}`, `girlContext: string`, `phone: string` | `Promise<{ messages: string[], result: object, metrics: object, sessionId: string\|null, dateParsed: Date\|null }>` |
| `formatarRespostaPreDate(result)` | `result: object` (JSON do Haiku) | `string[]` — 4 mensagens WhatsApp formatadas |
| `parsearDataEncontro(texto)` | `texto: string` | `Promise<Date\|null>` |
| `salvarPreDateSessao(phone, answers, result, dateParsed)` | todos strings/objects | `Promise<string\|null>` (UUID do row) |
| `getMonthlyPreDateCount(phone)` | `phone: string` | `Promise<number>` |
| `atualizarDebriefEnviado(phone)` | `phone: string` | `Promise<void>` |

### Dependências externas
- `@anthropic-ai/sdk` — chamada principal (Haiku 4.5)
- `openai` via OpenRouter — parse de data (gemini-2.0-flash-lite-001)
- `@supabase/supabase-js` — persistência em `predate_sessions`
- `./tracking` — `logApiRequest`

### TODOs / pendências internas
Nenhum. Lib completa, sem comentários pendentes.

### Intents esperados
`'predate_coach'` — apenas para logging de tracking. Não tem roteamento interno.

---

## b) src/lib/postdateDebrief.js

### Funções exportadas

| Função | Parâmetros | Retorno |
|--------|------------|---------|
| `INTERVIEW_QUESTIONS_DEBRIEF` | — (array constante) | `string[]` — 7 perguntas |
| `analisarDebriefComHaiku(answers, phone)` | `answers: {0:str..6:str}`, `phone: string` | `Promise<{ messages: string[], result: object, metrics: object, sessionId: string\|null }>` |
| `formatarRespostaDebrief(result)` | `result: object` (JSON do Haiku) | `string[]` — até 4 mensagens WhatsApp |
| `salvarDebriefSessao(phone, answers, result)` | todos strings/objects | `Promise<string\|null>` (UUID) |
| `temDebriefPendente(phone)` | `phone: string` | `Promise<boolean>` — true se há predate recente sem debrief |
| `getMonthlyDebriefCount(phone)` | `phone: string` | `Promise<number>` |
| `getLastDebriefInsight(phone)` | `phone: string` | `Promise<string\|null>` — contexto do último debrief para alimentar pré-date (loop de aprendizado) |

### Dependências externas
- `@anthropic-ai/sdk` — chamada principal (Haiku 4.5)
- `@supabase/supabase-js` — persistência em `postdate_sessions` + lookup em `predate_sessions`
- `./tracking` — `logApiRequest`

### TODOs / pendências internas
Nenhum. Lib completa.

### Intents esperados
`'postdate_debrief'` — apenas para logging.

---

## c) migrations/007_predate_sessions.sql — schema

```sql
predate_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             TEXT NOT NULL,
  interview_answers JSONB,
  assessment_result JSONB,
  date_parsed       TIMESTAMPTZ,         -- data do encontro (parseada)
  location_summary  TEXT,
  location_type     TEXT,                -- 'café'|'restaurante'|'bar'|'atividade'|'desconhecido'
  is_first_date     BOOLEAN,
  model_used        TEXT,
  debrief_sent_at   TIMESTAMPTZ,         -- quando o bot perguntou "como foi?"
  debrief_response  TEXT,
  encontro_aconteceu BOOLEAN,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

**Status:** Rodada com sucesso em 2026-05-05. Tabela confirmada existente no banco.

---

## d) migrations/008_postdate_sessions.sql — schema

```sql
postdate_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone              TEXT NOT NULL,
  predate_session_id UUID REFERENCES predate_sessions(id) ON DELETE SET NULL,
  interview_answers  JSONB,
  assessment_result  JSONB,
  outcome_summary    TEXT,               -- resumo legível para loop de aprendizado
  encounter_quality  TEXT,               -- great|good|neutral|poor|unclear
  next_step          TEXT,
  model_used         TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

**Status:** NÃO RODADA. Tabela não existe no banco.

---

## O que já está implementado no index.js

| Componente | Status | Localização |
|-----------|--------|-------------|
| Import das libs | ✅ | index.js:60-70 |
| `PREDATE_COACH_KEYWORDS` regex | ✅ | index.js:1386 |
| `POSTDATE_DEBRIEF_KEYWORDS` regex | ✅ | index.js:1387 |
| `POSTDATE_AUTO_TRIGGER_PATTERNS` regex | ✅ | index.js:1389 |
| `isPreDateCoachEnabled(phone)` | ✅ (com bug de mode) | index.js:1455 |
| `isPostdateDebriefEnabled(phone)` | ✅ (com bug de mode) | index.js:1470 |
| Upsell free para predate | ✅ | index.js:193 |
| Upsell free para debrief | ✅ | index.js:203 |
| State machine predate (entrevista) | ✅ | index.js:2317-2362 |
| State machine debrief (entrevista) | ✅ | index.js:2364-2415 |
| Trigger keyword → inicia predate | ✅ | index.js:2528-2553 |
| Trigger keyword → inicia debrief | ✅ | index.js:2555-2579 |
| Trigger proativo debrief pendente | ✅ | index.js:2581-2599 |
| Loop de aprendizado debrief→predate | ✅ | index.js:2338-2342 |
| Agendamento de lembretes pré-date | ✅ | index.js:2350-2355 |

---

## O que NÃO precisa ser feito (já está pronto)

- ~~Adicionar detecção de intent no classificador~~ — keyword matching já existe
- ~~Conectar ao router de intent~~ — routing já existe no index.js
- ~~Criar state machines~~ — já implementadas
- ~~Criar upsell messages~~ — já existem
- ~~Importar as libs~~ — já importadas

---

## Plano de execução real (simplificado)

**PR 1 — Fix do mode check (1 linha por função) + Migration 008 + .env vars**

1. `index.js:1457` — adicionar `case 'true': return true;` em `isPreDateCoachEnabled`
2. `index.js:1472` — idem em `isPostdateDebriefEnabled`
3. Rodar `migrations/008_postdate_sessions.sql` no Supabase
4. Adicionar ao `.env`: `ENABLE_PREDATE_COACH=false` e `ENABLE_POSTDATE_DEBRIEF=false`

**Total de linhas de código alteradas: 2**
