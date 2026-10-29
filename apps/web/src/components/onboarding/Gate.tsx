"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Snapshot } from "@/lib/engine";
import { localYmd, toSnapshot } from "@/lib/live";
import { loadRows, supabase } from "@/lib/supabase";

export type Live = { snapshot: Snapshot; refresh: () => Promise<void>; signOut: () => Promise<void> };

/**
 * Sends anyone who hasn't signed in and finished sign-up to /welcome, then hands the
 * app their real snapshot. /?demo keeps the example data for design review.
 */
export function OnboardingGate({ children }: { children: (live: Live | null) => React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "demo" | Snapshot>("loading");

  const load = async () => {
    const rows = await loadRows();
    if (!rows.onboarded) return router.replace("/welcome");
    const s = toSnapshot(rows, localYmd(rows.timezone));
    if (s) setState(s);
    else router.replace("/welcome");
  };

  useEffect(() => {
    if (new URLSearchParams(location.search).has("demo")) return setState("demo");
    supabase().auth.getSession().then(({ data }) => (data.session ? load().catch(() => router.replace("/welcome")) : router.replace("/welcome")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") return <div className="scene" />;
  if (state === "demo") return <>{children(null)}</>;
  return (
    <>
      {children({
        snapshot: state,
        refresh: async () => {
          await supabase().functions.invoke("sync-transactions", { body: {} });
          await load();
        },
        signOut: async () => {
          await supabase().auth.signOut();
          router.replace("/welcome");
        },
      })}
    </>
  );
}
