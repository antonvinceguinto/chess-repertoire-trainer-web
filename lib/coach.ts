import {
  attackersOf,
  formatMoveSequence,
  inCheck,
  moveNumberOf,
  pieceAt,
  piecesOn,
  tryMove,
  turnOf,
} from "./chess";
import type { MoveReview } from "./review";
import type { Turn } from "./types";

/**
 * The coach: plain-language explanations of what went wrong on a move.
 *
 * Everything here is deterministic and offline — the app has no backend and
 * calls no language model. Instead we read the actual position with chess.js
 * and the engine's own lines, and describe what they say: what hangs, what the
 * refutation is, what was missed, and what to play instead. Rules only fire
 * when the position really supports them, so the advice is never invented.
 */

export interface CoachAdvice {
  /** One-line verdict, e.g. "This drops a piece." */
  headline: string;
  /** The concrete observations behind the verdict. */
  points: string[];
  /** "Better was 15.Nxe5, and after …" — null when the move was already best. */
  betterLine: string | null;
  /** A short principle to carry into the next game. */
  takeaway: string | null;
}

/* ---------------- Board vocabulary ---------------- */

const VALUE: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const NAME: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const other = (side: Turn): Turn => (side === "w" ? "b" : "w");
const sideName = (side: Turn) => (side === "w" ? "White" : "Black");

/** "knight on f6" for a piece code like "wn" and a square. */
function describe(piece: string, square: string): string {
  return `${NAME[piece[1]] ?? "piece"} on ${square}`;
}

/** Signed material in centipawns from White's perspective. */
function material(fen: string): number {
  let total = 0;
  for (const { piece } of piecesOn(fen)) {
    if (piece[1] === "k") continue;
    total += piece[0] === "w" ? VALUE[piece[1]] : -VALUE[piece[1]];
  }
  return total;
}

/** Cheapest attacker of `square` belonging to `side`, or null. */
function cheapestAttacker(
  fen: string,
  square: string,
  side: Turn,
): { square: string; piece: string; value: number } | null {
  let best: { square: string; piece: string; value: number } | null = null;
  for (const from of attackersOf(fen, square, side)) {
    const piece = pieceAt(fen, from);
    if (!piece) continue;
    const value = VALUE[piece[1]] ?? 0;
    if (!best || value < best.value) best = { square: from, piece, value };
  }
  return best;
}

/**
 * Pieces of `side` that the opponent can profitably take right now: either
 * undefended, or attacked by something cheaper than they are.
 */
function loosePieces(
  fen: string,
  side: Turn,
): { square: string; piece: string; attacker: string }[] {
  const foe = other(side);
  const out: { square: string; piece: string; attacker: string }[] = [];
  for (const { square, piece } of piecesOn(fen)) {
    if (piece[0] !== side || piece[1] === "k") continue;
    const attacker = cheapestAttacker(fen, square, foe);
    if (!attacker) continue;
    const defended = attackersOf(fen, square, side).length > 0;
    const value = VALUE[piece[1]] ?? 0;
    if (!defended || attacker.value < value) {
      out.push({ square, piece, attacker: attacker.piece });
    }
  }
  // Report the most valuable loss first.
  return out.sort(
    (a, b) => (VALUE[b.piece[1]] ?? 0) - (VALUE[a.piece[1]] ?? 0),
  );
}

/**
 * Valuable targets a piece standing on `from` attacks — two or more means a
 * fork or double attack.
 */
function forkTargets(
  fen: string,
  from: string,
  victim: Turn,
): { square: string; piece: string }[] {
  return piecesOn(fen).filter(({ square, piece }) => {
    if (piece[0] !== victim) return false;
    if ((VALUE[piece[1]] ?? 0) < 320) return false; // pawns aren't a fork
    return attackersOf(fen, square, other(victim)).includes(from);
  });
}

/** Narrate a SAN line as "15.Nxe5 Qxe5 16.Bf4". */
function narrate(fen: string, pv: string[], max = 4): string {
  return formatMoveSequence(fen, pv.slice(0, max));
}

/** Mate distance from `side`'s point of view: +n = they mate, -n = they get mated. */
function moverMate(mateWhite: number | null, side: Turn): number | null {
  if (mateWhite == null) return null;
  return side === "w" ? mateWhite : -mateWhite;
}

