"use client";

import { useMemo, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import {
  REVIEW_DEPTHS,
  type ReviewDepthId,
  type ReviewProgress,
} from "@/hooks/useGameReview";
import {
  colorOf,
  endReason,
  formatTimeControl,
  outcomeOf,
} from "@/lib/chesscom";
import { formatMoveSequence } from "@/lib/chess";
import {
  accuracyLabel,
  CLASS_META,
  CLASS_ORDER,
  keyMoments,
  type GameReview,
  type MoveReview,
} from "@/lib/review";
import type { Turn } from "@/lib/types";
import { CoachCard } from "./CoachCard";
import { EvalGraph } from "./EvalGraph";
import { Button, Panel, PanelHeader } from "./ui";

interface Props {
  review: GameReview | null;
  progress: ReviewProgress;
  depthId: ReviewDepthId;
  onDepthChange: (id: ReviewDepthId) => void;
}

type View = "summary" | "moves";

/**
 * The review of one downloaded game: Stockfish's verdict on every move, an
 * accuracy score for each side, and the coach's explanation of whatever the
 * board is currently showing.
 */
export function ReviewPanel({
  review,
  progress,
  depthId,
  onDepthChange,
}: Props) {
  const {
    reviewSession,
    reviewChallenge,
    ply,
    variationFrom,
    closeReviewGame,
    restoreGame,
  } = useTrainer();
  const [view, setView] = useState<View>("summary");

  const userTurn: Turn = useMemo(
    () => (reviewSession?.color === "black" ? "b" : "w"),
    [reviewSession],
  );

  const mistakes = useMemo(
    () => (review ? keyMoments(review, userTurn) : []),
    [review, userTurn],
  );

  if (!reviewSession) return null;

  // Inside a side line the cursor indexes the branch, not the game — so anything
  // that describes the game anchors to the ply the branch forked from.
  const gamePly = variationFrom ?? ply;

  const { source, game, username } = reviewSession;
  const color = colorOf(source, username) ?? "white";
  const me = color === "white" ? source.white : source.black;
  const them = color === "white" ? source.black : source.white;
  const outcome = outcomeOf(me.result);

  // While a challenge is up the board sits *before* the flagged move, so the
  // coach should still be talking about that move rather than the previous one.
  const currentMove: MoveReview | null = reviewChallenge
    ? review?.moves[reviewChallenge.index] ?? null
    : gamePly >= 1
      ? review?.moves[gamePly - 1] ?? null
      : null;

  const mySummary = review
    ? userTurn === "w"
      ? review.white
      : review.black
    : null;
  const theirSummary = review
    ? userTurn === "w"
      ? review.black
      : review.white
    : null;

  const jumpTo = (target: number) => restoreGame(target);

  const prevMistake = mistakes.filter((m) => m.ply < gamePly).pop() ?? null;
  const nextMistake = mistakes.find((m) => m.ply > gamePly) ?? null;

  return (
    <Panel>
      <PanelHeader
        title="Game review"
        right={
          <button
            type="button"
            onClick={closeReviewGame}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            ← All games
          </button>
        }
      />

      {/* Who played whom. */}
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span
          className={`h-3 w-3 shrink-0 rounded-sm border ${
            color === "white"
              ? "border-slate-400 bg-slate-100"
              : "border-slate-600 bg-slate-900"
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">
          <span className="font-semibold text-slate-100">{me.username}</span>
          {me.rating != null && (
            <span className="text-slate-500"> {me.rating}</span>
          )}
          <span className="text-slate-600"> vs </span>
          <span className="font-semibold text-slate-100">{them.username}</span>
          {them.rating != null && (
            <span className="text-slate-500"> {them.rating}</span>
          )}
        </span>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          title="Open on Chess.com"
          className="shrink-0 text-[10px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          ↗
        </a>
      </div>
      <div className="border-b border-slate-800 px-3 py-1.5 text-[10px] text-slate-500">
        <span
          className={
            outcome === "win"
              ? "text-emerald-400"
              : outcome === "loss"
                ? "text-rose-400"
                : "text-slate-400"
          }
        >
          {outcome === "win" ? "Won" : outcome === "loss" ? "Lost" : "Drew"}
        </span>{" "}
        by {endReason(source).toLowerCase()} ·{" "}
        {formatTimeControl(source.timeControl) || source.timeClass} ·{" "}
        {game.moves.length} half-moves
        {game.openingName && ` · ${game.openingName}`}
      </div>

      {progress.failed ? (
        <p className="px-3 py-2 text-[11px] text-rose-400">
          Stockfish couldn&apos;t start, so this game can&apos;t be reviewed.
        </p>
      ) : (
        progress.running && (
          <div className="border-b border-slate-800 px-3 py-2">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span className="animate-soft-pulse">
                Reviewing with Stockfish…
              </span>
              <span className="tabular-nums">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{
                  width: `${
                    progress.total > 0
                      ? (progress.done / progress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )
      )}

      <div className="space-y-3 p-3">
        <CoachCard
          move={currentMove}
          isUser={currentMove?.color === userTurn}
          analyzing={progress.running}
        />

        {/* Jump between your own mistakes. */}
        {mistakes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              onClick={() => prevMistake && jumpTo(prevMistake.ply)}
              disabled={!prevMistake}
              className="flex-1 !py-1 text-[11px]"
            >
              ← Previous mistake
            </Button>
            <Button
              variant="secondary"
              onClick={() => nextMistake && jumpTo(nextMistake.ply)}
              disabled={!nextMistake}
              className="flex-1 !py-1 text-[11px]"
            >
              Next mistake →
            </Button>
          </div>
        )}

        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/40 p-1 text-sm">
          {(
            [
              ["summary", "Summary"],
              ["moves", "All moves"],
            ] as [View, string][]
          ).map(([v, labelText]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                view === v
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {labelText}
            </button>
          ))}
        </div>

        {view === "summary" ? (
          <div className="space-y-3">
            {mySummary && theirSummary && (
              <div className="grid grid-cols-2 gap-2">
                <AccuracyCard
                  title="You"
                  accuracy={mySummary.accuracy}
                  acpl={mySummary.acpl}
                  highlight
                />
                <AccuracyCard
                  title={them.username}
                  accuracy={theirSummary.accuracy}
                  acpl={theirSummary.acpl}
                />
              </div>
            )}

            {mySummary && <ClassBreakdown summary={mySummary} />}

            {review && review.moves.length > 1 && (
              <EvalGraph
                moves={review.moves}
                userColor={color}
                ply={gamePly}
                onSelect={jumpTo}
              />
            )}

            <KeyMoments
              mistakes={mistakes}
              ply={gamePly}
              onJump={jumpTo}
              running={progress.running}
            />

            <DepthSelector depthId={depthId} onChange={onDepthChange} />
          </div>
        ) : (
          <AnnotatedMoves
            review={review}
            ply={gamePly}
            userTurn={userTurn}
            onJump={jumpTo}
          />
        )}
      </div>
    </Panel>
  );
}

