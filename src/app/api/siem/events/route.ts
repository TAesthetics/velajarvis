import { readBuffer, verifyIngest } from "@/lib/siem-ingest";


/** Read events buffered by /api/siem/ingest (same token). See README for the in-memory limits. */
export async function GET(req: Request) {
  const auth = verifyIngest(req.headers, "", process.env.SIEM_INGEST_TOKEN);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers: { "cache-control": "no-store" } });
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
  return Response.json({ events: readBuffer(since) }, { headers: { "cache-control": "no-store" } });
}
