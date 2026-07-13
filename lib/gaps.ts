import type { Repertoire, RepNode } from "./types";
import type { Book } from "./book";
import { START_FEN, turnOf } from "./chess";

export interface Gap {
  /** "defense" = an opponent move you haven't answered; "reply" = your own move is undecided. */
  kind: "defense" | "reply";
  /** Repertoire moves (SAN) leading to the gap position. */
  lineSans: string[];
  /** The uncovered opponent move (defense) — null for a "reply" gap. */
  missingSan: string | null;
  /** FEN of the gap position (opponent-to-move for a defense; you-to-move for a reply). */
  fen: string;
  eco: string | null;
  name: string | null;
  /** Estimated likelihood of facing this position (0..1), from book popularity along the path. */
  importance: number;
  /** Book popularity of the missing move (number of theory lines through it). */
  count: number;
  /** Ply depth of the gap position. */
  depth: number;
}

const keyOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

function splitLabel(label: string | undefined): { eco: string; name: string } | null {
  if (!label) return null;
  const i = label.indexOf("|");
  return i === -1
    ? { eco: "", name: label }
    : { eco: label.slice(0, i), name: label.slice(i + 1) };
}

/**
 * Find every place your repertoire stops but common opening theory continues.
 *
 * Walks the tree; at each position where it's the opponent's turn, any popular
 * book move you haven't saved a reply to becomes a "defense" gap. A line that
 * ends on the opponent's move (your reply undecided) becomes a "reply" gap.
 * Importance = the product of opponent move-shares along the path × the missing
 * move's share, i.e. roughly how often a book-following opponent reaches it.
 */
export function findGaps(rep: Repertoire, book: Book): Gap[] {
  const userChar = rep.color === "white" ? "w" : "b";
  const gaps: Gap[] = [];

  const walk = (nodes: RepNode[], fen: string, sans: string[], reach: number) => {
    const side = turnOf(fen);
    const key = keyOf(fen);
    const bookMoves = book.moves[key] ?? [];
    const total = bookMoves.reduce((sum, m) => sum + m[1], 0) || 1;

    if (side !== userChar) {
      // Opponent to move: unprepared popular replies are gaps.
      const prepared = new Map(nodes.map((n) => [n.san, n]));
      for (const [san, count, nameIdx] of bookMoves) {
        const share = count / total;
        const child = prepared.get(san);
        if (child) {
          walk(child.children, child.fen, [...sans, san], reach * share);
        } else {
          const label = nameIdx >= 0 ? splitLabel(book.names[nameIdx]) : null;
          gaps.push({
            kind: "defense",
            lineSans: sans,
            missingSan: san,
            fen,
            eco: label?.eco ?? null,
            name: label?.name ?? null,
            importance: reach * share,
            count,
            depth: sans.length,
          });
        }
      }
      // Prepared replies that aren't in the book (offbeat) — still recurse to find deeper gaps.
      for (const n of nodes) {
        if (!bookMoves.some((m) => m[0] === n.san)) {
          walk(n.children, n.fen, [...sans, n.san], reach / (total + 1));
        }
      }
    } else {
      // Your move.
      if (nodes.length === 0) {
        if (sans.length === 0) return; // empty repertoire — handled by the panel
        const label = splitLabel(book.names[book.positions[key]]);
        gaps.push({
          kind: "reply",
          lineSans: sans,
          missingSan: null,
          fen,
          eco: label?.eco ?? null,
          name: label?.name ?? null,
          importance: reach,
          count: 0,
          depth: sans.length,
        });
      } else {
        for (const n of nodes) walk(n.children, n.fen, [...sans, n.san], reach);
      }
    }
  };

  walk(rep.root, START_FEN, [], 1);
  return gaps;
}

/** Dedupe transpositions, drop obscure lines, sort by importance, cap the list. */
export function rankGaps(gaps: Gap[], limit = 40): Gap[] {
  const seen = new Map<string, Gap>();
  for (const g of gaps) {
    if (g.kind === "defense" && g.count < 2) continue; // skip one-off offbeat lines
    const k = `${keyOf(g.fen)}|${g.missingSan ?? "reply"}`;
    const prev = seen.get(k);
    if (!prev || g.importance > prev.importance) seen.set(k, g);
  }
  return [...seen.values()]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}
