import { test } from "node:test";
import assert from "node:assert/strict";
import { findWakeWord, isEmptyCommand, levenshtein, tokenWakeWord } from "./wake";

test("levenshtein basics", () => {
  assert.equal(levenshtein("jarvis", "jarvis"), 0);
  assert.equal(levenshtein("javis", "jarvis"), 1);
  assert.equal(levenshtein("strong", "throng"), 2);
});

const JARVIS = [
  "Jarvis", "jarvis", "Javis", "Travis", "Service", "Charvis", "Tschawis", "Dschawis", "Jawis", "Jarwis", "Jervis", "Jarvis,",
];
const THRONG = ["Throng", "Thron", "strong", "Throne", "Drong", "Trong", "thrown", "Schwarm", "Throngs"];

for (const w of JARVIS) test(`jarvis variant: ${w}`, () => assert.equal(tokenWakeWord(w.toLowerCase().replace(/[^a-z]/g, "")), "jarvis"));
for (const w of THRONG) test(`throng variant: ${w}`, () => assert.equal(tokenWakeWord(w.toLowerCase()), "throng"));

test("no false positives on everyday German", () => {
  const sentences = [
    "Wie wird das Wetter morgen in Wien",
    "Ich fahre nach Paris",
    "Das Thema ist schwierig",
    "Der Strom ist ausgefallen",
    "trotzdem danke",
    "Schreib mir einen Post über Vela",
    "Was kostet das",
    "Wir treffen uns am Strand",
  ];
  for (const s of sentences) assert.equal(findWakeWord(s), null, s);
});

test("command in same utterance", () => {
  const m = findWakeWord("Hey Jarvis, wie spät ist es?");
  assert.equal(m?.word, "jarvis");
  assert.equal(m?.command, "wie spät ist es?");
});

test("mangled throng with command", () => {
  const m = findWakeWord("strong schreib einen X Post über den Schleier");
  assert.equal(m?.word, "throng");
  assert.equal(m?.command, "schreib einen X Post über den Schleier");
});

test("Service as Jarvis", () => {
  const m = findWakeWord("Service wie wird das Wetter");
  assert.equal(m?.word, "jarvis");
  assert.equal(m?.command, "wie wird das Wetter");
});

test("wake word alone", () => {
  const m = findWakeWord("Okay Throng");
  assert.equal(m?.word, "throng");
  assert.ok(isEmptyCommand(m!.command));
  assert.ok(isEmptyCommand("bitte"));
  assert.ok(!isEmptyCommand("wie spät ist es"));
});

test("split tokens", () => {
  assert.equal(findWakeWord("jar vis was gibt's neues")?.word, "jarvis");
});

test("wake word later in sentence", () => {
  const m = findWakeWord("also Jarvis öffne YouTube");
  assert.equal(m?.command, "öffne YouTube");
});
