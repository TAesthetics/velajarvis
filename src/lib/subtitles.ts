/**
 * Splits an assistant reply into short subtitle lines that fit on a phone screen.
 * Each line is also spoken as its own utterance, so the subtitle can follow the voice.
 */

export const SUB_MAX = 64;

/** Strip markdown, URLs and emoji-ish noise so text is pleasant to read and to speak. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapWords(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= max) cur += " " + word;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  // Never leave a lonely one-word tail if it fits on the previous line with a little slack
  if (out.length > 1 && out[out.length - 1].length < 10 && out[out.length - 2].length + out[out.length - 1].length < max + 12) {
    const tail = out.pop()!;
    out[out.length - 1] += " " + tail;
  }
  return out;
}

/** Greedily joins pieces with a separator while the result stays within max. */
function mergeGreedy(pieces: string[], max: number, minLen = 0): string[] {
  const out: string[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (prev.length < minLen || prev.length + 1 + p.length <= max)) {
      if (prev.length + 1 + p.length <= max || prev.length < minLen) {
        out[out.length - 1] = prev + " " + p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function splitSubtitles(text: string, max = SUB_MAX): string[] {
  const clean = cleanForSpeech(text);
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…])\s+(?=\S)/);
  const lines: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) {
      lines.push(s);
      continue;
    }
    // Long sentence: break at clause boundaries first, then at words
    const clauses = s.split(/(?<=[,;:–—])\s+/);
    for (const c of mergeGreedy(clauses, max)) {
      if (c.length <= max) lines.push(c);
      else lines.push(...wrapWords(c, max));
    }
  }
  // Glue very short lines ("Sir." / "Ja.") to the next one if it still fits
  const merged: string[] = [];
  for (const l of lines) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.length < 16 && prev.length + 1 + l.length <= max) merged[merged.length - 1] = prev + " " + l;
    else merged.push(l);
  }
  return merged;
}

/** Rough on-screen time for a line when there is no voice to sync to (muted / no TTS). */
export function readingMs(line: string): number {
  return Math.round(Math.min(7000, Math.max(1400, 600 + line.length * 62)));
}
