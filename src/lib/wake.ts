/**
 * Fuzzy wake-word matching for "Jarvis" / "Throng".
 * German speech recognition mangles both words a lot ("Service", "Travis", "Thron", "strong" …),
 * so we combine an explicit variant list with a small Levenshtein tolerance.
 */

export type WakeWord = "jarvis" | "throng";

export type WakeMatch = {
  word: WakeWord;
  /** the raw token(s) that matched */
  heard: string;
  /** everything said after the wake word (original casing), may be "" */
  command: string;
};

const VARIANTS: Record<WakeWord, string[]> = {
  jarvis: [
    "jarvis", "jarvi", "jarvys", "javis", "jawis", "jarwis", "jervis", "travis", "service", "servis",
    "charvis", "charvys", "tschawis", "tscharvis", "dschawis", "dscharvis", "dschawis", "harvis",
    "garvis", "chavis", "shavis", "sharvis", "jaavis", "davis",
  ],
  throng: [
    "throng", "throngs", "thron", "throne", "thrown", "strong", "drong", "trong", "throng's",
    "throm", "schwarm", "thrones",
  ],
};

const CANONICAL: Record<WakeWord, string[]> = {
  jarvis: ["jarvis"],
  throng: ["throng", "schwarm"],
};

// Words that may precede the wake word and should be dropped ("Hey Jarvis", "Okay Throng").
const PREFIXES = new Set(["hey", "hei", "hej", "hi", "hallo", "ok", "okay", "oke", "yo", "he", "ey", "eh", "na"]);

// Common words that look close to a wake word but must never trigger it.
const STOPWORDS = new Set(["paris", "davos", "thema", "strom", "trotz", "throw", "drum", "strand", "jarvis's"]);

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (ä -> a)
    .replace(/[^a-z0-9ß' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Which wake word (if any) a single normalized token is. */
export function tokenWakeWord(token: string): WakeWord | null {
  const t = token.replace(/'s$/, "");
  if (t.length < 4 || STOPWORDS.has(t)) return null;
  for (const w of Object.keys(VARIANTS) as WakeWord[]) {
    if (VARIANTS[w].includes(t)) return w;
  }
  if (t.length > 9) return null;
  // fuzzy: tolerance 2 when the onset sounds similar (j/t/d/s/c/g/z/ch/sch), else 1
  const softOnset = /^(j|t|d|s|c|g|z)/.test(t);
  for (const w of Object.keys(CANONICAL) as WakeWord[]) {
    for (const c of CANONICAL[w]) {
      const d = levenshtein(t, c);
      if (d <= (softOnset ? 2 : 1) && Math.abs(t.length - c.length) <= 2) return w;
    }
  }
  return null;
}

/**
 * Find the first wake word in a transcript.
 * Also handles split tokens ("jar vis", "thr ong") and drops a leading "hey/okay".
 */
export function findWakeWord(transcript: string): WakeMatch | null {
  const original = transcript.trim().split(/\s+/).filter(Boolean);
  const norm = original.map((t) => normalize(t));
  for (let i = 0; i < norm.length; i++) {
    const tok = norm[i];
    if (!tok) continue;
    let word = tokenWakeWord(tok);
    let used = 1;
    if (!word && i + 1 < norm.length) {
      word = tokenWakeWord(tok + norm[i + 1]);
      if (word) used = 2;
    }
    if (word) {
      const command = original
        .slice(i + used)
        .join(" ")
        .replace(/^[\s,.:;!?\-–—]+/, "")
        .trim();
      return { word, heard: original.slice(i, i + used).join(" "), command };
    }
  }
  return null;
}

/** True if the remaining command is only filler ("bitte", "hallo", punctuation). */
export function isEmptyCommand(command: string) {
  const n = normalize(command);
  if (!n) return true;
  return n.split(" ").every((w) => PREFIXES.has(w) || ["bitte", "please", "du", "ihr", "mal"].includes(w));
}
