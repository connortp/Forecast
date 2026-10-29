"use client";

import { useEffect, useRef, useState } from "react";
import type { OutlookDay, Snapshot, Today } from "@/lib/engine";
import { events } from "@/lib/engine";
import { dayName, shortDate, money } from "@/lib/format";
import { cycle, splitToday } from "@/lib/details";

// Everything under the number, in the sign-up flow's language: one idea per card, a light serif
// headline with one italic word, and a drawn graphic that says it before the words do.
// apps/ios/Forecast/DetailsSheet.swift draws the same cards; keep the two in step.

export const Accent = ({ text }: { text: string }) => {
  const i = text.lastIndexOf(" ");
  return i < 0 ? <em>{text}</em> : <>{text.slice(0, i + 1)}<em>{text.slice(i + 1)}</em></>;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The opening: today's weather, the quip as the headline, and three readings. */
export function TodayCard({ s, t, condition, quip }: { s: Snapshot; t: Today; condition: string; quip: string }) {
  return (
    <section className="dt-intro">
      <span className="label eyebrow">Today&apos;s forecast · {condition}</span>
      <h2 className="dt-quip"><Accent text={quip.replace(/\.$/, "")} />.</h2>
      <div className="glass dt-readings">
        <div><span className="label">Payday</span><b>{t.until === 1 ? "Tomorrow" : `${t.until} days`}</b></div>
        <div><span className="label">{t.pool < 0 ? "Short" : "Bills held"}</span><b>{money(t.pool < 0 ? -t.pool : t.bills)}</b></div>
        <div><span className="label">Spent today</span><b>{money(s.spentToday)}</b></div>
      </div>
    </section>
  );
}

/**
 * The pay cycle as a sun path: the arc runs from the last paycheck to the next, the sun sits on
 * today, and every bill before payday is a mark on the way.
 */
export function CycleCard({ s, t }: { s: Snapshot; t: Today }) {
  const c = cycle(s, t);
  const upcoming = events(s, 0, t.until + 1).filter((e) => e.kind !== "save");
  const W = 320, H = 150, R = 130, cx = W / 2, cy = H - 6;
  const at = (p: number) => {
    const a = Math.PI * (1 - p);
    return [cx + R * Math.cos(a), cy - R * Math.sin(a)] as const;
  };
  const [sx, sy] = at(c.today);
  const arc = (p: number) => {
    const [x, y] = at(p);
    return `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  return (
    <section className="glass card">
      <span className="label eyebrow">Pay cycle · {shortDate(-c.since)} – {shortDate(t.until)}</span>
      <h2>{t.until === 1 ? <>Payday is <em>tomorrow</em>.</> : <>{plural(t.until, "day")} to <em>payday</em>.</>}</h2>
      <svg className="dt-arc" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Day ${c.since + 1} of a ${s.paycheck.every}-day pay cycle, ${plural(t.billCount, "bill")} before payday`}>
        <defs>
          <radialGradient id="dt-sun">
            <stop offset="0" stopColor="#FFE7A8" />
            <stop offset=".35" stopColor="#FFC65C" stopOpacity=".55" />
            <stop offset="1" stopColor="#FFC65C" stopOpacity="0" />
          </radialGradient>
        </defs>
        <line x1="6" x2={W - 6} y1={cy} y2={cy} className="dt-horizon" />
        <path d={arc(1)} className="dt-track" />
        <path d={arc(c.today)} className="dt-done" />
        {c.marks.map((m, i) => {
          const [x, y] = at(m.p);
          return <circle key={i} cx={x} cy={y} r="4.5" className={m.kind === "pay" ? "dt-mark pay" : "dt-mark"} />;
        })}
        <circle cx={sx} cy={sy} r="26" fill="url(#dt-sun)" />
        <circle cx={sx} cy={sy} r="7" className="dt-sun" />
      </svg>
      <div className="dt-ends"><span>Last paycheck<br />{shortDate(-c.since)}</span><span>Next paycheck<br />{shortDate(t.until)}</span></div>
      <div className="list">
        {upcoming.map((e, i) => (
          <div className="row" key={i}>
            <span className="nm"><i className={`dot${e.kind === "pay" ? " pay" : ""}`} />{e.name}<small>{dayName(e.day)} · {shortDate(e.day)}</small></span>
            <span className={`amt${e.kind === "pay" ? " in" : ""}`}>{e.kind === "pay" ? "+" : "−"}{money(e.amount)}</span>
          </div>
        ))}
      </div>
      <p className="fine">{t.billCount ? "Bills before payday are already set aside, so they never show up as spendable." : "Nothing is due before payday."}</p>
    </section>
  );
}

