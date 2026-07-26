"use client";

import { useMemo } from "react";
import { useTrainer } from "@/context/TrainerContext";
import type { Classification } from "@/lib/classify";
import { Button } from "./ui";
import {
  MoveClassChip,
  MoveClassLegend,
  MoveReactionCard,
} from "./MoveClassBadge";

interface Props {
  /** Move reactions keyed by 0-based move index, when review is on. */
  classes?: Map<number, Classification>;
  /** Whether move review is switched on. */
  reviewOn?: boolean;
  /** Toggle move review (undefined hides the control). */
  onToggleReview?: (on: boolean) => void;
  /** Whether review can run at all (engine must be on). */
  reviewAvailable?: boolean;
  /** Whether Stockfish is still grading the line. */
  reviewBusy?: boolean;
}

export function MoveList({
  classes,
  reviewOn = false,
  onToggleReview,
  reviewAvailable = false,
  reviewBusy = false,
}: Props) {
  const { line, ply, goToPly, activeRepertoire, addCurrentLine } = useTrainer();

  // How far the current line follows a saved repertoire path — one pass down the
  // tree, so `saved` for every move is O(n) total instead of O(n) per move.
  const savedFlags = useMemo(() => {
    const flags: boolean[] = [];
    if (!activeRepertoire) return flags;
    let nodes = activeRepertoire.root;
    for (let i = 0; i < line.length; i++) {
      const node = nodes.find((n) => n.san === line[i].san);
      if (!node) break;
      flags[i] = true;
      nodes = node.children;
    }
    return flags;
  }, [activeRepertoire, line]);

  const currentSaved = ply > 0 && (savedFlags[ply - 1] ?? false);
  const showReactions = reviewOn && reviewAvailable;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Current line
        </span>
        <div className="flex items-center gap-1.5">
          {onToggleReview && (
            <button
              type="button"
              onClick={() => onToggleReview(!reviewOn)}
              disabled={!reviewAvailable}
              aria-pressed={showReactions}
              title={
                reviewAvailable
                  ? "Grade every move (chess.com-style reactions)"
                  : "Turn Stockfish on to grade moves"
              }
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                showReactions
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                  : "border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200"
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  showReactions
                    ? reviewBusy
                      ? "animate-soft-pulse bg-sky-400"
                      : "bg-sky-400"
                    : "bg-slate-600"
                }`}
              />
              Review
            </button>
          )}
          {activeRepertoire && (
            <Button
              variant={currentSaved ? "ghost" : "primary"}
              onClick={addCurrentLine}
              disabled={ply === 0 || currentSaved}
              className="!py-1 text-xs"
              title="Save this line into the active repertoire"
            >
              {currentSaved ? "✓ In repertoire" : "＋ Save line"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm scroll-thin">
        <button
          type="button"
          onClick={() => goToPly(0)}
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            ply === 0
              ? "bg-emerald-600 text-white"
              : "text-slate-400 hover:bg-slate-800"
          }`}
        >
          start
        </button>
        {line.map((m, i) => {
          const isWhite = i % 2 === 0;
          const moveNo = Math.floor(i / 2) + 1;
          const active = ply === i + 1;
          const saved = savedFlags[i] ?? false;
          const reaction = showReactions ? classes?.get(i) : undefined;
          return (
            <span key={i} className="inline-flex items-center">
              {isWhite && (
                <span className="mr-0.5 select-none text-xs tabular-nums text-slate-500">
                  {moveNo}.
                </span>
              )}
              <button
                type="button"
                onClick={() => goToPly(i + 1)}
                className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[13px] transition ${
                  active
                    ? "bg-emerald-600 text-white"
                    : saved
                      ? "text-emerald-300 hover:bg-slate-800"
                      : "text-slate-200 hover:bg-slate-800"
                }`}
                title={saved ? "In repertoire" : "Not saved yet"}
              >
                {m.san}
                {reaction && <MoveClassChip cls={reaction.cls} winLoss={reaction.winLoss} />}
              </button>
            </span>
          );
        })}
        {line.length === 0 && (
          <span className="px-1 py-0.5 text-xs text-slate-500">
            Make a move on the board to begin exploring.
          </span>
        )}
      </div>

      {showReactions && ply > 0 && classes?.get(ply - 1) && (
        <MoveReactionCard
          san={line[ply - 1].san}
          index={ply - 1}
          classification={classes.get(ply - 1)!}
        />
      )}

      {showReactions && line.length > 0 && (
        <details className="mt-2 border-t border-slate-800/70 pt-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-500 hover:text-slate-300">
            Move key
          </summary>
          <div className="mt-2">
            <MoveClassLegend />
          </div>
        </details>
      )}
    </div>
  );
}
