import type { Move } from "chess.js";
import {
  moveNumberOf,
  ordinal,
  queryBoard,
  squareColorOf,
  turnOf,
  uciToInput,
  type BoardQuery,
} from "./chess";
import { bookMovesFrom, openingNameFrom, type Book, type BookMove } from "./book";
import { relScore } from "./evalFormat";
import type { EngineLine, Turn } from "./types";

/**
 * A structured, entirely offline explanation of an engine move, shaped for the
 * analysis-summary card. Everything is derived from data the engine already
 * produced (the evaluation and how this line compares to the others), the
 * bundled opening book, and chess.js reasoning about the *resulting* position —
 * what the move attacks, what it clears, what the opponent's main replies are.
 * No network and no guesswork about the engine's internals.
 */
export interface OpeningInfo {
  name: string;
  eco: string | null;
}

/** One of the opponent's main book replies to this move. */
export interface ReplyInfo {
  san: string;
  /** Variation name (shortened relative to the parent opening), if known. */
  name: string | null;
  /** Popularity note: "most common" / "common" / "sideline". */
  note: string;
}

export interface MoveSummary {
  san: string;
  /** Opening/variation this move belongs to (card header). */
  opening: OpeningInfo | null;
  /** e.g. "3rd move · light-squared bishop". */
  descriptor: string;
  /** Verdict for colouring the hero move and the fallback tagline. */
  verdict: { label: string; tone: "good" | "equal" | "bad" };
  /** Whether this is the engine's top line. */
  isBest: boolean;
  /** THE IDEA — a short strategic paragraph; `**x**` marks emphasis. */
  idea: string;
  /** WHAT IT DOES — concise bullets. */
  actions: string[];
  /** IF <side> PLAYS… — the opponent's main book replies. */
  replies: ReplyInfo[];
  /** The side to move after this move — labels the replies box. */
  opponent: "White" | "Black";
  /** WATCH OUT — conditional cautions (may be empty). */
  watchOut: string[];
}

/**
 * Position-level data shared by every line's summary, so the expensive chess.js
 * / book work runs once per position rather than once per line on every engine
 * tick. Built by the caller (see EnginePanel) and reused across all rows.
 */
export interface MoveContext {
  /** Legal moves of the position (from `legalMoves(fen)`). */
  legal: Move[];
  /** Theory moves of the position (from `bookMovesFrom(book, fen)`). */
  bookMoves: BookMove[];
  /** Raw book, for naming positions and the opponent's replies. */
  book: Book | null;
}

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const CENTER = new Set(["d4", "e4", "d5", "e5"]);

// Squares that must be vacated to castle, by colour and side.
const CASTLE_PATH = {
  w: { k: new Set(["f1", "g1"]), q: new Set(["b1", "c1", "d1"]) },
  b: { k: new Set(["f8", "g8"]), q: new Set(["b8", "c8", "d8"]) },
} as const;

function pieceName(type: string): string {
  return PIECE_NAMES[type] ?? "piece";
}

/** A readable reference: pawns read "**e5** pawn", pieces "knight on **c6**". */
function pieceRef(square: string, type: string): string {
  return type === "p" ? `**${square}** pawn` : `${pieceName(type)} on **${square}**`;
}

/**
 * The square the captured piece stood on. For en passant that is *not* the
 * move's destination — the taken pawn sits on the destination file at the
 * origin rank (e.g. exd6 e.p. captures the pawn on d5).
 */
function capturedSquare(mv: Move): string {
  return mv.flags.includes("e") ? `${mv.to[0]}${mv.from[1]}` : mv.to;
}

/** The verbose chess.js move for an engine line's UCI (carries piece/capture/flags). */
function verboseMove(legal: Move[], uci: string): Move | null {
  const { from, to, promotion } = uciToInput(uci);
  return (
    legal.find(
      (m) => m.from === from && m.to === to && (!promotion || m.promotion === promotion),
    ) ?? null
  );
}

/** Positional verdict from the mover's centipawn / mate score. */
function verdictFor(line: EngineLine, rel: number): MoveSummary["verdict"] {
  if (line.type === "mate") {
    if (rel > 0) {
      return { label: `Forced mate in ${Math.abs(line.value)}`, tone: "good" };
    }
    return { label: `Gets mated in ${Math.abs(line.value)}`, tone: "bad" };
  }
  if (rel >= 300) return { label: "Winning advantage", tone: "good" };
  if (rel >= 150) return { label: "Clearly better", tone: "good" };
  if (rel >= 60) return { label: "Slightly better", tone: "good" };
  if (rel > -60) return { label: "Roughly equal", tone: "equal" };
  if (rel > -150) return { label: "Slightly worse", tone: "bad" };
  if (rel > -300) return { label: "Clearly worse", tone: "bad" };
  return { label: "Losing", tone: "bad" };
}

/** The piece descriptor for the hero subtitle (bishops carry their square colour). */
function describePiece(mv: Move): string {
  if (mv.piece === "b") return `${squareColorOf(mv.to)}-squared bishop`;
  return pieceName(mv.piece);
}