function AccuracyCard({
  title,
  accuracy,
  acpl,
  highlight = false,
}: {
  title: string;
  accuracy: number;
  acpl: number;
  highlight?: boolean;
}) {
  const tone =
    accuracy >= 90
      ? "text-emerald-300"
      : accuracy >= 75
        ? "text-emerald-400/90"
        : accuracy >= 60
          ? "text-amber-300"
          : "text-rose-300";
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        highlight
          ? "border-emerald-900/60 bg-emerald-950/20"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${tone}`}>
        {accuracy.toFixed(1)}
        <span className="text-sm font-medium text-slate-600">%</span>
      </p>
      <p className="text-[10px] text-slate-500">
        {accuracyLabel(accuracy)} · {acpl} cp lost / move
      </p>
    </div>
  );
}

function ClassBreakdown({
  summary,
}: {
  summary: { counts: Record<string, number> };
}) {
  const shown = CLASS_ORDER.filter((c) => (summary.counts[c] ?? 0) > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {shown.map((c) => {
        const meta = CLASS_META[c];
        return (
          <li
            key={c}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium ${meta.bg} ${meta.text}`}
          >
            <span className="font-mono">{meta.glyph}</span>
            <span className="tabular-nums">{summary.counts[c]}</span>
            <span className="text-slate-500">{meta.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function KeyMoments({
  mistakes,
  ply,
  onJump,
  running,
}: {
  mistakes: MoveReview[];
  ply: number;
  onJump: (ply: number) => void;
  running: boolean;
}) {
  if (mistakes.length === 0) {
    return (
      <p className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-3 text-center text-[11px] leading-relaxed text-slate-500">
        {running
          ? "Looking for mistakes…"
          : "✓ No inaccuracies, mistakes or blunders from you in this game."}
      </p>
    );
  }
  return (
    <div>
      <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Your mistakes ({mistakes.length})
      </p>
      <ul className="flex flex-col gap-1">
        {mistakes.map((m) => {
          const meta = CLASS_META[m.classification];
          const active = ply === m.ply;
          return (
            <li key={m.index}>
              <button
                type="button"
                onClick={() => onJump(m.ply)}
                className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition ${
                  active
                    ? "border-emerald-600/70 bg-slate-800/70"
                    : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/50"
                }`}
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${meta.bg} ${meta.text}`}
                >
                  {meta.glyph}
                </span>
                <span className="w-20 shrink-0 font-mono text-[12px] text-slate-100">
                  {formatMoveSequence(m.fenBefore, [m.san])}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                  {meta.label}
                  {m.bestSan && m.bestSan !== m.san && ` · best ${m.bestSan}`}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-rose-300">
                  −{Math.round(m.winDrop)}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AnnotatedMoves({
  review,
  ply,
  userTurn,
  onJump,
}: {
  review: GameReview | null;
  ply: number;
  userTurn: Turn;
  onJump: (ply: number) => void;
}) {
  if (!review || review.moves.length === 0) {
    return (
      <p className="animate-soft-pulse py-6 text-center text-xs text-slate-500">
        Waiting for the first evaluations…
      </p>
    );
  }
  return (
    <div className="max-h-[38vh] overflow-y-auto scroll-thin">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onJump(0)}
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            ply === 0
              ? "bg-emerald-600 text-white"
              : "text-slate-400 hover:bg-slate-800"
          }`}
        >
          start
        </button>
        {review.moves.map((m) => {
          const meta = CLASS_META[m.classification];
          const isWhite = m.color === "w";
          const active = ply === m.ply;
          return (
            <span key={m.index} className="inline-flex items-center">
              {isWhite && (
                <span className="mr-0.5 select-none text-xs tabular-nums text-slate-500">
                  {Math.floor(m.index / 2) + 1}.
                </span>
              )}
              <button
                type="button"
                onClick={() => onJump(m.ply)}
                title={`${meta.label}${
                  m.bestSan && m.bestSan !== m.san ? ` · best ${m.bestSan}` : ""
                }`}
                className={`rounded px-1.5 py-0.5 font-mono text-[13px] transition ${
                  active
                    ? "bg-emerald-600 text-white"
                    : `${m.color === userTurn ? meta.text : "text-slate-400"} hover:bg-slate-800`
                }`}
              >
                {m.san}
                {/* Mark every verdict worth noticing, both sides. "good" and
                    "excellent" are the unremarkable ones — a ✓ on nearly every
                    move is just noise, so they stay bare. */}
                {m.classification !== "good" &&
                  m.classification !== "excellent" && (
                    <span className="ml-0.5 text-[10px]">{meta.glyph}</span>
                  )}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DepthSelector({
  depthId,
  onChange,
}: {
  depthId: ReviewDepthId;
  onChange: (id: ReviewDepthId) => void;
}) {
  const active = REVIEW_DEPTHS.find((d) => d.id === depthId);
  return (
    <div className="border-t border-slate-800 pt-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-slate-500">Depth</span>
        <div className="flex flex-1 rounded-md border border-slate-700 bg-slate-800/60 p-0.5 text-[11px]">
          {REVIEW_DEPTHS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onChange(d.id)}
              title={d.blurb}
              className={`flex-1 rounded px-2 py-0.5 font-medium transition ${
                depthId === d.id
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {active && (
        <p className="mt-1 text-[10px] text-slate-600">
          {active.blurb}. Changing this re-runs the review.
        </p>
      )}
    </div>
  );
}
