# Debugging Web Connector Loading Issue

## Current Status
- ✅ Endpoint works: `curl` returns 62 tools successfully
- ✅ Connector installed in claude.ai Settings
- ❌ "Customize Geenie" dialog stuck loading, no tools appear

## Diagnosis Steps

### 1. Check Browser Console (DO THIS FIRST)

**Steps:**
1. Open claude.ai in your browser
2. Press `F12` (or `Cmd+Option+I` on Mac) to open Developer Tools
3. Click the "Console" tab
4. Clear any existing messages (click the 🚫 icon)
5. Start a new conversation and ask a question that triggers the connector
6. Watch for any RED error messages in the console

**Look for:**
- CORS errors (even though we have CORS configured, there might be preflight issues)
- Network errors (timeout, 404, 500)
- JSON parsing errors
- Authentication errors

### 2. Check Network Tab

**Steps:**
1. Open Developer Tools (F12)
2. Click "Network" tab
3. Click the "🗑️" icon to clear existing requests
4. Try enabling the Geenie connector again
5. Look for the request to `geenie-proxy-production.up.railway.app`

**Check:**
- Does the request appear?
- What's the status code? (should be 200)
- What's the response size? (should be ~30KB)
- Click on the request → "Response" tab → Is it valid JSON?
- Click on "Headers" → Are CORS headers present?

### 3. Test with Different Browser

Try using the connector in:
- Chrome
- Firefox
- Safari

Sometimes browser-specific issues cause loading problems.

### 4. Common Issues & Fixes

#### Issue: Response Too Large
**Symptom:** Request times out or fails silently
**Fix:** Already handled - we're at 30KB (well under limits)

#### Issue: API Key in URL
**Symptom:** claude.ai strips query parameters from connector URL
**Fix:** We may need to use a different auth method (headers, custom path)

#### Issue: OPTIONS Preflight Failing
**Symptom:** Console shows CORS preflight error
**Test:**
```bash
curl -X OPTIONS \
  -H "Origin: https://claude.ai" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  https://geenie-proxy-production.up.railway.app/mcp-web?api_key=sk_live_YOUR_API_KEY_HERE
```
**Expected:** Should return 204 or 200 with CORS headers

## What to Report Back

When you check the browser console, copy/paste:
1. Any RED error messages (exact text)
2. The status of the network request to geenie-proxy
3. The first few lines of the response (if visible)

This will tell us exactly what's failing!
