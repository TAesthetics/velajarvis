import { tool } from "ai";
import { z } from "zod";
import { VELA_REPO } from "./vela-knowledge";

const WEATHER_CODES: Record<number, string> = {
  0: "klarer Himmel",
  1: "überwiegend klar",
  2: "teilweise bewölkt",
  3: "bedeckt",
  45: "Nebel",
  48: "Nebel mit Reif",
  51: "leichter Nieselregen",
  53: "Nieselregen",
  55: "starker Nieselregen",
  56: "gefrierender Nieselregen",
  57: "starker gefrierender Nieselregen",
  61: "leichter Regen",
  63: "Regen",
  65: "starker Regen",
  66: "gefrierender Regen",
  67: "starker gefrierender Regen",
  71: "leichter Schneefall",
  73: "Schneefall",
  75: "starker Schneefall",
  77: "Schneegriesel",
  80: "leichte Regenschauer",
  81: "Regenschauer",
  82: "heftige Regenschauer",
  85: "leichte Schneeschauer",
  86: "starke Schneeschauer",
  95: "Gewitter",
  96: "Gewitter mit Hagel",
  99: "schweres Gewitter mit Hagel",
};

export const jarvisTools = {
  getDateTime: tool({
    description:
      "Liefert aktuelles Datum, Uhrzeit und Wochentag. Standard-Zeitzone ist Europe/Vienna.",
    inputSchema: z.object({
      timeZone: z
        .string()
        .optional()
        .describe("IANA-Zeitzone, z. B. Europe/Vienna oder America/New_York"),
    }),
    execute: async ({ timeZone }) => {
      const tz = timeZone || "Europe/Vienna";
      const now = new Date();
      try {
        const fmt = (o: Intl.DateTimeFormatOptions) =>
          new Intl.DateTimeFormat("de-AT", { timeZone: tz, ...o }).format(now);
        return {
          timeZone: tz,
          date: fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
          time: fmt({ hour: "2-digit", minute: "2-digit" }),
          iso: now.toISOString(),
        };
      } catch {
        return { error: `Unbekannte Zeitzone: ${tz}` };
      }
    },
  }),

  getWeather: tool({
    description:
      "Aktuelles Wetter und Tagesvorhersage für einen Ort (Open-Meteo). Standardort: Wien.",
    inputSchema: z.object({
      location: z.string().describe("Ortsname, z. B. Wien, Graz, London"),
    }),
    execute: async ({ location }) => {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          location,
        )}&count=1&language=de&format=json`,
      );
      const geo = (await geoRes.json()) as {
        results?: { name: string; country?: string; latitude: number; longitude: number; timezone?: string }[];
      };
      const place = geo.results?.[0];
      if (!place) return { error: `Ort nicht gefunden: ${location}` };

      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
        `&forecast_days=2&timezone=auto`;
      const w = (await (await fetch(url)).json()) as {
        current: {
          temperature_2m: number;
          apparent_temperature: number;
          relative_humidity_2m: number;
          weather_code: number;
          wind_speed_10m: number;
        };
        daily: {
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          precipitation_probability_max: number[];
          weather_code: number[];
        };
      };
      return {
        place: `${place.name}${place.country ? ", " + place.country : ""}`,
        now: {
          temperatureC: w.current.temperature_2m,
          feelsLikeC: w.current.apparent_temperature,
          humidity: w.current.relative_humidity_2m,
          windKmh: w.current.wind_speed_10m,
          condition: WEATHER_CODES[w.current.weather_code] ?? "unbekannt",
        },
        today: {
          maxC: w.daily.temperature_2m_max[0],
          minC: w.daily.temperature_2m_min[0],
          rainChance: w.daily.precipitation_probability_max[0],
        },
        tomorrow: {
          maxC: w.daily.temperature_2m_max[1],
          minC: w.daily.temperature_2m_min[1],
          rainChance: w.daily.precipitation_probability_max[1],
          condition: WEATHER_CODES[w.daily.weather_code[1]] ?? "unbekannt",
        },
      };
    },
  }),

  openWebsite: tool({
    description:
      "Öffnet eine Website im Browser des Nutzers (neuer Tab). Nutze vollständige URLs, z. B. https://youtube.com.",
    inputSchema: z.object({
      url: z.string().describe("Vollständige URL inkl. https://"),
      label: z.string().optional().describe("Kurzer Name der Seite, z. B. YouTube"),
    }),
    execute: async ({ url, label }) => {
      let normalized = url.trim();
      if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
      try {
        const u = new URL(normalized);
        return { url: u.toString(), label: label ?? u.hostname, opened: true };
      } catch {
        return { error: `Ungültige URL: ${url}` };
      }
    },
  }),
};

// ---------------- Vela marketing tools ----------------

const PLATFORM_LIMITS: Record<string, number> = {
  x: 280,
  threads: 500,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
};

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "throng-vela-marketing" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`);
  return (await res.json()) as T;
}

