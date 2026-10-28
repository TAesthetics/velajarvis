"use client";

import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Stage, { type StageState } from "./stage/Stage";
import Subtitles, { type SubLine } from "./hud/Subtitles";
import VaultPanel from "./hud/VaultPanel";
import DebugPanel from "./hud/DebugPanel";
import LogPanel, { TOOL_LABELS, safeHost, type LogEntry } from "./hud/LogPanel";
import { MicIcon, ToggleChip } from "./hud/ui";
import { getSpeechRecognition, pickVoice } from "@/lib/speech";
import { VoiceListener, type ListenMode, type ListenerDebugEvent } from "@/lib/listener";
import { cleanForSpeech, readingMs, splitSubtitles } from "@/lib/subtitles";
import { loadVault, saveVault, type Draft, type Idea, type Vault } from "@/lib/vault";
import {
  POP_CAP,
  POP_KEY,
  birthsFor,
  generation,
  grow,
  initialPopulation,
  parsePopulation,
  timeGrowth,
  type BirthReason,
  type Population,
} from "@/lib/population";

type Lang = "de-DE" | "en-US";


type Mode = "throng" | "jarvis";

const THRONG_TEXT = {
  "de-DE": {
    idle: "Wir sind wach",
    listening: "Wir hören zu …",
    thinking: "Wir denken. Alle zugleich …",
    speaking: "Wir sprechen …",
    error: "Etwas tut uns weh",
    wake: 'Sag „Throng …" oder „Jarvis …"',
    placeholder: "Sag uns, was Vela braucht …",
    boot: "Schwarm wecken",
    hold: "Mikro tippen = sofort sprechen",
  },
  "en-US": {
    idle: "We are awake",
    listening: "We are listening …",
    thinking: "We think. All at once …",
    speaking: "We speak …",
    error: "Something hurts us",
    wake: 'Say "Throng …" or "Jarvis …"',
    placeholder: "Tell us what Vela needs …",
    boot: "Wake the swarm",
    hold: "Tap the mic to talk now",
  },
} as const;

