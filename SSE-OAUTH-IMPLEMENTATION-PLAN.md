# SSE + OAuth Web Connector Implementation Plan

## Executive Summary

We're adding **web/mobile support** to Geenie while keeping the **desktop NPM package completely safe and untouched**. These are TWO SEPARATE SYSTEMS that work independently.

---

## Current State vs Future State

### Current: Desktop Only ✅ (Working - Don't Touch!)

```
User's Computer
    ↓
Claude Desktop App
    ↓
NPM Package (geenie-mcp-client)
    ↓
HTTP POST to api.geenie.io/mcp
    ↓
Bearer Token Authentication
    ↓
Amazon MCP Server
```

**Files Used:**
- `/mcp` route in `src/routes/mcp.ts` (lines 18-495)
- `authMiddleware` in `src/middleware/auth.ts`
- NPM package in `/packages/mcp-client/`

**Authentication:** Bearer token (API key in Authorization header)

**Status:** ✅ **WORKING - WILL NOT BE MODIFIED**

---

### Future: Desktop + Web/Mobile 🆕

```
Desktop (Existing - No Changes)
    User's Computer → Claude Desktop → NPM Package → POST /mcp → Works!

Web/Mobile (New - To Be Built)
    Browser/Phone → claude.ai → OAuth Login → SSE /sse → Works!
```

---

## Understanding the Two Methods (Beginner-Friendly)

### Method 1: Desktop (Current - Like a Direct Phone Call)

**Imagine:** You call your friend directly on their phone.

1. **You** (User) open Claude Desktop on your computer
2. **Claude Desktop** runs a small program (NPM package) in the background
3. **The program** connects directly to Geenie's server using your API key
4. **Communication** happens instantly - request → response
5. **Like:** A direct phone call - simple, fast, always works the same way

**Tech Details:**
- Transport: stdio (standard input/output) + HTTP POST
- The NPM package is a local process that talks to our server
- API key is passed as a command-line argument
- Each request/response is independent

**Why Desktop Stays Safe:**
- Uses completely different code files
- Different endpoint (`/mcp` vs `/sse`)
- Different authentication method (Bearer token vs OAuth)
- If web breaks, desktop keeps working because they don't share code

---

### Method 2: Web/Mobile (New - Like a Subscription Service)

**Imagine:** You subscribe to Netflix and watch from any device.

1. **You** (User) go to claude.ai in your browser
2. **Claude.ai** asks you to log in to Geenie (OAuth)
3. **After login**, Claude.ai opens a persistent connection to Geenie
4. **Communication** happens over a "stream" that stays open
5. **Like:** Netflix - you log in once, then watch from anywhere

**Tech Details:**
- Transport: SSE (Server-Sent Events) - a persistent HTTP connection
- OAuth handles login and creates a session token
- The connection stays open, allowing real-time streaming
- Works on web browsers and mobile apps

**Why This Doesn't Break Desktop:**
- Completely separate endpoint (`GET /sse` instead of `POST /mcp`)
- Different authentication system (OAuth vs Bearer token)
- Different code files and logic
- Desktop never uses or touches the SSE/OAuth code

---

## Safety Guarantee: How Desktop Stays Untouched

### Files That Will NOT Be Modified

**Desktop-only files (100% safe):**
```
✅ /packages/mcp-client/index.js       - NPM package (untouched)
✅ /packages/mcp-client/package.json   - NPM package (untouched)
✅ src/middleware/auth.ts              - Desktop auth (untouched)
✅ Lines 18-495 in src/routes/mcp.ts   - Desktop route (untouched)
```

**Why?** These files handle ONLY the desktop version. Since we're adding NEW endpoints for web, we never need to modify desktop code.

---

### Files That Will Be Removed

**Failed web attempt (cleanup):**
```
❌ Lines 497-977 in src/routes/mcp.ts  - Failed /mcp-web route (DELETE)
❌ src/middleware/auth-web.ts          - Failed query param auth (DELETE)
❌ src/middleware/auth-path.ts         - Failed path param auth (DELETE)
```

