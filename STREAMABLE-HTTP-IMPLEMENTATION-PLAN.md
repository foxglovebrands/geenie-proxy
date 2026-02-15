# Streamable HTTP Web Connector Implementation Plan
## ✅ Using Future-Proof Technology (Not Deprecated SSE)

**Last Updated:** Based on Claude documentation stating SSE will be deprecated

---

## Executive Summary

We're adding **OAuth authentication** to the existing `/mcp` endpoint to support claude.ai web/mobile, while keeping desktop NPM package **completely safe** with its existing Bearer token auth.

**Key Insight:** Streamable HTTP uses regular HTTP POST/GET (not SSE!), so we can use the **SAME endpoint** with **dual authentication**:
- Desktop: `Authorization: Bearer sk_live_xxx` (existing, unchanged)
- Web: `Mcp-Session-Id: oauth_token_xxx` (new OAuth header)

---

## Why This Is Safer Than The Previous Plan

### Previous Plan (SSE - Now Outdated)
- ❌ Separate `/sse` endpoint (SSE being deprecated)
- ❌ Long-lived connections
- ❌ More complex streaming logic
- ❌ Two completely different code paths

### New Plan (Streamable HTTP - Future-Proof)
- ✅ **Same `/mcp` endpoint** (simpler!)
- ✅ Regular HTTP POST (we already have this!)
- ✅ **Dual authentication** (Bearer OR OAuth)
- ✅ Minimal code changes to existing endpoint
- ✅ If OAuth fails, Bearer token (desktop) still works

---

## How Desktop Stays 100% Safe

### Desktop's Path (Unchanged)
```
1. User runs: npx geenie-mcp-client sk_live_xxxxx
2. Request sent to: POST /mcp
3. Header: Authorization: Bearer sk_live_xxxxx
4. Middleware: authMiddleware() validates Bearer token
5. If valid: Process request
6. Return: 62 tools

Status: ✅ UNCHANGED
```

### Web's Path (New, Parallel)
```
1. User adds connector in claude.ai
2. OAuth login flow
3. Request sent to: POST /mcp (SAME ENDPOINT!)
4. Header: Mcp-Session-Id: oauth_token_xxx
5. Middleware: Check if OAuth token? → authOAuthMiddleware()
6. If valid: Process request (same logic as desktop)
7. Return: 62 tools

Status: 🆕 NEW, but doesn't affect desktop
```

### Safety Mechanism: Authentication Routing

```typescript
// Existing /mcp endpoint (we'll enhance it safely)
fastify.post('/mcp', async (request, reply) => {
  // STEP 1: Check which auth method is being used
  const authHeader = request.headers.authorization;
  const sessionHeader = request.headers['mcp-session-id'];

  // STEP 2: Route to appropriate authentication
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // DESKTOP PATH (existing code - unchanged)
    await authMiddleware(request, reply);
  } else if (sessionHeader) {
    // WEB PATH (new code - separate)
    await authOAuthMiddleware(request, reply);
  } else {
    return reply.code(401).send({ error: 'No authentication provided' });
  }

  // STEP 3: After auth, same processing for both
  // (This part already exists and works for desktop)
  const mcpRequest = request.body;
  const user = request.user; // Set by either auth middleware

  // ... existing MCP processing logic ...
});
```

**Key Safety Point:**
- Desktop requests have `Authorization: Bearer xxx` → Use existing auth
- Web requests have `Mcp-Session-Id: xxx` → Use new OAuth auth
- **They never overlap** - if one breaks, the other works

---

## Implementation Phases

### Phase 1: Cleanup (Remove Failed Attempts)

**What to Remove:**
```
❌ Lines 497-977 in src/routes/mcp.ts  - Failed /mcp-web route
❌ src/middleware/auth-web.ts          - Failed query param auth
❌ src/middleware/auth-path.ts         - Failed path param auth
❌ Line 5-6 in src/routes/mcp.ts       - Unused imports
```

