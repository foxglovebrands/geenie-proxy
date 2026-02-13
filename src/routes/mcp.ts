import { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { authMiddleware } from '../middleware/auth.js';

export default async function mcpRoutes(fastify: FastifyInstance) {
  // MCP proxy route with authentication
  fastify.post('/mcp', {
    preHandler: authMiddleware, // Add auth middleware
  }, async (request, reply) => {
    const mcpRequest = request.body as any;

    logger.info({ method: mcpRequest?.method }, 'MCP request received');

    try {
      // For Phase 1, we'll just forward to the mock server (NA region)
      const endpoint = config.amazonMcp.endpoints.na;

      logger.debug({ endpoint }, 'Forwarding to Amazon MCP endpoint');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Phase 1: Add dummy auth header for testing with mock server
          // In Phase 2, we'll validate real API keys and use Amazon tokens
          'Authorization': 'Bearer test_token_phase1',
        },
        body: JSON.stringify(mcpRequest),
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Amazon MCP request failed');
        return reply.code(response.status).send({
          error: 'Amazon MCP request failed',
        });
      }

      const result = await response.json();

      logger.info({ method: mcpRequest?.method }, 'MCP request completed');

      return result;
    } catch (error: any) {
      logger.error({ error: error.message }, 'MCP proxy error');

      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  });
}
