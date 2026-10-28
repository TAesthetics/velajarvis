/**
 * Mini-SIEM: parse logs (JSON / NDJSON / Vercel log drain / CSV / syslog / access logs),
 * normalize them to one event shape and run small ATT&CK-mapped detections.
 * Pure functions only: used in the browser panel, the ingest API and the tests.
 * Defensive analysis of your OWN logs; nothing here touches other systems.
 */

export type Severity = "low" | "medium" | "high" | "critical";

export type SiemEvent = {
  id: string;
  /** epoch ms */
  ts: number;
  source: string;
  ip?: string;
  user?: string;
  method?: string;
  path?: string;
  status?: number;
  ua?: string;
  /** derived: an authentication failure / success */
  auth?: "fail" | "success";
  message: string;
};

export type Alert = {
  id: string;
  rule: RuleId;
  title: string;
  severity: Severity;
  technique: { id: string; name: string; tactic: string };
  ip?: string;
  user?: string;
  count: number;
  first: number;
  last: number;
  evidence: string[];
  detail: string;
  response: string;
};

export type RuleId = "bruteforce" | "spray" | "http-errors" | "scanner-ua" | "admin-probe" | "error-spike";

export const RULES: Record<RuleId, { title: string; technique: Alert["technique"]; response: string }> = {
  bruteforce: {
    title: "Brute-Force-Logins",
    technique: { id: "T1110", name: "Brute Force", tactic: "Credential Access" },
    response: "IP temporär sperren/rate-limiten, betroffene Konten prüfen, MFA erzwingen, Lockout-Policy kontrollieren.",
  },
  spray: {
    title: "Password Spraying",
    technique: { id: "T1110.003", name: "Password Spraying", tactic: "Credential Access" },
    response: "Quell-IP blocken, alle betroffenen Konten auf erfolgreiche Logins prüfen, MFA und Passwort-Policy durchsetzen.",
  },
  "http-errors": {
    title: "Viele 4xx/5xx von einer IP",
    technique: { id: "T1595", name: "Active Scanning", tactic: "Reconnaissance" },
    response: "IP rate-limiten oder per WAF-Regel blocken, angefragte Pfade auf Treffer (2xx) prüfen.",
  },
  "scanner-ua": {
    title: "Scanner-User-Agent",
    technique: { id: "T1595.002", name: "Vulnerability Scanning", tactic: "Reconnaissance" },
    response: "User-Agent/IP per WAF blocken, prüfen ob ein Pfad mit 2xx geantwortet hat, Patch-Stand der getroffenen Komponenten prüfen.",
  },
  "admin-probe": {
    title: "Admin-/Config-Pfade abgetastet",
    technique: { id: "T1595.003", name: "Wordlist Scanning", tactic: "Reconnaissance" },
    response: "Sensible Pfade (.env, .git, Admin) dürfen nie 200 liefern: prüfen, IP blocken, Admin-Bereiche hinter Auth/IP-Allowlist.",
  },
  "error-spike": {
    title: "Fehler-Spike (5xx)",
    technique: { id: "T1499", name: "Endpoint Denial of Service", tactic: "Impact" },
    response: "Prüfen ob Last-/DoS-Muster oder Deploy-Fehler; Rate-Limits/Attack-Mode aktivieren, letzte Deploys und Logs vergleichen.",
  },
};

const SEV_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// ---------- Parsing ----------

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function toTs(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v; // seconds → ms
  if (typeof v === "string" && v.trim()) {
    if (/^\d{10,13}$/.test(v.trim())) return toTs(Number(v.trim()), fallback);
    const apache = v.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/);
    if (apache) {
      const [, d, mon, y, hh, mm, ss, tz] = apache;
      const iso = `${y}-${String(MONTHS[mon.toLowerCase()] + 1).padStart(2, "0")}-${d}T${hh}:${mm}:${ss}${tz.slice(0, 3)}:${tz.slice(3)}`;
      const t = Date.parse(iso);
      if (Number.isFinite(t)) return t;
    }
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) {
    const parts = k.split(".");
    let cur: unknown = o;
    for (const p of parts) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
};
const str = (v: unknown) => (v === undefined || v === null ? undefined : Array.isArray(v) ? String(v[0] ?? "") || undefined : String(v));

