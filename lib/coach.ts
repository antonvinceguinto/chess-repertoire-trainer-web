import {
  attackersOf,
  formatMoveSequence,
  inCheck,
  pieceAt,
  piecesOn,
  staticExchangeGain,
  tryMove,
} from "./chess";
import type { MoveReview } from "./review";
import type { LineMove, Turn } from "./types";

/**
 * The coach: a character who talks you through every move of a reviewed game —
 * yours and your opponent's, brilliancies as well as blunders.
 *
 * Everything here is deterministic and offline — the app has no backend and
 * calls no language model. Instead we read the actual position with chess.js
 * and the engine's own lines, and describe what they say: what hangs, what the
 * refutation is, what was missed, and what to play instead. Rules only fire
 * when the position really supports them, so the advice is never invented.
 *
 * Advice comes back as *segments* rather than finished strings, because every
 * move the coach names is playable: a {@link CoachSegment} of kind "move"
 * carries the line and the half-move it forks from, so the UI renders it as a
 * link that puts the suggestion on the board as a side line off the reviewed
 * game — always one step from being taken back.
 */

/* ---------------- What the coach says ---------------- */

/** How the coach feels about the move; drives the avatar and the card's tone. */
export type CoachMood =
  | "celebrate"
  | "happy"
  | "neutral"
  | "concerned"
  | "alarmed";

/**
 * One piece of a sentence. A "move" segment is the clickable part: activating it
 * plays `sans` onto the board starting from half-move `fromPly` of the reviewed
 * game, which forks a side line that can always be stepped back out of.
 */
export type CoachSegment =
  | { kind: "text"; text: string }
  | {
      kind: "move";
      /** What the reader sees, e.g. "Qd2" or "15.Nxe5 Qxe5 16.Bf4". */
      text: string;
      /** Tooltip — the whole line this plays, in readable notation. */
      hint: string;
      sans: string[];
      fromPly: number;
    };

/** A sentence: prose with playable moves embedded in it. */
export type CoachPoint = CoachSegment[];

/** The highlighted call-out under the explanation. */
export interface CoachBox {
  /** e.g. "Play instead", "Punish it with", "How it continues". */
  label: string;
  segments: CoachPoint;
  tone: "good" | "info";
}

export interface CoachAdvice {
  mood: CoachMood;
  /** One-line verdict in the coach's voice. */
  headline: string;
  /** The concrete observations behind it. */
  points: CoachPoint[];
  /** The improvement, the punishment, or the follow-up — null when there's none. */
  box: CoachBox | null;
  /** A short principle to carry into the next game. */
  takeaway: string | null;
}

/**
 * Who the coach is addressing, so one set of rules reads correctly for either
 * side of the board. "You" and "they" conjugate identically, which is what makes
 * the symmetry possible; only "your opponent" needs the third-person `v`.
 */
interface Voice {
  /** Sentence-initial subject: "You" / "They" / "Your opponent". */
  S: string;
  /** Mid-sentence subject: "you" / "they" / "your opponent". */
  s: string;
  /** Object form, for "better for them": "you" / "them" / "your opponent". */
  o: string;
  /** Possessive: "your" / "their". */
  p: string;
  /** Third-person verb ending for this subject: "" or "s". */
  v: string;
}

const YOU: Voice = { S: "You", s: "you", o: "you", p: "your", v: "" };
const THEY: Voice = { S: "They", s: "they", o: "them", p: "their", v: "" };
const OPPONENT: Voice = {
  S: "Your opponent",
  s: "your opponent",
  o: "your opponent",
  p: "their",
  v: "s",
};

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

interface LoosePiece {
  square: string;
  piece: string;
  /** The cheapest enemy piece hitting it — the one that would take it. */
  attacker: { square: string; piece: string };
}

/**
 * A defended piece only counts as loose when its attacker is *meaningfully*
 * cheaper. A knight hitting a defended bishop is an even trade, not a win, and
 * calling it "insufficiently defended" is the kind of false alarm that makes
 * the whole card untrustworthy.
 */
