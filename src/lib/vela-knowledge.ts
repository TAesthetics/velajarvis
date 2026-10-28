/**
 * Vela knowledge base, injected into the system prompt.
 * Source: github.com/TAesthetics/vela (README, app copy, commit history, read 28.10.2026)
 * plus the preliminary brand line from Terence's CMO assistant.
 * Extend the CHANNELS / LAUNCH section below once they are decided.
 */

export const VELA_REPO = { owner: "TAesthetics", repo: "vela" } as const;

export const VELA_KNOWLEDGE = `
## VELA – Wissensbasis

### Was ist Vela?
Vela ist eine Open-Source-Dating-App gegen oberflächliches Swipen. Profilbilder liegen hinter einem Schleier und werden erst sichtbar, nachdem beide ein paar echte Nachrichten ausgetauscht haben. Erst die Persönlichkeit, dann das Foto.
- Tagline: "Erst kennenlernen, dann sehen." (EN: "Get to know them first, then see them.")
- Repo: https://github.com/TAesthetics/vela (MIT-Lizenz, öffentlich). Gründer/Entwickler: Terence (Österreich).
- Status: in aktiver Entwicklung, noch nicht öffentlich gelauncht. Keine Nutzerzahlen vorhanden.

### Kernbotschaften (in dieser Reihenfolge)
1. Der Schleier: kein Urteil nach einem einzigen Foto. Bilder lösen sich erst nach einem echten Gespräch auf (beidseitig).
2. Open Source: jede und jeder kann nachvollziehen, wie Matching und Datenschutz funktionieren, und mitbauen.
3. Ohne KI: keine Algorithmen, die dich bewerten. Menschen lesen Sätze, nicht Scores. (Sogar die Altersprüfung machen Menschen, nicht KI.)
4. Datenschutz zuerst: transparent statt Blackbox.

### Was es in der App schon gibt (Stand Repo, Oktober 2026)
- Profil aus Sätzen: Vorname, Prompts wie "Mein simples Glück", "Eine grüne Flagge", "Ich bin überzeugt, dass", "Nach dem dritten Date", "Worüber ich zu viel rede".
- "Orbits" = Absicht zuerst: Langsam, Abenteuer, Tiefgang, Leicht, Echt. "Gleiche Absicht zuerst. Nicht gleiche Optik."
- Man "funkt" auf einen Gedanken, nicht auf ein Gesicht. Kostenlos 12 Swipes pro Tag.
- Vela+ (nur Vorschau, ohne Abbuchung): sehen, wer zurückfunken würde, unbegrenzte Swipes, Rückgängig.
- Sicherheit: Blockieren und Melden, nur ab 18 (Pflicht-Bestätigung, menschliche Prüfung mit Ausweis-Upload bei Verdacht).
- DSGVO: Konto löschen inkl. Login und Sitzungen; Meldungen nach 12 Monaten, Ausweisbilder nach 30 Tagen automatisch gelöscht.
- App-Sprache: "Der Schleier bleibt. Schreibt erst. Dann seht ihr euch." / "Darauf werden andere funken. Nicht auf dein Kinn."

### Zielgruppe (vorläufig)
- Menschen, die vom Swipen müde sind und echte Gespräche wollen.
- Open-Source-/Tech-Community als frühe Unterstützer (Contributors, Sterne, Feedback).
- Launch: Österreich / DACH.

### Tonalität für Vela-Texte (öffentlich)
Warm, ehrlich, ein bisschen rebellisch gegen die Swipe-Kultur, nie zynisch. Deutsch, informelles "du".

### No-Gos
- Keine erfundenen Zahlen oder Nutzerstatistiken.
- Keine Versprechen über KI-Matching (Vela hat bewusst keine KI).
- Fotos/Aussehen nicht in den Vordergrund stellen.
- Keine Konkurrenten namentlich schlechtmachen.
- Keine Features versprechen, die es noch nicht gibt (App in aktiver Entwicklung).
- Öffentliche Texte NIE in der Schwarm-/KI-Stimme und Vela NIE als KI-gemacht darstellen.

### Kanäle & Launch-Fokus
(noch offen – wird von Terence ergänzt)
`.trim();