**Why Remove?** These were built on a wrong assumption (URL-based auth). Claude.ai requires OAuth + SSE instead.

---

### Files That Will Be Added (New)

**Web/mobile-only files (NEW):**
```
🆕 src/routes/sse.ts                   - SSE endpoint for streaming
🆕 src/routes/oauth.ts                 - OAuth login flow
🆕 src/middleware/auth-oauth.ts        - OAuth session validation
🆕 src/services/oauth-tokens.ts        - OAuth token management
🆕 src/services/sse-stream.ts          - SSE connection handler
```

**Why New Files?** Keeps desktop and web completely separated. If web breaks, desktop is unaffected.

---

## Detailed Implementation Plan

### Phase 1: Cleanup (Remove Failed Attempt)

**Step 1.1: Remove /mcp-web route**
- File: `src/routes/mcp.ts`
- Action: Delete lines 497-977 (the entire `/mcp-web` POST route)
- Impact: None - this route never worked and isn't used

**Step 1.2: Remove failed middleware**
- Files to delete:
  - `src/middleware/auth-web.ts`
  - `src/middleware/auth-path.ts`
- Action: Delete these files entirely
- Impact: None - they were only used by the failed route

**Step 1.3: Remove unused import**
- File: `src/routes/mcp.ts`
- Action: Remove line 5-6 (imports for authWebMiddleware, authPathMiddleware)
- Impact: None - cleaning up unused code

**Verification:**
```bash
# Desktop endpoint still works
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Status:** ✅ Desktop untouched, cleanup complete

---

### Phase 2: Database Setup (OAuth Sessions)

**Step 2.1: Add OAuth sessions table**
- File: `supabase/add-oauth-sessions.sql`
- Purpose: Store OAuth login sessions for web users
- Schema:
```sql
CREATE TABLE oauth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  access_token TEXT NOT NULL,    -- OAuth access token
  refresh_token TEXT,             -- OAuth refresh token (optional)
  expires_at TIMESTAMP NOT NULL,  -- When session expires
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_oauth_sessions_access_token ON oauth_sessions(access_token);
CREATE INDEX idx_oauth_sessions_user_id ON oauth_sessions(user_id);
```

**Step 2.2: Add OAuth clients table**
- Purpose: Store OAuth client registrations (claude.ai)
- Schema:
```sql
CREATE TABLE oauth_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT UNIQUE NOT NULL,     -- Generated client ID
  client_secret TEXT NOT NULL,         -- Generated client secret
  redirect_uris TEXT[] NOT NULL,       -- Allowed callback URLs
  name TEXT NOT NULL,                  -- "Claude" or "Claude AI"
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert Claude.ai as a client
INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, name)
VALUES (
  'claude_ai_web',
  'GENERATED_SECRET_HERE',
  ARRAY['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'],
  'Claude'
);
```

**Impact on Desktop:** NONE - Desktop doesn't use these tables

---

### Phase 3: OAuth Implementation

**Step 3.1: Create OAuth routes**
- File: `src/routes/oauth.ts` (NEW)
- Endpoints:
  - `GET /oauth/authorize` - Start OAuth flow
  - `POST /oauth/token` - Exchange code for tokens
  - `GET /oauth/userinfo` - Get user info

**Step 3.2: OAuth Flow (How It Works)**

```
User in claude.ai
    ↓
1. User adds Geenie connector → Enters URL: https://api.geenie.io
    ↓
2. Claude.ai redirects to: https://api.geenie.io/oauth/authorize?client_id=claude_ai_web&redirect_uri=...
    ↓
3. Geenie shows login page → User enters email/password (Supabase auth)
    ↓
4. After login, redirect to: https://claude.ai/api/mcp/auth_callback?code=AUTH_CODE
    ↓
5. Claude.ai exchanges code for token: POST /oauth/token
    ↓
6. Geenie returns: { access_token: "TOKEN", expires_in: 3600 }
    ↓
