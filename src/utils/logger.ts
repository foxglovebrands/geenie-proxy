import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
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
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: {
        // Redact sensitive headers
        authorization: req.headers?.authorization ? '[REDACTED]' : undefined,
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});
