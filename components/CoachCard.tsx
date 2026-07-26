"use client";

import { useTrainer } from "@/context/TrainerContext";
import { explainMove } from "@/lib/coach";
import { formatMoveSequence } from "@/lib/chess";
import { CLASS_META, type MoveReview } from "@/lib/review";
import { Button } from "./ui";

interface Props {
  /** The move that led to the position now on the board (null at move 0). */
  move: MoveReview | null;
  /** Whether that move was the looked-up player's. */
  isUser: boolean;
  /** Still sweeping the game — this move may not be judged yet. */
  analyzing: boolean;
}

/** "17...Nf6" for a single move, using its own move number. */
function label(move: MoveReview): string {
  return formatMoveSequence(move.fenBefore, [move.san]);
}

/**
 * The coach. For each of your moves it says what happened in plain language,
 * what to play instead, and offers to either show you the line or make you
 * find it yourself. Explanations are generated from the position and the
 * engine's own lines — nothing is invented.
 */
export function CoachCard({ move, isUser, analyzing }: Props) {
  const {
    reviewChallenge,
    startChallenge,
    endChallenge,
    playVariation,
    inVariation,
    restoreGame,
  } = useTrainer();

  if (inVariation) {
    return (
      <div className="rounded-lg border border-sky-800/70 bg-sky-950/30 p-3">
        <p className="text-[13px] font-semibold text-sky-200">
          This is the line the engine wanted.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Step through it with the arrow keys, then head back to what actually
          happened in your game.
        </p>
        <Button
          variant="secondary"
          onClick={() => restoreGame()}
          className="mt-2 w-full !py-1.5 text-xs"
        >
          ← Back to the game
        </Button>
      </div>
    );
  }

  if (reviewChallenge && move && reviewChallenge.index === move.index) {
    return (
      <ChallengeCard
        move={move}
        status={reviewChallenge.status}
        lastWrong={reviewChallenge.lastWrong}
        onGiveUp={() => playVariation(move.index, move.bestPv)}
        onDismiss={endChallenge}
      />
    );
  }

  if (!move) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <p className="text-[13px] font-semibold text-slate-200">
          Starting position
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Step forward through the game, or jump straight to a mistake below.
          The coach explains every move as you land on it.
        </p>
      </div>
    );
  }

  const meta = CLASS_META[move.classification];

  if (!isUser) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <Heading move={move} meta={meta} who="Opponent" />
        <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">
          {move.classification === "blunder" || move.classification === "mistake"
            ? `Your opponent slipped here — the position swung ${Math.round(move.winDrop)}% in your favour. ${
                move.bestSan ? `They should have played ${move.bestSan}.` : ""
              }`
            : move.book
              ? "Still opening theory."
              : `Their move keeps things where they were${
                  move.bestSan && move.bestSan !== move.san
                    ? `; the engine's pick was ${move.bestSan}.`
                    : "."
                }`}
        </p>
      </div>
    );
  }

  const advice = explainMove(move);
  const flagged = ["blunder", "mistake", "inaccuracy"].includes(
    move.classification,
  );

  return (
    <div
      className={`rounded-lg border p-3 ${
        flagged
          ? "border-rose-900/50 bg-rose-950/20"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <Heading move={move} meta={meta} who="You" />

      <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-100">
        {analyzing && move.bestSan == null ? "Still analysing…" : advice.headline}
      </p>

      {advice.points.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {advice.points.map((p, i) => (
            <li
              key={i}
              className="flex gap-1.5 text-[12px] leading-relaxed text-slate-400"
            >
              <span className="shrink-0 text-slate-600">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {advice.betterLine && (
        <div className="mt-2 rounded-md border border-emerald-900/50 bg-emerald-950/25 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
            Play instead
          </p>
          <p className="mt-0.5 font-mono text-[12px] leading-relaxed text-emerald-200">
            {advice.betterLine}
          </p>
        </div>
      )}

      {advice.takeaway && (
        <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] italic leading-relaxed text-slate-500">
          💡 {advice.takeaway}
        </p>
      )}

      {move.bestSan && move.bestSan !== move.san && (
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="primary"
            onClick={() => startChallenge(move.index, move.bestSan as string)}
            className="flex-1 !py-1.5 text-xs"
            title="Go back to that position and find the move yourself"
          >
            🎯 Let me try
          </Button>
          <Button
            variant="secondary"
            onClick={() => playVariation(move.index, move.bestPv)}
            disabled={move.bestPv.length === 0}
            className="flex-1 !py-1.5 text-xs"
            title="Play the engine's line out on the board"
          >
            ▶ Show the line
          </Button>
        </div>
      )}
    </div>
  );
}

function Heading({
  move,
  meta,
  who,
}: {
  move: MoveReview;
  meta: (typeof CLASS_META)[keyof typeof CLASS_META];
  who: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${meta.bg} ${meta.text}`}
      >
        {meta.glyph} {meta.label}
      </span>
      <span className="font-mono text-[14px] font-semibold text-slate-100">
        {label(move)}
      </span>
      <span className="ml-auto text-[10px] text-slate-500">{who}</span>
    </div>
  );
}

function ChallengeCard({
  move,
  status,
  lastWrong,
  onGiveUp,
  onDismiss,
}: {
  move: MoveReview;
  status: "waiting" | "correct" | "wrong";
  lastWrong: string | null;
  onGiveUp: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/25 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
        Your turn
      </p>
      <p className="mt-1 text-[13px] font-semibold leading-snug text-slate-100">
        You played {move.san} here. Find the move you should have played.
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        Play it on the board — the game stays where it is either way.
      </p>

      {status === "correct" && (
        <p className="mt-2 rounded-md bg-emerald-600/20 px-2.5 py-2 text-[12px] font-semibold text-emerald-200">
          ✓ That&apos;s it — {move.bestSan} is the move.
        </p>
      )}
      {status === "wrong" && (
        <p className="mt-2 rounded-md bg-rose-600/15 px-2.5 py-2 text-[12px] text-rose-200">
          {lastWrong} isn&apos;t it. Look for the most forcing option — check
          every capture and check first.
        </p>
      )}

      <div className="mt-2 flex gap-1.5">
        {status === "correct" ? (
          <Button
            variant="primary"
            onClick={onGiveUp}
            className="flex-1 !py-1.5 text-xs"
          >
            ▶ See the follow-up
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={onGiveUp}
            className="flex-1 !py-1.5 text-xs"
          >
            Show me
          </Button>
        )}
        <Button variant="ghost" onClick={onDismiss} className="!py-1.5 text-xs">
          ✕ Done
        </Button>
      </div>
    </div>
  );
}