7. Claude.ai uses access_token for all future SSE requests
```

**Step 3.3: OAuth Middleware**
- File: `src/middleware/auth-oauth.ts` (NEW)
- Purpose: Validate OAuth access tokens on SSE requests
- Logic:
```typescript
export async function authOAuthMiddleware(request, reply) {
  // Extract token from request (different from desktop Bearer auth)
  const token = request.headers['x-mcp-session-token'];

  // Validate in database
  const session = await supabase
    .from('oauth_sessions')
    .select('*, subscriptions(*)')
    .eq('access_token', token)
    .single();

  if (!session || new Date(session.expires_at) < new Date()) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }

  // Attach user to request (same pattern as desktop)
  request.user = {
    user_id: session.user_id,
    subscription: session.subscriptions
  };
}
```

**Impact on Desktop:** NONE - Desktop uses `authMiddleware` (different file, different logic)

---

### Phase 4: SSE Implementation

**Step 4.1: Create SSE route**
- File: `src/routes/sse.ts` (NEW)
- Endpoint: `GET /sse`
- Purpose: Stream MCP messages using Server-Sent Events

**Step 4.2: How SSE Works (Beginner Explanation)**

**Regular HTTP (Desktop uses this):**
```
Client: "Hey server, give me tools"
Server: "Here are 62 tools" ← Connection closes
Client: "Hey server, call this tool"
Server: "Here's the result" ← Connection closes
```
Each request opens and closes a new connection.

**SSE (Web uses this):**
```
Client: "Hey server, open a stream"
Server: "Stream opened, stay connected..."
Client: "Give me tools"
Server: "Here are 62 tools" ← Connection stays open!
Client: "Call this tool"
Server: "Here's the result" ← Still connected!
```
One connection stays open for all messages.

**Step 4.3: SSE Route Code**
```typescript
// src/routes/sse.ts
import { FastifyInstance } from 'fastify';
import { authOAuthMiddleware } from '../middleware/auth-oauth.js';

export default async function sseRoutes(fastify: FastifyInstance) {
  fastify.get('/sse', {
    preHandler: authOAuthMiddleware, // OAuth validation (NOT Bearer token!)
  }, async (request, reply) => {
    const user = request.user!;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 30000); // Every 30 seconds

    // Handle MCP messages from client
    request.raw.on('data', async (chunk) => {
      const mcpRequest = JSON.parse(chunk.toString());

      // Process MCP request (same logic as desktop /mcp route)
      const result = await processMCPRequest(mcpRequest, user);

      // Send result via SSE
      reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
    });

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(keepAlive);
    });
  });
}
```

**Step 4.4: Reuse Desktop Logic**
- Extract shared MCP processing logic into a common function
- File: `src/services/mcp-handler.ts` (NEW)
- Both desktop `/mcp` and web `/sse` call this function
- Example:
```typescript
// Shared logic used by BOTH desktop and web
export async function processMCPRequest(mcpRequest, user) {
  // Handle Geenie custom tools
  if (mcpRequest.method === 'tools/call') {
    if (toolName === 'geenie_list_accounts') {
      return await listAccounts(user.user_id);
    }
  }

  // Forward to Amazon MCP
  const { accessToken, account } = await getValidAccessToken(user.user_id);
  const response = await fetch(amazonMcpEndpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(mcpRequest)
  });

  return await response.json();
}
```

**Impact on Desktop:** Desktop `/mcp` route will be refactored to call `processMCPRequest()`, but the endpoint itself doesn't change. Desktop users see zero difference.

---

### Phase 5: Integration & Testing

**Step 5.1: Register routes in main server**
- File: `src/index.ts`
- Add:
```typescript
import sseRoutes from './routes/sse.js';
import oauthRoutes from './routes/oauth.js';

// Existing routes (untouched)
await fastify.register(mcpRoutes);  // Desktop /mcp endpoint

