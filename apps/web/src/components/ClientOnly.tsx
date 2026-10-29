"use client";

import dynamic from "next/dynamic";
import { OnboardingGate } from "./onboarding/Gate";

// The view depends on the viewer's clock and saved preferences, so it renders on the client.
const ForecastApp = dynamic(() => import("./ForecastApp").then((m) => m.ForecastApp), {
  ssr: false,
  loading: () => <div className="app" />,
});

export function ForecastAppClient() {
  return <OnboardingGate>{(live) => <ForecastApp live={live} />}</OnboardingGate>;
}

export const ImportPreviewClient = dynamic(() => import("./ImportPreview").then((m) => m.ImportPreview), {
  ssr: false,
  loading: () => <div className="app" />,
});