const FAIL_RE = /failed password|authentication fail|login fail|failed login|invalid (user|password|credentials)|logon failure|wrong password|bad password|4625|unauthori[sz]ed login|anmeldung fehlgeschlagen/i;
const OK_RE = /accepted password|accepted publickey|login succe|logged in|4624|session opened/i;
const LOGIN_PATH_RE = /\/(login|signin|sign-in|auth|wp-login\.php|session|api\/auth)/i;

function deriveAuth(e: SiemEvent, explicit?: unknown): SiemEvent["auth"] {
  const ex = str(explicit)?.toLowerCase();
  if (ex) {
    if (/fail|denied|invalid|error|4625/.test(ex)) return "fail";
    if (/succe|ok|allow|4624/.test(ex)) return "success";
  }
  if (FAIL_RE.test(e.message)) return "fail";
  if (e.path && LOGIN_PATH_RE.test(e.path) && (e.status === 401 || e.status === 403)) return "fail";
  if (OK_RE.test(e.message)) return "success";
  return undefined;
}

function extractIp(s: string) {
  return s.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] ?? s.match(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/i)?.[0];
}

/** Normalize one JSON object (generic app log, Vercel log drain, Windows event, ECS …). */
export function normalizeObject(o: Record<string, unknown>, now = Date.now()): SiemEvent {
  const message = str(pick(o, "message", "msg", "log", "event.original", "text", "Message")) ?? JSON.stringify(o).slice(0, 300);
  const e: SiemEvent = {
    id: str(pick(o, "id", "_id", "event.id")) ?? newId("ev"),
    ts: toTs(pick(o, "timestamp", "@timestamp", "time", "ts", "date", "TimeCreated", "eventTime"), now),
    source: str(pick(o, "source", "host", "hostname", "service", "projectName", "Computer")) ?? "json",
    ip: str(pick(o, "proxy.clientIp", "ip", "clientIp", "client_ip", "src_ip", "source.ip", "remote_addr", "remoteAddress", "IpAddress", "client.ip")),
    user: str(pick(o, "user", "username", "user.name", "userName", "TargetUserName", "account")),
    method: str(pick(o, "proxy.method", "method", "http.request.method", "request_method"))?.toUpperCase(),
    path: str(pick(o, "proxy.path", "path", "url.path", "request_uri", "uri", "url")),
    status: Number(pick(o, "proxy.statusCode", "statusCode", "status", "http.response.status_code", "status_code")) || undefined,
    ua: str(pick(o, "proxy.userAgent", "userAgent", "user_agent", "ua", "http_user_agent", "user_agent.original")),
    message,
  };
  if (!e.ip) e.ip = extractIp(message);
  const eventId = str(pick(o, "EventID", "event_id", "event.code"));
  e.auth = deriveAuth(e, pick(o, "outcome", "event.outcome", "result") ?? (eventId === "4625" ? "fail" : eventId === "4624" ? "success" : undefined));
  return e;
}

