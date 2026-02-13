import { FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get('/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  });

  // Readiness check (for deployment platforms)
  fastify.get('/health/ready', async (request, reply) => {
    // For now, always ready. Later we'll check DB connection
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  });
}
