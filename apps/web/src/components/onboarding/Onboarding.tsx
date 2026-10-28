"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { today } from "@/lib/engine";
import { heroDate, money, shortDate } from "@/lib/format";
import { CADENCES, EXAMPLE, initialChoices, snapshotFrom, type Choices } from "./example";
import { saveOnboarding, type Saved } from "./progress";
import "./onboarding.css";

type Step = "welcome" | "email" | "code" | "bank" | "reading" | "payday" | "bills" | "savings" | "reveal";

// Five stages on the progress bar; the welcome and the reveal sit outside it.
const STAGE: Record<Step, number> = { welcome: -1, email: 0, code: 0, bank: 1, reading: 1, payday: 2, bills: 3, savings: 4, reveal: 5 };
const READING = [`Balances from ${EXAMPLE.bank}`, `${EXAMPLE.transactions.toLocaleString("en-US")} transactions`, "Finding your paydays", "Finding your bills"];

const cents = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [trail, setTrail] = useState<Step[]>([]);
  const [method, setMethod] = useState<Saved["method"]>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sheet, setSheet] = useState<"closed" | "banks" | "accounts">("closed");
  const [accounts, setAccounts] = useState(EXAMPLE.accounts.map((a) => a.on));
  const [readIdx, setReadIdx] = useState(0);
  const [c, setC] = useState<Choices>(initialChoices);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const t = useMemo(() => today(snapshotFrom(c)), [c]);
  const safe = Math.round(t.safeToSpend);

  const go = (next: Step) => {
    setTrail((tr) => [...tr, step]);
    setStep(next);
  };
  const back = () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    setTrail(trail.slice(0, -1));
    setStep(prev === "reading" ? "bank" : prev);
  };

  // Move focus to each new screen's heading, except where a field takes it.
  useEffect(() => {
    if (step !== "email" && step !== "code") headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // "Reading your sky": tick through the checks, then move on.
  useEffect(() => {
    if (step !== "reading") return;
    setReadIdx(0);
    const ms = reduceMotion() ? 350 : 750;
    const timers = READING.map((_, i) => setTimeout(() => setReadIdx(i + 1), ms * (i + 1)));
    timers.push(setTimeout(() => go("payday"), ms * (READING.length + 1)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const signIn = (m: NonNullable<Saved["method"]>) => {
    setMethod(m);
    // Apple and Google create the account in one tap; email goes through a code.
    go(m === "email" ? "email" : "bank");
  };

  const finish = () => {
    saveOnboarding({ done: true, method });
    router.push("/");
  };

  const sky = step === "welcome" ? "video" : step === "reveal" ? "reveal" : "flow";
  const stage = STAGE[step];
  const chrome = stage >= 0 && stage < 5;

  const heldBills = c.billsOn.filter(Boolean).length;
  const billTotal = EXAMPLE.bills.reduce((n, b, i) => n + (c.billsOn[i] ? b.amount : 0), 0);
  const cadence = CADENCES.find((x) => x.every === c.every) ?? CADENCES[1];
  const paydays = Array.from({ length: 7 }, (_, i) => shortDate(EXAMPLE.paycheck.nextIn + i * c.every));

  return (
    <div className="ob">
      <div className="ob-sky" aria-hidden="true">
        <video
          className={`ob-layer ${sky === "video" ? "on" : ""}`}
          src="/sky/clouds.mp4"
          poster="/sky/clouds-poster.jpg"
          autoPlay={!reduceMotion()}
          muted
          loop
          playsInline
        />
        <div className={`ob-layer ob-dim ${sky === "flow" ? "on" : ""}`} style={{ backgroundImage: "url(/sky/dawn.jpg)" }} />
        <div className={`ob-layer ${sky === "reveal" ? "on" : ""}`} style={{ backgroundImage: "url(/sky/partly.jpg)" }} />
        <div className={`ob-shade ${sky === "reveal" ? "light" : ""}`} />
      </div>

      <div className="ob-col">
        <div className={`ob-top ${chrome ? "" : "off"}`}>
          <button className="ob-back" onClick={back} disabled={step === "reading" || !trail.length} aria-label="Back">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2 4 7l5 5" /></svg>
          </button>
          <div className="ob-bars" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={Math.max(1, stage + 1)} aria-label="Sign-up progress">
            {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i <= stage ? "on" : ""} />)}
          </div>
        </div>

        {step === "welcome" && (
          <section className="ob-view ob-welcome" key="welcome">
            <div className="ob-brand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></svg>
              Forecast
            </div>
            <div className="ob-grow" />
            <h1 ref={headingRef} tabIndex={-1}>One number, <em>every</em> morning.</h1>
            <p>What you can safely spend today, after bills and savings, until your next paycheck.</p>
            <div className="ob-actions">
              <button className="ob-btn" onClick={() => signIn("google")}><GoogleMark />Continue with Google</button>
              <button className="ob-btn ghost" onClick={() => signIn("apple")}><AppleMark />Continue with Apple</button>
              <button className="ob-btn text" onClick={() => signIn("email")}>Use email instead</button>
            </div>
            <p className="ob-fine">Already have an account? The same buttons sign you in.</p>
          </section>
        )}

        {step === "email" && (
          <form className="ob-view" key="email" onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) go("code"); }}>
            <span className="ob-label">Create your account</span>
            <h2 ref={headingRef} tabIndex={-1}>What&apos;s your <em>email</em>?</h2>
            <p>We&apos;ll send a six-digit code. No password to remember.</p>
            <div className="ob-field">
              <label className="ob-label" htmlFor="ob-email">Email</label>
              <input className="ob-input" id="ob-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" type="submit" disabled={!email.includes("@")}>Send code</button></div>
          </form>
        )}

        {step === "code" && (
          <form className="ob-view" key="code" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) go("bank"); }}>
            <span className="ob-label">Create your account</span>
            <h2 ref={headingRef} tabIndex={-1}>Check your <em>inbox</em>.</h2>
            <p>We sent a code to {email}. Any six digits work in this preview.</p>
            <label className="ob-code">
              <span className="sr-only">Six-digit code</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus />
              {Array.from({ length: 6 }, (_, i) => <span key={i} className={i === code.length ? "cur" : ""}>{code[i] ?? ""}</span>)}
            </label>
            <button type="button" className="ob-btn text left" onClick={() => setCode("")}>Resend code</button>
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" type="submit" disabled={code.length !== 6}>Verify</button></div>
          </form>
        )}

        {step === "bank" && (
          <section className="ob-view" key="bank">
            <span className="ob-label">Connect your bank</span>
            <h2 ref={headingRef} tabIndex={-1}>Where does your <em>paycheck</em> land?</h2>
            <p>Connect that checking account. Add cards and other banks later.</p>
            <div className="ob-glass ob-trust">
              <div><LockIcon /><span>Read-only. Forecast can see balances and transactions, never move money.</span></div>
              <div><CheckIcon /><span>You sign in with your bank through Plaid. We never see your bank password.</span></div>
              <div><ListIcon /><span>Disconnect any time in Settings, and your bank data is deleted.</span></div>
            </div>
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" onClick={() => setSheet("banks")}>Connect bank</button></div>
          </section>
        )}

        {step === "reading" && (
          <section className="ob-view ob-center" key="reading" aria-live="polite">
            <span className="ob-label">Reading your sky</span>
            <h2 ref={headingRef} tabIndex={-1}>Looking at your last <em>90 days</em>.</h2>
            <div className="ob-steps">
              {READING.map((r, i) => <div key={r} className={i < readIdx ? "done" : i === readIdx ? "run" : ""}><b />{r}</div>)}
            </div>
            <p className="ob-fine left">Usually under 30 seconds. You can close this; we&apos;ll email you when it&apos;s ready.</p>
          </section>
        )}

        {step === "payday" && (
          <section className="ob-view" key="payday">
            <span className="ob-label">Your paydays</span>
            <h2 ref={headingRef} tabIndex={-1}>Looks like you&apos;re paid <em>{cadence.label}</em>.</h2>
            <div className="ob-glass ob-card">
              <span className="ob-label dim">{EXAMPLE.employer}</span>
              <div className="ob-between"><span className="ob-big">{money(EXAMPLE.paycheck.amount)}</span><span className="ob-note">after tax</span></div>
              <div className="ob-dates">
                {paydays.map((d, i) => { const [m, day] = d.split(" "); return <span key={d} className={i === 0 ? "pay" : ""}><i>{m.toUpperCase()}</i>{day}</span>; })}
              </div>
            </div>
            <div className="ob-chips" role="radiogroup" aria-label="How often you're paid">
              {CADENCES.map((x) => (
                <button key={x.every} role="radio" aria-checked={x.every === c.every} className={`ob-chip ${x.every === c.every ? "on" : ""}`} onClick={() => setC({ ...c, every: x.every })}>{x.chip}</button>
              ))}
            </div>
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" onClick={() => go("bills")}>That&apos;s right</button></div>
          </section>
        )}

        {step === "bills" && (
          <section className="ob-view" key="bills">
            <span className="ob-label">Your bills</span>
            <h2 ref={headingRef} tabIndex={-1}>These come out <em>before</em> payday.</h2>
            <p>Turn off anything that isn&apos;t a real bill.</p>
            <div className="ob-glass ob-list">
              {EXAMPLE.bills.map((b, i) => (
                <div key={b.name} className={`ob-row ${c.billsOn[i] ? "" : "off"}`}>
                  <span className="nm">{b.name}<small>{[shortDate(b.dueIn), b.payee].filter(Boolean).join(" · ")}</small></span>
                  <span className="amt">{cents(b.amount)}</span>
                  <button
                    className="ob-tog" role="switch" aria-checked={c.billsOn[i]} aria-label={`Count ${b.name}`}
                    onClick={() => setC({ ...c, billsOn: c.billsOn.map((v, j) => (j === i ? !v : v)) })}
                  />
                </div>
              ))}
            </div>
            <div className="ob-between ob-total"><span className="ob-label dim">Held for bills</span><b>{cents(Math.round(billTotal * 100) / 100)}</b></div>
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" onClick={() => go("savings")}>Looks right</button></div>
          </section>
        )}

        {step === "savings" && (
          <section className="ob-view" key="savings">
            <span className="ob-label">Savings</span>
            <h2 ref={headingRef} tabIndex={-1}>Pay yourself <em>first</em>.</h2>
            <p>Set aside from each paycheck before anything looks spendable. Starts with your {shortDate(EXAMPLE.paycheck.nextIn)} paycheck.</p>
            <div className="ob-glass ob-list">
              {c.buckets.map((b, i) => (
                <div key={b.name} className="ob-bucket">
                  <span className="nm">{b.name}<small>Goal {money(b.goal)} · per paycheck</small></span>
                  <span className="ob-stepper">
                    <button aria-label={`Less to ${b.name}`} onClick={() => setC({ ...c, buckets: c.buckets.map((x, j) => (j === i ? { ...x, perPaycheck: Math.max(0, x.perPaycheck - 10) } : x)) })}>−</button>
                    <b>{money(b.perPaycheck)}</b>
                    <button aria-label={`More to ${b.name}`} onClick={() => setC({ ...c, buckets: c.buckets.map((x, j) => (j === i ? { ...x, perPaycheck: x.perPaycheck + 10 } : x)) })}>+</button>
                  </span>
                </div>
              ))}
            </div>
            <div className="ob-glass ob-cushion">
              <div className="ob-between"><label className="ob-label dim" htmlFor="ob-cushion">Cushion</label><b>{money(c.cushion)}</b></div>
              <input id="ob-cushion" type="range" min={0} max={500} step={25} value={c.cushion} onChange={(e) => setC({ ...c, cushion: +e.target.value })} />
              <p>Always kept back, so a surprise charge doesn&apos;t turn into an overdraft.</p>
            </div>
            <div className="ob-grow" />
            <div className="ob-actions">
              <button className="ob-btn" onClick={() => go("reveal")}>Continue</button>
              <button className="ob-btn text" onClick={() => { setC({ ...c, buckets: c.buckets.map((b) => ({ ...b, perPaycheck: 0 })) }); go("reveal"); }}>Skip savings for now</button>
            </div>
          </section>
        )}

        {step === "reveal" && <Reveal key="reveal" value={safe} headingRef={headingRef} bills={heldBills} billTotal={billTotal} cushion={c.cushion} payday={shortDate(t.until)} short={t.pool < 0 ? -t.pool : 0} onDone={finish} />}
      </div>

      <div className={`ob-sheet-wrap ${sheet !== "closed" ? "on" : ""}`} aria-hidden={sheet === "closed"} onClick={(e) => e.target === e.currentTarget && setSheet("closed")}>
        <div className="ob-sheet" role="dialog" aria-label="Connect your bank">
          {sheet === "banks" && (
            <>
              <div className="ob-sh-top"><span>Bank connection · preview</span><button onClick={() => setSheet("closed")} aria-label="Close">×</button></div>
              <h3>Select your bank</h3>
              <div className="ob-search">Plaid&apos;s bank search opens here</div>
              <div className="ob-banks">
                {[["Harbor Federal", "#1f4e79"], ["Northline Bank", "#2e6b4f"], ["Summit Credit Union", "#7a3b2e"], ["First Meridian", "#4b3f72"]].map(([n, col]) => (
                  <button key={n} onClick={() => setSheet("accounts")}><i style={{ background: col }}>{n[0]}</i>{n}</button>
                ))}
              </div>
              <p className="ob-sh-note">Sign-in happens on your bank&apos;s own screen.</p>
            </>
          )}
          {sheet === "accounts" && (
            <>
              <div className="ob-sh-top"><span>{EXAMPLE.bank}</span><span /></div>
              <h3>Which accounts should Forecast see?</h3>
              <div className="ob-accts">
                {EXAMPLE.accounts.map((a, i) => (
                  <label key={a.mask}>
                    <input type="checkbox" checked={accounts[i]} onChange={() => setAccounts(accounts.map((v, j) => (j === i ? !v : v)))} />
                    <span>{a.name}<small>•••• {a.mask}{a.note ? ` · ${a.note}` : ""}</small></span>
                    <span>{money(a.balance)}</span>
                  </label>
                ))}
              </div>
              <button className="ob-sh-btn" onClick={() => { setSheet("closed"); go("reading"); }}>Continue</button>
              <p className="ob-sh-note">Read-only access. You can change this later.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Reveal(props: {
  value: number; bills: number; billTotal: number; cushion: number; payday: string; short: number;
  headingRef: React.RefObject<HTMLHeadingElement | null>; onDone: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [explain, setExplain] = useState(false);

  useEffect(() => {
    if (reduceMotion()) {
      setShown(props.value);
      setExplain(true);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + 500, dur = 1300;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      setShown(Math.round(props.value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTimeout(() => setExplain(true), 400);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.value]);

  const d = heroDate();
  const billsText = props.bills === 1 ? "one bill" : `${props.bills} bills`;
  const line = props.short
    ? `You're ${money(props.short)} short of covering ${billsText} before you're paid on ${props.payday}, so today stays at $0.`
    : `That's what you can spend today and still cover ${billsText} (${money(props.billTotal)}) and keep your ${money(props.cushion)} cushion until you're paid on ${props.payday}.`;

  return (
    <section className="ob-view ob-reveal">
      <div className="ob-hero">
        <span className="ob-label">{d.weekday}, {d.monthDay}</span>
        <h1 ref={props.headingRef} tabIndex={-1} className="ob-num" aria-label={`${money(props.value)} safe to spend`}>
          <span className="c">$</span>{shown.toLocaleString("en-US")}
        </h1>
        <span className="ob-label">Safe to spend</span>
      </div>
      <div className={`ob-glass ob-explain ${explain ? "on" : ""}`}>
        <span className="ob-label dim">Your first forecast</span>
        <p>{line}</p>
        <button className="ob-btn" onClick={props.onDone}>Open Forecast</button>
      </div>
    </section>
  );
}

const AppleMark = () => (
  <svg viewBox="0 0 17 20" fill="currentColor" aria-hidden="true"><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1 7.3c-1.9 3.3-.5 8.2 1.4 10.9.9 1.3 2 2.8 3.4 2.7 1.4-.1 1.9-.9 3.5-.9s2.1.9 3.5.9c1.5 0 2.4-1.3 3.3-2.7 1-1.5 1.5-3 1.5-3.1-.1 0-2.5-1-2.5-4.5ZM11.6 3c.7-.9 1.3-2.1 1.1-3.3-1.1 0-2.4.7-3.2 1.6-.7.8-1.3 2-1.1 3.2 1.2.1 2.4-.6 3.2-1.5Z" /></svg>
);
const GoogleMark = () => (
  <svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z" /><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 5.9-2.2L12 13.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H1v2.3A9 9 0 0 0 9 18Z" /><path fill="#FBBC05" d="M4 10.7a5.4 5.4 0 0 1 0-3.4V5H1a9 9 0 0 0 0 8l3-2.3Z" /><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.4A9 9 0 0 0 1 5l3 2.3c.7-2.1 2.7-3.7 5-3.7Z" /></svg>
);
const LockIcon = () => <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 8.5h12v7H3zM5.5 8.5V6a3.5 3.5 0 0 1 7 0v2.5" /></svg>;
const CheckIcon = () => <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="9" cy="9" r="6.5" /><path d="M6 9.2 8 11l4-4" /></svg>;
const ListIcon = () => <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 5h12M3 9h12M3 13h7" /></svg>;