// nginx/apache combined: 1.2.3.4 - user [10/Oct/2026:13:55:36 +0200] "GET /path HTTP/1.1" 404 512 "ref" "UA"
const ACCESS_RE = /^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;
// syslog: "Oct 28 20:31:02 host sshd[123]: msg" or RFC5424 "<34>1 2026-10-28T20:31:02Z host app - - - msg"
const SYSLOG_RE = /^(?:<\d+>)?([A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) ([^:\[]+)(?:\[\d+\])?: (.*)$/;
const SYSLOG5424_RE = /^<\d+>\d (\S+) (\S+) (\S+) \S+ \S+ (?:-|\[.*?\]) ?(.*)$/;

export function normalizeLine(line: string, now = Date.now()): SiemEvent | null {
  const l = line.trim();
  if (!l) return null;
  let m = l.match(ACCESS_RE);
  if (m) {
    const e: SiemEvent = {
      id: newId("ev"),
      ts: toTs(m[3], now),
      source: "access",
      ip: m[1],
      user: m[2] !== "-" ? m[2] : undefined,
      method: m[4],
      path: m[5],
      status: Number(m[6]),
      ua: m[7],
      message: l.slice(0, 400),
    };
    e.auth = deriveAuth(e);
    return e;
  }
  m = l.match(SYSLOG5424_RE);
  if (m) {
    const e: SiemEvent = { id: newId("ev"), ts: toTs(m[1], now), source: `${m[2]}/${m[3]}`, message: m[4].slice(0, 400) };
    e.ip = extractIp(m[4]);
    e.user = m[4].match(/(?:for|user)(?: invalid user)? (\S+) from/i)?.[1];
    e.auth = deriveAuth(e);
    return e;
  }
  m = l.match(SYSLOG_RE);
  if (m) {
    const year = new Date(now).getFullYear();
    let ts = toTs(`${m[1]} ${year}`, now);
    if (ts > now + 86_400_000) ts = toTs(`${m[1]} ${year - 1}`, now);
    const e: SiemEvent = { id: newId("ev"), ts, source: `${m[2]}/${m[3].trim()}`, message: m[4].slice(0, 400) };
    e.ip = extractIp(m[4]);
    e.user = m[4].match(/(?:for|user)(?: invalid user)? (\S+) from/i)?.[1];
    e.auth = deriveAuth(e);
    return e;
  }
  const e: SiemEvent = { id: newId("ev"), ts: now, source: "text", message: l.slice(0, 400) };
  e.ip = extractIp(l);
  e.auth = deriveAuth(e);
  return e;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export const MAX_PARSE_EVENTS = 20_000;

/** Parse pasted/uploaded logs. Format is auto-detected. */
export function parseLogs(text: string, now = Date.now()): SiemEvent[] {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t) return [];
  // JSON array / object (Vercel log drains POST arrays)
  if (t.startsWith("[") || (t.startsWith("{") && !t.includes("\n{"))) {
    try {
      const v = JSON.parse(t);
      const arr: unknown[] = Array.isArray(v) ? v : Array.isArray(v?.events) ? v.events : Array.isArray(v?.logs) ? v.logs : [v];
      return arr
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .slice(0, MAX_PARSE_EVENTS)
        .map((o) => normalizeObject(o, now));
    } catch {
      /* fall through: maybe NDJSON */
    }
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, MAX_PARSE_EVENTS + 1);
  // NDJSON
  if (lines[0].trim().startsWith("{")) {
    return lines.flatMap((l) => {
      try {
        return [normalizeObject(JSON.parse(l), now)];
      } catch {
        const e = normalizeLine(l, now);
        return e ? [e] : [];
      }
    });
  }
  // CSV with a header row
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const header = splitCsvLine(lines[0], sep).map((h) => h.trim().toLowerCase());
  const known = ["timestamp", "time", "ip", "src_ip", "clientip", "status", "path", "user", "message", "method", "user_agent", "useragent", "event_id", "outcome"];
  if (header.length >= 2 && header.some((h) => known.includes(h)) && !ACCESS_RE.test(lines[0])) {
    return lines.slice(1).map((l) => {
      const cells = splitCsvLine(l, sep);
      const o: Record<string, unknown> = {};
      header.forEach((h, i) => (o[h] = cells[i]?.trim()));
      if (o.clientip && !o.ip) o.ip = o.clientip;
      if (o.useragent && !o.user_agent) o.user_agent = o.useragent;
      if (!o.message) o.message = l;
      return normalizeObject(o, now);
    });
  }
  return lines.map((l) => normalizeLine(l, now)).filter((e): e is SiemEvent => !!e);
}

// ---------- Detections ----------

const SCANNER_UA_RE = /sqlmap|nikto|nmap|masscan|zgrab|nuclei|dirbuster|gobuster|wpscan|acunetix|nessus|openvas|feroxbuster|ffuf|wfuzz|hydra|medusa|burp|zap\/|arachni|skipfish|whatweb|jaeles|xray/i;
const ADMIN_PATH_RE = /\/(wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|pma|admin(?:istrator)?|\.env|\.git\/|\.aws|\.ssh|config\.(?:php|json|yml)|server-status|actuator|cgi-bin|vendor\/phpunit|boaform|console|manager\/html|\.ds_store|backup|db\.sql|setup\.php)/i;

export type DetectOptions = { windowMs?: number };

function windowBursts(events: SiemEvent[], windowMs: number, threshold: number) {
  // sliding window over sorted events: returns the densest window if it reaches the threshold
  const s = [...events].sort((a, b) => a.ts - b.ts);
  let best: SiemEvent[] = [];
  let i = 0;
  for (let j = 0; j < s.length; j++) {
    while (s[j].ts - s[i].ts > windowMs) i++;
    if (j - i + 1 > best.length) best = s.slice(i, j + 1);
  }
  return best.length >= threshold ? best : null;
}

function groupBy<T>(arr: T[], key: (x: T) => string | undefined) {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

function mkAlert(rule: RuleId, severity: Severity, evs: SiemEvent[], detail: string, extra: Partial<Alert> = {}): Alert {
  const ts = evs.map((e) => e.ts);
  return {
    id: `${rule}:${extra.ip ?? extra.user ?? "global"}:${Math.min(...ts)}`,
    rule,
    title: RULES[rule].title,
    severity,
    technique: RULES[rule].technique,
    count: evs.length,
    first: Math.min(...ts),
    last: Math.max(...ts),
    evidence: evs.slice(0, 5).map((e) => e.id),
    detail,
    response: RULES[rule].response,
    ...extra,
  };
}

export function detect(events: SiemEvent[], opts: DetectOptions = {}): Alert[] {
  const win = opts.windowMs ?? 5 * 60_000;
  const alerts: Alert[] = [];

  // 1) Brute force: ≥5 failed logins from one IP within the window
  const fails = events.filter((e) => e.auth === "fail");
  for (const [ip, evs] of groupBy(fails, (e) => e.ip)) {
    const burst = windowBursts(evs, win, 5);
    if (!burst) continue;
    const users = new Set(burst.map((e) => e.user).filter(Boolean));
    const success = events.some((e) => e.ip === ip && e.auth === "success" && e.ts >= burst[0].ts);
    if (users.size >= 5) {
      alerts.push(mkAlert("spray", success ? "critical" : "high", burst, `${burst.length} Fehlversuche gegen ${users.size} Konten von ${ip}${success ? ", danach ein ERFOLGREICHER Login" : ""}.`, { ip }));
    } else {
      const sev: Severity = success ? "critical" : burst.length >= 20 ? "high" : "medium";
      alerts.push(
        mkAlert("bruteforce", sev, burst, `${burst.length} fehlgeschlagene Logins von ${ip}${users.size ? ` (Konto: ${[...users].slice(0, 3).join(", ")})` : ""}${success ? ", danach ein ERFOLGREICHER Login" : ""}.`, {
          ip,
          user: users.size === 1 ? [...users][0] : undefined,
        }),
      );
    }
  }
  // Brute force against one account from many IPs
  for (const [user, evs] of groupBy(fails, (e) => e.user)) {
    const burst = windowBursts(evs, win, 10);
    if (!burst) continue;
    const ips = new Set(burst.map((e) => e.ip).filter(Boolean));
    if (ips.size < 3) continue;
    alerts.push(mkAlert("bruteforce", "high", burst, `${burst.length} Fehlversuche auf Konto „${user}" von ${ips.size} IPs (verteilt).`, { user }));
  }

  // 2) Many 4xx / 5xx from one IP
  const http = events.filter((e) => e.status && e.ip);
  for (const [ip, evs] of groupBy(http, (e) => e.ip)) {
    const c4 = windowBursts(evs.filter((e) => e.status! >= 400 && e.status! < 500), win, 20);
    if (c4) alerts.push(mkAlert("http-errors", c4.length >= 100 ? "high" : "medium", c4, `${c4.length}× 4xx von ${ip} in ≤${Math.round(win / 60000)} Min.`, { ip }));
    const c5 = windowBursts(evs.filter((e) => e.status! >= 500), win, 10);
    if (c5) alerts.push(mkAlert("http-errors", "medium", c5, `${c5.length}× 5xx ausgelöst von ${ip}.`, { ip }));
  }

  // 3) Scanner user agents
  const scanners = events.filter((e) => e.ua && SCANNER_UA_RE.test(e.ua));
  for (const [ip, evs] of groupBy(scanners, (e) => e.ip ?? e.ua)) {
    const tool = evs[0].ua!.match(SCANNER_UA_RE)?.[0] ?? "Scanner";
    const hit = evs.some((e) => e.status && e.status < 300);
    alerts.push(mkAlert("scanner-ua", hit ? "high" : "medium", evs, `Scanner „${tool}" von ${ip}: ${evs.length} Anfragen${hit ? ", mindestens eine mit 2xx-Antwort" : ""}.`, { ip }));
  }

  // 4) Admin / config path probing: ≥3 distinct sensitive paths from one IP
  const probes = events.filter((e) => e.path && ADMIN_PATH_RE.test(e.path));
  for (const [ip, evs] of groupBy(probes, (e) => e.ip)) {
    const paths = new Set(evs.map((e) => e.path!.split("?")[0]));
    if (paths.size < 3) continue;
    const exposed = evs.filter((e) => e.status && e.status < 300);
    alerts.push(
      mkAlert("admin-probe", exposed.length ? "critical" : "medium", evs, `${paths.size} sensible Pfade von ${ip} abgefragt (${[...paths].slice(0, 4).join(", ")})${exposed.length ? `; ${exposed.length}× mit 2xx beantwortet!` : ""}.`, { ip }),
    );
  }

  // 5) Global 5xx spike: a minute with ≥10 errors and ≥3× the median minute
  const errs = events.filter((e) => (e.status ?? 0) >= 500 || /\b(error|exception|fatal)\b/i.test(e.message));
  if (errs.length >= 10) {
    const buckets = groupBy(errs, (e) => String(Math.floor(e.ts / 60_000)));
    const counts = [...buckets.values()].map((b) => b.length).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)] ?? 0;
    const allMinutes = new Set(events.map((e) => Math.floor(e.ts / 60_000))).size;
    const baseline = counts.length < allMinutes ? Math.max(1, median * (counts.length / allMinutes)) : median;
    for (const b of buckets.values()) {
      if (b.length >= 10 && b.length >= baseline * 3) {
        alerts.push(mkAlert("error-spike", b.length >= 50 ? "high" : "medium", b, `${b.length} Fehler in einer Minute (Normal: ~${Math.round(baseline)}).`));
      }
    }
  }

  return alerts.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.last - a.last);
}

