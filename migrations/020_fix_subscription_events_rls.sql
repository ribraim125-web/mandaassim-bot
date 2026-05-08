-- Fix: subscription_events estava com RLS habilitado sem policy de INSERT
-- Isso causava "new row violates row-level security policy" no SubTracking

-- Opção 1: desabilita RLS completamente na tabela (mais simples, dados internos)
ALTER TABLE subscription_events DISABLE ROW LEVEL SECURITY;

-- Opção 2 (alternativa se preferir manter RLS):
-- CREATE POLICY "service_role_full_access" ON subscription_events
--   FOR ALL USING (true) WITH CHECK (true);
