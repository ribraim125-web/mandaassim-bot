-- Migration 013: sistema de narrativa progressiva
-- 2026-05-04

-- ── user_journey_events — eventos comportamentais por usuário ─────────────────
CREATE TABLE IF NOT EXISTS user_journey_events (
  id          BIGSERIAL   PRIMARY KEY,
  phone       TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,
  event_data  JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uje_phone      ON user_journey_events (phone);
CREATE INDEX IF NOT EXISTS idx_uje_event_type ON user_journey_events (phone, event_type);
CREATE INDEX IF NOT EXISTS idx_uje_created_at ON user_journey_events (created_at DESC);

-- ── narrative_messages_log — atos disparados, variante A/B e outcome ──────────
CREATE TABLE IF NOT EXISTS narrative_messages_log (
  id                  BIGSERIAL   PRIMARY KEY,
  phone               TEXT        NOT NULL,
  act_id              TEXT        NOT NULL,
  variant             TEXT        NOT NULL DEFAULT 'A',
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_responded      BOOLEAN     NOT NULL DEFAULT false,
  responded_at        TIMESTAMPTZ,
  conversion_outcome  TEXT        -- 'uploaded_profile' | 'subscribed_pro' | 'ignored' | 'responded' | null
);

CREATE INDEX IF NOT EXISTS idx_nml_phone  ON narrative_messages_log (phone);
CREATE INDEX IF NOT EXISTS idx_nml_act_id ON narrative_messages_log (act_id);
CREATE INDEX IF NOT EXISTS idx_nml_sent   ON narrative_messages_log (sent_at DESC);

-- Garante que cada ato seja enviado no máximo 1x por usuário
CREATE UNIQUE INDEX IF NOT EXISTS idx_nml_phone_act ON narrative_messages_log (phone, act_id);
