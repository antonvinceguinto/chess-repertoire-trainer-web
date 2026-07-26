"use client";

import { useMemo, type MouseEvent } from "react";
import {
  CLASS_META,
  forSide,
  isMistake,
  winPercent,
  type MoveReview,
} from "@/lib/review";
import type { Color, Turn } from "@/lib/types";

interface Props {
  moves: MoveReview[];
  /** Whose side "up" means — the graph is drawn from this player's view. */
  userColor: Color;
  ply: number;
  onSelect: (ply: number) => void;
}

const HEIGHT = 100;

/**
 * The shape of the game: win probability from the user's point of view across
 * every position, with their own mistakes marked. Click anywhere to jump there.
 */
export function EvalGraph({ moves, userColor, ply, onSelect }: Props) {
  const userTurn: Turn = userColor === "white" ? "w" : "b";

  const series = useMemo(() => {
    if (moves.length === 0) return [];
    const cps = [moves[0].cpBefore, ...moves.map((m) => m.cpAfter)];
    return cps.map((cp) => winPercent(forSide(cp, userTurn)));
  }, [moves, userTurn]);

  const marks = useMemo(
    () => moves.filter((m) => m.color === userTurn && isMistake(m)),
    [moves, userTurn],
  );

  if (series.length < 2) return null;

  const last = series.length - 1;
  const x = (i: number) => (i / last) * 100;
  const y = (win: number) => HEIGHT - win;

  const points = series.map((win, i) => `${x(i)},${y(win)}`).join(" ");
  const area = `0,${HEIGHT} ${points} 100,${HEIGHT}`;

  const jump = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    onSelect(Math.round(Math.max(0, Math.min(1, ratio)) * last));
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
        <span>Your winning chances</span>
        <span className="tabular-nums">
          {Math.round(series[Math.min(ply, last)])}%
        </span>
      </div>

      <div
        onClick={jump}
        role="presentation"
        title="Click to jump to a moment in the game"
        className="relative h-16 w-full cursor-pointer overflow-hidden rounded bg-slate-900"
      >
        <svg
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {/* The 50/50 line. */}
          <line
            x1="0"
            y1={HEIGHT / 2}
            x2="100"
            y2={HEIGHT / 2}
            stroke="#334155"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={area} fill="rgba(16, 185, 129, 0.22)" />
          <polyline
            points={points}
            fill="none"
            stroke="#34d399"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Markers sit outside the SVG so the non-uniform scale can't warp them. */}
        {marks.map((m) => (
          <span
            key={m.index}
            title={`${CLASS_META[m.classification].label}: ${m.san}`}
            style={{ left: `${x(m.ply)}%` }}
            className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-slate-950 ${CLASS_META[m.classification].dot}`}
          />
        ))}

        <span
          style={{ left: `${x(Math.min(ply, last))}%` }}
          className="pointer-events-none absolute inset-y-0 w-px bg-slate-100/70"
        />
      </div>
    </div>
  );
}
