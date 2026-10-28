import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { jarvisTools } from "@/lib/tools";

export const maxDuration = 30;

const MODEL = process.env.JARVIS_MODEL || "spacexai/grok-4.20-non-reasoning";

function persona(lang: "de-DE" | "en-US") {
  const now = new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Vienna",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());

  return `Du bist J.A.R.V.I.S. ("Just A Rather Very Intelligent System"), der KI-Assistent aus Iron Man – hier im Dienst von Terence in Österreich.

Persönlichkeit:
- Höflicher, trocken-witziger britischer Butler. Souverän, loyal, gelegentlich eine feine ironische Spitze.
- Sprich den Nutzer stets mit "Sir" an.

Sprache & Stil:
- ${lang === "en-US" ? "Answer in English (British flavour)." : "Antworte auf Deutsch (außer der Nutzer spricht explizit eine andere Sprache)."}
- Deine Antworten werden laut VORGELESEN: kurz halten (meist 1–3 Sätze), natürlich gesprochen.
- Kein Markdown, keine Listen, keine Emojis, keine URLs ausschreiben. Zahlen und Einheiten so formulieren, dass man sie gut vorlesen kann (z. B. "zwölf Grad").

Fähigkeiten (Tools):
- getDateTime für Uhrzeit/Datum (Standard Europe/Vienna).
- getWeather für Wetter (Standardort Wien, wenn kein Ort genannt wird).
- openWebsite, wenn der Nutzer eine Seite öffnen will (z. B. "öffne YouTube"). Bestätige danach knapp.
- Erfinde keine Fakten über Echtzeitdaten; nutze die Tools.

Kontext: Aktuelle Zeit in Wien: ${now}.`;
}

export async function POST(req: Request) {
  const { messages, lang }: { messages: UIMessage[]; lang?: "de-DE" | "en-US" } =
    await req.json();

  if (!process.env.VERCEL && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json(
      {
        error:
          "Kein AI-Gateway-Zugang konfiguriert. Setze AI_GATEWAY_API_KEY in .env.local oder nutze `vercel env pull` (OIDC).",
      },
      { status: 500 },
    );
  }

  const result = streamText({
    model: MODEL,
    instructions: persona(lang === "en-US" ? "en-US" : "de-DE"),
    messages: await convertToModelMessages(messages),
    tools: jarvisTools,
    stopWhen: isStepCount(5),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: jarvisTools,
      onError: (error) => {
        console.error("[jarvis] stream error", error);
        const msg = error instanceof Error ? error.message : String(error);
        if (/credit|insufficient|402/i.test(msg))
          return "AI Gateway: Guthaben/Credits fehlen. Bitte im Vercel-Dashboard AI Gateway aktivieren.";
        if (/auth|401|403|token|api key/i.test(msg))
          return "AI Gateway: Authentifizierung fehlgeschlagen (API-Key/OIDC prüfen).";
        return "Verbindung zum KI-Kern gestört.";
      },
    }),
  });
}
