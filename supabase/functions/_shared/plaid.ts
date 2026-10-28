// Minimal Plaid client over fetch. Environments are sandbox and production only.

const env = Deno.env.get("PLAID_ENV") ?? "sandbox";
if (env !== "sandbox" && env !== "production") throw new Error(`PLAID_ENV must be sandbox or production, got ${env}`);

const base = `https://${env}.plaid.com`;

export class PlaidError extends Error {
  constructor(public code: string, public type: string, message: string, public status: number) {
    super(message);
  }
}

export async function plaid<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  if (!clientId || !secret) throw new PlaidError("MISSING_KEYS", "CONFIG", "Plaid keys are not set", 500);

  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new PlaidError(data.error_code ?? "UNKNOWN", data.error_type ?? "API_ERROR", data.error_message ?? res.statusText, res.status);
  }
  return data as T;
}

export function webhookUrl(): string {
  return Deno.env.get("PLAID_WEBHOOK_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/plaid-webhook`;
}
