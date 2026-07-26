/**
 * Client for the Chess.com Published-Data API, reached through this app's own
 * `/api/chesscom` route (see `app/api/chesscom/route.ts`) because Chess.com
 * serves no CORS headers. Nothing here needs a login — the "pub" API exposes
 * every public game by username.
 */

export type ChessComResult =
  | "win"
  | "checkmated"
  | "agreed"
  | "repetition"
  | "timeout"
  | "resigned"
  | "stalemate"
  | "lose"
  | "insufficient"
  | "50move"
  | "abandoned"
  | "kingofthehill"
  | "threecheck"
  | "timevsinsufficient"
  | "bughousepartnerlose";

export interface ChessComPlayer {
  username: string;
  rating: number | null;
  /** Raw Chess.com result token for this side. */
  result: ChessComResult | string;
}

/** One game, normalised from the API's game object. */
export interface ChessComGame {
  /** Stable id — the game's uuid, falling back to its url. */
  id: string;
  url: string;
  pgn: string;
  /** "bullet" | "blitz" | "rapid" | "daily". */
  timeClass: string;
  /** Raw time control, e.g. "600" or "180+2". */
  timeControl: string;
  /** "chess" for standard; variants (chess960, bughouse…) are filtered out. */
  rules: string;
  rated: boolean;
  /** Unix seconds when the game ended. */
  endTime: number;
  white: ChessComPlayer;
  black: ChessComPlayer;
  eco: string | null;
  /** Chess.com's own accuracy figures, only present if the game was reviewed there. */
  accuracies: { white: number; black: number } | null;
}

export type ChessComErrorKind =
  | "not_found"
  | "rate_limited"
  | "network"
  | "proxy_unavailable"
  | "unknown";

export class ChessComError extends Error {
  readonly kind: ChessComErrorKind;
  constructor(kind: ChessComErrorKind, message: string) {
    super(message);
    this.name = "ChessComError";
    this.kind = kind;
  }
}

const PROXY = "/api/chesscom?path=";

/** Chess.com usernames are case-insensitive; the API wants them lowercased. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  return /^[\w.-]{3,64}$/.test(normalizeUsername(raw));
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${PROXY}${encodeURIComponent(path)}`, { signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ChessComError("network", "Network request failed.");
  }

  // A missing route (e.g. the app served as static files) returns an HTML 404
  // rather than our JSON error shape — tell those two apart for the user.
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ChessComError(
      "proxy_unavailable",
      "The Chess.com proxy route is not available on this deployment.",
    );
  }

  if (res.ok) return body as T;

  const kind = (body as { error?: string } | null)?.error;
  if (res.status === 404 && kind === "not_found") {
    throw new ChessComError("not_found", "No such Chess.com player.");
  }
  if (res.status === 429) {
    throw new ChessComError(
      "rate_limited",
      "Chess.com is rate-limiting us. Wait a moment and try again.",
    );
  }
  throw new ChessComError("unknown", `Chess.com request failed (${res.status}).`);
}

interface RawArchives {
  archives?: string[];
}

interface RawSide {
  username?: string;
  rating?: number;
  result?: string;
}

interface RawGame {
  uuid?: string;
  url?: string;
  pgn?: string;
  time_class?: string;
  time_control?: string;
  rules?: string;
  rated?: boolean;
  end_time?: number;
  eco?: string;
  accuracies?: { white?: number; black?: number };
  white?: RawSide;
  black?: RawSide;
}

/** Archive lists barely change; remember them for the session. */
const archiveCache = new Map<string, string[]>();

/**
 * The player's monthly archives as "YYYY/MM" keys, newest first.
 * (The API returns full URLs, oldest first.)
 */
export async function fetchArchiveMonths(
  username: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const user = normalizeUsername(username);
  const cached = archiveCache.get(user);
  if (cached) return cached;

  const data = await getJson<RawArchives>(
    `player/${user}/games/archives`,
    signal,
  );
  const months = (data.archives ?? [])
    .map((url) => url.match(/(\d{4})\/(\d{2})$/))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => `${m[1]}/${m[2]}`)
    .reverse();
  archiveCache.set(user, months);
  return months;
}

function toSide(raw: RawSide | undefined): ChessComPlayer {
  return {
    username: raw?.username ?? "?",
    rating: typeof raw?.rating === "number" ? raw.rating : null,
    result: raw?.result ?? "",
  };
}

function normalizeGame(raw: RawGame): ChessComGame | null {
  if (!raw.pgn || !raw.url) return null;
  const acc = raw.accuracies;
  return {
    id: raw.uuid ?? raw.url,
    url: raw.url,
    pgn: raw.pgn,
    timeClass: raw.time_class ?? "unknown",
    timeControl: raw.time_control ?? "",
    rules: raw.rules ?? "chess",
    rated: raw.rated !== false,
    endTime: raw.end_time ?? 0,
    white: toSide(raw.white),
    black: toSide(raw.black),
    eco: raw.eco ? raw.eco.split("/").pop() ?? null : null,
    accuracies:
      typeof acc?.white === "number" && typeof acc?.black === "number"
        ? { white: acc.white, black: acc.black }
        : null,
  };
}

