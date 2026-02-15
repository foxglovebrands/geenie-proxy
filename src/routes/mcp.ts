import { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from '../middleware/auth.js';
import { authOAuthMiddleware } from '../middleware/auth-oauth.js';
import { getValidAccessToken } from '../services/token-manager.js';
import { GLOBAL_BLACKLIST } from '../config/constants.js';
import {
  listAccounts,
  getActiveAccount,
  switchAccount,
  clearActiveAccount,
} from '../services/account-switcher.js';
import { isToolAllowed, getUpgradeMessage } from '../services/tool-filter.js';

export default async function mcpRoutes(fastify: FastifyInstance) {
  // Shared MCP handler for both /mcp and / paths
  // Desktop uses /mcp, claude.ai web uses / (root)
  const mcpHandler = async (request: any, reply: any) => {
    // DUAL AUTHENTICATION: Check which auth method is being used
    const authHeader = request.headers.authorization;
    const sessionHeader = request.headers['mcp-session-id'] as string | undefined;

    logger.debug({
      hasAuthHeader: !!authHeader,
      hasSessionHeader: !!sessionHeader,
      authType: authHeader ? 'bearer' : sessionHeader ? 'oauth' : 'none',
      path: request.url
    }, 'Authentication check');

    // Route to appropriate authentication middleware
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // DESKTOP PATH: Use existing Bearer token authentication
      await authMiddleware(request, reply);
    } else if (sessionHeader) {
      // WEB PATH: Use new OAuth session authentication
      await authOAuthMiddleware(request, reply);
    } else {
      // No valid authentication provided
      logger.warn('MCP request with no valid authentication');

      // Return JSON-RPC compliant error response
      const requestId = (request.body as any)?.id || null;
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer resource_metadata="https://api.geenie.io/.well-known/oauth-protected-resource"')
        .send({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32001, // Custom server error code
            message: 'Authentication required. Use OAuth to authenticate via claude.ai or provide Bearer token for desktop.',
          },
        });
    }

    // If authentication failed, middleware already sent error response
    if (reply.sent) {
      logger.debug('Authentication failed, response already sent');
      return;
    }

    // Continue with existing MCP processing logic
    const mcpRequest = request.body as any;
    const user = request.user!; // Set by EITHER auth middleware

    logger.info({
      method: mcpRequest?.method,
      userId: user.user_id,
      authType: authHeader ? 'bearer' : 'oauth'
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

          // Check tier-based tool restrictions
          const userPlan = user.subscription.plan;
          if (!isToolAllowed(toolName, userPlan)) {
            const upgradeMessage = getUpgradeMessage(toolName, userPlan);

            logger.warn({
              userId: user.user_id,
              toolName,
              userPlan,
            }, 'BLOCKED: Tool not allowed for user plan');

            return reply.code(403).send({
              jsonrpc: '2.0',
              id: mcpRequest.id,
              error: {
                code: -32601,
                message: upgradeMessage,
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

      // Helper function to add category tags to tool descriptions
      function getCategoryTag(toolName: string): string {
        // Campaign Management tools
        if (toolName.includes('campaign') || toolName.includes('ad_group') ||
            toolName.includes('ad-') || toolName.includes('target')) {
          if (toolName.includes('keyword') || toolName.includes('target')) {
            return '[CAMPAIGNS > KEYWORDS]';
          }
          if (toolName.includes('ad_group')) {
            return '[CAMPAIGNS > AD GROUPS]';
          }
          return '[CAMPAIGNS]';
        }

        // Reporting tools
        if (toolName.startsWith('reporting')) return '[REPORTING]';

        // Billing tools
        if (toolName.startsWith('billing')) return '[BILLING]';

        // Account management
        if (toolName.startsWith('account_management')) return '[ACCOUNTS]';

        // Advanced features
        if (toolName.startsWith('manager_accounts')) return '[ADVANCED > MANAGER ACCOUNTS]';
        if (toolName.startsWith('stream_subscriptions')) return '[ADVANCED > SUBSCRIPTIONS]';
        if (toolName.startsWith('terms_token')) return '[ADVANCED > TERMS]';
        if (toolName.startsWith('user_invitation')) return '[ADVANCED > USERS]';

        return '';
      }

      // Inject custom Geenie tools into tools/list response
      if (mcpRequest.method === 'tools/list' && result.result && result.result.tools) {
        const geenieTools = [
          {
            name: 'geenie_list_accounts',
            description: '[ACCOUNTS] **IMPORTANT: Use this first** - Lists all Amazon Advertising accounts registered in Geenie and shows which account is currently active. This is the ONLY tool that shows your registered accounts. Use this before any account operations.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'geenie_switch_account',
            description: '[ACCOUNTS] Switch to a different Amazon Advertising account registered in Geenie. After switching, all subsequent operations will use the selected account until you switch again.',
            inputSchema: {
              type: 'object',
              properties: {
                account_name: {
                  type: 'string',
                  description: 'The account name, profile ID, or advertiser account ID to switch to (from geenie_list_accounts)',
                },
              },
              required: ['account_name'],
            },
          },
          {
            name: 'geenie_get_active_account',
            description: '[ACCOUNTS] Shows which Amazon Advertising account is currently active for all operations',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'geenie_test_dsp',
            description: '[TESTING] Test tool for DSP tier blocking - This tool is only available on Agency plan ($249/mo)',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        ];

        // Helper to simplify schemas to reduce response size
        const simplifySchema = (schema: any, depth = 0): any => {
          if (!schema || typeof schema !== 'object') return schema;

          // At depth 2+, replace complex nested objects with simple placeholders
          if (depth >= 2) {
            if (schema.type === 'object') {
              return {
                type: 'object',
                description: schema.description || 'See Amazon Ads API documentation for details'
              };
            }
            if (schema.type === 'array') {
              return {
                type: 'array',
                description: schema.description || 'Array of items'
              };
            }
          }

          const simplified: any = { ...schema };

          // Recursively simplify nested properties
          if (simplified.properties) {
            simplified.properties = Object.fromEntries(
              Object.entries(simplified.properties).map(([key, value]) => [
                key,
                simplifySchema(value, depth + 1)
              ])
            );
          }

          if (simplified.items) {
            simplified.items = simplifySchema(simplified.items, depth + 1);
          }

          if (simplified.oneOf) {
            simplified.oneOf = simplified.oneOf.map((item: any) => simplifySchema(item, depth + 1));
          }

          if (simplified.anyOf) {
            simplified.anyOf = simplified.anyOf.map((item: any) => simplifySchema(item, depth + 1));
          }

          return simplified;
        };

        // Filter out Amazon's native account listing tools to avoid confusion
        const filteredAmazonTools = result.result.tools.filter((tool: any) => {
          const toolName = tool.name?.toLowerCase() || '';
          // Remove tools that list/get profiles or accounts (Geenie handles this)
          const isAccountListingTool =
            toolName.includes('list_profile') ||
            toolName.includes('get_profile') ||
            toolName.includes('list_account') ||
            toolName.includes('get_account');

          if (isAccountListingTool) {
            logger.info({ toolName: tool.name }, 'Filtered out Amazon account listing tool');
          }

          return !isAccountListingTool;
        }).map((tool: any) => {
          const categoryTag = getCategoryTag(tool.name);
          const enhancedDescription = categoryTag
            ? `${categoryTag} ${tool.description}`
            : tool.description;

          return {
            ...tool,
            description: enhancedDescription,
            inputSchema: simplifySchema(tool.inputSchema)
          };
        });

        // Add Geenie tools to the beginning of the tools array
        result.result.tools = [...geenieTools, ...filteredAmazonTools];

        logger.info(
          {
            geenieToolsCount: geenieTools.length,
            amazonToolsCount: filteredAmazonTools.length,
            totalToolsCount: result.result.tools.length,
            filteredCount: result.result.tools.length - filteredAmazonTools.length - geenieTools.length
          },
          'Injected Geenie custom tools and filtered Amazon account tools'
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
  };

  // Health check / capabilities endpoint (no auth required)
  // Returns server information for claude.ai discovery
  const healthHandler = async (request: any, reply: any) => {
    return reply.send({
      name: 'Geenie MCP Server',
      version: '1.0.0',
      description: 'Amazon Advertising MCP Proxy for Claude',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      authentication: {
        required: true,
        methods: ['bearer', 'oauth']
      }
    });
  };

  // Register handlers for both paths
  // Desktop: /mcp (existing, unchanged behavior)
  fastify.post('/mcp', mcpHandler);
  fastify.get('/mcp', healthHandler);

  // Web: / (for claude.ai OAuth connector)
  fastify.post('/', mcpHandler);
  fastify.get('/', healthHandler);
}
