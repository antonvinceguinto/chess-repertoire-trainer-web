"use client";

import { useTrainer } from "@/context/TrainerContext";
import { pathExists } from "@/lib/repertoire";
import { Button } from "./ui";

export function MoveList() {
  const { line, ply, goToPly, activeRepertoire, addCurrentLine } = useTrainer();

  const inRep = (upto: number) =>
    activeRepertoire
      ? pathExists(
          activeRepertoire,
          line.slice(0, upto).map((m) => m.san),
        )
      : false;

  const currentSaved = ply > 0 && inRep(ply);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Current line
        </span>
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
          const saved = inRep(i + 1);
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
                className={`rounded px-1.5 py-0.5 font-mono text-[13px] transition ${
                  active
                    ? "bg-emerald-600 text-white"
                    : saved
                      ? "text-emerald-300 hover:bg-slate-800"
                      : "text-slate-200 hover:bg-slate-800"
                }`}
                title={saved ? "In repertoire" : "Not saved yet"}
              >
                {m.san}
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
    </div>
  );
}
