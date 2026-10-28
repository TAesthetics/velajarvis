/**
 * Always-on speech listener with wake word.
 *
 * Android Chrome ignores `continuous = true` and ends the session after every pause,
 * fires `no-speech` / `aborted` / `network` errors, and sometimes never fires `onend`.
 * This class keeps one recognition session alive at all times (restart + backoff + watchdog),
 * pauses while the assistant is talking (so it never hears itself) and detects the wake word
 * already on interim results for instant feedback.
 */
import type { SpeechRec, SRErrorEvent, SRResultEvent } from "./speech";
import { findWakeWord, isEmptyCommand, type WakeMatch } from "./wake";

export type ListenMode = "wake" | "free";

export type ListenerDebugEvent = {
  t: number;
  type: "start" | "end" | "error" | "interim" | "final" | "wake" | "command" | "arm" | "disarm" | "pause" | "resume" | "restart";
  text?: string;
};

export type ListenerEvents = {
  onDebug?: (e: ListenerDebugEvent) => void;
  /** wake word detected (fires early, on interim results) */
  onWake?: (m: WakeMatch) => void;
  /** a complete command to send to the assistant */
  onCommand?: (text: string) => void;
  /** live transcript of what is being said (armed = it will be treated as a command) */
  onInterim?: (text: string, armed: boolean) => void;
  onState?: (s: { running: boolean; armed: boolean }) => void;
  onFatal?: (message: string) => void;
};

type SRCtor = new () => SpeechRec;

export class VoiceListener {
  private rec: SpeechRec | null = null;
  private running = false;
  private enabled = false;
  private paused = false;
  private armed = false;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private sessionId = 0;
  private sessionStart = 0;
  private gotResult = false;
  private fails = 0;
  private networkFails = 0;
  private lastError = "";
  private announced = new Set<string>();
  private handled = new Set<string>();
  private pendingWake = false;
  private onVisible = () => {
    if (document.visibilityState === "visible") this.ensureRunning("visible");
  };

  constructor(
    private SR: SRCtor,
    private ev: ListenerEvents,
    private opts: { lang: string; mode: ListenMode; armMs?: number },
  ) {}

