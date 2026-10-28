// Refreshes src/data/attack-techniques.json from the public MITRE CTI repo (enterprise-attack).
// Usage: node scripts/update-attack.mjs
import { writeFileSync } from "node:fs";

const SRC = "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json";
const res = await fetch(SRC);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const bundle = await res.json();
const clip = (s, n) => {
  const t = (s ?? "").replace(/\(Citation:[^)]*\)/g, "").replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s\S*$/, "") + " …" : t;
};
const byId = new Map(bundle.objects.map((o) => [o.id, o]));
const extId = (o) => (o?.external_references ?? []).find((r) => r.source_name === "mitre-attack")?.external_id;
const detections = new Map();
const mitigations = new Map();
for (const r of bundle.objects) {
  if (r.type !== "relationship" || r.revoked || r.x_mitre_deprecated) continue;
  const src = byId.get(r.source_ref);
  if (!src || src.revoked || src.x_mitre_deprecated) continue;
  const bucket = r.relationship_type === "detects" ? detections : r.relationship_type === "mitigates" ? mitigations : null;
  if (!bucket) continue;
  const label = src.type === "course-of-action" ? `${extId(src) ?? ""} ${src.name}`.trim() : src.name;
  if (!bucket.has(r.target_ref)) bucket.set(r.target_ref, []);
  bucket.get(r.target_ref).push(label);
}
const techniques = bundle.objects
  .filter((o) => o.type === "attack-pattern" && !o.revoked && !o.x_mitre_deprecated)
  .map((o) => {
    const ref = (o.external_references ?? []).find((r) => r.source_name === "mitre-attack");
    return {
      id: ref?.external_id,
      name: o.name,
      tactics: (o.kill_chain_phases ?? []).filter((k) => k.kill_chain_name === "mitre-attack").map((k) => k.phase_name),
      platforms: o.x_mitre_platforms ?? [],
      description: clip(o.description, 420),
      detection: clip(o.x_mitre_detection, 360),
      detectionStrategies: (detections.get(o.id) ?? []).slice(0, 4),
      mitigations: (mitigations.get(o.id) ?? []).slice(0, 6),
      url: ref?.url,
    };
  })
  .filter((t) => t.id)
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
const matrix = bundle.objects.find((o) => o.type === "x-mitre-matrix");
const version = matrix?.modified?.slice(0, 10) ?? "unknown";
writeFileSync(
  new URL("../src/data/attack-techniques.json", import.meta.url),
  JSON.stringify({ source: SRC, version, fetchedAt: new Date().toISOString().slice(0, 10), techniques }),
);
console.log(`wrote ${techniques.length} techniques (ATT&CK modified ${version})`);
