"use client";

import { useEffect, useState } from "react";
import { events, outlook, today } from "@/lib/engine";
import { CONDITION_NAME, QUIPS, type Tone } from "@/lib/copy";
import { dayName, heroDate, longDate, money, shortDate } from "@/lib/format";
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

// Serif headline with its last word in italic, the way the site and sign-up flow set them.
const Accent = ({ text }: { text: string }) => {
  const i = text.lastIndexOf(" ");
  return i < 0 ? <em>{text}</em> : <>{text.slice(0, i + 1)}<em>{text.slice(i + 1)}</em></>;
};

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
  const days = outlook(s, 7);
  const tod = prefs.time === "auto" ? currentTimeOfDay() : prefs.time;
  const night = tod === "night";
  const upcoming = events(s, 0, t.until + 1).filter((e) => e.kind !== "save");
  const bills = upcoming.filter((e) => e.kind === "bill");
  const safeDaily = Math.max(0, t.daily);
  const perPaycheck = s.buckets.reduce((n, b) => n + b.perPaycheck, 0);
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
        <section className="glass card">
          <span className="label eyebrow">Today&apos;s forecast</span>
          <h2><Accent text={conditionName} /></h2>
          <p className="quip">{quip}</p>
          <div className="days" aria-label="Safe to spend for the next 7 days">
            {days.map((d) => {
              const v = Math.max(0, d.daily);
              return (
                <span key={d.day} className={`${d.day === 0 ? "now" : ""}${d.payday ? " pay" : ""}${v === 0 ? " short" : ""}`}>
                  <i>{dayName(d.day)}</i>
                  {d.payday ? "Pay" : money(v)}
                </span>
              );
            })}
          </div>
          <div className="kv">
            <div><span>Next paycheck</span><span>{t.until === 1 ? "Tomorrow" : `${longDate(t.until).split(",")[0]}, in ${t.until} days`}</span></div>
            <div><span>{t.pool < 0 ? "Short until payday" : "Held for bills"}</span><span>{money(t.pool < 0 ? -t.pool : t.bills)}</span></div>
            <div><span>Spent so far today</span><span>{money(s.spentToday)}</span></div>
          </div>
        </section>

        <section className="glass card">
          <span className="label eyebrow">Until payday · {shortDate(0)} – {shortDate(t.until)}</span>
          <h2>{bills.length ? <>{bills.length} bill{bills.length > 1 ? "s" : ""} before <em>payday</em>.</> : <>Nothing due before <em>payday</em>.</>}</h2>
          <p>Already set aside, so they never show up as spendable.</p>
          <div className="list">
            {upcoming.map((e, i) => (
              <div className="row" key={i}>
                <span className="nm">{e.name}<small>{dayName(e.day)} · {shortDate(e.day)}</small></span>
                <span className={`amt${e.kind === "pay" ? " in" : ""}`}>{e.kind === "pay" ? "+" : "−"}{money(e.amount)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="glass card">
          <span className="label eyebrow">Savings</span>
          <h2>Pay yourself <em>first</em>.</h2>
          <p>{money(perPaycheck)} leaves every paycheck before anything looks spendable.</p>
          <div className="list">
            {s.buckets.map((b) => (
              <div className="bucket" key={b.name}>
                <span className="nm">{b.name}<small>+{money(b.perPaycheck)} each paycheck</small></span>
                <span className="amt">{money(b.saved)}<small>of {money(b.goal)}</small></span>
                <div className="bar"><i style={{ width: `${b.goal > 0 ? Math.min(100, (b.saved / b.goal) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass card">
          <span className="label eyebrow">The math</span>
          <h2>How today&apos;s number is <em>made</em>.</h2>
          <div className="kv">
            <div><span>Cash this morning</span><span>{money(t.startCash)}</span></div>
            <div><span>Bills before payday ({t.billCount})</span><span>−{money(t.bills)}</span></div>
            {t.saving > 0 && <div><span>Savings due before payday</span><span>−{money(t.saving)}</span></div>}
            <div><span>Cushion</span><span>−{money(s.cushion)}</span></div>
            <div><span>Spread over {t.until} day{t.until > 1 ? "s" : ""}</span><span>{money(safeDaily)} a day</span></div>
            <div><span>Spent so far today</span><span>−{money(s.spentToday)}</span></div>
          </div>
          <div className="total"><span className="label">Safe to spend today</span><b>{money(t.safeToSpend)}</b></div>
          <p className="fine">
            Your last 7 days averaged {money(s.recentPace)} a day, {s.recentPace > safeDaily ? "a little above" : "comfortably under"} that pace.
          </p>
        </section>

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