  // ---------- public API ----------
  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) {
      if (!this.watchdog) this.watchdog = setInterval(() => this.ensureRunning("watchdog"), 2500);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
      this.ensureRunning("enable");
    } else {
      if (this.watchdog) clearInterval(this.watchdog);
      this.watchdog = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
      this.disarm();
      this.kill();
    }
  }

  setLang(lang: string) {
    if (lang === this.opts.lang) return;
    this.opts.lang = lang;
    this.kill();
    this.ensureRunning("lang");
  }

  setMode(mode: ListenMode) {
    this.opts.mode = mode;
    this.disarm();
  }

  /** Stop listening temporarily (assistant is speaking). */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.log("pause");
    this.kill();
  }

  /** Resume after the assistant finished speaking. */
  resume(delay = 350) {
    if (!this.paused) return;
    this.paused = false;
    this.log("resume");
    this.schedule(delay);
  }

  /** Treat the next utterance as a command (after wake word or mic tap). */
  arm(ms = this.opts.armMs ?? 8000) {
    this.armed = true;
    this.log("arm");
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = setTimeout(() => this.disarm(), ms);
    this.emitState();
    this.ensureRunning("arm");
  }

  disarm() {
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = null;
    if (this.armed) {
      this.armed = false;
      this.log("disarm");
      this.emitState();
    }
  }

  isArmed() {
    return this.armed;
  }

  destroy() {
    this.setEnabled(false);
  }

  // ---------- internals ----------
  private get shouldRun() {
    return this.enabled && !this.paused;
  }

  private log(type: ListenerDebugEvent["type"], text?: string) {
    this.ev.onDebug?.({ t: Date.now(), type, text });
  }

  private emitState() {
    this.ev.onState?.({ running: this.running, armed: this.armed });
  }

  private ensureRunning(why: string) {
    void why;
    if (!this.shouldRun || this.running || this.restartTimer) return;
    this.start();
  }

  private schedule(delay: number) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.shouldRun && !this.running) this.start();
    }, delay);
  }

  private kill() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {}
    }
    if (this.running) {
      this.running = false;
      this.emitState();
    }
  }

  private start() {
    const rec = new this.SR();
    rec.lang = this.opts.lang;
    rec.continuous = true; // ignored on Android, we restart anyway
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const id = ++this.sessionId;
    this.rec = rec;
    this.gotResult = false;
    this.pendingWake = false;
    this.sessionStart = Date.now();
    this.announced.clear();
    this.handled.clear();

    rec.onstart = () => {
      if (this.rec !== rec) return;
      this.log("start", this.opts.lang);
    };
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      this.handleResult(id, e);
    };
    rec.onerror = (e: SRErrorEvent) => {
      if (this.rec !== rec) return;
      this.lastError = e.error;
      this.log("error", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.enabled = false;
        this.ev.onFatal?.(
          "Mikrofon blockiert. Bitte in Chrome das Mikrofon für diese Seite erlauben (Schloss-Symbol → Berechtigungen).",
        );
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      this.running = false;
      this.log("end");
      // wake word heard but the session ended before a final result → wait for the command
      if (this.pendingWake && !this.armed && this.opts.mode === "wake") this.arm();
      this.emitState();
      if (!this.shouldRun) return;
      const lived = Date.now() - this.sessionStart;
      if (this.lastError === "network") {
        this.networkFails++;
        this.schedule(Math.min(10000, 1000 * 2 ** (this.networkFails - 1)));
      } else {
        this.networkFails = 0;
        if (lived < 1000 && !this.gotResult && this.lastError !== "no-speech") this.fails++;
        else this.fails = 0;
        this.schedule(this.fails ? Math.min(4000, 150 * 2 ** this.fails) : 120);
      }
      this.lastError = "";
      this.log("restart");
    };

    try {
      rec.start();
      this.running = true;
      this.emitState();
    } catch (err) {
      this.rec = null;
      this.running = false;
      this.log("error", `start: ${err instanceof Error ? err.message : String(err)}`);
      this.fails++;
      this.schedule(Math.min(4000, 200 * 2 ** this.fails));
    }
  }

  private handleResult(sessionId: number, e: SRResultEvent) {
    if (!this.shouldRun) return;
    this.gotResult = true;
    this.fails = 0;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = (r[0]?.transcript ?? "").trim();
      if (!text) continue;
      const key = `${sessionId}:${i}`;
      if (r.isFinal) {
        if (this.handled.has(key)) continue;
        this.handled.add(key);
        this.log("final", text);
        this.handleFinal(text, key);
      } else {
        this.log("interim", text);
        this.handleInterim(text, key);
      }
    }
  }

  private handleInterim(text: string, key: string) {
    if (this.opts.mode === "free" || this.armed) {
      this.ev.onInterim?.(stripWake(text), true);
      return;
    }
    const m = findWakeWord(text);
    if (m) {
      if (!this.announced.has(key)) {
        this.announced.add(key);
        this.pendingWake = true;
        this.log("wake", `${m.heard} → ${m.word}`);
        this.ev.onWake?.(m);
      }
      this.ev.onInterim?.(m.command, true);
    } else {
      this.ev.onInterim?.(text, false);
    }
  }

  private handleFinal(text: string, key: string) {
    if (this.opts.mode === "free" || this.armed) {
      const cmd = stripWake(text);
      if (isEmptyCommand(cmd)) {
        // only the wake word again → stay armed
        if (findWakeWord(text)) this.arm();
        return;
      }
      this.pendingWake = false;
      this.disarm();
      this.log("command", cmd);
      this.ev.onCommand?.(cmd);
      return;
    }
    const m = findWakeWord(text);
    if (!m) {
      if (this.announced.has(key)) {
        // interim had the wake word, final lost it → be generous and wait for the command
        this.pendingWake = false;
        this.arm();
      }
      return;
    }
    if (!this.announced.has(key)) {
      this.log("wake", `${m.heard} → ${m.word}`);
      this.ev.onWake?.(m);
    }
    this.pendingWake = false;
    if (isEmptyCommand(m.command)) {
      this.arm();
    } else {
      this.log("command", m.command);
      this.ev.onCommand?.(m.command);
    }
  }
}

/** Drop a leading wake word ("Jarvis, wie spät …" → "wie spät …"). */
function stripWake(text: string) {
  const m = findWakeWord(text);
  if (!m) return text.trim();
  const before = text.slice(0, text.toLowerCase().indexOf(m.heard.toLowerCase())).trim();
  // only strip if the wake word is (nearly) at the start
  return before.split(/\s+/).filter(Boolean).length <= 1 ? m.command : text.trim();
}
