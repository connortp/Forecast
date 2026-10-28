// Until accounts exist, "signed up" lives in this browser. Supabase replaces this.
const KEY = "forecast-onboarding";

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
