-- OAuth sessions for web/mobile users
-- Stores active sessions for claude.ai connector

CREATE TABLE IF NOT EXISTS oauth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_session_id ON oauth_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_user_id ON oauth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires_at ON oauth_sessions(expires_at);

-- Auto-cleanup expired sessions (runs daily)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM oauth_sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE oauth_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own sessions
CREATE POLICY "Users can view own sessions"
  ON oauth_sessions FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: System can insert sessions (no user context needed)
CREATE POLICY "System can insert sessions"
  ON oauth_sessions FOR INSERT
  WITH CHECK (true);

-- Policy: System can update sessions
CREATE POLICY "System can update sessions"
  ON oauth_sessions FOR UPDATE
  USING (true);

-- Policy: System can delete sessions
CREATE POLICY "System can delete sessions"
  ON oauth_sessions FOR DELETE
  USING (true);
