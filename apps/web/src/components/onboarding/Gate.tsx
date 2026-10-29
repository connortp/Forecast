"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadOnboarding } from "./progress";

/** Sends anyone who hasn't finished sign-up to /welcome before showing the app. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loadOnboarding().done) setReady(true);
    else router.replace("/welcome");
  }, [router]);

  return ready ? <>{children}</> : <div className="scene" />;
}