export const marketingTools = {
  draftSocialPost: tool({
    description:
      "Legt einen Social-Media-Entwurf für Vela ab (wird im UI angezeigt, NIE automatisch gepostet). " +
      "Der Text muss in Velas eigener Stimme sein (warm, ehrlich, 'du'), nicht in der Schwarm-Stimme.",
    inputSchema: z.object({
      platform: z.enum(["x", "tiktok", "instagram", "threads", "linkedin"]),
      text: z.string().describe("Fertiger Post-Text bzw. Caption in Velas Stimme"),
      hook: z.string().optional().describe("Erster Satz / Hook (v. a. für TikTok-Videos)"),
      visualIdea: z.string().optional().describe("Idee für Bild/Video, ohne Gesichter/Optik in den Vordergrund"),
      hashtags: z.array(z.string()).optional(),
    }),
    execute: async ({ platform, text, hook, visualIdea, hashtags }) => {
      const tags = (hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
      const full = tags ? `${text.trim()}\n\n${tags}` : text.trim();
      const limit = PLATFORM_LIMITS[platform];
      const result: {
        platform: string;
        text: string;
        hook?: string;
        visualIdea?: string;
        chars: number;
        limit: number;
        tooLong: boolean;
        postUrl?: string;
        note: string;
      } = {
        platform,
        text: full,
        hook,
        visualIdea,
        chars: [...full].length,
        limit,
        tooLong: [...full].length > limit,
        note: "Entwurf. Terence postet selbst.",
      };
      if (platform === "x") result.postUrl = `https://x.com/intent/post?text=${encodeURIComponent(full)}`;
      if (platform === "threads")
        result.postUrl = `https://www.threads.net/intent/post?text=${encodeURIComponent(full)}`;
      return result;
    },
  }),

  getVelaRepoStatus: tool({
    description:
      "Aktueller Stand des Vela-GitHub-Repos: Sterne, Forks, letzte Commits, offene Issues/PRs (öffentliche GitHub-API).",
    inputSchema: z.object({}),
    execute: async () => {
      const base = `/repos/${VELA_REPO.owner}/${VELA_REPO.repo}`;
      try {
        const [repo, commits, issues] = await Promise.all([
          gh<{
            stargazers_count: number;
            forks_count: number;
            watchers_count: number;
            open_issues_count: number;
            pushed_at: string;
            html_url: string;
          }>(base),
          gh<{ sha: string; commit: { message: string; author: { date: string } } }[]>(`${base}/commits?per_page=6`),
          gh<{ number: number; title: string; pull_request?: unknown; html_url: string }[]>(
            `${base}/issues?state=open&per_page=20`,
          ),
        ]);
        const fmt = (iso: string) =>
          new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", dateStyle: "medium", timeStyle: "short" }).format(
            new Date(iso),
          );
        return {
          url: repo.html_url,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          lastPush: fmt(repo.pushed_at),
          recentCommits: commits.map((c) => ({
            sha: c.sha.slice(0, 7),
            date: fmt(c.commit.author.date),
            message: c.commit.message.split("\n")[0],
          })),
          openIssues: issues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title })),
          openPullRequests: issues.filter((i) => i.pull_request).length,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "GitHub nicht erreichbar" };
      }
    },
  }),

  saveIdea: tool({
    description:
      "Speichert eine Marketing-Idee in Terences Ideen-Liste (im Browser gespeichert, exportierbar). Nur speichern, wenn Terence es will oder eine Idee klar festgehalten werden soll.",
    inputSchema: z.object({
      title: z.string().describe("Kurzer Titel"),
      detail: z.string().describe("1–4 Sätze: was, warum, wie"),
      channel: z.string().optional().describe("z. B. TikTok, X, Instagram, Reddit, Offline, Presse"),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ title, detail, channel, tags }) => ({
      id: `idea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      detail,
      channel,
      tags: tags ?? [],
      createdAt: new Date().toISOString(),
      saved: true,
    }),
  }),
};

export const allTools = { ...jarvisTools, ...marketingTools };
