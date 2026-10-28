"use client";

import dynamic from "next/dynamic";

// Dates in the flow come from the viewer's clock, so it renders on the client.
export const OnboardingClient = dynamic(() => import("./Onboarding").then((m) => m.Onboarding), {
  ssr: false,
  loading: () => <div style={{ minHeight: "100svh", background: "#0a0a0b" }} />,
});