const TRADE_MARGIN = 60;

/**
 * Pieces of `side` that the opponent can profitably take right now: either
 * undefended, or attacked by something clearly cheaper than they are.
 */
function loosePieces(fen: string, side: Turn): LoosePiece[] {
  const foe = other(side);
  const out: LoosePiece[] = [];
  for (const { square, piece } of piecesOn(fen)) {
    if (piece[0] !== side || piece[1] === "k") continue;
    const attacker = cheapestAttacker(fen, square, foe);
    if (!attacker) continue;
    const defended = attackersOf(fen, square, side).length > 0;
    const value = VALUE[piece[1]] ?? 0;
    if (!defended || attacker.value + TRADE_MARGIN <= value) {
      out.push({
        square,
        piece,
        attacker: { square: attacker.square, piece: attacker.piece },
      });
    }
  }
  // Report the most valuable loss first.
  return out.sort((a, b) => (VALUE[b.piece[1]] ?? 0) - (VALUE[a.piece[1]] ?? 0));
}

/**
 * Valuable targets a piece standing on `from` attacks — two or more means a
 * fork or double attack. The king is deliberately excluded: it is attacked on
 * every checking move, and counting it would turn every check into a "fork".
 * Callers that care about the check say so themselves.
 */
function forkTargets(
  fen: string,
  from: string,
  victim: Turn,
): { square: string; piece: string }[] {
  return piecesOn(fen).filter(({ square, piece }) => {
    if (piece[0] !== victim || piece[1] === "k") return false;
    if ((VALUE[piece[1]] ?? 0) < 320) return false; // pawns aren't a fork
    return attackersOf(fen, square, other(victim)).includes(from);
  });
}

/**
 * What a move captured, and the square the taken piece stood on. For en passant
 * that is not the destination, so resolve it from the pawn's own file and rank.
 */
function capturedBy(
  fenBefore: string,
  mv: LineMove,
): { piece: string; square: string } | null {
  const direct = pieceAt(fenBefore, mv.to);
  if (direct) return { piece: direct, square: mv.to };
  const mover = pieceAt(fenBefore, mv.from);
  if (mover?.[1] === "p" && mv.from[0] !== mv.to[0]) {
    const square = `${mv.to[0]}${mv.from[1]}`;
    const piece = pieceAt(fenBefore, square);
    if (piece) return { piece, square };
  }
  return null;
}

/** Mate distance from `side`'s point of view: +n = they mate, -n = they get mated. */
function moverMate(mateWhite: number | null, side: Turn): number | null {
  if (mateWhite == null) return null;
  return side === "w" ? mateWhite : -mateWhite;
}

/**
 * "+1.35" style score from the mover's perspective. Stockfish folds a mate into
 * a six-figure centipawn score, which would print as "+1000.0" — say the plain
 * thing instead and let {@link evalText} name the mate where one is known.
 */
