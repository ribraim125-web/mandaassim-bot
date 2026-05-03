-- Migration 003: tabela de análises de prints
-- Armazena o resultado estruturado (JSON) de cada análise de conversa.
-- A imagem em si NÃO é armazenada (privacidade).
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS print_analyses (
  id                       uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone                    text        NOT NULL,
  platform_detected        text,                -- 'whatsapp' | 'tinder' | 'bumble' | 'instagram' | 'unknown'
  messages_count           int,                 -- nº de mensagens extraídas do print
  match_interest_level     text,                -- 'low' | 'medium' | 'high' | 'very_high'
  conversation_temperature text,                -- 'cold' | 'warm' | 'hot' | 'unknown'
  red_flags_count          int,
  green_flags_count        int,
  mistakes_count           int,                 -- nº de erros do usuário detectados
  has_suggested_messages   boolean,
  raw_json                 jsonb,               -- JSON completo retornado pelo Haiku
  created_at               timestamptz DEFAULT now()
);

-- Índices para analytics
CREATE INDEX IF NOT EXISTS idx_print_analyses_phone      ON print_analyses (phone);
CREATE INDEX IF NOT EXISTS idx_print_analyses_created_at ON print_analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_analyses_platform   ON print_analyses (platform_detected);

-- Row Level Security (leitura apenas para service_role)
ALTER TABLE print_analyses ENABLE ROW LEVEL SECURITY;

-- View de resumo por plataforma (últimos 30 dias)
CREATE OR REPLACE VIEW print_analyses_summary_30d AS
SELECT
  platform_detected,
  COUNT(*)                                          AS total_analyses,
  COUNT(DISTINCT phone)                             AS unique_users,
  ROUND(AVG(messages_count), 1)                     AS avg_messages_extracted,
  ROUND(AVG(match_interest_level::text IN ('high', 'very_high') OR match_interest_level IS NULL)::numeric * 100, 1) AS pct_high_interest,
  COUNT(*) FILTER (WHERE conversation_temperature = 'hot')  AS hot_convos,
  COUNT(*) FILTER (WHERE conversation_temperature = 'cold') AS cold_convos,
  COUNT(*) FILTER (WHERE mistakes_count > 0)                AS with_mistakes
FROM print_analyses
WHERE created_at >= now() - interval '30 days'
GROUP BY platform_detected
ORDER BY total_analyses DESC;
