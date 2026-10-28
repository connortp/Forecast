import { createRemoteJWKSet, jwtVerify } from "jose";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

// The MCP server is only an OAuth resource server. The authorization server (planned:
// Supabase Auth's OAuth 2.1 server, so users sign in with their Forecast account and
// approve Claude on a Forecast consent screen) issues short-lived JWTs; this checks
// them against its published keys and pulls out the user id.

export type JwtConfig = {
  issuer: string;
  jwksUrl: URL;
  /** This server's public URL. Tokens must name it as their audience. */
  resource: URL;
};

export function jwtVerifier(cfg: JwtConfig): OAuthTokenVerifier {
  const keys = createRemoteJWKSet(cfg.jwksUrl);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, keys, { issuer: cfg.issuer, audience: cfg.resource.href });
        if (!payload.sub) throw new Error("token has no subject");
        return {
          token,
          clientId: String(payload.client_id ?? payload.azp ?? ""),
          scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
          expiresAt: payload.exp,
          resource: cfg.resource,
          extra: { userId: payload.sub },
        };
      } catch (e) {
        throw new InvalidTokenError(e instanceof Error ? e.message : "invalid token");
      }
    },
  };
}

/** The signed-in user's id, as the verifier recorded it. */
export function userIdFrom(extra: { authInfo?: { extra?: Record<string, unknown> } }): string {
  const id = extra.authInfo?.extra?.userId;
  if (typeof id !== "string") throw new Error("Not signed in.");
  return id;
}
