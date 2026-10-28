"use client";

import { useEffect, useState } from "react";
import { events, outlook, today, type Condition } from "@/lib/engine";
import { CONDITION_NAME, QUIPS, type Tone } from "@/lib/copy";
import { dayName, heroDate, longDate, money, shortDate } from "@/lib/format";
import { SCENARIOS, type ScenarioKey } from "@/lib/sample-data";
import { Sky, type TimeOfDay } from "./Sky";
import { WeatherIcon } from "./WeatherIcon";

type TimeSetting = TimeOfDay | "auto";
type Prefs = { scenario: ScenarioKey; tone: Tone; time: TimeSetting };
const PREFS_KEY = "forecast-prefs";

const BUCKET_COLORS = ["#8fe3b0", "#ffb38a", "#8db8ff", "#e4b5ff"];
const BAR_COLOR: Record<Condition, string> = { sunny: "#ffc65c", partly: "#ffe3a3", cloudy: "#c9d3e3", rain: "#8db8ff", storm: "#ff8d7a" };

function currentTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  return h < 5 || h >= 21 ? "night" : h < 9 ? "dawn" : h < 17 ? "day" : "dusk";
}

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
  const days = outlook(s, 10);
  const tod = prefs.time === "auto" ? currentTimeOfDay() : prefs.time;
  const night = tod === "night";
  const timeline = events(s, 0, t.until + 1).filter((e) => e.kind !== "save");
  const safeDaily = Math.max(0, t.daily);
  const outlookMax = Math.max(...days.map((d) => Math.max(0, d.daily)), s.typicalDay * 1.6);
  const paceScale = Math.max(s.recentPace, safeDaily) * 1.25 || 1;
  const perPaycheck = s.buckets.reduce((n, b) => n + b.perPaycheck, 0);

  const quip =
    t.pool < 0 && prefs.tone === "calm"
      ? `You're ${money(-t.pool)} short of covering bills before payday. Today stays at $0 until it lands.`
      : QUIPS[prefs.tone][t.condition];

  return (
    <>
      <Sky condition={t.condition} timeOfDay={tod} />

      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="10" r="5" fill="#ffc65c" /><path d="M7 19h11a3.6 3.6 0 0 0 .3-7.2A5 5 0 0 0 8.8 13 3 3 0 0 0 7 19Z" fill="#fff" /></svg>
          Forecast
        </div>
        <div className="tone" role="group" aria-label="Personality">
          {(["calm", "spicy"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={prefs.tone === k} onClick={() => update({ tone: k })}>
              {k === "calm" ? "Calm" : "Spicy"}
            </button>
          ))}
        </div>
      </header>

      <div className="app">
        <section className="hero" aria-live="polite">
          <div className="eyebrow"><span>Safe to spend</span><span className="sep" /><span>{heroDate()}</span></div>
          <div className="amount"><span className="cur">$</span><span>{Math.round(t.safeToSpend).toLocaleString("en-US")}</span></div>
          <div className="cond">
            <WeatherIcon condition={t.condition} night={night} />
            <span>{night && t.condition === "sunny" ? "Clear night" : CONDITION_NAME[t.condition]}</span>
          </div>
          <p className="quip">{quip}</p>
          <div className="stats">
            <div className="stat">Payday <b>{t.until === 1 ? "tomorrow" : `in ${t.until}d`}</b></div>
            <div className="stat">Bills ahead <b>{money(t.bills)}</b></div>
            <div className="stat">Spent today <b>{money(s.spentToday)}</b></div>
          </div>
        </section>

        <section className="sheet">
          <div className="grab" />
          <div className="stack">
            <article className="card">
              <h2>Until payday <em>{shortDate(0)} – {shortDate(t.until)}</em></h2>
              <p className="lede">
                {t.billCount ? (
                  <>{t.billCount} bill{t.billCount > 1 ? "s" : ""} worth <span className="n">{money(t.bills)}</span> land before your paycheck on {longDate(t.until)}. They&apos;re already set aside.</>
                ) : (
                  <>Nothing due before your paycheck on {longDate(t.until)}.</>
                )}
              </p>
              <div className="timeline">
                <div className="ev now">
                  <div className="when">Now</div>
                  <div className="node"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="#121826" /></svg></div>
                  <div className="amt">{money(t.safeToSpend)}</div>
                  <div className="what">left today</div>
                </div>
                {timeline.map((e, i) => (
                  <div key={i} className={`ev ${e.kind}`}>
                    <div className="when">{dayName(e.day)}</div>
                    <div className="node">
                      {e.kind === "pay" ? (
                        <svg viewBox="0 0 16 16" fill="none" stroke="#8fe3b0" strokeWidth="1.6" strokeLinecap="round"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
                      ) : (
                        <svg viewBox="0 0 16 16" fill="none" stroke="#f4f1ea" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M4 9l4 4 4-4" /></svg>
                      )}
                    </div>
                    <div className="amt">{e.kind === "pay" ? "+" : "−"}{money(e.amount)}</div>
                    <div className="what" title={e.name}>{e.name}</div>
                  </div>
                ))}
              </div>
            </article>

            <article className="card">
              <h2>10-day outlook <em>daily safe-to-spend</em></h2>
              <div className="days">
                {days.map((d) => {
                  const v = Math.max(0, d.daily);
                  return (
                    <div className="day" key={d.day}>
                      <div className="dn">{dayName(d.day)}{d.payday && <small>Payday</small>}</div>
                      <div className="ic" title={CONDITION_NAME[d.condition]}><WeatherIcon condition={d.condition} /></div>
                      <div className="track">
                        <span style={{ width: `${Math.max(2, (v / outlookMax) * 100)}%`, background: `linear-gradient(90deg, rgba(255,255,255,0.12), ${BAR_COLOR[d.condition]})` }} />
                        <i style={{ left: `${(s.typicalDay / outlookMax) * 100}%` }} />
                      </div>
                      <div className="val">{money(v)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="legend"><i />Your typical day, learned from 90 days</div>
            </article>

            <div className="grid2">
              <article className="card mini">
                <h2>Spending pace</h2>
                <div className="big">{money(s.recentPace)}/day</div>
                <div className="meter">
                  <span style={{ width: `${(s.recentPace / paceScale) * 100}%`, background: s.recentPace > safeDaily ? "var(--bad)" : "var(--good)" }} />
                  <i style={{ left: `${(safeDaily / paceScale) * 100}%` }} />
                </div>
                <div className="sub">Past 7 days, {s.recentPace > safeDaily ? "above" : "under"} the safe pace of {money(safeDaily)} (white mark).</div>
              </article>
              <article className="card mini">
                <h2>Cushion</h2>
                <div className="big">{money(s.cushion)}</div>
                <div className="sub">Held back so a surprise charge never overdraws you. Adjustable.</div>
              </article>
            </div>

            <article className="card">
              <h2>Sheltered <em>{money(s.buckets.reduce((n, b) => n + b.saved, 0))} saved</em></h2>
              <p className="lede"><span className="n">{money(perPaycheck)}</span> moves here from every paycheck before anything counts as spendable.</p>
              <div className="buckets">
                {s.buckets.map((b, i) => {
                  const p = b.saved / b.goal;
                  const C = 2 * Math.PI * 19;
                  return (
                    <div className="bucket" key={b.name}>
                      <svg className="ring" viewBox="0 0 48 48" aria-hidden="true">
                        <circle cx="24" cy="24" r="19" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                        <circle cx="24" cy="24" r="19" fill="none" stroke={BUCKET_COLORS[i % BUCKET_COLORS.length]} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 24 24)" />
                        <text x="24" y="28" textAnchor="middle" fontSize="11" fill="#f4f1ea" className="mono">{Math.round(p * 100)}%</text>
                      </svg>
                      <div>
                        <div className="nm">{b.name}<span>{money(b.saved)} / {money(b.goal)}</span></div>
                        <div className="meta">+{money(b.perPaycheck)} each paycheck · done in about {Math.ceil((b.goal - b.saved) / b.perPaycheck / 2)} months</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="card">
              <h2>How today&apos;s number is made</h2>
              <table className="math">
                <tbody>
                  <tr><td>Cash in checking this morning</td><td>{money(t.startCash)}</td></tr>
                  <tr><td>Bills before payday ({t.billCount})</td><td>−{money(t.bills)}</td></tr>
                  {t.saving > 0 && <tr><td>Savings due before payday</td><td>−{money(t.saving)}</td></tr>}
                  <tr><td>Cushion</td><td>−{money(s.cushion)}</td></tr>
                  <tr className="rule"><td>Spread over {t.until} day{t.until > 1 ? "s" : ""} until payday</td><td>{money(t.pool)}</td></tr>
                  <tr><td>Per day</td><td>{money(safeDaily)}</td></tr>
                  <tr><td>Spent so far today</td><td>{s.spentToday ? "−" : ""}{money(s.spentToday)}</td></tr>
                  <tr className="rule total"><td>Safe to spend today</td><td>{money(t.safeToSpend)}</td></tr>
                </tbody>
              </table>
            </article>

            <div className="demo">
              <p>Example data · try other conditions</p>
              <div className="seg" role="group" aria-label="Example scenarios">
                {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => (
                  <button key={k} type="button" aria-pressed={prefs.scenario === k} onClick={() => update({ scenario: k })}>{SCENARIOS[k].label}</button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Time of day">
                {(["auto", "dawn", "day", "dusk", "night"] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={prefs.time === k} onClick={() => update({ time: k })}>{k === "auto" ? "Now" : k[0].toUpperCase() + k.slice(1)}</button>
                ))}
              </div>
            </div>
            <p className="foot">Prototype with example transactions. Nothing here is real account data.</p>
          </div>
        </section>
      </div>
    </>
  );
}
