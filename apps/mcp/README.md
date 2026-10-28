# @forecast/mcp

An MCP server so Claude and other assistants can answer "how much can I spend today?" from a user's Forecast. Read-only. Design and auth: [docs/mcp.md](../../docs/mcp.md).

```bash
pnpm dev     # HTTP at http://localhost:8787/mcp, demo mode with sample data
pnpm stdio   # stdio transport with sample data
pnpm test
```

| File | What it does |
| --- | --- |
| `src/server.ts` | The five tools |
| `src/engine.ts` | Safe-to-spend engine, copied from `apps/web` |
| `src/data.ts` | Data source interface and the sample-data source |
| `src/auth.ts` | JWT verification for OAuth access tokens |
| `src/http.ts` | Streamable HTTP entry point (remote connector) |
| `src/stdio.ts` | stdio entry point (local) |
