export const money = (n: number) => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");

const at = (d: number, from = new Date()) => {
  const t = new Date(from);
  t.setHours(12, 0, 0, 0);
  t.setDate(t.getDate() + d);
  return t;
};
export const dayName = (d: number) => (d === 0 ? "Today" : d === 1 ? "Tmrw" : at(d).toLocaleDateString("en-US", { weekday: "short" }));
export const shortDate = (d: number) => at(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const longDate = (d: number) => at(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const heroDate = () => at(0).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
