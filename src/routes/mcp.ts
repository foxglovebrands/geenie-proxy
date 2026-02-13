import { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from '../middleware/auth.js';
import { getValidAccessToken } from '../services/token-manager.js';
import { getDisabledTools, injectDisabledTools } from '../services/tool-filter.js';

export default async function mcpRoutes(fastify: FastifyInstance) {
  // MCP proxy route with authentication
  fastify.post('/mcp', {
    preHandler: authMiddleware, // Add auth middleware
  }, async (request, reply) => {
    const mcpRequest = request.body as any;
    const user = request.user!; // Set by auth middleware

    logger.info({
      method: mcpRequest?.method,
      userId: user.user_id
    }, 'MCP request received');

    try {
      // Get valid Amazon access token (auto-refreshes if expired)
      const { accessToken, account } = await getValidAccessToken(
        user.user_id,
        mcpRequest.params?.profileId // Optional: allow user to specify account
      );

      // Determine Amazon MCP endpoint by region
      const endpoint = config.amazonMcp.endpoints[account.region];

      logger.debug({
        endpoint,
        profileId: account.amazon_profile_id,
        marketplace: account.marketplace
      }, 'Forwarding to Amazon MCP endpoint');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Phase 3: Use real Amazon tokens and headers
          'Authorization': `Bearer ${accessToken}`,
          'Amazon-Advertising-API-ClientId': config.lwa.clientId,
          'Amazon-Advertising-API-Scope': account.amazon_profile_id,
          ...(account.amazon_advertiser_account_id && {
            'Amazon-Ads-AccountID': account.amazon_advertiser_account_id,
          }),
        },
        body: JSON.stringify(mcpRequest),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Amazon MCP request failed');
        return reply.code(response.status).send({
          error: 'Amazon MCP request failed',
        });
      }

      const result = await response.json() as any;

      // Special handling for tools/list: inject disabledTools based on subscription tier
      if (mcpRequest.method === 'tools/list') {
        const tools = result.tools || [];
        const disabledTools = getDisabledTools(tools, user.subscription.plan);

        logger.info(
          {
            plan: user.subscription.plan,
            totalTools: tools.length,
            disabledCount: disabledTools.length,
          },
          'Tools filtered by subscription tier'
        );

        const modifiedResult = injectDisabledTools(result, disabledTools);

        logger.info({ method: mcpRequest?.method }, 'MCP request completed');

        return modifiedResult;
      }

      logger.info({ method: mcpRequest?.method }, 'MCP request completed');

      return result;
    } catch (error: any) {
      logger.error({ error: error.message }, 'MCP proxy error');

      // Handle specific token errors
      if (error.message === 'NO_CONNECTED_ACCOUNTS') {
        return reply.code(404).send({
          error: {
            code: 'NO_ACCOUNTS',
            message: 'No Amazon accounts connected',
            action: 'connect',
            url: 'https://app.geenie.io/dashboard/accounts',
          },
        });
      }

      if (error.message === 'TOKEN_REFRESH_FAILED') {
        return reply.code(502).send({
          error: {
            code: 'TOKEN_REFRESH_FAILED',
            message: 'Failed to refresh Amazon token. Please reconnect your account.',
            action: 'reconnect',
            url: 'https://app.geenie.io/dashboard/accounts',
          },
        });
      }

      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  });
}
