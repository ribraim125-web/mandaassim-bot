-- Migration 004: tabela de análises de perfis
-- Armazena o resultado estruturado (JSON) de cada análise de perfil.
-- A imagem NÃO é armazenada (privacidade).
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS profile_analyses (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone                  text        NOT NULL,
  platform_detected      text,                -- 'tinder' | 'bumble' | 'instagram' | 'hinge' | 'unknown'
  name_detected          text,
  age_detected           text,
  bio_text               text,
  interests_count        int,
  photos_themes          text[],              -- array: ['viagem', 'pet', 'academia', ...]
  personality_signals    text[],              -- array: ['aventureira', 'intelectual', ...]
  potential_hooks_count  int,
  risks_count            int,
  has_first_message      boolean,
  raw_json               jsonb,               -- JSON completo retornado pelo Haiku
  created_at             timestamptz DEFAULT now()
);

-- Índices para analytics
CREATE INDEX IF NOT EXISTS idx_profile_analyses_phone      ON profile_analyses (phone);
CREATE INDEX IF NOT EXISTS idx_profile_analyses_created_at ON profile_analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_analyses_platform   ON profile_analyses (platform_detected);

-- Row Level Security
ALTER TABLE profile_analyses ENABLE ROW LEVEL SECURITY;

-- View de resumo (últimos 30 dias)
CREATE OR REPLACE VIEW profile_analyses_summary_30d AS
SELECT
  platform_detected,
  COUNT(*)                                   AS total_analyses,
  COUNT(DISTINCT phone)                      AS unique_users,
  COUNT(*) FILTER (WHERE has_first_message)  AS with_first_message,
  ROUND(AVG(potential_hooks_count), 1)       AS avg_hooks_found,
  ROUND(AVG(interests_count), 1)             AS avg_interests_detected
FROM profile_analyses
WHERE created_at >= now() - interval '30 days'
GROUP BY platform_detected
ORDER BY total_analyses DESC;
