-- Temporary storage for OAuth authorization codes
-- Codes expire after 10 minutes and are deleted after exchange

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for code lookups
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_code ON oauth_auth_codes(code);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expires_at ON oauth_auth_codes(expires_at);

-- Auto-cleanup expired codes (runs every hour)
CREATE OR REPLACE FUNCTION cleanup_expired_auth_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM oauth_auth_codes WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;

-- Policy: System only access (codes handled server-side only)
CREATE POLICY "System only access"
  ON oauth_auth_codes FOR ALL
  USING (false);
