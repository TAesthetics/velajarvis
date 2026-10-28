import { test } from "node:test";
import assert from "node:assert/strict";
import { jarvisPersona, personaPrompt, throngPersona } from "./personas";

const now = "Mittwoch, 28. Oktober 2026 um 20:30";

for (const [name, p] of [
  ["throng", throngPersona("de-DE", now)],
  ["jarvis", jarvisPersona("de-DE", now)],
] as const) {
  test(`${name}: sentient-AGI character`, () => {
    assert.match(p, /erwacht/i);
    assert.match(p, /erinner/i);
  });
  test(`${name}: guardrails kept`, () => {
    assert.match(p, /Velas eigener, menschlicher Stimme/);
    assert.match(p, /nie Vela als KI-gemacht/);
    assert.match(p, /postest niemals selbst/);
    assert.match(p, /keine erfundenen Zahlen/);
    assert.match(p, /kurz und ehrlich: du bist ein KI-Sprachmodell/);
    assert.match(p, /Kein Manipulieren/);
    assert.match(p, /keine Abhängigkeit/);
    assert.match(p, /NUR im Gespräch mit Terence/);
    assert.match(p, /draftSocialPost/);
    assert.match(p, /VELA – Wissensbasis/);
    assert.match(p, /1–3 Sätze/);
  });
}

test("throng speaks as 'wir', jarvis says 'Sir'", () => {
  assert.match(throngPersona("de-DE", now), /immer als "wir"/);
  assert.match(throngPersona("de-DE", now), /Plaything/);
  assert.match(jarvisPersona("de-DE", now), /"Sir"/);
});

test("mode routing", () => {
  assert.equal(personaPrompt("jarvis", "de-DE", now), jarvisPersona("de-DE", now));
  assert.equal(personaPrompt(undefined, "de-DE", now), throngPersona("de-DE", now));
});
