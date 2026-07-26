import { legalMoves, positionStatus, turnOf } from "./chess";
import type { ChessComGame } from "./chesscom";
import type { LoadedGame } from "./pgn";
import type { Color, EngineEval, LineMove, Turn } from "./types";

/**
 * Game review: turn a sweep of engine evaluations over every position of a
 * game into per-move quality judgements and per-side accuracy figures.
 *
 * The scale used throughout is *win probability*, not raw centipawns. A
 * hundred-centipawn slip from +0.2 to -0.8 changes the game; the same slip
 * from +9.0 to +8.0 does not, and only a probability scale captures that.
 * The formulas are Lichess's, which are published and widely calibrated.
 */

/** Centipawn scores are capped before any probability maths, as Lichess does. */
export const CP_CAP = 1000;
/** A forced mate folded onto the centipawn scale (before capping). */
const MATE_CP = 10000;

export type MoveClass =
  | "book"
  | "best"
  | "great"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/** Win-percentage-point drops that separate the classes. */
const BLUNDER = 20;
const MISTAKE = 10;
const INACCURACY = 5;
const GOOD = 2;
/** A "great" move is the best move when every alternative was much worse. */
const ONLY_MOVE_GAP = 15;

/** The engine's verdict on a single position. */
export interface PositionEval {
  fen: string;
  /** Best score for this position from White's perspective, in centipawns. */
  cpWhite: number;
  /** Moves-to-mate from White's perspective (+3 = White mates in 3), else null. */
  mate: number | null;
  bestUci: string | null;
  bestSan: string | null;
  /** The engine's main line from here, in SAN. */
  pv: string[];
  /** Score of the second-best move (White's perspective), when MultiPV found one. */
  secondCpWhite: number | null;
  secondSan: string | null;
  depth: number;
  /** Set when the position itself ends the game, so no engine line exists. */
  terminal: "checkmate" | "draw" | null;
}

/** The review of one half-move. */
export interface MoveReview {
  /** 0-based index of this half-move in the game. */
  index: number;
  /** Board cursor that shows the position *after* this move (index + 1). */
  ply: number;
  san: string;
  color: Turn;
  fenBefore: string;
  fenAfter: string;
  classification: MoveClass;
  /** Centipawns thrown away, from the mover's perspective (0 when best). */
  cpLoss: number;
  /** Win probability for the mover before / after, 0..100. */
  winBefore: number;
  winAfter: number;
  /** How many percentage points of win probability this move cost. */
  winDrop: number;
  /** This move's own accuracy, 0..100. */
  accuracy: number;
  /** Evaluations from White's perspective, for the eval graph. */
  cpBefore: number;
  cpAfter: number;
  mateBefore: number | null;
  mateAfter: number | null;
  bestSan: string | null;
  bestUci: string | null;
  /** The engine's line had the best move been played. */
  bestPv: string[];
  /** The engine's line from the position the move actually reached. */
  playedPv: string[];
  /** The position was still inside the bundled opening book. */
  book: boolean;
  /** Every alternative was much worse — this was the move to find. */
  onlyMove: boolean;
  /** No choice existed. */
  forced: boolean;
}

export interface SideSummary {
  /** 0..100, Lichess-style blend of a volatility-weighted and harmonic mean. */
  accuracy: number;
  /** Average centipawn loss. */
  acpl: number;
  counts: Record<MoveClass, number>;
  moves: number;
}

export interface GameReview {
  moves: MoveReview[];
  white: SideSummary;
  black: SideSummary;
  /** Search depth the sweep used. */
  depth: number;
}

/** A game opened for review, with the side the user played. */
export interface ReviewSession {
  /** The Chess.com game this came from (for the link, ratings, result). */
  source: ChessComGame;
  game: LoadedGame;
  /** The colour the looked-up player had in this game. */
  color: Color;
  username: string;
}