// New routes (web/mobile only)
await fastify.register(oauthRoutes); // OAuth endpoints
await fastify.register(sseRoutes);   // SSE endpoint
```

**Step 5.2: Test Desktop (Verify Safety)**
```bash
# This MUST still work exactly as before
npx -y geenie-mcp-client sk_live_xxxxx

# Claude Desktop should list 62 tools and work perfectly
```

**Step 5.3: Test Web OAuth Flow**
```bash
# 1. Start OAuth flow
open "https://api.geenie.io/oauth/authorize?client_id=claude_ai_web&redirect_uri=https://claude.ai/api/mcp/auth_callback"

# 2. Login with Supabase credentials

# 3. Verify redirect to claude.ai with auth code

# 4. Exchange code for token
curl -X POST https://api.geenie.io/oauth/token \
  -d "grant_type=authorization_code&code=AUTH_CODE&client_id=claude_ai_web"

# 5. Verify access token returned
```

**Step 5.4: Test SSE Connection**
```bash
# Connect to SSE endpoint with OAuth token
curl -N -H "X-MCP-Session-Token: ACCESS_TOKEN" \
  https://api.geenie.io/sse

# Should see: Stream opened, periodic keepalive messages

# Send MCP request (requires SSE client)
# Expected: tools/list returns 62 tools via SSE
```

**Step 5.5: Test in claude.ai**
1. Go to claude.ai → Settings → Connectors
2. Add custom connector: `https://api.geenie.io`
3. Follow OAuth login flow
4. Verify connector appears in list
5. Start conversation and enable Geenie connector
6. Ask: "What Amazon Ads tools do you have?"
7. Verify: Claude lists Geenie tools and can use them

---

## Safety Checklist

Before deploying, verify:

**Desktop Safety:**
- [ ] `POST /mcp` endpoint still responds
- [ ] Bearer token authentication still works
- [ ] NPM package `geenie-mcp-client` unchanged
- [ ] `src/middleware/auth.ts` unchanged
- [ ] Desktop route code (lines 18-495) unchanged
- [ ] Test: `npx -y geenie-mcp-client sk_live_xxx` works

**Web Implementation:**
- [ ] `GET /oauth/authorize` returns login page
- [ ] `POST /oauth/token` exchanges code for token
- [ ] `GET /sse` accepts SSE connections
- [ ] OAuth tokens validated correctly
- [ ] SSE streams MCP messages
- [ ] Test: OAuth flow completes in claude.ai

**Code Separation:**
- [ ] Desktop uses `authMiddleware` (Bearer token)
- [ ] Web uses `authOAuthMiddleware` (OAuth token)
- [ ] Desktop uses `POST /mcp`
- [ ] Web uses `GET /sse` + OAuth endpoints
- [ ] Shared logic in separate `mcp-handler.ts`
- [ ] No overlap between desktop and web code paths

---

## Deployment Strategy

### Phase 1: Cleanup (Safe - No User Impact)
1. Remove `/mcp-web` route, auth-web.ts, auth-path.ts
2. Deploy to Railway
3. Test desktop: `npx geenie-mcp-client sk_live_xxx`
4. Verify: Desktop works perfectly

### Phase 2: Database (Safe - Just Adding Tables)
1. Run OAuth migration: `supabase/add-oauth-sessions.sql`
2. No code changes yet
3. Desktop unaffected

