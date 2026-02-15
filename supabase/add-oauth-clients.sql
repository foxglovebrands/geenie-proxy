-- OAuth clients (claude.ai)
-- Stores configuration for OAuth clients that can connect to Geenie

CREATE TABLE IF NOT EXISTS oauth_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT UNIQUE NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  name TEXT NOT NULL DEFAULT 'Claude',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for client lookups
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

-- Insert Claude.ai as a client (only if not exists)
INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, name)
VALUES (
  'claude_web',
  encode(gen_random_bytes(32), 'hex'),  -- Random secret
  ARRAY[
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback'
  ],
  'Claude.ai'
)
ON CONFLICT (client_id) DO NOTHING;

-- Enable RLS
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;

-- Policy: No user access (system only)
CREATE POLICY "System only access"
  ON oauth_clients FOR ALL
  USING (false);
