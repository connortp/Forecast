// Plaid webhooks. Deployed with verify_jwt off (Plaid can't send a Supabase JWT), so
// every request is checked against Plaid's signed Plaid-Verification header instead.
//
// Handled:
//   TRANSACTIONS  SYNC_UPDATES_AVAILABLE         -> sync the item
//   TRANSACTIONS  RECURRING_TRANSACTIONS_UPDATE  -> refresh recurring streams
//   ITEM          ERROR / LOGIN_REPAIRED / PENDING_EXPIRATION / PENDING_DISCONNECT / USER_PERMISSION_REVOKED

import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "npm:jose@5.9.6";
import { admin } from "../_shared/db.ts";
import { plaid } from "../_shared/plaid.ts";
import { syncItem, syncRecurring } from "../_shared/sync.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const keyCache = new Map<string, JWK>();

async function verify(req: Request, raw: string): Promise<boolean> {
  const token = req.headers.get("Plaid-Verification");
  if (!token) return false;
  try {
    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== "ES256" || !kid) return false;

    let jwk = keyCache.get(kid);
    if (!jwk) {
      const res = await plaid<{ key: JWK & { expired_at: number | null } }>("/webhook_verification_key/get", { key_id: kid });
      if (res.key.expired_at) return false;
      jwk = res.key;
      keyCache.set(kid, jwk);
    }

    const { payload } = await jwtVerify(token, await importJWK(jwk, "ES256"), { maxTokenAge: "5 min" });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return payload.request_body_sha256 === hex;
  } catch (err) {
    console.warn("webhook verification failed", (err as Error).message);
    return false;
  }
}

type Webhook = {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: { error_code?: string } | null;
};

async function processHook(hook: Webhook) {
  const db = admin();
  const { data: item } = await db.from("plaid_items").select("id, user_id").eq("plaid_item_id", hook.item_id).maybeSingle();
  if (!item) {
    console.warn("webhook for unknown item", hook.webhook_type, hook.webhook_code);
    return;
  }

  const setStatus = (status: string, error_code: string | null = null) =>
    db.from("plaid_items").update({ status, error_code }).eq("id", item.id);

  switch (`${hook.webhook_type}.${hook.webhook_code}`) {
    case "TRANSACTIONS.SYNC_UPDATES_AVAILABLE":
      await syncItem(db, item);
      break;
    case "TRANSACTIONS.RECURRING_TRANSACTIONS_UPDATE":
      await syncRecurring(db, item);
      break;
    case "ITEM.ERROR":
      await setStatus(hook.error?.error_code === "ITEM_LOGIN_REQUIRED" ? "login_required" : "error", hook.error?.error_code ?? null);
      break;
    case "ITEM.LOGIN_REPAIRED":
      await setStatus("healthy");
      break;
    case "ITEM.PENDING_EXPIRATION":
    case "ITEM.PENDING_DISCONNECT":
      await setStatus("pending_expiration", hook.webhook_code);
      break;
    case "ITEM.USER_PERMISSION_REVOKED":
    case "ITEM.USER_ACCOUNT_REVOKED":
      await setStatus("revoked", hook.webhook_code);
      break;
    default:
      // Legacy transaction webhooks (INITIAL_UPDATE, DEFAULT_UPDATE, ...) are covered by SYNC_UPDATES_AVAILABLE.
      break;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!(await verify(req, raw))) return new Response("Unauthorized", { status: 401 });

  let hook: Webhook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Answer Plaid right away; do the work in the background.
  EdgeRuntime.waitUntil(processHook(hook).catch((err) => console.error("webhook failed", hook.webhook_type, hook.webhook_code, err)));
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
