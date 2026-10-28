"use client";

import { useRef, useState } from "react";
import type { Alert, SiemCounters, Severity, TimelineBucket } from "@/lib/siem";

const SEV_STYLE: Record<Severity, string> = {
  critical: "border-rose-400/70 bg-rose-500/20 text-rose-100",
  high: "border-rose-300/50 bg-rose-400/10 text-rose-200",
  medium: "border-amber-300/50 bg-amber-400/10 text-amber-100",
  low: "border-accent-300/40 bg-accent-400/10 text-accent-100",
};
const SEV_LABEL: Record<Severity, string> = { critical: "KRITISCH", high: "HOCH", medium: "MITTEL", low: "NIEDRIG" };
const TOKEN_KEY = "purple.siem.token";

const fmt = (t: number) =>
  new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t));

/** Mini-SIEM: ingest own logs, see ATT&CK-mapped alerts, a timeline and counters. */
export default function SiemPanel({
  alerts,
  counters,
  timeline,
  onIngest,
  onClear,
  onSummarize,
  onClose,
}: {
  alerts: Alert[];
  counters: SiemCounters;
  timeline: TimelineBucket[];
  onIngest: (text: string, label: string) => number;
  onClear: () => void;
  onSummarize: () => void;
  onClose: () => void;
}) {
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [token, setToken] = useState(() => (typeof window === "undefined" ? "" : (localStorage.getItem(TOKEN_KEY) ?? "")));
  const fileRef = useRef<HTMLInputElement>(null);
  const maxBar = Math.max(1, ...timeline.map((b) => b.total));

  const ingest = (text: string, label: string) => {
    const n = onIngest(text, label);
    setNote(n ? `${n} Events aus ${label} übernommen.` : `Keine Events in ${label} erkannt.`);
  };

  const pullServer = async () => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      const res = await fetch("/api/siem/events", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const j = await res.json();
      if (!res.ok) return setNote(`Server: ${j.error ?? res.status}`);
      ingest(JSON.stringify(j.events ?? []), "Server-Puffer");
    } catch {
      setNote("Server nicht erreichbar.");
    }
  };

  return (
    <div
      role="dialog"
      aria-label="SIEM"
      className="panel-in absolute inset-x-3 bottom-3 top-16 z-40 flex flex-col rounded-2xl border border-accent-400/30 bg-bg/92 shadow-[0_0_40px_rgb(var(--glow)/0.25)] backdrop-blur-md select-text sm:inset-x-auto sm:right-5 sm:top-24 sm:bottom-40 sm:w-[420px]"
    >
      <div className="flex items-center justify-between border-b border-accent-400/20 px-4 py-3">
        <span className="font-display text-[10px] tracking-[0.25em] text-accent-200">SIEM · PURPLE</span>
        <button type="button" onClick={onClose} aria-label="Schließen" className="px-2 text-accent-300/70 hover:text-accent-100">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-[13px] leading-snug">
        {/* Counters */}
        <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
          {[
            ["EVENTS", counters.events],
            ["IPs", counters.ips],
            ["LOGIN ✗", counters.authFail],
            ["4xx/5xx", `${counters.http4xx}/${counters.http5xx}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-accent-400/20 bg-accent-950/30 px-1 py-1.5">
              <div className="text-[13px] text-accent-50 tabular-nums">{v}</div>
              <div className="text-[8px] tracking-widest text-accent-400/80">{k}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <span key={s} className={`rounded-full border px-2 py-0.5 ${SEV_STYLE[s]}`}>
              {SEV_LABEL[s]} {counters.alerts[s]}
            </span>
          ))}
        </div>

        {/* Timeline */}
        {timeline.length > 0 && (
          <div>
            <div className="mb-1 flex justify-between font-mono text-[9px] text-accent-400/70">
              <span>{fmt(timeline[0].start)}</span>
              <span>Zeitleiste (Wiener Zeit)</span>
              <span>{counters.last ? fmt(counters.last) : ""}</span>
            </div>
            <div className="flex h-16 items-end gap-[2px]" aria-label="Event-Zeitleiste">
              {timeline.map((b) => (
                <div key={b.start} className="relative flex h-full flex-1 flex-col justify-end" title={`${fmt(b.start)}: ${b.total} Events, ${b.errors} Fehler, ${b.alerts} Alerts`}>
                  <div className="w-full rounded-t-sm bg-accent-400/50" style={{ height: `${((b.total - b.errors) / maxBar) * 100}%` }} />
                  <div className="w-full bg-rose-400/80" style={{ height: `${(b.errors / maxBar) * 100}%` }} />
                  {b.alerts > 0 && <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-rose-300 shadow-[0_0_6px_rgba(255,90,120,0.9)]" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alerts */}
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <p className="text-accent-400/70">{counters.events ? "Keine Alerts. Ruhige Lage." : "Noch keine Logs. Einfügen, Datei laden oder Demo-Daten testen."}</p>
          ) : (
            alerts.slice(0, 30).map((a) => (
              <div key={a.id} className="fade-in rounded-xl border border-accent-400/20 bg-accent-950/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-accent-50">{a.title}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] ${SEV_STYLE[a.severity]}`}>{SEV_LABEL[a.severity]}</span>
                </div>
                <p className="mt-1 text-accent-100/85">{a.detail}</p>
                <p className="mt-1 font-mono text-[10px] text-accent-300/80">
                  <a href={`https://attack.mitre.org/techniques/${a.technique.id.replace(".", "/")}/`} target="_blank" rel="noopener noreferrer" className="underline">
                    {a.technique.id} {a.technique.name}
                  </a>{" "}
                  · {a.technique.tactic} · {fmt(a.first)}–{fmt(a.last)}
                </p>
                <p className="mt-1.5 text-[12px] text-emerald-200/90">→ {a.response}</p>
              </div>
            ))
          )}
        </div>

        {/* Ingest */}
        <div className="space-y-2 border-t border-accent-400/20 pt-3">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Logs einfügen: JSON, NDJSON, CSV, syslog, nginx/apache …"
            aria-label="Logs einfügen"
            rows={3}
            className="w-full resize-y rounded-xl border border-accent-400/30 bg-accent-950/30 p-2 font-mono text-[11px] text-accent-50 placeholder:text-accent-500/60 outline-none focus:border-accent-300/70"
          />
          <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
            <button type="button" disabled={!paste.trim()} onClick={() => (ingest(paste, "Einfügen"), setPaste(""))} className="rounded-full border border-accent-300/50 px-3 py-1 text-accent-100 hover:bg-accent-400/15 disabled:opacity-40">
              analysieren
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10">
              Datei …
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.ndjson,.csv,.log,.txt,application/json,text/plain,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 5_000_000) return setNote("Datei zu groß (max. 5 MB).");
                ingest(await f.text(), f.name);
                e.target.value = "";
              }}
            />
            <button type="button" data-testid="siem-demo" onClick={() => ingest("__demo__", "Demo-Daten")} className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10">
              Demo-Daten
            </button>
            <button type="button" onClick={() => setShowServer((s) => !s)} className="rounded-full border border-accent-400/30 px-3 py-1 text-accent-200 hover:bg-accent-400/10">
              Server
            </button>
            <button type="button" onClick={onClear} className="ml-auto px-2 text-accent-500/70 hover:text-rose-300">
              leeren
            </button>
          </div>
          {showServer && (
            <div className="fade-in flex gap-1.5">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="SIEM_INGEST_TOKEN"
                aria-label="Ingest-Token"
                autoComplete="off"
                className="h-8 min-w-0 flex-1 rounded-full border border-accent-400/30 bg-accent-950/30 px-3 font-mono text-[11px] text-accent-50 outline-none"
              />
              <button type="button" onClick={pullServer} disabled={!token} className="rounded-full border border-accent-300/50 px-3 font-mono text-[11px] text-accent-100 disabled:opacity-40">
                abrufen
              </button>
            </div>
          )}
          {note && <p className="font-mono text-[11px] text-accent-300/90">{note}</p>}
          <p className="text-[10px] text-accent-500/70">Nur deine eigenen Logs. Gespeichert in diesem Browser (max. 5000 Events). Der Token bleibt auf diesem Gerät.</p>
        </div>
      </div>

      <div className="flex gap-2 border-t border-accent-400/20 px-4 py-3">
        <button
          type="button"
          onClick={onSummarize}
          disabled={!counters.events}
          className="flex-1 rounded-full border border-accent-300/60 bg-accent-400/15 py-2 font-display text-[10px] tracking-[0.2em] text-accent-100 transition active:scale-95 disabled:opacity-40"
        >
          LAGE ZUSAMMENFASSEN
        </button>
      </div>
    </div>
  );
}
