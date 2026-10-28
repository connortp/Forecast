import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockData, type ForecastData } from "./data.js";
import { createForecastServer, dateAt } from "./server.js";

const NOW = () => new Date("2026-10-28T15:00:00Z");

async function connect(data: ForecastData = new MockData("partly", NOW)) {
  const server = createForecastServer(data, () => "demo");
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const call = async (name: string, args: Record<string, unknown> = {}, data?: ForecastData) => {
  const client = await connect(data);
  const res = await client.callTool({ name, arguments: args });
  return res as { isError?: boolean; structuredContent?: any; content: { type: string; text: string }[] };
};

describe("tools", () => {
  it("lists only read-only tools", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_purchase", "get_outlook", "get_safe_to_spend", "get_savings_buckets", "get_upcoming",
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("reports the same number the app shows", async () => {
    const r = await call("get_safe_to_spend");
    expect(Math.round(r.structuredContent.safeToSpend)).toBe(57);
    expect(r.structuredContent.condition).toBe("partly");
    expect(r.structuredContent.nextPayday).toEqual({ date: "2026-11-03", inDays: 6 });
    expect(r.content[0].text).toContain("Safe to spend today");
  });

  it("forecasts the requested number of days and marks payday", async () => {
    const r = await call("get_outlook", { days: 7 });
    expect(r.structuredContent.days).toHaveLength(7);
    expect(r.structuredContent.days[6]).toMatchObject({ date: "2026-11-03", payday: true });
  });

  it("rejects an outlook longer than two weeks", async () => {
    const r = await call("get_outlook", { days: 30 });
    expect(r.isError).toBe(true);
  });

  it("lists bills, pay, and savings in date order", async () => {
    const r = await call("get_upcoming", { days: 7 });
    expect(r.structuredContent.items.map((i: any) => i.name)).toEqual(["Electric", "Internet", "Gym", "Paycheck", "To savings"]);
  });

  it("shows progress toward each savings goal", async () => {
    const r = await call("get_savings_buckets");
    expect(r.structuredContent.buckets[0]).toMatchObject({ name: "Emergency fund", percent: 42, paychecksToGoal: 29 });
  });

  it("says yes to a purchase that fits and explains one that does not", async () => {
    const small = await call("check_purchase", { amount: 20 });
    expect(small.structuredContent.fitsToday).toBe(true);
    const big = await call("check_purchase", { amount: 200 });
    expect(big.structuredContent.fitsToday).toBe(false);
    expect(big.structuredContent.tomorrowAllowanceAfter).toBeLessThan(big.structuredContent.tomorrowAllowanceBefore);
    expect(big.structuredContent.coversBillsBeforePayday).toBe(true);
  });

  it("explains when no bank is connected yet", async () => {
    const r = await call("get_safe_to_spend", {}, { snapshotFor: async () => null });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no bank connected/);
  });
});

describe("dateAt", () => {
  it("crosses month ends", () => {
    expect(dateAt("2026-10-30", 3)).toBe("2026-11-02");
  });
});
