"use client";

import { useMemo, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useBook } from "@/hooks/useBook";
import { useExplorer } from "@/hooks/useExplorer";
import { pathExists } from "@/lib/repertoire";
import { formatCount, formatScore } from "@/lib/evalFormat";
import type { BookMove } from "@/lib/book";
import type { EngineEval, EngineLine, ExplorerDb, ExplorerMove } from "@/lib/types";
import { Panel, PanelHeader, WdlBar } from "./ui";

interface Props {
  evaluation: EngineEval | null;
  onHide?: () => void;
}

export function BookPanel({ evaluation, onHide }: Props) {
  const { fen, mode, currentSans, activeRepertoire, playMove, addMoveToRepertoire } =
    useTrainer();
  const { ready, error, opening, moves } = useBook(fen);

  const [liveOn, setLiveOn] = useState(false);
  const [db, setDb] = useState<ExplorerDb>("lichess");
  const live = useExplorer(fen, liveOn && mode === "build", db);

  const evalMap = useMemo(() => {
    const map = new Map<string, EngineLine>();
    if (evaluation && evaluation.fen === fen) {
      for (const l of evaluation.lines) map.set(l.san, l);
    }
    return map;
  }, [evaluation, fen]);

  const liveMap = useMemo(() => {
    const map = new Map<string, ExplorerMove>();
    if (live.data) for (const m of live.data.moves) map.set(m.san, m);
    return map;
  }, [live.data]);

  const maxCount = moves.length > 0 ? moves[0].count : 1;

  return (
    <Panel>
      <PanelHeader
        title="Opening book"
        right={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              Live win-rates
              <Toggle checked={liveOn} onChange={setLiveOn} />
            </label>
            {onHide && (
              <button
                type="button"
                onClick={onHide}
                className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                title="Hide the opening book to widen the board"
              >
                Hide
              </button>
            )}
          </div>
        }
      />
      <div className="p-2">
        <div className="mb-2 flex min-h-[18px] items-center justify-between px-1 text-xs">
          {opening ? (
            <span className="truncate">
              <span className="font-mono text-slate-500">{opening.eco}</span>{" "}
              <span className="font-medium text-slate-200">{opening.name}</span>
            </span>
          ) : (
            <span className="text-slate-500">
              {ready ? "Uncatalogued position" : "Loading book…"}
            </span>
          )}
          {liveOn && (
            <div className="flex shrink-0 rounded border border-slate-700 p-0.5">
              {(["lichess", "masters"] as ExplorerDb[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDb(d)}
                  className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${
                    db === d ? "bg-emerald-600 text-white" : "text-slate-400"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {liveOn && live.error && (
          <p className="mb-2 rounded bg-amber-950/40 px-2 py-1 text-[11px] text-amber-400">
            Live stats unavailable (Lichess not reachable). Showing bundled book.
          </p>
        )}

        {error ? (
          <p className="px-1 py-3 text-center text-xs text-rose-400">
            Could not load the opening book.
          </p>
        ) : !ready ? (
          <p className="animate-soft-pulse px-1 py-3 text-center text-xs text-slate-500">
            Loading opening book…
          </p>
        ) : moves.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-slate-500">
            Out of book — no established theory moves from this position. Use the
            engine to choose a continuation.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {moves.map((m) => (
              <BookRow
                key={m.san}
                move={m}
                maxCount={maxCount}
                engineLine={evalMap.get(m.san) ?? null}
                liveMove={liveOn ? liveMap.get(m.san) ?? null : null}
                saved={
                  activeRepertoire
                    ? pathExists(activeRepertoire, [...currentSans, m.san])
                    : false
                }
                canAdd={!!activeRepertoire}
                onPlay={() => playMove(m.san)}
                onAdd={() => addMoveToRepertoire(m.san)}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function BookRow({
  move,
  maxCount,
  engineLine,
  liveMove,
  saved,
  canAdd,
  onPlay,
  onAdd,
}: {
  move: BookMove;
  maxCount: number;
  engineLine: EngineLine | null;
  liveMove: ExplorerMove | null;
  saved: boolean;
  canAdd: boolean;
  onPlay: () => void;
  onAdd: () => void;
}) {
  const share = Math.max(4, Math.round((move.count / maxCount) * 100));
  const scoreColor = engineLine
    ? engineLine.scoreWhite > 20
      ? "text-emerald-300"
      : engineLine.scoreWhite < -20
        ? "text-rose-300"
        : "text-slate-300"
    : "";

  return (
    <li className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-800/60">
      <button
        type="button"
        onClick={onPlay}
        className="w-12 shrink-0 text-left font-mono text-[13px] font-semibold text-slate-100 hover:text-white"
        title={move.name ? `${move.eco} ${move.name}` : "Play this move"}
      >
        {move.san}
      </button>

      <div className="min-w-0 flex-1">
        {liveMove ? (
          <WdlBar
            white={liveMove.white}
            draws={liveMove.draws}
            black={liveMove.black}
            total={liveMove.total}
          />
        ) : (
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
              style={{ width: `${share}%` }}
            />
          </div>
        )}
        {move.name && (
          <div className="mt-0.5 truncate text-[10px] text-slate-500">
            {move.name}
          </div>
        )}
      </div>

      <div className="flex w-12 shrink-0 flex-col items-end text-[10px] leading-tight">
        <span className="tabular-nums text-slate-400">
          {liveMove ? formatCount(liveMove.total) : formatCount(move.count)}
        </span>
        {engineLine && (
          <span className={`font-semibold tabular-nums ${scoreColor}`}>
            {formatScore(engineLine)}
          </span>
        )}
      </div>

      {canAdd &&
        (saved ? (
          <span className="w-5 shrink-0 text-center text-xs text-emerald-400" title="In repertoire">
            ✓
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="w-5 shrink-0 rounded border border-slate-600 text-sm leading-6 text-slate-300 opacity-100 transition hover:border-emerald-500 hover:text-emerald-300 hoverable:opacity-0 hoverable:group-hover:opacity-100"
            title="Add this move to repertoire"
          >
            ＋
          </button>
        ))}
    </li>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Toggle live win-rates"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition ${
        checked ? "bg-emerald-600" : "bg-slate-700"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white transition ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
