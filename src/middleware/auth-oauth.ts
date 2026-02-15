// OAuth session authentication middleware
// Validates Mcp-Session-Id header for web/mobile users
// Desktop users DO NOT use this (they use auth.ts with Bearer tokens)

import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase, type Subscription } from '../services/supabase.js';
import { logger } from '../utils/logger.js';

// Extend Fastify request to include user context
// IMPORTANT: Same format as desktop auth (auth.ts) for compatibility
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      user_id: string;
      subscription: Subscription;
    };
  }
}

// OAuth session validation middleware
// Checks Mcp-Session-Id header and validates session in database
export async function authOAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Extract request ID for JSON-RPC responses
  const requestId = (request.body as any)?.id || null;

  // Extract session ID from Authorization header (Bearer token)
  // OAuth sessions are sent as: Authorization: Bearer session_xxxxx
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('OAuth auth attempted without Bearer token');
    return reply
      .code(401)
      .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
      .send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32001,
          message: 'OAuth session token required in Authorization header (Bearer session_xxxxx)',
        },
      });
  }

  // Extract session token (should start with "session_")
  const sessionId = authHeader.replace('Bearer ', '').trim();

  logger.debug({ sessionId: sessionId.substring(0, 16) + '...' }, 'Validating OAuth session');

  try {
    // Lookup session in database
    const { data: session, error: sessionError } = await supabase
      .from('oauth_sessions')
      .select('user_id, expires_at')
      .eq('session_id', sessionId)
      .single();

    if (sessionError || !session) {
      logger.warn({ sessionId: sessionId.substring(0, 16), error: sessionError }, 'Invalid OAuth session');
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
        .send({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32001,
            message: 'Invalid or expired session. Please log in again at https://claude.ai',
          },
        });
    }

    // Check if session expired
    if (new Date(session.expires_at) < new Date()) {
      logger.warn({ sessionId: sessionId.substring(0, 16), expires_at: session.expires_at }, 'Expired OAuth session');

      // Delete expired session
      await supabase
        .from('oauth_sessions')
        .delete()
        .eq('session_id', sessionId);

      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
        .send({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32001,
            message: 'Session expired. Please log in again at https://claude.ai',
          },
        });
    }

    // Fetch user's subscription data
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', session.user_id)
      .single();

    if (subError || !subscription) {
      logger.error({ userId: session.user_id, error: subError }, 'No subscription found for OAuth user');
      return reply.code(403).send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32002,
          message: 'No active subscription. Subscribe at https://app.geenie.io/dashboard/billing',
        },
      });
    }

    // Check subscription status (same logic as desktop auth)
    const { status, trial_ends_at } = subscription;

    const isActive = status === 'active';
    const isTrialing =
      status === 'trialing' &&
      trial_ends_at &&
      new Date(trial_ends_at) > new Date();

    if (!isActive && !isTrialing) {
      logger.warn({ userId: session.user_id, status }, 'Inactive subscription for OAuth user');
      return reply.code(403).send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32002,
          message:
            status === 'past_due'
              ? 'Subscription expired: Payment failed. Update at https://app.geenie.io/dashboard/billing'
              : status === 'canceled'
                ? 'Subscription canceled. Reactivate at https://app.geenie.io/dashboard/billing'
                : 'Subscription inactive. Visit https://app.geenie.io/dashboard/billing',
        },
      });
    }

    // Attach user context to request
    // CRITICAL: Same format as desktop auth for compatibility
    request.user = {
      user_id: session.user_id,
      subscription,
    };

    logger.debug({
      userId: session.user_id,
      plan: subscription.plan,
      sessionId: sessionId.substring(0, 16) + '...'
    }, 'OAuth authentication successful');

    // Update last_used_at timestamp in background (non-blocking)
    supabase
      .from('oauth_sessions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .then(() => {
        logger.debug({ sessionId: sessionId.substring(0, 16) }, 'Updated session last_used_at');
      }, (error: any) => {
        logger.error({ error, sessionId: sessionId.substring(0, 16) }, 'Failed to update session last_used_at');
      });

  } catch (error: any) {
    logger.error({ error: error.message }, 'OAuth authentication error');
    return reply.code(500).send({
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: -32603,
        message: 'Internal error during authentication',
      },
    });
  }
}
