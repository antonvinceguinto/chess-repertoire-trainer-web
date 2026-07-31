import type { Repertoire, RepNode } from "./types";
import type { Book } from "./book";
import { openingNameFrom } from "./book";
import type { ChessComGame } from "./chesscom";
import { colorOf, outcomeOf } from "./chesscom";
import { loadGame } from "./pgn";
import { START_FEN, fenAtPly } from "./chess";
import type { RecallCard } from "./memory";

/**
 * Where your real games stop matching your repertoire.
 *
 * Train and Recall weight positions by how likely they are *in general* — the
 * book's move shares. This asks a different question: of the games you actually
 * played, where did you first play something your own repertoire doesn't have?
 * Those positions are worth more than any amount of extra theory, because they
 * are the ones costing you points right now.
 *
 * The walk deliberately stops at the *first* deviation in each game. After it,
 * the game is out of your book and every later move is off-repertoire by
 * construction, so counting those too would bury the one move that mattered.
 */

const fenKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** One game's worth of evidence for a single leak. */
export interface LeakGame {
  id: string;
  url: string;
  /** "win" | "loss" | "draw" from your side. */
  outcome: ReturnType<typeof outcomeOf>;
  /** What you played here instead of your repertoire move. */
  played: string;
  endTime: number;
}

export interface Leak {
  /** Normalised FEN of the position you went wrong in — the leak's identity. */
  key: string;
  fen: string;
  /** SAN path from the start to this position. */
  lead: string[];
  /** Half-move index you were about to play (0-based). */
  index: number;
  /** The replies your repertoire has saved here. */
  expected: string[];
  /** What you actually played, most frequent first, with counts. */
  played: { san: string; count: number }[];
  /** Every game this leak showed up in, newest first. */
  games: LeakGame[];
  losses: number;
  eco: string | null;
  name: string | null;
}

/** A game that never touched the repertoire at all (wrong colour, or move 1 differs). */
export interface LeakScan {
  leaks: Leak[];
  /** Games actually walked (right colour, PGN parsed). */
  scanned: number;
  /** Games that followed the repertoire until it simply ran out. */
  clean: number;
}

/** Follow `san` from a node list; null when the repertoire has no such reply. */
function childOf(nodes: RepNode[], san: string): RepNode | null {
  return nodes.find((n) => n.san === san) ?? null;
}

/**
 * Walk one game against the repertoire and return the first position where the
 * user played something the repertoire does not contain, or null if they never
 * did (they followed it until it ran out, or the game ended first).
 */
function firstDeviation(
  sans: string[],
  rep: Repertoire,
  userIsWhite: boolean,
): { index: number; played: string; expected: string[] } | null {
  let nodes: RepNode[] = rep.root;
  for (let i = 0; i < sans.length; i++) {
    const mine = i % 2 === 0 ? userIsWhite : !userIsWhite;
    const san = sans[i];

    if (mine) {
      // Nothing saved here — the repertoire ran out rather than being broken.
      if (nodes.length === 0) return null;
      const child = childOf(nodes, san);
      if (!child) {
        return { index: i, played: san, expected: nodes.map((n) => n.san) };
      }
      nodes = child.children;
      continue;
    }

    // The opponent's move. If it isn't covered, that's a coverage gap (the Gaps
    // tab's job), not a memory failure — stop walking either way.
    const child = childOf(nodes, san);
    if (!child) return null;
    nodes = child.children;
  }
  return null;
}

/**
 * Group the first deviation of every game into one leak per position. Games are
 * assumed newest-first (as Chess.com returns them); `games` keeps that order.
 */
export function findLeaks(
  games: ChessComGame[],
  rep: Repertoire,
  username: string,
  book: Book | null,
): LeakScan {
  const byKey = new Map<string, Leak>();
  let scanned = 0;
  let clean = 0;

  for (const game of games) {
    const colour = colorOf(game, username);
    if (!colour || colour !== rep.color) continue; // repertoire is for one side
    const loaded = loadGame(game.pgn);
    if (!loaded || loaded.startFen !== START_FEN) continue;
    scanned++;

    const dev = firstDeviation(loaded.sans, rep, colour === "white");
    if (!dev) {
      clean++;
      continue;
    }

    const lead = loaded.sans.slice(0, dev.index);
    const fen = fenAtPly(loaded.moves, dev.index);
    const key = fenKey(fen);
    const outcome = outcomeOf(
      (colour === "white" ? game.white : game.black).result,
    );

    let leak = byKey.get(key);
    if (!leak) {
      const label = book ? openingNameFrom(book, fen) : null;
      leak = {
        key,
        fen,
        lead,
        index: dev.index,
        expected: dev.expected,
        played: [],
        games: [],
        losses: 0,
        eco: label?.eco || null,
        name: label?.name ?? null,
      };
      byKey.set(key, leak);
    }

    const slot = leak.played.find((p) => p.san === dev.played);
    if (slot) slot.count++;
    else leak.played.push({ san: dev.played, count: 1 });

    leak.games.push({
      id: game.id,
      url: game.url,
      outcome,
      played: dev.played,
      endTime: game.endTime,
    });
    if (outcome === "loss") leak.losses++;
  }

  const leaks = [...byKey.values()];
  for (const l of leaks) l.played.sort((a, b) => b.count - a.count);
  // Most-repeated first; among equals, the ones that actually cost games, then
  // the earliest in the opening (a move-4 leak matters more than a move-14 one).
  leaks.sort(
    (a, b) =>
      b.games.length - a.games.length ||
      b.losses - a.losses ||
      a.index - b.index,
  );

  return { leaks, scanned, clean };
}

/**
 * Turn leaks into cards the existing spaced-repetition engine can schedule, so
 * "drill my leaks" reuses Recall wholesale instead of inventing a second drill.
 * `importance` is forced to 1 — these positions are not hypothetical, you have
 * demonstrably reached them — which floats them to the front of any queue.
 */
export function leakCards(leaks: Leak[]): RecallCard[] {
  return leaks
    .filter((l) => l.expected.length > 0)
    .map((l) => ({
      key: l.key,
      fen: l.fen,
      answers: l.expected,
      lead: l.lead,
      importance: 1,
    }));
}

/** "1. e4 e5 2. Nf3" style move number for the ply a leak sits at. */
export function moveLabel(index: number): string {
  const no = Math.floor(index / 2) + 1;
  return index % 2 === 0 ? `${no}.` : `${no}…`;
}
