// CORS and JSON helpers. Every response, errors included, carries CORS headers so the
// browser shows the real error instead of a CORS failure.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Wraps a handler so thrown errors become JSON responses with CORS headers. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req);
    if (early) return early;
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
      console.error(err);
      const e = err as { message?: string; code?: string };
      return json({ error: e.message ?? "Unexpected error", code: e.code }, 500);
    }
  };
}

export async function readBody<T>(req: Request): Promise<Partial<T>> {
  if (req.method !== "POST") throw new HttpError(405, "Use POST");
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}
