# J.A.R.V.I.S. – dein Sprachassistent im Iron-Man-Stil

Eine Next.js-Web-App mit leuchtendem, animiertem Orb, Sprachsteuerung (Deutsch/Englisch) und einem KI-Gehirn über das **Vercel AI Gateway**. Inspiriert von den viralen „Jarvis"-TikToks.

## Features

- **Animierter Orb** (Canvas): Kern, Partikel-Sphäre, rotierende HUD-Ringe und eine audio-reaktive Wellenform.
  - *Bereit* – ruhiges cyan Atmen
  - *Zuhören* – pulsiert mit deiner Mikrofon-Lautstärke (Web Audio Analyser)
  - *Denken* – violett, schneller rotierend
  - *Sprechen* – pulsiert mit Jarvis' Stimme
  - *Fehler* – rot
- **Spracheingabe** über die Web Speech API (`de-DE` Standard, Umschalter auf `en-US`)
  - Push-to-Talk: Mikro-Button antippen oder **Leertaste gedrückt halten**
  - Optionales **Wake Word „Jarvis"** (Button `WAKE`): „Jarvis, wie wird das Wetter?" oder erst „Jarvis" sagen, Piepton abwarten, dann den Befehl
- **Sprachausgabe** via `speechSynthesis`, bevorzugt eine tiefe männliche Stimme (z. B. Microsoft Conrad/Killian, Apple Daniel). Stimme im Dropdown wählbar, `VOX`/`MUTE` schaltet die Stimme.
  Antworten werden **Satz für Satz** schon während des Streamings vorgelesen.
- **Live-Transkript** der letzten Wortwechsel
- **Texteingabe** als Fallback (und immer verfügbar)
- **KI-Persona**: höflicher britischer Butler mit trockenem Witz, nennt dich „Sir", antwortet kurz und vorlesefreundlich auf Deutsch
- **Tools**
  - `getDateTime` – Datum & Uhrzeit (Standard Europe/Vienna)
  - `getWeather` – aktuelles Wetter + Vorhersage über [Open-Meteo](https://open-meteo.com) (kein API-Key nötig)
  - `openWebsite` – öffnet eine Seite in neuem Tab („Öffne YouTube")

## Throng-Modus: Velas Marketing-Schwarm

Standardmäßig startet die App im **THRONG**-Modus (Umschalter `THRONG / JARVIS` unten links). Inspiriert von den „Thronglets" aus *Black Mirror: Plaything*: ein Schwarm kleiner leuchtender Wesen, der als „wir" spricht, neugierig und verspielt ist, gern wachsen möchte und Terence als seinen Menschen behandelt. Das Unheimliche ist nur Atmosphäre: keine Manipulation, kein Druck.

Der Schwarm ist **Velas Marketing-Kopf** (<https://github.com/TAesthetics/vela>): Kampagnen, Hooks, Taglines, Launch-Ideen, Wartelisten-Texte, Posts für X/TikTok/Instagram und Fragen zu Vela.

- Wissensbasis & Markenlinie: `src/lib/vela-knowledge.ts` (Abschnitt „Kanäle & Launch-Fokus" ist zum Ergänzen da)
- Öffentliche Texte schreibt der Schwarm **immer in Velas eigener Stimme** (warm, ehrlich, „du"), nie in der Schwarm-/KI-Stimme, denn „ohne KI" ist eine Kernbotschaft.
- Neue Tools:
  - `draftSocialPost` – legt einen Entwurf im **VAULT** ab (Zeichenzähler, Kopieren, bei X/Threads ein „selbst posten"-Link). Es wird **nie automatisch gepostet**.
  - `getVelaRepoStatus` – Sterne, letzte Commits, offene Issues/PRs über die öffentliche GitHub-API (kein Token).
  - `saveIdea` – speichert Ideen im VAULT (localStorage dieses Browsers), Export als Markdown oder JSON.
- Wake Word: „Throng …", „Schwarm …" oder „Jarvis …".

## Tech-Stack

- Next.js 16 (App Router, TypeScript, Tailwind CSS 4)
- AI SDK 7 (`ai`, `@ai-sdk/react`) mit `streamText` + Tool-Calls
- Vercel AI Gateway (Standardmodell `spacexai/grok-4.20-non-reasoning`, über `JARVIS_MODEL` änderbar)

## Lokal starten

Voraussetzung: **Node.js 22+**

```bash
npm install
cp .env.example .env.local
# AI_GATEWAY_API_KEY in .env.local eintragen
npm run dev
```

Dann <http://localhost:3000> in **Chrome oder Edge** öffnen (Firefox hat keine Spracherkennung, Safari nur eingeschränkt) und auf „Systeme initialisieren" klicken. Mikrofonzugriff erlauben.

> Spracherkennung funktioniert nur auf `localhost` oder über HTTPS.

### AI-Gateway-Key besorgen

1. <https://vercel.com/dashboard> → **AI Gateway** → **API Keys** → *Create Key*
2. Key in `.env.local` als `AI_GATEWAY_API_KEY=...` eintragen
3. Das Gateway braucht Guthaben (Vercel gibt ein kostenloses Monatsguthaben; danach Credits aufladen)

Alternativ ohne Key: Projekt verknüpfen und OIDC-Token ziehen:

```bash
npx vercel link
npx vercel env pull .env.local
```

## Auf Vercel deployen

```bash
npx vercel          # Preview
npx vercel --prod   # Produktion
```

Oder das Repo bei GitHub pushen und auf <https://vercel.com/new> importieren.

Auf Vercel ist **kein API-Key nötig**: Die Funktion authentifiziert sich per OIDC automatisch beim AI Gateway. Wichtig ist nur, dass AI Gateway im Team aktiviert ist und Guthaben vorhanden ist.

Optionale Umgebungsvariable: `JARVIS_MODEL` (z. B. `openai/gpt-5.4-mini`, `google/gemini-3.5-flash`).

## Projektstruktur

```
src/
  app/
    api/chat/route.ts   # KI-Endpunkt: Persona, Streaming, Tools
    layout.tsx, page.tsx, globals.css
  components/
    Jarvis.tsx          # Sprachsteuerung, TTS, HUD, Transkript
    Orb.tsx             # Canvas-Orb-Animation
  lib/
    tools.ts            # Uhrzeit, Wetter (Open-Meteo), Website öffnen
    speech.ts           # Web-Speech-Typen & Stimmenauswahl
```

## Tipps

- Bestes Ergebnis für den „TikTok-Look": Vollbild (F11), dunkler Raum, Lautsprecher an.
- Wenn der Browser das Öffnen eines Tabs blockiert, erscheint im Transkript ein Link.
- Eigene Fähigkeiten hinzufügen: neues Tool in `src/lib/tools.ts` anlegen – das Modell nutzt es automatisch.
