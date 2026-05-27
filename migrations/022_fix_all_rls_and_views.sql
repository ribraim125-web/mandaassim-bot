-- Migration 022: corrige todos os erros do Supabase Linter (RLS + Security Definer Views)
-- Gerado em 2026-05-27
-- ────────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabelas que já têm policies corretas: só habilitar RLS ─────────────────

-- api_requests: policies service_role_insert + service_role_select já existem
ALTER TABLE public.api_requests ENABLE ROW LEVEL SECURITY;

-- narrative_messages_log: policy srole_all_narrative_messages_log já existe
ALTER TABLE public.narrative_messages_log ENABLE ROW LEVEL SECURITY;

-- subscription_events: policy srole_all_subscription_events já existe
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- ── 2. payments — substituir allow_all por acesso exclusivo service_role ───────

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON public.payments;

CREATE POLICY service_role_all_payments ON public.payments
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 3. users — substituir allow_all por acesso exclusivo service_role ──────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON public.users;

CREATE POLICY service_role_all_users ON public.users
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. daily_message_counts — sem RLS, sem policy ─────────────────────────────

ALTER TABLE public.daily_message_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_daily_message_counts ON public.daily_message_counts
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 5. followup_queue — sem RLS, sem policy ───────────────────────────────────

ALTER TABLE public.followup_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_followup_queue ON public.followup_queue
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 6. Views SECURITY DEFINER → SECURITY INVOKER ─────────────────────────────
-- Supabase (Postgres 15+): WITH (security_invoker = true) elimina o SECURITY DEFINER

CREATE OR REPLACE VIEW public.daily_api_summary
  WITH (security_invoker = true)
AS
SELECT
  DATE(created_at AT TIME ZONE 'America/Sao_Paulo')  AS date_br,
  phone,
  model_actually_used,
  intent,
  tier_at_request,
  COUNT(*)                                             AS request_count,
  COUNT(*) FILTER (WHERE error IS NULL)               AS success_count,
  COUNT(*) FILTER (WHERE error IS NOT NULL)           AS error_count,
  COUNT(*) FILTER (WHERE fallback_triggered)          AS fallback_count,
  COALESCE(SUM(input_tokens),  0)                     AS total_input_tokens,
  COALESCE(SUM(output_tokens), 0)                     AS total_output_tokens,
  COALESCE(SUM(cache_read_tokens),  0)                AS total_cache_read_tokens,
  COALESCE(SUM(cache_write_tokens), 0)                AS total_cache_write_tokens,
  COALESCE(SUM(estimated_cost_usd), 0)                AS total_cost_usd,
  COALESCE(SUM(estimated_cost_brl), 0)                AS total_cost_brl,
  ROUND(AVG(latency_ms))                              AS avg_latency_ms,
  ROUND(AVG(response_length_chars))                   AS avg_response_chars,
  ROUND(AVG(user_message_length_chars))               AS avg_user_message_chars
FROM public.api_requests
GROUP BY
  DATE(created_at AT TIME ZONE 'America/Sao_Paulo'),
  phone,
  model_actually_used,
  intent,
  tier_at_request;

CREATE OR REPLACE VIEW public.model_cost_summary_30d
  WITH (security_invoker = true)
AS
SELECT
  model_actually_used,
  COUNT(*)                                  AS total_calls,
  ROUND(AVG(latency_ms))                    AS avg_latency_ms,
  COALESCE(SUM(input_tokens),  0)           AS total_input_tokens,
  COALESCE(SUM(output_tokens), 0)           AS total_output_tokens,
  COALESCE(SUM(cache_read_tokens),  0)      AS total_cache_read,
  COALESCE(SUM(cache_write_tokens), 0)      AS total_cache_write,
  ROUND(SUM(estimated_cost_usd)::NUMERIC, 4) AS total_cost_usd,
  ROUND(SUM(estimated_cost_brl)::NUMERIC, 2) AS total_cost_brl,
  ROUND(
    100.0 * SUM(cache_read_tokens) /
    NULLIF(SUM(input_tokens), 0), 1
  )                                         AS cache_hit_rate_pct
FROM public.api_requests
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY model_actually_used
ORDER BY total_cost_usd DESC;

CREATE OR REPLACE VIEW public.acquisition_summary_30d
  WITH (security_invoker = true)
AS
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
FROM public.users u
LEFT JOIN public.payments p
  ON p.phone = u.phone
  AND p.status = 'approved'
WHERE u.created_at >= NOW() - INTERVAL '30 days'
GROUP BY
  COALESCE(u.acquisition_source, 'unknown'),
  COALESCE(u.acquisition_medium, 'unknown'),
  COALESCE(u.acquisition_campaign, 'none')
ORDER BY signups DESC;

CREATE OR REPLACE VIEW public.transition_coach_stats_30d
  WITH (security_invoker = true)
AS
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
FROM public.transition_coach_sessions
WHERE created_at >= now() - interval '30 days'
GROUP BY readiness_assessment
ORDER BY total_sessions DESC;

CREATE OR REPLACE VIEW public.predate_stats_30d
  WITH (security_invoker = true)
AS
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
FROM public.predate_sessions
WHERE created_at >= now() - interval '30 days'
GROUP BY location_type, is_first_date
ORDER BY total_sessions DESC;

CREATE OR REPLACE VIEW public.postdate_stats_30d
  WITH (security_invoker = true)
AS
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
FROM public.postdate_sessions
WHERE created_at >= NOW() - INTERVAL '30 days';

CREATE OR REPLACE VIEW public.mindset_stats
  WITH (security_invoker = true)
AS
SELECT
  COUNT(DISTINCT phone) FILTER (WHERE enabled = true)   AS opted_in_users,
  COUNT(DISTINCT phone) FILTER (WHERE enabled = false
    AND opted_in_at IS NOT NULL)                         AS opted_out_users,
  COUNT(DISTINCT phone) FILTER (WHERE invite_sent_at IS NOT NULL
    AND opted_in_at IS NULL
    AND invite_declined_at IS NULL)                      AS invite_pending,
  COUNT(DISTINCT phone)                                  AS total_reached
FROM public.mindset_opt_ins;

CREATE OR REPLACE VIEW public.format_violations_summary
  WITH (security_invoker = true)
AS
SELECT
  intent,
  violation_type,
  COUNT(*)                                          AS total,
  COUNT(DISTINCT phone)                             AS unique_users,
  MAX(created_at)                                   AS last_seen
FROM public.format_violations
GROUP BY intent, violation_type
ORDER BY total DESC;

CREATE OR REPLACE VIEW public.fds_discovery_rate
  WITH (security_invoker = true)
AS
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
  ROUND(100.0 * COUNT(*) FILTER (WHERE f2_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f2_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f4_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f4_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f5_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f5_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f6_revealed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS f6_reveal_rate_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_paid = TRUE) / NULLIF(COUNT(*) FILTER (WHERE total_analyses >= 1), 0), 1) AS trial_to_paid_pct
FROM public.feature_discovery_state
GROUP BY ab_variant;
