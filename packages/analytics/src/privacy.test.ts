import { describe, expect, it } from "vitest";
import { sanitizeOutgoing, sanitizeProperties, scrubUrl } from "./privacy";

describe("sanitizeProperties", () => {
  it("keeps enums, booleans and small counts", () => {
    expect(sanitizeProperties({ panel: "buckets", granted: true, accounts_linked: 3 })).toEqual({
      panel: "buckets",
      granted: true,
      accounts_linked: 3,
    });
  });

  it("drops sensitive keys whatever the value", () => {
    expect(
      sanitizeProperties({ safe_to_spend: 1, amount: 2, balance: "x", merchant: "Blue Bottle", email: "a", plaid_item_id: "i" }),
    ).toEqual({});
  });

  it("drops money-like, email-like and account-number-like values", () => {
    expect(
      sanitizeProperties({ a: "$42", b: "42.10", c: "1,204.55", d: "me@x.com", e: "0123456789", f: "ok" }),
    ).toEqual({ f: "ok" });
  });

  it("drops numbers that are not small non-negative integers", () => {
    expect(sanitizeProperties({ a: 101, b: 4.5, c: -1, d: 100 })).toEqual({ d: 100 });
  });

  it("drops nested objects and caller-set $ properties", () => {
    expect(sanitizeProperties({ nested: { x: 1 }, list: [1], $current_url: "x" })).toEqual({});
  });

  it("truncates long strings", () => {
    expect((sanitizeProperties({ s: "a".repeat(200) }).s as string).length).toBe(64);
  });
});

describe("scrubUrl", () => {
  it("removes query and hash", () => {
    expect(scrubUrl("https://app.forecast.money/link?oauth_state_id=abc#t")).toBe("https://app.forecast.money/link");
    expect(scrubUrl("/link?token=abc")).toBe("/link");
  });
});

describe("sanitizeOutgoing", () => {
  it("keeps PostHog internals, scrubs URLs and user props", () => {
    const out = sanitizeOutgoing({
      token: "phc_123",
      distinct_id: "018f2c3a-1234-7abc-9def-123456789012",
      $current_url: "https://app.forecast.money/?code=secret",
      $browser: "Chrome",
      surface: "web",
      balance: 1200,
      $set: { email: "me@x.com", plan: "free" },
    });
    expect(out).toEqual({
      token: "phc_123",
      distinct_id: "018f2c3a-1234-7abc-9def-123456789012",
      $current_url: "https://app.forecast.money/",
      $browser: "Chrome",
      surface: "web",
      $set: { plan: "free" },
    });
  });
});
