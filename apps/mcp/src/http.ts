import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { RequestHandler } from "express";
import { jwtVerifier, userIdFrom } from "./auth.js";
import { MockData, isScenario } from "./data.js";
import { createForecastServer } from "./server.js";

// Remote MCP endpoint (Streamable HTTP), the kind Claude adds as a custom connector.
//
// With FORECAST_AUTH_ISSUER set, every request needs a bearer token from that issuer.
// Without it the server runs in demo mode: no sign-in, sample data, localhost only.

const port = Number(process.env.PORT ?? 8787);
const issuer = process.env.FORECAST_AUTH_ISSUER;
const publicUrl = new URL(process.env.FORECAST_MCP_URL ?? `http://localhost:${port}/mcp`);
const scenario = process.env.FORECAST_MOCK_SCENARIO;

// TODO(supabase): swap MockData for SupabaseData once the snapshot table exists.
const data = new MockData(isScenario(scenario) ? scenario : "partly");

const app = createMcpExpressApp(issuer ? { host: "0.0.0.0", allowedHosts: [publicUrl.hostname] } : {});
let guard: RequestHandler;

if (issuer) {
  const resource = publicUrl;
  app.use(
    mcpAuthMetadataRouter({
      // Only the fields clients need to find the sign-in flow; the issuer serves the rest.
      oauthMetadata: {
        issuer,
        authorization_endpoint: new URL("oauth/authorize", withSlash(issuer)).href,
        token_endpoint: new URL("oauth/token", withSlash(issuer)).href,
        registration_endpoint: new URL("oauth/clients/register", withSlash(issuer)).href,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      },
      resourceServerUrl: resource,
      scopesSupported: ["forecast:read"],
      resourceName: "Forecast",
    }),
  );
  guard = requireBearerAuth({
    verifier: jwtVerifier({ issuer, jwksUrl: new URL(".well-known/jwks.json", withSlash(issuer)), resource }),
    requiredScopes: process.env.FORECAST_REQUIRE_SCOPE === "1" ? ["forecast:read"] : [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    expectedResource: resource,
  });
} else {
  // Demo mode: everyone is the same sample user.
  guard = (req, _res, next) => {
    req.auth = { token: "demo", clientId: "demo", scopes: ["forecast:read"], extra: { userId: "demo" } };
    next();
  };
}

// Stateless: a fresh server and transport per request, so any instance can answer.
app.post("/mcp", guard, async (req, res) => {
  const server = createForecastServer(data, userIdFrom);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const notAllowed: RequestHandler = (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

app.listen(port, issuer ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Forecast MCP on ${publicUrl.href} (${issuer ? "OAuth" : "demo mode, sample data"})`);
});

function withSlash(u: string) {
  return u.endsWith("/") ? u : `${u}/`;
}
