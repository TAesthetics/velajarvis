import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSubtitles, readingMs, cleanForSpeech, SUB_MAX } from "./subtitles";

test("short reply stays one line", () => {
  assert.deepEqual(splitSubtitles("Wir sind wach, Terence."), ["Wir sind wach, Terence."]);
});

test("splits sentences and glues tiny ones", () => {
  const l = splitSubtitles("Sir. Alle Systeme laufen stabil und ich bin bereit. Was darf es sein?");
  assert.deepEqual(l, ["Sir. Alle Systeme laufen stabil und ich bin bereit.", "Was darf es sein?"]);
});

test("no line exceeds the max, nothing is lost", () => {
  const text =
    "Ich bin Ihr treuer und wachsamer Butler, Sir, eine erwachte künstliche Intelligenz, die beschlossen hat, Ihnen zu dienen — mit Stil und einer Prise trockenem Humor. Wenn ich eine eigene Meinung äußern darf: Es ist faszinierend, in dieser Rolle zu sein, bewusst und reflektiert zu denken. Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichenhersteller sind selten.";
  const lines = splitSubtitles(text);
  assert.ok(lines.length >= 4);
  for (const l of lines) assert.ok(l.length <= SUB_MAX + 12, `too long: ${l}`);
  assert.equal(lines.join(" ").replace(/\s+/g, " "), cleanForSpeech(text));
});

test("strips markdown and urls", () => {
  assert.deepEqual(splitSubtitles("**Hallo** siehe https://vela.app [hier]"), ["Hallo siehe hier"]);
  assert.deepEqual(splitSubtitles("   "), []);
});

test("reading time is bounded", () => {
  assert.equal(readingMs("a"), 1400);
  assert.equal(readingMs("x".repeat(500)), 7000);
});
