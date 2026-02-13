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
        marketplace: account.marketplace,
        tokenPrefix: accessToken.substring(0, 10) + '...',
        tokenLength: accessToken.length,
        requestBody: JSON.stringify(mcpRequest).substring(0, 500)
      }, 'Forwarding to Amazon MCP endpoint');

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        // Required headers for Amazon MCP
        'Authorization': `Bearer ${accessToken}`,
        'Amazon-Ads-ClientId': config.lwa.clientId,
        // Fixed Account Context mode (required!)
        'Amazon-Ads-AI-Account-Selection-Mode': 'FIXED',
        'Amazon-Advertising-API-Scope': account.amazon_profile_id,
        ...(account.amazon_advertiser_account_id && {
          'Amazon-Ads-AccountID': account.amazon_advertiser_account_id,
        }),
      };

      logger.debug({
        authHeader: `Bearer ${accessToken.substring(0, 20)}...`,
        clientId: config.lwa.clientId.substring(0, 20) + '...',
        hasAccountId: !!account.amazon_advertiser_account_id
      }, 'Request headers prepared');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(mcpRequest),
      });

      const contentType = response.headers.get('content-type') || '';

      logger.info({
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: contentType
      }, 'Amazon MCP response status');

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({
          status: response.status,
          errorBody: errorText,
          headers: Object.fromEntries(response.headers.entries())
        }, 'Amazon MCP request failed');
        return reply.code(response.status).send({
          error: 'Amazon MCP request failed',
          status: response.status,
          details: errorText,
        });
      }

      // First try to read the response as text to debug
      const responseText = await response.text();
      logger.debug({
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 300)
      }, 'Raw response from Amazon');

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        logger.error({ error: String(e), responseText: responseText.substring(0, 500) }, 'Failed to parse JSON response');
        throw new Error('Invalid JSON response from Amazon MCP');
      }

      // Amazon MCP returns JSON-RPC 2.0 format: { jsonrpc, id, result: { tools: [...] } }
      const mcpResult = result.result || result; // Handle both direct and JSON-RPC envelope
      const tools = mcpResult.tools || [];

      logger.debug({
        resultKeys: Object.keys(result || {}),
        mcpResultKeys: Object.keys(mcpResult || {}),
        hasTools: !!tools,
        toolsCount: tools.length,
        resultType: typeof result,
        isNull: result === null,
        resultSample: JSON.stringify(result).substring(0, 200)
      }, 'Amazon MCP response received');

      // Handle null response from Amazon
      if (result === null) {
        logger.warn({
          status: response.status,
          contentType: contentType,
          method: mcpRequest.method
        }, 'Amazon MCP returned null response - this may indicate SSE/streaming or async processing');

        return reply.code(500).send({
          error: {
            code: 'NULL_RESPONSE',
            message: 'Amazon MCP returned null response. This may indicate the MCP endpoint is using streaming or async protocol.',
            details: 'HTTP 202 typically indicates async processing. The MCP protocol may require SSE (Server-Sent Events) support.',
          },
        });
      }

      // Special handling for tools/list: inject disabledTools based on subscription tier
      if (mcpRequest.method === 'tools/list') {
        const disabledTools = getDisabledTools(tools, user.subscription.plan);

        logger.info(
          {
            plan: user.subscription.plan,
            totalTools: tools.length,
            disabledCount: disabledTools.length,
          },
          'Tools filtered by subscription tier'
        );

        // Inject disabled tools into the MCP result, not the JSON-RPC envelope
        const modifiedResult = injectDisabledTools(mcpResult, disabledTools);

        // Return the full JSON-RPC response with modified result
        const jsonRpcResponse = {
          jsonrpc: result.jsonrpc || '2.0',
          id: result.id,
          result: modifiedResult,
        };

        logger.info({ method: mcpRequest?.method }, 'MCP request completed');

        return jsonRpcResponse;
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
