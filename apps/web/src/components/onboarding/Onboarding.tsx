"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { today } from "@/lib/engine";
import { heroDate, money, shortDate } from "@/lib/format";
import { EVERY, findBills, findPaycheck, localYmd, toSnapshot, type LiveRows } from "@/lib/live";
import { call, loadRows, PLAID_SANDBOX, supabase } from "@/lib/supabase";
import { CADENCES, EXAMPLE } from "./example";
import { saveOnboarding, type Saved } from "./progress";
import "./onboarding.css";

type Step = "welcome" | "email" | "code" | "bank" | "reading" | "payday" | "bills" | "savings" | "reveal";
type Rows = Awaited<ReturnType<typeof loadRows>>;
type Exchange = { item_id: string; accounts: { name: string }[] };

// Five stages on the progress bar; the welcome and the reveal sit outside it.
const STAGE: Record<Step, number> = { welcome: -1, email: 0, code: 0, bank: 1, reading: 1, payday: 2, bills: 3, savings: 4, reveal: 5 };
const FREQ = Object.fromEntries(Object.entries(EVERY).map(([k, v]) => [v, k]));

const cents = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ymdIn = (days: number) => localYmd(undefined, new Date(Date.now() + days * 86_400_000));

export function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [trail, setTrail] = useState<Step[]>([]);
  const [method, setMethod] = useState<Saved["method"]>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Rows | null>(null);
  const [bank, setBank] = useState("your bank");
  const [linkToken, setLinkToken] = useState<string | null>(null);

  // What the person confirms along the way.
  const [every, setEvery] = useState(14);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => ymdIn(7));
  const [billsOff, setBillsOff] = useState<Set<string>>(new Set());
  const [buckets, setBuckets] = useState(() => EXAMPLE.buckets.map((b) => ({ ...b })));
  const [cushion, setCushion] = useState(150);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const ymd = rows ? localYmd(rows.timezone) : localYmd();
  const found = rows ? findPaycheck({ streams: rows.streams, settings: null }, ymd) : null;
  const bills = useMemo(() => (rows ? findBills(rows.streams.map((s) => ({ ...s, ignored: false })), ymd) : []), [rows, ymd]);

  // The rows as the person has confirmed them so far, for the live number.
  const confirmed = useMemo((): LiveRows | null => {
    if (!rows) return null;
    const amount = found ? null : Number(payAmount) || null;
    return {
      ...rows,
      streams: rows.streams.map((s) => ({ ...s, ignored: billsOff.has(s.id) })),
      buckets: buckets.map((b) => ({ name: b.name, goal: b.goal, saved: 0, per_paycheck: b.perPaycheck, archived_at: null })),
      settings: {
        cushion,
        pay_amount_override: amount,
        next_payday_override: found ? null : payDate,
        pay_every_days_override: found && every === found.every ? null : every,
      },
    };
  }, [rows, found, payAmount, payDate, billsOff, buckets, cushion, every]);
  const snapshot = confirmed ? toSnapshot(confirmed, ymd) : null;
  const t = snapshot ? today(snapshot) : null;

  const go = useCallback((next: Step) => {
    setError("");
    setTrail((tr) => [...tr, step]);
    setStep(next);
  }, [step]);
  const back = () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    setTrail(trail.slice(0, -1));
    setStep(prev === "reading" ? "bank" : prev);
  };
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Coming back from Google, Apple or an email link: pick up where they are.
  useEffect(() => {
    const resume = async (signedIn: boolean) => {
      if (!signedIn) return;
      const r = await loadRows().catch(() => null);
      if (r?.onboarded) return router.replace("/");
      setRows(r);
      setStep(r?.hasBank ? "reading" : "bank");
    };
    supabase().auth.getSession().then(({ data }) => resume(!!data.session));
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") resume(true);
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  // Move focus to each new screen's heading, except where a field takes it.
  useEffect(() => {
    if (step !== "email" && step !== "code") headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // "Reading your sky": wait for Plaid's history to land (the webhook fills it in).
  useEffect(() => {
    if (step !== "reading") return;
    let stop = false;
    const started = Date.now();
    const poll = async () => {
      const r = await loadRows().catch(() => null);
      if (stop) return;
      if (r) setRows(r);
      const ready = r && r.transactions.length > 0 && r.streams.length > 0;
      if (ready || Date.now() - started > 45_000) {
        if (r) {
          const p = findPaycheck({ streams: r.streams, settings: null }, localYmd(r.timezone));
          if (p) setEvery(p.every);
        }
        setTimeout(() => !stop && go("payday"), reduceMotion() ? 200 : 900);
      } else setTimeout(poll, 2000);
    };
    poll();
    return () => {
      stop = true;
    };
  }, [step, go]);

  const signIn = (m: NonNullable<Saved["method"]>) => {
    setMethod(m);
    if (m === "email") return go("email");
    attempt(async () => {
      const { error } = await supabase().auth.signInWithOAuth({ provider: m, options: { redirectTo: `${location.origin}/welcome` } });
      if (error) throw new Error(`${m === "google" ? "Google" : "Apple"} sign-in isn't switched on yet. Use email for now.`);
    });
  };

  const sendCode = () =>
    attempt(async () => {
      const { error } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/welcome` } });
      if (error) throw error;
      go("code");
    });

  const verify = () =>
    attempt(async () => {
      const { error } = await supabase().auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw new Error("That code didn't work. Check it, or send a new one.");
      // onAuthStateChange moves on to the bank step.
    });

  const linked = (_res: Exchange, name?: string) => {
    setBank(name ?? "your bank");
    go("reading");
  };

  const plaid = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token, meta) =>
      attempt(async () => {
        const institution = meta.institution ? { institution_id: meta.institution.institution_id, name: meta.institution.name } : null;
        await linked(await call<Exchange>("exchange-public-token", { public_token, institution }), meta.institution?.name);
      }),
    onExit: (err) => {
      setLinkToken(null);
      if (err) setError(err.display_message ?? "The bank connection closed before it finished.");
    },
  });
  useEffect(() => {
    if (linkToken && plaid.ready) plaid.open();
  }, [linkToken, plaid.ready, plaid]);

  const connect = () =>
    attempt(async () => {
      setLinkToken((await call<{ link_token: string }>("create-link-token")).link_token);
    });

  const testBank = () =>
    attempt(async () => {
      const sandbox = await call<{ public_token: string; institution: { name: string } }>("sandbox-public-token");
      await linked(await call<Exchange>("exchange-public-token", sandbox), "a test bank");
    });

  const savePayday = () =>
    attempt(async () => {
      if (!found && !(Number(payAmount) > 0)) throw new Error("Add your paycheck amount.");
      go("bills");
    });

  const saveAll = (list = buckets) =>
    attempt(async () => {
      const db = supabase();
      const { data: user } = await db.auth.getUser();
      const uid = user.user!.id;
      const writes = [
        db.from("settings").update({ ...confirmed!.settings!, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).eq("user_id", uid),
        ...rows!.streams.filter((x) => x.direction === "outflow").map((x) => db.from("recurring_streams").update({ ignored: billsOff.has(x.id) }).eq("id", x.id)),
      ];
      const { data: existing } = await db.from("buckets").select("id").limit(1);
      if (!existing?.length) {
        const keep = list.filter((b) => b.perPaycheck > 0);
        if (keep.length) writes.push(db.from("buckets").insert(keep.map((b, i) => ({ user_id: uid, name: b.name, goal: b.goal, per_paycheck: b.perPaycheck, sort: i }))));
      }
      setBuckets(list);
      const results = await Promise.all(writes);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
      go("reveal");
    });

  const finish = () =>
    attempt(async () => {
      const db = supabase();
      const { data: user } = await db.auth.getUser();
      const { error } = await db.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", user.user!.id);
      if (error) throw error;
      saveOnboarding({ done: true, method });
      router.push("/");
    });

  const sky = step === "welcome" ? "video" : step === "reveal" ? "reveal" : "flow";
  const stage = STAGE[step];
  const chrome = stage >= 0 && stage < 5;

  const heldBills = bills.filter((b) => !billsOff.has(b.id));
  const billTotal = heldBills.reduce((n, b) => n + b.amount, 0);
  const cadence = CADENCES.find((x) => x.every === every) ?? CADENCES[1];
  const firstPay = snapshot?.paycheck.nextIn ?? found?.nextIn ?? 7;
  const paydays = Array.from({ length: 7 }, (_, i) => shortDate(firstPay + i * every));
  const reading = [
    { label: rows?.accounts.length ? `Balances from ${bank}` : "Balances", done: !!rows?.accounts.length },
    { label: rows?.transactions.length ? `${rows.transactions.length.toLocaleString("en-US")} transactions` : "Transactions", done: !!rows?.transactions.length },
    { label: "Finding your paydays", done: !!rows?.streams.some((s) => s.direction === "inflow") },
    { label: "Finding your bills", done: !!rows?.streams.some((s) => s.direction === "outflow") },
  ];
  const readIdx = reading.findIndex((r) => !r.done);
  const Err = () => (error ? <p className="ob-err" role="alert">{error}</p> : null);

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
          <button className="ob-back" onClick={back} disabled={step === "reading" || step === "bank" || !trail.length} aria-label="Back">
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
            <Err />
            <div className="ob-actions">
              <button className="ob-btn" disabled={busy} onClick={() => signIn("google")}><GoogleMark />Continue with Google</button>
              <button className="ob-btn ghost" disabled={busy} onClick={() => signIn("apple")}><AppleMark />Continue with Apple</button>
              <button className="ob-btn text" onClick={() => signIn("email")}>Use email instead</button>
            </div>
            <p className="ob-fine">Already have an account? The same buttons sign you in.</p>
          </section>
        )}

        {step === "email" && (
          <form className="ob-view" key="email" onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) sendCode(); }}>
            <span className="ob-label">Create your account</span>
            <h2 ref={headingRef} tabIndex={-1}>What&apos;s your <em>email</em>?</h2>
            <p>We&apos;ll send a six-digit code. No password to remember.</p>
            <div className="ob-field">
              <label className="ob-label" htmlFor="ob-email">Email</label>
              <input className="ob-input" id="ob-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <Err />
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" type="submit" disabled={!email.includes("@") || busy}>{busy ? "Sending…" : "Send code"}</button></div>
          </form>
        )}

        {step === "code" && (
          <form className="ob-view" key="code" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify(); }}>
            <span className="ob-label">Create your account</span>
            <h2 ref={headingRef} tabIndex={-1}>Check your <em>inbox</em>.</h2>
            <p>We sent a code to {email}. You can also tap the link in that email.</p>
            <label className="ob-code">
              <span className="sr-only">Six-digit code</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus />
              {Array.from({ length: 6 }, (_, i) => <span key={i} className={i === code.length ? "cur" : ""}>{code[i] ?? ""}</span>)}
            </label>
            <button type="button" className="ob-btn text left" disabled={busy} onClick={() => { setCode(""); sendCode(); }}>Resend code</button>
            <Err />
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" type="submit" disabled={code.length !== 6 || busy}>{busy ? "Checking…" : "Verify"}</button></div>
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
            <Err />
            <div className="ob-grow" />
            <div className="ob-actions">
              <button className="ob-btn" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect bank"}</button>
              {PLAID_SANDBOX && <button className="ob-btn text" disabled={busy} onClick={testBank}>Use a test bank</button>}
            </div>
          </section>
        )}

        {step === "reading" && (
          <section className="ob-view ob-center" key="reading" aria-live="polite">
            <span className="ob-label">Reading your sky</span>
            <h2 ref={headingRef} tabIndex={-1}>Looking at your last <em>90 days</em>.</h2>
            <div className="ob-steps">
              {reading.map((r, i) => <div key={i} className={r.done ? "done" : i === readIdx ? "run" : ""}><b />{r.label}</div>)}
            </div>
            <p className="ob-fine left">Usually under 30 seconds.</p>
          </section>
        )}

        {step === "payday" && (
          <section className="ob-view" key="payday">
            <span className="ob-label">Your paydays</span>
            {found ? (
              <>
                <h2 ref={headingRef} tabIndex={-1}>Looks like you&apos;re paid <em>{cadence.label}</em>.</h2>
                <div className="ob-glass ob-card">
                  <span className="ob-label dim">{found.name}</span>
                  <div className="ob-between"><span className="ob-big">{money(found.amount)}</span><span className="ob-note">after tax</span></div>
                  <div className="ob-dates">
                    {paydays.map((d, i) => { const [m, day] = d.split(" "); return <span key={d} className={i === 0 ? "pay" : ""}><i>{m.toUpperCase()}</i>{day}</span>; })}
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 ref={headingRef} tabIndex={-1}>When do you get <em>paid</em>?</h2>
                <p>We couldn&apos;t spot a paycheck yet. Tell us and we&apos;ll learn it as deposits land.</p>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="ob-pay">Each paycheck, after tax</label>
                  <input className="ob-input" id="ob-pay" inputMode="decimal" placeholder="$2,000" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="ob-next">Next payday</label>
                  <input className="ob-input" id="ob-next" type="date" min={ymdIn(1)} value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                </div>
              </>
            )}
            <div className="ob-chips" role="radiogroup" aria-label="How often you're paid">
              {CADENCES.map((x) => (
                <button key={x.every} role="radio" aria-checked={x.every === every} className={`ob-chip ${x.every === every ? "on" : ""}`} onClick={() => setEvery(x.every)}>{x.chip}</button>
              ))}
            </div>
            <Err />
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" onClick={savePayday}>{found ? "That's right" : "Continue"}</button></div>
          </section>
        )}

        {step === "bills" && (
          <section className="ob-view" key="bills">
            <span className="ob-label">Your bills</span>
            <h2 ref={headingRef} tabIndex={-1}>{bills.length ? <>These come out <em>regularly</em>.</> : <>No bills <em>yet</em>.</>}</h2>
            <p>{bills.length ? "Turn off anything that isn't a real bill." : "We'll add them as they repeat. You can also add one later."}</p>
            {bills.length > 0 && (
              <div className="ob-glass ob-list">
                {bills.map((b) => {
                  const on = !billsOff.has(b.id);
                  return (
                    <div key={b.id} className={`ob-row ${on ? "" : "off"}`}>
                      <span className="nm">{b.name}<small>{shortDate(b.dueIn)}{b.every !== 30 ? ` · every ${FREQ[b.every]?.toLowerCase().replace("_", "-") ?? `${b.every} days`}` : ""}</small></span>
                      <span className="amt">{cents(b.amount)}</span>
                      <button
                        className="ob-tog" role="switch" aria-checked={on} aria-label={`Count ${b.name}`}
                        onClick={() => setBillsOff((s) => { const n = new Set(s); if (on) n.add(b.id); else n.delete(b.id); return n; })}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="ob-between ob-total"><span className="ob-label dim">Held for bills before payday</span><b>{cents(Math.round((t?.bills ?? 0) * 100) / 100)}</b></div>
            <div className="ob-grow" />
            <div className="ob-actions"><button className="ob-btn" onClick={() => go("savings")}>Looks right</button></div>
          </section>
        )}

        {step === "savings" && (
          <section className="ob-view" key="savings">
            <span className="ob-label">Savings</span>
            <h2 ref={headingRef} tabIndex={-1}>Pay yourself <em>first</em>.</h2>
            <p>Set aside from each paycheck before anything looks spendable. Starts with your {shortDate(firstPay)} paycheck.</p>
            <div className="ob-glass ob-list">
              {buckets.map((b, i) => (
                <div key={b.name} className="ob-bucket">
                  <span className="nm">{b.name}<small>Goal {money(b.goal)} · per paycheck</small></span>
                  <span className="ob-stepper">
                    <button aria-label={`Less to ${b.name}`} onClick={() => setBuckets(buckets.map((x, j) => (j === i ? { ...x, perPaycheck: Math.max(0, x.perPaycheck - 10) } : x)))}>−</button>
                    <b>{money(b.perPaycheck)}</b>
                    <button aria-label={`More to ${b.name}`} onClick={() => setBuckets(buckets.map((x, j) => (j === i ? { ...x, perPaycheck: x.perPaycheck + 10 } : x)))}>+</button>
                  </span>
                </div>
              ))}
            </div>
            <div className="ob-glass ob-cushion">
              <div className="ob-between"><label className="ob-label dim" htmlFor="ob-cushion">Cushion</label><b>{money(cushion)}</b></div>
              <input id="ob-cushion" type="range" min={0} max={500} step={25} value={cushion} onChange={(e) => setCushion(+e.target.value)} />
              <p>Always kept back, so a surprise charge doesn&apos;t turn into an overdraft.</p>
            </div>
            <Err />
            <div className="ob-grow" />
            <div className="ob-actions">
              <button className="ob-btn" disabled={busy} onClick={() => saveAll()}>Continue</button>
              <button className="ob-btn text" disabled={busy} onClick={() => saveAll(buckets.map((b) => ({ ...b, perPaycheck: 0 })))}>Skip savings for now</button>
            </div>
          </section>
        )}

        {step === "reveal" && t && (
          <Reveal key="reveal" value={Math.round(t.safeToSpend)} daily={t.daily} headingRef={headingRef} bills={t.billCount} billTotal={t.bills} cushion={cushion} payday={shortDate(t.until)} short={t.pool < 0 ? -t.pool : 0} onDone={finish} />
        )}
        {step === "reveal" && error && <Err />}
      </div>
    </div>
  );
}

function Reveal(props: {
  value: number; daily: number; bills: number; billTotal: number; cushion: number; payday: string; short: number;
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
  const cover = props.bills ? `cover ${billsText} (${money(props.billTotal)}) and ` : "";
  const line = props.short
    ? `You're ${money(props.short)} short of covering ${billsText} before you're paid on ${props.payday}, so today stays at $0.`
    : props.value === 0 && props.daily > 0
      ? `You've already spent today's ${money(props.daily)} share. It resets tomorrow, and you're paid on ${props.payday}.`
      : `That's what you can spend today and still ${cover}keep your ${money(props.cushion)} cushion until you're paid on ${props.payday}.`;

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
