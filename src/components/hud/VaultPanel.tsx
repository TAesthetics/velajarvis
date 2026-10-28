"use client";

import { useState } from "react";
import { DOC_KINDS, PLATFORM_NAMES, download, vaultMarkdown, type Vault } from "@/lib/vault";

export default function VaultPanel({
  vault,
  onClose,
  onDeleteIdea,
  onDeleteDraft,
  onDeleteDoc,
  initialTab = "drafts",
}: {
  vault: Vault;
  onClose: () => void;
  onDeleteIdea: (id: string) => void;
  onDeleteDraft: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  initialTab?: "drafts" | "ideas" | "docs";
}) {
  const [tab, setTab] = useState<"drafts" | "ideas" | "docs">(initialTab);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };
  return (
    <div role="dialog" aria-label="Vault: Ideen & Entwürfe" className="panel-in absolute inset-x-3 bottom-3 top-16 z-40 flex flex-col rounded-2xl border border-accent-400/30 bg-bg/90 shadow-[0_0_40px_rgb(var(--glow)/0.2)] backdrop-blur-md select-text sm:inset-x-auto sm:right-5 sm:top-24 sm:bottom-40 sm:w-[380px]">
      <div className="flex items-center justify-between border-b border-accent-400/20 px-4 py-3">
        <div className="flex min-w-0 gap-1">
          {(["drafts", "ideas", "docs"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-full px-2.5 py-1 font-display text-[9px] tracking-[0.15em] ${
                tab === k ? "bg-accent-400/20 text-accent-100" : "text-accent-400/60 hover:text-accent-200"
              }`}
            >
              {k === "drafts" ? `ENTWÜRFE ${vault.drafts.length}` : k === "ideas" ? `IDEEN ${vault.ideas.length}` : `PURPLE ${vault.docs.length}`}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="px-2 text-accent-300/70 hover:text-accent-100">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[13px] leading-snug">
        {tab === "drafts" &&
          (vault.drafts.length === 0 ? (
            <p className="text-accent-400/60">Noch keine Entwürfe. Sag z. B.: „Schreib einen X-Post „über den Schleier.“</p>
          ) : (
            vault.drafts.map((d) => (
              <div key={d.id} className="rounded-xl border border-accent-400/20 bg-accent-950/20 p-3">
                <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-accent-400/80">
                  <span>{PLATFORM_NAMES[d.platform] ?? d.platform}</span>
                  <span className={d.tooLong ? "text-rose-300" : ""}>
                    {d.chars}/{d.limit}
                  </span>
                </div>
                {d.hook && <p className="mb-1 text-accent-200/90">Hook: {d.hook}</p>}
                <p className="whitespace-pre-wrap text-accent-50">{d.text}</p>
                {d.visualIdea && <p className="mt-2 text-[12px] text-accent-300/70">Visual: {d.visualIdea}</p>}
                <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
                  <button type="button" onClick={() => copy(d.id, d.text)} className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10">
                    {copied === d.id ? "kopiert ✓" : "kopieren"}
                  </button>
                  {d.postUrl && (
                    <a href={d.postUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-accent-300/50 px-3 py-1 text-accent-100 hover:bg-accent-400/15">
                      selbst auf {PLATFORM_NAMES[d.platform]} posten ↗
                    </a>
                  )}
                  <button type="button" onClick={() => onDeleteDraft(d.id)} className="ml-auto px-2 text-accent-500/60 hover:text-rose-300">
                    löschen
                  </button>
                </div>
              </div>
            ))
          ))}

        {tab === "ideas" &&
          (vault.ideas.length === 0 ? (
            <p className="text-accent-400/60">Noch keine Ideen. Sag z. B.: „Merk dir die Idee …“</p>
          ) : (
            vault.ideas.map((i) => (
              <div key={i.id} className="rounded-xl border border-accent-400/20 bg-accent-950/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-accent-50">{i.title}</p>
                  {i.channel && <span className="shrink-0 font-mono text-[10px] text-accent-400/80">{i.channel}</span>}
                </div>
                <p className="mt-1 text-accent-100/80">{i.detail}</p>
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => onDeleteIdea(i.id)} className="font-mono text-[11px] text-accent-500/60 hover:text-rose-300">
                    löschen
                  </button>
                </div>
              </div>
            ))
          ))}

        {tab === "docs" &&
          (vault.docs.length === 0 ? (
            <p className="text-accent-400/60">Noch keine Purple-Team-Dokumente. Sag im PURPLE-Modus z. B.: „Plane eine Übung zu Brute Force und leg sie ab.“</p>
          ) : (
            vault.docs.map((d) => (
              <details key={d.id} className="rounded-xl border border-accent-400/20 bg-accent-950/20 p-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-accent-50">{d.title}</p>
                    <span className="shrink-0 font-mono text-[10px] text-accent-400/80">{DOC_KINDS[d.kind] ?? d.kind}</span>
                  </div>
                  {d.techniques.length > 0 && <p className="mt-1 font-mono text-[10px] text-accent-300/80">{d.techniques.join(" · ")}</p>}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-accent-100/90">{d.content}</pre>
                <div className="mt-2 flex gap-2 font-mono text-[11px]">
                  <button type="button" onClick={() => copy(d.id, d.content)} className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10">
                    {copied === d.id ? "kopiert ✓" : "kopieren"}
                  </button>
                  <button type="button" onClick={() => onDeleteDoc(d.id)} className="ml-auto px-2 text-accent-500/60 hover:text-rose-300">
                    löschen
                  </button>
                </div>
              </details>
            ))
          ))}
      </div>

      <div className="flex gap-2 border-t border-accent-400/20 px-4 py-3 font-mono text-[11px]">
        <button
          type="button"
          onClick={() => download("vela-ideen.md", vaultMarkdown(vault), "text/markdown")}
          className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10"
        >
          Export .md
        </button>
        <button
          type="button"
          onClick={() => download("vela-ideen.json", JSON.stringify(vault, null, 2), "application/json")}
          className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10"
        >
          Export .json
        </button>
        <span className="ml-auto self-center text-accent-500/50">nur in diesem Browser</span>
      </div>
    </div>
  );
}
