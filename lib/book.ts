import { tryMove } from "./chess";

export interface OpeningName {
  eco: string;
  name: string;
}

export interface BookMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  /** Number of known theory lines that pass through this move (popularity proxy). */
  count: number;
  eco: string | null;
  name: string | null;
}

interface RawBook {
  names: string[];
  positions: Record<string, number>;
  moves: Record<string, [string, number, number][]>;
}

let bookPromise: Promise<RawBook> | null = null;

/** Fetch & cache the bundled opening book (once per session). */
export function loadBook(): Promise<RawBook> {
  if (!bookPromise) {
    bookPromise = fetch("/openings/book.json").then((r) => {
      if (!r.ok) throw new Error(`Failed to load opening book (${r.status})`);
      return r.json() as Promise<RawBook>;
    });
  }
  return bookPromise;
}

export type Book = RawBook;

const keyOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

function splitLabel(label: string | undefined): OpeningName | null {
  if (!label) return null;
  const idx = label.indexOf("|");
  if (idx === -1) return { eco: "", name: label };
  return { eco: label.slice(0, idx), name: label.slice(idx + 1) };
}

/** Name of the opening for this exact position, if the book knows it. */
export function openingNameFrom(book: RawBook, fen: string): OpeningName | null {
  const idx = book.positions[keyOf(fen)];
  if (idx === undefined) return null;
  return splitLabel(book.names[idx]);
}

/** Known theory moves from this position, sorted by popularity (most common first). */
export function bookMovesFrom(book: RawBook, fen: string): BookMove[] {
  const arr = book.moves[keyOf(fen)];
  if (!arr) return [];
  const out: BookMove[] = [];
  for (const [san, count, ni] of arr) {
    const mv = tryMove(fen, san);
    if (!mv) continue; // guard against transposition edge-cases
    const label = ni >= 0 ? splitLabel(book.names[ni]) : null;
    out.push({
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion ?? ""),
      from: mv.from,
      to: mv.to,
      count,
      eco: label?.eco ?? null,
      name: label?.name ?? null,
    });
  }
  return out;
}
