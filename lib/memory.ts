import { START_FEN, fenKey, turnOf } from "./chess";
import type { Book } from "./book";
import type { Color, Repertoire, RepNode } from "./types";

/**
 * Spaced-repetition memory over repertoire *positions*.
 *
 * Train mode drills root-to-leaf lines, always from move 1, and forgets
 * everything when the tab closes — so the first move of every line gets
 * practised dozens of times and the move on ply 12 gets practised once. This
 * module inverts that: one card per decision point, scheduled by how well you
 * actually remember it, persisted across sessions.
 *
 * Cards are keyed on the position (normalised FEN), not on the line, so
 * transpositions collapse into a single thing to remember and every one of your
 * saved replies there counts as correct.
 */

/* ---------------- Cards ---------------- */

/** One thing to remember: a position of yours, and the move(s) you play in it. */
export interface RecallCard {
  /** Normalised FEN of the position you have to move in — the card's identity. */
  key: string;
  /** Full FEN of that position. */
  fen: string;
  /** Every reply you have saved here; any of them counts as correct. */
  answers: string[];
  /** Shortest SAN path from the start that reaches the position. */
  lead: string[];
  /** Chance of actually reaching it (book move-shares along the path). */
  importance: number;
}

const bookShares = (book: Book | null, fen: string) =>
  book ? book.moves[fenKey(fen)] ?? [] : [];

/**
 * Every position in the repertoire where it's your move and you have an answer
 * saved, de-duplicated by position. `importance` mirrors `importantLines`: the
 * product of the opponent's book move-shares along the way, i.e. how likely you
 * are to actually face it, so the same thoroughness cutoff applies here.
 */
export function collectCards(rep: Repertoire, book: Book | null): RecallCard[] {
  const userChar = rep.color === "white" ? "w" : "b";
  const byKey = new Map<string, RecallCard>();

  const visit = (
    nodes: RepNode[],
    fen: string,
    lead: string[],
    reach: number,
  ) => {
    const side = turnOf(fen);

    if (side === userChar && nodes.length > 0) {
      const key = fenKey(fen);
      const seen = byKey.get(key);
      if (!seen) {
        byKey.set(key, {
          key,
          fen,
          answers: nodes.map((n) => n.san),
          lead,
          importance: reach,
        });
      } else {
        // A transposition: same question, extra answers and possibly a shorter
        // way in. Keep the likeliest reach so the cutoff doesn't drop it.
        for (const n of nodes) {
          if (!seen.answers.includes(n.san)) seen.answers.push(n.san);
        }
        seen.importance = Math.max(seen.importance, reach);
        if (lead.length < seen.lead.length) {
          seen.lead = lead;
          seen.fen = fen;
        }
      }
    }

    const shares = side !== userChar ? bookShares(book, fen) : [];
    const total = shares.reduce((sum, m) => sum + m[1], 0) || 1;
    for (const node of nodes) {
      let childReach = reach;
      if (side !== userChar) {
        const entry = shares.find((m) => m[0] === node.san);
        childReach = reach * (entry ? entry[1] / total : 1 / (total + 1));
      }
      visit(node.children, node.fen, [...lead, node.san], childReach);
    }
  };

  visit(rep.root, START_FEN, [], 1);
  return [...byKey.values()];
}

/* ---------------- Session ---------------- */

export type RecallStatus = "prompt" | "wrong" | "solved" | "done" | "empty";

/**
 * How much of the answer has been given away. Each rung caps the grade, so a
 * card you had to be walked to is scheduled as one you don't know yet.
 */
export type HintLevel = 0 | 1 | 2 | 3;

export interface RecallSession {
  repId: string;
  color: Color;
  /** Cards for this sitting; a forgotten card is re-inserted a few places on. */
  queue: RecallCard[];
  index: number;
  /** Distinct cards the sitting set out to cover (the queue grows past this). */
  planned: number;
  status: RecallStatus;
  hint: HintLevel;
  /** Whether the current card has already been answered wrong or fully revealed. */
  failed: boolean;
  /** SAN of the last wrong attempt, shown as feedback. */
  lastWrong: string | null;
  /** Grade the card just resolved earned, and the days it bought. */
  grade: RecallGrade | null;
  nextInterval: number | null;
  /** Answers given this sitting — a card you forgot and re-answered counts twice. */
  recalled: number;
  forgotten: number;
  /** True when the schedule had nothing due and this is extra practice. */
  extra: boolean;
}

/* ---------------- Scheduling ---------------- */

/**
 * How the answer came out. Derived automatically from the drill — the user
 * never self-reports, which is where most SRS chess tools lose people.
 */
export type RecallGrade = "again" | "hard" | "good";

