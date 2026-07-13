"use client";

import type { Color, EngineLine } from "@/lib/types";
import { evalToWhiteFraction, formatScore } from "@/lib/evalFormat";

interface Props {
  bestLine: EngineLine | null;
  orientation: Color;
}

/** Vertical evaluation bar. White's share fills from White's side of the board. */
export function EvalBar({ bestLine, orientation }: Props) {
  const hasEval = bestLine != null;
  const frac = hasEval ? evalToWhiteFraction(bestLine.scoreWhite) : 0.5;
  const whitePct = Math.round(frac * 100);
  const label = hasEval ? formatScore(bestLine) : "–";

  // White fills from the bottom when the board shows White at the bottom.
  const whiteAtBottom = orientation === "white";

  return (
    <div
      className="relative w-5 shrink-0 overflow-hidden rounded-md bg-slate-950 ring-1 ring-slate-700/60"
      title={`Evaluation: ${label}`}
    >
      <div
        className="absolute inset-x-0 bg-slate-100 transition-[height] duration-300 ease-out"
        style={{
          height: `${whitePct}%`,
          [whiteAtBottom ? "bottom" : "top"]: 0,
        }}
      />
      {/* midline */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-emerald-500/40" />
      <span
        className={`absolute inset-x-0 text-center text-[9px] font-bold tabular-nums text-slate-800 ${
          whiteAtBottom ? "bottom-0.5" : "top-0.5"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
