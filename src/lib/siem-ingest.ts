import { createHmac, timingSafeEqual } from "node:crypto";
import type { SiemEvent } from "./siem";

/**
 * Auth for POST /api/siem/ingest.
 * Accepts either
 *  - "Authorization: Bearer <SIEM_INGEST_TOKEN>" or "x-siem-token: <SIEM_INGEST_TOKEN>", or
 *  - a Vercel log drain signature "x-vercel-signature" = HMAC-SHA1(body, SIEM_INGEST_TOKEN)
 *    (set the drain's secret to the same value as SIEM_INGEST_TOKEN).
 * Always rejects when the token is not configured.
 */
export type IngestAuth = { ok: true } | { ok: false; status: 401 | 503; error: string };

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function verifyIngest(headers: Headers, body: string, token: string | undefined): IngestAuth {
  if (!token || token.length < 16) {
    return { ok: false, status: 503, error: "SIEM-Ingest ist nicht konfiguriert (SIEM_INGEST_TOKEN fehlt oder ist kürzer als 16 Zeichen)." };
  }
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? headers.get("x-siem-token")?.trim();
  if (bearer && safeEq(bearer, token)) return { ok: true };
  const sig = headers.get("x-vercel-signature")?.trim();
  if (sig) {
    const expected = createHmac("sha1", token).update(body).digest("hex");
    if (safeEq(sig, expected)) return { ok: true };
  }
  return { ok: false, status: 401, error: "Nicht autorisiert." };
}

/**
 * Server-side event buffer. LIMITS: lives in the memory of ONE serverless instance only,
 * is lost on cold starts / redeploys and is not shared between instances. Good enough to
 * try a log drain; for real retention plug in a database (e.g. Upstash Redis / Neon).
 */
export const SERVER_BUFFER_MAX = 2000;
const g = globalThis as unknown as { __siemBuffer?: SiemEvent[] };
export function bufferEvents(events: SiemEvent[]) {
  const buf = (g.__siemBuffer ??= []);
  buf.push(...events);
  if (buf.length > SERVER_BUFFER_MAX) buf.splice(0, buf.length - SERVER_BUFFER_MAX);
  return buf.length;
}
export function readBuffer(since = 0): SiemEvent[] {
  return (g.__siemBuffer ?? []).filter((e) => e.ts > since);
}
