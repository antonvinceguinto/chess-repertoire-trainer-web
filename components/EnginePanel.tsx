"use client";

import { useTrainer } from "@/context/TrainerContext";
import { pathExists } from "@/lib/repertoire";
import { formatMoveSequence, turnOf } from "@/lib/chess";
import { formatScore } from "@/lib/evalFormat";
import type { EngineEval, EngineLine, EngineStatus } from "@/lib/types";
import { Panel, PanelHeader } from "./ui";

interface Props {
  evaluation: EngineEval | null;
  status: EngineStatus;
  engineOn: boolean;
  setEngineOn: (b: boolean) => void;
  multipv: number;
  setMultipv: (n: number) => void;
}

/** Score from the side-to-move's perspective (positive = good for the mover). */
function relScore(line: EngineLine, whiteToMove: boolean): number {
  return whiteToMove ? line.scoreWhite : -line.scoreWhite;
}

export function EnginePanel({
  evaluation,
  status,
  engineOn,
  setEngineOn,
  multipv,
  setMultipv,
}: Props) {
  const { fen, currentSans, activeRepertoire, playMove, addMoveToRepertoire } =
    useTrainer();

  const evalMatches = evaluation != null && evaluation.fen === fen;
  const lines = evalMatches ? evaluation.lines : [];
  const whiteToMove = turnOf(fen) === "w";
  const bestRel = lines.length > 0 ? relScore(lines[0], whiteToMove) : 0;

  return (
    <Panel>
      <PanelHeader
        title="Stockfish analysis"
        right={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              Lines
              <select
                value={multipv}
                onChange={(e) => setMultipv(Number(e.target.value))}
                disabled={!engineOn}
                className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-40"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Toggle checked={engineOn} onChange={setEngineOn} label="Engine" />
          </div>
        }
      />
      <div className="p-2">
        {!engineOn ? (
          <p className="px-1 py-3 text-center text-xs text-slate-500">
            Engine is off. Turn it on to see Stockfish evaluations.
          </p>
        ) : status === "error" ? (
          <p className="px-1 py-3 text-center text-xs text-rose-400">
            Stockfish failed to load in this browser.
          </p>
        ) : lines.length === 0 ? (
          <p className="animate-soft-pulse px-1 py-3 text-center text-xs text-slate-500">
            {status === "loading" ? "Loading engine…" : "Analyzing…"}
          </p>
        ) : (
          <>
            {multipv > 1 && (
              <p className="mb-1.5 px-1 text-[10px] text-slate-500">
                Ranked best → worst. Lines below the top are weaker alternatives,
                not recommendations.
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {lines.map((line, i) => (
                <EngineRow
                  key={line.multipv}
                  line={line}
                  fen={fen}
                  isBest={i === 0}
                  lossVsBest={bestRel - relScore(line, whiteToMove)}
                  saved={
                    activeRepertoire
                      ? pathExists(activeRepertoire, [...currentSans, line.san])
                      : false
                  }
                  onPlay={() => playMove(line.san)}
                  onAdd={() => addMoveToRepertoire(line.san)}
                  canAdd={!!activeRepertoire}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}

function EngineRow({
  line,
  fen,
  isBest,
  lossVsBest,
  saved,
  canAdd,
  onPlay,
  onAdd,
}: {
  line: EngineLine;
  fen: string;
  isBest: boolean;
  lossVsBest: number;
  saved: boolean;
  canAdd: boolean;
  onPlay: () => void;
  onAdd: () => void;
}) {
  const positive = line.scoreWhite > 20;
  const negative = line.scoreWhite < -20;
  const scoreColor = positive
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-600/40"
    : negative
      ? "bg-rose-500/15 text-rose-300 border-rose-600/40"
      : "bg-slate-600/20 text-slate-300 border-slate-600/50";
  const preview = formatMoveSequence(fen, line.pvSan);

  // A move ≥3 pawns worse than the best is a clear blunder — de-emphasise it.
  const losing = lossVsBest >= 300;

  return (
    <li
      className={`group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-800/60 ${
        losing ? "opacity-60" : ""
      }`}
    >
      <span
        className={`w-14 shrink-0 rounded border text-center text-xs font-bold tabular-nums ${scoreColor}`}
      >
        {formatScore(line)}
      </span>
      <QualityTag isBest={isBest} lossVsBest={lossVsBest} />
      <button
        type="button"
        onClick={onPlay}
        className="min-w-0 flex-1 truncate text-left font-mono text-[13px] text-slate-200 hover:text-white"
        title={preview}
      >
        {preview || line.san}
      </button>
      {canAdd &&
        (saved ? (
          <span
            className="shrink-0 text-xs text-emerald-400"
            title="Already in repertoire"
          >
            ✓
          </span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="shrink-0 rounded border border-slate-600 px-1.5 text-sm leading-6 text-slate-300 opacity-100 transition hover:border-emerald-500 hover:text-emerald-300 hoverable:opacity-0 hoverable:group-hover:opacity-100"
            title="Add this move to repertoire"
          >
            ＋
          </button>
        ))}
    </li>
  );
}

/** Shows "Best" on the top line, or how much worse an alternative is. */
function QualityTag({ isBest, lossVsBest }: { isBest: boolean; lossVsBest: number }) {
  if (isBest) {
    return (
      <span className="w-14 shrink-0 rounded border border-emerald-600/40 bg-emerald-600/15 text-center text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
        Best
      </span>
    );
  }
  if (lossVsBest < 20) {
    return (
      <span className="w-14 shrink-0 text-center text-[10px] font-medium text-slate-400">
        ≈ equal
      </span>
    );
  }
  const style =
    lossVsBest < 100
      ? "text-amber-300"
      : lossVsBest < 300
        ? "text-orange-300"
        : "text-rose-300";
  const label =
    lossVsBest >= 1000 ? "≪ best" : `−${(lossVsBest / 100).toFixed(lossVsBest < 100 ? 2 : 1)}`;
  return (
    <span
      className={`w-14 shrink-0 text-center text-[10px] font-semibold tabular-nums ${style}`}
      title="How much worse than the best move"
    >
      {label}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
        checked ? "bg-emerald-600" : "bg-slate-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
