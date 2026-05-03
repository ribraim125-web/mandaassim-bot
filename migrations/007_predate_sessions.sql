-- Migration 007: Coach Pré-Date — sessões de preparação para encontro
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS predate_sessions (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone                text        NOT NULL,
  interview_answers    jsonb,                  -- respostas às 4 perguntas
  assessment_result    jsonb,                  -- JSON completo do Haiku
  date_parsed          timestamptz,            -- data/hora do encontro (parseada de answers[0])
  location_summary     text,                   -- descrição do local
  location_type        text,                   -- 'café'|'restaurante'|'bar'|'atividade'|'desconhecido'
  is_first_date        boolean,
  model_used           text,
  -- Lembretes
  debrief_sent_at      timestamptz,            -- quando "como foi?" foi enviado
  -- Debrief (preenchido via Camada 5 futuramente)
  debrief_response     text,
  encontro_aconteceu   boolean,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predate_phone      ON predate_sessions (phone);
CREATE INDEX IF NOT EXISTS idx_predate_created_at ON predate_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predate_date       ON predate_sessions (date_parsed);

ALTER TABLE predate_sessions ENABLE ROW LEVEL SECURITY;

-- View de métricas (últimos 30 dias)
CREATE OR REPLACE VIEW predate_stats_30d AS
SELECT
  location_type,
  is_first_date,
  COUNT(*)                                                        AS total_sessions,
  COUNT(DISTINCT phone)                                           AS unique_users,
  COUNT(*) FILTER (WHERE debrief_sent_at IS NOT NULL)             AS with_debrief,
  COUNT(*) FILTER (WHERE encontro_aconteceu = true)               AS confirmed_happened,
  ROUND(
    COUNT(*) FILTER (WHERE encontro_aconteceu = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE debrief_sent_at IS NOT NULL), 0) * 100,
    1
  )                                                               AS success_rate_pct
FROM predate_sessions
WHERE created_at >= now() - interval '30 days'
GROUP BY location_type, is_first_date
ORDER BY total_sessions DESC;
