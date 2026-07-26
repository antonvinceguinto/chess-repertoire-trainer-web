import { parsePgn, type PgnGame } from "./chess";
import type { LineMove } from "./types";

/**
 * PGN handling for downloaded games. `lib/chess.ts` does the chess.js parsing;
 * this layer pulls out the extras real-world PGNs carry — clock annotations
 * like `{[%clk 0:09:59.9]}` and the tag pairs Chess.com writes.
 */

export interface LoadedGame {
  headers: Record<string, string>;
  moves: LineMove[];
  /** SAN of every half-move, i.e. `moves.map(m => m.san)`. */
  sans: string[];
  /** Seconds left on the mover's clock after each half-move (null if absent). */
  clocks: (number | null)[];
  startFen: string;
  /** PGN `Result` tag: "1-0", "0-1", "1/2-1/2" or "*". */
  result: string;
  /** Chess.com's ECO code + opening name, when the PGN carries them. */
  eco: string | null;
  openingName: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  /** PGN `Termination` tag, e.g. "player won by resignation". */
  termination: string | null;
}

/** "0:09:59.9" / "1:23:45" → seconds. Returns null for anything unparseable. */
export function parseClock(raw: string): number | null {
  const m = raw.match(/(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/);
  if (!m) return null;
  const seconds =
    Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Pull the `[%clk …]` value out of a PGN comment. */
function clockFromComment(comment: string): number | null {
  const m = comment.match(/\[%clk\s+([^\]]+)\]/);
  return m ? parseClock(m[1]) : null;
}

/** Chess.com writes opening names into the ECOUrl slug, e.g. ".../Italian-Game". */
function openingFromEcoUrl(url: string | undefined): string | null {
  if (!url) return null;
  const slug = url.split("/").pop();
  if (!slug) return null;
  return slug.replace(/-/g, " ").replace(/\s+/g, " ").trim() || null;
}

function toNumber(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a PGN into everything the review UI needs, or null if unreadable. */
export function loadGame(pgn: string): LoadedGame | null {
  const parsed: PgnGame | null = parsePgn(pgn);
  if (!parsed || parsed.moves.length === 0) return null;

  // Comments are keyed by the FEN of the position they follow, so map each
  // move's resulting FEN onto its clock reading.
  const byFen = new Map<string, number>();
  for (const c of parsed.comments) {
    const secs = clockFromComment(c.comment);
    if (secs != null) byFen.set(c.fen, secs);
  }

  const h = parsed.headers;
  return {
    headers: h,
    moves: parsed.moves,
    sans: parsed.moves.map((m) => m.san),
    clocks: parsed.moves.map((m) => byFen.get(m.fen) ?? null),
    startFen: parsed.startFen,
    result: h.Result ?? "*",
    eco: h.ECO ?? null,
    openingName: openingFromEcoUrl(h.ECOUrl),
    whiteElo: toNumber(h.WhiteElo),
    blackElo: toNumber(h.BlackElo),
    termination: h.Termination ?? null,
  };
}

/** Seconds spent on the half-move at `index`, from the clock deltas. */
export function timeSpentAt(game: LoadedGame, index: number): number | null {
  const now = game.clocks[index];
  if (now == null) return null;
  const prev = game.clocks[index - 2];
  if (prev == null) return null;
  const spent = prev - now;
  // Increments make the delta negative when the mover banked more than they
  // used; treat that as "instant" rather than reporting a negative duration.
  return spent >= 0 ? spent : 0;
}