// ---------- Aggregates ----------

export type SiemCounters = {
  events: number;
  ips: number;
  authFail: number;
  http4xx: number;
  http5xx: number;
  alerts: Record<Severity, number>;
  first?: number;
  last?: number;
};

export function counters(events: SiemEvent[], alerts: Alert[]): SiemCounters {
  const c: SiemCounters = {
    events: events.length,
    ips: new Set(events.map((e) => e.ip).filter(Boolean)).size,
    authFail: events.filter((e) => e.auth === "fail").length,
    http4xx: events.filter((e) => (e.status ?? 0) >= 400 && (e.status ?? 0) < 500).length,
    http5xx: events.filter((e) => (e.status ?? 0) >= 500).length,
    alerts: { low: 0, medium: 0, high: 0, critical: 0 },
  };
  for (const a of alerts) c.alerts[a.severity] += 1;
  if (events.length) {
    c.first = Math.min(...events.map((e) => e.ts));
    c.last = Math.max(...events.map((e) => e.ts));
  }
  return c;
}

export type TimelineBucket = { start: number; total: number; errors: number; alerts: number };

/** Event timeline in up to `maxBuckets` equal buckets (minute granularity or coarser). */
export function timeline(events: SiemEvent[], alerts: Alert[], maxBuckets = 30): TimelineBucket[] {
  if (!events.length) return [];
  const first = Math.min(...events.map((e) => e.ts));
  const last = Math.max(...events.map((e) => e.ts));
  const size = Math.max(60_000, Math.ceil((last - first + 1) / maxBuckets / 60_000) * 60_000);
  const n = Math.min(maxBuckets, Math.floor((last - first) / size) + 1);
  const b: TimelineBucket[] = Array.from({ length: n }, (_, i) => ({ start: first + i * size, total: 0, errors: 0, alerts: 0 }));
  const idx = (ts: number) => Math.min(n - 1, Math.max(0, Math.floor((ts - first) / size)));
  for (const e of events) {
    const k = b[idx(e.ts)];
    k.total += 1;
    if ((e.status ?? 0) >= 400 || e.auth === "fail") k.errors += 1;
  }
  for (const a of alerts) b[idx(a.first)].alerts += 1;
  return b;
}

