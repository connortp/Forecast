"use client";

import { useEffect, useState } from "react";
import { events, outlook, today } from "@/lib/engine";
import { CONDITION_NAME, QUIPS, type Tone } from "@/lib/copy";
import { dayName, heroDate, longDate, money, shortDate } from "@/lib/format";
import { SCENARIOS, type ScenarioKey } from "@/lib/sample-data";
import { Sky, type TimeOfDay } from "./Sky";

type TimeSetting = TimeOfDay | "auto";
type Prefs = { scenario: ScenarioKey; tone: Tone; time: TimeSetting };
const PREFS_KEY = "forecast-prefs";

function currentTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  return h < 5 || h >= 21 ? "night" : h < 9 ? "dawn" : h < 17 ? "day" : "dusk";
}

const Mark = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M16 2.5v4M16 25.5v4M2.5 16h4M25.5 16h4M6.4 6.4l2.9 2.9M22.7 22.7l2.9 2.9M6.4 25.6l2.9-2.9M22.7 9.3l2.9-2.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export function ForecastApp() {
  const [prefs, setPrefs] = useState<Prefs>({ scenario: "partly", tone: "spicy", time: "auto" });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
      setPrefs((p) => ({ ...p, ...saved, scenario: saved.scenario in SCENARIOS ? saved.scenario : p.scenario }));
    } catch {}
  }, []);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const s = SCENARIOS[prefs.scenario].snapshot;
  const t = today(s);
  const days = outlook(s, 7);
  const tod = prefs.time === "auto" ? currentTimeOfDay() : prefs.time;
  const night = tod === "night";
  const upcoming = events(s, 0, t.until + 1).filter((e) => e.kind !== "save");
  const safeDaily = Math.max(0, t.daily);
  const perPaycheck = s.buckets.reduce((n, b) => n + b.perPaycheck, 0);
  const date = heroDate();
  const conditionName = night && t.condition === "sunny" ? "Clear night" : CONDITION_NAME[t.condition];
  const sub = t.pool < 0 ? `${money(-t.pool)} short until payday` : t.billCount ? `${money(t.bills)} in bills set aside` : "Bills covered until payday";
  const quip =
    t.pool < 0 && prefs.tone === "calm"
      ? `You're ${money(-t.pool)} short of covering bills before payday. Today stays at $0 until it lands.`
      : QUIPS[prefs.tone][t.condition];

  return (
    <main className="wrap">
      <section className="photo hero" aria-live="polite">
        <Sky condition={t.condition} timeOfDay={tod} />
        <nav className="nav" aria-label="Main">
          <span className="brand"><Mark />Forecast</span>
          <span className="label source">Example data</span>
        </nav>
        <div className="hero-body">
          <div className="hero-date">{date.weekday}, <em>{date.monthDay}</em></div>
          <div className="hero-num"><span className="c">$</span>{Math.round(t.safeToSpend).toLocaleString("en-US")}</div>
          <span className="label">Safe to spend today</span>
        </div>
        <a className="more" href="#details" aria-label="See the details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </a>
      </section>

      <section id="details" className="dark today">
        <div className="today-top">
          <div>
            <span className="label">Today&apos;s forecast</span>
            <div className="big">{conditionName}</div>
          </div>
          <div className="meta">
            <b>{t.until === 1 ? "Payday tomorrow" : `Payday in ${t.until} days`}</b>
            <span>{sub}</span>
          </div>
        </div>
        <div className="cells" aria-label="Safe to spend for the next 7 days">
          {days.map((d) => {
            const v = Math.max(0, d.daily);
            return (
              <div key={d.day} className={`cell${d.day === 0 ? " today" : ""}${d.payday ? " pay" : ""}${v === 0 ? " short" : ""}`}>
                <span className="d">{dayName(d.day)}</span>
                <span className="v">{d.payday ? "Pay" : money(v)}</span>
              </div>
            );
          })}
        </div>
        <p className="quip-line">{quip}</p>
      </section>

      <div className="pair">
        <section className="dark stage">
          <div className="ui-card">
            <div className="hd label"><span>Until payday</span><span>{shortDate(0)} – {shortDate(t.until)}</span></div>
            <div className="bd">
              <div className="row">
                <span className="who"><i className="dot now" />Left today</span>
                <span className="amt">{money(t.safeToSpend)}</span>
              </div>
              {upcoming.map((e, i) => (
                <div className="row" key={i}>
                  <span className="who"><i className={`dot ${e.kind === "pay" ? "in" : "out"}`} />{e.name}</span>
                  <span className="when">{dayName(e.day)}</span>
                  <span className={`amt${e.kind === "pay" ? " in" : ""}`}>{e.kind === "pay" ? "+" : "−"}{money(e.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="note">
            {t.billCount
              ? `${t.billCount} bill${t.billCount > 1 ? "s" : ""} land before your paycheck on ${longDate(t.until)}. They're already set aside.`
              : `Nothing due before your paycheck on ${longDate(t.until)}.`}
          </p>
        </section>

        <section className="dark stage">
          <div className="ui-card">
            <div className="hd label"><span>Savings, first</span><span>{money(s.buckets.reduce((n, b) => n + b.saved, 0))}</span></div>
            <div className="bd">
              {s.buckets.map((b) => (
                <div className="bucket" key={b.name}>
                  <div className="top"><span>{b.name}</span><span>{money(b.saved)} of {money(b.goal)}</span></div>
                  <div className="bar"><i style={{ width: `${(b.saved / b.goal) * 100}%` }} /></div>
                  <span className="when">+{money(b.perPaycheck)} each paycheck</span>
                </div>
              ))}
            </div>
          </div>
          <p className="note">{money(perPaycheck)} moves to savings from every paycheck before anything counts as spendable.</p>
        </section>
      </div>

      <section className="dark math">
        <div className="math-head">
          <h2>How today&apos;s number <em>is made.</em></h2>
          <p>Cash this morning, minus everything already spoken for, spread evenly until payday.</p>
        </div>
        <div className="eq">
          <div className="term"><span className="label">Cash</span><span className="v">{money(t.startCash)}</span></div>
          <div className="term"><span className="label"><span>Bills</span><b>{t.billCount}</b></span><span className="v">−{money(t.bills + t.saving)}</span></div>
          <div className="term"><span className="label">Cushion</span><span className="v">−{money(s.cushion)}</span></div>
          <div className="term"><span className="label"><span>Days left</span><b>÷</b></span><span className="v">{t.until}</span></div>
        </div>
        <div className="result">
          <span className="v">{money(t.safeToSpend)}</span>
          <p>
            That&apos;s <b>{money(safeDaily)} a day</b>
            {s.spentToday ? <>, less the <b>{money(s.spentToday)}</b> you&apos;ve spent so far today</> : null}. Your last 7 days averaged{" "}
            <b>{money(s.recentPace)} a day</b>, {s.recentPace > safeDaily ? "a little above" : "comfortably under"} that pace.
          </p>
        </div>
      </section>

      <section className="dark controls">
        <div className="scen">
          <span className="label">Example</span>
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.scenario === k} onClick={() => update({ scenario: k })}>{SCENARIOS[k].label}</button>
          ))}
        </div>
        <div className="scen">
          <span className="label">Sky</span>
          {(["auto", "dawn", "day", "dusk", "night"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.time === k} onClick={() => update({ time: k })}>{k === "auto" ? "Now" : k}</button>
          ))}
        </div>
        <div className="scen">
          <span className="label">Voice</span>
          {(["calm", "spicy"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.tone === k} onClick={() => update({ tone: k })}>{k}</button>
          ))}
        </div>
      </section>
      <footer className="foot">Prototype on example data. Nothing here is a real account.</footer>
    </main>
  );
}
