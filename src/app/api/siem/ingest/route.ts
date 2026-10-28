import { detect, parseLogs } from "@/lib/siem";
import { bufferEvents, verifyIngest } from "@/lib/siem-ingest";

const MAX_BODY = 1_000_000;

function headers() {
  const h = new Headers({ "cache-control": "no-store" });
  // Vercel drain endpoint verification (optional): set SIEM_VERCEL_VERIFY to the value Vercel shows
  if (process.env.SIEM_VERCEL_VERIFY) h.set("x-vercel-verify", process.env.SIEM_VERCEL_VERIFY);
  return h;
}

/** Ingest logs (JSON array / NDJSON / CSV / syslog / access log). Usable as a Vercel log drain endpoint. */
export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return Response.json({ error: "Body zu groß (max. 1 MB)." }, { status: 413, headers: headers() });
  const body = await req.text();
  if (body.length > MAX_BODY) return Response.json({ error: "Body zu groß (max. 1 MB)." }, { status: 413, headers: headers() });
  const auth = verifyIngest(req.headers, body, process.env.SIEM_INGEST_TOKEN);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers: headers() });
  const events = parseLogs(body);
  const buffered = bufferEvents(events);
  return Response.json({ ok: true, accepted: events.length, buffered, alerts: detect(events).length }, { headers: headers() });
}

/** Lets Vercel's drain setup probe the URL. */
export async function GET() {
  return new Response(null, { status: 204, headers: headers() });
}
