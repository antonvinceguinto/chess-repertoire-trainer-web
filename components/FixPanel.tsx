"use client";

import { useTrainer } from "@/context/TrainerContext";
import { useBook } from "@/hooks/useBook";
import { START_FEN, formatMoveSequence } from "@/lib/chess";
import { formatCount, formatScore } from "@/lib/evalFormat";
import type { EngineEval, EngineStatus } from "@/lib/types";
import { Button, Panel, PanelHeader } from "./ui";

interface Props {
  evaluation: EngineEval | null;
  status: EngineStatus;
}

/**
 * Guided gap-fixing: walks the queue of gap positions built from the Coverage
 * tab. At each one it's your move, and the engine's pick + the book's main
 * theory are one tap away — adding a move saves it and jumps to the next gap.
 */
export function FixPanel({ evaluation, status }: Props) {
  const {
    fen,
    currentSans,
    fixQueue,
    fixIndex,
    fixAddMove,
    skipFix,
    endFix,
  } = useTrainer();
  const { ready, opening, moves: bookMoves } = useBook(fen);

  if (!fixQueue) return null;
  const total = fixQueue.length;

  if (fixIndex >= total) {
    return (
      <Panel>
        <PanelHeader title="Fix gaps" />
        <div className="p-6 text-center">
          <p className="text-3xl">✓</p>
          <p className="mt-2 text-sm font-semibold text-emerald-300">
            Caught up!
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            You&apos;ve been through all {total}{" "}
            {total === 1 ? "gap" : "gaps"} in this batch. Your coverage has
            updated — reopen the Coverage tab to see how much closer to 100%
            you are.
          </p>
          <Button variant="primary" onClick={endFix} className="mt-4">
            Done
          </Button>
        </div>
      </Panel>
    );
  }

  const evalMatches = evaluation != null && evaluation.fen === fen;
  const lines = evalMatches ? evaluation.lines : [];
  const engineBest = lines[0]?.san ?? null;
  const evalBySan = new Map(lines.map((l) => [l.san, l]));

  // Candidate replies: the book's theory moves, plus the engine's top pick if
  // it isn't in the book. Engine pick floats to the top, then by popularity.
  const candidates: { san: string; count: number; name: string | null }[] =
    bookMoves.map((m) => ({ san: m.san, count: m.count, name: m.name }));
  if (engineBest && !candidates.some((c) => c.san === engineBest)) {
    candidates.unshift({ san: engineBest, count: 0, name: "Engine suggestion" });
  }
  candidates.sort((a, b) =>
    a.san === engineBest ? -1 : b.san === engineBest ? 1 : b.count - a.count,
  );

  const seq = formatMoveSequence(START_FEN, currentSans);

  return (
    <Panel>
      <PanelHeader
        title="Fix gaps"
        right={
          <span className="text-[11px] tabular-nums text-slate-400">
            Gap{" "}
            <span className="font-semibold text-slate-200">{fixIndex + 1}</span>{" "}
            of {total}
          </span>
        }
      />

      <div className="space-y-3 p-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(fixIndex / total) * 100}%` }}
          />
        </div>

        <div>
          {opening && (
            <div className="text-[13px] font-semibold text-slate-100">
              {opening.eco && (
                <span className="mr-1.5 font-mono text-[10px] text-slate-500">
                  {opening.eco}
                </span>
              )}
              {opening.name}
            </div>
          )}
          <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-slate-400">
            {seq || "start"}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Your move — pick a reply to lock this line into your repertoire.
          </p>
        </div>

        {!ready ? (
          <p className="animate-soft-pulse py-4 text-center text-xs text-slate-500">
            Loading suggestions…
          </p>
        ) : candidates.length === 0 ? (
          <p className="py-3 text-center text-[11px] leading-relaxed text-slate-500">
            No book theory here — the engine&apos;s arrow on the board shows its
            pick. Play any move on the board to save it, or skip.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {candidates.map((c) => {
              const el = evalBySan.get(c.san);
              const isBest = c.san === engineBest;
              return (
                <li key={c.san}>
                  <button
                    type="button"
                    onClick={() => fixAddMove(c.san)}
                    className="group flex w-full items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-2 text-left transition hover:border-emerald-600/60 hover:bg-slate-800/60"
                  >
                    {isBest ? (
                      <span
                        className="shrink-0 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300"
                        title="Engine's top choice"
                      >
                        ★ Best
                      </span>
                    ) : (
                      <span className="w-9 shrink-0" />
                    )}
                    <span className="w-14 shrink-0 font-mono text-[15px] font-semibold text-slate-100">
                      {c.san}
                    </span>
                    {el && (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                        {formatScore(el)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                      {c.count > 0 ? `${formatCount(c.count)} games` : c.name}
                    </span>
                    <span className="shrink-0 rounded bg-emerald-600/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 transition group-hover:bg-emerald-600 group-hover:text-white">
                      ＋ Add
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {status === "loading" && candidates.length > 0 && (
          <p className="text-center text-[10px] text-slate-600">
            Engine still warming up — evals will fill in.
          </p>
        )}

        <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
          <Button variant="secondary" onClick={skipFix}>
            Skip →
          </Button>
          <Button variant="ghost" onClick={endFix} className="ml-auto">
            ✕ Exit fixing
          </Button>
        </div>
      </div>
    </Panel>
  );
}