export interface CardState {
  /** Successful reviews in a row (0 = new, or just forgotten). */
  reps: number;
  /** Days scheduled at the last review. */
  interval: number;
  /** SM-2 ease factor. */
  ease: number;
  /** Epoch ms when the card comes back. */
  due: number;
  /** Epoch ms of the last review. */
  last: number;
  /** Total reviews ever. */
  seen: number;
  /** Times you've forgotten it. */
  lapses: number;
}

const DAY_MS = 86_400_000;
/** A forgotten card comes back inside the same sitting, not in a day. */
const RELEARN_MS = 10 * 60_000;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const START_EASE = 2.4;
const MAX_INTERVAL_DAYS = 365;

const clampEase = (e: number) => Math.min(MAX_EASE, Math.max(MIN_EASE, e));

const freshState = (now: number): CardState => ({
  reps: 0,
  interval: 0,
  ease: START_EASE,
  due: now,
  last: 0,
  seen: 0,
  lapses: 0,
});

/** SM-2 without the self-rating: apply a grade and return the next state. */
export function gradeCard(
  prev: CardState | undefined,
  grade: RecallGrade,
  now: number,
): CardState {
  const base = prev ?? freshState(now);
  const seen = base.seen + 1;

  if (grade === "again") {
    return {
      reps: 0,
      interval: 0,
      ease: clampEase(base.ease - 0.2),
      due: now + RELEARN_MS,
      last: now,
      seen,
      lapses: base.lapses + 1,
    };
  }

  const ease = clampEase(base.ease + (grade === "hard" ? -0.15 : 0.05));
  let interval: number;
  if (grade === "hard") interval = base.interval > 0 ? base.interval * 1.2 : 1;
  else if (base.reps === 0) interval = 1;
  else if (base.reps === 1) interval = 3;
  else interval = base.interval * ease;
  interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(interval)));

  return {
    reps: base.reps + 1,
    interval,
    ease,
    due: now + interval * DAY_MS,
    last: now,
    seen,
    lapses: base.lapses,
  };
}

/** How well a card is known, for the dashboard. */
export type Strength = "new" | "learning" | "young" | "known";

export function strengthOf(state: CardState | undefined): Strength {
  if (!state || state.seen === 0) return "new";
  if (state.reps === 0 || state.interval < 1) return "learning";
  return state.interval < 21 ? "young" : "known";
}

/** A card you keep forgetting — worth understanding rather than re-drilling. */
export const LEECH_LAPSES = 3;

/* ---------------- Session queue ---------------- */

export type CardStates = Record<string, CardState>;

export interface QueueOptions {
  /** Cards per sitting. */
  limit: number;
  now: number;
  /** Ignore due dates and drill the shakiest cards (for "practise anyway"). */
  ignoreSchedule?: boolean;
}

/**
 * The cards for one sitting: everything overdue (most overdue first), then new
 * material by how likely you are to meet it. Due work comes first because a
 * memory about to lapse is worth more than a memory you never had.
 */
export function buildQueue(
  cards: RecallCard[],
  states: CardStates,
  { limit, now, ignoreSchedule = false }: QueueOptions,
): RecallCard[] {
  if (ignoreSchedule) {
    // Weakest first: never-seen and lapsed cards outrank well-known ones, and
    // likelier positions outrank obscure ones.
    const scored = cards.map((card) => {
      const state = states[card.key];
      return { card, score: state ? state.interval - state.lapses * 3 : -100 };
    });
    scored.sort((a, b) => a.score - b.score || b.card.importance - a.card.importance);
    return scored.slice(0, limit).map((s) => s.card);
  }

  const due: { card: RecallCard; overdue: number }[] = [];
  const fresh: RecallCard[] = [];
  for (const card of cards) {
    const state = states[card.key];
    if (!state || state.seen === 0) fresh.push(card);
    else if (state.due <= now) due.push({ card, overdue: now - state.due });
  }
  due.sort((a, b) => b.overdue - a.overdue);
  fresh.sort(
    (a, b) => b.importance - a.importance || a.lead.length - b.lead.length,
  );
  return [...due.map((d) => d.card), ...fresh].slice(0, limit);
}

/**
 * Put a just-forgotten card back a few places later in the same sitting. Seeing
 * it again a minute after failing it is what actually fixes it — waiting for
 * tomorrow only records that you failed.
 */
export const RELEARN_GAP = 3;

export function requeue<T>(queue: T[], index: number, gap = RELEARN_GAP): T[] {
  const card = queue[index];
  if (card === undefined) return queue;
  const next = [...queue];
  next.splice(Math.min(next.length, index + 1 + gap), 0, card);
  return next;
}

/* ---------------- Aggregate stats ---------------- */

export interface MemorySummary {
  total: number;
  new: number;
  learning: number;
  young: number;
  known: number;
  /** Cards scheduled at or before `now`. */
  due: number;
  /** Soonest upcoming due date among cards that aren't due yet. */
  nextDue: number | null;
  /** 0–1: how much of the repertoire is committed to memory. */
  retention: number;
}

