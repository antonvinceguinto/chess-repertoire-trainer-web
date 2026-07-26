import { NextResponse } from "next/server";

/**
 * Same-origin proxy for the Chess.com Published-Data API.
 *
 * The rest of this app is browser-only, but api.chess.com serves no
 * `Access-Control-Allow-Origin` header, so a `fetch()` straight from the page
 * is blocked by CORS. This handler is the one server-side hop that makes the
 * "type your username, see your games" flow possible. It only forwards GETs to
 * a small allowlist of read-only public endpoints — no credentials, no
 * user-controlled host.
 */

const UPSTREAM = "https://api.chess.com/pub/";

/**
 * Chess.com rejects requests without a descriptive User-Agent (Cloudflare
 * returns 403), and browsers won't let us set one on a cross-origin fetch.
 */
const USER_AGENT =
  "OpeningTrainer/1.0 (chess repertoire trainer; +https://github.com/antonvinceguinto/chess-repertoire-trainer-web)";

/**
 * Only these shapes are forwarded, so the `path` parameter can never be
 * steered at another host or a write endpoint:
 *   player/<user>                     — profile
 *   player/<user>/stats               — ratings
 *   player/<user>/games/archives      — list of monthly archive URLs
 *   player/<user>/games/<yyyy>/<mm>   — one month of games
 */
const ALLOWED = [
  /^player\/[\w.-]{1,64}$/,
  /^player\/[\w.-]{1,64}\/stats$/,
  /^player\/[\w.-]{1,64}\/games\/archives$/,
  /^player\/[\w.-]{1,64}\/games\/\d{4}\/\d{2}$/,
];

// No `dynamic = "force-dynamic"` here: reading `request.url` already makes the
// route request-time, and that flag would additionally force every fetch below
// to `no-store`, throwing away the shared 5-minute cache we want upstream.

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path")?.trim() ?? "";

  if (!path || !ALLOWED.some((re) => re.test(path))) {
    return NextResponse.json(
      { error: "Unsupported Chess.com path." },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}${path}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      // Chess.com data changes slowly; a short shared cache keeps us well
      // inside their rate limits when a user flips between months.
      next: { revalidate: 300 },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Chess.com." },
      { status: 502 },
    );
  }

  if (upstream.status === 404) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (upstream.status === 429) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Chess.com returned ${upstream.status}.` },
      { status: 502 },
    );
  }

  const body = await upstream.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
