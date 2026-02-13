import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/env.js';
import healthRoutes from './routes/health.js';
import mcpRoutes from './routes/mcp.js';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  },
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
});

// Register CORS (allow requests from any origin for MCP clients)
await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
});

// Register routes
await fastify.register(healthRoutes);
await fastify.register(mcpRoutes);

// Start server
const start = async () => {
  try {
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0', // Listen on all interfaces
    });

    fastify.log.info(`🚀 Geenie Proxy server started`);
    fastify.log.info(`📍 Listening on http://localhost:${config.port}`);
    fastify.log.info(`🏥 Health check: http://localhost:${config.port}/health`);
    fastify.log.info(`🔌 MCP endpoint: http://localhost:${config.port}/mcp`);
    fastify.log.info(`📝 Environment: ${config.nodeEnv}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