/** Compact situation report for the AI (kept short; the model must not invent beyond this). */
export function summarizeForPrompt(alerts: Alert[], c: SiemCounters, tz = "Europe/Vienna"): string {
  if (!c.events) return "Noch keine Logs geladen.";
  const fmt = (t: number) => new Intl.DateTimeFormat("de-AT", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(t));
  const lines = [
    `${c.events} Events (${c.first ? fmt(c.first) : "?"} – ${c.last ? fmt(c.last) : "?"}, Wiener Zeit), ${c.ips} IPs, ${c.authFail} fehlgeschlagene Logins, ${c.http4xx}× 4xx, ${c.http5xx}× 5xx.`,
    `Alerts: ${c.alerts.critical} kritisch, ${c.alerts.high} hoch, ${c.alerts.medium} mittel, ${c.alerts.low} niedrig.`,
  ];
  for (const a of alerts.slice(0, 8)) {
    lines.push(`- [${a.severity}] ${a.title} (${a.technique.id} ${a.technique.name}): ${a.detail} Vorschlag: ${a.response}`);
  }
  if (alerts.length > 8) lines.push(`… und ${alerts.length - 8} weitere.`);
  return lines.join("\n").slice(0, 3000);
}

/** Synthetic demo logs (documentation IP ranges only) to try the panel without real data. */
export function demoLogs(now = Date.now()): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const out: string[] = [];
  const t0 = now - 20 * 60_000;
  for (let i = 0; i < 60; i++) {
    out.push(JSON.stringify({ timestamp: iso(t0 + i * 18_000), proxy: { clientIp: `198.51.100.${(i % 7) + 10}`, method: "GET", path: i % 5 ? "/" : "/api/chat", statusCode: 200, userAgent: ["Mozilla/5.0 (Linux; Android 14)"] }, message: "ok" }));
  }
  for (let i = 0; i < 14; i++) {
    out.push(JSON.stringify({ timestamp: iso(t0 + 5 * 60_000 + i * 9_000), ip: "203.0.113.66", user: "admin", path: "/api/auth/login", status: 401, message: "Login failed for admin" }));
  }
  out.push(JSON.stringify({ timestamp: iso(t0 + 5 * 60_000 + 14 * 9_000), ip: "203.0.113.66", user: "admin", path: "/api/auth/login", status: 200, message: "Login succeeded for admin" }));
  const probes = ["/.env", "/.git/config", "/wp-login.php", "/phpmyadmin/", "/admin", "/server-status", "/actuator/health"];
  probes.forEach((p, i) =>
    out.push(JSON.stringify({ timestamp: iso(t0 + 9 * 60_000 + i * 3_000), proxy: { clientIp: "192.0.2.13", method: "GET", path: p, statusCode: 404, userAgent: ["Mozilla/5.0 (compatible; Nuclei - Open-source project (github.com/projectdiscovery/nuclei))"] } })),
  );
  for (let i = 0; i < 25; i++) {
    out.push(JSON.stringify({ timestamp: iso(t0 + 9 * 60_000 + 30_000 + i * 2_000), proxy: { clientIp: "192.0.2.13", method: "GET", path: `/backup-${i}.zip`, statusCode: 404, userAgent: ["sqlmap/1.8"] } }));
  }
  for (let i = 0; i < 18; i++) {
    out.push(JSON.stringify({ timestamp: iso(t0 + 15 * 60_000 + i * 2_500), proxy: { clientIp: `198.51.100.${i % 5}`, method: "POST", path: "/api/chat", statusCode: 503 }, message: "Function error: upstream timeout" }));
  }
  return out.join("\n");
}
