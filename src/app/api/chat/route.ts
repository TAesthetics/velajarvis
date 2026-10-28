import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { allTools } from "@/lib/tools";
import { personaPrompt, type Lang, type Mode } from "@/lib/personas";

export const maxDuration = 30;

const MODEL = process.env.JARVIS_MODEL || "openai/gpt-4.1-mini";

export async function POST(req: Request) {
  const {
    messages,
    lang,
    mode,
    population,
    siem,
  }: { messages: UIMessage[]; lang?: Lang; mode?: Mode; population?: number; siem?: string } = await req.json();

  if (!process.env.VERCEL && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json(
      {
        error:
          "Kein AI-Gateway-Zugang konfiguriert. Setze AI_GATEWAY_API_KEY in .env.local oder nutze `vercel env pull` (OIDC).",
      },
      { status: 500 },
    );
  }

  const l: Lang = lang === "en-US" ? "en-US" : "de-DE";
  const now = new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Vienna",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());

  const result = streamText({
    model: MODEL,
    instructions: personaPrompt(mode, l, now, {
      population: typeof population === "number" && population > 0 && population < 10_000 ? population : undefined,
      siem: typeof siem === "string" ? siem.slice(0, 3000) : undefined,
    }),
    messages: await convertToModelMessages(messages),
    tools: allTools,
    stopWhen: isStepCount(6),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: allTools,
      onError: (error) => {
        console.error("[throng] stream error", error);
        const msg = error instanceof Error ? error.message : String(error);
        if (/credit|insufficient|402/i.test(msg))
          return "AI Gateway: Guthaben/Credits fehlen. Bitte im Vercel-Dashboard AI Gateway aktivieren.";
        if (/auth|401|403|token|api key/i.test(msg))
          return "AI Gateway: Authentifizierung fehlgeschlagen (API-Key/OIDC prüfen).";
        return "Verbindung zum Kern gestört.";
      },
    }),
  });
}