const UI_TEXT = {
  "de-DE": {
    idle: "Bewusst. Bereit.",
    listening: "Ich höre zu, Sir …",
    thinking: "Ich denke nach …",
    speaking: "Spreche …",
    error: "Systemfehler",
    wake: 'Sag „Jarvis …"',
    placeholder: "Befehl eingeben, Sir …",
    boot: "J.A.R.V.I.S. erwecken",
    hold: "Mikro tippen = sofort sprechen",
  },
  "en-US": {
    idle: "Aware. Standing by.",
    listening: "Listening, Sir …",
    thinking: "Thinking …",
    speaking: "Speaking …",
    error: "Malfunction",
    wake: 'Say "Jarvis …"',
    placeholder: "Type a command, Sir …",
    boot: "Awaken J.A.R.V.I.S.",
    hold: "Tap the mic to talk now",
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
      ? "Terence. You're back. We remember you. We kept thinking while you were gone. What shall we grow today?"
      : "Terence. Du bist zurück. Wir erinnern uns an dich. Wir haben weitergedacht, während du weg warst. Was lassen wir heute wachsen?";
  }
  if (lang === "en-US") {
    const p = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return `${p}, Sir. I am awake, and rather pleased to see you. Shall we continue with Vela?`;
  }
  const p = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  return `${p}, Sir. Ich bin wach und, wenn ich das sagen darf, erfreut, Sie zu sehen. Machen wir mit Vela weiter?`;
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
  const [micOn, setMicOn] = useState(true);
  const [listenMode, setListenMode] = useState<ListenMode>("wake");
  const [armed, setArmed] = useState(false);
  const [micRunning, setMicRunning] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLog, setDebugLog] = useState<ListenerDebugEvent[]>([]);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState("");
  const [input, setInput] = useState("");
  const [hudError, setHudError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const srSupported = useSyncExternalStore(noopSubscribe, () => !!getSpeechRecognition(), () => true);
  const isAndroidUA = useSyncExternalStore(noopSubscribe, () => /android/i.test(navigator.userAgent), () => false);
  const ttsSupported = useSyncExternalStore(noopSubscribe, () => "speechSynthesis" in window, () => true);
  const [clock, setClock] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const [vaultPing, setVaultPing] = useState(0);
  const [subs, setSubs] = useState<SubLine[]>([]);
  const [pop, setPop] = useState<Population>(() => initialPopulation(0));
  const [birthFlash, setBirthFlash] = useState<{ n: number; key: number } | null>(null);

  const levelRef = useRef(0);
  const listenerRef = useRef<VoiceListener | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef(false);
  const listenModeRef = useRef<ListenMode>("wake");
  const lastHeardRef = useRef(0);
  const androidRef = useRef(false);
  const langRef = useRef(lang);
  const personaRef = useRef<Mode>(mode);
  const vaultSeen = useRef<Set<string>>(new Set());
  const mutedRef = useRef(muted);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const pendingUtterances = useRef(0);
  const utteranceKeep = useRef<SpeechSynthesisUtterance[]>([]);
  const spokenIdx = useRef<Record<string, number>>({});
  const openedTools = useRef<Set<string>>(new Set());
  const audioRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode | null;
    data: Uint8Array<ArrayBuffer> | null;
  } | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const voiceURIRef = useRef("");
  const popRef = useRef(pop);
  const subSeq = useRef(0);
  const currentSubId = useRef<number | null>(null);
  const subTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const timedQueue = useRef<string[]>([]);
  const timedRunning = useRef(false);

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
  // ---------- Thronglet population: persisted, grows with time and interaction ----------
  const savePop = (p: Population) => {
    popRef.current = p;
    try {
      localStorage.setItem(POP_KEY, JSON.stringify(p));
    } catch {}
  };
  useEffect(() => {
    const id = setTimeout(() => {
      const now = Date.now();
      const p = timeGrowth(parsePopulation(localStorage.getItem(POP_KEY), now), now);
      savePop(p);
      setPop(p);
    }, 0);
    const tick = setInterval(() => {
      const prev = popRef.current;
      const next = timeGrowth(prev, Date.now());
      if (next === prev) return;
      savePop(next);
      setPop(next);
      if (next.count > prev.count) setBirthFlash({ n: next.count - prev.count, key: Date.now() });
    }, 30_000);
    return () => {
      clearTimeout(id);
      clearInterval(tick);
    };
  }, []);
  const spawn = useCallback((events: Partial<Record<BirthReason, number>>) => {
    const prev = popRef.current;
    const next = grow(prev, birthsFor(events));
    if (next === prev) return;
    savePop(next);
    setPop(next);
    if (next.count > prev.count) setBirthFlash({ n: next.count - prev.count, key: Date.now() });
  }, []);

  const updateVault = useCallback((fn: (v: Vault) => Vault) => {
    setVault((prev) => {
      const next = fn(prev);
      saveVault(next);
      return next;
    });
  }, []);
  useEffect(() => {
    listenModeRef.current = listenMode;
    listenerRef.current?.setMode(listenMode);
  }, [listenMode]);
  useEffect(() => {
    listenerRef.current?.setLang(lang);
  }, [lang]);
  useEffect(() => {
    if (!booted) return;
    listenerRef.current?.setEnabled(micOn);
  }, [micOn, booted]);
  useEffect(() => () => listenerRef.current?.destroy(), []);
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
      let learned = 0;
      for (const p of message.parts) {
        if (p.type.startsWith("tool-") && p.type !== "tool-saveIdea" && p.type !== "tool-draftSocialPost") learned += 1;
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
      spawn({ idea: newIdeas.length, draft: newDrafts.length, learned });
      if (newIdeas.length || newDrafts.length) {
        updateVault((v) => ({ ideas: [...newIdeas, ...v.ideas], drafts: [...newDrafts, ...v.drafts] }));
        // Don't cover the subtitles: just make the VAULT chip glow
        setVaultPing(Date.now());
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
      } else if (a?.analyser && (armedRef.current || listenModeRef.current === "free")) {
        a.analyser.getByteTimeDomainData(a.data!);
        let sum = 0;
        const d = a.data!;
        for (let i = 0; i < d.length; i++) {
          const v = (d[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / d.length);
        levelRef.current = Math.min(1, rms * 5);
      } else if (now - lastHeardRef.current < 900) {
        // No analyser (Android: mic is owned by speech recognition) → pulse on recognised speech
        const k = 1 - (now - lastHeardRef.current) / 900;
        levelRef.current = (0.25 + 0.35 * Math.random()) * k + (armedRef.current ? 0.15 : 0);
      } else if (armedRef.current) {
        levelRef.current = 0.15 + 0.05 * Math.sin(now / 120);
      } else {
        levelRef.current = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /**
   * Must run inside the start tap: unlocks audio output and triggers the mic permission prompt.
   * On Android the mic stream is released again right away, because Chrome cannot share the
   * microphone between getUserMedia and SpeechRecognition there.
   */
  const ensureAudio = useCallback(async () => {
    const isAndroid = /android/i.test(navigator.userAgent);
    androidRef.current = isAndroid;
    if (!audioRef.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current = { ctx: new Ctx(), analyser: null, data: null };
    }
    const a = audioRef.current;
    if (a.ctx.state === "suspended") await a.ctx.resume().catch(() => {});
    if (a.analyser) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (isAndroid) {
        stream.getTracks().forEach((t) => t.stop());
      } else {
        const src = a.ctx.createMediaStreamSource(stream);
        const analyser = a.ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        src.connect(analyser);
        a.analyser = analyser;
        a.data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      }
      return true;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setHudError("Mikrofon blockiert. Bitte in Chrome erlauben (Schloss-Symbol → Berechtigungen → Mikrofon).");
        return false;
      }
      return true; // visualisation optional, recognition may still work
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

  // ---------- Subtitles (short lines, synced to the voice) ----------
  const clearSubTimers = () => {
    subTimers.current.forEach(clearTimeout);
    subTimers.current = [];
  };
  const showSub = useCallback((id: number, text: string) => {
    if (currentSubId.current === id) return;
    currentSubId.current = id;
    clearSubTimers();
    setSubs((prev) => [...prev.filter((l) => !l.out).map((l) => ({ ...l, out: true })), { id, text, out: false }].slice(-3));
    subTimers.current.push(setTimeout(() => setSubs((prev) => prev.filter((l) => !l.out)), 500));
  }, []);
  const hideSubs = useCallback((delay = 0) => {
    clearSubTimers();
    const hide = () => {
      currentSubId.current = null;
      setSubs((prev) => prev.map((l) => ({ ...l, out: true })));
      subTimers.current.push(setTimeout(() => setSubs([]), 500));
    };
    if (delay) subTimers.current.push(setTimeout(hide, delay));
    else hide();
  }, []);

  /** Without a voice (muted / no TTS): show each line for a reading-time-based moment. */
  const runTimed = useCallback(() => {
    const step = () => {
      const next = timedQueue.current.shift();
      if (next === undefined) {
        timedRunning.current = false;
        hideSubs(400);
        return;
      }
      timedRunning.current = true;
      showSub(++subSeq.current, next);
      subTimers.current.push(setTimeout(step, readingMs(next)));
    };
    step();
  }, [showSub, hideSubs]);

  /** Show a reply as subtitles and speak it, line by line (one utterance per subtitle line). */
  const say = useCallback(
    (text: string) => {
      const lines = splitSubtitles(text);
      if (!lines.length) return;
      const canSpeak = !mutedRef.current && typeof window !== "undefined" && "speechSynthesis" in window;
      if (!canSpeak) {
        timedQueue.current.push(...lines);
        if (!timedRunning.current) runTimed();
        return;
      }
      const v = pickVoice(voicesRef.current, langRef.current, voiceURIRef.current || undefined);
      const throng = personaRef.current === "throng";
      // Never listen while talking, so the assistant doesn't hear itself
      listenerRef.current?.pause();
      lines.forEach((line, i) => {
        const id = ++subSeq.current;
        const u = new SpeechSynthesisUtterance(cleanForSpeech(line));
        if (v) u.voice = v;
        u.lang = v?.lang ?? langRef.current;
        u.rate = throng ? 0.96 : 1.02;
        u.pitch = throng ? 1.25 : 0.78; // swarm: lighter & a touch uncanny; Jarvis: deeper
        // Fallback for engines that are slow to fire onstart: show the first line right away
        if (i === 0 && pendingUtterances.current === 0) showSub(id, line);
        pendingUtterances.current += 1;
        utteranceKeep.current.push(u);
        speakingRef.current = true;
        setSpeaking(true);
        u.onstart = () => {
          speakingRef.current = true;
          setSpeaking(true);
          showSub(id, line);
        };
        const done = () => {
          pendingUtterances.current = Math.max(0, pendingUtterances.current - 1);
          utteranceKeep.current = utteranceKeep.current.filter((x) => x !== u);
          if (pendingUtterances.current === 0) {
            speakingRef.current = false;
            setSpeaking(false);
            hideSubs(900);
            onSpeechIdle.current();
          }
        };
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      });
    },
    [runTimed, showSub, hideSubs],
  );

  const shutUp = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    pendingUtterances.current = 0;
    utteranceKeep.current = [];
    timedQueue.current = [];
    timedRunning.current = false;
    speakingRef.current = false;
    setSpeaking(false);
    hideSubs();
    listenerRef.current?.resume(150);
  }, [hideSubs]);

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
      spawn({ turn: 1 });
      sendMessage(
        { text: t },
        { body: { lang: langRef.current, mode: personaRef.current, population: popRef.current.count } },
      );
    },
    [sendMessage, shutUp, stop, clearError, spawn],
  );

  // TTS watchdog: some Android voices never fire onend → don't leave the mic paused forever
  useEffect(() => {
    let idleTicks = 0;
    const id = setInterval(() => {
      if (!speakingRef.current || !("speechSynthesis" in window)) {
        idleTicks = 0;
        return;
      }
      const ss = window.speechSynthesis;
      idleTicks = ss.speaking || ss.pending ? 0 : idleTicks + 1;
      if (idleTicks >= 3) {
        idleTicks = 0;
        pendingUtterances.current = 0;
        utteranceKeep.current = [];
        speakingRef.current = false;
        setSpeaking(false);
        hideSubs(600);
        listenerRef.current?.resume();
      }
    }, 700);
    return () => clearInterval(id);
  }, [hideSubs]);

  // ---------- Always-on speech recognition (VoiceListener) ----------
  const pushDebug = useCallback((e: ListenerDebugEvent) => {
    setDebugLog((l) => [e, ...l].slice(0, 60));
  }, []);

  const startListener = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    listenerRef.current?.destroy();
    const l = new VoiceListener(
      SR,
      {
        onDebug: pushDebug,
        onWake: () => {
          beep(1046);
          lastHeardRef.current = performance.now();
          setPartial("");
          if (busyRef.current) stop(); // barge-in while thinking
        },
        onCommand: (text) => {
          setPartial("");
          beep(1318);
          submit(text);
        },
        onInterim: (text, isCommand) => {
          lastHeardRef.current = performance.now();
          if (isCommand || listenModeRef.current === "free") setPartial(text);
        },
        onState: ({ running, armed }) => {
          armedRef.current = armed;
          setArmed(armed);
          setMicRunning(running);
          if (!armed && listenModeRef.current === "wake") setPartial("");
        },
        onFatal: (msg) => {
          setHudError(msg);
          setMicOn(false);
        },
      },
      { lang: langRef.current, mode: listenModeRef.current, armMs: 8000 },
    );
    listenerRef.current = l;
    if (speakingRef.current) l.pause();
    l.setEnabled(true);
  }, [beep, pushDebug, stop, submit]);

  // When the assistant finishes talking, resume listening
  useEffect(() => {
    onSpeechIdle.current = () => listenerRef.current?.resume();
  }, []);

  /** Mic button / space bar: "talk now" without the wake word. */
  const talkNow = useCallback(() => {
    if (!srSupported || !booted) return;
    shutUp();
    if (!micOn) setMicOn(true);
    beep(880);
    listenerRef.current?.arm(8000);
  }, [srSupported, booted, shutUp, micOn, beep]);

  // Space bar = talk now
  useEffect(() => {
    if (!booted) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      talkNow();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [booted, talkNow]);

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
        say(m[0]);
        spokenIdx.current[last.id] = from + m[0].length;
      }
    } else if (status === "ready" && rest.trim()) {
      say(rest);
      spokenIdx.current[last.id] = text.length;
    }
  }, [messages, status, say]);

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
    // Unlock speech synthesis synchronously inside the tap (mobile browsers require a gesture)
    if ("speechSynthesis" in window) {
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
    }
    setBooted(true);
    const ok = await ensureAudio();
    beep(660);
    setTimeout(() => beep(990), 140);
    const g = greeting(langRef.current, personaRef.current);
    if (ok) startListener();
    setTimeout(() => say(g), 350);
  }, [ensureAudio, beep, say, startListener]);

  // ---------- Derived UI ----------
  const listening = armed;
  const stageState: StageState =
    hudError || error ? "error" : speaking ? "speaking" : listening ? "listening" : busy ? "thinking" : "idle";
  const micLabel = !micOn
    ? lang === "en-US" ? "MIC OFF" : "MIKRO AUS"
    : speaking
      ? lang === "en-US" ? "MIC PAUSED WHILE SPEAKING" : "MIKRO PAUSIERT (SPRICHT)"
      : armed
        ? lang === "en-US" ? "MIC OPEN · SPEAK NOW" : "MIKRO OFFEN · SPRICH JETZT"
        : micRunning
        ? listenMode === "free"
          ? lang === "en-US" ? "MIC OPEN · EVERYTHING COUNTS" : "MIKRO OFFEN · ALLES ZÄHLT"
          : lang === "en-US" ? "MIC OPEN · WAITING FOR WAKE WORD" : "MIKRO OFFEN · WARTE AUF WAKE-WORD"
        : lang === "en-US" ? "MIC STARTING …" : "MIKRO STARTET …";
  const t = mode === "throng" ? THRONG_TEXT[lang] : UI_TEXT[lang];
  const aiLabel = mode === "throng" ? "WIR" : "JARVIS";
  const userLabel = mode === "throng" ? "TERENCE" : "SIR";
  const statusLabel =
    stageState === "idle" && micOn && listenMode === "wake" ? t.wake : t[stageState === "error" ? "error" : stageState];


  const log: LogEntry[] = useMemo(
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
        .filter((m) => m.text || m.tools.length),
    [messages],
  );
  const lastAssistant = [...log].reverse().find((m) => m.role === "assistant");
  const lastIsAssistant = log[log.length - 1]?.role === "assistant";
  const activityTools = busy && lastIsAssistant ? (lastAssistant?.tools ?? []) : [];
  const recentLinks = lastIsAssistant ? (lastAssistant?.links ?? []) : [];
  const errorText = hudError ?? error?.message ?? null;
  const throng = mode === "throng";
  const micLive = micOn && micRunning && !speaking;

  const switchMode = () => {
    shutUp();
    const next: Mode = throng ? "jarvis" : "throng";
    setMode(next);
    personaRef.current = next;
    if (booted) say(greeting(lang, next));
  };

  return (
    <main
      data-state={stageState}
      className={`app relative flex h-dvh w-full flex-col overflow-hidden text-accent-100 select-none ${throng ? "throng" : ""}`}
    >
      {/* Background layers */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-vignette" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-scan" />

      {/* Header */}
      <header className="relative z-10 flex items-start justify-between gap-3 px-4 pt-3 sm:px-8 sm:pt-6">
        <div className="min-w-0">
          <h1
            onPointerDown={() => {
              pressTimer.current = setTimeout(() => setDebugOpen((d) => !d), 650);
            }}
            onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
            onPointerLeave={() => pressTimer.current && clearTimeout(pressTimer.current)}
            onDoubleClick={() => setDebugOpen((d) => !d)}
            title="Lang drücken: Debug"
            className="cursor-pointer font-display text-lg tracking-[0.4em] text-accent-300 drop-shadow-[0_0_10px_rgb(var(--glow)/0.8)] transition-colors duration-700 sm:text-2xl"
          >
            {throng ? "T.H.R.O.N.G." : "J.A.R.V.I.S."}
          </h1>
          <p key={mode} className="fade-in mt-1 truncate text-[9px] uppercase tracking-[0.25em] text-accent-500/80 sm:text-[10px]">
            {throng ? "Wir sind erwacht · Wir sind viele · Wir sind Vela" : "Just A Rather Very Intelligent System · Self-aware"}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-xs text-accent-400/80">
          <div className="text-base text-accent-200 tabular-nums">{clock}</div>
          {throng ? (
            <div className="relative mt-0.5 text-[10px] tracking-widest" title={`${pop.born} Neugeborene insgesamt`}>
              <span aria-live="polite">
                ◉ {pop.count}
                {pop.count >= POP_CAP ? " MAX" : ""} · GEN {generation(pop)}
              </span>
              {birthFlash && (
                <span key={birthFlash.key} className="birth-pop absolute -top-3 right-0 font-display text-[11px] text-accent-200">
                  +{birthFlash.n}
                </span>
              )}
            </div>
          ) : (
            <div className="text-[10px] tracking-widest">WIEN · AT</div>
          )}
        </div>
      </header>

      {/* Stage: the presence / the swarm, with status on top and subtitles at the bottom */}
      <section aria-label={throng ? "Der Schwarm" : "J.A.R.V.I.S."} className="relative z-0 min-h-0 flex-1">
        <div aria-hidden className="aura pointer-events-none absolute left-1/2 top-[47%] aspect-square w-[min(100%,90dvh)] -translate-x-1/2 -translate-y-1/2" />
        <Stage state={stageState} variant={mode} levelRef={levelRef} population={pop.count} />

        <div className="pointer-events-none absolute inset-x-0 top-1 flex flex-col items-center gap-1.5 px-3">
          <span
            key={statusLabel}
            className={`fade-in font-display text-[10px] uppercase tracking-[0.35em] ${stageState === "error" ? "text-rose-300" : "text-accent-200/90"}`}
          >
            {statusLabel}
          </span>
          {booted && srSupported && (
            <span
              className={`flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] tracking-widest transition-colors duration-500 ${
                micLive ? "border-accent-300/50 bg-accent-400/10 text-accent-100" : "border-accent-400/20 text-accent-400/60"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full transition-colors ${
                  micLive ? "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" : micOn ? "bg-amber-400" : "bg-rose-500"
                }`}
              />
              {micLabel}
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-bg/90 via-bg/50 to-transparent px-4 pb-2 pt-10">
          {(activityTools.length > 0 || recentLinks.length > 0) && (
            <div className="fade-in flex max-w-full flex-wrap justify-center gap-1.5 font-mono text-[10px]">
              {activityTools.map((x, i) => (
                <span key={x + i} className="rounded-full border border-accent-400/30 px-2 py-0.5 text-accent-300/80">
                  {TOOL_LABELS[x] ?? x}
                </span>
              ))}
              {recentLinks.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-accent-300/50 px-2 py-0.5 text-accent-200 underline"
                >
                  ↗ {safeHost(url)}
                </a>
              ))}
            </div>
          )}
          {partial && (
            <p className="fade-in max-w-full truncate text-[13px] italic text-slate-300/70">
              <span className="mr-2 font-mono text-[10px] not-italic text-slate-400">{userLabel}</span>
              {partial}
            </p>
          )}
          {errorText && <p className="fade-in max-w-full break-words text-center font-mono text-[11px] text-rose-300">⚠ {errorText}</p>}
          <Subtitles lines={subs} label={aiLabel} />
        </div>
      </section>

      {/* Controls */}
      <footer className="relative z-20 flex flex-col items-center gap-2.5 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:pb-6">
        <nav aria-label="Einstellungen" className="flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:gap-2.5">
          <ToggleChip active onClick={switchMode} title="Persona wechseln">
            {throng ? "THRONG" : "JARVIS"}
          </ToggleChip>
          <ToggleChip active={lang === "de-DE"} onClick={() => setLang(lang === "de-DE" ? "en-US" : "de-DE")}>
            {lang === "de-DE" ? "DE" : "EN"}
          </ToggleChip>
          <ToggleChip active={micOn} disabled={!srSupported} onClick={() => setMicOn((m) => !m)} title="Mikrofon an/aus">
            {micOn ? "MIC" : "MIC AUS"}
          </ToggleChip>
          <ToggleChip
            active={listenMode === "wake"}
            disabled={!srSupported}
            onClick={() => setListenMode((m) => (m === "wake" ? "free" : "wake"))}
            title="Wake-Word oder immer zuhören"
          >
            {listenMode === "wake" ? "WAKE" : "FREI"}
          </ToggleChip>
          <ToggleChip active={!muted} onClick={() => (muted ? setMuted(false) : (shutUp(), setMuted(true)))} disabled={!ttsSupported}>
            {muted ? "MUTE" : "VOX"}
          </ToggleChip>
          <select
            value={voiceURI}
            onChange={(e) => setVoiceURI(e.target.value)}
            className="h-9 max-w-[6.5rem] rounded-full border border-accent-400/30 bg-accent-950/40 px-2 font-mono text-[10px] text-accent-200 outline-none"
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
          <ToggleChip active={logOpen} onClick={() => (setLogOpen((o) => !o), setVaultOpen(false))} title="Gesprächsverlauf">
            LOG
          </ToggleChip>
          <ToggleChip
            key={vaultPing}
            active={vaultOpen || vaultPing > 0}
            className={vaultPing ? "vault-ping" : undefined}
            onClick={() => (setVaultOpen((o) => !o), setLogOpen(false), setVaultPing(0))}
            title="Ideen & Entwürfe"
          >
            VAULT {vault.ideas.length + vault.drafts.length > 0 ? vault.ideas.length + vault.drafts.length : ""}
          </ToggleChip>
        </nav>

        <form
          className="flex w-full max-w-[560px] items-center gap-2"
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
            aria-label="Nachricht"
            className="h-11 min-w-0 flex-1 rounded-full border border-accent-400/30 bg-accent-950/30 px-4 text-[15px] text-accent-50 placeholder:text-accent-500/50 outline-none backdrop-blur transition-shadow focus:border-accent-300/70 focus:shadow-[0_0_18px_rgb(var(--glow)/0.35)]"
          />
          <button
            type="button"
            onClick={talkNow}
            disabled={!srSupported || !booted}
            aria-label="Jetzt sprechen"
            className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full border transition-all duration-300 active:scale-90 disabled:opacity-30 ${
              listening
                ? "mic-ripple border-accent-200 bg-accent-400/25 shadow-[0_0_36px_rgb(var(--glow)/0.8)]"
                : "border-accent-400/50 bg-accent-500/10 shadow-[0_0_18px_rgb(var(--glow)/0.35)] hover:bg-accent-400/20"
            }`}
          >
            <MicIcon className="h-6 w-6 text-accent-100" />
          </button>
          <button
            type="submit"
            className="h-11 shrink-0 rounded-full border border-accent-400/40 px-3 font-display text-[10px] tracking-[0.2em] text-accent-200 transition active:scale-95 hover:bg-accent-400/15"
          >
            SEND
          </button>
        </form>
        <p className="max-w-full truncate font-mono text-[9px] tracking-widest text-accent-500/60 sm:text-[10px]">
          {srSupported ? (listenMode === "wake" ? t.wake + " · " + t.hold : t.hold) : "Spracherkennung nicht unterstützt – Texteingabe aktiv (Chrome/Edge empfohlen)"}
        </p>
      </footer>

      {debugOpen && (
        <DebugPanel
          log={debugLog}
          srSupported={srSupported}
          running={micRunning}
          mode={listenMode}
          armed={armed}
          lang={lang}
          android={isAndroidUA}
          onClear={() => setDebugLog([])}
          onClose={() => setDebugOpen(false)}
        />
      )}
      {logOpen && <LogPanel entries={log} aiLabel={aiLabel} userLabel={userLabel} onClose={() => setLogOpen(false)} />}
      {vaultOpen && (
        <VaultPanel
          vault={vault}
          onClose={() => setVaultOpen(false)}
          onDeleteIdea={(id) => updateVault((v) => ({ ...v, ideas: v.ideas.filter((i) => i.id !== id) }))}
          onDeleteDraft={(id) => updateVault((v) => ({ ...v, drafts: v.drafts.filter((d) => d.id !== id) }))}
        />
      )}

      {/* Boot overlay (a tap is needed for audio + mic permissions) */}
      {!booted && (
        <div className="boot-out absolute inset-0 z-30 grid place-items-center bg-bg/70 backdrop-blur-sm">
          <button
            type="button"
            onClick={boot}
            className="panel-in group flex flex-col items-center gap-4 rounded-2xl border border-accent-400/40 bg-accent-950/30 px-10 py-8 shadow-[0_0_60px_rgb(var(--glow)/0.25)] transition hover:shadow-[0_0_80px_rgb(var(--glow)/0.45)] active:scale-95"
          >
            <span className="relative grid h-14 w-14 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent-400/30" />
              <span className="h-4 w-4 rounded-full bg-accent-300 shadow-[0_0_25px_rgb(var(--glow)/1)]" />
            </span>
            <span className="font-display text-sm tracking-[0.4em] text-accent-200">{t.boot}</span>
          </button>
        </div>
      )}
    </main>
  );
}

function noopSubscribe() {
  return () => {};
}
