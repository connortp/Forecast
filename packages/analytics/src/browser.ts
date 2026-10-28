/**
 * Entry for pages without a bundler (the marketing site). Built to
 * dist/forecast-analytics.js and exposed as `window.ForecastAnalytics`.
 * Key and host come from <meta name="posthog-key"> / <meta name="posthog-host">
 * unless passed in.
 */
import * as analytics from "./index";
import type { AnalyticsOptions } from "./index";

function meta(name: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
}

const ForecastAnalytics = {
  ...analytics,
  init(options: Partial<AnalyticsOptions> & Pick<AnalyticsOptions, "surface">) {
    analytics.initAnalytics({
      ...options,
      key: options.key ?? meta("posthog-key"),
      host: options.host ?? meta("posthog-host"),
    });
  },
};

declare global {
  interface Window {
    ForecastAnalytics: typeof ForecastAnalytics;
  }
}

window.ForecastAnalytics = ForecastAnalytics;
