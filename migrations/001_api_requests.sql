-- Migration 001: api_requests + daily_api_summary
-- Rastreia cada chamada de IA feita pelo bot para análise de custo, qualidade e comportamento
-- Roda no Supabase SQL Editor (Settings → SQL Editor → New query)

-- ---------------------------------------------------------------------------
-- Tabela principal de chamadas de IA
-- ---------------------------------------------------------------------------
-- TODO: o campo `phone` referencia users.phone em vez de users.id (BIGSERIAL)
-- porque toda a codebase usa phone como identificador primário.
-- Se quiser normalizar com user_id no futuro, adicionar coluna e popular via JOIN.

CREATE TABLE IF NOT EXISTS api_requests (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                     TEXT        NOT NULL,            -- identifica o usuário (ref: users.phone)
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Intent e roteamento
  intent                    TEXT        NOT NULL,            -- one_liner | volume | premium | coaching | ousadia
  raw_intent                TEXT,                            -- intent antes do capIntentByTier (pode diferir)
  intent_classifier_model   TEXT,                            -- modelo que classificou o intent
  target_model              TEXT,                            -- modelo que DEVERIA ser chamado pelo roteamento
  model_actually_used       TEXT,                            -- modelo que FOI chamado (pode ser fallback)
  tier_at_request           TEXT        NOT NULL,            -- full | degraded | minimal

  -- Fallback e degradação
  fallback_triggered        BOOLEAN     NOT NULL DEFAULT FALSE,
  fallback_reason           TEXT,                            -- 'rate_limit' | 'model_error' | 'tier_degraded' | 'haiku_daily_limit'

  -- Tokens (nullable: OpenRouter não retorna tokens em todos os modelos)
  input_tokens              INT,
  output_tokens             INT,
  cache_read_tokens         INT,                             -- só Anthropic Haiku
  cache_write_tokens        INT,                             -- só Anthropic Haiku

  -- Custo calculado no momento da chamada
  estimated_cost_usd        NUMERIC(10,6),
  estimated_cost_brl        NUMERIC(10,4),

  -- Performance e tamanho
  latency_ms                INT,
  response_length_chars     INT,
  user_message_length_chars INT,

  -- Contexto da sessão
  conversation_turn_number  INT,                             -- número de msgs do usuário no dia

  -- Erro (NULL = sucesso)
  error                     TEXT
);

-- Índices para queries de analytics
CREATE INDEX IF NOT EXISTS idx_api_requests_phone_created
  ON api_requests (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_requests_created_intent
  ON api_requests (created_at, intent);

CREATE INDEX IF NOT EXISTS idx_api_requests_created_model
  ON api_requests (created_at, target_model);

CREATE INDEX IF NOT EXISTS idx_api_requests_created_date
  ON api_requests (DATE(created_at));

-- ---------------------------------------------------------------------------
-- View de resumo diário (agrega api_requests por dia/usuário/modelo)
-- TODO: se o volume crescer muito (>100k rows/dia), converter para
-- MATERIALIZED VIEW com refresh agendado via pg_cron
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW daily_api_summary AS
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
FROM api_requests
GROUP BY
  DATE(created_at AT TIME ZONE 'America/Sao_Paulo'),
  phone,
  model_actually_used,
  intent,
  tier_at_request;

-- ---------------------------------------------------------------------------
-- View de resumo global por modelo (últimos 30 dias)
-- Útil para ver custo total e distribuição por modelo rapidamente
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW model_cost_summary_30d AS
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
FROM api_requests
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY model_actually_used
ORDER BY total_cost_usd DESC;
