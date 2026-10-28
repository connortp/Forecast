import type { Condition } from "@/lib/engine";

export function WeatherIcon({ condition, night = false }: { condition: Condition; night?: boolean }) {
  switch (condition) {
    case "sunny":
      return night ? (
        <svg viewBox="0 0 32 32"><path d="M20 6a10 10 0 1 0 6 18A11 11 0 0 1 20 6Z" fill="#f1ead2" /></svg>
      ) : (
        <svg viewBox="0 0 32 32">
          <defs><radialGradient id="wx-sun" cx=".4" cy=".35"><stop offset="0" stopColor="#fff2c4" /><stop offset="1" stopColor="#ffb43a" /></radialGradient></defs>
          <circle cx="16" cy="16" r="7.5" fill="url(#wx-sun)" />
          <g stroke="#ffc65c" strokeWidth="2" strokeLinecap="round"><path d="M16 2.5v3M16 26.5v3M2.5 16h3M26.5 16h3M6.5 6.5l2 2M23.5 23.5l2 2M6.5 25.5l2-2M23.5 8.5l2-2" /></g>
        </svg>
      );
    case "partly":
      return (
        <svg viewBox="0 0 32 32">
          {night ? <path d="M15 4a8 8 0 1 0 5 14A9 9 0 0 1 15 4Z" fill="#f1ead2" /> : <circle cx="12" cy="12" r="6.5" fill="#ffc65c" />}
          <path d="M10.5 27h13a4.6 4.6 0 0 0 .4-9.2 6.6 6.6 0 0 0-12.6 1.6A3.9 3.9 0 0 0 10.5 27Z" fill="#fff" />
          <path d="M10.5 27h13a4.6 4.6 0 0 0 4.4-3.4H7a3.9 3.9 0 0 0 3.5 3.4Z" fill="#d9e1ee" />
        </svg>
      );
    case "cloudy":
      return (
        <svg viewBox="0 0 32 32">
          <path d="M18 9a6 6 0 0 1 5.9 5 4.4 4.4 0 0 1 3.6 4.3" fill="none" stroke="#b9c3d3" strokeWidth="2" strokeLinecap="round" />
          <path d="M8 26h13a4.8 4.8 0 0 0 .4-9.6 7 7 0 0 0-13.4 1.7A4 4 0 0 0 8 26Z" fill="#eef1f6" />
          <path d="M8 26h13a4.8 4.8 0 0 0 4.6-3.6H4.4A4 4 0 0 0 8 26Z" fill="#c9d1de" />
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 32 32">
          <path d="M8 20h14a4.8 4.8 0 0 0 .4-9.6 7 7 0 0 0-13.4 1.7A4 4 0 0 0 8 20Z" fill="#dfe5ee" />
          <g stroke="#8db8ff" strokeWidth="2.2" strokeLinecap="round"><path d="M10 23.5l-1.2 3.5M15.5 23.5l-1.2 3.5M21 23.5l-1.2 3.5" /></g>
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 32 32">
          <path d="M8 19h14a4.8 4.8 0 0 0 .4-9.6 7 7 0 0 0-13.4 1.7A4 4 0 0 0 8 19Z" fill="#b8c0cf" />
          <path d="M16.5 17 12 24h4.2l-2 6 6.3-8.5h-4.2l2.2-4.5Z" fill="#ffc65c" />
        </svg>
      );
  }
}