### Phase 3: OAuth Endpoints (Safe - Desktop Doesn't Use Them)
1. Add OAuth routes (`/oauth/authorize`, `/oauth/token`)
2. Deploy to Railway
3. Test OAuth flow manually
4. Desktop still works (doesn't use OAuth)

### Phase 4: SSE Endpoint (Safe - Desktop Doesn't Use It)
1. Add SSE route (`GET /sse`)
2. Deploy to Railway
3. Test SSE connection manually
4. Desktop still works (uses `POST /mcp`)

### Phase 5: Web Integration (Users Can Now Use Web)
1. Add connector in claude.ai with URL: `https://api.geenie.io`
2. Complete OAuth flow
3. Test connector in conversation
4. Desktop and web both work independently

---

## Rollback Plan

If web breaks, desktop is unaffected because:

**Desktop uses:**
- Endpoint: `POST /mcp`
- Auth: Bearer token (Authorization header)
- File: `src/middleware/auth.ts`
- Code: Lines 18-495 in `src/routes/mcp.ts`

**Web uses:**
- Endpoint: `GET /sse`
- Auth: OAuth token (X-MCP-Session-Token header)
- Files: `src/routes/sse.ts`, `src/routes/oauth.ts`, `src/middleware/auth-oauth.ts`

**If web fails:**
1. Desktop keeps working (different endpoints, different auth)
2. Remove web routes from `src/index.ts`
3. Deploy
4. Web is disabled, desktop continues working

**No shared code = No shared failures**

---

## Visual Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    DESKTOP (Current - Safe)                 │
├─────────────────────────────────────────────────────────────┤
│ User's Computer                                             │
│    ↓                                                        │
│ Claude Desktop                                              │
│    ↓                                                        │
│ NPM: geenie-mcp-client sk_live_xxxxx                       │
│    ↓                                                        │
│ HTTP POST /mcp                                              │
│    ↓                                                        │
│ Auth: Bearer sk_live_xxxxx (Header)                        │
│    ↓                                                        │
│ File: src/middleware/auth.ts ← UNCHANGED                   │
│    ↓                                                        │
│ Route: src/routes/mcp.ts (lines 18-495) ← UNCHANGED       │
│    ↓                                                        │
│ Amazon MCP Server                                           │
│    ↓                                                        │
│ Response: 62 tools                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    WEB/MOBILE (New - Separate)              │
├─────────────────────────────────────────────────────────────┤
│ Browser/Mobile App                                          │
│    ↓                                                        │
│ claude.ai                                                   │
│    ↓                                                        │
│ Add Connector: https://api.geenie.io                       │
│    ↓                                                        │
│ OAuth Flow: GET /oauth/authorize                           │
│    ↓                                                        │
│ User Login (Supabase)                                       │
│    ↓                                                        │
│ Callback: POST /oauth/token                                 │
│    ↓                                                        │
│ Auth: OAuth token (X-MCP-Session-Token header)             │
│    ↓                                                        │
│ File: src/middleware/auth-oauth.ts ← NEW                   │
│    ↓                                                        │
│ Route: src/routes/sse.ts ← NEW                             │
│    ↓                                                        │
│ Shared: src/services/mcp-handler.ts                        │
│    ↓                                                        │
│ Amazon MCP Server                                           │
│    ↓                                                        │
│ SSE Stream: 62 tools                                        │
└─────────────────────────────────────────────────────────────┘

KEY POINT: Different endpoints, different auth, different files
           If one breaks, the other keeps working!
```

---

## Beginner Summary

**What We're Doing:**
Adding a second way to use Geenie (web/mobile) while keeping the first way (desktop) exactly as it is.

**Why Desktop Stays Safe:**
- Desktop uses door #1 (POST /mcp with Bearer token)
- Web uses door #2 (GET /sse with OAuth token)
- Different doors = if door #2 breaks, door #1 still works

**How Web Works:**
1. User visits claude.ai
2. Adds Geenie connector
3. Logs in with email/password (OAuth)
4. Claude.ai opens a streaming connection (SSE)
5. User can chat and use Amazon Ads tools

**Why This Is Better Than What We Tried Before:**
- Before: Tried to pass API key in URL (claude.ai doesn't support this)
- Now: Using OAuth (proper login) + SSE (streaming connection)
- This is the official way Claude.ai expects connectors to work

---

## Next Steps

1. **Review this plan** - Make sure you understand the separation
2. **Approve cleanup** - Remove failed `/mcp-web` attempt
3. **Implement Phase by Phase** - Test after each phase
4. **Desktop always works** - Never modify desktop code

Ready to start Phase 1 (Cleanup)?
