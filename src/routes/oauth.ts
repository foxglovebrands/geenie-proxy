// OAuth routes for web/mobile connector
// Handles OAuth 2.0 authorization flow for claude.ai
// Desktop users DO NOT use these routes (they use Bearer token auth)

import { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export default async function oauthRoutes(fastify: FastifyInstance) {

  // Step 1: Authorization endpoint - Shows login form
  // Called by claude.ai when user adds Geenie connector
  fastify.get('/oauth/authorize', async (request, reply) => {
    const { client_id, redirect_uri, state } = request.query as any;

    logger.info({ client_id, redirect_uri }, 'OAuth authorize request');

    // Validate client exists and redirect URI is allowed
    const { data: client } = await supabase
      .from('oauth_clients')
      .select('*')
      .eq('client_id', client_id)
      .single();

    if (!client || !client.redirect_uris.includes(redirect_uri)) {
      logger.warn({ client_id, redirect_uri }, 'Invalid OAuth client or redirect URI');
      return reply.code(400).send({
        error: 'invalid_request',
        error_description: 'Invalid client or redirect URI'
      });
    }

    // Render login form
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Login to Geenie</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              max-width: 400px;
              margin: 100px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .card {
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            h1 {
              color: #7C3AED;
              margin-bottom: 10px;
              font-size: 24px;
            }
            .subtitle {
              color: #666;
              margin-bottom: 30px;
              font-size: 14px;
            }
            label {
              display: block;
              margin-bottom: 8px;
              font-weight: 500;
              color: #333;
            }
            input {
              width: 100%;
              padding: 12px;
              margin-bottom: 20px;
              border: 1px solid #ddd;
              border-radius: 4px;
              font-size: 14px;
              box-sizing: border-box;
            }
            input:focus {
              outline: none;
              border-color: #7C3AED;
            }
            button {
              width: 100%;
              padding: 12px;
              background: #7C3AED;
              color: white;
              border: none;
              border-radius: 4px;
              font-size: 16px;
              font-weight: 500;
              cursor: pointer;
            }
            button:hover {
              background: #6D28D9;
            }
            .signup-link {
              text-align: center;
              margin-top: 20px;
              font-size: 14px;
              color: #666;
            }
            .signup-link a {
              color: #7C3AED;
              text-decoration: none;
            }
            .signup-link a:hover {
              text-decoration: underline;
            }
            .error {
              background: #FEE2E2;
              color: #991B1B;
              padding: 12px;
              border-radius: 4px;
              margin-bottom: 20px;
              display: none;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Login to Geenie</h1>
            <p class="subtitle">Connect your Geenie account to Claude</p>

            <div class="error" id="error-message"></div>

            <form method="POST" action="/oauth/login" id="login-form">
              <input type="hidden" name="client_id" value="${client_id}" />
              <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
              <input type="hidden" name="state" value="${state || ''}" />

              <label for="email">Email</label>
              <input
                type="email"
                id="email"
                name="email"
                placeholder="your@email.com"
                required
                autocomplete="email"
              />

              <label for="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                placeholder="••••••••"
                required
                autocomplete="current-password"
              />

              <button type="submit">Login</button>
            </form>

            <div class="signup-link">
              Don't have an account? <a href="https://app.geenie.io" target="_blank">Sign up</a>
            </div>
          </div>

          <script>
            // Show error message if present in URL
            const urlParams = new URLSearchParams(window.location.search);
            const error = urlParams.get('error');
            if (error === 'invalid_credentials') {
              const errorDiv = document.getElementById('error-message');
              errorDiv.textContent = 'Invalid email or password. Please try again.';
              errorDiv.style.display = 'block';
            }
          </script>
        </body>
      </html>
    `);
  });

  // Step 2: Process login - Authenticates user and creates auth code
  // Called when user submits login form
  fastify.post('/oauth/login', async (request, reply) => {
    const { email, password, client_id, redirect_uri, state } = request.body as any;

    logger.info({ email, client_id }, 'OAuth login attempt');

    try {
      // Authenticate with Supabase
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !authData.user) {
        logger.warn({ email, error: error?.message }, 'OAuth login failed');

        // Redirect back to login form with error
        return reply.redirect(`/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${state || ''}&error=invalid_credentials`);
      }

      logger.info({ userId: authData.user.id, email }, 'OAuth login successful');

      // Generate secure authorization code (expires in 10 minutes)
      const authCode = crypto.randomBytes(32).toString('hex');

      // Store authorization code temporarily
      const { error: insertError } = await supabase.from('oauth_auth_codes').insert({
        code: authCode,
        user_id: authData.user.id,
        client_id,
        redirect_uri,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      });

      if (insertError) {
        logger.error({ error: insertError }, 'Failed to store auth code');
        return reply.code(500).send({ error: 'server_error' });
      }

      logger.info({ userId: authData.user.id, code: authCode.substring(0, 8) + '...' }, 'Auth code generated');

      // Redirect back to claude.ai with authorization code
      const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state || ''}`;
      return reply.redirect(redirectUrl);

    } catch (error: any) {
      logger.error({ error: error.message }, 'OAuth login error');
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // Step 3: Token endpoint - Exchanges auth code for session token
  // Called by claude.ai after receiving authorization code
  fastify.post('/oauth/token', async (request, reply) => {
    const { grant_type, code, client_id, client_secret } = request.body as any;

    logger.info({ grant_type, client_id, codePrefix: code?.substring(0, 8) }, 'OAuth token request');

    // Validate grant type
    if (grant_type !== 'authorization_code') {
      logger.warn({ grant_type }, 'Unsupported grant type');
      return reply.code(400).send({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant type is supported'
      });
    }

    // Verify client credentials
    const { data: client } = await supabase
      .from('oauth_clients')
      .select('*')
      .eq('client_id', client_id)
      .eq('client_secret', client_secret)
      .single();

    if (!client) {
      logger.warn({ client_id }, 'Invalid OAuth client credentials');
      return reply.code(401).send({
        error: 'invalid_client',
        error_description: 'Invalid client credentials'
      });
    }

    // Lookup authorization code
    const { data: authCode, error: codeError } = await supabase
      .from('oauth_auth_codes')
      .select('*')
      .eq('code', code)
      .single();

    if (codeError || !authCode) {
      logger.warn({ code: code?.substring(0, 8), error: codeError }, 'Invalid auth code');
      return reply.code(400).send({
        error: 'invalid_grant',
        error_description: 'Invalid authorization code'
      });
    }

    // Check if code expired
    if (new Date(authCode.expires_at) < new Date()) {
      logger.warn({ code: code?.substring(0, 8), expires_at: authCode.expires_at }, 'Expired auth code');

      // Delete expired code
      await supabase.from('oauth_auth_codes').delete().eq('code', code);

      return reply.code(400).send({
        error: 'invalid_grant',
        error_description: 'Authorization code expired'
      });
    }

    // Generate session token (expires in 7 days)
    const sessionId = `session_${crypto.randomBytes(32).toString('hex')}`;

    // Create session in database
    const { error: sessionError } = await supabase.from('oauth_sessions').insert({
      user_id: authCode.user_id,
      session_id: sessionId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    });

    if (sessionError) {
      logger.error({ error: sessionError }, 'Failed to create OAuth session');
      return reply.code(500).send({ error: 'server_error' });
    }

    // Delete used authorization code (one-time use)
    await supabase.from('oauth_auth_codes').delete().eq('code', code);

    logger.info({
      userId: authCode.user_id,
      sessionId: sessionId.substring(0, 16) + '...'
    }, 'OAuth session created');

    // Return session token to claude.ai
    return reply.send({
      access_token: sessionId,
      token_type: 'Bearer',
      expires_in: 604800, // 7 days in seconds
    });
  });
}
