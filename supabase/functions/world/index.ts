// Paragon World live data (Phase 3, Layer 4). Read-only.
//
//   GET /functions/v1/world?k=<key>&data=1   JSON: { now, settings, events }
//
// The page itself is a static file on GitHub Pages (Play-Paragon-Games/paragon-world);
// Supabase forces text/plain on HTML from Edge Functions, so it cannot live here.
//
// The key is the Edge Function secret WORLD_VIEW_KEY. Rotate it in the Supabase
// dashboard to invalidate every old link. Anything without the right key gets 404.
// Reads use the service role on the server; nothing public can read the tables.
//
// Later (Realtime): keep this function for the first load, and let the page
// subscribe to the events table for pushes instead of polling.

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://play-paragon-games.github.io"]);
const ORDER_WINDOW_DAYS = 9; // 7 LA days of orders plus slack for the LA/UTC offset

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Constant-time compare on hashes so the key length and prefix never leak through timing.
async function keyOk(given: string | null): Promise<boolean> {
  const expected = Deno.env.get("WORLD_VIEW_KEY") ?? "";
  if (!given || expected.length < 16) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return { "access-control-allow-origin": origin, "vary": "Origin" };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) },
  });

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return notFound();
  const url = new URL(req.url);
  if (!(await keyOk(url.searchParams.get("k")))) return notFound();
  if (url.searchParams.get("data") !== "1") return notFound();

  const cols = "id,ts,source,type,place,entity,level,summary,details,demo";
  const since = new Date(Date.now() - ORDER_WINDOW_DAYS * 86400e3).toISOString();
  const [snap, orders, settings] = await Promise.all([
    db.from("events").select(cols).neq("type", "order.created").order("ts", { ascending: false }).limit(2000),
    db.from("events").select(cols).eq("type", "order.created").gte("ts", since).order("ts", { ascending: false }).limit(5000),
    db.from("settings").select("key,value"),
  ]);
  const err = snap.error ?? orders.error ?? settings.error;
  if (err) return json(req, 500, { error: "Could not read events." });

  return json(req, 200, {
    now: new Date().toISOString(),
    settings: Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value])),
    events: [...(snap.data ?? []), ...(orders.data ?? [])],
  });
});
