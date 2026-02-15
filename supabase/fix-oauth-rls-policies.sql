-- Fix RLS policies for OAuth system tables
-- These tables are only accessed by the proxy server (never by users)
-- So we disable RLS entirely instead of using blocking policies

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "System only access" ON oauth_auth_codes;
DROP POLICY IF EXISTS "System only access" ON oauth_sessions;
DROP POLICY IF EXISTS "System only access" ON oauth_clients;

-- Disable RLS on system tables (proxy server has full access)
ALTER TABLE oauth_auth_codes DISABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_clients DISABLE ROW LEVEL SECURITY;

-- Note: These tables are never accessed directly by users
-- Only the proxy server (using service role key) can read/write to them
