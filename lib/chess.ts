import { Chess, type Move, type Square } from "chess.js";
import type { LineMove, RepNode, Turn } from "./types";

export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** FEN at a given ply within a line (ply 0 = starting position). */
export function fenAtPly(line: LineMove[], ply: number): string {
  if (ply <= 0) return START_FEN;
  return line[ply - 1].fen;
}

/** Side to move in a FEN. */
export function turnOf(fen: string): Turn {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** Full-move number in a FEN. */
export function moveNumberOf(fen: string): number {
  const n = parseInt(fen.split(" ")[5] ?? "1", 10);
  return Number.isFinite(n) ? n : 1;
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: string;
}

/** Convert a chess.js Move into a LineMove. */
function toLineMove(move: Move): LineMove {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    fen: move.after,
    color: move.color as Turn,
  };
}

/** Attempt a move from a FEN. Returns the resulting LineMove or null if illegal. */
export function tryMove(fen: string, input: MoveInput | string): LineMove | null {
  const chess = new Chess(fen);
  try {
    const move = chess.move(input);
    return move ? toLineMove(move) : null;
  } catch {
    return null;
  }
}

/** All legal moves from a FEN, as verbose objects. */
export function legalMoves(fen: string): Move[] {
  return new Chess(fen).moves({ verbose: true }) as Move[];
}

/** Convert a UCI string ("e2e4", "e7e8q") into a MoveInput. */
export function uciToInput(uci: string): MoveInput {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

/** Convert a single UCI move into SAN from a given FEN (or null if illegal). */
export function uciToSan(fen: string, uci: string): string | null {
  const mv = tryMove(fen, uciToInput(uci));
  return mv ? mv.san : null;
}

/** Convert a sequence of UCI moves into SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], max = 12): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, max)) {
    try {
      const mv = chess.move(uciToInput(uci));
      if (!mv) break;
      out.push(mv.san);
    } catch {
      break;
    }
  }
  return out;
}

/** Build a fresh LineMove for the given UCI move applied at `fen`. */
export function lineMoveFromUci(fen: string, uci: string): LineMove | null {
  return tryMove(fen, uciToInput(uci));
}

/** Turn a repertoire node into a LineMove (nodes already store from/to/fen). */
export function nodeToLineMove(node: RepNode): LineMove {
  return {
    san: node.san,
    from: node.from,
    to: node.to,
    fen: node.fen,
    color: turnOf(node.fen) === "w" ? "b" : "w",
  };
}

/** English ordinal for a positive integer: 1→"1st", 2→"2nd", 3→"3rd", 11→"11th". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Light/dark colour of a board square, from its coordinates (a1 is dark). */
export function squareColorOf(square: string): "light" | "dark" {
  const file = square.charCodeAt(0) - 97; // "a" → 0
  const rank = Number(square[1]) - 1; // "1" → 0
  return (file + rank) % 2 === 0 ? "dark" : "light";
}

export interface PieceInfo {
  type: string;
  color: Turn;
}

/**
 * A chess.js instance bound to one FEN, exposing read-only position queries
 * (piece lookup, attackers/defenders, castling rights). Build once per position
 * and reuse — this keeps chess.js instantiation inside this module, matching the
 * repo convention that all chess logic flows through `lib/chess.ts`.
 */
export interface BoardQuery {
  /** The piece on a square, or null if empty. */
  get(square: string): PieceInfo | null;
  /** Squares of `color` pieces that attack (or defend) `square`. */
  attackers(square: string, color: Turn): string[];
  /** Every piece of `color`, as `{ square, type }`. */
  piecesOf(color: Turn): { square: string; type: string }[];
  /** Remaining castling rights for `color`. */
  castling(color: Turn): { k: boolean; q: boolean };
}

export function queryBoard(fen: string): BoardQuery {
  const chess = new Chess(fen);
  return {
    get(square) {
      const p = chess.get(square as Square);
      return p ? { type: p.type, color: p.color as Turn } : null;
    },
    attackers(square, color) {
      return chess.attackers(square as Square, color) as string[];
    },
    piecesOf(color) {
      const out: { square: string; type: string }[] = [];
      for (const row of chess.board()) {
        for (const cell of row) {
          if (cell && cell.color === color) {
            out.push({ square: cell.square, type: cell.type });
          }
        }
      }
      return out;
    },
    castling(color) {
      return chess.getCastlingRights(color) as { k: boolean; q: boolean };
    },
  };
}

/**
 * Format a line's move sequence as a readable "1. e4 e5 2. Nf3" string.
 * `startFen` establishes the move number / side of the first move.
 */
export function formatMoveSequence(startFen: string, sans: string[]): string {
  let moveNo = moveNumberOf(startFen);
  let whiteToMove = turnOf(startFen) === "w";
  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (whiteToMove) {
      parts.push(`${moveNo}.${sans[i]}`);
    } else {
      if (i === 0) parts.push(`${moveNo}...${sans[i]}`);
      else parts.push(sans[i]);
      moveNo++;
    }
    whiteToMove = !whiteToMove;
  }
  return parts.join(" ");
}