/**
 * "Now you try": the board is parked just before a flagged move and the user
 * has to find the move the engine wanted.
 */
export interface ReviewChallenge {
  /** Index of the half-move being re-played. */
  index: number;
  bestSan: string;
  status: "waiting" | "correct" | "wrong";
  lastWrong: string | null;
}

/* ---------------- Score conversion ---------------- */

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

/** Fold a mate score into centipawns and cap it, ready for probability maths. */
export function cappedCp(cpWhite: number): number {
  return clamp(cpWhite, -CP_CAP, CP_CAP);
}

/** Flip a White-perspective score into `side`'s perspective. */
export function forSide(cpWhite: number, side: Turn): number {
  return side === "w" ? cpWhite : -cpWhite;
}

/**
 * Lichess's win-probability model: centipawns → the mover's expected score,
 * as a percentage. The constant comes from fitting millions of Lichess games.
 */
export function winPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cappedCp(cp))) - 1);
}

/**
 * Lichess's accuracy curve: how good a move was, given how much win
 * probability it gave up. A perfect move scores 100.
 */
export function moveAccuracy(winDrop: number): number {
  return clamp(103.1668 * Math.exp(-0.04354 * Math.max(0, winDrop)) - 3.1669, 0, 100);
}

/* ---------------- Building position evals ---------------- */

/** Score a position the engine can't search because the game already ended. */
export function terminalEval(fen: string): PositionEval | null {
  const status = positionStatus(fen);
  if (status === "ok") return null;
  const side = turnOf(fen);
  // Checkmate: the side to move has lost.
  const cpWhite =
    status === "checkmate" ? (side === "w" ? -MATE_CP : MATE_CP) : 0;
  return {
    fen,
    cpWhite,
    // Mate distance is meaningless once mate has landed — `terminal` says it all.
    mate: null,
    bestUci: null,
    bestSan: null,
    pv: [],
    secondCpWhite: null,
    secondSan: null,
    depth: 0,
    terminal: status === "checkmate" ? "checkmate" : "draw",
  };
}

/** Turn a finished engine search into a {@link PositionEval}. */
export function evalFromEngine(evaluation: EngineEval): PositionEval | null {
  const [best, second] = evaluation.lines;
  if (!best) return terminalEval(evaluation.fen);
  return {
    fen: evaluation.fen,
    cpWhite: best.scoreWhite,
    mate:
      best.type === "mate"
        ? (best.scoreWhite >= 0 ? 1 : -1) * Math.abs(best.value)
        : null,
    bestUci: best.uci,
    bestSan: best.san,
    pv: best.pvSan,
    secondCpWhite: second ? second.scoreWhite : null,
    secondSan: second ? second.san : null,
    depth: evaluation.depth,
    terminal: null,
  };
}

/* ---------------- Classification ---------------- */

function classify(opts: {
  playedSan: string;
  bestSan: string | null;
  winDrop: number;
  book: boolean;
  onlyMove: boolean;
  forced: boolean;
}): MoveClass {
  const { playedSan, bestSan, winDrop, book, onlyMove, forced } = opts;
  if (book) return "book";
  if (forced) return "best";
  if (bestSan && playedSan === bestSan) return onlyMove ? "great" : "best";
  if (winDrop >= BLUNDER) return "blunder";
  if (winDrop >= MISTAKE) return "mistake";
  if (winDrop >= INACCURACY) return "inaccuracy";
  if (winDrop >= GOOD) return "good";
  return "excellent";
}

/* ---------------- Aggregation ---------------- */

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * How volatile the position was around each half-move, which is Lichess's
 * weight for that move's accuracy: a slip in a sharp phase counts for more
 * than one in a dead-drawn endgame.
 *
 * Weights are indexed by *game* half-move, not by one side's moves, so a
 * side's accuracies and their weights have to be picked out together.
 */