/** "+1.35" style score from the mover's perspective. */
function povScore(cpWhite: number, side: Turn): string {
  const cp = side === "w" ? cpWhite : -cpWhite;
  const pawns = cp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

/** Rough verbal reading of a position from the mover's perspective. */
function standing(cpWhite: number, side: Turn): string {
  const cp = side === "w" ? cpWhite : -cpWhite;
  if (cp >= 500) return "completely winning";
  if (cp >= 200) return "clearly better";
  if (cp >= 70) return "a bit better";
  if (cp > -70) return "roughly equal";
  if (cp > -200) return "slightly worse";
  if (cp > -500) return "clearly worse";
  return "lost";
}

/* ---------------- The advice ---------------- */

/** Praise for the moves that don't need fixing. */
function goodMoveAdvice(m: MoveReview): CoachAdvice {
  if (m.book) {
    return {
      headline: "Book move — this is still known theory.",
      points: [
        `${m.san} is part of established opening theory, so there's nothing to fix here.`,
      ],
      betterLine: null,
      takeaway: null,
    };
  }
  if (m.forced) {
    return {
      headline: "Forced — there was nothing else legal.",
      points: [`${m.san} was the only legal move in the position.`],
      betterLine: null,
      takeaway: null,
    };
  }
  if (m.classification === "great") {
    return {
      headline: "Great move — you found the only good option.",
      points: [
        `${m.san} was the single move that held the position together; everything else lost significant ground.`,
        m.bestPv.length > 1
          ? `The engine continues ${narrate(m.fenBefore, m.bestPv)}.`
          : "",
      ].filter(Boolean),
      betterLine: null,
      takeaway: "Trust your calculation when only one move works — that's the move.",
    };
  }
  if (m.classification === "best") {
    return {
      headline: "Best move — this is what the engine plays.",
      points: [
        m.bestPv.length > 1
          ? `The main line runs ${narrate(m.fenBefore, m.bestPv)}.`
          : `${m.san} keeps the evaluation at ${povScore(m.cpAfter, m.color)}.`,
      ],
      betterLine: null,
      takeaway: null,
    };
  }
  return {
    headline:
      m.classification === "excellent"
        ? "Excellent — as good as the top choice in practice."
        : "Good move — nothing lost.",
    points: [
      `The position stays ${standing(m.cpAfter, m.color)} for you (${povScore(m.cpAfter, m.color)}).`,
      m.bestSan && m.bestSan !== m.san
        ? `The engine's slight preference was ${m.bestSan}, but the difference is negligible.`
        : "",
    ].filter(Boolean),
    betterLine: null,
    takeaway: null,
  };
}

/**
 * Explain a flagged move: what it allowed, what it missed, and what to play
 * instead. Each observation is checked against the real position first.
 */
export function explainMove(m: MoveReview): CoachAdvice {
  if (m.book || m.forced || !["inaccuracy", "mistake", "blunder"].includes(m.classification)) {
    return goodMoveAdvice(m);
  }

  const me = m.color;
  const foe = other(me);
  const points: string[] = [];

  const mateBefore = moverMate(m.mateBefore, me);
  const mateAfter = moverMate(m.mateAfter, me);

  /* --- 1. Mate that was thrown away, or handed over --- */
  if (mateBefore != null && mateBefore > 0 && (mateAfter == null || mateAfter <= 0)) {
    points.push(
      `You had a forced mate in ${mateBefore}${
        m.bestSan ? ` starting with ${m.bestSan}` : ""
      }, and ${m.san} lets it slip.`,
    );
  }
  if (mateAfter != null && mateAfter < 0) {
    const reply = m.playedPv[0];
    points.push(
      `After ${m.san} your opponent has mate in ${Math.abs(mateAfter)}${
        reply ? `, beginning with ${reply}` : ""
      }.`,
    );
  }

  /* --- 2. What the opponent's refutation actually does --- */
  const refutation = m.playedPv[0];
  if (refutation) {
    const replyMove = tryMove(m.fenAfter, refutation);
    if (replyMove) {
      const captured = replyMove.san.includes("x")
        ? pieceAt(m.fenAfter, replyMove.to)
        : null;
      if (captured && captured[0] === me) {
        const defenders = attackersOf(m.fenAfter, replyMove.to, me).length;
        points.push(
          defenders === 0
            ? `Your opponent replies ${refutation}, winning the ${describe(captured, replyMove.to)} for nothing — it has no defender.`
            : `Your opponent replies ${refutation}, and the ${describe(captured, replyMove.to)} can't be held profitably.`,
        );
      }

      // Does the refutation set up a fork or double attack?
      const targets = forkTargets(replyMove.fen, replyMove.to, me);
      const givesCheck = inCheck(replyMove.fen);
      if (targets.length >= 2 || (givesCheck && targets.length >= 1)) {
        const named = targets
          .slice(0, 2)
          .map((t) => describe(t.piece, t.square))
          .join(" and your ");
        points.push(
          `${refutation} hits two things at once${
            givesCheck ? " with check" : ""
          } — your ${named}.`,
        );
      } else if (givesCheck && points.length === 0) {
        points.push(`${refutation} comes with check, and you have no good answer.`);
      }
    }
  }

  /* --- 3. Pieces left hanging by the move itself --- */
  const loose = loosePieces(m.fenAfter, me);
  const alreadyMentioned = points.join(" ");
  for (const l of loose.slice(0, 2)) {
    if ((VALUE[l.piece[1]] ?? 0) < 300) continue; // minor pieces and up
    if (alreadyMentioned.includes(l.square)) continue;
    points.push(
      `Your ${describe(l.piece, l.square)} is left attacked by a ${NAME[l.attacker[1]]} and insufficiently defended.`,
    );
  }

  /* --- 4. Material the move gave away outright --- */
  const materialSwing =
    (me === "w" ? 1 : -1) * (material(m.fenAfter) - material(m.fenBefore));
  if (materialSwing <= -300 && points.length === 0) {
    points.push(
      `${m.san} gives up ${Math.round(Math.abs(materialSwing) / 100)} points of material without compensation.`,
    );
  }

  /* --- 5. Free material that was on offer instead --- */
  if (m.bestSan && m.bestSan.includes("x")) {
    const bestMove = tryMove(m.fenBefore, m.bestSan);
    if (bestMove) {
      const target = pieceAt(m.fenBefore, bestMove.to);
      if (target && target[0] === foe && (VALUE[target[1]] ?? 0) >= 300) {
        const defended = attackersOf(m.fenBefore, bestMove.to, foe).length > 0;
        points.push(
          defended
            ? `${m.bestSan} was available, winning material through the exchange on ${bestMove.to}.`
            : `The ${describe(target, bestMove.to)} was hanging — ${m.bestSan} simply takes it.`,
        );
      }
    }
  }

  /* --- 6. King safety --- */
  if (points.length < 2 && inCheck(m.fenAfter)) {
    points.push("The move also walks into a check, costing you time to answer it.");
  }

  /* --- 7. Fall back to the evaluation swing --- */
  if (points.length === 0) {
    points.push(
      `The evaluation moves from ${povScore(m.cpBefore, m.color)} to ${povScore(m.cpAfter, m.color)} — from ${standing(
        m.cpBefore,
        me,
      )} to ${standing(m.cpAfter, me)} for ${sideName(me)}.`,
    );
    if (m.playedPv.length > 1) {
      points.push(
        `The engine expects ${narrate(m.fenAfter, m.playedPv)} from here.`,
      );
    }
  }

  /* --- The improvement --- */
  let betterLine: string | null = null;
  if (m.bestSan && m.bestSan !== m.san) {
    const line =
      m.bestPv.length > 1
        ? narrate(m.fenBefore, m.bestPv)
        : `${moveNumberOf(m.fenBefore)}${turnOf(m.fenBefore) === "w" ? "." : "..."}${m.bestSan}`;
    betterLine = `${line} — holding at ${povScore(
      // The best move's own resulting eval is the position-before eval.
      m.cpBefore,
      me,
    )}.`;
  }

  return {
    headline: headlineFor(m),
    points,
    betterLine,
    takeaway: takeawayFor(m, points),
  };
}

function headlineFor(m: MoveReview): string {
  const swing = Math.round(m.winDrop);
  switch (m.classification) {
    case "blunder":
      return `Blunder — ${m.san} throws away ${swing}% of your winning chances.`;
    case "mistake":
      return `Mistake — ${m.san} costs you ${swing}% of your winning chances.`;
    default:
      return `Inaccuracy — ${m.san} gives up a little ground (${swing}%).`;
  }
}

function takeawayFor(m: MoveReview, points: string[]): string | null {
  const text = points.join(" ").toLowerCase();
  if (text.includes("mate in")) {
    return "Before you move, check every forcing option — checks, captures, threats — for both sides.";
  }
  if (text.includes("hanging") || text.includes("no defender") || text.includes("insufficiently defended")) {
    return "After choosing a move, scan your own pieces: is anything left undefended?";
  }
  if (text.includes("hits two things at once")) {
    return "Watch for squares where one enemy piece can attack two of yours — especially knights and queens.";
  }
  if (m.index < 20) {
    return "In the opening, develop a new piece, control the centre, and get the king safe before starting anything sharp.";
  }
  if (m.winBefore >= 65) {
    return "You were better here — simplify and keep it safe rather than looking for more.";
  }
  return "Slow down at critical moments: ask what your opponent threatens before you commit.";
}

/** Short label for a review row, e.g. "Blunder · −2.3". */
export function moveSubtitle(m: MoveReview): string {
  if (m.book) return "Theory";
  if (m.forced) return "Forced";
  if (m.cpLoss === 0) return "No loss";
  return `−${(m.cpLoss / 100).toFixed(1)} pawns`;
}
