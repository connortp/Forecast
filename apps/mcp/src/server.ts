import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { outlook, events, today, type Snapshot } from "./engine.js";
import type { ForecastData } from "./data.js";

// The Forecast MCP server. Every tool is read-only: it answers questions about the
// user's own safe-to-spend number and never moves money or changes settings.
//
// Privacy rules every tool follows:
// - Return derived numbers only. No account names or numbers, balances per account,
//   transactions, merchants, or Plaid identifiers.
// - Bill and bucket names are the labels the user confirmed in the app, nothing raw.
// - Money is rounded to cents; nothing is logged.

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const CONDITION = z.enum(["sunny", "partly", "cloudy", "rain", "storm"]);
const money = (n: number) => Math.round(n * 100) / 100;

/** YYYY-MM-DD for `offset` days after `start`. */
export function dateAt(start: string, offset: number): string {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const NOT_CONNECTED = {
  isError: true,
  content: [{ type: "text" as const, text: "This Forecast account has no bank connected yet, so there is no number to report. Finish setup in the Forecast app." }],
};

export function createForecastServer(data: ForecastData, userIdFrom: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => string) {
  const server = new McpServer(
    { name: "forecast", title: "Forecast", version: "0.1.0" },
    {
      instructions:
        "Forecast tells a person how much they can safely spend today: cash on hand, minus bills and savings due before the next payday, " +
        "minus a small cushion, spread across the days until payday. The weather condition compares today's allowance with their normal day " +
        "(sunny means plenty of room, storm means they are short). Use get_safe_to_spend first. All amounts are US dollars.",
    },
  );

  // Loads the user's snapshot or returns the "not connected" result.
  async function load(extra: Parameters<typeof userIdFrom>[0]) {
    return data.snapshotFor(userIdFrom(extra));
  }

  server.registerTool(
    "get_safe_to_spend",
    {
      title: "Safe to spend today",
      description:
        "How much the user can safely spend today, today's weather condition, the next payday, and the breakdown behind the number.",
      outputSchema: {
        date: z.string(),
        safeToSpend: z.number().describe("What is left to spend today after what was already spent. Never below 0."),
        dailyAllowance: z.number().describe("Today's full share before any spending. Negative means short."),
        spentToday: z.number(),
        condition: CONDITION,
        nextPayday: z.object({ date: z.string(), inDays: z.number() }),
        breakdown: z.object({
          cashThisMorning: z.number(),
          billsBeforePayday: z.number(),
          billCount: z.number(),
          savingsBeforePayday: z.number(),
          cushion: z.number(),
          leftForDaysUntilPayday: z.number(),
        }),
      },
      annotations: { title: "Safe to spend today", ...READ_ONLY },
    },
    async (extra) => {
      const u = await load(extra);
      if (!u) return NOT_CONNECTED;
      const s = u.snapshot;
      const t = today(s);
      const out = {
        date: u.today,
        safeToSpend: money(t.safeToSpend),
        dailyAllowance: money(t.daily),
        spentToday: money(s.spentToday),
        condition: t.condition,
        nextPayday: { date: dateAt(u.today, t.until), inDays: t.until },
        breakdown: {
          cashThisMorning: money(t.startCash),
          billsBeforePayday: money(t.bills),
          billCount: t.billCount,
          savingsBeforePayday: money(t.saving),
          cushion: money(s.cushion),
          leftForDaysUntilPayday: money(t.pool),
        },
      };
      const text =
        `Safe to spend today: $${out.safeToSpend.toFixed(2)} (${out.condition}). ` +
        `Payday is in ${t.until} day${t.until === 1 ? "" : "s"} (${out.nextPayday.date}).`;
      return { content: [{ type: "text", text }], structuredContent: out };
    },
  );

  server.registerTool(
    "get_outlook",
    {
      title: "Spending outlook",
      description:
        "Day-by-day forecast of the daily allowance and weather, assuming the user spends a normal amount each day. Paydays are marked.",
      inputSchema: { days: z.number().int().min(1).max(14).default(7).describe("How many days to forecast, starting today.") },
      outputSchema: {
        days: z.array(z.object({ date: z.string(), dailyAllowance: z.number(), condition: CONDITION, payday: z.boolean() })),
      },
      annotations: { title: "Spending outlook", ...READ_ONLY },
    },
    async ({ days }, extra) => {
      const u = await load(extra);
      if (!u) return NOT_CONNECTED;
      const out = {
        days: outlook(u.snapshot, days).map((d) => ({
          date: dateAt(u.today, d.day),
          dailyAllowance: money(d.daily),
          condition: d.condition,
          payday: d.payday,
        })),
      };
      const text = out.days.map((d) => `${d.date}: $${d.dailyAllowance.toFixed(0)}/day, ${d.condition}${d.payday ? " (payday)" : ""}`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: out };
    },
  );

  server.registerTool(
    "get_upcoming",
    {
      title: "Upcoming bills and paydays",
      description: "Bills, paychecks, and savings transfers coming up in the next few days, in date order.",
      inputSchema: { days: z.number().int().min(1).max(45).default(14).describe("How many days ahead to look.") },
      outputSchema: {
        items: z.array(
          z.object({ date: z.string(), name: z.string(), amount: z.number(), kind: z.enum(["bill", "pay", "save"]) }),
        ),
      },
      annotations: { title: "Upcoming bills and paydays", ...READ_ONLY },
    },
    async ({ days }, extra) => {
      const u = await load(extra);
      if (!u) return NOT_CONNECTED;
      const items = events(u.snapshot, 0, days).map((e) => ({
        date: dateAt(u.today, e.day),
        name: e.name,
        amount: money(e.amount),
        kind: e.kind,
      }));
      const text = items.length
        ? items.map((e) => `${e.date}  ${e.kind === "pay" ? "+" : "−"}$${e.amount.toFixed(2)}  ${e.name}`).join("\n")
        : `Nothing scheduled in the next ${days} days.`;
      return { content: [{ type: "text", text }], structuredContent: { items } };
    },
  );

  server.registerTool(
    "get_savings_buckets",
    {
      title: "Savings buckets",
      description: "The user's savings goals: how much is saved, the target, what each paycheck adds, and paychecks left to reach it.",
      outputSchema: {
        buckets: z.array(
          z.object({
            name: z.string(),
            saved: z.number(),
            goal: z.number(),
            percent: z.number(),
            perPaycheck: z.number(),
            paychecksToGoal: z.number().nullable().describe("Null when nothing is set aside per paycheck."),
          }),
        ),
      },
      annotations: { title: "Savings buckets", ...READ_ONLY },
    },
    async (extra) => {
      const u = await load(extra);
      if (!u) return NOT_CONNECTED;
      const buckets = u.snapshot.buckets.map((b) => {
        const left = Math.max(0, b.goal - b.saved);
        return {
          name: b.name,
          saved: money(b.saved),
          goal: money(b.goal),
          percent: b.goal > 0 ? Math.min(100, Math.round((b.saved / b.goal) * 100)) : 100,
          perPaycheck: money(b.perPaycheck),
          paychecksToGoal: left === 0 ? 0 : b.perPaycheck > 0 ? Math.ceil(left / b.perPaycheck) : null,
        };
      });
      const text = buckets.map((b) => `${b.name}: $${b.saved.toFixed(0)} of $${b.goal.toFixed(0)} (${b.percent}%)`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: { buckets } };
    },
  );

  server.registerTool(
    "check_purchase",
    {
      title: "Can I afford this?",
      description:
        "Checks a purchase the user is considering today against their safe-to-spend number, and how it would change tomorrow's allowance. " +
        "This only does the math; it does not record or make the purchase.",
      inputSchema: { amount: z.number().positive().max(1_000_000).describe("Purchase amount in US dollars.") },
      outputSchema: {
        amount: z.number(),
        fitsToday: z.boolean(),
        safeToSpendBefore: z.number(),
        safeToSpendAfter: z.number(),
        overBy: z.number().describe("How far over today's number the purchase goes. 0 when it fits."),
        tomorrowConditionAfter: CONDITION,
        tomorrowAllowanceBefore: z.number(),
        tomorrowAllowanceAfter: z.number(),
        coversBillsBeforePayday: z.boolean().describe("False when the purchase would leave too little for bills before payday."),
      },
      annotations: { title: "Can I afford this?", ...READ_ONLY },
    },
    async ({ amount }, extra) => {
      const u = await load(extra);
      if (!u) return NOT_CONNECTED;
      const s = u.snapshot;
      const after: Snapshot = { ...s, cash: s.cash - amount, spentToday: s.spentToday + amount };
      const before = today(s);
      const then = today(after);
      const tomorrow = (x: Snapshot) => outlook(x, 2)[1];
      const out = {
        amount: money(amount),
        fitsToday: amount <= before.safeToSpend,
        safeToSpendBefore: money(before.safeToSpend),
        safeToSpendAfter: money(then.safeToSpend),
        overBy: money(Math.max(0, amount - before.safeToSpend)),
        tomorrowConditionAfter: tomorrow(after).condition,
        tomorrowAllowanceBefore: money(tomorrow(s).daily),
        tomorrowAllowanceAfter: money(tomorrow(after).daily),
        coversBillsBeforePayday: after.cash - before.bills - before.saving >= 0,
      };
      const text = out.fitsToday
        ? `Yes. $${out.amount.toFixed(2)} fits; $${out.safeToSpendAfter.toFixed(2)} would be left today.`
        : `It goes $${out.overBy.toFixed(2)} over today's number. Tomorrow's allowance would drop from $${out.tomorrowAllowanceBefore.toFixed(0)} to $${out.tomorrowAllowanceAfter.toFixed(0)}.` +
          (out.coversBillsBeforePayday ? "" : " It would also leave too little for bills due before payday.");
      return { content: [{ type: "text", text }], structuredContent: out };
    },
  );

  return server;
}
