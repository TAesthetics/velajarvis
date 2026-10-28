"use client";

export const TOOL_LABELS: Record<string, string> = {
  draftSocialPost: "Entwurf abgelegt",
  saveIdea: "Idee gespeichert",
  getVelaRepoStatus: "Repo gelesen",
  getDateTime: "Uhrzeit",
  getWeather: "Wetter",
  openWebsite: "Website",
};

export type LogEntry = { id: string; role: string; text: string; tools: string[]; links: string[] };

/** Full conversation history (the stage only shows short subtitles). */
export default function LogPanel({
  entries,
  aiLabel,
  userLabel,
  onClose,
}: {
  entries: LogEntry[];
  aiLabel: string;
  userLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Gesprächsverlauf"
      className="panel-in absolute inset-x-3 bottom-3 top-16 z-40 flex flex-col rounded-2xl border border-accent-400/30 bg-bg/90 shadow-[0_0_40px_rgb(var(--glow)/0.2)] backdrop-blur-md select-text sm:inset-x-auto sm:left-5 sm:top-24 sm:bottom-40 sm:w-[380px]"
    >
      <div className="flex items-center justify-between border-b border-accent-400/20 px-4 py-3">
        <span className="font-display text-[10px] tracking-[0.25em] text-accent-200">VERLAUF</span>
        <button type="button" onClick={onClose} aria-label="Schließen" className="px-2 text-accent-300/70 hover:text-accent-100">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[14px] leading-snug">
        {entries.length === 0 && <p className="text-accent-400/60">Noch nichts gesagt.</p>}
        {entries.map((m) => (
          <p key={m.id} className={`break-words ${m.role === "user" ? "text-slate-300/80" : "text-accent-100"}`}>
            <span className={`mr-2 font-mono text-[10px] ${m.role === "user" ? "text-slate-400" : "text-accent-400"}`}>
              {m.role === "user" ? userLabel : aiLabel}
            </span>
            {m.tools.length > 0 && (
              <span className="mr-1 font-mono text-[11px] text-accent-500/80">[{m.tools.map((x) => TOOL_LABELS[x] ?? x).join(", ")}]</span>
            )}
            {m.text}
            {m.links.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="ml-2 font-mono text-[11px] text-accent-300 underline">
                ↗ {safeHost(url)}
              </a>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}

export function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
