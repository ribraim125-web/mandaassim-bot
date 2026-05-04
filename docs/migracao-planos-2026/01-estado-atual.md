# Estado Atual do Sistema de Planos — Auditoria (2026-05-03)

> Documento de auditoria. Nenhum código foi alterado. Apenas mapeamento.

---

## 1. Constantes de Plano (`index.js` linhas 64–73)

| Constante | Valor | Descrição |
|-----------|-------|-----------|
| `TRIAL_DAYS` | 3 | Dias de acesso ilimitado após cadastro |
| `SOFT_LIMIT_DAYS` | 5 | Dias 4–5: limite suavizado antes do corte |
| `SOFT_LIMIT` | 10 | Mensagens/dia nos dias 4–5 |
| `POST_TRIAL_LIMIT` | 3 | Mensagens/dia após o dia 5 |
| `PRECO_24H` | 4.99 | Plano 24h |
| `PRECO_MENSAL` | 29.90 | Plano Mensal |
| `PRECO_ANUAL` | 299.00 | Plano Anual |
| `PRECO_WINBACK` | 19.90 | Oferta de volta para ex-premium |
| `PRECO_PRO_LANCAMENTO` | 55.93 | Pro com 30% off para base atual |

---

## 2. Planos Atuais no Banco (`users.plan`)

| Valor | Comportamento |
|-------|--------------|
| `null` / sem plan | Trial: calculado por `created_at` |
| `'premium'` | Wingman Premium — sem limite diário, sem Análise de Perfil |
| `'pro'` | Wingman Pro — sem limite + Análise de Perfil |

**Observação:** Trial não é um valor no banco — é calculado dinamicamente a partir de `created_at`.

---

## 3. Detecção de Plano — `getTrialInfo(phone)` (linhas 962–1005)

Função central. Lê `users.plan`, `users.plan_expires_at`, `users.created_at`.

Retorna:
```js
{
  isPremium: bool,     // premium ou pro ativo
  isPro: bool,         // pro ativo
  inTrial: bool,       // dias 1-3
  inSoftLimit: bool,   // dias 4-5
  trialDaysLeft: int,
  isLastDay: bool,
  dailyLimit: int|null, // null = ilimitado
  expiresAt: string,   // se premium/pro ativo
  expiredAt: string,   // se expirou
}
```

**Problema:** `'premium'` e `'pro'` são os valores de plano aceitos. Não existe `'trial'`, `'free'`, `'wingman'`, `'wingman_pro'` no banco atualmente.

---

## 4. Contagem Diária de Uso

### Tabela: `daily_message_counts`
- Colunas: `phone`, `count_date`, `message_count`, `updated_at`
- `UNIQUE(phone, count_date)`
- Função: `incrementDailyCount(phone)` — upsert, retorna novo total (linhas 1068–1090)

### Contagem mensal global (para tier degradation)
- `getMonthlyCount(phone)` — soma `daily_message_counts` desde dia 1 do mês (linhas 1038–1049)
- Usada em `getModelTier()` para degradar modelos por volume total

### Contagem diária do Haiku (in-memory)
- `haikuDailyUsage` Map: `phone → { date, count }`
- `getHaikuCount(phone)` / `incrementHaikuCount(phone)` (linhas 1143–1154)
- `HAIKU_DAILY_LIMIT = { premium: 10, free: 3 }` (linha 807)

---

## 5. Sistema de Tier Degradation de Modelo (linhas 1051–1066)

```
getModelTier(monthlyCount):
  ≤400 msgs/mês  → 'full'
  401-700         → 'degraded'
  >700            → 'minimal'

getTrialTier(dailyCount):
  ≤20 msgs/dia   → 'full'
  21-50           → 'degraded'
  >50             → 'minimal'

resolveTier(trial, dailyCount, monthlyCount):
  trial.inTrial   → getTrialTier(dailyCount)
  senão           → getModelTier(monthlyCount)
```

**Problema:** Esta lógica degrada qualidade de resposta baseada em volume de uso — não no plano do usuário. Um premium que usa muito recebe modelo pior.

---

## 6. Roteamento de Intent (`INTENT_MODEL_CONFIG`, linhas 568–574)

