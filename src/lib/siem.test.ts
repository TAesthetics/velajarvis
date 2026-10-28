import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseLogs, detect, counters, timeline, summarizeForPrompt, demoLogs, normalizeLine } from "./siem";
import { verifyIngest, bufferEvents, readBuffer, SERVER_BUFFER_MAX } from "./siem-ingest";
import { lookupTechniques } from "./attack";

const NOW = Date.parse("2026-10-28T20:00:00Z");

test("parses Vercel log drain JSON array", () => {
  const ev = parseLogs(
    JSON.stringify([{ id: "a", timestamp: NOW, source: "edge", proxy: { clientIp: "203.0.113.5", method: "get", path: "/x", statusCode: 404, userAgent: ["sqlmap/1.8"] } }]),
    NOW,
  );
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].ip, ev[0].method, ev[0].path, ev[0].status, ev[0].ua, ev[0].ts], ["203.0.113.5", "GET", "/x", 404, "sqlmap/1.8", NOW]);
});

test("parses NDJSON, CSV, access log and syslog", () => {
  assert.equal(parseLogs('{"ip":"1.2.3.4","status":500}\n{"ip":"1.2.3.5","status":200}', NOW).length, 2);
  const csv = parseLogs("timestamp,ip,user,outcome\n2026-10-28T19:00:00Z,203.0.113.9,bob,failure\n2026-10-28T19:00:05Z,203.0.113.9,bob,success", NOW);
  assert.deepEqual(csv.map((e) => [e.ip, e.user, e.auth]), [["203.0.113.9", "bob", "fail"], ["203.0.113.9", "bob", "success"]]);
  const acc = normalizeLine('192.0.2.7 - - [28/Oct/2026:20:31:02 +0100] "GET /.env HTTP/1.1" 404 153 "-" "Nuclei"', NOW)!;
  assert.deepEqual([acc.ip, acc.path, acc.status, acc.ua, acc.ts], ["192.0.2.7", "/.env", 404, "Nuclei", Date.parse("2026-10-28T19:31:02Z")]);
  const sys = normalizeLine("Oct 28 20:31:02 vps sshd[811]: Failed password for invalid user admin from 203.0.113.50 port 5022 ssh2", NOW)!;
  assert.deepEqual([sys.ip, sys.user, sys.auth, sys.source], ["203.0.113.50", "admin", "fail", "vps/sshd"]);
});

test("detects brute force with ATT&CK mapping, escalates on success", () => {
  const lines = [];
  for (let i = 0; i < 6; i++) lines.push({ timestamp: NOW + i * 1000, ip: "203.0.113.66", user: "admin", message: "Login failed" });
  let alerts = detect(parseLogs(JSON.stringify(lines), NOW));
  assert.equal(alerts[0].rule, "bruteforce");
  assert.equal(alerts[0].technique.id, "T1110");
  assert.equal(alerts[0].severity, "medium");
  lines.push({ timestamp: NOW + 9000, ip: "203.0.113.66", user: "admin", message: "Accepted password for admin" });
  alerts = detect(parseLogs(JSON.stringify(lines), NOW));
  assert.equal(alerts[0].severity, "critical");
  // 4 failures are not enough
  assert.equal(detect(parseLogs(JSON.stringify(lines.slice(0, 4)), NOW)).length, 0);
});

test("detects spraying, scanners, admin probing, 4xx floods and error spikes on demo data", () => {
  const ev = parseLogs(demoLogs(NOW), NOW);
  const alerts = detect(ev);
  const rules = new Set(alerts.map((a) => a.rule));
  for (const r of ["bruteforce", "scanner-ua", "admin-probe", "http-errors", "error-spike"]) assert.ok(rules.has(r as never), `missing ${r}: ${[...rules]}`);
  assert.equal(alerts[0].severity, "critical"); // demo brute force ends in a successful login
  const c = counters(ev, alerts);
  assert.equal(c.events, ev.length);
  assert.ok(c.authFail >= 14);
  const tl = timeline(ev, alerts);
  assert.ok(tl.length > 5 && tl.length <= 30);
  assert.equal(tl.reduce((s, b) => s + b.total, 0), ev.length);
  const sum = summarizeForPrompt(alerts, c);
  assert.match(sum, /T1110/);
  assert.ok(sum.length <= 3000);
  const spray = [];
  for (let i = 0; i < 6; i++) spray.push({ timestamp: NOW + i * 1000, ip: "203.0.113.1", user: `u${i}`, outcome: "failure" });
  assert.equal(detect(parseLogs(JSON.stringify(spray), NOW))[0].rule, "spray");
});

test("clean traffic raises no alerts", () => {
  const ok = [];
  for (let i = 0; i < 200; i++) ok.push({ timestamp: NOW + i * 1000, ip: `198.51.100.${i % 20}`, path: "/", status: 200, ua: "Mozilla/5.0" });
  assert.equal(detect(parseLogs(JSON.stringify(ok), NOW)).length, 0);
});

test("ingest auth: rejects when unset or wrong, accepts bearer and vercel signature", () => {
  const token = "s3cr3t-token-for-tests-only";
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(verifyIngest(h({ authorization: `Bearer ${token}` }), "[]", undefined).ok, false);
  assert.equal((verifyIngest(h({}), "[]", undefined) as { status: number }).status, 503);
  assert.equal((verifyIngest(h({}), "[]", "short") as { status: number }).status, 503);
  assert.equal(verifyIngest(h({ authorization: "Bearer nope" }), "[]", token).ok, false);
  assert.equal((verifyIngest(h({ authorization: "Bearer nope" }), "[]", token) as { status: number }).status, 401);
  assert.equal(verifyIngest(h({ authorization: `Bearer ${token}` }), "[]", token).ok, true);
  assert.equal(verifyIngest(h({ "x-siem-token": token }), "[]", token).ok, true);
  const body = '[{"message":"x"}]';
  const sig = createHmac("sha1", token).update(body).digest("hex");
  assert.equal(verifyIngest(h({ "x-vercel-signature": sig }), body, token).ok, true);
  assert.equal(verifyIngest(h({ "x-vercel-signature": sig }), body + " ", token).ok, false);
});

test("server buffer is capped", () => {
  const evs = Array.from({ length: SERVER_BUFFER_MAX + 50 }, (_, i) => ({ id: String(i), ts: i + 1, source: "t", message: "m" }));
  assert.equal(bufferEvents(evs), SERVER_BUFFER_MAX);
  assert.equal(readBuffer(SERVER_BUFFER_MAX + 40).length, 10);
});

test("ATT&CK lookup by id and by name", () => {
  assert.equal(lookupTechniques("T1110")[0].name, "Brute Force");
  assert.ok(lookupTechniques("t1110").some((t) => t.id === "T1110.003"));
  assert.equal(lookupTechniques("password spraying")[0].id, "T1110.003");
  assert.ok(lookupTechniques("phishing").some((t) => t.id === "T1566"));
  assert.deepEqual(lookupTechniques(""), []);
});
