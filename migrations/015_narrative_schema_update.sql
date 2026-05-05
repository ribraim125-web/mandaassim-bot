-- Migration 015: narrativa progressiva — atualização de schema
-- Rode no Supabase SQL Editor antes de ligar qualquer ato da nova engine.

-- ── narrative_messages_log: colunas novas ────────────────────────────────────
ALTER TABLE narrative_messages_log
  ADD COLUMN IF NOT EXISTS copy_used       TEXT,                   -- texto exato enviado
  ADD COLUMN IF NOT EXISTS response_at     TIMESTAMPTZ,            -- quando respondeu
  ADD COLUMN IF NOT EXISTS response_text   TEXT,                   -- o que respondeu
  ADD COLUMN IF NOT EXISTS conversion_at   TIMESTAMPTZ;            -- quando converteu

-- Índices novos
CREATE INDEX IF NOT EXISTS idx_nml_act_sent_at ON narrative_messages_log (act_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_nml_act_outcome ON narrative_messages_log (act_id, conversion_outcome);

-- ── user_journey_events: novos índices (tabela já existe via 013) ────────────
CREATE INDEX IF NOT EXISTS idx_uje_phone_type ON user_journey_events (phone, event_type);
CREATE INDEX IF NOT EXISTS idx_uje_phone_created ON user_journey_events (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uje_type_created ON user_journey_events (event_type, created_at DESC);

-- ── Eventos reconhecidos pelo sistema (apenas documentação) ──────────────────
-- signup
-- first_message_sent
-- first_response_received
-- response_count_3, response_count_5, response_count_10
-- first_print_analyzed, print_count_2, print_count_5
-- first_papo_conversation, papo_count_3
-- hit_daily_limit_response, hit_daily_limit_print, hit_daily_limit_papo
-- trial_started, trial_ending_in_12h, trial_ending_in_1h, trial_ended
-- subscribed_direto, subscribed_direto_pro
-- first_profile_audit_done, audit_count_2
-- first_her_profile_analyzed, her_analysis_count_2
-- conversation_marked_active
-- encounter_mentioned
-- link_clicked
-- act_01_persona_selected (event_data: { choice: '1'|'2'|'3'|'4' })
