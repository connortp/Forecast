// Returns a Plaid Link token for the signed-in user.
// Body: {} for a new link, or { item_id } to re-link an item that needs login (update mode).

import { admin, requireUser } from "../_shared/db.ts";
import { handle, HttpError, json, readBody } from "../_shared/http.ts";
import { plaid, webhookUrl } from "../_shared/plaid.ts";

Deno.serve(handle(async (req) => {
  const db = admin();
  const user = await requireUser(req, db);
  const { item_id } = await readBody<{ item_id: string }>(req);

  const body: Record<string, unknown> = {
    user: { client_user_id: user.id },
    client_name: "Forecast",
    country_codes: ["US"],
    language: "en",
    webhook: webhookUrl(),
  };
  const redirect = Deno.env.get("PLAID_REDIRECT_URI");
  if (redirect) body.redirect_uri = redirect;

  if (item_id) {
    const { data: item } = await db.from("plaid_items").select("id").eq("id", item_id).eq("user_id", user.id).maybeSingle();
    if (!item) throw new HttpError(404, "No such bank connection");
    const { data: secret } = await db.from("plaid_item_secrets").select("access_token").eq("item_id", item.id).single();
    body.access_token = secret!.access_token;
  } else {
    body.products = ["transactions"];
    body.transactions = { days_requested: 730 };
  }

  const res = await plaid<{ link_token: string; expiration: string }>("/link/token/create", body);
  return json({ link_token: res.link_token, expiration: res.expiration });
}));