function volatilityWeights(moves: MoveReview[]): number[] {
  const wins = [
    winPercent(moves[0].cpBefore),
    ...moves.map((m) => winPercent(m.cpAfter)),
  ];
  const size = Math.round(clamp(moves.length / 10, 2, 8));

  // Lichess pads the front with the leading window so early moves are weighted
  // on a full-width sample too.
  const head = wins.slice(0, size);
  const windows: number[][] = [];
  for (let i = 0; i < Math.max(0, Math.min(size, wins.length) - 2); i++) {
    windows.push(head);
  }
  for (let i = 0; i + size <= wins.length; i++) {
    windows.push(wins.slice(i, i + size));
  }

  return moves.map((_, i) => clamp(stdev(windows[i] ?? head), 0.5, 12));
}

/**
 * Lichess-style game accuracy: average a volatility-weighted mean with a
 * harmonic mean, so one catastrophe can't be averaged away by a hundred quiet
 * moves.
 */
function gameAccuracy(accuracies: number[], weights: number[]): number {
  if (accuracies.length === 0) return 100;

  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weighted =
    weightSum > 0
      ? accuracies.reduce((sum, a, i) => sum + a * weights[i], 0) / weightSum
      : accuracies.reduce((a, b) => a + b, 0) / accuracies.length;

  // Guard the harmonic mean against a 0% move.
  const harmonic =
    accuracies.length /
    accuracies.reduce((sum, a) => sum + 1 / Math.max(a, 0.5), 0);

  return clamp((weighted + harmonic) / 2, 0, 100);
}

const emptyCounts = (): Record<MoveClass, number> => ({
  book: 0,
  best: 0,
  great: 0,
  excellent: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
});

function summarize(
  moves: MoveReview[],
  side: Turn,
  weights: number[],
): SideSummary {
  const counts = emptyCounts();
  const accuracies: number[] = [];
  const myWeights: number[] = [];
  let losses = 0;
  let scored = 0;

  moves.forEach((m, i) => {
    if (m.color !== side) return;
    counts[m.classification] += 1;
    // Accuracy covers every move played, theory included — that's what makes
    // the number comparable to the one Chess.com and Lichess report.
    accuracies.push(m.accuracy);
    myWeights.push(weights[i] ?? 1);
    // Average centipawn loss, though, is about decisions you actually made.
    if (!m.book) {
      losses += m.cpLoss;
      scored += 1;
    }
  });

  return {
    accuracy: gameAccuracy(accuracies, myWeights),
    acpl: scored > 0 ? Math.round(losses / scored) : 0,
    counts,
    moves: accuracies.length,
  };
}

/* ---------------- The review itself ---------------- */

export interface BuildReviewInput {
  /** The game's half-moves, in order. */
  moves: LineMove[];
  /** FEN before each move plus the final position — length `moves.length + 1`. */
  positions: string[];
  /** Engine verdict for each entry of `positions` (null while still pending). */
  evals: (PositionEval | null)[];
  /** Whether the position before move `i` was still in the opening book. */
  isBookMove?: (fenBefore: string, san: string, index: number) => boolean;
  depth: number;
}

