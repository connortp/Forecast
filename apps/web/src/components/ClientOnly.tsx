"use client";

import dynamic from "next/dynamic";

// The view depends on the viewer's clock and saved preferences, so it renders on the client.
export const ForecastAppClient = dynamic(() => import("./ForecastApp").then((m) => m.ForecastApp), {
  ssr: false,
  loading: () => <main className="wrap"><section className="photo hero" /></main>,
});
