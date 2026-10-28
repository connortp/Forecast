import { ForecastAppClient } from "@/components/ClientOnly";
import { OnboardingGate } from "@/components/onboarding/Gate";

export default function Home() {
  return (
    <OnboardingGate>
      <ForecastAppClient />
    </OnboardingGate>
  );
}
