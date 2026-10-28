/** Ideas & post drafts the swarm collected. Stored only in this browser (localStorage). */
export type Idea = { id: string; title: string; detail: string; channel?: string; tags?: string[]; createdAt: string };
export type Draft = {
  id: string;
  platform: string;
  text: string;
  hook?: string;
  visualIdea?: string;
  chars: number;
  limit: number;
  tooLong: boolean;
  postUrl?: string;
  createdAt: string;
};
export type PurpleDoc = {
  id: string;
  kind: "scenario" | "detection" | "playbook" | "checklist" | "report";
  title: string;
  content: string;
  techniques: string[];
  createdAt: string;
};
export type Vault = { ideas: Idea[]; drafts: Draft[]; docs: PurpleDoc[] };
export const EMPTY_VAULT: Vault = { ideas: [], drafts: [], docs: [] };
export const DOC_KINDS: Record<PurpleDoc["kind"], string> = {
  scenario: "Szenario",
  detection: "Detection",
  playbook: "Playbook",
  checklist: "Checkliste",
  report: "Bericht",
};

export const VAULT_KEY = "throng.vela.vault.v1";

export function loadVault(): Vault {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return { ...EMPTY_VAULT };
    const v = JSON.parse(raw) as Partial<Vault>;
    return { ideas: v.ideas ?? [], drafts: v.drafts ?? [], docs: v.docs ?? [] };
  } catch {
    return { ...EMPTY_VAULT };
  }
}

export function saveVault(v: Vault) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(v));
  } catch {}
}

export function vaultMarkdown(v: Vault) {
  const lines = [`# Vela – Ideen & Entwürfe`, ``, `Export: ${new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" })}`, ``, `## Ideen`, ``];
  for (const i of v.ideas) {
    lines.push(`### ${i.title}${i.channel ? ` (${i.channel})` : ""}`, ``, i.detail, ``);
    if (i.tags?.length) lines.push(`Tags: ${i.tags.join(", ")}`, ``);
  }
  lines.push(`## Post-Entwürfe`, ``);
  for (const d of v.drafts) {
    lines.push(`### ${PLATFORM_NAMES[d.platform] ?? d.platform}`, ``);
    if (d.hook) lines.push(`**Hook:** ${d.hook}`, ``);
    lines.push(d.text, ``);
    if (d.visualIdea) lines.push(`**Visual:** ${d.visualIdea}`, ``);
  }
  if (v.docs.length) {
    lines.push(`## Purple Team`, ``);
    for (const d of v.docs) {
      lines.push(`### ${DOC_KINDS[d.kind] ?? d.kind}: ${d.title}`, ``);
      if (d.techniques.length) lines.push(`ATT&CK: ${d.techniques.join(", ")}`, ``);
      lines.push(d.content, ``);
    }
  }
  return lines.join("\n");
}

export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const PLATFORM_NAMES: Record<string, string> = {
  x: "X",
  tiktok: "TikTok",
  instagram: "Instagram",
  threads: "Threads",
  linkedin: "LinkedIn",
};
