// Minimal typings for the Web Speech API (not in TS lib.dom for all versions)
export interface SRAlternative {
  transcript: string;
  confidence: number;
}
export interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
}
export interface SRResultEvent {
  resultIndex: number;
  results: { length: number; [index: number]: SRResult };
}
export interface SRErrorEvent {
  error: string;
  message?: string;
}
export interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRec;

export function getSpeechRecognition(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MALE_HINTS = [
  // English (British butler first)
  "daniel",
  "google uk english male",
  "ryan",
  "arthur",
  "oliver",
  "george",
  "thomas",
  "alfie",
  "brian",
  "guy",
  // German
  "conrad",
  "killian",
  "jonas",
  "stefan",
  "florian",
  "markus",
  "yannick",
  "martin",
  "hans",
  "bernd",
  "male",
  "mann",
];

/** Pick the best (ideally deep, male) voice for a language. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, preferredURI?: string) {
  if (preferredURI) {
    const v = voices.find((x) => x.voiceURI === preferredURI);
    if (v) return v;
  }
  const prefix = lang.slice(0, 2).toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  const exact = sameLang.filter((v) => v.lang.toLowerCase() === lang.toLowerCase());
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    const idx = MALE_HINTS.findIndex((h) => n.includes(h));
    if (idx >= 0) s += 100 - idx;
    if (/natural|neural|online|premium|enhanced/.test(n)) s += 20;
    if (lang === "en-US" && v.lang.toLowerCase() === "en-gb") s += 30; // British Jarvis
    if (v.lang.toLowerCase() === lang.toLowerCase()) s += 5;
    return s;
  };
  const pool = sameLang.length ? sameLang : exact;
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}
