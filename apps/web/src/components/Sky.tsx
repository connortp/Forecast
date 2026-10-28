"use client";

import { useEffect, useRef } from "react";
import type { Condition } from "@/lib/engine";

export type TimeOfDay = "dawn" | "day" | "dusk" | "night";

// [zenith, middle, horizon] for a clear sky at each time of day.
const PALETTE: Record<TimeOfDay, [string, string, string]> = {
  dawn: ["#3b4f86", "#c48aa0", "#ffc9a3"],
  day: ["#1b5fb8", "#4d97df", "#a9d6f5"],
  dusk: ["#24264f", "#8a4f7d", "#ff9f6e"],
  night: ["#060a18", "#0f1a36", "#24365e"],
};

// How much each condition greys and darkens the sky, and what fills it.
const WEATHER: Record<Condition, { gray: number; dark: number; clouds: number; cloudAlpha: number; rain: number }> = {
  sunny: { gray: 0, dark: 0, clouds: 3, cloudAlpha: 0.5, rain: 0 },
  partly: { gray: 0.12, dark: 0.03, clouds: 7, cloudAlpha: 0.7, rain: 0 },
  cloudy: { gray: 0.55, dark: 0.12, clouds: 13, cloudAlpha: 0.7, rain: 0 },
  rain: { gray: 0.7, dark: 0.3, clouds: 14, cloudAlpha: 0.55, rain: 110 },
  storm: { gray: 0.75, dark: 0.55, clouds: 16, cloudAlpha: 0.45, rain: 220 },
};

const tone = (hex: string, gray: number, dark: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  return `rgb(${[r, g, b].map((c) => Math.round((c + (l - c) * gray) * (1 - dark))).join(",")})`;
};

// A soft, volumetric cloud: many overlapping puffs, lighter on top.
function makeCloud(width: number, lit: string, shade: string, alpha: number) {
  const height = Math.round(width * 0.5);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d")!;
  const puffs = 26 + Math.random() * 12;
  for (let i = 0; i < puffs; i++) {
    const u = Math.random();
    const px = width * (0.15 + u * 0.7);
    const crown = 1 - Math.abs(u - 0.5) * 2; // taller in the middle
    const py = height * (0.68 - crown * 0.22 + (Math.random() - 0.5) * 0.12);
    const r = width * (0.09 + Math.random() * 0.09) * (0.7 + crown * 0.5);
    const grad = g.createRadialGradient(px, py - r * 0.25, 0, px, py, r);
    grad.addColorStop(0, `rgba(${lit},${alpha * 0.55})`);
    grad.addColorStop(0.5, `rgba(${shade},${alpha * 0.35})`);
    grad.addColorStop(1, `rgba(${shade},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function Sky({ condition, timeOfDay }: { condition: Condition; timeOfDay: TimeOfDay }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const wx = WEATHER[condition];
    const night = timeOfDay === "night";
    let W = 0, H = 0, raf = 0, tick = 0, nextFlash = 120;
    type Cloud = { img: HTMLCanvasElement; x: number; y: number; v: number; s: number };
    let clouds: Cloud[] = [];
    let drops: { x: number; y: number; v: number; l: number }[] = [];
    let stars: { x: number; y: number; r: number; p: number }[] = [];

    const build = () => {
      W = innerWidth;
      H = innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lit = night ? "150,165,195" : timeOfDay === "dusk" ? "255,214,196" : timeOfDay === "dawn" ? "255,226,214" : "255,255,255";
      const shade = night ? "60,72,100" : condition === "storm" ? "70,78,96" : condition === "rain" ? "120,130,148" : timeOfDay === "dusk" ? "150,110,140" : "205,216,232";
      clouds = Array.from({ length: wx.clouds }, () => {
        const w = Math.round(Math.min(W * 0.95, 300 + Math.random() * 420));
        const depth = Math.random();
        return {
          img: makeCloud(w, lit, shade, wx.cloudAlpha),
          x: Math.random() * (W + w) - w,
          y: -w * 0.12 + Math.random() * H * (wx.clouds > 10 ? 0.55 : 0.38),
          v: 0.05 + depth * 0.2,
          s: 0.75 + depth * 0.5,
        };
      });
      drops = Array.from({ length: wx.rain }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 10 + Math.random() * 8, l: 12 + Math.random() * 16 }));
      stars = night && wx.gray < 0.5 ? Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.7, r: Math.random() * 1.2 + 0.2, p: Math.random() * 6 })) : [];
    };

    const frame = () => {
      const [z, m, h] = PALETTE[timeOfDay];
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, tone(z, wx.gray, wx.dark));
      bg.addColorStop(0.55, tone(m, wx.gray, wx.dark));
      bg.addColorStop(1, tone(h, wx.gray, wx.dark));
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      for (const st of stars) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(st.p + tick * 0.02);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const orb = 1 - wx.gray * 1.2;
      if (orb > 0.2) {
        const ox = W * 0.76;
        const oy = H * (timeOfDay === "day" ? 0.13 : night ? 0.15 : 0.24);
        const R = night ? 34 : 46;
        const gc = night ? "200,215,255" : timeOfDay === "day" ? "255,236,180" : "255,190,140";
        const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 7);
        glow.addColorStop(0, `rgba(${gc},${0.55 * orb})`);
        glow.addColorStop(0.25, `rgba(${gc},${0.18 * orb})`);
        glow.addColorStop(1, `rgba(${gc},0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = orb;
        const disc = ctx.createRadialGradient(ox - R * 0.3, oy - R * 0.3, 0, ox, oy, R);
        disc.addColorStop(0, night ? "#fbf7ea" : "#fffbe8");
        disc.addColorStop(1, night ? "#cfd3dd" : timeOfDay === "day" ? "#ffd987" : "#ffb27a");
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(ox, oy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      for (const c of clouds) {
        if (!reduce) {
          c.x += c.v;
          if (c.x > W) c.x = -c.img.width * c.s;
        }
        ctx.drawImage(c.img, c.x, c.y, c.img.width * c.s, c.img.height * c.s);
      }

      if (drops.length) {
        ctx.strokeStyle = night ? "rgba(170,190,230,0.35)" : "rgba(220,232,255,0.42)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (const d of drops) {
          if (!reduce) {
            d.y += d.v;
            d.x -= d.v * 0.18;
            if (d.y > H) {
              d.y = -d.l;
              d.x = Math.random() * (W + 80);
            }
          }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.l * 0.18, d.y + d.l);
        }
        ctx.stroke();
      }

      const haze = ctx.createLinearGradient(0, H * 0.7, 0, H);
      haze.addColorStop(0, "rgba(11,15,23,0)");
      haze.addColorStop(1, "rgba(11,15,23,0.35)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, H * 0.7, W, H * 0.3);

      tick++;
      const flash = flashRef.current;
      if (condition === "storm" && !reduce && flash && tick > nextFlash) {
        flash.style.transition = "none";
        flash.style.opacity = "0.28";
        requestAnimationFrame(() => {
          flash.style.transition = "opacity .7s ease-out";
          flash.style.opacity = "0";
        });
        nextFlash = tick + 200 + Math.random() * 380;
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };

    const onResize = () => {
      build();
      if (reduce) frame();
    };
    build();
    frame();
    addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
    };
  }, [condition, timeOfDay]);

  return (
    <div className="scene" aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="flash" ref={flashRef} />
    </div>
  );
}
