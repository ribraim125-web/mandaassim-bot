-- Migration 016: Renomeia planos 'wingman'/'wingman_pro' → 'parceiro'/'parceiro_pro'
-- e adiciona coluna entry_persona na tabela users.
--
-- Execute no Supabase SQL Editor.
-- Idempotente: usa IF NOT EXISTS e WHERE seguro.

-- 1. Adiciona entry_persona (1-4, do diagnóstico do Ato 1)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS entry_persona SMALLINT;

-- 2. Renomeia planos legados → Parceiro / Parceiro Pro
--    Ordem importa: mais específico primeiro (wingman_pro antes de wingman)
UPDATE users SET plan = 'parceiro_pro' WHERE plan IN ('wingman_pro', 'pro');
UPDATE users SET plan = 'parceiro'     WHERE plan IN ('wingman', 'premium');

-- 3. Garante que trial/free não foram tocados (sanity check — deve retornar 0)
-- SELECT count(*) FROM users WHERE plan NOT IN ('trial','free','parceiro','parceiro_pro');
