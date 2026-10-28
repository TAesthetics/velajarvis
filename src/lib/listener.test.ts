import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceListener, type ListenerDebugEvent } from "./listener";
import type { SpeechRec, SRResultEvent } from "./speech";

// Fake Android-style recognizer: ends after every utterance, ignores continuous.
class FakeRec implements SpeechRec {
  static instances: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: SRResultEvent) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = false;
  aborted = false;
  constructor() {
    FakeRec.instances.push(this);
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  say(text: string, isFinal: boolean) {
    const result = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) } as unknown as SRResultEvent);
  }
  utter(text: string) {
    // interim chunks then final, then Android ends the session
    const words = text.split(" ");
    for (let i = 1; i < words.length; i++) this.say(words.slice(0, i).join(" "), false);
    this.say(text, true);
    this.onend?.();
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

const last = () => FakeRec.instances[FakeRec.instances.length - 1];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(mode: "wake" | "free" = "wake") {
  FakeRec.instances = [];
  const out = { commands: [] as string[], wakes: [] as string[], debug: [] as ListenerDebugEvent[], armed: false };
  const l = new VoiceListener(
    FakeRec,
    {
      onCommand: (c) => out.commands.push(c),
      onWake: (m) => out.wakes.push(m.word),
      onDebug: (e) => out.debug.push(e),
      onState: (s) => (out.armed = s.armed),
    },
    { lang: "de-DE", mode, armMs: 300 },
  );
  return { l, out };
}

test("wake word + command in one utterance, survives Android session ends", async () => {
  const { l, out } = setup();
  l.setEnabled(true);
  assert.equal(FakeRec.instances.length, 1);
  last().utter("Hey Jarvis wie spät ist es");
  assert.deepEqual(out.wakes, ["jarvis"]);
  assert.deepEqual(out.commands, ["wie spät ist es"]);
  await sleep(200);
  assert.equal(FakeRec.instances.length, 2, "restarted after onend");
  last().utter("strong schreib einen Post");
  assert.deepEqual(out.commands, ["wie spät ist es", "schreib einen Post"]);
  l.destroy();
});

test("wake word fires on interim (instant feedback)", () => {
  const { l, out } = setup();
  l.setEnabled(true);
  last().say("Throng", false);
  assert.deepEqual(out.wakes, ["throng"]);
  assert.equal(out.commands.length, 0);
  l.destroy();
});

test("wake word alone arms, next utterance is the command, timeout disarms", async () => {
  const { l, out } = setup();
  l.setEnabled(true);
  last().utter("Throng");
  assert.equal(out.armed, true);
  await sleep(200);
  last().utter("öffne YouTube");
  assert.deepEqual(out.commands, ["öffne YouTube"]);
  assert.equal(out.armed, false);
  await sleep(200);
  last().utter("Jarvis");
  assert.equal(out.armed, true);
  await sleep(400);
  assert.equal(out.armed, false, "disarmed after timeout");
  last().utter("das ist kein Befehl");
  assert.equal(out.commands.length, 1);
  l.destroy();
});

test("no wake word → ignored", async () => {
  const { l, out } = setup();
  l.setEnabled(true);
  last().utter("wie wird das Wetter");
  assert.equal(out.commands.length, 0);
  l.destroy();
});

test("free mode sends everything", () => {
  const { l, out } = setup("free");
  l.setEnabled(true);
  last().utter("wie wird das Wetter");
  assert.deepEqual(out.commands, ["wie wird das Wetter"]);
  l.destroy();
});

test("paused while speaking: no restart, resumes afterwards", async () => {
  const { l } = setup();
  l.setEnabled(true);
  const first = last();
  l.pause();
  assert.equal(first.aborted, true);
  await sleep(3000); // longer than watchdog interval
  assert.equal(FakeRec.instances.length, 1, "no restart while paused");
  l.resume(10);
  await sleep(50);
  assert.equal(FakeRec.instances.length, 2);
  l.destroy();
});

test("no-speech / network errors keep restarting with backoff", async () => {
  const { l } = setup();
  l.setEnabled(true);
  last().fail("no-speech");
  await sleep(200);
  assert.equal(FakeRec.instances.length, 2);
  last().fail("network");
  await sleep(300);
  assert.equal(FakeRec.instances.length, 2, "network backoff ~1s");
  await sleep(900);
  assert.equal(FakeRec.instances.length, 3);
  l.destroy();
});

test("not-allowed stops for good", async () => {
  FakeRec.instances = [];
  let fatal = "";
  const l = new VoiceListener(FakeRec, { onFatal: (m) => (fatal = m) }, { lang: "de-DE", mode: "wake" });
  l.setEnabled(true);
  last().fail("not-allowed");
  await sleep(300);
  assert.ok(fatal.includes("Mikrofon"));
  assert.equal(FakeRec.instances.length, 1);
  l.destroy();
});