// --- Tactical facts, read off the position AFTER the move ---

interface Tactics {
  /** The most valuable enemy piece the moved piece now attacks. */
  hit: { square: string; type: string } | null;
  /** A target that `hit` solely defends and we also attack (a pressure point). */
  onlyDefenderOf: { square: string; type: string } | null;
  /** Whether the move vacated a square on the castling path. */
  clearsCastle: "kingside" | "queenside" | null;
  /** A minor piece leaving the back rank. */
  developing: boolean;
  /** Whether the mover still holds both bishops. */
  bishopPair: boolean;
  /** Whether the moved piece is left attacked and undefended. */
  hangs: boolean;
}

function analyzeTactics(mv: Move, q: BoardQuery): Tactics {
  const me = mv.color as Turn;
  const opp: Turn = me === "w" ? "b" : "w";

  // Enemy pieces (not the king) the moved piece attacks from its new square.
  const attacked = q
    .piecesOf(opp)
    .filter((e) => e.type !== "k" && q.attackers(e.square, me).includes(mv.to))
    .sort((a, b) => (PIECE_VALUE[b.type] ?? 0) - (PIECE_VALUE[a.type] ?? 0));
  const hit = attacked[0] ?? null;

  // Does the hit piece solely guard something we also bear down on?
  let onlyDefenderOf: Tactics["onlyDefenderOf"] = null;
  if (hit) {
    const guarded = q
      .piecesOf(opp)
      .filter(
        (t) => t.square !== hit.square && q.attackers(t.square, opp).includes(hit.square),
      );
    const sole = guarded.find(
      (t) => q.attackers(t.square, me).length > 0 && q.attackers(t.square, opp).length === 1,
    );
    if (sole) onlyDefenderOf = { square: sole.square, type: sole.type };
  }

  const backRank = me === "w" ? "1" : "8";
  const developing = (mv.piece === "n" || mv.piece === "b") && mv.from[1] === backRank;

  // Only credit "clears the castling path" to a developing minor piece — a queen
  // or rook stepping off a back-rank square technically frees it too, but that's
  // rarely the point and reads as noise.
  const paths = CASTLE_PATH[me];
  const rights = q.castling(me);
  let clearsCastle: Tactics["clearsCastle"] = null;
  if (developing) {
    if (rights.k && paths.k.has(mv.from)) clearsCastle = "kingside";
    else if (rights.q && paths.q.has(mv.from)) clearsCastle = "queenside";
  }

  const bishopPair = q.piecesOf(me).filter((p) => p.type === "b").length >= 2;

  const hangs =
    q.attackers(mv.to, opp).length > 0 && q.attackers(mv.to, me).length === 0;

  return { hit, onlyDefenderOf, clearsCastle, developing, bishopPair, hangs };
}

/** THE IDEA — a short paragraph describing the point of the move. */
function buildIdea(mv: Move, t: Tactics, verdict: MoveSummary["verdict"]): string {
  const prep = t.clearsCastle ? "quietly prepare to castle" : null;
  const parts: string[] = [];

  if (mv.captured) {
    parts.push(
      `Take the ${pieceRef(capturedSquare(mv), mv.captured)}${prep ? ` and ${prep}` : ""}.`,
    );
  } else if (t.hit) {
    let s = `Attack the ${pieceRef(t.hit.square, t.hit.type)}`;
    if (t.onlyDefenderOf) {
      s += ` — the only defender of the ${pieceRef(t.onlyDefenderOf.square, t.onlyDefenderOf.type)} —`;
    }
    if (prep) s += ` and ${prep}`;
    parts.push(`${s}.`);
    // Only frame it as "building pressure" when there's a genuine pressure point.
    if (t.onlyDefenderOf) {
      parts.push(
        "You're not winning material; you're building lasting pressure while keeping the tension.",
      );
    }
  } else if (t.developing) {
    parts.push(
      `Develop the ${pieceName(mv.piece)}${prep ? ` and ${prep}` : ""}, bringing your worst piece into the game.`,
    );
  } else if (mv.flags.includes("k") || mv.flags.includes("q")) {
    parts.push("Castle — tuck the king to safety and bring a rook toward the centre.");
  } else if (mv.piece === "p" && CENTER.has(mv.to)) {
    parts.push(
      `Stake a claim in the centre with the pawn on **${mv.to}**${prep ? `, then ${prep}` : ""}.`,
    );
  } else {
    parts.push(`Improve your position with **${mv.san}**${prep ? ` and ${prep}` : ""}.`);
  }

  // A brief verdict frame when the pressure line above hasn't already set one.
  if (!t.hit && !mv.captured) {
    if (verdict.tone === "good") {
      parts.push("It keeps a lasting pull without committing to anything.");
    } else if (verdict.tone === "bad") {
      parts.push("The position is difficult, but this keeps things together.");
    }
  }

  return parts.join(" ");
}