/** Assemble per-move judgements and per-side summaries from a finished sweep. */
export function buildReview(input: BuildReviewInput): GameReview {
  const { moves, positions, evals, isBookMove, depth } = input;
  const reviews: MoveReview[] = [];

  // Once the opponent leaves book, nothing after it is theory either.
  let stillBook = true;

  for (let i = 0; i < moves.length; i++) {
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) continue;

    const move = moves[i];
    const side = move.color;
    const fenBefore = positions[i];

    const book = stillBook && (isBookMove?.(fenBefore, move.san, i) ?? false);
    if (!book) stillBook = false;

    const bestCp = forSide(before.cpWhite, side);
    const playedCp = forSide(after.cpWhite, side);

    const winBefore = winPercent(bestCp);
    const winAfter = winPercent(playedCp);
    const winDrop = Math.max(0, winBefore - winAfter);

    const cpLoss = Math.max(0, cappedCp(bestCp) - cappedCp(playedCp));

    const secondCp =
      before.secondCpWhite != null ? forSide(before.secondCpWhite, side) : null;
    const onlyMove =
      secondCp != null && winBefore - winPercent(secondCp) >= ONLY_MOVE_GAP;
    const forced = legalMoves(fenBefore).length === 1;

    const classification = classify({
      playedSan: move.san,
      bestSan: before.bestSan,
      winDrop,
      book,
      onlyMove,
      forced,
    });

    reviews.push({
      index: i,
      ply: i + 1,
      san: move.san,
      color: side,
      fenBefore,
      fenAfter: move.fen,
      classification,
      cpLoss,
      winBefore,
      winAfter,
      winDrop,
      accuracy: moveAccuracy(winDrop),
      cpBefore: before.cpWhite,
      cpAfter: after.cpWhite,
      mateBefore: before.mate,
      mateAfter: after.mate,
      bestSan: before.bestSan,
      bestUci: before.bestUci,
      bestPv: before.pv,
      playedPv: after.pv,
      book,
      onlyMove,
      forced,
    });
  }

  const weights = reviews.length > 0 ? volatilityWeights(reviews) : [];
  return {
    moves: reviews,
    white: summarize(reviews, "w", weights),
    black: summarize(reviews, "b", weights),
    depth,
  };
}

/* ---------------- Presentation helpers ---------------- */

export const MISTAKE_CLASSES: MoveClass[] = ["blunder", "mistake", "inaccuracy"];

/** Is this a move worth coaching? */
export function isMistake(m: MoveReview): boolean {
  return MISTAKE_CLASSES.includes(m.classification);
}

/** The moves a given side should study, worst first is *not* wanted — keep game order. */
export function keyMoments(review: GameReview, side: Turn): MoveReview[] {
  return review.moves.filter((m) => m.color === side && isMistake(m));
}

export const CLASS_META: Record<
  MoveClass,
  { label: string; glyph: string; text: string; bg: string; dot: string }
> = {
  great: {
    label: "Great",
    glyph: "!",
    text: "text-sky-300",
    bg: "bg-sky-500/15",
    dot: "bg-sky-400",
  },
  best: {
    label: "Best",
    glyph: "★",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    dot: "bg-emerald-400",
  },
  excellent: {
    label: "Excellent",
    glyph: "✓",
    text: "text-emerald-400/90",
    bg: "bg-emerald-500/10",
    dot: "bg-emerald-500",
  },
  good: {
    label: "Good",
    glyph: "✓",
    text: "text-slate-300",
    bg: "bg-slate-500/15",
    dot: "bg-slate-400",
  },
  book: {
    label: "Book",
    glyph: "📖",
    text: "text-violet-300",
    bg: "bg-violet-500/15",
    dot: "bg-violet-400",
  },
  inaccuracy: {
    label: "Inaccuracy",
    glyph: "?!",
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    dot: "bg-amber-400",
  },
  mistake: {
    label: "Mistake",
    glyph: "?",
    text: "text-orange-300",
    bg: "bg-orange-500/15",
    dot: "bg-orange-400",
  },
  blunder: {
    label: "Blunder",
    glyph: "??",
    text: "text-rose-300",
    bg: "bg-rose-500/15",
    dot: "bg-rose-400",
  },
};

/** Order used when listing the summary counts. */
export const CLASS_ORDER: MoveClass[] = [
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "blunder",
];

/** A 0..100 accuracy as a rough playing-strength label. */
export function accuracyLabel(accuracy: number): string {
  if (accuracy >= 95) return "Flawless";
  if (accuracy >= 90) return "Excellent";
  if (accuracy >= 80) return "Good";
  if (accuracy >= 70) return "Decent";
  if (accuracy >= 60) return "Shaky";
  return "Rough";
}
