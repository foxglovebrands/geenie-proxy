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
  // Extract request ID for JSON-RPC responses
  const requestId = (request.body as any)?.id || null;

  // Extract API key from Authorization header
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply
      .code(401)
      .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
      .send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32001,
          message: 'API key is required in Authorization header (Bearer sk_live_xxxxx)',
        },
      });
  }

  // Extract the key
  const apiKey = authHeader.replace('Bearer ', '').trim();

  // Validate key format (should start with sk_live_)
  if (!apiKey.startsWith('sk_live_')) {
    return reply
      .code(401)
      .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
      .send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32001,
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
    request.user = authData;

    // Update last_used_at in background (fire and forget)
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', keyHash)
      .then(() => {
        request.log.debug('Updated last_used_at for API key');
      }, (error: any) => {
        request.log.error({ error }, 'Failed to update last_used_at');
      });

    // Continue to next handler
  } catch (error: any) {
    if (error.message === 'INVALID_API_KEY') {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
        .send({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32001,
            message: 'Invalid or inactive API key. Generate new at https://app.geenie.io/dashboard/settings',
          },
        });
    }

    if (error.message === 'NO_SUBSCRIPTION') {
      return reply.code(403).send({
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32002,
          message: 'No active subscription found. Subscribe at https://app.geenie.io/dashboard/billing',
        },
      });
    }

    request.log.error({ error }, 'Authentication error');

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
