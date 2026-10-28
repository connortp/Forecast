"use client";

import { useEffect, useRef, useState } from "react";
import type { Condition } from "@/lib/engine";
import sky from "@/lib/sky-index.json";

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

// The shared mapping from packages/design/sky/index.json: which photo plate (and optional
// light loop) fits this weather at this time of day, and how much to dim it.
export function plateFor(condition: Condition, time: TimeOfDay): { name: string; brightness: number; video?: string } {
  const e = (sky.conditions as Record<Condition, Record<TimeOfDay, { plate: string; brightness?: number; video?: string }>>)[condition][time];
  return { name: e.plate, brightness: e.brightness ?? 1, video: e.video };
}

// Fine streaks for storms; rain has its own video loop.
const RAIN: Partial<Record<Condition, number>> = { storm: 110 };

type Plate = { name: string; brightness: number; video?: string; id: number };
const filterFor = (brightness: number) => `blur(2px)${brightness < 1 ? ` brightness(${brightness})` : ""}`;

export function Sky({ condition, timeOfDay }: { condition: Condition; timeOfDay: TimeOfDay }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const target = plateFor(condition, timeOfDay);
  // Two stacked plates so a change cross-fades instead of popping.
  const [plates, setPlates] = useState<Plate[]>([{ ...target, id: 0 }]);

  useEffect(() => {
    setPlates((prev) => {
      const top = prev[prev.length - 1];
      if (top.name === target.name && top.brightness === target.brightness && top.video === target.video) return prev;
      return [top, { ...target, id: top.id + 1 }];
    });
  }, [target.name, target.brightness, target.video]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoOn, setVideoOn] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    setVideoOn(false);
    if (!v || !target.video || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    v.play().then(() => setVideoOn(true)).catch(() => {});
  }, [target.video]);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, devicePixelRatio || 1);
    let W = 0, H = 0, raf = 0, tick = 0, nextFlash = 120;
    let drops: { x: number; y: number; v: number; l: number }[] = [];

    const build = () => {
      const box = cv.parentElement!.getBoundingClientRect();
      W = box.width;
      H = box.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drops = Array.from({ length: RAIN[condition] ?? 0 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 12 + Math.random() * 8, l: 20 + Math.random() * 26 }));
    };

    const frame = () => {
      ctx.clearRect(0, 0, W, H);
      if (drops.length) {
        ctx.strokeStyle = "rgba(225,232,245,0.16)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (const d of drops) {
          if (!reduce) {
            d.y += d.v;
            d.x -= d.v * 0.12;
            if (d.y > H) {
              d.y = -d.l;
              d.x = Math.random() * (W + 60);
            }
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.l * 0.12, d.y + d.l);
        }
        ctx.stroke();
      }
      tick++;
      const flash = flashRef.current;
      if (condition === "storm" && !reduce && flash && tick > nextFlash) {
        flash.style.transition = "none";
        flash.style.opacity = "0.14";
        requestAnimationFrame(() => {
          flash.style.transition = "opacity .9s ease-out";
          flash.style.opacity = "0";
        });
        nextFlash = tick + 260 + Math.random() * 420;
      }
      if (!reduce && drops.length) raf = requestAnimationFrame(frame);
    };

    const onResize = () => {
      build();
      frame();
    };
    build();
    frame();
    addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
    };
  }, [condition]);

  return (
    <div className="sky" aria-hidden="true">
      {plates.map((p, i) => (
        <div
          key={p.id}
          className={`plate${i === plates.length - 1 ? " on" : ""}`}
          style={{ backgroundImage: `url(/sky/${p.name}.jpg)`, filter: filterFor(p.brightness) }}
        />
      ))}
      {target.video && (
        <video
          key={target.video}
          ref={videoRef}
          className={`plate${videoOn ? " on" : ""}`}
          src={`/sky/${target.video}.mp4`}
          poster={`/sky/${target.video}-poster.jpg`}
          style={{ filter: filterFor(target.brightness) }}
          muted
          loop
          playsInline
          preload="metadata"
        />
      )}
      <div className="shade" />
      <canvas ref={canvasRef} />
      <div className="flash" ref={flashRef} />
    </div>
  );
}