/** One month of standard-chess games, newest first. */
export async function fetchMonth(
  username: string,
  month: string,
  signal?: AbortSignal,
): Promise<ChessComGame[]> {
  const user = normalizeUsername(username);
  const data = await getJson<{ games?: RawGame[] }>(
    `player/${user}/games/${month}`,
    signal,
  );
  return (data.games ?? [])
    .map(normalizeGame)
    .filter((g): g is ChessComGame => g != null && g.rules === "chess")
    .sort((a, b) => b.endTime - a.endTime);
}

/** Month payloads are big; keep them for the session instead of re-fetching. */
const monthCache = new Map<string, ChessComGame[]>();

/**
 * Forget everything cached for a player, so an explicit "Find games" really
 * goes back to Chess.com (the caches exist to make navigating back instant,
 * not to pin stale results).
 */
export function refreshPlayer(username: string): void {
  const user = normalizeUsername(username);
  archiveCache.delete(user);
  for (const key of [...monthCache.keys()]) {
    if (key.startsWith(`${user}/`)) monthCache.delete(key);
  }
}

export interface RecentGamesOptions {
  /** Stop once this many games have been collected. */
  limit?: number;
  /** Never walk back further than this many monthly archives. */
  maxMonths?: number;
  signal?: AbortSignal;
  /** Called as each month lands, so the UI can stream results in. */
  onProgress?: (games: ChessComGame[], monthsChecked: number) => void;
}

/**
 * Walk the player's archives newest-first until `limit` games are collected.
 * Months are fetched one at a time (never in parallel) to stay friendly with
 * Chess.com's rate limiter.
 */
export async function fetchRecentGames(
  username: string,
  options: RecentGamesOptions = {},
): Promise<ChessComGame[]> {
  const { limit = 60, maxMonths = 6, signal, onProgress } = options;
  const user = normalizeUsername(username);
  const months = await fetchArchiveMonths(user, signal);

  const collected: ChessComGame[] = [];
  let checked = 0;
  for (const month of months.slice(0, maxMonths)) {
    if (signal?.aborted) break;
    const key = `${user}/${month}`;
    let games = monthCache.get(key);
    if (!games) {
      games = await fetchMonth(user, month, signal);
      monthCache.set(key, games);
    }
    collected.push(...games);
    checked += 1;
    onProgress?.(collected.slice(0, limit), checked);
    if (collected.length >= limit) break;
  }
  return collected.slice(0, limit);
}

/* ---------------- Result helpers ---------------- */

const LOSS_RESULTS = new Set([
  "checkmated",
  "timeout",
  "resigned",
  "lose",
  "abandoned",
  "kingofthehill",
  "threecheck",
  "bughousepartnerlose",
]);

const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

export type Outcome = "win" | "loss" | "draw" | "unknown";

export function outcomeOf(result: string): Outcome {
  if (result === "win") return "win";
  if (LOSS_RESULTS.has(result)) return "loss";
  if (DRAW_RESULTS.has(result)) return "draw";
  return "unknown";
}

/** Which side the given username played, or null if they weren't in the game. */
export function colorOf(
  game: ChessComGame,
  username: string,
): "white" | "black" | null {
  const user = normalizeUsername(username);
  if (normalizeUsername(game.white.username) === user) return "white";
  if (normalizeUsername(game.black.username) === user) return "black";
  return null;
}

/** Human-readable reason a game ended, from the loser's/drawer's result token. */
export function endReason(game: ChessComGame): string {
  const tokens = [game.white.result, game.black.result];
  const decisive = tokens.find((t) => t !== "win");
  switch (decisive) {
    case "checkmated":
      return "Checkmate";
    case "resigned":
      return "Resignation";
    case "timeout":
      return "Time out";
    case "abandoned":
      return "Abandoned";
    case "agreed":
      return "Draw agreed";
    case "repetition":
      return "Repetition";
    case "stalemate":
      return "Stalemate";
    case "insufficient":
      return "Insufficient material";
    case "50move":
      return "50-move rule";
    case "timevsinsufficient":
      return "Time out vs insufficient material";
    default:
      return "Game over";
  }
}

/** "10 min", "3|2", "1 min" … from a raw Chess.com time control. */
export function formatTimeControl(tc: string): string {
  if (!tc) return "";
  if (tc.startsWith("1/")) {
    const days = Math.round(Number(tc.slice(2)) / 86400);
    return days === 1 ? "1 day" : `${days} days`;
  }
  const [baseRaw, incRaw] = tc.split("+");
  const base = Number(baseRaw);
  if (!Number.isFinite(base)) return tc;
  const minutes = base / 60;
  const label =
    minutes >= 1
      ? `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`
      : `${base} sec`;
  return incRaw ? `${label} +${incRaw}` : label;
}

/** localStorage key for the last username the user looked up. */
export const CHESSCOM_USER_KEY = "chess-chesscom-username-v1";

export function loadSavedUsername(): string {
  try {
    return window.localStorage.getItem(CHESSCOM_USER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveUsername(username: string): void {
  try {
    window.localStorage.setItem(CHESSCOM_USER_KEY, username);
  } catch {
    /* ignore */
  }
}
