import type { EngineLine } from "./types";

/** Score from the side-to-move's perspective (positive = good for the mover). */
export function relScore(line: Pick<EngineLine, "scoreWhite">, whiteToMove: boolean): number {
  return whiteToMove ? line.scoreWhite : -line.scoreWhite;
}

/** Format an engine line's score from White's perspective, e.g. "+1.35", "-0.42", "M5", "-M3". */
export function formatScore(line: Pick<EngineLine, "type" | "value" | "scoreWhite">): string {
  if (line.type === "mate") {
    const sign = line.scoreWhite >= 0 ? "" : "-";
    return `${sign}M${Math.abs(line.value)}`;
  }
  const pawns = line.scoreWhite / 100;
  const sign = pawns > 0 ? "+" : pawns < 0 ? "" : "";
  return `${sign}${pawns.toFixed(2)}`;
}

/** Convert a White-perspective centipawn score into White's win-share fraction (0..1). */
export function evalToWhiteFraction(scoreWhite: number): number {
  const cp = Math.max(-1500, Math.min(1500, scoreWhite));
  return 1 / (1 + Math.pow(10, -cp / 400));
}

/** Percentage figure (0..100) for display in a WDL bar. */
export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

/** Compact play-count formatting: 1234 -> "1.2k", 4500000 -> "4.5M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
