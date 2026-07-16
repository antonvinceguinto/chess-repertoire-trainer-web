import type { EngineEval, EngineLine, LineMove } from "./types";
import {
  SEE_PIECE_VALUE,
  queryBoard,
  staticExchangeGain,
  turnOf,
  uciToInput,
} from "./chess";
import { evalToWhiteFraction, relScore } from "./evalFormat";

/**
 * chess.com-style move "reactions". Each played move is graded by how much
 * winning chance it gave up versus the engine's best move, with a few special
 * cases layered on top (a known theory move is "book"; a sound sacrifice is
 * "brilliant"; the sole good move in a sharp spot is "great"; squandering a
 * clearly winning chance is a "miss").
 */
export type MoveClass =
  | "brilliant" // !!  — a sound sacrifice
  | "great" //     !   — the only good move
  | "best" //      ★   — the engine's top move
  | "excellent" // ✓   — as good as best, essentially
  | "good" //      ✓   — a solid move
  | "book" //      📖  — known opening theory
  | "inaccuracy" //?!  — a small slip
  | "mistake" //   ?   — a real error
  | "miss" //      ✗   — a winning chance thrown away
  | "blunder"; //  ??  — a serious error

export interface Classification {
  cls: MoveClass;
  /** Win% (0..100) the mover gave up versus the engine's best move. */
  winLoss: number;
  /** A short, human-readable reason the move earned this label. */
  reason: string;
}

/** Display metadata per class — symbol, colours for the chip and board disc. */
export const CLASS_META: Record<
  MoveClass,
  { label: string; symbol: string; disc: string; chip: string }