**Why Safe:** These files/lines are NOT used by desktop. Removing them has zero impact.

**After Cleanup:**
- Desktop `/mcp` endpoint: Still works ✅
- Bearer token auth: Still works ✅
- NPM package: Still works ✅

**Test Command:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

Expected: Returns 62 tools (desktop still works!)
```

---

### Phase 2: Database (OAuth Sessions)

**Add OAuth Tables:**

```sql
-- supabase/add-oauth-sessions.sql

-- Store OAuth sessions for web/mobile users
CREATE TABLE oauth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  session_id TEXT UNIQUE NOT NULL,      -- The Mcp-Session-Id value
  access_token TEXT,                     -- OAuth access token (optional)
  expires_at TIMESTAMP NOT NULL,         -- When session expires
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast session lookups
CREATE INDEX idx_oauth_sessions_session_id ON oauth_sessions(session_id);
CREATE INDEX idx_oauth_sessions_user_id ON oauth_sessions(user_id);

-- Store OAuth client configurations (claude.ai)
CREATE TABLE oauth_clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id TEXT UNIQUE NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  name TEXT NOT NULL DEFAULT 'Claude',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert Claude.ai as an OAuth client
INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, name)
VALUES (
  'claude_web',
  gen_random_uuid()::text,  -- Generate random secret
  ARRAY[
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback'
  ],
  'Claude'
);
```

**Impact on Desktop:** ZERO - Desktop doesn't use these tables

**Test Desktop Still Works:**
```bash
npx -y geenie-mcp-client sk_live_xxxxx
# Should still return 62 tools ✅
```

---

### Phase 3: OAuth Routes (Separate from Desktop)

**Create New File:** `src/routes/oauth.ts`

This file handles OAuth login flow for web. Desktop never uses these routes.

```typescript
// src/routes/oauth.ts (NEW FILE)
import { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import crypto from 'crypto';

export default async function oauthRoutes(fastify: FastifyInstance) {

  // Step 1: Authorization endpoint (where OAuth flow starts)
  fastify.get('/oauth/authorize', async (request, reply) => {
    const { client_id, redirect_uri, state } = request.query as any;

    // Validate client
    const { data: client } = await supabase
      .from('oauth_clients')
      .select('*')
      .eq('client_id', client_id)
      .single();

    if (!client || !client.redirect_uris.includes(redirect_uri)) {
      return reply.code(400).send({ error: 'Invalid client or redirect URI' });
    }

    // Redirect to Supabase login page
    // (This will be a simple HTML form for now)
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head><title>Login to Geenie</title></head>
        <body>
          <h1>Login to Geenie</h1>
          <form method="POST" action="/oauth/login">
            <input type="hidden" name="client_id" value="${client_id}" />
            <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
            <input type="hidden" name="state" value="${state}" />

            <label>Email: <input type="email" name="email" required /></label><br/>
            <label>Password: <input type="password" name="password" required /></label><br/>
            <button type="submit">Login</button>
          </form>

          <p>Don't have an account? <a href="https://app.geenie.io">Sign up</a></p>
        </body>
      </html>
    `);
  });

  // Step 2: Process login
  fastify.post('/oauth/login', async (request, reply) => {
    const { email, password, client_id, redirect_uri, state } = request.body as any;

    // Authenticate with Supabase
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !authData.user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Generate authorization code
    const authCode = crypto.randomBytes(32).toString('hex');

    // Store authorization code temporarily (expires in 10 minutes)
    await supabase.from('oauth_auth_codes').insert({
      code: authCode,
      user_id: authData.user.id,
      client_id,
      redirect_uri,
      expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    // Redirect back to claude.ai with authorization code
    const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state}`;
    return reply.redirect(302, redirectUrl);
  });

  // Step 3: Token endpoint (exchange code for session token)
  fastify.post('/oauth/token', async (request, reply) => {
    const { grant_type, code, client_id, client_secret } = request.body as any;

    if (grant_type !== 'authorization_code') {
      return reply.code(400).send({ error: 'Unsupported grant type' });
    }

    // Verify client credentials
    const { data: client } = await supabase
      .from('oauth_clients')
      .select('*')
      .eq('client_id', client_id)
      .eq('client_secret', client_secret)
      .single();

    if (!client) {
      return reply.code(401).send({ error: 'Invalid client credentials' });
    }

    // Exchange authorization code for session
    const { data: authCode } = await supabase
      .from('oauth_auth_codes')
      .select('*')
      .eq('code', code)
      .single();

    if (!authCode || new Date(authCode.expires_at) < new Date()) {
      return reply.code(400).send({ error: 'Invalid or expired authorization code' });
    }

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    await supabase.from('oauth_sessions').insert({
      user_id: authCode.user_id,
      session_id: sessionId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    // Delete used authorization code
    await supabase.from('oauth_auth_codes').delete().eq('code', code);

    // Return session token
    return reply.send({
      access_token: sessionId,
      token_type: 'Bearer',
      expires_in: 604800, // 7 days in seconds
    });
  });
}
```

**Add Auth Codes Table:**
```sql
-- Temporary storage for OAuth authorization codes
CREATE TABLE oauth_auth_codes (
  code TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Impact on Desktop:** ZERO - Desktop never calls these OAuth routes

**Test Desktop Still Works:**
```bash
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

Expected: Desktop still works! ✅
```

---

### Phase 4: OAuth Middleware (Parallel to Desktop Auth)

**Create New File:** `src/middleware/auth-oauth.ts`

```typescript
// src/middleware/auth-oauth.ts (NEW FILE)
import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase, type Subscription } from '../services/supabase.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      user_id: string;
      subscription: Subscription;
    };
  }
}

export async function authOAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Extract session ID from Mcp-Session-Id header
  const sessionId = request.headers['mcp-session-id'] as string;

  if (!sessionId) {
    return reply.code(401).send({
      error: {
        code: 'MISSING_SESSION',
        message: 'Mcp-Session-Id header required for OAuth authentication',
      },
    });
  }

  try {
    // Validate session in database
    const { data: session, error } = await supabase
      .from('oauth_sessions')
      .select(`
        user_id,
        expires_at,
        auth_users!inner(id, email),
        subscriptions!inner(*)
      `)
      .eq('session_id', sessionId)
      .single();

    if (error || !session) {
      return reply.code(401).send({
        error: {
          code: 'INVALID_SESSION',
          message: 'Invalid or expired session',
        },
      });
    }

    // Check if session expired
    if (new Date(session.expires_at) < new Date()) {
      return reply.code(401).send({
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Session has expired. Please log in again.',
        },
      });
    }

    // Check subscription status (same logic as desktop)
    const subscription = session.subscriptions;
    const { status, trial_ends_at } = subscription;

    const isActive = status === 'active';
    const isTrialing =
      status === 'trialing' &&
      trial_ends_at &&
      new Date(trial_ends_at) > new Date();

    if (!isActive && !isTrialing) {
      return reply.code(403).send({
        error: {
          code: 'SUBSCRIPTION_EXPIRED',
          message: 'Your subscription is inactive',
          url: 'https://app.geenie.io/dashboard/billing',
        },
      });
    }

    // Attach user context to request (same format as desktop!)
    request.user = {
      user_id: session.user_id,
      subscription,
    };

    // Update last_used_at
    supabase
      .from('oauth_sessions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .then();

  } catch (error: any) {
    request.log.error({ error }, 'OAuth authentication error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication error occurred',
      },
    });
  }
}
```

**Impact on Desktop:** ZERO - Desktop uses `authMiddleware` (different file)

---

### Phase 5: Update /mcp Endpoint (Add Dual Auth)

**Modify:** `src/routes/mcp.ts`

**Current Code (Desktop Only):**
```typescript
fastify.post('/mcp', {
  preHandler: authMiddleware,  // Only Bearer token auth
}, async (request, reply) => {
  // ... existing MCP logic ...
});
```

**New Code (Desktop + Web):**
```typescript
import { authOAuthMiddleware } from '../middleware/auth-oauth.js';

fastify.post('/mcp', async (request, reply) => {
  // DUAL AUTHENTICATION: Check which method is being used
  const authHeader = request.headers.authorization;
  const sessionHeader = request.headers['mcp-session-id'];

  // Route to appropriate authentication
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

  // If auth failed, middleware already sent error response
  if (reply.sent) return;

  // Continue with existing MCP processing logic
  const mcpRequest = request.body as any;
  const user = request.user!; // Set by EITHER auth middleware

  logger.info({
    method: mcpRequest?.method,
    userId: user.user_id,
    authType: authHeader ? 'bearer' : 'oauth',
  }, 'MCP request received');

  // ... REST OF EXISTING MCP LOGIC (unchanged) ...
  // This includes:
  // - Geenie custom tools (list_accounts, switch_account, etc.)
  // - Tool filtering and restrictions
  // - Amazon MCP proxying
  // - All the existing working code
});
```

**Safety Analysis:**
- Desktop requests: `Authorization: Bearer xxx` → Takes desktop path (existing code)
- Web requests: `Mcp-Session-Id: xxx` → Takes new OAuth path
- **If OAuth breaks:** Desktop still works (uses Bearer token path)
- **If Bearer breaks:** Impossible - we didn't change that code!

**Lines Changed:** ~10 lines at the start of the route handler
**Lines Unchanged:** 450+ lines of existing MCP logic

---

### Phase 6: Register OAuth Routes

**Modify:** `src/index.ts`

```typescript
import mcpRoutes from './routes/mcp.js';
import oauthRoutes from './routes/oauth.js';  // NEW

// Existing routes (untouched)
await fastify.register(mcpRoutes);  // Desktop /mcp endpoint

// New routes (web/mobile only)
await fastify.register(oauthRoutes); // OAuth endpoints
```

**Impact on Desktop:** ZERO - Just adding new routes, not modifying existing

---

## Testing Strategy

### Test 1: Desktop Still Works (After Each Phase)

```bash
# Test desktop endpoint with Bearer token
curl -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

Expected Response:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [ ... 62 tools ... ]
  }
}

Status: ✅ Desktop unaffected
```

### Test 2: OAuth Flow Works

```bash
# Step 1: Start OAuth flow
open "https://api.geenie.io/oauth/authorize?client_id=claude_web&redirect_uri=https://claude.ai/api/mcp/auth_callback&state=random"

# Step 2: Login with email/password
# (Manual browser interaction)

# Step 3: Verify redirect with auth code
# Should redirect to: https://claude.ai/api/mcp/auth_callback?code=xxxxx&state=random

# Step 4: Exchange code for token
curl -X POST https://api.geenie.io/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "AUTH_CODE_FROM_STEP_3",
    "client_id": "claude_web",
    "client_secret": "CLIENT_SECRET"
  }'

Expected Response:
{
  "access_token": "SESSION_ID_xxxxx",
  "token_type": "Bearer",
  "expires_in": 604800
}
```

### Test 3: Web Requests Work (Same Endpoint as Desktop!)

```bash
# Use OAuth session token with same /mcp endpoint
curl -X POST https://api.geenie.io/mcp \
  -H "Mcp-Session-Id: SESSION_ID_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

Expected Response:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [ ... 62 tools ... ]
  }
}

Status: ✅ Web works using OAuth
Status: ✅ Desktop still works using Bearer token
```

### Test 4: Claude.ai Integration

```
1. Go to claude.ai → Settings → Connectors
2. Click "Add custom connector"
3. Enter URL: https://api.geenie.io
4. Claude.ai will redirect to OAuth flow
5. Login with Geenie credentials
6. Authorize connection
7. Connector added successfully
8. Start conversation, enable Geenie connector
9. Ask: "What Amazon Ads tools do you have?"
10. Verify: Claude lists and uses tools
```

---

## Safety Guarantees

### Desktop Safety Checklist

**Files Never Modified:**
- ✅ `/packages/mcp-client/index.js` - NPM package
- ✅ `/packages/mcp-client/package.json` - NPM package
- ✅ `src/middleware/auth.ts` - Desktop auth (Bearer token)

**Files Modified (But Desktop Code Untouched):**
- ⚠️ `src/routes/mcp.ts` - Added dual auth routing (10 lines)
  - Desktop path: `if (authHeader.startsWith('Bearer'))` → Existing code
  - Web path: `else if (sessionHeader)` → New code
  - **Desktop code itself unchanged**

**Files Added (Desktop Doesn't Use):**
- 🆕 `src/routes/oauth.ts` - OAuth login flow
- 🆕 `src/middleware/auth-oauth.ts` - OAuth session validation
- 🆕 `supabase/add-oauth-sessions.sql` - OAuth database tables

### Why Desktop Can't Break

**Isolation Points:**

1. **Authentication:** Desktop uses `authMiddleware`, Web uses `authOAuthMiddleware`
   - Different files, different logic
   - No shared code

2. **Headers:** Desktop uses `Authorization: Bearer xxx`, Web uses `Mcp-Session-Id: xxx`
   - Mutually exclusive
   - Can't both be true

3. **Database:** Desktop uses `api_keys` table, Web uses `oauth_sessions` table
   - Different tables, different queries
   - No overlap

4. **Routes:** OAuth routes (`/oauth/*`) are separate from MCP route (`/mcp`)
   - Desktop never calls OAuth routes
   - OAuth routes never affect desktop

**If Web Breaks:**
- Desktop auth path still works (Bearer token → authMiddleware)
- Desktop never touches OAuth code
- Desktop keeps working ✅

**If Desktop Breaks (Impossible):**
- We didn't modify desktop authentication code
- We didn't modify Bearer token validation
- We didn't modify NPM package
- Can't break what we didn't touch ✅

---

## Rollback Plan

**If OAuth has issues:**

### Option 1: Disable Web (Keep Desktop)
```typescript
// src/routes/mcp.ts
fastify.post('/mcp', async (request, reply) => {
  const authHeader = request.headers.authorization;
  // const sessionHeader = request.headers['mcp-session-id'];  // COMMENT OUT

  if (authHeader && authHeader.startsWith('Bearer ')) {
    await authMiddleware(request, reply);
  }
  // } else if (sessionHeader) {  // COMMENT OUT OAUTH PATH
  //   await authOAuthMiddleware(request, reply);
  // }
  else {
    return reply.code(401).send({ error: 'Bearer token required' });
  }

  // ... rest of code unchanged ...
});
```

**Result:**
- Desktop: Works ✅
- Web: Disabled
- Deployment: 1 minute

### Option 2: Remove OAuth Routes
```typescript
// src/index.ts
await fastify.register(mcpRoutes);  // Desktop - keep
// await fastify.register(oauthRoutes); // Web - comment out
```

**Result:**
- Desktop: Works ✅
- Web: OAuth unavailable
- Deployment: 1 minute

---

## Implementation Timeline

### Phase 1: Cleanup (1 hour)
- Remove failed `/mcp-web` route and middleware
- Test desktop still works
- Deploy to Railway

### Phase 2: Database (30 minutes)
- Add OAuth tables to Supabase
- Test desktop still works (unaffected)

### Phase 3: OAuth Routes (2 hours)
- Implement `/oauth/authorize`, `/oauth/token`, `/oauth/login`
- Test OAuth flow manually
- Desktop still works (doesn't use OAuth routes)

### Phase 4: OAuth Middleware (1 hour)
- Create `auth-oauth.ts`
- Test session validation
- Desktop still works (uses `auth.ts`)

### Phase 5: Dual Auth (1 hour)
- Update `/mcp` endpoint with dual auth routing
- Test both Bearer token AND OAuth session
- Verify desktop unaffected

### Phase 6: Integration (1 hour)
- Register OAuth routes in `index.ts`
- Deploy to Railway
- Test in claude.ai

**Total Time:** ~6-7 hours of implementation
**Desktop Downtime:** 0 minutes ✅

---

## Final Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    DESKTOP (Unchanged)                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  User Computer → Claude Desktop → NPM Package               │
│                                                              │
│  Request: POST /mcp                                          │
│  Header:  Authorization: Bearer sk_live_xxxxx                │
│           ↓                                                  │
│  Check:   authHeader.startsWith('Bearer') ? YES              │
│           ↓                                                  │
│  Auth:    authMiddleware(request, reply) ← UNCHANGED        │
│           ↓                                                  │
│  Process: Existing MCP logic (450+ lines) ← UNCHANGED       │
│           ↓                                                  │
│  Return:  62 tools                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    WEB/MOBILE (New)                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Browser → claude.ai → OAuth Login                          │
│           ↓                                                  │
│  OAuth:   GET /oauth/authorize ← NEW                        │
│           POST /oauth/token ← NEW                            │
│           ↓                                                  │
│  Receive: Session Token (Mcp-Session-Id)                    │
│                                                              │
│  Request: POST /mcp (SAME ENDPOINT!)                         │
│  Header:  Mcp-Session-Id: session_xxxxx                     │
│           ↓                                                  │
│  Check:   sessionHeader exists? YES                          │
│           ↓                                                  │
│  Auth:    authOAuthMiddleware(request, reply) ← NEW         │
│           ↓                                                  │
│  Process: SAME MCP logic as desktop ← SHARED                │
│           ↓                                                  │
│  Return:  62 tools                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │  SAME       │
                    │  ENDPOINT   │
                    │  /mcp       │
                    └─────────────┘
                          │
              ┌───────────┴───────────┐
              ↓                       ↓
    ┌─────────────────┐     ┌─────────────────┐
    │  Desktop Auth   │     │  Web OAuth Auth │
    │  (Existing)     │     │  (New)          │
    └────────┬────────┘     └────────┬────────┘
             │                       │
             └───────────┬───────────┘
                         ↓
              ┌──────────────────────┐
              │  Shared MCP Logic    │
              │  (Unchanged)         │
              └──────────────────────┘
```

---

## Success Criteria

**Desktop Must:**
- ✅ Accept Bearer token in `Authorization` header
- ✅ Validate API keys from `api_keys` table
- ✅ Return 62 tools via `tools/list`
- ✅ Execute tool calls successfully
- ✅ Work with NPM package `geenie-mcp-client`

**Web Must:**
- ✅ Complete OAuth login flow
- ✅ Accept session token in `Mcp-Session-Id` header
- ✅ Validate sessions from `oauth_sessions` table
- ✅ Return 62 tools via `tools/list`
- ✅ Execute tool calls successfully
- ✅ Work in claude.ai custom connector

**Both Must:**
- ✅ Use SAME `/mcp` endpoint
- ✅ Process requests identically after auth
- ✅ Respect subscription plan limits
- ✅ Filter tools by user tier
- ✅ Forward to Amazon MCP correctly

---

## Next Steps

1. **Review this plan** - Understand dual auth approach
2. **Phase 1 (Cleanup)** - Remove failed attempts, verify desktop works
3. **Phase 2 (Database)** - Add OAuth tables, verify desktop unaffected
4. **Phase 3-6** - Implement OAuth, test after each phase

Ready to start **Phase 1 (Cleanup)**?
