import { openingNameFrom, type Book } from "./book";
import { START_FEN, turnOf } from "./chess";
import type { Repertoire, RepNode } from "./types";

const posKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/**
 * Root-to-leaf lines whose reach — the chance a book-following opponent
 * actually plays into them (product of their move-shares along the way) — is at
 * least `minImportance`. Lets Train focus on the lines you'll really meet at a
 * given thoroughness. Falls back to every line if the filter leaves nothing.
 */
export function importantLines(
  rep: Repertoire,
  book: Book,
  minImportance: number,
): string[][] {
  const userChar = rep.color === "white" ? "w" : "b";
  const all: string[][] = [];
  const kept: string[][] = [];

  const walk = (
    nodes: RepNode[],
    fen: string,
    sans: string[],
    reach: number,
  ) => {
    const side = turnOf(fen);
    const bookMoves = side !== userChar ? book.moves[posKey(fen)] ?? [] : [];
    const total = bookMoves.reduce((sum, m) => sum + m[1], 0) || 1;
    for (const node of nodes) {
      let childReach = reach;
      if (side !== userChar) {
        const entry = bookMoves.find((m) => m[0] === node.san);
        childReach = reach * (entry ? entry[1] / total : 1 / (total + 1));
      }
      const next = [...sans, node.san];
      if (node.children.length === 0) {
        all.push(next);
        if (childReach >= minImportance) kept.push(next);
      } else {
        walk(node.children, node.fen, next, childReach);
      }
    }
  };

  walk(rep.root, START_FEN, [], 1);
  return kept.length > 0 ? kept : all;
}

/** A complete root-to-leaf repertoire line, tagged with its opening name. */
export interface NamedLine {
  /** Nodes from the first move to the leaf. */
  path: RepNode[];
  /** SAN sequence for the whole line. */
  sans: string[];
  /** ECO code of the deepest named position (may be null). */
  eco: string | null;
  /** Opening name of the deepest position the book knows, or null. */
  name: string | null;
  /** 1-based ply of that deepest named position (0 = none found). */
  namedPly: number;
  /** A custom label the user set on the leaf, if any. */
  label?: string;
}

/**
 * Every root-to-leaf line in the repertoire, in tree (depth-first) order — the
 * same order training drills them — each tagged with the most specific opening
 * name the book knows along its path.
 */
export function describeLines(rep: Repertoire, book: Book | null): NamedLine[] {
  const out: NamedLine[] = [];
  const walk = (nodes: RepNode[], path: RepNode[]) => {
    for (const node of nodes) {
      const next = [...path, node];
      if (node.children.length === 0) out.push(describe(next, book));
      else walk(node.children, next);
    }
  };
  walk(rep.root, []);
  return out;
}

/** Name a single line by the deepest position along it that the book knows. */
function describe(path: RepNode[], book: Book | null): NamedLine {
  let eco: string | null = null;
  let name: string | null = null;
  let namedPly = 0;
  if (book) {
    for (let i = path.length - 1; i >= 0; i--) {
      const nm = openingNameFrom(book, path[i].fen);
      if (nm) {
        eco = nm.eco || null;
        name = nm.name;
        namedPly = i + 1;
        break;
      }
    }
  }
  const leaf = path[path.length - 1];
  return {
    path,
    sans: path.map((n) => n.san),
    eco,
    name,
    namedPly,
    label: leaf?.comment,
  };
}

/**
 * The shortest SAN prefix whose removal deletes this whole line back to its last
 * branch point, so "delete" removes the line the user sees — not merely its
 * final move. If the line shares no branch with any other, the whole thing goes.
 */
export function linePruneTarget(line: NamedLine): string[] {
  let cut = 0;
  for (let i = 0; i < line.path.length - 1; i++) {
    if (line.path[i].children.length > 1) cut = i + 1;
  }
  return line.sans.slice(0, cut + 1);
}
