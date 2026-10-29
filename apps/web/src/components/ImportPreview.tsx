"use client";

import { useMemo, useState } from "react";
import { CONFIDENT, learn, parseExport, type Cadence, type ParseResult } from "@/lib/import";
import { asMonarch, fakeHistory, FIXTURE_TODAY } from "@/lib/import/fixtures";
import { money } from "@/lib/format";
import { Sky } from "./Sky";
import "./import.css";

// A preview of importing history from Monarch, Copilot, Mint, YNAB, or a bank CSV.
// Everything runs in this tab: the file is read here and never uploaded.

const SOURCE_NAME: Record<ParseResult["format"], string> = {
  monarch: "Monarch",
  copilot: "Copilot",
  mint: "Mint",
  ynab: "YNAB",
  csv: "your bank",
};

const EVERY: Record<Cadence, string> = {
  weekly: "Every week",
  biweekly: "Every other week",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  annual: "Yearly",
};

const todayIso = () => new Date().toLocaleDateString("en-CA");
const nice = (iso: string, year = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });

type Loaded = { text: string; fileName: string; today: string };

export function ImportPreview() {
  const [file, setFile] = useState<Loaded>();
  const [flip, setFlip] = useState(false);
  const [dragging, setDragging] = useState(false);

  const result = useMemo(() => {
    if (!file) return undefined;
    const parsed = parseExport(file.text, { flip });
    return { parsed, learned: learn(parsed.txns, file.today) };
  }, [file, flip]);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setFlip(false);
    setFile({ text: await f.text(), fileName: f.name, today: todayIso() });
  };

  return (
    <div className="app">
      <Sky condition="partly" timeOfDay="dawn" dim={!!result} />

      <main className="sheet im">
        <header className="im-head">
          <span className="label">Bring your history</span>
          <h1>
            Start with <em>more</em> than ninety days.
          </h1>
          <p>
            Drop an export from Monarch, Copilot, Mint, YNAB, or your bank. Forecast reads it right here to find your paydays, your
            bills (even yearly ones), and what a normal day costs. Nothing is uploaded.
          </p>
        </header>

        <label
          className={`glass im-drop${dragging ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            read(e.dataTransfer.files[0]);
          }}
        >
          <input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0])} hidden />
          <b>{file ? file.fileName : "Choose a CSV file"}</b>
          <span>{file ? "Choose another file" : "or drop it here"}</span>
        </label>
        <div className="foot">
          <button
            className="chip"
            onClick={() => {
              setFlip(false);
              setFile({ text: asMonarch(fakeHistory()), fileName: "Example Monarch export", today: FIXTURE_TODAY });
            }}
          >
            Try it with example data
          </button>
        </div>

        {result && <Results {...result} flip={flip} onFlip={() => setFlip(!flip)} />}
      </main>
    </div>
  );
}

function Results({ parsed, learned, flip, onFlip }: { parsed: ParseResult; learned: ReturnType<typeof learn>; flip: boolean; onFlip: () => void }) {
  if (!parsed.txns.length) {
    return (
      <section className="glass card">
        <span className="label eyebrow">Couldn’t read this file</span>
        <p>{parsed.skipped[0]?.reason ?? "There were no transactions in it."}</p>
      </section>
    );
  }
  const counts = { spend: 0, income: 0, transfer: 0, ignored: 0 };
  for (const t of parsed.txns) counts[t.kind]++;
  const p = learned.paycheck;
  const years = Math.max(1, Math.round(learned.historyDays / 365));
  const bills = [...learned.bills].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
  const repeated = (name: string) => bills.filter((b) => b.name === name).length > 1;

  return (
    <>
      <section className="glass card">
        <span className="label eyebrow">Read from {SOURCE_NAME[parsed.format]}</span>
        <h2>
          {parsed.txns.length.toLocaleString()} transactions, <em>{years}</em> year{years > 1 ? "s" : ""} back.
        </h2>
        <div className="kv">
          <div><span>From</span><span>{learned.from && nice(learned.from, true)} to {learned.to && nice(learned.to, true)}</span></div>
          <div><span>Spending</span><span>{counts.spend.toLocaleString()}</span></div>
          <div><span>Income</span><span>{counts.income.toLocaleString()}</span></div>
          <div><span>Transfers and investments, left out</span><span>{(counts.transfer + counts.ignored).toLocaleString()}</span></div>
        </div>
        {parsed.skipped.length > 0 && <p className="fine">{parsed.skipped.length} rows couldn’t be read and were skipped.</p>}
        {parsed.signGuessed && (
          <p className="fine">
            This file doesn’t say which way money moves, so purchases are read as {flip ? "negative" : "positive"}.{" "}
            <button className="im-link" onClick={onFlip}>That’s backwards</button>
          </p>
        )}
      </section>

      <section className="glass card">
        <span className="label eyebrow">Payday</span>
        {p ? (
          <>
            <h2>
              {money(p.amount)}, <em>{EVERY[p.cadence].toLowerCase()}</em>.
            </h2>
            <div className="kv">
              <div><span>From</span><span>{p.name}</span></div>
              <div><span>Next</span><span>{nice(p.nextDate)}</span></div>
            </div>
          </>
        ) : (
          <p>No regular paycheck found. You’ll set it during sign-up.</p>
        )}
      </section>

      <section className="glass card">
        <span className="label eyebrow">Recurring bills</span>
        <h2>
          {bills.length} <em>found</em>.
        </h2>
        <p>Faded ones aren’t regular enough to count yet; sign-up asks about them first.</p>
        <div className="list">
          {bills.map((b) => (
            <div className={`row${b.confidence >= CONFIDENT ? "" : " im-unsure"}`} key={`${b.name}|${b.account}`}>
              <span className="nm">
                {b.name}
                <small>
                  {EVERY[b.cadence]} · next {nice(b.nextDate)}
                  {b.account && repeated(b.name) ? ` · ${b.account}` : ""}
                </small>
              </span>
              <span className="amt">{money(b.amount)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="glass card">
        <span className="label eyebrow">A normal day</span>
        <h2>
          {money(learned.typicalDay)} on an <em>ordinary</em> day.
        </h2>
        <p>
          Everything that isn’t a bill, over the last {Math.min(26, Math.floor(learned.historyDays / 7))} weeks. It sets the weather: more room than
          this is clear skies, less is rain.
        </p>
      </section>
    </>
  );
}