/** WHAT IT DOES — up to four concrete bullets. */
function buildActions(mv: Move, t: Tactics): string[] {
  const out: string[] = [];

  if (mv.flags.includes("k")) out.push("Castles kingside");
  else if (mv.flags.includes("q")) out.push("Castles queenside");

  if (t.developing) out.push(t.hit ? "Develops with tempo" : `Develops the ${pieceName(mv.piece)}`);

  if (mv.captured) out.push(`Captures the ${pieceName(mv.captured)} on ${capturedSquare(mv)}`);
  else if (t.hit) out.push(`Hits the ${t.hit.square} ${pieceName(t.hit.type)}`);

  if (mv.promotion) out.push(`Promotes to a ${pieceName(mv.promotion)}`);

  if (t.clearsCastle) out.push(`Clears ${mv.from} to castle`);

  if (!t.developing && mv.piece === "p" && CENTER.has(mv.to)) out.push("Grabs central space");

  if (mv.san.includes("#")) out.push("Delivers checkmate");
  else if (mv.san.includes("+")) out.push("Gives check");

  if (out.length === 0) out.push(`Brings the ${pieceName(mv.piece)} to ${mv.to}`);
  return out.slice(0, 4);
}

/** IF <side> PLAYS… — the opponent's main book replies to this move. */
function buildReplies(book: Book | null, afterFen: string): ReplyInfo[] {
  if (!book) return [];
  const moves = bookMovesFrom(book, afterFen).slice(0, 3);
  if (moves.length === 0) return [];

  const total = moves.reduce((s, m) => s + m.count, 0) || 1;
  const parent = openingNameFrom(book, afterFen)?.name ?? null;

  return moves.map((m, i) => {
    let name = m.name;
    // Show only the part that distinguishes this reply from the parent opening.
    if (name && parent && name.startsWith(parent)) {
      name = name.slice(parent.length).replace(/^[:,\s]+/, "").trim() || null;
    }
    const share = m.count / total;
    const note = i === 0 ? "most common" : share >= 0.2 ? "common" : "sideline";
    return { san: m.san, name, note };
  });
}

/** WATCH OUT — cautions we can justify from the position (may be empty). */
function buildWatchOut(mv: Move, t: Tactics): string[] {
  const out: string[] = [];

  // A premature minor trade that hands over the bishop pair for nothing.
  if (mv.piece === "b" && t.bishopPair && t.hit && (t.hit.type === "n" || t.hit.type === "b")) {
    out.push(
      `Don't rush **Bx${t.hit.square}** — trading the bishop for a ${pieceName(t.hit.type)} hands over the bishop pair.`,
    );
  }

  // The move leaves its own piece hanging.
  if (t.hangs) {
    out.push(
      `Keep the ${pieceName(mv.piece)} on **${mv.to}** defended — as it stands it can be won.`,
    );
  }

  return out;
}

/** Opening/variation name this move belongs to, if the book knows it. */
function openingFor(ctx: MoveContext, afterFen: string, san: string): OpeningInfo | null {
  const bookMove = ctx.bookMoves.find((m) => m.san === san);
  if (bookMove?.name) return { name: bookMove.name, eco: bookMove.eco };
  if (ctx.book) {
    const named = openingNameFrom(ctx.book, afterFen);
    if (named?.name) return { name: named.name, eco: named.eco || null };
  }
  return null;
}

/**
 * Build a {@link MoveSummary} for one engine line, given the position, the full
 * set of candidate lines (for the best-line flag) and the shared
 * {@link MoveContext} of position-level data.
 */
export function describeMove(
  fen: string,
  line: EngineLine,
  lines: EngineLine[],
  ctx: MoveContext,
): MoveSummary {
  const whiteToMove = turnOf(fen) === "w";
  const verdict = verdictFor(line, relScore(line, whiteToMove));
  const isBest = line.multipv === (lines[0]?.multipv ?? 1);
  const mv = verboseMove(ctx.legal, line.uci);

  if (!mv) {
    // Degrade gracefully if the move can't be resolved (shouldn't happen).
    return {
      san: line.san,
      opening: null,
      descriptor: "",
      verdict,
      isBest,
      idea: "",
      actions: [],
      replies: [],
      opponent: whiteToMove ? "Black" : "White",
      watchOut: [],
    };
  }

  const afterFen = mv.after;
  const tactics = analyzeTactics(mv, queryBoard(afterFen));

  return {
    san: line.san,
    opening: openingFor(ctx, afterFen, line.san),
    descriptor: `${ordinal(moveNumberOf(fen))} move · ${describePiece(mv)}`,
    verdict,
    isBest,
    idea: buildIdea(mv, tactics, verdict),
    actions: buildActions(mv, tactics),
    replies: buildReplies(ctx.book, afterFen),
    opponent: turnOf(afterFen) === "w" ? "White" : "Black",
    watchOut: buildWatchOut(mv, tactics),
  };
}
