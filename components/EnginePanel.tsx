"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useBookData } from "@/hooks/useBookData";
import { pathExists } from "@/lib/repertoire";
import { formatMoveSequence, legalMoves, turnOf } from "@/lib/chess";
import { formatScore, relScore } from "@/lib/evalFormat";
import { bookMovesFrom } from "@/lib/book";
import {
  describeMove,
  type MoveContext,
  type MoveSummary,
} from "@/lib/moveSummary";
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
  const book = useBookData();

  const evalMatches = evaluation != null && evaluation.fen === fen;
  const lines = evalMatches ? evaluation.lines : [];
  const whiteToMove = turnOf(fen) === "w";
  const bestRel = lines.length > 0 ? relScore(lines[0], whiteToMove) : 0;

  // Which line the summary card explains (multipv index). Defaults to the best,
  // and falls back to it if the chosen line drops out (e.g. fewer Lines shown).
  const [selected, setSelected] = useState<number>(1);
  const selectedLine =
    lines.find((l) => l.multipv === selected) ?? lines[0] ?? null;

  // Position-level data the summary shares — computed once per position.
  const legal = useMemo(() => legalMoves(fen), [fen]);
  const bookMoves = useMemo(
    () => (book ? bookMovesFrom(book, fen) : []),
    [book, fen],
  );
  const summaryCtx = useMemo<MoveContext>(
    () => ({ legal, bookMoves, book }),
    [legal, bookMoves, book],
  );

  const summary = useMemo<MoveSummary | null>(
    () => (selectedLine ? describeMove(fen, selectedLine, lines, summaryCtx) : null),
    [selectedLine, fen, lines, summaryCtx],
  );
  const selectedSaved =
    selectedLine != null && activeRepertoire
      ? pathExists(activeRepertoire, [...currentSans, selectedLine.san])
      : false;

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
          <p className="px-1 py-3 text-center text-xs leading-relaxed text-slate-500">
            Engine is off — you&apos;re working from book moves only. Turn it on
            for Stockfish evaluations.
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
            <ul className="flex flex-col gap-1">
              {lines.map((line, i) => (
                <EngineRow
                  key={line.multipv}
                  line={line}
                  fen={fen}
                  isBest={i === 0}
                  lossVsBest={bestRel - relScore(line, whiteToMove)}
                  selected={selected === line.multipv}
                  saved={
                    activeRepertoire
                      ? pathExists(activeRepertoire, [...currentSans, line.san])
                      : false
                  }
                  onSelect={() => setSelected(line.multipv)}
                  onPlay={() => playMove(line.san)}
                  onAdd={() => addMoveToRepertoire(line.san)}
                  canAdd={!!activeRepertoire}
                />
              ))}
            </ul>

            {summary && (
              <div className="mt-2">
                <MoveSummaryCard summary={summary} saved={selectedSaved} />
              </div>
            )}
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
  selected,
  saved,
  canAdd,
  onSelect,
  onPlay,
  onAdd,
}: {
  line: EngineLine;
  fen: string;
  isBest: boolean;
  lossVsBest: number;
  selected: boolean;
  saved: boolean;
  canAdd: boolean;
  onSelect: () => void;
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
      className={`group flex items-center gap-2 rounded-md px-1.5 py-1 transition ${
        losing ? "opacity-60" : ""
      } ${selected ? "bg-sky-500/10 ring-1 ring-sky-500/40" : "hover:bg-slate-800/60"}`}
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
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label="Explain this move"
        title="Why this move?"
        className={`shrink-0 rounded border px-1.5 text-sm leading-6 transition ${
          selected
            ? "border-sky-500/60 bg-sky-500/15 text-sky-300"
            : "border-slate-600 text-slate-400 hover:border-sky-500 hover:text-sky-300"
        }`}
      >
        ⓘ
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

const HERO_TONE: Record<MoveSummary["verdict"]["tone"], string> = {
  good: "text-emerald-400",
  equal: "text-slate-100",
  bad: "text-rose-400",
};

/** Renders `**bold**` spans within an otherwise plain string. */
function Emphasis({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-slate-100">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

/** The redesigned analysis-summary card — one per selected engine line. */
function MoveSummaryCard({
  summary,
  saved,
}: {
  summary: MoveSummary;
  saved: boolean;
}) {
  const tagline = saved
    ? "Your prepared move"
    : summary.isBest
      ? "Engine's top choice"
      : summary.verdict.label;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950/40">
      {/* Header: opening + hero move */}
      <div className="border-b border-slate-800/80 bg-slate-900/50 p-3">
        {summary.opening && (
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-slate-100">
              <span aria-hidden>📖</span>
              <span className="truncate">{summary.opening.name}</span>
            </span>
            {summary.opening.eco && (
              <span className="shrink-0 rounded-md border border-emerald-700/50 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                {summary.opening.eco}
              </span>
            )}
          </div>
        )}
        <div className="flex items-baseline gap-3">
          <span className={`font-mono text-4xl font-bold leading-none ${HERO_TONE[summary.verdict.tone]}`}>
            {summary.san}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-200">
              {tagline}
            </div>
            {summary.descriptor && (
              <div className="truncate text-xs text-slate-500">{summary.descriptor}</div>
            )}
          </div>
        </div>
      </div>

      {/* THE IDEA */}
      {summary.idea && (
        <div className="border-b border-slate-800/60 p-3">
          <Section title="The idea">
            <p className="text-[13px] leading-relaxed text-slate-300">
              <Emphasis text={summary.idea} />
            </p>
          </Section>
        </div>
      )}

      {/* WHAT IT DOES · IF <side> PLAYS */}
      {(summary.actions.length > 0 || summary.replies.length > 0) && (
        <div
          className={`grid gap-4 border-b border-slate-800/60 p-3 ${
            summary.replies.length > 0 ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          {summary.actions.length > 0 && (
            <Section title="What it does">
              <ul className="space-y-1">
                {summary.actions.map((a, i) => (
                  <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-slate-300">
                    <span className="text-emerald-500/80" aria-hidden>
                      ›
                    </span>
                    <span className="min-w-0">{a}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {summary.replies.length > 0 && (
            <Section title={`If ${summary.opponent} plays…`}>
              <ul className="space-y-1">
                {summary.replies.map((r) => (
                  <li key={r.san} className="text-[12px] leading-snug">
                    <span className="font-mono font-semibold text-slate-200">…{r.san}</span>{" "}
                    {r.name && <span className="text-slate-400">{r.name} </span>}
                    <span className="text-slate-500">· {r.note}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {/* WATCH OUT */}
      {summary.watchOut.length > 0 && (
        <div className="bg-amber-950/25 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
            <span aria-hidden>⚠</span> Watch out
          </div>
          <ul className="space-y-1">
            {summary.watchOut.map((w, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-amber-200/80">
                <span aria-hidden>·</span>
                <span className="min-w-0">
                  <Emphasis text={w} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
