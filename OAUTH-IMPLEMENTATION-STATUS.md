# OAuth Web Connector Implementation - Progress Status

**Goal:** Add OAuth authentication for claude.ai web/mobile while keeping desktop NPM package 100% safe

**Started:** February 14, 2026
**Last Updated:** February 14, 2026

---

## ✅ COMPLETED PHASES

### Phase 1: Cleanup (DONE ✅)
**Status:** Complete and deployed to production
**Time:** 1 hour
**Risk:** LOW ✓

**Changes Made:**
- ✅ Deleted failed `/mcp-web` route (lines 498-979 from mcp.ts)
- ✅ Deleted `src/middleware/auth-web.ts`
- ✅ Deleted `src/middleware/auth-path.ts` (was never committed)
- ✅ Removed unused imports from mcp.ts
- ✅ File reduced: 980 → 496 lines

**Files Modified:**
- `src/routes/mcp.ts` - Removed /mcp-web route and unused imports
- `src/middleware/` - Deleted auth-web.ts

**Git Commit:** `8e12f5c` - "Remove failed /mcp-web route and middleware"

**Safety Verification:**
- ✅ Local test: 62 tools returned
- ✅ Production test: 62 tools returned
- ✅ Desktop unchanged and working perfectly

**Deployment:**
- ✅ Pushed to GitHub (with placeholder API keys)
- ✅ Railway auto-deployed
- ✅ Production verified working

---

### Phase 2: Database Setup (DONE ✅)
**Status:** Complete - SQL migrations run in Supabase
**Time:** 30 minutes
**Risk:** LOW ✓

**Changes Made:**
- ✅ Created `supabase/add-oauth-sessions.sql`
- ✅ Created `supabase/add-oauth-clients.sql`
- ✅ Created `supabase/add-oauth-auth-codes.sql`
- ✅ Ran all 3 migrations in Supabase SQL Editor

**New Database Tables:**

1. **`oauth_sessions`** - Web user sessions
   - Stores active sessions for claude.ai
   - Expires after 7 days
   - RLS enabled (users see own sessions only)
   - Auto-cleanup function: `cleanup_expired_oauth_sessions()`

2. **`oauth_clients`** - OAuth client configuration
   - Stores Claude.ai as authorized client
   - Client ID: `claude_web`
   - Client secret: Auto-generated (64 hex chars)
   - Redirect URIs: claude.ai and claude.com callbacks
   - RLS enabled (system-only access)

3. **`oauth_auth_codes`** - Temporary authorization codes
   - Short-lived codes (10 minute expiry)
   - Exchanged for session tokens during OAuth flow
   - Auto-cleanup function: `cleanup_expired_auth_codes()`
   - RLS enabled (system-only access)

**Safety Notes:**
- Desktop doesn't use these tables (zero impact)
- No code changes yet (only schema)
- Desktop safety test: TBD (will run before Phase 3)

**Git Status:**
- SQL files created locally
- NOT yet committed to git
- Will commit after Phase 3 completion

---

## 🔄 IN PROGRESS

### Phase 3: OAuth Routes (NEXT)
**Status:** Ready to begin
**Time Estimate:** 2 hours
**Risk:** MEDIUM (new code, but isolated from desktop)

**What to Build:**
- Create `src/routes/oauth.ts` with 3 endpoints:
  1. `GET /oauth/authorize` - Show login form
  2. `POST /oauth/login` - Process login + create auth code
  3. `POST /oauth/token` - Exchange auth code for session token

