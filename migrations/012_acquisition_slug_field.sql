-- Migration 012: adiciona acquisition_slug ao users e melhora acquisition_links
-- 2026-05-04

-- Slug bruto capturado da primeira mensagem (ex: "ig_reel_001")
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_slug TEXT;

-- acquisition_first_message_at: alias semântico (já existe como acquisition_first_seen_at)
-- Adicionamos o nome do spec como sinônimo para clareza em queries futuras
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_first_message_at TIMESTAMPTZ;

-- Melhoras na tabela acquisition_links: id uuid + created_by
ALTER TABLE acquisition_links ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE acquisition_links ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'rafa';

-- Índice para lookup por slug (já é PK, mas garante)
CREATE INDEX IF NOT EXISTS idx_users_acquisition_slug ON users (acquisition_slug);
