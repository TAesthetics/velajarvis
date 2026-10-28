/**
 * Daily morning greeting: once per Europe/Vienna calendar day, on the first activation.
 * Pure helpers (date logic, salutation, prompt building) so they are unit-testable.
 */

export const MORNING_KEY = "vela.morning.lastDate.v1";
export const MORNING_ENABLED_KEY = "vela.morning.enabled.v1";
export const TZ = "Europe/Vienna";

export type MorningMode = "throng" | "jarvis" | "purple";
export type MorningLang = "de-DE" | "en-US";

/** Calendar date in Vienna, YYYY-MM-DD. */
export function viennaDate(now: Date | number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function viennaHour(now: Date | number): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
}

/** True when today's (Vienna) greeting has not been delivered yet and the feature is enabled. */
export function shouldGreet(lastDate: string | null | undefined, now: Date | number, enabled = true): boolean {
  if (!enabled) return false;
  return lastDate !== viennaDate(now);
}

/** "Guten Morgen" 5:00–10:59, otherwise a time-appropriate fallback (the daily greeting still happens). */
export function salutation(hour: number, lang: MorningLang = "de-DE"): string {
  const en = lang === "en-US";
  if (hour >= 5 && hour < 11) return en ? "Good morning" : "Guten Morgen";
  if (hour >= 11 && hour < 18) return en ? "Good afternoon" : "Guten Tag";
  return en ? "Good evening" : "Guten Abend";
}

export function longDate(now: Date | number, lang: MorningLang = "de-DE"): string {
  return new Intl.DateTimeFormat(lang === "en-US" ? "en-GB" : "de-AT", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(now));
}

type Weather = {
  error?: string;
  now?: { temperatureC: number; condition: string };
  today?: { maxC: number; minC: number; rainChance: number };
};
export function weatherLine(w: Weather | null | undefined): string {
  if (!w || w.error || !w.now) return "Wetter gerade nicht verfügbar.";
  const r = (n: number) => Math.round(n);
  const t = w.today;
  return `Wien jetzt ${r(w.now.temperatureC)} Grad, ${w.now.condition}${t ? `; heute ${r(t.minC)} bis ${r(t.maxC)} Grad, Regenrisiko ${r(t.rainChance)} Prozent` : ""}.`;
}

type Repo = {
  error?: string;
  recentCommits?: { message: string; dateIso?: string }[];
  openIssues?: { number: number; title: string }[];
  openPullRequests?: number;
};
export function repoLine(r: Repo | null | undefined, now: Date | number): string {
  if (!r || r.error) return "Vela-Repo gerade nicht erreichbar.";
  const since = new Date(now).getTime() - 24 * 3_600_000;
  const fresh = (r.recentCommits ?? []).filter((c) => c.dateIso && Date.parse(c.dateIso) >= since);
  const issues = r.openIssues ?? [];
  const parts = [
    fresh.length ? `${fresh.length} neue Commits seit gestern, zuletzt: „${fresh[0].message}"` : "keine neuen Commits seit gestern",
    `${issues.length} offene Issues${issues[0] ? ` (z. B. #${issues[0].number} „${issues[0].title}")` : ""}`,
  ];
  if (r.openPullRequests) parts.push(`${r.openPullRequests} offene PRs`);
  return `Vela: ${parts.join(", ")}.`;
}

export function morningTask(o: {
  mode: MorningMode;
  lang: MorningLang;
  hour: number;
  date: string;
  weather: string;
  repo: string;
  siem?: string;
}): string {
  const sal = salutation(o.hour, o.lang);
  const opener =
    o.mode === "throng"
      ? `"${sal}, Terence. Wir sind schon wach …"`
      : o.mode === "purple"
        ? `"${sal}, Terence." und dann ein kurzes Sicherheits-Briefing`
        : `"${sal}, Sir …"`;
  return [
    `[Ereignis: erste Aktivierung heute. Das ist keine Nachricht von Terence, sondern dein täglicher Gruß an ihn.]`,
    `Begrüße Terence in deiner Persona. Beginne mit ${opener}.`,
    `Nenne das heutige Datum (${o.date}), das Wiener Wetter und eine kurze Vela-Statuszeile; optional eine Idee oder einen Fokus für den Tag.`,
    o.mode === "purple" ? `Erwähne die SIEM-Lage in einem Halbsatz (nichts erfinden).` : "",
    `Maximal 2–3 kurze, gesprochene Sätze, zusammen unter 45 Wörtern. Keine Listen, keine Emojis, keine URLs. Keine Tools aufrufen, die Fakten stehen hier:`,
    `Wetter: ${o.weather}`,
    o.repo,
    o.mode === "purple" && o.siem ? `SIEM: ${o.siem.slice(0, 600)}` : "",
    o.lang === "en-US" ? "Answer in English." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Hard cap for the spoken greeting: at most `n` real sentences (plus short salutations). */
export function limitSentences(text: string, n = 3): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[^\d\s][.!?…])\s+(?=[A-ZÄÖÜ"„])/); // no split after "29."
  // short leading salutations ("Guten Morgen, Sir." / "Wir sind schon wach.") don't count towards the limit
  const out: string[] = [];
  let counted = 0;
  let leading = true;
  for (const p of parts) {
    if (counted >= n) break;
    out.push(p);
    if (leading && p.split(" ").length <= 4) continue;
    leading = false;
    counted += 1;
  }
  return out.join(" ");
}
