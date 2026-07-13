import { tryMove, turnOf } from "./chess";
import type { EngineEval } from "./types";
import type { Gap } from "./gaps";

/**
 * How much it hurts to be unprepared at a gap. We evaluate the position you'd
 * face if the opponent played the gap move, then score two things from your
 * side: how far behind you already are ("disadvantage"), and how much worse
 * the second-best reply is than the best ("only-move-ness"). A sharp,
 * must-know position scores high; a quiet one where anything is fine scores low.
 */
export type DangerLevel = "high" | "medium" | "low";

export interface DangerScore {
  level: DangerLevel;
  /** Rough centipawn "cost of not knowing this" — for sorting. */
  score: number;
}

/** Shallow-but-quick evaluation is enough to spot sharp lines. */
export const DANGER_DEPTH = 14;
export const DANGER_MULTIPV = 2;

const keyOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** Stable per-gap key (matches rankGaps' dedupe key). */
export function gapKey(g: Gap): string {
  return `${keyOf(g.fen)}|${g.missingSan ?? "reply"}`;
}

/** The position to evaluate for danger: the one you're unprepared in. */
export function dangerTargetFen(g: Gap): string {
  if (g.kind === "defense" && g.missingSan) {
    const mv = tryMove(g.fen, g.missingSan);
    if (mv) return mv.fen; // after the opponent's move — your move, off-book
  }
  return g.fen;
}

/** Turn a completed engine eval of the target position into a danger score. */
export function dangerFromEval(
  fen: string,
  evaluation: EngineEval,
): DangerScore | null {
  const lines = evaluation.lines;
  if (lines.length === 0) return null;

  const clamp = (x: number) => Math.max(-1500, Math.min(1500, x));
  const you = turnOf(fen);
  const yourScore = (scoreWhite: number) =>
    clamp(you === "w" ? scoreWhite : -scoreWhite);

  const best = yourScore(lines[0].scoreWhite);
  const second = lines[1] ? yourScore(lines[1].scoreWhite) : best;

  const disadvantage = Math.max(0, -best); // you're already worse, even at best
  const dropoff = Math.max(0, best - second); // one clearly-best move
  const score = disadvantage + dropoff;

  const level: DangerLevel =
    score >= 120 ? "high" : score >= 50 ? "medium" : "low";
  return { level, score };
}

export const DANGER_META: Record<
  DangerLevel,
  { label: string; dot: string; text: string }
> = {
  high: { label: "Sharp", dot: "bg-rose-500", text: "text-rose-300" },
  medium: { label: "Tricky", dot: "bg-amber-500", text: "text-amber-300" },
  low: { label: "Quiet", dot: "bg-slate-500", text: "text-slate-400" },
};
