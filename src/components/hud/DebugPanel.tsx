"use client";

import type { ListenerDebugEvent } from "@/lib/listener";

export default function DebugPanel({
  log,
  srSupported,
  running,
  mode,
  armed,
  lang,
  android,
  onClear,
  onClose,
}: {
  log: ListenerDebugEvent[];
  srSupported: boolean;
  running: boolean;
  mode: string;
  armed: boolean;
  lang: string;
  android: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="panel-in absolute left-3 top-16 z-50 max-h-[55dvh] w-[min(94vw,420px)] overflow-hidden rounded-xl border border-emerald-400/40 bg-black/90 font-mono text-[11px] text-emerald-200 shadow-xl select-text">
      <div className="flex items-center justify-between gap-2 border-b border-emerald-400/30 px-3 py-2">
        <span className="min-w-0 truncate">
          DEBUG · {running ? "läuft" : "aus"} · {mode} · {armed ? "armed" : "idle"} · {lang}
          {android ? " · android" : ""}
        </span>
        <span className="flex shrink-0 gap-3">
          <button type="button" onClick={onClear}>
            leeren
          </button>
          <button type="button" onClick={onClose} aria-label="Debug schließen">
            ✕
          </button>
        </span>
      </div>
      <div className="max-h-[48dvh] overflow-y-auto px-3 py-2">
        {!srSupported && <p className="text-rose-300">SpeechRecognition wird von diesem Browser nicht unterstützt.</p>}
        {log.length === 0 && <p className="text-emerald-400/60">Noch keine Ereignisse.</p>}
        {log.map((e, i) => (
          <p
            key={i}
            className={
              e.type === "error"
                ? "text-rose-300"
                : e.type === "wake" || e.type === "command"
                  ? "text-amber-200"
                  : e.type === "interim"
                    ? "text-emerald-400/60"
                    : ""
            }
          >
            {new Date(e.t).toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna" })} {e.type.padEnd(7, " ")} {e.text ?? ""}
          </p>
        ))}
      </div>
    </div>
  );
}
