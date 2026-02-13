# Geenie MCP Proxy Server

The Geenie MCP proxy server sits between Claude Desktop and Amazon's MCP server, handling authentication, token management, and subscription-based tool filtering.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

For local development, the mock Amazon MCP server endpoints are pre-configured.

### 3. Run the Servers

You'll need **two terminal windows**:

**Terminal 1 - Mock Amazon MCP Server:**
```bash
npm run dev:mock
```

**Terminal 2 - Geenie Proxy Server:**
```bash
npm run dev
```

The mock server runs on port 9000, and the proxy runs on port 3000.

### 4. Test the Health Check

```bash
curl http://localhost:3000/health
```

### 5. Test the MCP Proxy

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list", "params": {}}'
```

You should see a list of tools returned from the mock Amazon server.

## Project Structure

```
geenie-proxy/
├── src/
│   ├── index.ts              # Server entry point
│   ├── config/
│   │   └── env.ts            # Environment configuration
│   ├── routes/
│   │   ├── health.ts         # Health check endpoints
│   │   └── mcp.ts            # MCP proxy route
│   └── utils/
│       └── logger.ts         # Pino logger setup
├── tests/
│   └── mocks/
│       └── amazon-server.ts  # Mock Amazon MCP server
└── package.json
```

## Development Phases

### ✅ Phase 1: Basic Proxy (Current)
- [x] Project setup with TypeScript
- [x] Fastify server with CORS
- [x] Health check endpoint
- [x] Basic MCP proxy route
- [x] Mock Amazon MCP server

### ⏳ Phase 2: Authentication (Next)
- [ ] API key validation middleware
- [ ] Subscription status checking
- [ ] Supabase integration
- [ ] Caching layer

### ⏳ Phase 3: Token Management
- [ ] Amazon token refresh logic
- [ ] Multi-account handling
- [ ] Token expiry checks

### ⏳ Phase 4: Tool Filtering
- [ ] Subscription tier restrictions
- [ ] Global tool blacklist
- [ ] Disabled tools injection

### ⏳ Phase 5: Production Ready
- [ ] Token encryption
- [ ] Rate limiting
- [ ] Error handling improvements
- [ ] Railway deployment

## Available Scripts

- `npm run dev` - Start proxy server with hot reload
- `npm run dev:mock` - Start mock Amazon MCP server
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run production build
- `npm test` - Run tests (coming soon)

## Environment Variables

See `.env.example` for all available configuration options.

## Testing

Currently using a mock Amazon MCP server that simulates:
- `tools/list` - Returns available MCP tools
- `tools/call` - Simulates tool execution with mock data

## Next Steps

1. Add API key validation (Phase 2)
2. Integrate with Supabase for user/subscription data
3. Implement Amazon token refresh logic
4. Add subscription-based tool filtering
5. Deploy to Railway

## License

MIT
