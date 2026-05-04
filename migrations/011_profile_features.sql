-- Migration 011: tabelas para vision features (auditoria de perfil próprio e análise de perfil dela)
-- Criadas em: 2026-05-04
-- Relacionadas a: ENABLE_PROFILE_SELF_AUDIT, ENABLE_PROFILE_HER_ANALYSIS

-- ── profile_audits — auditoria do perfil próprio do usuário ──────────────────
CREATE TABLE IF NOT EXISTS profile_audits (
  id                 BIGSERIAL PRIMARY KEY,
  phone              TEXT NOT NULL,
  platform_detected  TEXT,
  photos_count       INTEGER DEFAULT 0,
  photos_keep        INTEGER DEFAULT 0,
  photos_replace     INTEGER DEFAULT 0,
  photos_remove      INTEGER DEFAULT 0,
  bio_verdict        TEXT,           -- 'great' | 'ok' | 'bad'
  bio_has_text       BOOLEAN DEFAULT false,
  missing_elements   TEXT[]  DEFAULT '{}',
  top_3_changes      TEXT[]  DEFAULT '{}',
  raw_json           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_audits_phone      ON profile_audits (phone);
CREATE INDEX IF NOT EXISTS idx_profile_audits_created_at ON profile_audits (created_at DESC);

-- ── profile_her_analyses — análise do perfil dela ────────────────────────────
CREATE TABLE IF NOT EXISTS profile_her_analyses (
  id                    BIGSERIAL PRIMARY KEY,
  phone                 TEXT NOT NULL,
  platform_detected     TEXT,
  name_detected         TEXT,
  age_detected          TEXT,
  bio_text              TEXT,
  interests_count       INTEGER DEFAULT 0,
  photos_themes         TEXT[]  DEFAULT '{}',
  personality_signals   TEXT[]  DEFAULT '{}',
  potential_hooks_count INTEGER DEFAULT 0,
  risks_count           INTEGER DEFAULT 0,
  has_first_message     BOOLEAN DEFAULT false,
  raw_json              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_her_analyses_phone      ON profile_her_analyses (phone);
CREATE INDEX IF NOT EXISTS idx_profile_her_analyses_created_at ON profile_her_analyses (created_at DESC);
