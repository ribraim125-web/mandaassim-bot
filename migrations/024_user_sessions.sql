-- migrations/024_user_sessions.sql
-- Persiste o userContext (estado de sessão por telefone) para sobreviver a
-- restart/deploy. Antes era um Map em memória — todo restart zerava o contexto
-- de quem estava no meio de uma conversa (entrevistas, tom escolhido, histórico).

CREATE TABLE IF NOT EXISTS user_sessions (
  phone      TEXT PRIMARY KEY,
  context    JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usado pelo hydrate() para carregar só sessões recentes (últimos 7 dias)
CREATE INDEX IF NOT EXISTS idx_user_sessions_updated
  ON user_sessions(updated_at DESC);