export function summarize(
  cards: RecallCard[],
  states: CardStates,
  now: number,
): MemorySummary {
  const out: MemorySummary = {
    total: cards.length,
    new: 0,
    learning: 0,
    young: 0,
    known: 0,
    due: 0,
    nextDue: null,
    retention: 0,
  };
  let strength = 0;
  for (const card of cards) {
    const state = states[card.key];
    out[strengthOf(state)] += 1;
    if (!state || state.seen === 0) continue;
    if (state.due <= now) out.due += 1;
    else if (out.nextDue === null || state.due < out.nextDue) {
      out.nextDue = state.due;
    }
    // A card counts as fully learnt once it survives three weeks between reviews.
    strength += Math.min(1, state.interval / 21);
  }
  out.retention = cards.length > 0 ? strength / cards.length : 0;
  return out;
}

export interface Leech {
  card: RecallCard;
  state: CardState;
}

/** Cards you've forgotten repeatedly, worst first. */
export function leeches(cards: RecallCard[], states: CardStates): Leech[] {
  const out: Leech[] = [];
  for (const card of cards) {
    const state = states[card.key];
    if (state && state.lapses >= LEECH_LAPSES) out.push({ card, state });
  }
  out.sort((a, b) => b.state.lapses - a.state.lapses);
  return out;
}

/* ---------------- Persistence ---------------- */

const MEMORY_KEY = "chess-memory-v1";

export interface MemoryStore {
  /** Card state per repertoire id, then per position key. */
  cards: Record<string, CardStates>;
  /** Reviews done per local day ("YYYY-MM-DD"), for the practice streak. */
  days: Record<string, number>;
}

export const EMPTY_MEMORY: MemoryStore = { cards: {}, days: {} };

/** Local calendar day of a timestamp — streaks are about days, not 24h windows. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Consecutive days with at least one review, counting back from today. */
export function streakOf(days: Record<string, number>, now: number): number {
  const cursor = new Date(now);
  // Today being empty doesn't break a streak until the day is over, so an empty
  // today just falls through to yesterday.
  if (!days[dayKey(cursor.getTime())]) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days[dayKey(cursor.getTime())]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function isCardState(v: unknown): v is CardState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.reps === "number" &&
    typeof s.interval === "number" &&
    typeof s.ease === "number" &&
    typeof s.due === "number" &&
    typeof s.last === "number" &&
    typeof s.seen === "number" &&
    typeof s.lapses === "number"
  );
}

export function loadMemory(): MemoryStore {
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (!raw) return EMPTY_MEMORY;
    const parsed = JSON.parse(raw) as Partial<MemoryStore>;
    const cards: Record<string, CardStates> = {};
    for (const [repId, byKey] of Object.entries(parsed.cards ?? {})) {
      const clean: CardStates = {};
      for (const [key, state] of Object.entries(byKey ?? {})) {
        if (isCardState(state)) clean[key] = state;
      }
      cards[repId] = clean;
    }
    const days: Record<string, number> = {};
    for (const [day, count] of Object.entries(parsed.days ?? {})) {
      if (typeof count === "number") days[day] = count;
    }
    return { cards, days };
  } catch {
    return EMPTY_MEMORY;
  }
}

export function saveMemory(store: MemoryStore): boolean {
  try {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Record one graded review, returning a new store (state here is immutable). */
export function recordReview(
  store: MemoryStore,
  repId: string,
  key: string,
  state: CardState,
  now: number,
): MemoryStore {
  const day = dayKey(now);
  return {
    cards: {
      ...store.cards,
      [repId]: { ...(store.cards[repId] ?? {}), [key]: state },
    },
    days: { ...store.days, [day]: (store.days[day] ?? 0) + 1 },
  };
}

/** Forget everything learnt about one repertoire. */
export function resetRepertoireMemory(
  store: MemoryStore,
  repId: string,
): MemoryStore {
  const cards = { ...store.cards };
  delete cards[repId];
  return { ...store, cards };
}

/* ---------------- Formatting ---------------- */

export function formatInterval(days: number): string {
  if (days < 1) return "in a few minutes";
  if (days === 1) return "tomorrow";
  if (days < 30) return `in ${Math.round(days)} days`;
  const months = Math.round(days / 30);
  return months <= 1 ? "in a month" : `in ${months} months`;
}

/** "in 3 days" / "now" for an absolute due date. */
export function formatDue(due: number, now: number): string {
  const diff = due - now;
  if (diff <= 0) return "now";
  if (diff < 60 * 60_000) return `in ${Math.max(1, Math.round(diff / 60_000))} min`;
  if (diff < DAY_MS) return `in ${Math.round(diff / (60 * 60_000))}h`;
  return formatInterval(diff / DAY_MS);
}

export const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Whose repertoire this is, phrased for the prompt. */
export const sideLabel = (color: Color) =>
  color === "white" ? "White" : "Black";