/** Ten days of safe-to-spend, drawn like an hourly temperature curve. */
export function OutlookCard({ s, days }: { s: Snapshot; days: OutlookDay[] }) {
  // Drawn at the card's real width so the labels stay label-sized on a wide window.
  const [ref, width] = useWidth(320);
  const W = width, H = 150, top = 22, bottom = 118, left = 6, right = W - 6;
  const vals = days.map((d) => Math.max(0, d.daily));
  const max = Math.max(...vals, s.typicalDay * 1.25, 1);
  const x = (i: number) => left + ((right - left) * i) / (days.length - 1);
  const y = (v: number) => bottom - ((bottom - top) * v) / max;
  const pts = vals.map((v, i) => [x(i), y(v)] as const);
  const line = smooth(pts);
  const area = `${line} L ${right} ${bottom} L ${left} ${bottom} Z`;
  const typical = y(s.typicalDay);
  const low = days.reduce((a, d) => (Math.max(0, d.daily) < Math.max(0, a.daily) ? d : a), days[0]);
  const pay = days.find((d) => d.payday);
  const headline = pay && Math.max(0, pay.daily) > vals[0] * 1.3
    ? <>Clearing on <em>{dayName(pay.day) === "Tmrw" ? "tomorrow" : longDay(pay.day)}</em>.</>
    : vals.every((v) => v >= s.typicalDay) ? <>Fair all <em>week</em>.</> : <>Lowest on <em>{longDay(low.day)}</em>.</>;
  return (
    <section className="glass card">
      <span className="label eyebrow">10-day outlook · safe to spend a day</span>
      <h2>{headline}</h2>
      <svg ref={ref} className="dt-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={days.map((d, i) => `${dayName(d.day)} ${money(vals[i])}`).join(", ")}>
        <defs>
          <linearGradient id="dt-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".22" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {days.map((d, i) => d.payday && (
          <g key={d.day}>
            <line x1={x(i)} x2={x(i)} y1={top - 10} y2={bottom} className="dt-pay" />
            <text x={x(i)} y={top - 13} className="dt-tag pay" textAnchor="middle">PAY</text>
          </g>
        ))}
        <line x1={left} x2={right} y1={typical} y2={typical} className="dt-typical" />
        <text x={right} y={typical - 6} className="dt-tag" textAnchor="end">TYPICAL DAY {money(s.typicalDay)}</text>
        <path d={area} fill="url(#dt-fill)" />
        <path d={line} className="dt-line" />
        <circle cx={pts[0][0]} cy={pts[0][1]} r="4.5" className="dt-now" />
        {days.map((d, i) => (
          <text key={d.day} x={x(i)} y={H - 4} className={`dt-day${i === 0 ? " now" : ""}`} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
            {i === 0 ? "Now" : i % 2 === 0 || d.payday ? dayName(d.day).slice(0, 3) : ""}
          </text>
        ))}
      </svg>
      <div className="dt-scale">
        <span><b>{money(vals[0])}</b> today</span>
        <span><b>{money(Math.max(...vals))}</b> best day</span>
        <span><b>{money(low.daily > 0 ? low.daily : 0)}</b> lowest</span>
      </div>
    </section>
  );
}

/** Where this morning's cash goes, as one bar split into its parts. */
export function MathCard({ s, t }: { s: Snapshot; t: Today }) {
  const parts = splitToday(s, t);
  const total = Math.max(t.startCash, parts.reduce((n, p) => n + p.amount, 0), 1);
  return (
    <section className="glass card">
      <span className="label eyebrow">The math</span>
      <h2>How today&apos;s number is <em>made</em>.</h2>
      <p>{money(t.startCash)} in checking this morning, split {t.pool < 0 ? "and it doesn't cover everything" : "before anything counts as spendable"}.</p>
      <div className="dt-split" role="img" aria-label={parts.map((p) => `${p.label} ${money(p.amount)}`).join(", ")}>
        {parts.map((p) => p.amount > 0 && <i key={p.key} className={`seg ${p.key}`} style={{ flexGrow: p.amount / total }} />)}
        {t.pool < 0 && <b className="dt-cashline" style={{ left: `${(t.startCash / total) * 100}%` }} />}
      </div>
      <div className="kv">
        {parts.map((p) => (
          <div key={p.key}><span><i className={`sw ${p.key}`} />{p.label}</span><span>{money(p.amount)}</span></div>
        ))}
      </div>
      <div className="total"><span className="label">Safe to spend today</span><b>{money(t.safeToSpend)}</b></div>
      {s.spentToday > 0 && <p className="fine">{money(Math.max(0, t.daily))} for today, less the {money(s.spentToday)} you&apos;ve already spent.</p>}
    </section>
  );
}

