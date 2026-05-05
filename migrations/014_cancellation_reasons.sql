-- Migration 014: tabela de motivos de cancelamento
-- Rode no Supabase SQL Editor antes de usar o comando /cancelar no bot.

CREATE TABLE IF NOT EXISTS cancellation_reasons (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone          TEXT        NOT NULL,
  plan           TEXT        NOT NULL,          -- wingman | wingman_pro
  reason         TEXT        NOT NULL,          -- preco | nao_uso | nao_gostei | problema_tecnico | outro
  plan_expires_at TIMESTAMPTZ,                  -- quando o acesso encerra
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cancellation_reasons_phone ON cancellation_reasons (phone);
CREATE INDEX IF NOT EXISTS idx_cancellation_reasons_reason ON cancellation_reasons (reason);
CREATE INDEX IF NOT EXISTS idx_cancellation_reasons_created_at ON cancellation_reasons (created_at);
