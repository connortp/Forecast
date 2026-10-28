import type { Bucket, Snapshot } from "./engine";

// Example data for the prototype. Nothing here is a real account.

const buckets: Bucket[] = [
  { name: "Emergency fund", saved: 4200, goal: 10000, perPaycheck: 200 },
  { name: "Japan, spring '27", saved: 1150, goal: 3000, perPaycheck: 150 },
  { name: "New laptop", saved: 600, goal: 1800, perPaycheck: 100 },
];

const base = { buckets, cushion: 150, typicalDay: 70 };
const pay = (nextIn: number) => ({ amount: 2650, nextIn, every: 14 });
const monthly = (name: string, amount: number, dueIn: number) => ({ name, amount, dueIn, every: 30 });

export const SCENARIOS = {
  sunny: {
    label: "Just paid",
    snapshot: {
      ...base, cash: 3420, spentToday: 18, recentPace: 58, paycheck: pay(13),
      bills: [monthly("Rent", 1450, 9), monthly("Phone", 85, 4), monthly("Spotify", 12, 6), monthly("Car insurance", 142, 11)],
    },
  },
  partly: {
    label: "Mid-cycle",
    snapshot: {
      ...base, cash: 820, spentToday: 24, recentPace: 74, paycheck: pay(6),
      bills: [monthly("Electric", 96, 2), monthly("Internet", 70, 4), monthly("Gym", 45, 5), monthly("Rent", 1450, 23)],
    },
  },
  rain: {
    label: "Rent week",
    snapshot: {
      ...base, cash: 1790, spentToday: 12, recentPace: 81, paycheck: pay(5),
      bills: [monthly("Rent", 1450, 2), monthly("Phone", 85, 3), monthly("Car payment", 389, 15)],
    },
  },
  storm: {
    label: "Overspent",
    snapshot: {
      ...base, cash: 640, spentToday: 0, recentPace: 112, paycheck: pay(4),
      bills: [monthly("Car payment", 389, 1), monthly("Car insurance", 142, 3), monthly("Rent", 1450, 17)],
    },
  },
} satisfies Record<string, { label: string; snapshot: Snapshot }>;

export type ScenarioKey = keyof typeof SCENARIOS;
