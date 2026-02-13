import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { supabase, type Subscription } from '../services/supabase.js';
import { getCached } from '../utils/cache.js';

// Extend Fastify request to include user context
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      user_id: string;
      subscription: Subscription;
    };
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Extract API key from Authorization header
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: {
        code: 'MISSING_API_KEY',
        message: 'API key is required in Authorization header',
        help: 'Add your API key: Authorization: Bearer sk_live_xxxxx',
      },
    });
  }

  // Extract the key
  const apiKey = authHeader.replace('Bearer ', '').trim();

  // Validate key format (should start with sk_live_)
  if (!apiKey.startsWith('sk_live_')) {
    return reply.code(401).send({
      error: {
        code: 'INVALID_API_KEY_FORMAT',
        message: 'API key must start with sk_live_',
      },
    });
  }

  // Hash the API key using SHA256 (same as database)
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Try to get from cache first
  const cacheKey = `api_key:${keyHash}`;

  try {
    const authData = await getCached(
      cacheKey,
      async () => {
        // Query database for matching key
        const { data: apiKeyData, error: keyError } = await supabase
          .from('api_keys')
          .select('user_id, is_active')
          .eq('key_hash', keyHash)
          .eq('is_active', true)
          .single();

        if (keyError || !apiKeyData) {
          throw new Error('INVALID_API_KEY');
        }

        // Fetch subscription data
        const { data: subscription, error: subError } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', apiKeyData.user_id)
          .single();

        if (subError || !subscription) {
          throw new Error('NO_SUBSCRIPTION');
        }

        return {
          user_id: apiKeyData.user_id,
          subscription,
        };
      },
      300 // Cache for 5 minutes
    );

    // Check subscription status
    const { status, trial_ends_at } = authData.subscription;

    const isActive = status === 'active';
    const isTrialing =
      status === 'trialing' &&
      trial_ends_at &&
      new Date(trial_ends_at) > new Date();

    if (!isActive && !isTrialing) {
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
    request.user = authData;

    // Update last_used_at in background (fire and forget)
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', keyHash)
      .then(() => {
        request.log.debug('Updated last_used_at for API key');
      })
      .catch((error) => {
        request.log.error({ error }, 'Failed to update last_used_at');
      });

    // Continue to next handler
  } catch (error: any) {
    if (error.message === 'INVALID_API_KEY') {
      return reply.code(401).send({
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid or inactive API key',
          help: 'Generate a new API key at https://app.geenie.io/dashboard/settings',
        },
      });
    }

    if (error.message === 'NO_SUBSCRIPTION') {
      return reply.code(403).send({
        error: {
          code: 'NO_SUBSCRIPTION',
          message: 'No active subscription found',
          action: 'subscribe',
          url: 'https://app.geenie.io/dashboard/billing',
        },
      });
    }

    request.log.error({ error }, 'Authentication error');

    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during authentication',
      },
    });
  }
}
