-- Execute este SQL no Supabase SQL Editor para criar as tabelas necessárias

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  phone            TEXT UNIQUE NOT NULL,
  name             TEXT,
  plan             TEXT NOT NULL DEFAULT 'free',   -- 'free' ou 'premium'
  plan_expires_at  TIMESTAMPTZ,                    -- NULL = sem expiração
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de contagem diária de mensagens
CREATE TABLE IF NOT EXISTS daily_message_counts (
  id            BIGSERIAL PRIMARY KEY,
  phone         TEXT NOT NULL,
  count_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  message_count INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (phone, count_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_counts_phone_date
  ON daily_message_counts (phone, count_date);

-- Tabela de pagamentos
CREATE TABLE IF NOT EXISTS payments (
  id            BIGSERIAL PRIMARY KEY,
  phone         TEXT NOT NULL,
  mp_payment_id TEXT UNIQUE,
  external_ref  TEXT UNIQUE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'approved', 'rejected'
  amount        NUMERIC(10,2) NOT NULL DEFAULT 29.90,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_phone ON payments (phone);
CREATE INDEX IF NOT EXISTS idx_payments_external_ref ON payments (external_ref);

-- Se a tabela users já existir sem a coluna plan, rode só isso:
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
