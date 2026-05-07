-- Migration 018: Feature Discovery State
--
-- Rastreia em que ponto cada usuário está na descoberta das 6 funcionalidades
-- do MandaAssim. Alimenta o Feature Discovery Engine (revelação progressiva
-- por evento) e o A/B test entre variantes event-driven vs time-driven.
--
-- Execute no Supabase SQL Editor.
-- Idempotente: usa IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS feature_discovery_state (
  phone             TEXT         PRIMARY KEY,
  total_analyses    INT          NOT NULL DEFAULT 0,

  -- Timestamps de primeira uso por feature
  f1_used_at        TIMESTAMPTZ,
  f2_used_at        TIMESTAMPTZ,
  f3_used_at        TIMESTAMPTZ,
  f4_used_at        TIMESTAMPTZ,
  f5_used_at        TIMESTAMPTZ,
  f6_used_at        TIMESTAMPTZ,

  -- Timestamps de quando a revelação foi enviada
  f1_revealed_at    TIMESTAMPTZ,
  f2_revealed_at    TIMESTAMPTZ,
  f3_revealed_at    TIMESTAMPTZ,
  f4_revealed_at    TIMESTAMPTZ,
  f5_revealed_at    TIMESTAMPTZ,
  f6_revealed_at    TIMESTAMPTZ,

  -- Trial
  trial_start_at    TIMESTAMPTZ,
  trial_end_at      TIMESTAMPTZ,
  is_paid           BOOLEAN      NOT NULL DEFAULT FALSE,

  -- A/B variant: 'event' | 'time' | 'control'
  ab_variant        VARCHAR(16),

  -- Último evento registrado (debug)
  last_event        VARCHAR(64),

  -- Nudge de inatividade (10 min após welcome)
  nudge_sent_at     TIMESTAMPTZ,

  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índices para queries de análise/funil
CREATE INDEX IF NOT EXISTS idx_fds_ab_variant      ON feature_discovery_state (ab_variant);
CREATE INDEX IF NOT EXISTS idx_fds_total_analyses  ON feature_discovery_state (total_analyses);
CREATE INDEX IF NOT EXISTS idx_fds_updated_at      ON feature_discovery_state (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fds_is_paid         ON feature_discovery_state (is_paid);

-- View: Feature Discovery Rate por feature (para dashboard)
CREATE OR REPLACE VIEW fds_discovery_rate AS
SELECT
  ab_variant,
  COUNT(*)                                           AS total_users,
  COUNT(*) FILTER (WHERE total_analyses >= 1)        AS activated,
  COUNT(*) FILTER (WHERE f2_revealed_at IS NOT NULL) AS f2_revealed,
  COUNT(*) FILTER (WHERE f2_used_at     IS NOT NULL) AS f2_used,
  COUNT(*) FILTER (WHERE f3_revealed_at IS NOT NULL) AS f3_revealed,
  COUNT(*) FILTER (WHERE f3_used_at     IS NOT NULL) AS f3_used,
  COUNT(*) FILTER (WHERE f4_revealed_at IS NOT NULL) AS f4_revealed,
  COUNT(*) FILTER (WHERE f4_used_at     IS NOT NULL) AS f4_used,
  COUNT(*) FILTER (WHERE f5_revealed_at IS NOT NULL) AS f5_revealed,
  COUNT(*) FILTER (WHERE f5_used_at     IS NOT NULL) AS f5_used,
  COUNT(*) FILTER (WHERE f6_revealed_at IS NOT NULL) AS f6_revealed,
  COUNT(*) FILTER (WHERE f6_used_at     IS NOT NULL) AS f6_used,
  COUNT(*) FILTER (WHERE is_paid = TRUE)             AS converted_to_paid,

  -- Rates
  ROUND(100.0 * COUNT(*) FILTER (WHERE f2_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f2_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f4_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f4_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f5_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f5_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f6_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f6_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_paid = TRUE)             / NULLIF(COUNT(*) FILTER (WHERE total_analyses >= 1), 0), 1) AS trial_to_paid_pct

FROM feature_discovery_state
GROUP BY ab_variant;
