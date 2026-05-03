-- Migration 005: funil de eventos de assinatura
-- Registra cada ponto da jornada premium → pro para medir conversão.
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS subscription_events (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone        text        NOT NULL,
  event_type   text        NOT NULL,  -- 'upgrade_offered' | 'upgrade_paid' | 'downgrade' | 'cancel' | 'plan_activated'
  plan_from    text,                  -- plano anterior ('free' | 'premium' | 'pro')
  plan_to      text,                  -- plano novo
  amount_brl   numeric(8,2),         -- valor pago (quando aplicável)
  trigger_ctx  text,                 -- contexto que gerou o upsell: 'profile_analysis' | 'print_limit' | 'manual'
  metadata     jsonb,                -- campos extras (mp_payment_id, days, etc.)
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_phone      ON subscription_events (phone);
CREATE INDEX IF NOT EXISTS idx_sub_events_type       ON subscription_events (event_type);
CREATE INDEX IF NOT EXISTS idx_sub_events_created_at ON subscription_events (created_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

-- View: funil de conversão (últimos 30 dias)
CREATE OR REPLACE VIEW subscription_funnel_30d AS
SELECT
  event_type,
  plan_from,
  plan_to,
  COUNT(*)                            AS total,
  COUNT(DISTINCT phone)               AS unique_users,
  ROUND(AVG(amount_brl), 2)           AS avg_amount,
  trigger_ctx
FROM subscription_events
WHERE created_at >= now() - interval '30 days'
GROUP BY event_type, plan_from, plan_to, trigger_ctx
ORDER BY total DESC;
