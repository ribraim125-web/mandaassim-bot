-- Migration 002: acquisition tracking
-- Rastreia de onde cada usuário chegou (canal, campanha, link específico)
-- Roda no Supabase SQL Editor (Settings → SQL Editor → New query)

-- ---------------------------------------------------------------------------
-- Campos de atribuição na tabela users
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_source       TEXT;        -- 'instagram' | 'tiktok' | 'direct' | 'organic'
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_medium       TEXT;        -- 'reel' | 'story' | 'bio' | 'direct'
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_campaign     TEXT;        -- slug livre, ex: 'reel_001'
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_first_seen_at TIMESTAMPTZ; -- quando chegou (primeira mensagem)

-- ---------------------------------------------------------------------------
-- Tabela de links de rastreamento
-- Cada entrada representa um link wa.me/?text=mandaassim_<slug>
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS acquisition_links (
  slug        TEXT        PRIMARY KEY,          -- identificador único, ex: 'instagram_reel_001'
  source      TEXT        NOT NULL,             -- canal: 'instagram', 'tiktok', 'youtube', etc.
  medium      TEXT        NOT NULL,             -- formato: 'reel', 'story', 'bio', 'post'
  campaign    TEXT,                             -- nome livre da campanha (opcional)
  notes       TEXT,                             -- descrição do link (ex: 'Reel sobre abordagem')
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para analytics por source/medium
CREATE INDEX IF NOT EXISTS idx_acquisition_links_source
  ON acquisition_links (source, medium);

-- Índice para busca de usuários por origem
CREATE INDEX IF NOT EXISTS idx_users_acquisition_source
  ON users (acquisition_source);

-- ---------------------------------------------------------------------------
-- View de atribuição por canal (últimos 30 dias)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW acquisition_summary_30d AS
SELECT
  COALESCE(u.acquisition_source, 'unknown')    AS source,
  COALESCE(u.acquisition_medium, 'unknown')    AS medium,
  COALESCE(u.acquisition_campaign, 'none')     AS campaign,
  COUNT(DISTINCT u.phone)                      AS signups,
  COUNT(DISTINCT p.phone)                      AS conversions,
  ROUND(
    100.0 * COUNT(DISTINCT p.phone) /
    NULLIF(COUNT(DISTINCT u.phone), 0), 1
  )                                            AS conversion_rate_pct
FROM users u
LEFT JOIN payments p
  ON p.phone = u.phone
  AND p.status = 'approved'
WHERE u.created_at >= NOW() - INTERVAL '30 days'
GROUP BY
  COALESCE(u.acquisition_source, 'unknown'),
  COALESCE(u.acquisition_medium, 'unknown'),
  COALESCE(u.acquisition_campaign, 'none')
ORDER BY signups DESC;
