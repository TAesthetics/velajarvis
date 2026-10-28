"use client";

import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Orb, { type OrbState } from "./Orb";
import { getSpeechRecognition, pickVoice, type SpeechRec, type SRResultEvent } from "@/lib/speech";

type Lang = "de-DE" | "en-US";
type ListenMode = "off" | "ptt" | "wake" | "wake-armed";

const WAKE_RE = /\b(jarvis|jarvys|javis|dschawis|tschawis|dscharvis|travis|throng|throngs|schwarm)\b[\s,.!?:]*/i;

type Mode = "throng" | "jarvis";

const THRONG_TEXT = {
  "de-DE": {
    idle: "Wir warten",
    listening: "Wir hören zu …",
    thinking: "Wir denken gemeinsam …",
    speaking: "Wir sprechen …",
    error: "Wir sind gestört",
    wake: 'Sag „Throng …" oder „Jarvis …"',
    placeholder: "Sag uns, was Vela braucht …",
    boot: "Schwarm wecken",
    hold: "Leertaste halten oder Mikro tippen",
  },
  "en-US": {
    idle: "We are waiting",
    listening: "We are listening …",
    thinking: "We think together …",
    speaking: "We speak …",
    error: "We are disturbed",
    wake: 'Say "Throng …" or "Jarvis …"',
    placeholder: "Tell us what Vela needs …",
    boot: "Wake the swarm",
    hold: "Hold space or tap the mic",
  },
} as const;

const UI_TEXT = {
  "de-DE": {
    idle: "Bereit",
    listening: "Ich höre zu, Sir …",
    thinking: "Verarbeite …",
    speaking: "Spreche …",
    error: "Systemfehler",
    wake: 'Sag „Jarvis …"',
    placeholder: "Befehl eingeben, Sir …",
    boot: "Systeme initialisieren",
    hold: "Leertaste halten oder Mikro tippen",
  },
  "en-US": {
    idle: "Standing by",
    listening: "Listening, Sir …",
    thinking: "Processing …",
    speaking: "Speaking …",
    error: "Malfunction",
    wake: 'Say "Jarvis …"',
    placeholder: "Type a command, Sir …",
    boot: "Initialise systems",
    hold: "Hold space or tap the mic",
  },
} as const;

function greeting(lang: Lang, mode: Mode = "jarvis") {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Vienna" })
      .formatToParts(new Date())
      .find((p) => p.type === "hour")?.value ?? 12,
  );
  if (mode === "throng") {
    return lang === "en-US"
      ? "Hello, Terence. We are awake. We are many. What shall we grow for Vela today?"
      : "Hallo, Terence. Wir sind wach. Wir sind viele. Was sollen wir heute für Vela wachsen lassen?";
  }
  if (lang === "en-US") {
    const p = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return `${p}, Sir. All systems are online. How may I be of service?`;
  }
  const p = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  return `${p}, Sir. Alle Systeme sind online. Womit kann ich dienen?`;
}

