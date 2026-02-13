import { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from '../middleware/auth.js';
import { getValidAccessToken } from '../services/token-manager.js';
import { GLOBAL_BLACKLIST } from '../config/constants.js';
import {
  listAccounts,
  getActiveAccount,
  switchAccount,
  clearActiveAccount,
} from '../services/account-switcher.js';

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
      // Handle custom Geenie tools (account management)
      if (mcpRequest.method === 'tools/call') {
        const toolName = mcpRequest.params?.name;

        // Geenie custom tools
        if (toolName === 'geenie_list_accounts') {
          const accounts = await listAccounts(user.user_id);
          const activeAccount = await getActiveAccount(user.user_id);

          return reply.send({
            jsonrpc: '2.0',
            id: mcpRequest.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    accounts: accounts.map((acc) => ({
                      name: acc.account_name,
                      profileId: acc.amazon_profile_id,
                      advertiserId: acc.amazon_advertiser_account_id,
                      marketplace: acc.marketplace,
                      region: acc.region,
                      isActive: activeAccount?.id === acc.id,
                    })),
                    activeAccount: activeAccount
                      ? {
                          name: activeAccount.account_name,
                          profileId: activeAccount.amazon_profile_id,
                        }
                      : null,
                  }, null, 2),
                },
              ],
            },
          });
        }

        if (toolName === 'geenie_switch_account') {
          const accountIdentifier = mcpRequest.params?.arguments?.account_name || '';

          if (!accountIdentifier) {
            return reply.code(400).send({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              error: {
                code: -32602,
                message: 'Missing required parameter: account_name',
              },
            });
          }

          try {
            const account = await switchAccount(user.user_id, accountIdentifier);

            return reply.send({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: `Successfully switched to account: ${account.account_name} (${account.amazon_profile_id})`,
                  },
                ],
              },
            });
          } catch (error: any) {
            if (error.message === 'ACCOUNT_NOT_FOUND') {
              return reply.code(404).send({
                jsonrpc: '2.0',
                id: mcpRequest.id,
                error: {
                  code: -32602,
                  message: `Account "${accountIdentifier}" not found. Use geenie_list_accounts to see available accounts.`,
                },
              });
            }
            throw error;
          }
        }

        if (toolName === 'geenie_get_active_account') {
          const activeAccount = await getActiveAccount(user.user_id);

          return reply.send({
            jsonrpc: '2.0',
            id: mcpRequest.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: activeAccount
                    ? `Active account: ${activeAccount.account_name} (${activeAccount.amazon_profile_id})`
                    : 'No active account set. Using default (first connected account).',
                },
              ],
            },
          });
        }

        // CRITICAL: Block globally blacklisted destructive operations for ALL users
        if (toolName) {
          // Extract action part (after the dash in "namespace-action")
          const actionPart = toolName.includes('-') ? toolName.split('-')[1] : toolName;

          // Check if this is a globally blacklisted destructive operation
          if (GLOBAL_BLACKLIST.includes(actionPart)) {
            logger.warn({
              userId: user.user_id,
              toolName,
              actionPart,
            }, 'BLOCKED: Globally blacklisted destructive operation attempted');

            // Return error explaining this operation is not allowed
            return reply.code(403).send({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              error: {
                code: -32601,
                message: `This operation is not permitted for safety reasons. Destructive operations like "${actionPart}" are disabled to protect your campaigns. Please use the Amazon Ads console for this action.`,
              },
            });
          }
        }
      }

      // Get valid Amazon access token (auto-refreshes if expired)
      // Pass the full request context for smart account selection
      const { accessToken, account } = await getValidAccessToken(
        user.user_id,
        mcpRequest.params?.profileId, // Optional: explicit profile ID
        mcpRequest // Pass full request for context-based selection
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

      // Inject custom Geenie tools into tools/list response
      if (mcpRequest.method === 'tools/list' && result.result && result.result.tools) {
        const geenieTools = [
          {
            name: 'geenie_list_accounts',
            description: 'List all connected Amazon Advertising accounts and see which one is currently active',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'geenie_switch_account',
            description: 'Switch to a different Amazon Advertising account. Use this when you need to work with a specific advertiser account.',
            inputSchema: {
              type: 'object',
              properties: {
                account_name: {
                  type: 'string',
                  description: 'The name, profile ID, or advertiser account ID of the account to switch to',
                },
              },
              required: ['account_name'],
            },
          },
          {
            name: 'geenie_get_active_account',
            description: 'Get the currently active Amazon Advertising account',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        ];

        // Add Geenie tools to the beginning of the tools array
        result.result.tools = [...geenieTools, ...result.result.tools];

        logger.info(
          { geenieToolsCount: geenieTools.length, totalToolsCount: result.result.tools.length },
          'Injected Geenie custom tools into tools/list response'
        );
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
