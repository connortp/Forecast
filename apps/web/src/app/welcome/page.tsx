import type { Metadata } from "next";
import { OnboardingClient } from "@/components/onboarding/OnboardingClient";

export const metadata: Metadata = { title: "Welcome to Forecast" };

export default function Welcome() {
  return <OnboardingClient />;
}
