import { generateText } from "ai";
import { jarvisTools, marketingTools } from "@/lib/tools";
import { personaPrompt, type Lang, type Mode } from "@/lib/personas";
import { limitSentences, longDate, morningTask, repoLine, viennaHour, weatherLine } from "@/lib/morning";

export const maxDuration = 30;
const MODEL = process.env.JARVIS_MODEL || "openai/gpt-4.1-mini";

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Builds today's greeting in the active persona from live weather (Open-Meteo) and the Vela repo status. */
export async function POST(req: Request) {
  const { mode, lang, population, siem }: { mode?: Mode; lang?: Lang; population?: number; siem?: string } = await req.json();
  const m: Mode = mode === "jarvis" || mode === "purple" ? mode : "throng";
  const l: Lang = lang === "en-US" ? "en-US" : "de-DE";
  const now = new Date();
  const opts = { toolCallId: "morning", messages: [], context: {} } as unknown as Parameters<NonNullable<typeof jarvisTools.getWeather.execute>>[1];
  const [weather, repo] = await Promise.all([
    withTimeout(Promise.resolve(jarvisTools.getWeather.execute!({ location: "Wien" }, opts)), 6000),
    withTimeout(Promise.resolve(marketingTools.getVelaRepoStatus.execute!({}, opts)), 6000),
  ]);
  const nowLabel = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", dateStyle: "full", timeStyle: "short" }).format(now);
  const task = morningTask({
    mode: m,
    lang: l,
    hour: viennaHour(now),
    date: longDate(now, l),
    weather: weatherLine(weather as Parameters<typeof weatherLine>[0]),
    repo: repoLine(repo as Parameters<typeof repoLine>[0], now),
    siem: typeof siem === "string" ? siem : undefined,
  });
  try {
    const { text } = await generateText({
      model: MODEL,
      instructions: personaPrompt(m, l, nowLabel, {
        population: typeof population === "number" && population > 0 && population < 10_000 ? population : undefined,
        siem: typeof siem === "string" ? siem.slice(0, 3000) : undefined,
      }),
      prompt: task,
    });
    return Response.json({ text: limitSentences(text.trim(), 3) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[morning]", e);
    return Response.json({ error: "Gruß konnte nicht erzeugt werden." }, { status: 502 });
  }
}