/** Savings buckets as rings, filled toward each goal. */
export function SavingsCard({ s }: { s: Snapshot }) {
  const per = s.buckets.reduce((n, b) => n + b.perPaycheck, 0);
  const saved = s.buckets.reduce((n, b) => n + b.saved, 0);
  return (
    <section className="glass card">
      <span className="label eyebrow">Savings · {money(saved)} put away</span>
      <h2>Pay yourself <em>first</em>.</h2>
      <p>{money(per)} leaves every paycheck before anything looks spendable.</p>
      <div className="dt-rings">
        {s.buckets.map((b, i) => {
          const p = b.goal > 0 ? Math.min(1, b.saved / b.goal) : 0;
          const r = 34, len = 2 * Math.PI * r;
          return (
            <figure key={b.name}>
              <svg viewBox="0 0 84 84" aria-hidden="true">
                <circle cx="42" cy="42" r={r} className="ring-track" />
                <circle cx="42" cy="42" r={r} className={`ring c${i % 4}`} strokeDasharray={`${(len * p).toFixed(1)} ${len.toFixed(1)}`} transform="rotate(-90 42 42)" />
                <text x="42" y="48" textAnchor="middle" className="ring-pct">{Math.round(p * 100)}%</text>
              </svg>
              <figcaption><span>{b.name}</span><small>{money(b.saved)} of {money(b.goal)}</small></figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

/** Two small tiles: last week's pace against today's safe pace, and the cushion. */
export function Tiles({ s, t }: { s: Snapshot; t: Today }) {
  const safe = Math.max(0, t.daily);
  const scale = Math.max(s.recentPace, safe, 1) * 1.3;
  const over = s.recentPace > safe;
  // A half-dial: the needle is last week's pace, the tick is today's safe pace.
  const pt = (v: number, r: number) => {
    const a = Math.PI * (1 - Math.min(1, v / scale));
    return [50 + r * Math.cos(a), 54 - r * Math.sin(a)];
  };
  const [nx, ny] = pt(s.recentPace, 34);
  const [t1x, t1y] = pt(safe, 36), [t2x, t2y] = pt(safe, 48);
  return (
    <div className="dt-tiles">
      <section className="glass card tile">
        <span className="label eyebrow">Spending pace</span>
        <svg viewBox="0 0 100 60" className="dt-dial" aria-hidden="true">
          <path d="M 8 54 A 42 42 0 0 1 92 54" className="dial-track" />
          <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} className="dial-safe" />
          <line x1="50" y1="54" x2={nx} y2={ny} className={`dial-needle${over ? " over" : ""}`} />
          <circle cx="50" cy="54" r="3" className="dial-hub" />
        </svg>
        <b className="tile-num">{money(s.recentPace)}<small>/day</small></b>
        <p className="fine">Last 7 days, {over ? "above" : "under"} today&apos;s safe pace of {money(safe)}.</p>
      </section>
      <section className="glass card tile">
        <span className="label eyebrow">Cushion</span>
        <svg viewBox="0 0 100 60" className="dt-dial" aria-hidden="true">
          {/* An umbrella: the cushion is what keeps a surprise charge off you. */}
          <path d="M 18 34 Q 50 -2 82 34 Q 74 29 66 34 Q 58 29 50 34 Q 42 29 34 34 Q 26 29 18 34 Z" className="umbrella" />
          <path d="M 50 34 V 52 Q 50 57 45 57 Q 41 57 41 53" className="umbrella-stem" />
        </svg>
        <b className="tile-num">{money(s.cushion)}</b>
        <p className="fine">Held back so a surprise charge never overdraws you.</p>
      </section>
    </div>
  );
}

function useWidth(initial: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const longDay = (d: number) => (d === 0 ? "today" : new Date(Date.now() + d * 864e5).toLocaleDateString("en-US", { weekday: "long" }));

/** A smooth curve through the points that never overshoots (monotone cubic). */
function smooth(p: readonly (readonly [number, number])[]): string {
  const n = p.length;
  const d = p.slice(0, -1).map((q, i) => (p[i + 1][1] - q[1]) / (p[i + 1][0] - q[0]));
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  let out = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    out += ` C ${(p[i][0] + h).toFixed(1)} ${(p[i][1] + m[i] * h).toFixed(1)}, ${(p[i + 1][0] - h).toFixed(1)} ${(p[i + 1][1] - m[i + 1] * h).toFixed(1)}, ${p[i + 1][0].toFixed(1)} ${p[i + 1][1].toFixed(1)}`;
  }
  return out;
}