**Safety:**
- NEW file (desktop doesn't use these routes)
- Separate from existing `/mcp` endpoint
- If OAuth breaks, desktop unaffected

**Reference Plan:**
- See `STREAMABLE-HTTP-IMPLEMENTATION-PLAN.md` Phase 3 for full code

---

## 📋 PENDING PHASES

### Phase 4: OAuth Middleware (Pending)
**Time Estimate:** 1 hour
**Risk:** LOW

**What to Build:**
- Create `src/middleware/auth-oauth.ts`
- Validates `Mcp-Session-Id` header
- Checks `oauth_sessions` table
- Same `request.user` format as desktop auth

---

### Phase 5: Dual Authentication (Pending) ⚠️ CRITICAL
**Time Estimate:** 1 hour
**Risk:** HIGH (modifies existing /mcp endpoint)

**What to Change:**
- Modify ONLY first ~25 lines of `/mcp` route handler
- Add routing logic to check auth header type:
  - `Authorization: Bearer xxx` → Desktop path (existing)
  - `Mcp-Session-Id: xxx` → Web path (new)
- Desktop processing logic (450+ lines) UNCHANGED

**Safety Protocol:**
1. Create backup branch before starting
2. Test desktop immediately after changes
3. If desktop breaks → revert immediately
4. This is the ONLY phase that touches desktop code path

---

### Phase 6: Register Routes (Pending)
**Time Estimate:** 30 minutes
**Risk:** LOW

**What to Change:**
- Update `src/index.ts` to register OAuth routes
- Add one line: `await fastify.register(oauthRoutes);`

---

### Phase 7: Testing in Claude.ai (Pending)
**Time Estimate:** 1 hour
**Risk:** LOW

**What to Test:**
1. Add connector in claude.ai Settings
2. OAuth login flow works
3. Session token created
4. Tools load (62 tools visible)
5. Tools can be executed
6. Desktop still works (final verification)

---

## 🛡️ DESKTOP SAFETY PROTOCOL

**Test After Every Phase:**
```bash
curl -s -X POST https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# Expected: 62 ✅
# If not 62: STOP and revert ❌
```

**Files NEVER to Modify:**
- ❌ `src/middleware/auth.ts` (desktop auth)
- ❌ `/packages/mcp-client/` (NPM package)
- ❌ Lines 18-495 in `src/routes/mcp.ts` (desktop handler logic)

**Files Safe to Modify:**
- ✅ `src/routes/mcp.ts` (ONLY first ~25 lines for dual auth in Phase 5)
- ✅ `src/index.ts` (register new routes)

**Files Safe to Create:**
- ✅ `src/routes/oauth.ts`
- ✅ `src/middleware/auth-oauth.ts`
- ✅ `supabase/*.sql`

---

## 📊 PROGRESS TRACKER

| Phase | Status | Time | Risk | Desktop Safe? |
|-------|--------|------|------|---------------|
| 1. Cleanup | ✅ Done | 1h | LOW | ✅ Verified |
| 2. Database | ✅ Done | 30m | LOW | ⏳ TBD |
| 3. OAuth Routes | ⏳ Next | 2h | MED | - |
| 4. OAuth Middleware | ⏸️ Pending | 1h | LOW | - |
| 5. Dual Auth | ⏸️ Pending | 1h | HIGH | - |
| 6. Register Routes | ⏸️ Pending | 30m | LOW | - |
| 7. Testing | ⏸️ Pending | 1h | LOW | - |

**Total Estimated Time:** 6-7 hours
**Time Spent:** 1.5 hours
**Remaining:** 4.5-5.5 hours

---

## 🔑 KEY DECISIONS & NOTES

### Authentication Strategy
- **Desktop:** Bearer token auth (`Authorization: Bearer sk_live_xxx`)
- **Web:** OAuth session token (`Mcp-Session-Id: session_xxx`)
- **Same endpoint:** `/mcp` (dual routing)
- **Same tools:** 62 tools available to both methods

### Why This Approach?
- ✅ Future-proof: Uses Streamable HTTP (SSE being deprecated)
- ✅ Secure: OAuth standard, proper session management
- ✅ Safe: Desktop and web auth completely isolated
- ✅ Scalable: Same endpoint reduces maintenance

### User Experience
**Desktop Users (Unchanged):**
1. Sign up at app.geenie.io
2. Get API key from Settings
3. Add to Claude Desktop config
4. Tools work immediately

**Web Users (NEW):**
1. Sign up at app.geenie.io (same)
2. Go to claude.ai → Add connector
3. Login with Geenie credentials (OAuth)
4. Tools work in browser/mobile

**Both users:**
- Same dashboard (app.geenie.io)
- Same subscription management
- Same Amazon account connections
- Same 62 tools available

---

## 📁 FILE INVENTORY

### Modified Files (Phase 1)
- `src/routes/mcp.ts` - 496 lines (was 980)
- `src/middleware/auth-web.ts` - DELETED
- `src/middleware/auth-path.ts` - DELETED

### New Files (Phase 2)
- `supabase/add-oauth-sessions.sql` - 48 lines
- `supabase/add-oauth-clients.sql` - 36 lines
- `supabase/add-oauth-auth-codes.sql` - 32 lines

### Files to Create (Phase 3+)
- `src/routes/oauth.ts` - OAuth endpoints
- `src/middleware/auth-oauth.ts` - OAuth session validation

### Unchanged Files (Desktop Safe)
- `src/middleware/auth.ts` - Desktop auth (untouched ✅)
- `packages/mcp-client/` - NPM package (untouched ✅)
- All other proxy files (untouched ✅)

---

## 🚨 ROLLBACK PLAN

### If Desktop Breaks
```bash
# Find last good commit
git log --oneline -10

# Revert to before dual auth
git revert <commit-hash>
git push

# Verify desktop works
curl -s https://api.geenie.io/mcp \
  -H "Authorization: Bearer sk_live_xxx" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
```

### If OAuth Breaks (Desktop Works)
```typescript
// Temporarily disable OAuth in src/index.ts
await fastify.register(mcpRoutes);   // Desktop - keep
// await fastify.register(oauthRoutes); // OAuth - comment out
```

---

## 📚 REFERENCE DOCUMENTS

**Implementation Plans:**
- `OAUTH-BUILD-PLAN.md` - 7-phase checklist (this is our roadmap)
- `STREAMABLE-HTTP-IMPLEMENTATION-PLAN.md` - Technical details + code
- `SSE-OAUTH-IMPLEMENTATION-PLAN.md` - Deprecated approach (don't use)
- `WEB-CONNECTOR-IMPLEMENTATION-PLAN.md` - Failed query param approach
- `DEBUG-WEB-CONNECTOR.md` - Troubleshooting guide

**Next Steps:**
1. Test desktop after Phase 2 (verify DB changes don't affect desktop)
2. Commit Phase 2 SQL files to git
3. Begin Phase 3: Create OAuth routes
4. Continue following OAUTH-BUILD-PLAN.md checklist

---

## ✅ SUCCESS CRITERIA

**Phase 2 Complete When:**
- [x] 3 SQL files created
- [x] 3 tables created in Supabase
- [ ] Desktop safety test passes (62 tools)
- [ ] SQL files committed to git
- [ ] Ready to start Phase 3

**Overall Success When:**
- [ ] Desktop works (Bearer token auth)
- [ ] Web works (OAuth session auth)
- [ ] Both use same `/mcp` endpoint
- [ ] Both access same 62 tools
- [ ] Both respect subscription limits
- [ ] Zero desktop downtime during implementation

---

**Status:** Phase 2 complete, ready to verify desktop and begin Phase 3