> = {
  brilliant: {
    label: "Brilliant",
    symbol: "!!",
    disc: "bg-teal-500",
    chip: "bg-teal-500/15 text-teal-300 border-teal-500/40",
  },
  great: {
    label: "Great",
    symbol: "!",
    disc: "bg-sky-500",
    chip: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  },
  best: {
    label: "Best",
    symbol: "★",
    disc: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  excellent: {
    label: "Excellent",
    symbol: "✓",
    disc: "bg-green-600",
    chip: "bg-green-600/15 text-green-300 border-green-600/40",
  },
  good: {
    label: "Good",
    symbol: "✓",
    disc: "bg-lime-600",
    chip: "bg-lime-600/15 text-lime-300 border-lime-600/40",
  },
  book: {
    label: "Book",
    symbol: "📖",
    disc: "bg-amber-600",
    chip: "bg-amber-600/15 text-amber-300 border-amber-600/40",
  },
  inaccuracy: {
    label: "Inaccuracy",
    symbol: "?!",
    disc: "bg-yellow-500",
    chip: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  },
  mistake: {
    label: "Mistake",
    symbol: "?",
    disc: "bg-orange-500",
    chip: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  },
  miss: {
    label: "Miss",
    symbol: "✗",
    disc: "bg-rose-500",
    chip: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  },
  blunder: {
    label: "Blunder",
    symbol: "??",
    disc: "bg-red-600",
    chip: "bg-red-600/15 text-red-300 border-red-600/40",
  },
};

/** The order used for a legend / key (best-to-worst, sacrifice first). */
export const CLASS_ORDER: MoveClass[] = [
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

// --- Tunable thresholds, all in win% (0..100) lost from the mover's side. ---
const T_EXCELLENT = 2; //   <= 2%   lost, but not the top move → excellent
const T_GOOD = 5; //        <= 5%   → good
const T_INACCURACY = 10; // <= 10%  → inaccuracy
const T_MISTAKE = 20; //    <= 20%  → mistake, above → blunder
/** A best move whose alternatives were all clearly worse earns "Great". */
const GREAT_ONLY_MOVE_GAP = 10; // win% gap between best and 2nd-best
/** A "Miss" is a decisive chance (a clearly winning best move) squandered. */
const MISS_MIN_LOSS = 10; //   at least a mistake-sized drop
const MISS_BEST_WIN = 80; //   best move was worth >= 80% expected score
// Brilliant = a sound sacrifice that is still (near) the best move.
const BRILLIANT_MAX_LOSS = 2; //          must be excellent-or-better
const BRILLIANT_MIN_SAC = 180; //         >= an exchange / minor piece given up
const BRILLIANT_MIN_EVAL_AFTER = -50; //  still ~equal-or-better afterwards (cp)
const BRILLIANT_MAX_EVAL_BEFORE = 700; // not already completely winning (cp)

const winPct = (moverScore: number): number => 100 * evalToWhiteFraction(moverScore);

/** Centipawns as a readable point count, e.g. 200 → "2", 180 → "1.8". */
const pts = (cp: number): string => {
  const p = cp / 100;
  return Number.isInteger(p) ? `${p}` : p.toFixed(1);
};

/** Does this engine line's first move equal the played move (from/to[/promo])? */
function isPlayedMove(uci: string, mv: LineMove): boolean {
  const { from, to, promotion } = uciToInput(uci);
  if (from !== mv.from || to !== mv.to) return false;
  return mv.promotion ? promotion === mv.promotion : true;
}

/** The engine line for the played move within the "before" eval, if present. */
function playedLineOf(before: EngineEval, mv: LineMove): EngineLine | null {
  return before.lines.find((l) => isPlayedMove(l.uci, mv)) ?? null;
}

/**
 * Material (centipawns) the move gives up on its own destination square — the
 * essence of a sacrifice. It's what the opponent can win back there by static
 * exchange, *minus* what this move itself captured. A plain trade nets ~0
 * (e.g. QxQ answered by KxQ: capture 900, recapture 900 → 0) and is not a
 * sacrifice; a Greek-gift Bxh7+ nets ~200 (pawn taken, bishop lost). Measuring
 * only the moved piece's square is deliberate: it ties the sacrifice to *this*
 * move, so a piece left hanging by an earlier move can't smear "brilliant" onto
 * every follow-up.
 */
function moveSacrifice(beforeFen: string, move: LineMove): number {
  const before = queryBoard(beforeFen);
  const captured = before.get(move.to);
  let capturedValue = captured ? SEE_PIECE_VALUE[captured.type] ?? 0 : 0;
  // En passant: a pawn captures diagonally onto an otherwise-empty square.
  if (!captured && move.from[0] !== move.to[0]) {
    const moved = before.get(move.from);
    if (moved?.type === "p") capturedValue = SEE_PIECE_VALUE.p;
  }
  const recapture = staticExchangeGain(move.fen, move.to);
  return Math.max(0, recapture - capturedValue);
}

export interface ClassifyInput {
  /** FEN before the move was played (the mover is to play). */
  beforeFen: string;
  /** The played move. */
  move: LineMove;
  /** Engine eval of the position *before* the move (mover to play). */
  before: EngineEval | null;
  /** Engine eval of the position *after* the move (opponent to play). */
  after: EngineEval | null;
  /** Whether the position was known theory and this move is a book move. */
  isBook: boolean;
}

/**
 * Grade a single played move. Returns null when there isn't enough engine data
 * yet to judge it (so the caller simply shows no badge).
 */
export function classifyMove({
  beforeFen,
  move,
  before,
  after,
  isBook,
}: ClassifyInput): Classification | null {
  if (isBook)
    return {
      cls: "book",
      winLoss: 0,
      reason: "A well-known opening move — established theory, not graded by the engine.",
    };
  if (!before || before.lines.length === 0) return null;

  const moverWhite = turnOf(beforeFen) === "w";
  const bestLine = before.lines[0];
  const bestSan = bestLine.san; // the engine's top move here, for "…was better"
  const bestScore = relScore(bestLine, moverWhite); // best available, mover's cp
  const winBest = winPct(bestScore);

  // Realised score of the played move (mover's perspective). Prefer the "before"
  // eval's own PV for the move (same depth as the best move) and fall back to the
  // eval of the resulting position, negated to the mover's side.
  const playedLine = playedLineOf(before, move);
  let playedScore: number | null = null;
  if (playedLine) {
    playedScore = relScore(playedLine, moverWhite);
  } else if (after && after.lines.length > 0) {
    playedScore = moverWhite ? after.lines[0].scoreWhite : -after.lines[0].scoreWhite;
  } else if (move.san.includes("#")) {
    playedScore = bestScore; // a mating move with no "after" data is simply best
  } else if (after && after.lines.length === 0) {
    playedScore = 0; // a terminal, non-mate position = stalemate / draw (0.0)
  }
  if (playedScore === null) return null;

  const winPlayed = winPct(playedScore);
  const winLoss = Math.max(0, winBest - winPlayed);
  const lossPct = Math.round(winLoss);
  const isTop = isPlayedMove(bestLine.uci, move);
  const grade = (cls: MoveClass, reason: string): Classification => ({
    cls,
    winLoss,
    reason,
  });

  // Brilliant — a sound sacrifice that keeps the move (near) best and doesn't
  // just cash in a position that was already winning anyway.
  if (
    winLoss <= BRILLIANT_MAX_LOSS &&
    playedScore >= BRILLIANT_MIN_EVAL_AFTER &&
    bestScore <= BRILLIANT_MAX_EVAL_BEFORE
  ) {
    const sac = moveSacrifice(beforeFen, move);
    if (sac >= BRILLIANT_MIN_SAC) {
      return grade(
        "brilliant",
        `A brilliant sacrifice — you give up about ${pts(sac)} points of material, yet the engine confirms the position stays in your favour.`,
      );
    }
  }

  // Great — the top move was essentially the only good one.
  if (isTop && before.lines.length >= 2) {
    const secondScore = relScore(before.lines[1], moverWhite);
    if (winBest - winPct(secondScore) >= GREAT_ONLY_MOVE_GAP) {
      return grade(
        "great",
        "The only move that keeps your advantage — every alternative was clearly worse.",
      );
    }
  }

  if (isTop) return grade("best", "The engine's top choice in this position.");

  // Miss — a clearly winning chance was on the board (best >= 80%) and the move
  // let it slip out of clearly-winning territory. (Staying clearly winning is
  // just an inaccuracy; falling short of a win you had is a miss.)
  if (
    winLoss >= MISS_MIN_LOSS &&
    winBest >= MISS_BEST_WIN &&
    winPlayed < MISS_BEST_WIN
  ) {
    return grade(
      "miss",
      `A missed chance — ${bestSan} kept a clearly winning position, but this lets the win slip.`,
    );
  }

  if (winLoss <= T_EXCELLENT)
    return grade(
      "excellent",
      `Practically as strong as ${bestSan}, the engine's top move — no real difference.`,
    );
  if (winLoss <= T_GOOD)
    return grade(
      "good",
      `A solid move — a touch weaker than ${bestSan}, but perfectly playable.`,
    );
  if (winLoss <= T_INACCURACY)
    return grade(
      "inaccuracy",
      `A slight inaccuracy — ${bestSan} was more precise, worth about ${lossPct}% more winning chances.`,
    );
  if (winLoss <= T_MISTAKE)
    return grade(
      "mistake",
      `A mistake — ${bestSan} was clearly stronger, costing about ${lossPct}% of your winning chances.`,
    );
  return grade(
    "blunder",
    `A blunder — ${bestSan} was much better; this throws away about ${lossPct}% of your winning chances.`,
  );
}
