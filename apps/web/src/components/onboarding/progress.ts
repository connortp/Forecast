import type { Snapshot } from "@/lib/engine";

// Until accounts exist, "signed up" lives in this browser. Supabase replaces this.
const KEY = "forecast-onboarding";
// What the person confirmed, for the home screen to read. Day offsets count from the day they signed up.
const SNAPSHOT_KEY = "forecast-snapshot";

export type Saved = { done: boolean; method?: "apple" | "google" | "email" };

export function loadOnboarding(): Saved {
  try {
    return { done: false, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { done: false };
  }
}

export function saveOnboarding(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function saveSnapshot(s: Snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
  } catch {}
}