| Intent | Modelo | MaxTokens | Temp | System |
|--------|--------|-----------|------|--------|
| `one_liner` | gemini-2.0-flash-lite | 80 | 0.90 | minimal |
| `volume` | gemini-2.0-flash | 600 | 0.85 | degraded |
| `premium` | claude-haiku-4-5 (direto) | 450 | 0.80 | full |
| `coaching` | claude-haiku-4-5 (direto) | 600 | 0.75 | coach |
| `ousadia` | meta-llama/llama-4-maverick | 500 | 0.95 | ousadia |

**`capIntentByTier(intent, tier)`** (linhas 582–593): degrada intents por tier:
- `minimal`: premium/ousadia/coaching → volume
- `degraded`: coaching/premium/ousadia → volume
- `full`: tudo liberado

**Observação:** classificador usa `gemini-2.0-flash-001` (não lite) com 10 tokens, temp 0.

---

## 7. Checkpoints de Plano no Fluxo Principal

### 7.1 Rate limiting (linha 1713)
- 4 segundos entre mensagens, independente de plano.

### 7.2 Boas-vindas (linha 1731–1739)
- `upsertUser()` → se novo, manda 3 mensagens de welcome e retorna. Não conta no limite.

### 7.3 Comandos antes da verificação de limite (linhas 1749–1963)
Comandos que rodam **antes** do `getTrialInfo()`:
- `status` — mostra plano + uso do dia
- `premium` — mostra opções de upgrade
- `mensal` / `anual` / `24h` / `voltar` — gera Pix
- `pro` / `wingman pro` / `upgrade` — gera Pix Pro
- `paguei` — verifica pagamento
- Comandos de mindset (`ativar mindset`, `cancelar mindset`, `mindset 1x/3x/5x/diário`, `mindset`)

### 7.4 Verificação principal de limite (linhas 1971–2044)
```
getTrialInfo()   → trial
incrementDailyCount() → todayCount   ← PROBLEMA: incrementa antes de verificar

if isPremium → passa direto
if inTrial:
  todayCount === 1 → aviso informativo (não bloqueia)
else (pós-trial):
  todayCount > dailyLimit → bloqueia + upsell
  todayCount === 1 → agenda follow-up
```

**Problema crítico:** `incrementDailyCount()` é chamado antes de verificar o limite — toda mensagem bloqueada ainda incrementa o contador.

### 7.5 Convite de mindset (linha 2051)
- Fire-and-forget: `if (trial.isPro && isMindsetCapsulesEnabled(phone))`
- Cache `mindsetInviteChecked` Set evita DB em cada mensagem

---

## 8. Verificações por Feature

### Print Analysis (Camada 1)
- Feature flag: `isPrintAnalysisEnabled(phone)` — false|test|beta(10%)|all
- Plano: `!trial.isPremium && !trial.inTrial` → upsell `PRINT_UPSELL_MESSAGE`
- Limite: `checkPrintLimit()` — 5/dia premium, 1/dia trial
- Mensagens: `PRINT_LIMIT_REACHED_PREMIUM`, `PRINT_LIMIT_REACHED_TRIAL`

### Profile Analysis (Camada 2)
- Feature flag: `isProfileAnalysisEnabled(phone)` — false|test|beta(10%)|all
- Plano: `!trial.isPro` → upsell `PROFILE_UPSELL_MESSAGE`
- Limite: `checkProfileLimit()` — 10/dia pro
- Mensagem: `PROFILE_LIMIT_REACHED_PRO`

### Transition Coach (Camada 3)
- Feature flag: `isTransitionCoachEnabled(phone)` — false|test|beta(10%)|all
- Plano free: `TRANSITION_COACH_UPSELL_FREE`
- Plano premium: 2/mês via `getMonthlySessionCount()`, depois `TRANSITION_COACH_UPSELL_PREMIUM_LIMIT`
- Plano pro: ilimitado

### PreDate Coach (Camada 4)
- Feature flag: `isPreDateCoachEnabled(phone)` — false|test|beta(10%)|all
- Plano free: `PREDATE_COACH_UPSELL_FREE`
- Plano premium: 1/mês via `getMonthlyPreDateCount()`, depois `PREDATE_COACH_UPSELL_PREMIUM_LIMIT`
- Plano pro: ilimitado

### PostDate Debrief (Camada 5)
- Feature flag: `isPostdateDebriefEnabled(phone)` — false|test|beta(10%)|all
- Plano free: `POSTDATE_DEBRIEF_UPSELL_FREE`
- Plano premium: 1/mês via `getMonthlyDebriefCount()`, depois `POSTDATE_DEBRIEF_UPSELL_PREMIUM_LIMIT`
- Plano pro: ilimitado

