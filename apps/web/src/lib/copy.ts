import type { Condition } from "./engine";

export type Tone = "calm" | "spicy";

export const CONDITION_NAME: Record<Condition, string> = {
  sunny: "Clear skies",
  partly: "Partly cloudy",
  cloudy: "Overcast",
  rain: "Light rain",
  storm: "Storm warning",
};

export const QUIPS: Record<Tone, Record<Condition, string>> = {
  calm: {
    sunny: "Plenty of room today. A normal day fits with space to spare.",
    partly: "Everyday spending fits comfortably today.",
    cloudy: "A little tighter than your usual day.",
    rain: "Keep plans simple until payday.",
    storm: "Bills ahead are bigger than your cash. Hold off until payday.",
  },
  spicy: {
    sunny: "Payday glow detected. Go ahead, buy the good olive oil.",
    partly: "Scattered lattes, mostly harmless.",
    cloudy: "Overcast. Your wallet requests a quiet night in.",
    rain: "Rent incoming. Ninety percent chance of leftovers.",
    storm: "Severe weather alert. Step away from the checkout button.",
  },
};
