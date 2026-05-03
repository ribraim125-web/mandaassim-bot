-- Migration 006: Coach de Transição — sessões e outcomes
-- Execute no SQL Editor do Supabase.

-- Sessões da mini-entrevista + resultado da análise
CREATE TABLE IF NOT EXISTS transition_coach_sessions (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone                   text        NOT NULL,
  interview_answers       jsonb,                  -- respostas às 5 perguntas
  assessment_result       jsonb,                  -- JSON completo retornado pelo Haiku
  print_analysis_context  jsonb,                  -- snapshot da última print analysis (se houver)
  readiness_assessment    text,                   -- 'ready'|'wait_a_bit'|'not_yet'|'red_flags'
  model_used              text,
  -- Outcome (preenchido 7 dias depois via follow-up)
  outcome                 text,                   -- 'accepted_and_happened'|'accepted_but_postponed'|...
  outcome_requested_at    timestamptz,            -- quando o bot perguntou
  outcome_received_at     timestamptz,            -- quando o usuário respondeu
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tc_sessions_phone      ON transition_coach_sessions (phone);
CREATE INDEX IF NOT EXISTS idx_tc_sessions_created_at ON transition_coach_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_sessions_readiness  ON transition_coach_sessions (readiness_assessment);

ALTER TABLE transition_coach_sessions ENABLE ROW LEVEL SECURITY;

-- View de métricas (últimos 30 dias)
CREATE OR REPLACE VIEW transition_coach_stats_30d AS
SELECT
  readiness_assessment,
  COUNT(*)                                            AS total_sessions,
  COUNT(DISTINCT phone)                               AS unique_users,
  COUNT(*) FILTER (WHERE outcome IS NOT NULL)         AS with_outcome,
  COUNT(*) FILTER (WHERE outcome = 'accepted_and_happened') AS successful,
  COUNT(*) FILTER (WHERE outcome = 'user_didnt_send') AS user_chickened_out,
  ROUND(
    COUNT(*) FILTER (WHERE outcome = 'accepted_and_happened')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE outcome IS NOT NULL), 0) * 100,
    1
  ) AS success_rate_pct
FROM transition_coach_sessions
WHERE created_at >= now() - interval '30 days'
GROUP BY readiness_assessment
ORDER BY total_sessions DESC;
