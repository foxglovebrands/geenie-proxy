import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  lwa: {
    clientId: process.env.LWA_CLIENT_ID || '',
    clientSecret: process.env.LWA_CLIENT_SECRET || '',
  },

  amazonMcp: {
    endpoints: {
      na: process.env.AMAZON_MCP_ENDPOINT_NA || 'http://localhost:9000/mcp',
      eu: process.env.AMAZON_MCP_ENDPOINT_EU || 'http://localhost:9000/mcp',
      fe: process.env.AMAZON_MCP_ENDPOINT_FE || 'http://localhost:9000/mcp',
    },
  },

  security: {
    encryptionKey: process.env.ENCRYPTION_KEY || '',
  },

  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === 'true',
  },

  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '300', 10),
  },
} as const;

// Validate required environment variables
function validateEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.warn('   Using placeholder values for development');
  }
}

validateEnv();
