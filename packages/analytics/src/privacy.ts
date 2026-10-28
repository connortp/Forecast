/**
 * Runtime guard rails. The types in events.ts stop most mistakes at compile
 * time; this catches the rest (untyped call sites, autocaptured PostHog
 * properties, future refactors) before anything leaves the device.
 */

type Props = Record<string, unknown>;

/** Property keys that must never be sent, whatever their value. */
const SENSITIVE_KEY =
  /amount|balance|income|salary|spend|price|cost|total|budget|merchant|institution|account_name|account_number|routing|iban|card|email|phone|address|full_name|first_name|last_name|ssn|token|secret|password|plaid_/i;

/** Values that look like money, emails or long digit runs (account numbers). */
const SENSITIVE_VALUE = /[$€£]\s?\d|\d[\d,]*\.\d{2}\b|[^\s@]+@[^\s@]+\.[^\s@]+|\d{6,}/;

/** Counts above this are more likely a dollar figure than a count. */
export const MAX_COUNT = 100;

const MAX_STRING = 64;

/** PostHog's own properties we keep as-is (after URL scrubbing). */
const POSTHOG_PREFIX = "$";

const URL_KEYS = new Set(["$current_url", "$referrer", "$initial_referrer", "$initial_current_url"]);

/** Drop query string and hash: they can carry Plaid link tokens or OAuth codes. */
export function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/)[0] ?? "";
  }
}

function cleanValue(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined;
  }
  if (typeof value === "string") {
    if (SENSITIVE_VALUE.test(value)) return undefined;
    return value.slice(0, MAX_STRING);
  }
  // Objects and arrays could hide anything; we only send flat properties.
  return undefined;
}

/** Sanitize properties we set ourselves (event and person properties). */
export function sanitizeProperties(props: Props | undefined): Props {
  const out: Props = {};
  if (!props) return out;
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith(POSTHOG_PREFIX) || SENSITIVE_KEY.test(key)) continue;
    const clean = cleanValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/**
 * Sanitize a full outgoing payload, including PostHog's automatic `$`
 * properties. Used as posthog-js `before_send`.
 */
export function sanitizeOutgoing(props: Props): Props {
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith(POSTHOG_PREFIX)) {
      if (key === "$set" || key === "$set_once") {
        out[key] = sanitizeProperties(value as Props);
      } else {
        out[key] = URL_KEYS.has(key) && typeof value === "string" ? scrubUrl(value) : value;
      }
      continue;
    }
    if (SENSITIVE_KEY.test(key)) continue;
    // Super properties like `surface` and PostHog internals like `token`
    // (the public project key, matched by SENSITIVE_KEY above, re-added below).
    const clean = cleanValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  if ("token" in props) out.token = props.token;
  if ("distinct_id" in props) out.distinct_id = props.distinct_id;
  return out;
}
