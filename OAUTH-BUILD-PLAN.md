# OAuth Web Connector - Build Plan & Safety Checklist

**Goal:** Add OAuth authentication for claude.ai web/mobile while keeping desktop NPM package 100% safe

**Method:** Streamable HTTP with dual authentication (Bearer token OR OAuth session)

---

## 🚨 SAFETY RULES - READ FIRST

### ❌ NEVER MODIFY THESE (Desktop Code)

**Files - DO NOT TOUCH:**
- [ ] `/packages/mcp-client/index.js` - Desktop NPM package
- [ ] `/packages/mcp-client/package.json` - Desktop NPM config
- [ ] `src/middleware/auth.ts` - Desktop Bearer token authentication
- [ ] Lines 18-495 in `src/routes/mcp.ts` - Desktop route handler logic

**If you accidentally modify desktop code:**
1. STOP immediately
2. Revert changes with `git checkout src/middleware/auth.ts` (or affected file)
3. Verify desktop still works with test command below

### ✅ SAFE TO MODIFY

**Files - Safe to change:**
- [ ] `src/routes/mcp.ts` - Add dual auth routing (only first 10 lines of handler)
- [ ] `src/index.ts` - Register new OAuth routes
- [ ] Database schema - Add new tables (doesn't affect desktop)

**Files - Safe to create (NEW):**
- [ ] `src/routes/oauth.ts`
- [ ] `src/middleware/auth-oauth.ts`
- [ ] `supabase/add-oauth-*.sql`

### 🔬 Desktop Safety Test (Run After EVERY Step)

```bash
# Test 1: Desktop endpoint responds
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# Expected output: 62
# If you see 62, desktop is safe ✅
# If you see error, STOP and revert ❌

# Test 2: Desktop NPM package works
cd /Users/brandongilmer/Desktop/geenie-app
npx -y geenie-mcp-client sk_live_YOUR_API_KEY_HERE

# Expected: Returns tool list
# If fails, STOP and revert ❌
```

**Run this test:**
- After each phase
- Before committing code
- Before deploying to Railway
- If anything feels wrong

---

## Phase 1: Cleanup (Remove Failed Attempts)

**Time Estimate:** 1 hour
**Risk Level:** 🟢 LOW (removing unused code)

### Step 1.1: Remove Failed /mcp-web Route

**File:** `src/routes/mcp.ts`

**Action:** Delete lines 497-977

**Current line count:**
```bash
wc -l src/routes/mcp.ts
# Should show: 978 lines
```

**After deletion:**
```bash
wc -l src/routes/mcp.ts
# Should show: ~496 lines
```

**How to do it safely:**
1. Open `src/routes/mcp.ts` in editor
2. Find line 496 (end of desktop route: closing `});` )
3. Verify line 497 starts with `// Web/Mobile MCP route`
4. Delete from line 497 to line 977 (end of /mcp-web route)
5. Verify line 496 is followed by the closing `}` of the exported function
6. Save file

**Safety Check:**
- [ ] Lines 1-495 are UNCHANGED
- [ ] Desktop route handler is intact
- [ ] Only removed /mcp-web route (which never worked)

### Step 1.2: Remove Failed Middleware Files

**Files to delete:**

```bash
cd /Users/brandongilmer/Desktop/geenie-proxy
rm src/middleware/auth-web.ts
rm src/middleware/auth-path.ts
```

**Verification:**
```bash
ls src/middleware/
# Should show: auth.ts (keep this!)
# Should NOT show: auth-web.ts, auth-path.ts
```

**Safety Check:**
- [ ] `auth.ts` still exists (desktop needs this!)
- [ ] `auth-web.ts` deleted
- [ ] `auth-path.ts` deleted

### Step 1.3: Remove Unused Imports

**File:** `src/routes/mcp.ts`

**Remove these lines (around line 5-6):**
```typescript
import { authWebMiddleware } from '../middleware/auth-web.js';
import { authPathMiddleware } from '../middleware/auth-path.js';
```

**How to verify:**
```bash
grep "authWebMiddleware\|authPathMiddleware" src/routes/mcp.ts
# Should return: nothing (no matches)
```

**Safety Check:**
- [ ] `import { authMiddleware }` still exists (desktop needs this!)
- [ ] Unused imports removed
- [ ] No references to auth-web or auth-path remain

### Step 1.4: Test Desktop After Cleanup

**Run Safety Test:**
```bash
# Test desktop endpoint
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# Expected: 62 ✅
```

**Verification:**
- [ ] Desktop endpoint returns 62 tools
- [ ] No errors in response
- [ ] Desktop NPM package works (optional: test with npx)

### Step 1.5: Commit Cleanup

```bash
cd /Users/brandongilmer/Desktop/geenie-proxy
git add .
git status
# Verify: Only expected files changed

git commit -m "Remove failed /mcp-web route and middleware

- Delete /mcp-web POST route (lines 497-977 in mcp.ts)
- Delete auth-web.ts and auth-path.ts middleware
- Remove unused imports
- Desktop /mcp route unchanged and working

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

git push
```

**Deployment:**
- [ ] Railway auto-deploys
- [ ] Wait for deployment to complete
- [ ] Run desktop safety test against production URL
- [ ] Verify: Desktop still works ✅

**Phase 1 Complete:** ✅

---

## Phase 2: Database Setup (OAuth Tables)

**Time Estimate:** 30 minutes
**Risk Level:** 🟢 LOW (adding tables, desktop doesn't use them)

### Step 2.1: Create OAuth Sessions Table

**File:** `supabase/add-oauth-sessions.sql` (NEW)

**Action:** Create this file with:

```sql
-- OAuth sessions for web/mobile users
CREATE TABLE oauth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_oauth_sessions_session_id ON oauth_sessions(session_id);
CREATE INDEX idx_oauth_sessions_user_id ON oauth_sessions(user_id);
CREATE INDEX idx_oauth_sessions_expires_at ON oauth_sessions(expires_at);

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
```

**Apply to Supabase:**
```bash
cd /Users/brandongilmer/Desktop/geenie-proxy
psql "postgresql://postgres.stavokirrmjoipyyljzf:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres" -f supabase/add-oauth-sessions.sql
```

**Or via Supabase Dashboard:**
1. Go to https://supabase.com/dashboard/project/stavokirrmjoipyyljzf
2. SQL Editor → New Query
3. Paste SQL from file above
4. Run query

**Verification:**
```sql
-- Check table exists
SELECT table_name FROM information_schema.tables
WHERE table_name = 'oauth_sessions';

-- Should return: oauth_sessions
```

**Safety Check:**
- [ ] Table `oauth_sessions` created
- [ ] Indexes created
- [ ] RLS policies active
- [ ] Desktop still works (uses different tables)

### Step 2.2: Create OAuth Clients Table

**File:** `supabase/add-oauth-clients.sql` (NEW)

```sql
-- OAuth clients (claude.ai)
CREATE TABLE oauth_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT UNIQUE NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  name TEXT NOT NULL DEFAULT 'Claude',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for client lookups
CREATE INDEX idx_oauth_clients_client_id ON oauth_clients(client_id);

-- Insert Claude.ai as a client
INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, name)
VALUES (
  'claude_web',
  encode(gen_random_bytes(32), 'hex'),  -- Random secret
  ARRAY[
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback'
  ],
  'Claude'
);

-- Enable RLS
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;

-- Policy: No user access (system only)
CREATE POLICY "System only"
  ON oauth_clients FOR ALL
  USING (false);
```

**Apply to Supabase:**
```bash
psql "postgresql://..." -f supabase/add-oauth-clients.sql
```

**Verification:**
```sql
SELECT client_id, name FROM oauth_clients;
-- Should return: claude_web | Claude
```

**Safety Check:**
- [ ] Table `oauth_clients` created
- [ ] Claude client inserted
- [ ] Client secret generated
- [ ] Desktop still works

### Step 2.3: Create OAuth Authorization Codes Table

**File:** `supabase/add-oauth-auth-codes.sql` (NEW)

```sql
-- Temporary storage for OAuth authorization codes
CREATE TABLE oauth_auth_codes (
  code TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for code lookups
CREATE INDEX idx_oauth_auth_codes_code ON oauth_auth_codes(code);

-- Auto-cleanup expired codes (runs every hour)
CREATE OR REPLACE FUNCTION cleanup_expired_auth_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM oauth_auth_codes WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;

-- Policy: System only
CREATE POLICY "System only"
  ON oauth_auth_codes FOR ALL
  USING (false);
```

**Apply to Supabase:**
```bash
psql "postgresql://..." -f supabase/add-oauth-auth-codes.sql
```

**Verification:**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_name = 'oauth_auth_codes';
```

**Safety Check:**
- [ ] All OAuth tables created
- [ ] RLS policies active
- [ ] Desktop still works (run safety test!)

### Step 2.4: Test Desktop After Database Changes

**Run Safety Test:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# Expected: 62 ✅
```

**Verification:**
- [ ] Desktop endpoint works
- [ ] Database tables created successfully
- [ ] No impact on desktop functionality

**Phase 2 Complete:** ✅

---

## Phase 3: OAuth Routes Implementation

**Time Estimate:** 2 hours
**Risk Level:** 🟡 MEDIUM (new code, but separate from desktop)

### Step 3.1: Create OAuth Routes File

**File:** `src/routes/oauth.ts` (NEW)

**Action:** Create the full OAuth route handler (see STREAMABLE-HTTP-IMPLEMENTATION-PLAN.md Phase 3 for complete code)

**Key endpoints to implement:**
- [ ] `GET /oauth/authorize` - Show login form
- [ ] `POST /oauth/login` - Process login
- [ ] `POST /oauth/token` - Exchange code for session token

**Safety Notes:**
- This is a NEW file
- Desktop doesn't use these routes
- If OAuth breaks, desktop unaffected

### Step 3.2: Test OAuth Routes (Without Desktop Impact)

**Test authorization endpoint:**
```bash
curl -X GET "https://api.geenie.io/oauth/authorize?client_id=claude_web&redirect_uri=https://claude.ai/api/mcp/auth_callback&state=test"

# Expected: HTML login form
```

**Safety Check:**
- [ ] OAuth routes respond
- [ ] Desktop endpoint still works (run safety test!)

### Step 3.3: Commit OAuth Routes

```bash
git add src/routes/oauth.ts
git commit -m "Add OAuth routes for web connector

- GET /oauth/authorize - Login form
- POST /oauth/login - Process authentication
- POST /oauth/token - Exchange code for session

Desktop /mcp route unchanged

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push
```

**Note:** OAuth routes NOT registered yet, so not accessible in production

**Phase 3 Complete:** ✅

---

## Phase 4: OAuth Middleware Implementation

**Time Estimate:** 1 hour
**Risk Level:** 🟢 LOW (new file, desktop uses different auth)

### Step 4.1: Create OAuth Auth Middleware

**File:** `src/middleware/auth-oauth.ts` (NEW)

**Action:** Create OAuth session validation middleware (see STREAMABLE-HTTP-IMPLEMENTATION-PLAN.md Phase 4 for complete code)

**Key functionality:**
- [ ] Extract `Mcp-Session-Id` from headers
- [ ] Validate session in database
- [ ] Check subscription status
- [ ] Attach user to request (same format as desktop!)

**Safety Notes:**
- NEW file, doesn't affect desktop
- Desktop uses `src/middleware/auth.ts` (different file)
- Same `request.user` format ensures compatibility

### Step 4.2: Test Middleware (Local Only)

**Create test script:** `test-oauth-middleware.ts`

```typescript
import { authOAuthMiddleware } from './src/middleware/auth-oauth.js';

// Mock request with session ID
const mockRequest = {
  headers: { 'mcp-session-id': 'test_session_id' }
};

// Test middleware
await authOAuthMiddleware(mockRequest as any, {} as any);
console.log('User:', mockRequest.user);
```

**Safety Check:**
- [ ] Middleware compiles without errors
- [ ] Desktop still works (run safety test!)

### Step 4.3: Commit OAuth Middleware

```bash
git add src/middleware/auth-oauth.ts
git commit -m "Add OAuth session authentication middleware

- Validates Mcp-Session-Id header
- Checks oauth_sessions table
- Same request.user format as desktop auth

Desktop auth.ts unchanged

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push
```

**Phase 4 Complete:** ✅

---

## Phase 5: Dual Authentication (Critical Step)

**Time Estimate:** 1 hour
**Risk Level:** 🔴 HIGH (modifying existing /mcp endpoint)

### ⚠️ CRITICAL SAFETY WARNINGS

**Before you start:**
1. Commit all current changes
2. Create a backup branch: `git checkout -b backup-before-dual-auth`
3. Return to main: `git checkout main`
4. Take a deep breath - this is the only step that touches desktop code path

**What we're changing:**
- ONLY the first ~10 lines of the `/mcp` route handler
- Adding authentication routing logic
- NOT changing the MCP processing logic (450+ lines)

### Step 5.1: Update /mcp Endpoint with Dual Auth

**File:** `src/routes/mcp.ts`

**Current code (line ~18):**
```typescript
export default async function mcpRoutes(fastify: FastifyInstance) {
  // MCP proxy route with authentication
  fastify.post('/mcp', {
    preHandler: authMiddleware, // ← REMOVE THIS
  }, async (request, reply) => {
    const mcpRequest = request.body as any;
    const user = request.user!; // Set by auth middleware

    // ... rest of handler (450+ lines) ...
```

**New code:**
```typescript
import { authOAuthMiddleware } from '../middleware/auth-oauth.js'; // ADD THIS IMPORT

export default async function mcpRoutes(fastify: FastifyInstance) {
  // MCP proxy route with DUAL authentication
  fastify.post('/mcp', async (request, reply) => { // ← REMOVE preHandler
    // DUAL AUTHENTICATION ROUTING
    const authHeader = request.headers.authorization;
    const sessionHeader = request.headers['mcp-session-id'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // DESKTOP: Use existing Bearer token auth
      await authMiddleware(request, reply);
    } else if (sessionHeader) {
      // WEB: Use new OAuth session auth
      await authOAuthMiddleware(request, reply);
    } else {
      return reply.code(401).send({
        error: {
          code: 'NO_AUTH',
          message: 'Authentication required (Bearer token or Mcp-Session-Id)',
        },
      });
    }

    // If auth failed, middleware already sent error
    if (reply.sent) return;

    // Continue with EXISTING MCP PROCESSING LOGIC (unchanged)
    const mcpRequest = request.body as any;
    const user = request.user!; // Set by EITHER auth middleware

    logger.info({
      method: mcpRequest?.method,
      userId: user.user_id,
      authType: authHeader ? 'bearer' : 'oauth', // ← ADD THIS FOR LOGGING
    }, 'MCP request received');

    // ... REST OF HANDLER (450+ lines) COMPLETELY UNCHANGED ...
```

**Line count verification:**
```bash
# Before
wc -l src/routes/mcp.ts
# ~496 lines

# After
wc -l src/routes/mcp.ts
# ~520 lines (added ~24 lines for dual auth)
```

**Safety Checklist:**
- [ ] Only modified first ~25 lines of route handler
- [ ] Lines 50-495 (MCP processing logic) UNCHANGED
- [ ] Added import for authOAuthMiddleware
- [ ] Removed `preHandler: authMiddleware` from route config
- [ ] Added manual auth routing
- [ ] Desktop path: `if (authHeader.startsWith('Bearer'))`
- [ ] Web path: `else if (sessionHeader)`
- [ ] All existing MCP logic untouched

### Step 5.2: Test Desktop Immediately (CRITICAL)

**Test desktop with Bearer token:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# MUST RETURN: 62
# If not, REVERT IMMEDIATELY:
# git checkout src/routes/mcp.ts
# git checkout src/middleware/
```

**Test that OAuth path exists but requires valid session:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Mcp-Session-Id: invalid_session" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Expected: 401 Invalid session
# This proves OAuth path is active
```

**Verification:**
- [ ] Desktop Bearer token auth works ✅
- [ ] Returns 62 tools ✅
- [ ] OAuth path exists (returns 401 for invalid session) ✅
- [ ] No auth returns 401 with helpful message ✅

### Step 5.3: Commit Dual Auth (If Desktop Works)

**ONLY commit if desktop test passed:**

```bash
git add src/routes/mcp.ts
git commit -m "Add dual authentication to /mcp endpoint

- Support Bearer token (desktop) AND Mcp-Session-Id (web)
- Route to appropriate auth middleware based on header
- Desktop path unchanged - uses existing authMiddleware
- Web path new - uses authOAuthMiddleware
- All MCP processing logic unchanged (450+ lines)

Desktop tested and working ✅

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push
```

### Step 5.4: Deploy and Test Production

**Railway auto-deploys:**
- Wait for deployment
- Test desktop against production URL
- Test OAuth path (should return 401 for invalid session)

**Safety Check:**
- [ ] Desktop works in production
- [ ] OAuth path exists and validates sessions
- [ ] No regression in desktop functionality

**Phase 5 Complete:** ✅

---

## Phase 6: Register OAuth Routes

**Time Estimate:** 30 minutes
**Risk Level:** 🟢 LOW (just adding routes to server)

### Step 6.1: Update Server Index

**File:** `src/index.ts`

**Current code:**
```typescript
import mcpRoutes from './routes/mcp.js';

// Register routes
await fastify.register(healthRoutes);
await fastify.register(mcpRoutes);
```

**New code:**
```typescript
import mcpRoutes from './routes/mcp.js';
import oauthRoutes from './routes/oauth.js'; // ADD THIS

// Register routes
await fastify.register(healthRoutes);
await fastify.register(mcpRoutes);   // Desktop /mcp endpoint
await fastify.register(oauthRoutes); // OAuth endpoints (NEW)
```

**Safety Check:**
- [ ] Only added OAuth routes registration
- [ ] Desktop routes unchanged
- [ ] OAuth routes now accessible

### Step 6.2: Test OAuth Flow End-to-End

**Test authorization endpoint:**
```bash
open "https://api.geenie.io/oauth/authorize?client_id=claude_web&redirect_uri=https://claude.ai/api/mcp/auth_callback&state=test123"

# Should show: Geenie login form
```

**Manual OAuth flow:**
1. Enter your Geenie credentials
2. Click Login
3. Should redirect to claude.ai with auth code
4. (Claude.ai will exchange code for token)

**Safety Check:**
- [ ] OAuth endpoints accessible
- [ ] Login form renders
- [ ] Desktop still works (run safety test!)

### Step 6.3: Commit OAuth Registration

```bash
git add src/index.ts
git commit -m "Register OAuth routes in server

- OAuth endpoints now accessible
- /oauth/authorize, /oauth/login, /oauth/token active
- Desktop /mcp endpoint unchanged

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push
```

**Phase 6 Complete:** ✅

---

## Phase 7: Claude.ai Integration Testing

**Time Estimate:** 1 hour
**Risk Level:** 🟢 LOW (just testing)

### Step 7.1: Add Connector in Claude.ai

**Steps:**
1. Go to https://claude.ai
2. Click Settings → Connectors
3. Click "Add custom connector"
4. Enter:
   - Name: `Geenie`
   - URL: `https://api.geenie.io`
5. Click Add

**Expected:**
- Claude.ai redirects to Geenie OAuth login
- Login with your Geenie credentials
- Authorize connection
- Redirected back to claude.ai
- Connector appears in list: "Geenie (CUSTOM)"

### Step 7.2: Test Connector in Conversation

**Steps:**
1. Start new conversation in claude.ai
2. Ask: "What tools do you have available?"
3. Claude should trigger "Customize Geenie" dialog
4. Select tools to enable
5. Click "Enable Selected"
6. Ask: "List my Amazon Advertising accounts"

**Expected:**
- Dialog shows 62 tools ✅
- Tools can be enabled ✅
- Geenie tools work (list_accounts, etc.) ✅
- No "Wiggle artifact" errors ✅

### Step 7.3: Verify Desktop Still Works

**Final desktop safety test:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# MUST return: 62 ✅

# Test NPM package
npx -y geenie-mcp-client sk_live_YOUR_API_KEY_HERE

# MUST work ✅
```

**Verification:**
- [ ] Desktop works perfectly
- [ ] Web works in claude.ai
- [ ] Both can coexist
- [ ] No conflicts

**Phase 7 Complete:** ✅

---

## Final Checklist

### Desktop Safety (MUST ALL PASS)

- [ ] Desktop endpoint responds: `POST /mcp`
- [ ] Bearer token authentication works
- [ ] Returns 62 tools
- [ ] NPM package works: `npx geenie-mcp-client sk_live_xxx`
- [ ] No errors in production logs for desktop requests
- [ ] Desktop users unaffected by OAuth implementation

### Web Functionality (NEW FEATURES)

- [ ] OAuth login flow works
- [ ] User can log in with Geenie credentials
- [ ] Session token generated
- [ ] Connector appears in claude.ai
- [ ] Tools load in "Customize Geenie" dialog
- [ ] 62 tools available
- [ ] Tools can be executed
- [ ] No "Wiggle artifact" errors

### Code Safety

- [ ] `src/middleware/auth.ts` unchanged (desktop auth)
- [ ] `/packages/mcp-client/` unchanged (NPM package)
- [ ] OAuth code in separate files
- [ ] Dual auth routing works
- [ ] No code overlap between desktop and web

### Database

- [ ] `oauth_sessions` table created
- [ ] `oauth_clients` table created
- [ ] `oauth_auth_codes` table created
- [ ] RLS policies active
- [ ] Desktop uses `api_keys` table (unchanged)
- [ ] Web uses `oauth_sessions` table (new)

### Deployment

- [ ] All changes committed to git
- [ ] Railway deployment successful
- [ ] Production logs show no errors
- [ ] Both desktop and web work in production

---

## Rollback Procedures

### If Desktop Breaks

**Immediate rollback:**
```bash
# Revert dual auth changes
git log --oneline -10
# Find commit hash before dual auth

git revert <commit-hash>
git push

# Or hard reset (if not pushed yet)
git reset --hard <commit-hash-before-dual-auth>
git push --force
```

**Verify desktop works:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_xxx" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Should work after rollback ✅
```

### If OAuth Breaks (But Desktop Works)

**Disable OAuth temporarily:**

```typescript
// src/index.ts
await fastify.register(mcpRoutes);   // Desktop - keep
// await fastify.register(oauthRoutes); // OAuth - comment out temporarily
```

**Result:**
- Desktop: Works ✅
- Web: OAuth unavailable (can fix later)
- No downtime for desktop users

---

## Success Metrics

**Desktop (Must Maintain):**
- Uptime: 100%
- Response time: < 500ms
- Error rate: 0%
- NPM package compatibility: 100%

**Web (New Target):**
- OAuth success rate: > 95%
- Session duration: 7 days
- Tool loading: < 2 seconds
- Error rate: < 5%

**Overall:**
- Zero desktop user complaints
- Web users can use same features as desktop
- Seamless authentication experience
- No "Wiggle artifact" errors

---

## Notes & Learnings

**What We Learned:**
- [ ] Claude.ai requires OAuth (not query param auth)
- [ ] Streamable HTTP is future-proof (SSE deprecated)
- [ ] Dual auth allows same endpoint for both methods
- [ ] Desktop safety is paramount - test after EVERY change

**Best Practices:**
- [ ] Always test desktop after each phase
- [ ] Commit frequently with descriptive messages
- [ ] Keep desktop and web code separated
- [ ] Use different auth headers to avoid conflicts

**Future Improvements:**
- [ ] Token refresh for long sessions
- [ ] Better OAuth error messages
- [ ] Session activity tracking
- [ ] Multi-factor authentication (optional)

---

## Timeline Summary

- **Phase 1:** Cleanup - 1 hour
- **Phase 2:** Database - 30 minutes
- **Phase 3:** OAuth Routes - 2 hours
- **Phase 4:** OAuth Middleware - 1 hour
- **Phase 5:** Dual Auth - 1 hour (⚠️ CRITICAL)
- **Phase 6:** Register Routes - 30 minutes
- **Phase 7:** Testing - 1 hour

**Total:** 6-7 hours
**Desktop Downtime:** 0 minutes ✅

**Status:** Ready to begin Phase 1 (Cleanup)
