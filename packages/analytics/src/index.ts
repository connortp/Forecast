import posthog, { type CaptureResult, type PostHogConfig } from "posthog-js";
import type { EventMap, EventName, PersonProperties, Surface } from "./events";
import { sanitizeOutgoing, sanitizeProperties } from "./privacy";

export type { EventMap, EventName, PersonProperties, Surface } from "./events";
export { sanitizeProperties, scrubUrl } from "./privacy";

export interface AnalyticsOptions {
  /** PostHog project API key (public, "phc_..."). Missing key = analytics off. */
  key: string | undefined;
  /** PostHog ingestion host, e.g. https://us.i.posthog.com or a reverse proxy path. */
  host: string | undefined;
  surface: Surface;
  /**
   * Keep no cookies or localStorage; every page load is a fresh anonymous
   * visitor. Default true for the marketing site so no consent banner is needed.
   */
  cookieless?: boolean;
  /** Session replay with every piece of text and every input masked. Default off. */
  sessionReplay?: boolean;
  debug?: boolean;
}

let enabled = false;

export function initAnalytics(options: AnalyticsOptions): void {
  if (enabled || typeof window === "undefined" || !options.key) return;

  const cookieless = options.cookieless ?? options.surface === "site";
  const config: Partial<PostHogConfig> = {
    api_host: options.host || "https://us.i.posthog.com",
    defaults: "2025-05-24",
    person_profiles: "identified_only",
    persistence: cookieless ? "memory" : "localStorage+cookie",
    capture_pageview: "history_change",
    capture_pageleave: true,
    // Autocapture would read button and label text, which on the forecast
    // screen is the user's money. Every event is explicit instead.
    autocapture: false,
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: !options.sessionReplay,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
    },
    respect_dnt: true,
    before_send: (event: CaptureResult | null) => {
      if (!event) return null;
      event.properties = sanitizeOutgoing(event.properties);
      if (event.$set) event.$set = sanitizeProperties(event.$set);
      if (event.$set_once) event.$set_once = sanitizeProperties(event.$set_once);
      return event;
    },
    debug: options.debug ?? false,
  };

  posthog.init(options.key, config);
  posthog.register({ surface: options.surface });
  enabled = true;
}

/** Send a typed event. Properties are checked at compile time and sanitized at runtime. */
export function track<E extends EventName>(
  event: E,
  ...[properties]: EventMap[E] extends Record<string, never> ? [] : [EventMap[E]]
): void {
  if (!enabled) return;
  posthog.capture(event, sanitizeProperties(properties as Record<string, unknown> | undefined));
}

/**
 * Link this device to a signed-in user. Pass Forecast's internal user id
 * (a UUID), never an email or a Plaid id.
 */
export function identify(userId: string, properties?: PersonProperties): void {
  if (!enabled) return;
  posthog.identify(userId, sanitizeProperties(properties as Record<string, unknown> | undefined));
}

export function setPersonProperties(properties: PersonProperties): void {
  if (!enabled) return;
  posthog.setPersonProperties(sanitizeProperties(properties as Record<string, unknown>));
}

/** Call on logout so the next user on this device starts anonymous. */
export function resetAnalytics(): void {
  if (!enabled) return;
  posthog.reset();
}

export function optOut(): void {
  if (!enabled) return;
  posthog.opt_out_capturing();
}

export function optIn(): void {
  if (!enabled) return;
  posthog.opt_in_capturing();
}

export function isOptedOut(): boolean {
  return enabled ? posthog.has_opted_out_capturing() : true;
}

/** Feature flags, for experiments on copy or onboarding. */
export function isFeatureEnabled(flag: string): boolean {
  return enabled ? posthog.isFeatureEnabled(flag) === true : false;
}
