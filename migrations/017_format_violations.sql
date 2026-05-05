-- Migration 017: Tabela de violações de formato de mensagem
--
-- Registra quando o bot gera mensagem com aspas ou prefixo inline
-- nas mensagens sugeridas para o usuário copiar.
--
-- Fire-and-forget — nunca bloqueia o pipeline de envio.
-- Usar para detectar regressões após mudanças em system prompts.
--
-- Execute no Supabase SQL Editor.
-- Idempotente: usa IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS format_violations (
  id             BIGSERIAL    PRIMARY KEY,
  phone          TEXT         NOT NULL,
  intent         TEXT,
  violation_type TEXT         NOT NULL
    CHECK (violation_type IN (
      'quote_wrap',
      'quote_start',
      'inline_prefix',
      'emoji_quote',
      'whatsapp_format_inside'
    )),
  snippet        TEXT,
  block_index    INT,
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- Índices para queries de monitoramento
CREATE INDEX IF NOT EXISTS idx_format_violations_phone      ON format_violations (phone);
CREATE INDEX IF NOT EXISTS idx_format_violations_intent     ON format_violations (intent);
CREATE INDEX IF NOT EXISTS idx_format_violations_type       ON format_violations (violation_type);
CREATE INDEX IF NOT EXISTS idx_format_violations_created_at ON format_violations (created_at DESC);

-- View de resumo por intent (útil para detectar qual prompt regrediu)
CREATE OR REPLACE VIEW format_violations_summary AS
SELECT
  intent,
  violation_type,
  COUNT(*)                                          AS total,
  COUNT(DISTINCT phone)                             AS unique_users,
  MAX(created_at)                                   AS last_seen
FROM format_violations
GROUP BY intent, violation_type
ORDER BY total DESC;
