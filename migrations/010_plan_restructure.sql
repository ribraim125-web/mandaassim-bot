-- =============================================================================
-- Migration 010 — Reestruturação de Planos
-- =============================================================================
-- Novos nomes de plano: trial | free | wingman | wingman_pro
-- Substitui: null/premium/pro (valores legados)
--
-- RODAR NESTA ORDEM:
--   1. Adiciona colunas novas
--   2. Popula datas
--   3. Migra valores de plan
--   4. Cria tabela daily_usage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Novos campos de timestamp na tabela users
-- -----------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ended_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_started_at  TIMESTAMPTZ;

-- trial_started_at = data de cadastro para todos os usuários
UPDATE users
SET trial_started_at = created_at
WHERE trial_started_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Migra planos pagos: premium → wingman, pro → wingman_pro
-- -----------------------------------------------------------------------------

UPDATE users SET plan = 'wingman'
WHERE plan = 'premium';

UPDATE users SET plan = 'wingman_pro'
WHERE plan = 'pro';

-- plan_started_at para quem já tem plano pago
-- Estimativa: plan_expires_at − 30 dias (ou created_at se não tiver)
UPDATE users
SET plan_started_at = COALESCE(
  plan_expires_at - INTERVAL '30 days',
  created_at
)
WHERE plan IN ('wingman', 'wingman_pro')
  AND plan_started_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Classifica usuários sem plano pago em trial ou free
-- -----------------------------------------------------------------------------

-- Trial: cadastrado há menos de 3 dias
UPDATE users
SET
  plan            = 'trial',
  plan_started_at = created_at
WHERE plan IS NULL
  AND created_at > NOW() - INTERVAL '3 days';

-- Free: cadastrado há 3+ dias sem plano pago
UPDATE users
SET
  plan            = 'free',
  plan_started_at = created_at + INTERVAL '3 days',
  trial_ended_at  = created_at + INTERVAL '3 days'
WHERE plan IS NULL
  AND created_at <= NOW() - INTERVAL '3 days';

-- -----------------------------------------------------------------------------
-- 4. Tabela daily_usage — contador por phone + data + feature_key
--    Substitui daily_message_counts (mantida por enquanto para rollback seguro)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_usage (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT        NOT NULL,
  usage_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  feature_key  TEXT        NOT NULL,
  -- feature_key válidos: 'messages' | 'print_analysis' | 'profile_analysis'
  --   | 'transition_coach' | 'predate_coach' | 'postdate_debrief'
  count        INT         NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone, usage_date, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_phone_date
  ON daily_usage (phone, usage_date);

CREATE INDEX IF NOT EXISTS idx_daily_usage_phone_feature
  ON daily_usage (phone, feature_key);

-- -----------------------------------------------------------------------------
-- 5. Migra dados existentes de daily_message_counts → daily_usage
--    como feature_key = 'messages' (para não perder histórico)
-- -----------------------------------------------------------------------------

INSERT INTO daily_usage (phone, usage_date, feature_key, count, updated_at)
SELECT
  phone,
  count_date::DATE,
  'messages',
  message_count,
  updated_at
FROM daily_message_counts
ON CONFLICT (phone, usage_date, feature_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Verificação final (rode pra conferir)
-- -----------------------------------------------------------------------------
-- SELECT plan, count(*) FROM users GROUP BY plan ORDER BY plan;
-- SELECT feature_key, count(*), sum(count) FROM daily_usage GROUP BY feature_key;