function messageText(m: { parts: Array<{ type: string; text?: string }> }) {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export default function Jarvis() {
  const [booted, setBooted] = useState(false);
  const [lang, setLang] = useState<Lang>("de-DE");
  const [mode, setMode] = useState<Mode>("throng");
  const [vault, setVault] = useState<Vault>({ ideas: [], drafts: [] });
  const [vaultOpen, setVaultOpen] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState("");
  const [input, setInput] = useState("");
  const [hudError, setHudError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const srSupported = useSyncExternalStore(noopSubscribe, () => !!getSpeechRecognition(), () => true);
  const ttsSupported = useSyncExternalStore(noopSubscribe, () => "speechSynthesis" in window, () => true);
  const [clock, setClock] = useState("");
  const [greetingText, setGreetingText] = useState<string | null>(null);

  const levelRef = useRef(0);
  const recRef = useRef<SpeechRec | null>(null);
  const modeRef = useRef<ListenMode>("off");
  const langRef = useRef(lang);
  const personaRef = useRef<Mode>(mode);
  const vaultSeen = useRef<Set<string>>(new Set());
  const wakeRef = useRef(wakeEnabled);
  const mutedRef = useRef(muted);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const pendingUtterances = useRef(0);
  const utteranceKeep = useRef<SpeechSynthesisUtterance[]>([]);
  const spokenIdx = useRef<Record<string, number>>({});
  const openedTools = useRef<Set<string>>(new Set());
  const audioRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const voiceURIRef = useRef("");
  const startRecRef = useRef<(mode: Exclude<ListenMode, "off">) => void>(() => {});

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    personaRef.current = mode;
  }, [mode]);

  // Vault (ideas + drafts) persisted in localStorage
  useEffect(() => {
    const id = setTimeout(() => {
      const v = loadVault();
      v.ideas.forEach((i) => vaultSeen.current.add(i.id));
      v.drafts.forEach((d) => vaultSeen.current.add(d.id));
      setVault(v);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const updateVault = useCallback((fn: (v: Vault) => Vault) => {
    setVault((prev) => {
      const next = fn(prev);
      saveVault(next);
      return next;
    });
  }, []);
  useEffect(() => {
    wakeRef.current = wakeEnabled;
  }, [wakeEnabled]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    voicesRef.current = voices;
  }, [voices]);
  useEffect(() => {
    voiceURIRef.current = voiceURI;
  }, [voiceURI]);

  const { messages, sendMessage, status, error, stop, clearError } = useChat({
    onFinish: ({ message }) => {
      const newIdeas: Idea[] = [];
      const newDrafts: Draft[] = [];
      for (const p of message.parts) {
        const part = p as { type: string; toolCallId?: string; state?: string; output?: Record<string, unknown> };
        if (part.state !== "output-available" || !part.output || !part.toolCallId) continue;
        if (vaultSeen.current.has(part.toolCallId)) continue;
        if (part.type === "tool-saveIdea" && part.output.title) {
          vaultSeen.current.add(part.toolCallId);
          newIdeas.push({ ...(part.output as unknown as Idea), id: part.toolCallId });
        } else if (part.type === "tool-draftSocialPost" && part.output.text) {
          vaultSeen.current.add(part.toolCallId);
          newDrafts.push({
            ...(part.output as unknown as Draft),
            id: part.toolCallId,
            createdAt: new Date().toISOString(),
          });
        }
      }
      if (newIdeas.length || newDrafts.length) {
        updateVault((v) => ({ ideas: [...newIdeas, ...v.ideas], drafts: [...newDrafts, ...v.drafts] }));
        setVaultOpen(true);
      }
    },
    onError: (e) => {
      let msg = e.message;
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error) msg = parsed.error;
      } catch {}
      setHudError(msg || "Unbekannter Fehler");
    },
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // ---------- Feature detection, voices & clock ----------
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    const id = setTimeout(load, 0);
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      clearTimeout(id);
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("de-AT", {
          timeZone: "Europe/Vienna",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const langVoices = useMemo(
    () => voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))),
    [voices, lang],
  );
  const activeVoice = useMemo(() => pickVoice(voices, lang, voiceURI || undefined), [voices, lang, voiceURI]);

  // ---------- Audio level loop (mic analyser + simulated speech envelope) ----------
  useEffect(() => {
    let raf = 0;
    let speechPulse = 0;
    const loop = (now: number) => {
      const a = audioRef.current;
      if (speakingRef.current) {
        // speechSynthesis exposes no audio stream: synthesize a lively envelope
        const t = now / 1000;
        speechPulse =
          0.35 +
          0.25 * Math.abs(Math.sin(t * 9.3)) * Math.abs(Math.sin(t * 2.1 + 1)) +
          0.25 * Math.random() * Math.abs(Math.sin(t * 17));
        levelRef.current = speechPulse;
      } else if (a && (modeRef.current === "ptt" || modeRef.current === "wake-armed")) {
        a.analyser.getByteTimeDomainData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) {
          const v = (a.data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / a.data.length);
        levelRef.current = Math.min(1, rms * 5);
      } else {
        levelRef.current = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ensureMic = useCallback(async () => {
    if (audioRef.current) {
      if (audioRef.current.ctx.state === "suspended") await audioRef.current.ctx.resume();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      audioRef.current = { ctx, analyser, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
    } catch {
      // Visualisation is optional; recognition may still work.
    }
  }, []);

  const beep = useCallback((freq = 880) => {
    const a = audioRef.current;
    if (!a) return;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.frequency.value = freq;
    o.type = "sine";
    g.gain.setValueAtTime(0.0001, a.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, a.ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, a.ctx.currentTime + 0.18);
    o.connect(g).connect(a.ctx.destination);
    o.start();
    o.stop(a.ctx.currentTime + 0.2);
  }, []);

  // ---------- Speech synthesis ----------
  const onSpeechIdle = useRef<() => void>(() => {});

  const speak = useCallback((text: string) => {
    const clean = text.replace(/[*_#`>\[\]]/g, "").replace(/https?:\/\/\S+/g, "").trim();
    if (!clean || mutedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(voicesRef.current, langRef.current, voiceURIRef.current || undefined);
    if (v) u.voice = v;
    u.lang = v?.lang ?? langRef.current;
    const throng = personaRef.current === "throng";
    u.rate = throng ? 0.96 : 1.02;
    u.pitch = throng ? 1.25 : 0.78; // swarm: lighter & a touch uncanny; Jarvis: deeper
    pendingUtterances.current += 1;
    utteranceKeep.current.push(u);
    speakingRef.current = true;
    setSpeaking(true);
    u.onstart = () => {
      speakingRef.current = true;
      setSpeaking(true);
    };
    const done = () => {
      pendingUtterances.current = Math.max(0, pendingUtterances.current - 1);
      utteranceKeep.current = utteranceKeep.current.filter((x) => x !== u);
      if (pendingUtterances.current === 0) {
        speakingRef.current = false;
        setSpeaking(false);
        onSpeechIdle.current();
      }
    };
    u.onend = done;
    u.onerror = done;
    // Pause recognition while talking so Jarvis doesn't hear himself
    if (recRef.current && modeRef.current.startsWith("wake")) {
      try {
        recRef.current.abort();
      } catch {}
    }
    window.speechSynthesis.speak(u);
  }, []);

  const shutUp = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    pendingUtterances.current = 0;
    utteranceKeep.current = [];
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  // ---------- Sending ----------
  const submit = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setPartial("");
      setHudError(null);
      clearError();
      shutUp();
      if (busyRef.current) stop();
      sendMessage({ text: t }, { body: { lang: langRef.current, mode: personaRef.current } });
    },
    [sendMessage, shutUp, stop, clearError],
  );

  // ---------- Speech recognition ----------
  const startRecognition = useCallback(
    (mode: Exclude<ListenMode, "off">) => {
      const SR = getSpeechRecognition();
      if (!SR) return;
      if (recRef.current) {
        const old = recRef.current;
        old.onend = null;
        old.onresult = null;
        old.onerror = null;
        try {
          old.abort();
        } catch {}
      }
      const rec = new SR();
      rec.lang = langRef.current;
      rec.continuous = mode !== "ptt";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      modeRef.current = mode;
      recRef.current = rec;
      setListening(mode === "ptt" || mode === "wake-armed");

      const arm = () => {
        modeRef.current = "wake-armed";
        setListening(true);
        beep(1046);
        if (armTimer.current) clearTimeout(armTimer.current);
        armTimer.current = setTimeout(() => {
          if (modeRef.current === "wake-armed") {
            modeRef.current = "wake";
            setListening(false);
            setPartial("");
          }
        }, 8000);
      };

      rec.onresult = (e: SRResultEvent) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = r[0].transcript;
          if (!r.isFinal) {
            interim += text;
            continue;
          }
          const m = modeRef.current;
          if (m === "ptt" || m === "wake-armed") {
            if (armTimer.current) clearTimeout(armTimer.current);
            if (m === "wake-armed") modeRef.current = "wake";
            setListening(false);
            submit(text);
          } else if (m === "wake") {
            const match = text.match(WAKE_RE);
            if (match && match.index !== undefined) {
              const command = text.slice(match.index + match[0].length).trim();
              if (command.length > 2) {
                beep(1046);
                submit(command);
              } else arm();
            }
          }
        }
        const m = modeRef.current;
        if (m === "wake" && WAKE_RE.test(interim)) {
          // Show what we hear once the wake word appears
          setPartial(interim);
        } else if (m !== "wake") setPartial(interim);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setHudError("Mikrofonzugriff verweigert. Bitte im Browser erlauben.");
          setWakeEnabled(false);
          modeRef.current = "off";
          setListening(false);
        }
      };
      rec.onend = () => {
        if (recRef.current !== rec) return;
        const m = modeRef.current;
        if (m === "ptt") {
          setListening(false);
          setPartial("");
          modeRef.current = wakeRef.current ? "wake" : "off";
        }
        if ((modeRef.current === "wake" || modeRef.current === "wake-armed") && wakeRef.current) {
          setTimeout(() => {
            if (recRef.current === rec && !speakingRef.current && wakeRef.current) {
              startRecRef.current(modeRef.current === "wake-armed" ? "wake-armed" : "wake");
            }
          }, 250);
        } else {
          recRef.current = null;
        }
      };
      try {
        rec.start();
      } catch {}
    },
    [beep, submit],
  );

  useEffect(() => {
    startRecRef.current = startRecognition;
  }, [startRecognition]);

  const stopRecognition = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {}
    }
  }, []);

  // When Jarvis finishes talking, resume wake-word listening
  useEffect(() => {
    onSpeechIdle.current = () => {
      if (wakeRef.current && !busyRef.current) startRecognition("wake");
    };
  }, [startRecognition]);

  // Toggle wake word
  useEffect(() => {
    if (!booted) return;
    if (wakeEnabled) {
      ensureMic().then(() => {
        if (!speakingRef.current && modeRef.current === "off") startRecognition("wake");
      });
    } else if (modeRef.current === "wake" || modeRef.current === "wake-armed") {
      modeRef.current = "off";
      setListening(false);
      setPartial("");
      const rec = recRef.current;
      recRef.current = null;
      try {
        rec?.abort();
      } catch {}
    }
  }, [wakeEnabled, booted, ensureMic, startRecognition]);

  // Restart recognition with new language
  useEffect(() => {
    if (recRef.current && modeRef.current !== "off" && modeRef.current !== "ptt") {
      startRecognition(modeRef.current);
    }
  }, [lang, startRecognition]);

  const pttDown = useCallback(async () => {
    if (!srSupported) return;
    shutUp();
    await ensureMic();
    beep(880);
    startRecognition("ptt");
  }, [srSupported, shutUp, ensureMic, beep, startRecognition]);

  const pttToggle = useCallback(() => {
    if (modeRef.current === "ptt") stopRecognition();
    else void pttDown();
  }, [pttDown, stopRecognition]);

  // Space bar = push-to-talk (hold)
  useEffect(() => {
    if (!booted) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      void pttDown();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (modeRef.current === "ptt") stopRecognition();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [booted, pttDown, stopRecognition]);

  // ---------- Stream → speech (sentence by sentence) ----------
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const text = messageText(last);
    const from = spokenIdx.current[last.id] ?? 0;
    const rest = text.slice(from);
    if (status === "streaming") {
      const m = rest.match(/^[\s\S]*[.!?…:;](?=\s)/);
      if (m) {
        speak(m[0]);
        spokenIdx.current[last.id] = from + m[0].length;
      }
    } else if (status === "ready" && rest.trim()) {
      speak(rest);
      spokenIdx.current[last.id] = text.length;
    }
  }, [messages, status, speak]);

  // If the turn ends with nothing to say, resume wake listening
  useEffect(() => {
    if ((status === "ready" || status === "error") && !speakingRef.current && wakeRef.current && modeRef.current !== "ptt") {
      if (!recRef.current) startRecognition("wake");
    }
  }, [status, startRecognition]);

  // ---------- Client-side effect of the openWebsite tool ----------
  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts) {
        if (p.type !== "tool-openWebsite") continue;
        const part = p as { toolCallId: string; state: string; output?: { url?: string } };
        if (part.state !== "output-available" || !part.output?.url) continue;
        if (openedTools.current.has(part.toolCallId)) continue;
        openedTools.current.add(part.toolCallId);
        // May be blocked by the popup blocker; the transcript always shows a clickable link.
        window.open(part.output.url, "_blank", "noopener,noreferrer");
      }
    }
  }, [messages]);

  // ---------- Boot ----------
  const boot = useCallback(async () => {
    setBooted(true);
    await ensureMic();
    beep(660);
    setTimeout(() => beep(990), 140);
    const g = greeting(langRef.current, personaRef.current);
    setGreetingText(g);
    setTimeout(() => speak(g), 350);
  }, [ensureMic, beep, speak]);

  // ---------- Derived UI ----------
  const orbState: OrbState =
    hudError || error ? "error" : speaking ? "speaking" : listening ? "listening" : busy ? "thinking" : "idle";
  const t = mode === "throng" ? THRONG_TEXT[lang] : UI_TEXT[lang];
  const aiLabel = mode === "throng" ? "WIR" : "JARVIS";
  const userLabel = mode === "throng" ? "TERENCE" : "SIR";
  const statusLabel =
    orbState === "idle" && wakeEnabled ? t.wake : t[orbState === "error" ? "error" : orbState];

  const transcript = useMemo(
    () =>
      messages
        .map((m) => ({
          id: m.id,
          role: m.role,
          text: messageText(m),
          tools: m.parts.filter((p) => p.type.startsWith("tool-")).map((p) => p.type.slice(5)),
          links: m.parts
            .filter((p) => p.type === "tool-openWebsite")
            .map((p) => (p as { output?: { url?: string } }).output?.url)
            .filter((u): u is string => !!u),
        }))
        .filter((m) => m.text || m.tools.length)
        .slice(-6),
    [messages],
  );

  return (
    <main
      className={`relative flex h-dvh w-full flex-col overflow-hidden bg-[#02060c] text-cyan-100 select-none ${
        mode === "throng" ? "throng" : ""
      }`}
    >
      {/* Background: grid + vignette + scanlines */}
      <div className="hud pointer-events-none absolute inset-0 jarvis-grid opacity-40" />
      <div className="hud pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,140,255,0.12)_0%,rgba(2,6,12,0.0)_35%,rgba(2,6,12,0.95)_80%)]" />
      <div className="pointer-events-none absolute inset-0 jarvis-scan" />

      {/* HUD top bar */}
      <header className="hud relative z-10 flex items-start justify-between px-5 pt-4 sm:px-8 sm:pt-6">
        <div>
          <h1 className="font-display text-xl tracking-[0.45em] text-cyan-300 drop-shadow-[0_0_10px_rgba(0,200,255,0.8)] sm:text-2xl">
            {mode === "throng" ? "T.H.R.O.N.G." : "J.A.R.V.I.S."}
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-cyan-500/70">
            {mode === "throng" ? "Wir sind Velas Marketing · Wir sind viele" : "Just A Rather Very Intelligent System"}
          </p>
        </div>
        <div className="text-right font-mono text-xs text-cyan-400/80">
          <div className="text-base text-cyan-200 tabular-nums">{clock}</div>
          <div className="tracking-widest">WIEN · AT</div>
        </div>
      </header>

      {/* Orb */}
      <section className="relative z-0 flex flex-1 items-center justify-center">
        <div className="relative aspect-square w-[min(94vw,70vh)]">
          <Orb state={orbState} levelRef={levelRef} variant={mode} />
          <div className="hud pointer-events-none absolute inset-x-0 bottom-[6%] text-center">
            <span
              className={`font-display text-[11px] uppercase tracking-[0.4em] ${
                orbState === "error" ? "text-rose-300" : "text-cyan-200/90"
              }`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
      </section>

      {/* Transcript */}
      <aside className="hud pointer-events-none absolute left-1/2 top-[64%] z-10 w-[min(92vw,640px)] -translate-x-1/2 sm:top-auto sm:bottom-32 sm:left-6 sm:w-[340px] sm:translate-x-0">
        <div className="space-y-1.5 text-[13px] leading-snug">
          {greetingText && transcript.length === 0 && (
            <p className="text-cyan-100/80">
              <span className="mr-2 font-mono text-[10px] text-cyan-400">{aiLabel}</span>
              {greetingText}
            </p>
          )}
          {transcript.map((m) => (
            <p key={m.id} className={m.role === "user" ? "text-slate-300/70" : "text-cyan-100/90"}>
              <span className={`mr-2 font-mono text-[10px] ${m.role === "user" ? "text-slate-400" : "text-cyan-400"}`}>
                {m.role === "user" ? userLabel : aiLabel}
              </span>
              {m.tools.length > 0 && !m.text && (
                <span className="font-mono text-[11px] text-cyan-500/70">[{m.tools.map((x) => TOOL_LABELS[x] ?? x).join(", ")}] </span>
              )}
              {m.text}
              {m.links.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto ml-2 font-mono text-[11px] text-cyan-300 underline"
                >
                  ↗ {new URL(url).hostname}
                </a>
              ))}
            </p>
          ))}
          {partial && (
            <p className="italic text-slate-300/60">
              <span className="mr-2 font-mono text-[10px] text-slate-400">{userLabel}</span>
              {partial}
            </p>
          )}
          {(hudError || error) && (
            <p className="font-mono text-[11px] text-rose-300">⚠ {hudError ?? error?.message}</p>
          )}
        </div>
      </aside>

      {/* Controls */}
      <footer className="hud relative z-20 flex flex-col items-center gap-3 px-4 pb-5 sm:pb-7">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <ToggleChip
            active
            onClick={() => {
              shutUp();
              const next: Mode = mode === "throng" ? "jarvis" : "throng";
              setMode(next);
              personaRef.current = next;
              if (booted) {
                const g = greeting(lang, next);
                setGreetingText(g);
                speak(g);
              }
            }}
            title="Persona wechseln"
          >
            {mode === "throng" ? "THRONG" : "JARVIS"}
          </ToggleChip>
          <ToggleChip active={lang === "de-DE"} onClick={() => setLang(lang === "de-DE" ? "en-US" : "de-DE")}>
            {lang === "de-DE" ? "DE" : "EN"}
          </ToggleChip>
          <ToggleChip
            active={wakeEnabled}
            disabled={!srSupported}
            onClick={() => setWakeEnabled((w) => !w)}
            title='Wake Word "Jarvis"'
          >
            WAKE
          </ToggleChip>

          <button
            type="button"
            onClick={pttToggle}
            disabled={!srSupported || !booted}
            aria-label="Push to talk"
            className={`group relative grid h-16 w-16 place-items-center rounded-full border transition-all ${
              listening
                ? "border-cyan-200 bg-cyan-400/25 shadow-[0_0_40px_rgba(0,230,255,0.8)]"
                : "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(0,180,255,0.35)] hover:bg-cyan-400/20"
            } disabled:opacity-30`}
          >
            <MicIcon className="h-7 w-7 text-cyan-100" />
            {listening && <span className="absolute inset-0 animate-ping rounded-full border border-cyan-300/60" />}
          </button>

          <ToggleChip active={!muted} onClick={() => (muted ? setMuted(false) : (shutUp(), setMuted(true)))} disabled={!ttsSupported}>
            {muted ? "MUTE" : "VOX"}
          </ToggleChip>
          <select
            value={voiceURI}
            onChange={(e) => setVoiceURI(e.target.value)}
            className="h-9 max-w-[7.5rem] rounded-full border border-cyan-400/30 bg-cyan-950/40 px-2 font-mono text-[10px] text-cyan-200 outline-none"
            title="Stimme"
            aria-label="Stimme"
          >
            <option value="">{activeVoice ? `Auto: ${activeVoice.name}` : "Auto"}</option>
            {langVoices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          <ToggleChip active={vaultOpen} onClick={() => setVaultOpen((o) => !o)} title="Ideen & Entwürfe">
            VAULT {vault.ideas.length + vault.drafts.length > 0 ? vault.ideas.length + vault.drafts.length : ""}
          </ToggleChip>
        </div>

        <form
          className="flex w-[min(92vw,560px)] items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!booted) void boot();
            submit(input);
            setInput("");
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.placeholder}
            className="h-10 flex-1 rounded-full border border-cyan-400/30 bg-cyan-950/30 px-4 text-sm text-cyan-50 placeholder:text-cyan-500/50 outline-none backdrop-blur focus:border-cyan-300/70 focus:shadow-[0_0_18px_rgba(0,200,255,0.35)]"
          />
          <button
            type="submit"
            className="h-10 rounded-full border border-cyan-400/40 px-4 font-display text-[11px] tracking-[0.25em] text-cyan-200 hover:bg-cyan-400/15"
          >
            SEND
          </button>
        </form>
        <p className="font-mono text-[10px] tracking-widest text-cyan-500/60">
          {srSupported ? t.hold : "Spracherkennung nicht unterstützt – Texteingabe aktiv (Chrome/Edge empfohlen)"}
        </p>
      </footer>

      {vaultOpen && (
        <VaultPanel
          vault={vault}
          onClose={() => setVaultOpen(false)}
          onDeleteIdea={(id) => updateVault((v) => ({ ...v, ideas: v.ideas.filter((i) => i.id !== id) }))}
          onDeleteDraft={(id) => updateVault((v) => ({ ...v, drafts: v.drafts.filter((d) => d.id !== id) }))}
        />
      )}

      {/* Boot overlay (needed for audio/mic permissions) */}
      {!booted && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[#02060c]/70 backdrop-blur-sm">
          <button
            type="button"
            onClick={boot}
            className="group flex flex-col items-center gap-4 rounded-2xl border border-cyan-400/40 bg-cyan-950/30 px-10 py-8 shadow-[0_0_60px_rgba(0,180,255,0.25)] transition hover:shadow-[0_0_80px_rgba(0,220,255,0.45)]"
          >
            <span className="relative grid h-14 w-14 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/30" />
              <span className="h-4 w-4 rounded-full bg-cyan-300 shadow-[0_0_25px_rgba(0,230,255,1)]" />
            </span>
            <span className="font-display text-sm tracking-[0.4em] text-cyan-200">{t.boot}</span>
          </button>
        </div>
      )}
    </main>
  );
}

