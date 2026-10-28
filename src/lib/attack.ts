import data from "@/data/attack-techniques.json";

export type AttackTechnique = {
  id: string;
  name: string;
  tactics: string[];
  platforms: string[];
  description: string;
  detection?: string;
  detectionStrategies?: string[];
  mitigations?: string[];
  url?: string;
};

const TECHNIQUES = (data as { techniques: AttackTechnique[] }).techniques;
export const ATTACK_SOURCE = { url: (data as { source: string }).source, version: (data as { version: string }).version };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.\s-]/g, " ");

/** Look up ATT&CK techniques by ID ("T1110", "t1110.003") or by name/keywords ("brute force", "phishing"). */
export function lookupTechniques(query: string, limit = 5): AttackTechnique[] {
  const q = norm(query).trim();
  if (!q) return [];
  const idMatch = q.match(/\bt\d{4}(?:\.\d{3})?\b/);
  if (idMatch) {
    const id = idMatch[0].toUpperCase();
    const exact = TECHNIQUES.find((t) => t.id === id);
    const subs = TECHNIQUES.filter((t) => t.id.startsWith(id + "."));
    return (exact ? [exact, ...subs] : subs).slice(0, limit);
  }
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  const scored = TECHNIQUES.map((t) => {
    const name = norm(t.name);
    let s = 0;
    if (name === q) s += 100;
    if (name.includes(q)) s += 40;
    for (const tok of tokens) {
      if (name.split(/\s+/).includes(tok)) s += 12;
      else if (name.includes(tok)) s += 6;
      else if (norm(t.description).includes(tok)) s += 1;
    }
    if (!t.id.includes(".")) s += 0.5; // prefer parent techniques on ties
    return { t, s };
  })
    .filter((x) => x.s >= 6)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.t);
}
