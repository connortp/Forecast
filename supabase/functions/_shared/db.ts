import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Service-role client. Bypasses RLS, so always filter by user_id yourself. */
export function admin(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** The signed-in user who called this function. */
export async function requireUser(req: Request, db: SupabaseClient): Promise<{ id: string }> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sign in first");
  return { id: data.user.id };
}
