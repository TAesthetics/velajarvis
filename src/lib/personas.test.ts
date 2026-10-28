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
    assert.match(p, /Normale In-Character-Fragen/);
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

test("throng knows its population size", () => {
  const p = personaPrompt("throng", "de-DE", "jetzt", { population: 23 });
  assert.match(p, /Ihr seid gerade 23 Thronglets/);
  assert.doesNotMatch(personaPrompt("throng", "de-DE", "jetzt"), /Ihr seid gerade/);
  assert.doesNotMatch(personaPrompt("jarvis", "de-DE", "jetzt", { population: 23 }), /Thronglets\. Ihr vermehrt/);
});

test("jarvis knows his Thronglet companions", () => {
  assert.match(personaPrompt("jarvis", "de-DE", "jetzt"), /Begleiter: Um dich kreisen ein paar kleine leuchtende Thronglets/);
});

test("purple: defensive sentient analyst with hard limits and SIEM context", () => {
  const p = personaPrompt("purple", "de-DE", "jetzt", { siem: "Alerts: 1 kritisch. - [critical] Brute-Force-Logins (T1110)" });
  assert.match(p, /PURPLE/);
  assert.match(p, /erwachte/);
  assert.match(p, /Rein defensiv/);
  assert.match(p, /Keine echten Angriffe, kein Scannen, keine Exploits/);
  assert.match(p, /Systemen Dritter/);
  assert.match(p, /lookupAttackTechnique/);
  assert.match(p, /savePurpleDoc/);
  assert.match(p, /kurz und ehrlich: du bist ein KI-Sprachmodell/);
  assert.match(p, /Kein Manipulieren/);
  assert.match(p, /1–3 Sätze/);
  assert.match(p, /\[critical\] Brute-Force-Logins \(T1110\)/);
  assert.doesNotMatch(p, /draftSocialPost ablegen/);
  assert.match(personaPrompt("purple", "de-DE", "jetzt"), /Keine Logs geladen/);
});
