-- Migration 019: Lifecycle, Referrals e NPS
--
-- Adiciona suporte a:
-- - Referências (código único por usuário)
-- - NPS responses (score 0-10)
-- - Colunas de ciclo de vida: paused_until, plan_start_paid_at, awaiting_nps
--
-- Execute no Supabase SQL Editor.
-- Idempotente: usa IF NOT EXISTS e ADD COLUMN IF NOT EXISTS.

-- ── Colunas novas na tabela users ─────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS paused_until         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_start_paid_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS awaiting_nps         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code        VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by          TEXT;  -- phone do referral que indicou

-- ── Tabela de respostas NPS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nps_responses (
  id           BIGSERIAL    PRIMARY KEY,
  phone        TEXT         NOT NULL,
  score        INT          NOT NULL CHECK (score >= 0 AND score <= 10),
  cycle_month  INT          NOT NULL DEFAULT 1,
  referral_invite_sent_at TIMESTAMPTZ,
  feedback_text TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nps_phone      ON nps_responses (phone);
CREATE INDEX IF NOT EXISTS idx_nps_score      ON nps_responses (score);
CREATE INDEX IF NOT EXISTS idx_nps_created_at ON nps_responses (created_at DESC);

-- ── Tabela de indicações ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id              BIGSERIAL    PRIMARY KEY,
  referrer_phone  TEXT         NOT NULL,
  referral_code   VARCHAR(12)  NOT NULL UNIQUE,
  referred_phone  TEXT,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    -- pending | converted | expired
  reward_credited BOOLEAN      NOT NULL DEFAULT FALSE,
  converted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_phone);
CREATE INDEX IF NOT EXISTS idx_referrals_code     ON referrals (referral_code);

-- ── View: NPS summary por mês ──────────────────────────────────────────────
CREATE OR REPLACE VIEW nps_summary AS
SELECT
  cycle_month,
  COUNT(*)                         AS total_responses,
  ROUND(AVG(score), 1)             AS avg_score,
  COUNT(*) FILTER (WHERE score >= 9) AS promoters,
  COUNT(*) FILTER (WHERE score BETWEEN 7 AND 8) AS passives,
  COUNT(*) FILTER (WHERE score <= 6) AS detractors,
  ROUND(
    100.0 * (COUNT(*) FILTER (WHERE score >= 9) - COUNT(*) FILTER (WHERE score <= 6))
    / NULLIF(COUNT(*), 0), 1
  ) AS nps_score
FROM nps_responses
GROUP BY cycle_month
ORDER BY cycle_month DESC;
