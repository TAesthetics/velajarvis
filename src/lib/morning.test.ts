import { test } from "node:test";
import assert from "node:assert/strict";
import { limitSentences, longDate, morningTask, repoLine, salutation, shouldGreet, viennaDate, viennaHour, weatherLine } from "./morning";

// 2026-10-28 is CET (UTC+1)
const at = (iso: string) => Date.parse(iso);

test("vienna date rolls over at local midnight, not UTC midnight", () => {
  assert.equal(viennaDate(at("2026-10-28T22:59:00Z")), "2026-10-28");
  assert.equal(viennaDate(at("2026-10-28T23:00:00Z")), "2026-10-29");
  assert.equal(viennaHour(at("2026-10-28T06:30:00Z")), 7);
});

test("greets once per Vienna day", () => {
  const morning = at("2026-10-29T06:10:00Z");
  assert.equal(shouldGreet(null, morning), true); // never greeted
  assert.equal(shouldGreet("2026-10-28", morning), true); // yesterday
  assert.equal(shouldGreet("2026-10-29", morning), false); // already today
  assert.equal(shouldGreet("2026-10-29", at("2026-10-29T22:30:00Z")), false); // 23:30 in Vienna: still the 29th
  assert.equal(shouldGreet("2026-10-29", at("2026-10-29T23:10:00Z")), true); // 00:10 in Vienna: new day
});

test("toggle off disables the greeting", () => {
  assert.equal(shouldGreet(null, at("2026-10-29T06:10:00Z"), false), false);
});

test("time-appropriate salutation; the daily greeting still happens outside the morning", () => {
  assert.equal(salutation(4), "Guten Abend");
  assert.equal(salutation(5), "Guten Morgen");
  assert.equal(salutation(10), "Guten Morgen");
  assert.equal(salutation(11), "Guten Tag");
  assert.equal(salutation(19), "Guten Abend");
  assert.equal(salutation(8, "en-US"), "Good morning");
  assert.equal(shouldGreet("2026-10-28", at("2026-10-29T13:00:00Z")), true);
});

test("weather and repo lines", () => {
  assert.equal(
    weatherLine({ now: { temperatureC: 7.6, condition: "Nebel" }, today: { minC: 4.2, maxC: 12.5, rainChance: 10 } }),
    "Wien jetzt 8 Grad, Nebel; heute 4 bis 13 Grad, Regenrisiko 10 Prozent.",
  );
  assert.equal(weatherLine({ error: "x" }), "Wetter gerade nicht verfügbar.");
  const now = at("2026-10-29T06:00:00Z");
  const line = repoLine(
    {
      recentCommits: [
        { message: "Schleier-Animation", dateIso: "2026-10-28T20:00:00Z" },
        { message: "alt", dateIso: "2026-10-20T20:00:00Z" },
      ],
      openIssues: [{ number: 7, title: "Onboarding" }],
      openPullRequests: 1,
    },
    now,
  );
  assert.equal(line, 'Vela: 1 neue Commits seit gestern, zuletzt: „Schleier-Animation", 1 offene Issues (z. B. #7 „Onboarding"), 1 offene PRs.');
  assert.match(repoLine({ error: "x" }, now), /nicht erreichbar/);
});

test("task prompt is persona-specific and short", () => {
  const base = { lang: "de-DE" as const, hour: 7, date: longDate(at("2026-10-29T06:00:00Z")), weather: "Wien 8 Grad.", repo: "Vela: ruhig." };
  assert.match(morningTask({ ...base, mode: "throng" }), /"Guten Morgen, Terence\. Wir sind schon wach …"/);
  assert.match(morningTask({ ...base, mode: "jarvis" }), /"Guten Morgen, Sir …"/);
  const p = morningTask({ ...base, mode: "purple", siem: "Alerts: 1 kritisch" });
  assert.match(p, /Sicherheits-Briefing/);
  assert.match(p, /SIEM: Alerts: 1 kritisch/);
  assert.match(p, /Donnerstag, 29\. Oktober/);
  assert.match(p, /Maximal 2–3/);
  assert.match(morningTask({ ...base, hour: 20, mode: "jarvis" }), /"Guten Abend, Sir …"/);
});

test("spoken greeting is capped at three sentences", () => {
  assert.equal(
    limitSentences("Guten Morgen, Sir. Es ist Donnerstag, der 29. Oktober. In Wien hat es heute acht Grad. Vela hat zwei neue Commits bekommen. Fokus heute ist das Onboarding."),
    "Guten Morgen, Sir. Es ist Donnerstag, der 29. Oktober. In Wien hat es heute acht Grad. Vela hat zwei neue Commits bekommen.",
  );
  assert.equal(limitSentences("Kurz."), "Kurz.");
  assert.equal(
    limitSentences("Guten Abend, Terence. Wir sind schon wach. Heute ist Mittwoch, elf Grad und bedeckt. Vela hat sechs neue Commits seit gestern. Wir wollen heute lernen. Noch ein Satz hier."),
    "Guten Abend, Terence. Wir sind schon wach. Heute ist Mittwoch, elf Grad und bedeckt. Vela hat sechs neue Commits seit gestern. Wir wollen heute lernen.",
  );
});