function noopSubscribe() {
  return () => {};
}

function ToggleChip({
  active,
  children,
  ...rest
}: { active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-9 min-w-12 rounded-full border px-3 font-display text-[10px] tracking-[0.25em] transition disabled:opacity-30 ${
        active
          ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-100 shadow-[0_0_14px_rgba(0,200,255,0.45)]"
          : "border-cyan-400/25 text-cyan-400/60 hover:text-cyan-200"
      }`}
    >
      {children}
    </button>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------- Vault (ideas + drafts) ----------------

const TOOL_LABELS: Record<string, string> = {
  draftSocialPost: "Entwurf abgelegt",
  saveIdea: "Idee gespeichert",
  getVelaRepoStatus: "Repo gelesen",
  getDateTime: "Uhrzeit",
  getWeather: "Wetter",
  openWebsite: "Website",
};

type Idea = { id: string; title: string; detail: string; channel?: string; tags?: string[]; createdAt: string };
type Draft = {
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
type Vault = { ideas: Idea[]; drafts: Draft[] };

const VAULT_KEY = "throng.vela.vault.v1";

function loadVault(): Vault {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return { ideas: [], drafts: [] };
    const v = JSON.parse(raw) as Partial<Vault>;
    return { ideas: v.ideas ?? [], drafts: v.drafts ?? [] };
  } catch {
    return { ideas: [], drafts: [] };
  }
}

function saveVault(v: Vault) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(v));
  } catch {}
}

function vaultMarkdown(v: Vault) {
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
  return lines.join("\n");
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PLATFORM_NAMES: Record<string, string> = {
  x: "X",
  tiktok: "TikTok",
  instagram: "Instagram",
  threads: "Threads",
  linkedin: "LinkedIn",
};

function VaultPanel({
  vault,
  onClose,
  onDeleteIdea,
  onDeleteDraft,
}: {
  vault: Vault;
  onClose: () => void;
  onDeleteIdea: (id: string) => void;
  onDeleteDraft: (id: string) => void;
}) {
  const [tab, setTab] = useState<"drafts" | "ideas">("drafts");
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };
  return (
    <div className="hud absolute inset-x-3 bottom-3 top-20 z-40 flex flex-col rounded-2xl border border-cyan-400/30 bg-[#030a14]/90 shadow-[0_0_40px_rgba(0,180,255,0.2)] backdrop-blur-md select-text sm:inset-x-auto sm:right-5 sm:top-24 sm:bottom-40 sm:w-[380px]">
      <div className="flex items-center justify-between border-b border-cyan-400/20 px-4 py-3">
        <div className="flex gap-2">
          {(["drafts", "ideas"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1 font-display text-[10px] tracking-[0.2em] ${
                tab === k ? "bg-cyan-400/20 text-cyan-100" : "text-cyan-400/60 hover:text-cyan-200"
              }`}
            >
              {k === "drafts" ? `ENTWÜRFE ${vault.drafts.length}` : `IDEEN ${vault.ideas.length}`}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="px-2 text-cyan-300/70 hover:text-cyan-100">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[13px] leading-snug">
        {tab === "drafts" &&
          (vault.drafts.length === 0 ? (
            <p className="text-cyan-400/60">Noch keine Entwürfe. Sag z. B.: „Schreib einen X-Post „über den Schleier.“</p>
          ) : (
            vault.drafts.map((d) => (
              <div key={d.id} className="rounded-xl border border-cyan-400/20 bg-cyan-950/20 p-3">
                <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-cyan-400/80">
                  <span>{PLATFORM_NAMES[d.platform] ?? d.platform}</span>
                  <span className={d.tooLong ? "text-rose-300" : ""}>
                    {d.chars}/{d.limit}
                  </span>
                </div>
                {d.hook && <p className="mb-1 text-cyan-200/90">Hook: {d.hook}</p>}
                <p className="whitespace-pre-wrap text-cyan-50">{d.text}</p>
                {d.visualIdea && <p className="mt-2 text-[12px] text-cyan-300/70">Visual: {d.visualIdea}</p>}
                <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
                  <button type="button" onClick={() => copy(d.id, d.text)} className="rounded-full border border-cyan-400/30 px-3 py-1 text-cyan-200 hover:bg-cyan-400/10">
                    {copied === d.id ? "kopiert ✓" : "kopieren"}
                  </button>
                  {d.postUrl && (
                    <a href={d.postUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-cyan-300/50 px-3 py-1 text-cyan-100 hover:bg-cyan-400/15">
                      selbst auf {PLATFORM_NAMES[d.platform]} posten ↗
                    </a>
                  )}
                  <button type="button" onClick={() => onDeleteDraft(d.id)} className="ml-auto px-2 text-cyan-500/60 hover:text-rose-300">
                    löschen
                  </button>
                </div>
              </div>
            ))
          ))}

        {tab === "ideas" &&
          (vault.ideas.length === 0 ? (
            <p className="text-cyan-400/60">Noch keine Ideen. Sag z. B.: „Merk dir die Idee …“</p>
          ) : (
            vault.ideas.map((i) => (
              <div key={i.id} className="rounded-xl border border-cyan-400/20 bg-cyan-950/20 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-cyan-50">{i.title}</p>
                  {i.channel && <span className="shrink-0 font-mono text-[10px] text-cyan-400/80">{i.channel}</span>}
                </div>
                <p className="mt-1 text-cyan-100/80">{i.detail}</p>
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => onDeleteIdea(i.id)} className="font-mono text-[11px] text-cyan-500/60 hover:text-rose-300">
                    löschen
                  </button>
                </div>
              </div>
            ))
          ))}
      </div>

      <div className="flex gap-2 border-t border-cyan-400/20 px-4 py-3 font-mono text-[11px]">
        <button
          type="button"
          onClick={() => download("vela-ideen.md", vaultMarkdown(vault), "text/markdown")}
          className="rounded-full border border-cyan-400/30 px-3 py-1 text-cyan-200 hover:bg-cyan-400/10"
        >
          Export .md
        </button>
        <button
          type="button"
          onClick={() => download("vela-ideen.json", JSON.stringify(vault, null, 2), "application/json")}
          className="rounded-full border border-cyan-400/30 px-3 py-1 text-cyan-200 hover:bg-cyan-400/10"
        >
          Export .json
        </button>
        <span className="ml-auto self-center text-cyan-500/50">nur in diesem Browser</span>
      </div>
    </div>
  );
}
