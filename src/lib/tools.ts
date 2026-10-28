import { tool } from "ai";
import { z } from "zod";

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
