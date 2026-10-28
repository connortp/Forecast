import type { Snapshot } from "./engine.js";
import { SCENARIOS, type ScenarioKey } from "./mock-data.js";

// Where a user's numbers come from. The engine works in day offsets, so a source also
// says which calendar day "today" is for this person, in their own time zone.

export type UserSnapshot = {
  snapshot: Snapshot;
  /** Today's date for this user, YYYY-MM-DD in their time zone. */
  today: string;
};

export interface ForecastData {
  /** Returns null when the user has not finished connecting a bank yet. */
  snapshotFor(userId: string): Promise<UserSnapshot | null>;
}

/** Sample data for local development and demos. Every user sees the same scenario. */
export class MockData implements ForecastData {
  constructor(
    private scenario: ScenarioKey = "partly",
    private clock: () => Date = () => new Date(),
  ) {}

  async snapshotFor(): Promise<UserSnapshot> {
    return { snapshot: SCENARIOS[this.scenario].snapshot, today: this.clock().toISOString().slice(0, 10) };
  }
}

// TODO(supabase): a SupabaseData that reads the nightly snapshot row for the user
// (cash, bills, paycheck, buckets, learned typicalDay) under RLS with the user's own
// JWT, never the service role key, so the server cannot read anyone else's data.

export function isScenario(s: string | undefined): s is ScenarioKey {
  return !!s && s in SCENARIOS;
}
