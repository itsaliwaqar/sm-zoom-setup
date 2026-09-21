export const EASTERN_TZ = "America/New_York";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type RecurrenceRule = {
  dayOfWeek: number; // 0=Sunday .. 6=Saturday
  time: string; // "HH:MM", 24h, interpreted in `tz`
  tz: string; // IANA timezone, e.g. "America/New_York"
};

function formatInTz(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    weekday: WEEKDAYS.indexOf(map.weekday),
  };
}

// Converts a wall-clock date/time in `timeZone` to the correct UTC instant,
// accounting for that specific date's DST offset (not just "now"'s offset).
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const asUTC = new Date(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00Z`);
  const tzStr = asUTC.toLocaleString("en-US", { timeZone });
  const utcStr = asUTC.toLocaleString("en-US", { timeZone: "UTC" });
  const offset = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(asUTC.getTime() + offset);
}

// Finds the next UTC instant matching a weekly recurrence rule, strictly after `after`.
export function nextRecurrence(rule: RecurrenceRule, after: Date): Date {
  const [hh, mm] = rule.time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const probe = new Date(after.getTime() + i * 24 * 3600 * 1000);
    const { y, m, d, weekday } = formatInTz(probe, rule.tz);
    if (weekday !== rule.dayOfWeek) continue;
    const candidate = zonedTimeToUtc(y, m, d, hh, mm, rule.tz);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error(`could not compute next recurrence for rule ${JSON.stringify(rule)}`);
}

// Human-readable Eastern time string for the GHL contact field, e.g.
// "Tuesday, January 14, 2026 at 7:00 PM ET".
export function formatEastern(date: Date): string {
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return `${datePart} at ${timePart}`;
}
