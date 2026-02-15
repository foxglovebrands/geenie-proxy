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
  // Extract session ID from Mcp-Session-Id header
  const sessionId = request.headers['mcp-session-id'] as string;

  if (!sessionId) {
    logger.warn('OAuth auth attempted without Mcp-Session-Id header');
    return reply.code(401).send({
      error: {
        code: 'MISSING_SESSION',
        message: 'Mcp-Session-Id header required for OAuth authentication',
        help: 'Web users must authenticate via /oauth/authorize first',
      },
    });
  }

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
      return reply.code(401).send({
        error: {
          code: 'INVALID_SESSION',
          message: 'Invalid or expired session',
          help: 'Please log in again at https://claude.ai',
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

      return reply.code(401).send({
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Session has expired. Please log in again.',
          url: 'https://claude.ai',
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
        error: {
          code: 'NO_SUBSCRIPTION',
          message: 'No active subscription found',
          action: 'subscribe',
          url: 'https://app.geenie.io/dashboard/billing',
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
        error: {
          code: 'SUBSCRIPTION_EXPIRED',
          message:
            status === 'past_due'
              ? 'Your payment failed. Please update your payment method.'
              : status === 'canceled'
                ? 'Your subscription has been canceled.'
                : 'Your subscription is inactive.',
          action: 'update_billing',
          url: 'https://app.geenie.io/dashboard/billing',
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
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during authentication',
      },
    });
  }
}
