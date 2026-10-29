// Syncs the signed-in user's banks now (pull-to-refresh).
// Body: {} for every linked bank, or { item_id } for one.

import { admin, requireUser } from "../_shared/db.ts";
import { handle, json, readBody } from "../_shared/http.ts";
import { syncItem } from "../_shared/sync.ts";

Deno.serve(handle(async (req) => {
  const db = admin();
  const user = await requireUser(req, db);
  const { item_id } = await readBody<{ item_id: string }>(req);

  let query = db.from("plaid_items").select("id, user_id").eq("user_id", user.id).neq("status", "revoked");
  if (item_id) query = query.eq("id", item_id);
  const { data: items, error } = await query;
  if (error) throw error;

  const results = await Promise.all(
    (items ?? []).map(async (item) => {
      try {
        return { item_id: item.id, ok: true, ...(await syncItem(db, item)) };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return { item_id: item.id, ok: false, code: e.code ?? "SYNC_FAILED", error: e.message };
      }
    }),
  );
  return json({ items: results });
}));