### Mindset Capsules (Camada 6)
- Feature flag: `isMindsetCapsulesEnabled(phone)` — false|test|all (sem beta)
- Exclusivo Pro: verificação explícita em `ativar mindset` e `mindset`

---

## 9. Mensagens de Upsell e Limite (constantes)

| Constante | Trigger |
|-----------|---------|
| `OPCOES_PREMIUM` | Comandos genéricos de upgrade, soft limit esgotado |
| `TRANSICAO_SOFT_LIMIT` | 1ª msg do dia 4 (transição soft limit) |
| `LIMITE_TRIAL_ENDED_MESSAGE` | Pós-trial, sem contexto quente |
| `PRINT_UPSELL_MESSAGE` | Free tenta usar print analysis |
| `PRINT_LIMIT_REACHED_PREMIUM` | Premium atingiu 5 prints/dia |
| `PRINT_LIMIT_REACHED_TRIAL` | Trial atingiu 1 print/dia |
| `PROFILE_UPSELL_MESSAGE` | Não-Pro tenta usar profile analysis |
| `PROFILE_LIMIT_REACHED_PRO` | Pro atingiu 10 perfis/dia |
| `TRANSITION_COACH_UPSELL_FREE` | Free tenta usar transition coach |
| `TRANSITION_COACH_UPSELL_PREMIUM_LIMIT` | Premium esgotou 2 sessões/mês |
| `PREDATE_COACH_UPSELL_FREE` | Free tenta usar predate coach |
| `PREDATE_COACH_UPSELL_PREMIUM_LIMIT` | Premium esgotou 1 sessão/mês |
| `POSTDATE_DEBRIEF_UPSELL_FREE` | Free tenta usar debrief |
| `POSTDATE_DEBRIEF_UPSELL_PREMIUM_LIMIT` | Premium esgotou 1 debrief/mês |
| `MENSAGEM_RENOVACAO` | (inline no `client.on('ready')`) — aviso 3 dias antes de expirar |

---

## 10. Upsell no Pico Emocional

**`upsellPicoPremium(message, trial, todayCount)`** (linhas 1578–1612):
- Último dia do trial + ≥3 msgs → oferta contextual
- Soft limit: restam 2 → aviso
- Pós-trial: última msg do dia → aviso

**`contadorRestante(message, trial, todayCount)`** (linhas 1567–1576):
- Metade do limite ou menos restante → mostra contador `X/Y análises`

---

## 11. Win-Back

**`verificarWinback(phone, expiredAt)`** (linhas 1011–1035):
- Janela: 2–15 dias após expirar
- Sorteia `winback_unlock_at` no banco (1x por usuário)
- Se dentro da janela e desbloqueado → oferta R$19,90 (`voltar`)

---

## 12. Pagamentos

- Tabela `payments`: `phone`, `mp_payment_id`, `status`, `created_at`
- Webhook MercadoPago em `src/webhook.js` — ativa plano automaticamente
- Comando `paguei` — consulta MP direto se `pending`
- `determinarPlano(amount)` em `src/mercadopago.js` — retorna `{ plan, days }`
  - R$4,99 → `premium` 1 dia
  - R$19,90 → `premium` 30 dias
  - R$29,90 → `premium` 30 dias
  - R$299,00 → `premium` 365 dias
  - R$79,90 → `pro` 30 dias

---

## 13. Problemas Identificados para a Migração

1. **Trial não é estado no banco** — calculado dinamicamente por `created_at`. Dificulta auditoria e análise.
2. **incrementDailyCount antes da verificação** — toda msg bloqueada ainda conta no total.
3. **Tier degradation por volume** — premium usa modelo pior se usar muito. Não é intuitivo.
4. **Haiku limit (in-memory)** — reseta se o processo reiniciar. Não é persistido.
5. **daily_message_counts ≠ daily_usage por feature** — contador genérico não distingue qual feature foi usada.
6. **Nomes de plano inconsistentes** — banco usa `'premium'`/`'pro'`, UI fala "Wingman Premium"/"Wingman Pro". Migração alinhará.
7. **`SOFT_LIMIT_DAYS` e `SOFT_LIMIT`** — lógica de dias 4–5 será eliminada no novo sistema (Free = 3 msgs/dia flat).
