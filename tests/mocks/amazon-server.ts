import Fastify from 'fastify';

const mock = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Mock Amazon MCP endpoint
mock.post('/mcp', async (req, reply) => {
  const { method, params } = req.body as any;

  // Check for required headers (we'll validate these later)
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return reply.code(401).send({
      error: 'Missing Authorization header',
    });
  }

  // Simulate different MCP method responses
  if (method === 'tools/list') {
    return {
      tools: [
        // Read-only tools (available to all tiers)
        { name: 'get_campaigns', description: 'List advertising campaigns', category: 'campaign_management' },
        { name: 'list_ad_groups', description: 'List ad groups for a campaign', category: 'campaign_management' },
        { name: 'describe_campaign', description: 'Get details of a specific campaign', category: 'campaign_management' },
        { name: 'report_campaign_performance', description: 'Get campaign performance metrics', category: 'reporting' },
        { name: 'billing_get_invoices', description: 'Retrieve billing invoices', category: 'billing' },
        { name: 'account_info_get_profile', description: 'Get account profile information', category: 'account_management' },

        // Write tools (Professional and Agency only)
        { name: 'create_campaign', description: 'Create a new advertising campaign', category: 'campaign_management' },
        { name: 'update_campaign', description: 'Update an existing campaign', category: 'campaign_management' },
        { name: 'pause_campaign', description: 'Pause a running campaign', category: 'campaign_management' },
        { name: 'resume_campaign', description: 'Resume a paused campaign', category: 'campaign_management' },

        // Destructive tools (should be globally blacklisted)
        { name: 'delete_campaign', description: 'Permanently delete a campaign', category: 'campaign_management' },
        { name: 'delete_ad', description: 'Permanently delete an ad', category: 'campaign_management' },
        { name: 'delete_ad_group', description: 'Permanently delete an ad group', category: 'campaign_management' },
        { name: 'delete_target', description: 'Permanently delete a target', category: 'campaign_management' },
      ],
    };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;

    // Simulate tool call responses
    if (toolName === 'get_campaigns') {
      return {
        result: {
          campaigns: [
            {
              id: 'camp_123',
              name: 'Summer Sale 2026',
              status: 'ENABLED',
              budget: 100.0,
              dailyBudget: 10.0,
              startDate: '2026-06-01',
              marketplace: 'US',
            },
            {
              id: 'camp_456',
              name: 'Q1 Launch Campaign',
              status: 'PAUSED',
              budget: 500.0,
              dailyBudget: 25.0,
              startDate: '2026-01-15',
              marketplace: 'US',
            },
          ],
        },
      };
    }

    if (toolName === 'report_campaign_performance') {
      return {
        result: {
          metrics: {
            impressions: 125000,
            clicks: 3500,
            spend: 875.50,
            sales: 12000,
            acos: 0.073,
            ctr: 0.028,
            conversions: 145,
          },
          period: '2026-01-01 to 2026-02-11',
        },
      };
    }

    if (toolName === 'create_campaign') {
      return {
        result: {
          campaignId: 'camp_new_789',
          status: 'CREATED',
          message: 'Campaign created successfully',
        },
      };
    }

    // Default response for unknown tools
    return {
      result: {
        message: `Mock response for ${toolName}`,
        success: true,
      },
    };
  }

  // Unknown method
  return reply.code(400).send({
    error: `Unknown MCP method: ${method}`,
  });
});

// Health check for the mock server
mock.get('/health', async () => {
  return {
    status: 'healthy',
    service: 'mock-amazon-mcp',
  };
});

// Start the mock server
const start = async () => {
  try {
    await mock.listen({ port: 9000, host: '0.0.0.0' });
    console.log('🔧 Mock Amazon MCP server started on http://localhost:9000');
    console.log('📝 Endpoint: POST http://localhost:9000/mcp');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