function povScore(cpWhite: number, side: Turn): string {
  const cp = side === "w" ? cpWhite : -cpWhite;
  if (cp >= 5000) return "completely winning";
  if (cp <= -5000) return "completely lost";
  const pawns = cp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

/** The score as the coach quotes it, naming a forced mate rather than scoring it. */
function evalText(
  cpWhite: number,
  mateWhite: number | null,
  side: Turn,
): string {
  const mate = moverMate(mateWhite, side);
  if (mate != null && mate !== 0) {
    return mate > 0 ? `mate in ${mate}` : `mated in ${-mate}`;
  }
  return povScore(cpWhite, side);
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

/** Centipawns as a readable point count: 300 → "3", 180 → "1.8". */
function points(cp: number): string {
  const p = cp / 100;
  return Number.isInteger(p) ? `${p}` : p.toFixed(1);
}

/* ---------------- Building sentences ---------------- */

const text = (s: string): CoachSegment => ({ kind: "text", text: s });

/** Trim a SAN line to the prefix that is actually legal from `fen`. */
function legalPrefix(fen: string, sans: string[], max: number): string[] {
  let f = fen;
  const out: string[] = [];
  for (const san of sans.slice(0, max)) {
    const mv = tryMove(f, san);
    if (!mv) break;
    out.push(san);
    f = mv.fen;
  }
  return out;
}

/**
 * A clickable reference to a line, or null when it isn't playable from `fen` —
 * a dead link is indistinguishable from a live one, so we never build one.
 *
 * `fromPly` is the reviewed game's half-move the line forks from: `m.index` for
 * a move played *instead* of the game's, `m.index + 1` for anything after it.
 */
function ref(
  fen: string,
  fromPly: number,
  sans: string[],
  opts: { label?: string; max?: number } = {},
): CoachSegment | null {
  const legal = legalPrefix(fen, sans, opts.max ?? 1);
  if (legal.length === 0) return null;
  const written = formatMoveSequence(fen, legal);
  return {
    kind: "move",
    // A lone move reads better bare ("play Qd2") than numbered ("play 15.Qd2");
    // a real line needs its numbers to be followable.
    text: opts.label ?? (legal.length === 1 ? legal[0] : written),
    hint: `Play ${written} on the board`,
    sans: legal,
    fromPly,
  };
}

/** A clickable ref for one from/to move (its SAN is derived), or null. */
function squareRef(
  fen: string,
  fromPly: number,
  from: string,
  to: string,
): CoachSegment | null {
  const mv =
    tryMove(fen, { from, to }) ?? tryMove(fen, { from, to, promotion: "q" });
  return mv ? ref(fen, fromPly, [mv.san]) : null;
}

/** A ref if the line is playable, otherwise the same words as plain text. */
function refOr(fallback: string, seg: CoachSegment | null): CoachSegment {
  return seg ?? text(fallback);
}

/** Anything a sentence can be built from — nested fragments included. */
type SayPart = string | CoachSegment | null | false | undefined | SayPart[];

/** Assemble a sentence from strings, refs and nested fragments. */
function say(...parts: SayPart[]): CoachPoint {
  const out: CoachSegment[] = [];
  const add = (part: SayPart): void => {
    if (!part) return;
    if (Array.isArray(part)) {
      part.forEach(add);
      return;
    }
    const seg = typeof part === "string" ? text(part) : part;
    if (seg.kind === "text" && seg.text === "") return;
    const last = out[out.length - 1];
    // Merge neighbouring text so the rendered sentence has no seams.
    if (seg.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = text(last.text + seg.text);
    } else {
      out.push(seg);
    }
  };
  parts.forEach(add);
  return out;
}

/** The plain words of a set of sentences, for keyword-driven takeaways. */
function wordsOf(sentences: CoachPoint[]): string {
  return sentences
    .flat()
    .map((s) => s.text)
    .join(" ")
    .toLowerCase();
}

/* ---------------- Why a move is the move ---------------- */

interface WhyInput {
  /** Position the recommended move is played from. */
  fenBefore: string;
  move: LineMove;
  /** Side playing it. */
  mover: Turn;
  /** Mate available in `fenBefore`, from White's perspective. */
  mateBefore: number | null;
  /** Mate on the board after the move being improved on, White's perspective. */
  mateInstead: number | null;
  /** Voice of the side playing the recommended move. */
  V: Voice;
  /** Voice of the side facing it. */
  O: Voice;
}

/**
 * The reason the recommended move is the move, in one clause ("it adds a
 * defender to g5"). Every branch is checked against the real board first, and
 * the whole thing returns null rather than reaching for a platitude.
 */
function whyClause(input: WhyInput): string | null {
  const { fenBefore, move, mover, V, O } = input;
  const foe = other(mover);
  const after = move.fen;

  // 1. It mates, or it stops the mate the other move allowed.
  const mate = moverMate(input.mateBefore, mover);
  if (mate != null && mate > 0) return `it forces mate in ${mate}`;
  const mateInstead = moverMate(input.mateInstead, mover);
  if (mateInstead != null && mateInstead < 0 && (mate == null || mate > 0)) {
    return "it stops the mate";
  }

  // 2. It wins material outright. A *defended* piece is only a win if the whole
  //    exchange comes out ahead, so ask the board rather than assuming.
  const taken = capturedBy(fenBefore, move);
  if (taken && taken.piece[0] === foe && (VALUE[taken.piece[1]] ?? 0) >= 300) {
    if (attackersOf(fenBefore, taken.square, foe).length === 0) {
      return `it simply takes the ${describe(taken.piece, taken.square)}`;
    }
    if (staticExchangeGain(fenBefore, move.to) > 0) {
      return `it wins material through the exchange on ${taken.square}`;
    }
  }

  // 3. It rescues something that was hanging — the commonest reason of all.
  const looseAfter = new Set(loosePieces(after, mover).map((l) => l.square));
  for (const l of loosePieces(fenBefore, mover)) {
    if (l.square === move.from) {
      // The piece itself stepped out of danger, and not into more of it.
      if (!looseAfter.has(move.to)) {
        return `it gets ${V.p} ${NAME[l.piece[1]]} off ${l.square} before it drops`;
      }
      continue;
    }
    if (looseAfter.has(l.square)) continue; // still hanging — no credit
    if (attackersOf(after, l.square, mover).length >
        attackersOf(fenBefore, l.square, mover).length) {
      return `it adds a defender to ${l.square}`;
    }
    // The attacker is gone — usually because this move took it, which leaves our
    // own piece standing on that square rather than leaving it empty.
    if (pieceAt(after, l.attacker.square)?.[0] !== foe) {
      return `it removes the ${NAME[l.attacker.piece[1]]} that was hitting ${l.square}`;
    }
    // Something else fixed it — a block, a pin, a counter-threat. Say what is
    // observably true (it is no longer takeable) rather than guessing which.
    return `it takes the heat off ${V.p} ${describe(l.piece, l.square)}`;
  }

  // 4. It makes threats of its own.
  const targets = forkTargets(after, move.to, foe);
  const check = inCheck(after);
  if (targets.length >= 2) {
    return `it hits ${O.p} ${describe(
      targets[0].piece,
      targets[0].square,
    )} and ${describe(targets[1].piece, targets[1].square)} at once`;
  }
  if (targets.length === 1) {
    const hit = `${O.p} ${describe(targets[0].piece, targets[0].square)}`;
    return check ? `it checks and hits ${hit}` : `it goes after ${hit}`;
  }
  if (move.san.includes("=")) return "it promotes the pawn";
  if (check) return `it checks first, so ${O.s} never get${O.v} the time`;

  return null;
}

/* ---------------- Per-class advice ---------------- */

/** The engine's continuation from the position this move reached. */
function followUpBox(m: MoveReview, label = "How it continues"): CoachBox | null {
  const seg = ref(m.fenAfter, m.index + 1, m.playedPv, { max: 4 });
  return seg ? { label, segments: say(seg, "."), tone: "info" } : null;
}

function checkmateAdvice(m: MoveReview, isUser: boolean, V: Voice): CoachAdvice {
  return {
    mood: isUser ? "celebrate" : "alarmed",
    headline: isUser ? "Checkmate — that's the game." : "Checkmate. That's the game.",
    points: [say(`${m.san} ends it — ${V.s} leave no legal reply.`)],
    box: null,
    takeaway: null,
  };
}

function bookAdvice(m: MoveReview, V: Voice): CoachAdvice {
  return {
    mood: "neutral",
    headline: "Book move — still known theory.",
    points: [
      say(
        `${m.san} is part of established opening theory, so there's nothing to fix here — `,
        `${V.s} are following a well-trodden path.`,
      ),
    ],
    box: null,
    takeaway: null,
  };
}

function forcedAdvice(m: MoveReview, V: Voice): CoachAdvice {
  return {
    mood: "neutral",
    headline: "Forced — there was nothing else legal.",
    points: [
      say(`${m.san} was the only legal move, so there's nothing to grade.`),
      say(
        `The position is ${standing(m.cpAfter, m.color)} for ${V.o} here (`,
        evalText(m.cpAfter, m.mateAfter, m.color),
        ").",
      ),
    ],
    box: followUpBox(m),
    takeaway: null,
  };
}

function brilliantAdvice(
  m: MoveReview,
  isUser: boolean,
  V: Voice,
  O: Voice,
): CoachAdvice {
  const sentences: CoachPoint[] = [
    say(
      `${m.san} hands over material`,
      m.sacrifice > 0 ? ` — about ${points(m.sacrifice)} points of it — ` : " — ",
      `and the engine still has ${V.o} at `,
      evalText(m.cpAfter, m.mateAfter, m.color),
      ".",
    ),
  ];

  // The engine's line from here belongs to the *other* side first: [0] is the
  // reply to the sacrifice, [1] is the follow-up that justifies it.
  const [reply, point] = m.playedPv;
  if (reply && point) {
    sentences.push(
      say(
        "If ",
        refOr(reply, ref(m.fenAfter, m.index + 1, [reply])),
        " follows, ",
        refOr(
          point,
          ref(m.fenAfter, m.index + 1, [reply, point], { max: 2, label: point }),
        ),
        " is the point.",
      ),
    );
  } else if (reply) {
    sentences.push(
      say(
        `${O.S} still ha${O.v ? "s" : "ve"} to answer it — `,
        refOr(reply, ref(m.fenAfter, m.index + 1, [reply])),
        " is the engine's try.",
      ),
    );
  }

  return {
    mood: isUser ? "celebrate" : "concerned",
    headline: isUser
      ? "Brilliant! A real sacrifice, and it holds up."
      : "Careful — that sacrifice is sound.",
    points: sentences,
    box: followUpBox(m, "How it plays out"),
    takeaway: isUser
      ? "Sacrifices work when you can calculate to something concrete — count the line to the end before you commit."
      : "When your opponent gives material away, find the follow-up before you accept.",
  };
}

function greatAdvice(m: MoveReview, isUser: boolean, V: Voice): CoachAdvice {
  const sentences: CoachPoint[] = [
    say(
      `${m.san} was the single move that held this position together — everything `,
      "else gave up real ground.",
    ),
  ];

  if (m.secondSan && m.secondSan !== m.san) {
    sentences.push(
      say(
        "The runner-up was ",
        refOr(m.secondSan, ref(m.fenBefore, m.index, [m.secondSan])),
        m.secondCpWhite != null
          ? `, which only leaves ${V.o} ${standing(m.secondCpWhite, m.color)} — play it out and see.`
          : ", and it was already noticeably worse — play it out and see.",
      ),
    );
  }

  return {
    mood: isUser ? "celebrate" : "neutral",
    headline: isUser
      ? "Great move — you found the only one that works."
      : "They found the only move here.",
    points: sentences,
    box: followUpBox(m),
    takeaway: isUser
      ? "Trust your calculation when only one move works — that's the move."
      : "They had exactly one good move and found it — work out what made every other try fail.",
  };
}

function bestAdvice(m: MoveReview, isUser: boolean, V: Voice): CoachAdvice {
  return {
    mood: isUser ? "happy" : "neutral",
    headline: isUser
      ? "Best move — that's Stockfish's pick too."
      : "That's the engine's move as well.",
    points: [
      say(
        `${m.san} keeps the position ${standing(m.cpAfter, m.color)} for ${V.o} (`,
        evalText(m.cpAfter, m.mateAfter, m.color),
        ").",
      ),
    ],
    box: followUpBox(m),
    takeaway: null,
  };
}

function solidAdvice(m: MoveReview, isUser: boolean, V: Voice): CoachAdvice {
  const sentences: CoachPoint[] = [
    say(
      `The position stays ${standing(m.cpAfter, m.color)} for ${V.o} (`,
      evalText(m.cpAfter, m.mateAfter, m.color),
      ").",
    ),
  ];
  if (m.bestSan && m.bestSan !== m.san) {
    sentences.push(
      say(
        "The engine's slight preference was ",
        refOr(m.bestSan, ref(m.fenBefore, m.index, m.bestPv)),
        ", but the difference is negligible — try it if you're curious.",
      ),
    );
  }
  return {
    mood: isUser ? "happy" : "neutral",
    headline:
      m.classification === "excellent"
        ? "Excellent — as good as the top choice in practice."
        : "Solid — nothing given away.",
    points: sentences,
    box: followUpBox(m),
    takeaway: null,
  };
}

/**
 * A slip of your own: what it allowed, what it missed, and what to play instead.
 * Each observation is checked against the real position before it is made.
 */
function yourSlipAdvice(m: MoveReview, V: Voice, O: Voice): CoachAdvice {
  const me = m.color;
  const foe = other(me);
  const sentences: CoachPoint[] = [];

  const mateBefore = moverMate(m.mateBefore, me);
  const mateAfter = moverMate(m.mateAfter, me);

  /* --- 1. Mate that was thrown away, or handed over --- */
  if (mateBefore != null && mateBefore > 0 && (mateAfter == null || mateAfter <= 0)) {
    sentences.push(
      say(
        `You had a forced mate in ${mateBefore}`,
        m.bestSan && [
          " starting with ",
          refOr(m.bestSan, ref(m.fenBefore, m.index, m.bestPv, { max: 6 })),
        ],
        `, and ${m.san} lets it slip.`,
      ),
    );
  }
  if (mateAfter != null && mateAfter < 0) {
    const mateIn = Math.abs(mateAfter);
    sentences.push(
      say(
        `${m.san} allows `,
        refOr(
          `mate in ${mateIn}`,
          ref(m.fenAfter, m.index + 1, m.playedPv, {
            max: mateIn * 2,
            label: `mate in ${mateIn}`,
          }),
        ),
        ".",
      ),
    );
  }

  /* --- 2. What the opponent's refutation actually does --- */
  const refutation = m.playedPv[0];
  if (refutation) {
    const replyMove = tryMove(m.fenAfter, refutation);
    if (replyMove) {
      const link = refOr(refutation, ref(m.fenAfter, m.index + 1, [refutation]));
      const captured = capturedBy(m.fenAfter, replyMove);
      if (captured && captured.piece[0] === me) {
        const defenders = attackersOf(m.fenAfter, replyMove.to, me).length;
        sentences.push(
          say(
            `${O.S} replies `,
            link,
            defenders === 0
              ? `, winning your ${describe(captured.piece, captured.square)} for nothing — it has no defender.`
              : `, and your ${describe(captured.piece, captured.square)} can't be held profitably.`,
          ),
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
        sentences.push(
          say(
            link,
            ` hits two things at once${givesCheck ? " with check" : ""} — your ${named}.`,
          ),
        );
      } else if (givesCheck && sentences.length === 0) {
        sentences.push(say(link, " comes with check, and you have no good answer."));
      }
    }
  }

  /* --- 3. Pieces left hanging by the move itself --- */
  const mentioned = wordsOf(sentences);
  for (const l of loosePieces(m.fenAfter, me).slice(0, 2)) {
    if ((VALUE[l.piece[1]] ?? 0) < 300) continue; // minor pieces and up
    if (mentioned.includes(l.square)) continue;
    // The capture can be illegal even when the piece looks loose (a pinned
    // attacker, say) — then the observation stands but the invitation doesn't.
    const capture = squareRef(m.fenAfter, m.index + 1, l.attacker.square, l.square);
    sentences.push(
      say(
        `Your ${describe(l.piece, l.square)} is attacked by a ${
          NAME[l.attacker.piece[1]]
        } and insufficiently defended`,
        capture ? [" — ", capture, " takes it."] : ".",
      ),
    );
  }

  /* --- 4. Free material that was on offer instead --- */
  if (m.bestSan && m.bestSan.includes("x")) {
    const bestMove = tryMove(m.fenBefore, m.bestSan);
    if (bestMove) {
      const target = capturedBy(m.fenBefore, bestMove);
      if (target && target.piece[0] === foe && (VALUE[target.piece[1]] ?? 0) >= 300) {
        const defended = attackersOf(m.fenBefore, target.square, foe).length > 0;
        const link = refOr(m.bestSan, ref(m.fenBefore, m.index, [m.bestSan]));
        if (!defended) {
          sentences.push(
            say(
              `The ${describe(target.piece, target.square)} was hanging — `,
              link,
              " simply takes it.",
            ),
          );
        } else if (staticExchangeGain(m.fenBefore, bestMove.to) > 0) {
          sentences.push(
            say(link, ` was available, winning material on ${target.square}.`),
          );
        }
      }
    }
  }

  /* --- 5. A check that didn't buy anything --- */
  // `fenAfter` has the opponent to move, so being in check there means this
  // move *gave* check — it can never mean the mover walked into one.
  if (sentences.length < 2 && inCheck(m.fenAfter)) {
    sentences.push(
      say(
        `It does come with check, but ${O.s} answer${O.v} it and the problem is still there.`,
      ),
    );
  }

  /* --- 6. Fall back to the evaluation swing --- */
  if (sentences.length === 0) {
    const was = standing(m.cpBefore, me);
    const now = standing(m.cpAfter, me);
    const swing = `${evalText(m.cpBefore, m.mateBefore, me)} to ${evalText(
      m.cpAfter,
      m.mateAfter,
      me,
    )}`;
    sentences.push(
      say(
        was === now
          ? `The evaluation slides from ${swing} — still ${now} for ${sideName(me)}.`
          : `The evaluation moves from ${swing} — from ${was} to ${now} for ${sideName(me)}.`,
      ),
    );
    if (m.playedPv.length > 1) {
      sentences.push(
        say(
          "The engine expects ",
          refOr(
            m.playedPv[0],
            ref(m.fenAfter, m.index + 1, m.playedPv, { max: 4 }),
          ),
          " from here.",
        ),
      );
    }
  }

  const shown = sentences.slice(0, 4);
  return {
    mood: m.classification === "blunder" ? "alarmed" : "concerned",
    headline: headlineFor(m),
    points: shown,
    box: betterBox(m, V, O),
    takeaway: takeawayFor(m, wordsOf(shown)),
  };
}

/** The opponent slipped: name the punishment, and say whether it was taken. */
function theirSlipAdvice(
  m: MoveReview,
  next: MoveReview | null,
  V: Voice,
  O: Voice,
): CoachAdvice {
  const sentences: CoachPoint[] = [];
  const swing = Math.round(m.winDrop);
  const punish = m.playedPv[0];

  sentences.push(say(`${m.san} swings the position ${swing}% ${O.p} way.`));
  if (m.bestSan && m.bestSan !== m.san) {
    sentences.push(
      say(
        `${V.S} should have played `,
        refOr(m.bestSan, ref(m.fenBefore, m.index, [m.bestSan])),
        ".",
      ),
    );
  }

  // A mate for the side to move now, i.e. for whoever faces this move.
  const mateFor = moverMate(m.mateAfter, other(m.color));
  if (mateFor != null && mateFor > 0) {
    sentences.push(
      say(
        "There's a forced ",
        refOr(
          `mate in ${mateFor}`,
          ref(m.fenAfter, m.index + 1, m.playedPv, {
            max: mateFor * 2,
            label: `mate in ${mateFor}`,
          }),
        ),
        " on the board now.",
      ),
    );
  }

  // What the punishment actually achieves, read off the board.
  const punishMove = punish ? tryMove(m.fenAfter, punish) : null;
  if (punishMove) {
    const why = whyClause({
      fenBefore: m.fenAfter,
      move: punishMove,
      mover: other(m.color),
      mateBefore: m.mateAfter,
      mateInstead: null,
      V: O,
      O: V,
    });
    if (why) sentences.push(say(`${punish} works because `, why, "."));
  }

  // Did the punishment actually land in the game?
  if (next && punish && next.san !== punish) {
    sentences.push(say(`In the game ${O.s} answered ${next.san} instead.`));
  }

  return {
    mood: m.classification === "blunder" ? "celebrate" : "happy",
    headline:
      m.classification === "blunder"
        ? "They blundered — there's something here."
        : m.classification === "mistake"
          ? "A mistake from them — the door is open."
          : "A small slip from them.",
    points: sentences.slice(0, 4),
    box: punish
      ? {
          label: "Punish it with",
          segments: say(
            refOr(punish, ref(m.fenAfter, m.index + 1, m.playedPv, { max: 4 })),
            ".",
          ),
          tone: "good",
        }
      : null,
    takeaway:
      m.classification === "blunder"
        ? "Every time your opponent moves, ask what it stopped defending."
        : null,
  };
}

/** The "play this instead" call-out, with both the move and its line playable. */
function betterBox(m: MoveReview, V: Voice, O: Voice): CoachBox | null {
  if (!m.bestSan || m.bestSan === m.san) return null;
  const best = tryMove(m.fenBefore, m.bestSan);
  const move = refOr(m.bestSan, ref(m.fenBefore, m.index, [m.bestSan]));
  const why = best
    ? whyClause({
        fenBefore: m.fenBefore,
        move: best,
        mover: m.color,
        mateBefore: m.mateBefore,
        mateInstead: m.mateAfter,
        V,
        O,
      })
    : null;
  const line =
    m.bestPv.length > 1 ? ref(m.fenBefore, m.index, m.bestPv, { max: 4 }) : null;
  // The best move's own resulting eval is the position-before eval. Quoting a
  // number is pointless when a mate is involved — the clause already said so.
  const holds = m.mateBefore == null ? povScore(m.cpBefore, m.color) : null;

  return {
    label: "Play instead",
    tone: "good",
    segments: say(
      "Play ",
      move,
      why ? ` — ${why}` : "",
      holds ? `. That holds at ${holds}.` : ".",
      line && [" The line runs ", line, "."],
    ),
  };
}

/* ---------------- The entry point ---------------- */

export interface CoachContext {
  /** Whether the move belongs to the player whose game this is. */
  isUser: boolean;
  /** The reply that followed in the game, when there was one. */
  next?: MoveReview | null;
}

/**
 * Explain one half-move. Every classification gets a real answer — the coach
 * talks about brilliancies and book moves as readily as blunders, and about
 * both sides of the board.
 */
export function explainMove(m: MoveReview, ctx: CoachContext): CoachAdvice {
  const { isUser, next = null } = ctx;
  const V = isUser ? YOU : THEY;
  const O = isUser ? OPPONENT : YOU;

  // Mate ends the argument: no "best move" framing beats saying it's over.
  if (m.san.includes("#")) return checkmateAdvice(m, isUser, V);
  if (m.book) return bookAdvice(m, V);
  if (m.forced) return forcedAdvice(m, V);

  switch (m.classification) {
    case "brilliant":
      return brilliantAdvice(m, isUser, V, O);
    case "great":
      return greatAdvice(m, isUser, V);
    case "best":
      return bestAdvice(m, isUser, V);
    case "excellent":
    case "good":
      return solidAdvice(m, isUser, V);
    default:
      return isUser ? yourSlipAdvice(m, V, O) : theirSlipAdvice(m, next, V, O);
  }
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

function takeawayFor(m: MoveReview, words: string): string | null {
  if (words.includes("mate in")) {
    return "Before you move, check every forcing option — checks, captures, threats — for both sides.";
  }
  if (
    words.includes("hanging") ||
    words.includes("no defender") ||
    words.includes("insufficiently defended")
  ) {
    return "After choosing a move, scan your own pieces: is anything left undefended?";
  }
  if (words.includes("hits two things at once")) {
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
