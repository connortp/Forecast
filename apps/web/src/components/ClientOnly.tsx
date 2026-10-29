"use client";

import dynamic from "next/dynamic";

// The view depends on the viewer's clock and saved preferences, so it renders on the client.
export const ForecastAppClient = dynamic(() => import("./ForecastApp").then((m) => m.ForecastApp), {
  ssr: false,
  loading: () => <div className="app" />,
});

export const ImportPreviewClient = dynamic(() => import("./ImportPreview").then((m) => m.ImportPreview), {
  ssr: false,
  loading: () => <div className="app" />,
});
