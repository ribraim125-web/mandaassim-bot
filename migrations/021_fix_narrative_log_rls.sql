-- Fix: narrative_messages_log estava com RLS habilitado sem policy de INSERT
-- Isso causava "new row violates row-level security policy" no NarrativeLog
-- (mesmo erro que afetou subscription_events — migration 020)

ALTER TABLE narrative_messages_log DISABLE ROW LEVEL SECURITY;
