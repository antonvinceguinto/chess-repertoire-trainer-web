import type { Repertoire, RepNode } from "./types";
import type { Book } from "./book";
import { START_FEN, turnOf } from "./chess";
import { rankGaps, type Gap } from "./gaps";

/** How completely a single opening family is prepared against. */
export interface OpeningProgress {
  /** Family name, e.g. "Nimzo-Indian Defense" (the part before any ":"). */
  family: string;
  /** Representative ECO code for the family. */
  eco: string | null;
  /** Important opponent replies you've saved an answer to. */
  covered: number;
  /** Open items left to prepare (unanswered replies + undecided own moves). */
  open: number;
  /** covered + open. */
  total: number;
  /** covered / total, 0..1. */
  coverage: number;
  /** Rough likelihood of reaching this opening — used to order the list. */
  reach: number;
  /** The specific open items within this opening, ranked by importance. */
  gaps: Gap[];
}

const keyOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
/** Ignore obscure one-off theory moves (matches the gap ranking threshold). */
const MIN_COUNT = 2;

function labelOf(book: Book, idx: number | undefined) {
  const raw = idx !== undefined && idx >= 0 ? book.names[idx] : undefined;
  if (!raw) return null;
  const bar = raw.indexOf("|");
  const eco = bar === -1 ? "" : raw.slice(0, bar);
  const name = bar === -1 ? raw : raw.slice(bar + 1);
  const colon = name.indexOf(":");
  return {
    eco: eco || null,
    name,
    family: colon === -1 ? name : name.slice(0, colon),
  };
}

interface Acc {
  eco: Map<string, number>;
  covered: number;
  open: number;
  reach: number;
  /** fen|san keys already counted, so transpositions don't double-count. */
  seen: Set<string>;
  gaps: Gap[];
}

/**
 * Measure how thoroughly each opening the repertoire runs into is prepared.
 *
 * Walks the tree the same way {@link findGaps} does. At every opponent-to-move
 * position, each popular book reply is attributed to the opening it leads into
 * (so "…Bb4" counts toward the Nimzo-Indian) and marked covered or a gap.
 * A line that ends on your own move counts as one open item for its opening.
 */
export function openingProgress(rep: Repertoire, book: Book): OpeningProgress[] {
  const userChar = rep.color === "white" ? "w" : "b";
  const fams = new Map<string, Acc>();

  const acc = (family: string, eco: string | null): Acc => {
    let a = fams.get(family);
    if (!a) {
      a = { eco: new Map(), covered: 0, open: 0, reach: 0, seen: new Set(), gaps: [] };
      fams.set(family, a);
    }
    if (eco) a.eco.set(eco, (a.eco.get(eco) ?? 0) + 1);
    return a;
  };

  const walk = (nodes: RepNode[], fen: string, sans: string[], reach: number) => {
    const side = turnOf(fen);
    const key = keyOf(fen);
    const bookMoves = book.moves[key] ?? [];
    const total = bookMoves.reduce((sum, m) => sum + m[1], 0) || 1;

    if (side !== userChar) {
      // Opponent to move: each popular reply is covered or a gap.
      const prepared = new Map(nodes.map((n) => [n.san, n]));
      for (const [san, count, nameIdx] of bookMoves) {
        const child = prepared.get(san);
        const w = reach * (count / total);

        // A rare one-off reply doesn't count toward the score, but if you've
        // prepared an answer to it we still walk that subtree so its deeper
        // (popular) lines are measured — mirroring findGaps, which never gates
        // its recursion on move popularity.
        if (count >= MIN_COUNT) {
          const lab = labelOf(book, nameIdx);
          const family = lab?.family ?? "Other lines";
          const a = acc(family, lab?.eco ?? null);
          a.reach = Math.max(a.reach, w);

          // Classify the reply once per position (transpositions reach the same
          // fen|san); emit the gap in the same guard so `gaps` always agrees
          // with the covered/open counts.
          const dk = `${key}|${san}`;
          if (!a.seen.has(dk)) {
            a.seen.add(dk);
            if (child) {
              a.covered += 1;
            } else {
              a.open += 1;
              a.gaps.push({
                kind: "defense",
                lineSans: sans,
                missingSan: san,
                fen,
                eco: lab?.eco ?? null,
                name: lab?.name ?? null,
                importance: w,
                count,
                depth: sans.length,
              });
            }
          }
        }

        if (child) walk(child.children, child.fen, [...sans, san], w);
      }
      // Offbeat prepared replies (not in the book) — recurse to find deeper gaps.
      for (const n of nodes) {
        if (!bookMoves.some((m) => m[0] === n.san)) {
          walk(n.children, n.fen, [...sans, n.san], reach / (total + 1));
        }
      }
    } else if (nodes.length === 0) {
      // A line that stops on your move — one undecided item for its opening.
      if (sans.length === 0) return;
      const lab = labelOf(book, book.positions[key]);
      const family = lab?.family ?? "Other lines";
      const a = acc(family, lab?.eco ?? null);
      a.reach = Math.max(a.reach, reach);
      const dk = `${key}|reply`;
      if (!a.seen.has(dk)) {
        a.seen.add(dk);
        a.open += 1;
        a.gaps.push({
          kind: "reply",
          lineSans: sans,
          missingSan: null,
          fen,
          eco: lab?.eco ?? null,
          name: lab?.name ?? null,
          importance: reach,
          count: 0,
          depth: sans.length,
        });
      }
    } else {
      for (const n of nodes) walk(n.children, n.fen, [...sans, n.san], reach);
    }
  };

  walk(rep.root, START_FEN, [], 1);

  const out: OpeningProgress[] = [];
  for (const [family, a] of fams) {
    const total = a.covered + a.open;
    if (total === 0) continue;
    let eco: string | null = null;
    let best = 0;
    for (const [e, c] of a.eco) {
      if (c > best) {
        best = c;
        eco = e;
      }
    }
    out.push({
      family,
      eco,
      covered: a.covered,
      open: a.open,
      total,
      coverage: a.covered / total,
      reach: a.reach,
      // Show every open item so the expanded list matches the "N to close" count.
      gaps: rankGaps(a.gaps, Math.max(60, a.open)),
    });
  }

  // Most-faced openings first, so your main lines lead the list.
  return out.sort((x, y) => y.reach - x.reach);
}

/** Overall preparedness across every opening (weighted equally by open item). */
export function overallProgress(progress: OpeningProgress[]): {
  covered: number;
  total: number;
  coverage: number;
} {
  let covered = 0;
  let total = 0;
  for (const p of progress) {
    covered += p.covered;
    total += p.total;
  }
  return { covered, total, coverage: total ? covered / total : 1 };
}
