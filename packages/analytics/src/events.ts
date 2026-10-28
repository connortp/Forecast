/**
 * Forecast event taxonomy. This file is the source of truth: every event the
 * web app, marketing site or iOS app sends must be listed here, and
 * docs/analytics.md mirrors it for humans (and for the Swift port).
 *
 * Naming: `object_action`, snake_case, past tense ("bank_link_succeeded").
 * Properties: enums, booleans and small counts only. Never dollar amounts,
 * balances, merchant/institution/account names, or anything typed by the user.
 */

/** Which product surface sent the event. Registered as a super property. */
export type Surface = "web" | "site" | "ios";

/** Coarse forecast condition shown to the user. Never the underlying number. */
export type ForecastCondition = "clear" | "partly_cloudy" | "overcast" | "rain" | "storm";

export type AuthMethod = "email" | "google" | "apple" | "passkey";

export type BucketKind = "emergency" | "bills" | "goal" | "custom";

export interface EventMap {
  // Marketing site
  site_cta_clicked: { cta: string; location: "hero" | "nav" | "pricing" | "footer" | "inline" };
  site_section_viewed: { section: string };
  waitlist_joined: { source: "hero" | "nav" | "footer" | "inline" };
  /** The interactive demo on the landing page. */
  site_demo_condition_selected: { condition: "clear" | "cloudy" | "stormy" };
  site_demo_voice_selected: { voice: "plain" | "friendly" | "snarky" };

  // Auth
  signup_started: { method: AuthMethod };
  signup_completed: { method: AuthMethod };
  login_completed: { method: AuthMethod };
  logout_completed: Record<string, never>;

  // Onboarding and bank linking (Plaid)
  onboarding_step_viewed: { step: "welcome" | "link_bank" | "income" | "buckets" | "done" };
  onboarding_completed: { skipped_steps: number };
  bank_link_started: { entry_point: "onboarding" | "settings" | "relink" };
  bank_link_succeeded: { accounts_linked: number; entry_point: "onboarding" | "settings" | "relink" };
  /** `error_type` is Plaid's error category (e.g. ITEM_ERROR), never the message. */
  bank_link_failed: { error_type: string; entry_point: "onboarding" | "settings" | "relink" };
  bank_link_exited: { last_step: string; entry_point: "onboarding" | "settings" | "relink" };

  // The forecast itself
  forecast_viewed: { condition: ForecastCondition; is_first_view: boolean };
  forecast_refreshed: { trigger: "pull" | "auto" | "focus" };
  forecast_detail_opened: { panel: "buckets" | "upcoming" | "history" | "explainer" };

  // Savings buckets
  bucket_created: { kind: BucketKind };
  bucket_updated: { kind: BucketKind; field: "name" | "target" | "schedule" };
  bucket_deleted: { kind: BucketKind };

  // Settings and system
  settings_changed: { setting: string };
  notifications_permission_answered: { granted: boolean };
  error_shown: { error_code: string; screen: string };
}

export type EventName = keyof EventMap;

/** Allowed person properties. Same rules as event properties. */
export interface PersonProperties {
  surface?: Surface;
  signup_method?: AuthMethod;
  has_linked_bank?: boolean;
  bucket_count?: number;
  plan?: "free" | "plus";
}
