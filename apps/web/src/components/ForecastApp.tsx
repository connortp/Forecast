"use client";

import { useEffect, useState } from "react";
import { outlook, today } from "@/lib/engine";
import { CycleCard, MathCard, OutlookCard, SavingsCard, Tiles, TodayCard } from "./Details";
import { CONDITION_NAME, QUIPS, type Tone } from "@/lib/copy";
import { heroDate, money } from "@/lib/format";
import { SCENARIOS, type ScenarioKey } from "@/lib/sample-data";
import { Sky, type TimeOfDay } from "./Sky";
import type { Live } from "./onboarding/Gate";
import { PLAID_SANDBOX } from "@/lib/supabase";

type TimeSetting = TimeOfDay | "auto";
type Prefs = { scenario: ScenarioKey; tone: Tone; time: TimeSetting };
const PREFS_KEY = "forecast-prefs";

function currentTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  return h < 5 || h >= 21 ? "night" : h < 9 ? "dawn" : h < 17 ? "day" : "dusk";
}

const Mark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
  </svg>
);

function Chips<K extends string>({ label, items, value, onPick }: { label: string; items: [K, string][]; value: K; onPick: (k: K) => void }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map(([k, text]) => (
        <button key={k} type="button" className="chip" aria-pressed={value === k} onClick={() => onPick(k)}>{text}</button>
      ))}
    </div>
  );
}

export function ForecastApp({ live }: { live: Live | null }) {
  const [prefs, setPrefs] = useState<Prefs>({ scenario: "partly", tone: "spicy", time: "auto" });
  const [scrolled, setScrolled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
      setPrefs((p) => ({ ...p, ...saved, scenario: saved.scenario in SCENARIOS ? saved.scenario : p.scenario }));
    } catch {}
  }, []);
  // Past the hero, the sky softens behind the cards, like the sign-up flow.
  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > innerHeight * 0.35);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const s = live?.snapshot ?? SCENARIOS[prefs.scenario].snapshot;
  const t = today(s);
  const days = outlook(s, 10);
  const tod = prefs.time === "auto" ? currentTimeOfDay() : prefs.time;
  const night = tod === "night";
  const date = heroDate();
  const conditionName = night && t.condition === "sunny" ? "Clear night" : CONDITION_NAME[t.condition];
  const quip =
    t.pool < 0 && prefs.tone === "calm"
      ? `You're ${money(-t.pool)} short of covering bills before payday. Today stays at $0 until it lands.`
      : QUIPS[prefs.tone][t.condition];

  return (
    <div className="app">
      <Sky condition={t.condition} timeOfDay={tod} dim={scrolled} />

      <header className="top">
        <span className="brand"><Mark />Forecast</span>
        {(!live || PLAID_SANDBOX) && <span className="label pill">{live ? "Sandbox bank" : "Example data"}</span>}
      </header>

      <section className="hero" aria-live="polite">
        <span className="label">{date.weekday}, {date.monthDay}</span>
        <div className="num"><span className="c">$</span>{Math.round(t.safeToSpend).toLocaleString("en-US")}</div>
        <span className="label">Safe to spend</span>
        <a className="more" href="#details" aria-label="See the details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </a>
      </section>

      <main className="sheet" id="details">
        <TodayCard s={s} t={t} condition={conditionName} quip={quip} />
        <CycleCard s={s} t={t} />
        <OutlookCard s={s} days={days} />
        <MathCard s={s} t={t} />
        <SavingsCard s={s} />
        <Tiles s={s} t={t} />

        <section className="glass card demo">
          <span className="label eyebrow">{live ? "Settings" : "Try other skies"}</span>
          {!live && (
            <Chips label="Example scenarios" value={prefs.scenario} onPick={(k) => update({ scenario: k })}
              items={(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => [k, SCENARIOS[k].label])} />
          )}
          <Chips label="Time of day" value={prefs.time} onPick={(k) => update({ time: k })}
            items={[["auto", "Now"], ["dawn", "Dawn"], ["day", "Day"], ["dusk", "Dusk"], ["night", "Night"]]} />
          <Chips label="Voice" value={prefs.tone} onPick={(k) => update({ tone: k })}
            items={[["calm", "Calm voice"], ["spicy", "Spicy voice"]]} />
        </section>

        {live ? (
          <div className="chips foot" role="group" aria-label="Account">
            <button type="button" className="chip" disabled={refreshing}
              onClick={async () => { setRefreshing(true); try { await live.refresh(); } finally { setRefreshing(false); } }}>
              {refreshing ? "Refreshing…" : "Refresh from bank"}
            </button>
            <button type="button" className="chip" onClick={live.signOut}>Sign out</button>
          </div>
        ) : (
          <p className="fine foot">Prototype on example data. Nothing here is a real account.</p>
        )}
      </main>
    </div>
  );
}
