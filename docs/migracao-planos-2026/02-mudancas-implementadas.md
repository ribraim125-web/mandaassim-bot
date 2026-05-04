# Mudanças Implementadas — Reestruturação de Planos 2026

> Changelog da migração. Para o estado anterior, ver `01-estado-atual.md`.

---

## Resumo

Sistema de planos migrado de 4 estados implícitos + degradação de tier para **4 planos explícitos + limites declarativos por feature**.

---

## PR 1 — Database (`migrations/010_plan_restructure.sql`)

### Colunas adicionadas em `users`
- `trial_started_at TIMESTAMPTZ` — data de cadastro (= início do trial)
- `trial_ended_at TIMESTAMPTZ` — quando o trial expirou
- `plan_started_at TIMESTAMPTZ` — quando o plano atual começou

### Migração de valores de `plan`
| Antes | Depois |
|-------|--------|
| `NULL` (< 3 dias) | `'trial'` |
| `NULL` (≥ 3 dias) | `'free'` |
| `'premium'` | `'wingman'` |
| `'pro'` | `'wingman_pro'` |

### Nova tabela `daily_usage`
```sql
CREATE TABLE daily_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  usage_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  feature_key TEXT NOT NULL,
  count       INT  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone, usage_date, feature_key)
);
```
- Substitui `daily_message_counts` (mantida por compatibilidade de dashboard)
- `feature_key` válidos: `messages` | `print_analysis` | `profile_analysis` | `transition_coach` | `predate_coach` | `postdate_debrief`
- Dados migrados de `daily_message_counts` como `feature_key = 'messages'`

---

## PR 2 — Lógica de Features (`src/config/features.js`)

Novo arquivo com matriz declarativa de limites e upsell por plano.

**Exports:**
- `FEATURES` — objeto com limites por plano e feature
- `canUseFeature(phone, plan, featureKey)` → `{ allowed, reason, remaining, upsellMessage }`
- `incrementFeatureUsage(phone, featureKey)` → novo total do dia
- `getDailyUsage(phone, featureKey)` → count atual
- `getMonthlyUsage(phone, featureKey)` → count do mês

**Benefício:** upsell messages, limites e regras de acesso centralizadas em um único lugar. Antes estavam espalhadas em 10+ constantes em `index.js`.

---

## PR 3 — Roteamento de Intent (sem tier degradation)

### Removido
- `getModelTier(monthlyCount)` — degradava modelo por volume mensal
- `getTrialTier(dailyCount)` — degradava modelo por volume diário
- `resolveTier(trial, dailyCount, monthlyCount)` — combinava os dois
- `capIntentByTier(intent, tier)` — cortava intent premium → volume
- `HAIKU_DAILY_LIMIT` — limite diário de chamadas ao Haiku (in-memory)
- `haikuDailyUsage` Map — contador in-memory (perdia ao reiniciar)
- `getHaikuCount` / `incrementHaikuCount` — funções de contador
- `getMonthlyCount` — count mensal do banco (só servia para tier)
- `MODELS`, `MAX_TOKENS` — constantes de degradação

### Adicionado
- `HAIKU_MODEL = 'anthropic/claude-haiku-4-5-20251001'`
- `HAIKU_FALLBACK = 'google/gemini-2.0-flash-001'`
- `IMAGE_ANALYSIS_MODEL = 'google/gemini-2.0-flash-001'`

### INTENT_MODEL_CONFIG atualizado
Todos os intents (`one_liner`, `volume`, `premium`, `coaching`, `ousadia`) → Haiku 4.5 direto.
Fallback único se Anthropic cair: Gemini Flash.

### Assinatura simplificada
```js
// Antes
analisarTextoComClaude(situacao, contextoExtra, girlContext, usageTier, phone, recentSuccess, isPremium)

// Depois
analisarTextoComClaude(situacao, contextoExtra, girlContext, phone)
```

**Impacto:** todos os usuários (free, trial, wingman, pro) recebem a mesma qualidade de resposta. Custo controlado pelo limite de mensagens por plano, não por degradação silenciosa de modelo.

---

## PR 4 — Limites + Upsell + Trial→Free

### Removido
- `SOFT_LIMIT_DAYS = 5` — fase de dias 4-5 com 10 msgs/dia eliminada
- `SOFT_LIMIT = 10` — limite da fase soft
- `POST_TRIAL_LIMIT = 3` → renomeado para `FREE_DAILY_LIMIT = 3`
- `TRANSICAO_SOFT_LIMIT` — mensagem da transição soft limit
- `LIMITE_TRIAL_ENDED_MESSAGE` — substituída por `LIMITE_FREE_ESGOTADO`
- `scheduleLimitDrop10`, `scheduleLimitExhausted10` — follow-ups do soft limit
- `getMonthlyCount` — servia só para tier (removida em PR 3)
- `inSoftLimit` e `dailyLimit` de `getTrialInfo` — não mais necessários

### Adicionado em `getTrialInfo`
- `trialHoursLeft` — horas restantes do trial (float)
- `lastHours` — boolean: `trialHoursLeft < 2` (últimas 2 horas)
- `planKey` — string explícita: `'trial'` | `'free'` | `'wingman'` | `'wingman_pro'`
- Transição lazy trial→free: atualiza o banco fire-and-forget na primeira mensagem após expirar

### Novo fluxo de limite (PR 4)
```
Antes:
  incrementDailyCount() → verifica → bloqueia (mas já incrementou!)

Depois:
  canUseFeature(phone, planKey, 'messages') → bloqueia se negado
  incrementFeatureUsage(phone, 'messages') → só conta mensagens que passaram
  incrementDailyCount() → dual-write para manter dashboard
```

**Bug corrigido:** contador não mais incrementado em mensagens bloqueadas.

### Mensagens de trial atualizadas
- `lastHours`: avisa que fecha em < 2h
- `isLastDay`: avisa último dia (sem mencionar soft limit)
- Outros dias: `"X dia(s) de acesso ilimitado"`

---

## PR 5 — Docs + Cleanup

### Arquivos criados
- `docs/planos.md` — referência definitiva dos 4 planos
- `docs/migracao-planos-2026/01-estado-atual.md` — auditoria do sistema anterior
- `docs/migracao-planos-2026/02-mudancas-implementadas.md` — este arquivo

---

## Pendências Pós-Deploy

### Rodar antes de reiniciar o bot
```sql
-- Supabase SQL Editor
\i migrations/010_plan_restructure.sql
```

### Verificar depois
```sql
-- Distribuição de planos
SELECT plan, count(*) FROM users GROUP BY plan ORDER BY plan;

-- Uso diário por feature
SELECT feature_key, count(*), sum(count) FROM daily_usage GROUP BY feature_key;
```

### Dashboard admin (webhook.js)
O dashboard ainda lê `daily_message_counts`. Durante a transição, `index.js` faz dual-write (`incrementDailyCount` + `incrementFeatureUsage`). Quando o dashboard for atualizado para ler `daily_usage`, o dual-write pode ser removido.

---

## Compatibilidade Retroativa

`getTrialInfo()` aceita tanto nomes novos quanto legados:
- `'premium'` → tratado como `'wingman'`
- `'pro'` → tratado como `'wingman_pro'`

Usuários com `plan = NULL` no banco (se houver algum que não foi migrado) ainda funcionam — são calculados por `created_at` como antes.
