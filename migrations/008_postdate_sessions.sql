-- migrations/008_postdate_sessions.sql
-- Camada 5: Debrief Pós-Date
-- Registra análises do encontro após ele acontecer

CREATE TABLE IF NOT EXISTS postdate_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               TEXT NOT NULL,
  predate_session_id  UUID REFERENCES predate_sessions(id) ON DELETE SET NULL,
  interview_answers   JSONB,
  assessment_result   JSONB,
  outcome_summary     TEXT,           -- resumo legível para loop de aprendizado
  encounter_quality   TEXT,           -- great | good | neutral | poor | unclear
  next_step           TEXT,           -- próximo passo recomendado
  model_used          TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_postdate_sessions_phone
  ON postdate_sessions(phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_postdate_sessions_predate
  ON postdate_sessions(predate_session_id)
  WHERE predate_session_id IS NOT NULL;

-- View de estatísticas dos últimos 30 dias
CREATE OR REPLACE VIEW postdate_stats_30d AS
SELECT
  COUNT(*)                                                          AS total_sessions,
  COUNT(*) FILTER (WHERE encounter_quality = 'great')              AS great_count,
  COUNT(*) FILTER (WHERE encounter_quality = 'good')               AS good_count,
  COUNT(*) FILTER (WHERE encounter_quality = 'neutral')            AS neutral_count,
  COUNT(*) FILTER (WHERE encounter_quality = 'poor')               AS poor_count,
  COUNT(*) FILTER (WHERE encounter_quality = 'unclear')            AS unclear_count,
  COUNT(DISTINCT phone)                                             AS unique_users,
  ROUND(AVG(CASE
    WHEN encounter_quality = 'great'   THEN 4
    WHEN encounter_quality = 'good'    THEN 3
    WHEN encounter_quality = 'neutral' THEN 2
    WHEN encounter_quality = 'poor'    THEN 1
    ELSE NULL
  END), 2)                                                          AS avg_quality_score,
  MAX(created_at)                                                   AS last_session_at
FROM postdate_sessions
WHERE created_at >= NOW() - INTERVAL '30 days';
