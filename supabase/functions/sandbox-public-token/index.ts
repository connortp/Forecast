// Sandbox only: makes a Plaid public token for a test bank without opening Link, so
// the apps and tests can run the real exchange-public-token flow end to end.
// Returns 404 when PLAID_ENV is production.
// Body: { institution_id? } (defaults to First Platypus Bank, ins_109508).

import { admin, requireUser } from "../_shared/db.ts";
import { handle, HttpError, json, readBody } from "../_shared/http.ts";
import { plaid, webhookUrl } from "../_shared/plaid.ts";

Deno.serve(handle(async (req) => {
  if ((Deno.env.get("PLAID_ENV") ?? "sandbox") !== "sandbox") throw new HttpError(404, "Not found");
  await requireUser(req, admin());
  const { institution_id = "ins_109508" } = await readBody<{ institution_id: string }>(req);

  const res = await plaid<{ public_token: string }>("/sandbox/public_token/create", {
    institution_id,
    initial_products: ["transactions"],
    options: { webhook: webhookUrl() },
  });
  return json({ public_token: res.public_token, institution: { institution_id, name: "Sandbox test bank" } });
}));
