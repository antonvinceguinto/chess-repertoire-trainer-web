"use client";

import { useMemo, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useBookData } from "@/hooks/useBookData";
import { useNow } from "@/hooks/useNow";
import { openingNameFrom } from "@/lib/book";
import { START_FEN, formatMoveSequence, pieceAt, tryMove } from "@/lib/chess";
import {
  PIECE_NAMES,
  dayKey,
  formatDue,
  formatInterval,
  leeches,
  sideLabel,
  streakOf,
  summarize,
  type RecallCard,
  type RecallGrade,
  type RecallStatus,
} from "@/lib/memory";
import { THOROUGHNESS_LEVELS, type Thoroughness } from "@/lib/thoroughness";
import { Button, Panel } from "./ui";

export function RecallPanel({
  cards,
  level,
  onLevelChange,
}: {
  /** Every card in the active repertoire at the chosen thoroughness. */
  cards: RecallCard[];
  level: Thoroughness;
  onLevelChange: (level: Thoroughness) => void;
}) {
  const {
    recallSession,
    recallCard,
    cardStates,
    reviewDays,
    memoryPersists,
    activeRepertoire,
    startRecall,
    stopRecall,
    nextHint,
    nextCard,
    resetMemory,
  } = useTrainer();
  const book = useBookData();
  const [showWeak, setShowWeak] = useState(false);

  const now = useNow();
  const summary = useMemo(
    () => summarize(cards, cardStates, now),
    [cards, cardStates, now],
  );
  const weak = useMemo(() => leeches(cards, cardStates), [cards, cardStates]);

  // The name to hang the position on. The book doesn't name every position, so
  // fall back to the deepest one it does know along the way in — the same rule
  // `describeLines` uses. Naming it is half the point: "the Italian, after Nc6"
  // is a far better memory hook than a bare diagram.
  const opening = useMemo(() => {
    if (!book || !recallCard) return null;
    let fen = START_FEN;
    const fens = [fen];
    for (const san of recallCard.lead) {
      const mv = tryMove(fen, san);
      if (!mv) break;
      fen = mv.fen;
      fens.push(fen);
    }
    for (let i = fens.length - 1; i >= 0; i--) {
      const named = openingNameFrom(book, fens[i]);
      if (named) return named;
    }
    return null;
  }, [book, recallCard]);
  const streak = streakOf(reviewDays, now);
  const doneToday = reviewDays[dayKey(now)] ?? 0;

  if (!recallSession || !activeRepertoire) return null;

  const you = sideLabel(recallSession.color);
  const total = recallSession.queue.length;
  const answer = recallCard?.answers[0] ?? null;
  const answerMove =
    recallCard && answer ? tryMove(recallCard.fen, answer) : null;
  const hintPiece =
    recallCard && answerMove
      ? PIECE_NAMES[pieceAt(recallCard.fen, answerMove.from)?.[1] ?? ""] ?? null
      : null;
  const lead = recallCard ? formatMoveSequence(START_FEN, recallCard.lead) : "";
  const solved = recallSession.status === "solved";

  return (
    <Panel className="p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm lg:text-[15px] font-semibold text-slate-100">
            Recall · {activeRepertoire.name}
          </h2>
          <p className="text-[12px] lg:text-[13px] text-slate-500">
            One position at a time, scheduled by how well you remember it.
          </p>
        </div>
        <div
          className="shrink-0 text-right"
          title={`${doneToday} card${doneToday === 1 ? "" : "s"} reviewed today`}
        >
          <div className="text-base font-bold tabular-nums text-amber-300">
            🔥 {streak}
          </div>
          <div className="text-[11px] lg:text-[12px] uppercase text-slate-500">
            day streak
          </div>
        </div>
      </div>

      <MemoryBar summary={summary} />

      {!memoryPersists && (
        <p className="mb-3 rounded-md border border-amber-700/50 bg-amber-950/30 px-2.5 py-1.5 text-[12px] lg:text-[13px] text-amber-200">
          This browser is blocking local storage, so today&apos;s progress
          won&apos;t survive a reload.
        </p>
      )}

      {/* Scope — the same thoroughness filter Train uses. */}
      <div className="mb-3 flex items-center gap-2">
        <span className="shrink-0 text-[12px] lg:text-[13px] text-slate-500">
          Cover
        </span>
        <div className="flex flex-1 rounded-md border border-slate-700 bg-slate-800/60 p-0.5 text-[12px] lg:text-[13px]">
          {THOROUGHNESS_LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onLevelChange(l.id)}
              title={l.blurb}
              className={`flex-1 rounded px-2 py-0.5 font-medium transition ${
                level === l.id
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <span
          className="shrink-0 text-[12px] lg:text-[13px] tabular-nums text-slate-500"
          title="Positions in your memory deck at this level"
        >
          {summary.total}
        </span>
      </div>

      {recallSession.status === "empty" ? (
        <CaughtUp
          summary={summary}
          now={now}
          hasCards={cards.length > 0}
          onPractise={() => startRecall(cards, { ignoreSchedule: true })}
          onExit={stopRecall}
        />
      ) : recallSession.status === "done" ? (
        <Finished
          recalled={recallSession.recalled}
          forgotten={recallSession.forgotten}
          onAgain={() => startRecall(cards)}
          onPractise={() => startRecall(cards, { ignoreSchedule: true })}
          onExit={stopRecall}
        />
      ) : (
        <>
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-[12px] lg:text-[13px] text-slate-400">
              <span>
                Card{" "}
                <span className="font-semibold text-slate-200">
                  {recallSession.index + 1}
                </span>{" "}
                of {total}
              </span>
              <span className="text-slate-500">
                {recallSession.extra ? "extra practice" : "scheduled review"}
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${(recallSession.index / total) * 100}%` }}
              />
            </div>
          </div>

          {/* The question. Naming the position before the move is the point:
              it's the label you'll actually recall from over the board. */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5">
            <div className="text-[12px] lg:text-[13px] uppercase tracking-wide text-slate-500">
              {opening?.name ?? (lead ? "Your move" : "Move one")}
              {opening?.eco ? (
                <span className="ml-1.5 font-mono text-slate-600">
                  {opening.eco}
                </span>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-[14px] lg:text-[15px] text-slate-300">
              {lead || "— from the starting position —"}
            </p>
          </div>

          <Banner
            status={recallSession.status}
            you={you}
            lastWrong={recallSession.lastWrong}
            grade={recallSession.grade}
            answers={recallCard?.answers ?? []}
            nextInterval={recallSession.nextInterval}
          />

          {/* Hint ladder: each rung gives away more and costs you the interval. */}
          {!solved && (
            <div className="mt-3">
              {recallSession.hint >= 1 && (
                <p className="mb-2 rounded-md border border-purple-700/40 bg-purple-950/25 px-2.5 py-1.5 text-[13px] lg:text-sm text-purple-200">
                  {recallSession.hint === 1
                    ? `Move a ${hintPiece ?? "piece"}.`
                    : recallSession.hint === 2
                      ? `Move the ${hintPiece ?? "piece"} highlighted on the board.`
                      : `Play ${answer} — the arrow shows it. Make the move to lock it in.`}
                </p>
              )}
              <Button
                variant="secondary"
                onClick={nextHint}
                disabled={recallSession.hint >= 3}
                title="Give away one more rung of the answer (h)"
              >
                {recallSession.hint === 0
                  ? "💡 Hint"
                  : recallSession.hint === 1
                    ? "💡 Show me the piece"
                    : recallSession.hint === 2
                      ? "💡 Show me the move"
                      : "💡 Answer shown"}
              </Button>
            </div>
          )}

          {solved && (
            <div className="mt-4">
              <Button variant="primary" onClick={nextCard} title="Next card (Enter)">
                {recallSession.index + 1 >= total ? "Finish set →" : "Next card →"}
              </Button>
            </div>
          )}
        </>
      )}

      {weak.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={() => setShowWeak((v) => !v)}
            className="flex w-full items-center justify-between text-[12px] lg:text-[13px] text-slate-400 hover:text-slate-200"
          >
            <span>
              ⚠️ {weak.length} position{weak.length === 1 ? "" : "s"} you keep
              forgetting
            </span>
            <span className="text-slate-600">{showWeak ? "▲" : "▼"}</span>
          </button>
          {showWeak && (
            <ul className="mt-2 space-y-1">
              {weak.slice(0, 6).map(({ card, state }) => (
                <li
                  key={card.key}
                  className="flex items-baseline justify-between gap-2 rounded-md bg-slate-900/60 px-2 py-1"
                >
                  <span className="truncate font-mono text-[12px] lg:text-[13px] text-slate-400">
                    {formatMoveSequence(START_FEN, card.lead) || "start"}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] lg:text-[13px] font-semibold text-emerald-300">
                    {card.answers[0]}
                    <span className="ml-1.5 font-sans font-normal text-rose-400">
                      ×{state.lapses}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {showWeak && (
            <p className="mt-2 text-[12px] lg:text-[13px] leading-relaxed text-slate-500">
              Repeating these won&apos;t help much — go to Build mode, play the
              position out with the engine and the book, and learn what the move
              is <em>for</em>. Then they stop coming back.
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Forget everything ${activeRepertoire.name} has learnt? Your lines stay; only the review schedule is wiped.`,
              )
            ) {
              resetMemory();
            }
          }}
          className="text-[12px] lg:text-[13px] text-slate-600 underline-offset-2 hover:text-rose-300 hover:underline"
        >
          Reset schedule
        </button>
        <Button variant="ghost" onClick={stopRecall} className="ml-auto">
          ← Exit recall
        </Button>
      </div>
    </Panel>
  );
}

function Banner({
  status,
  you,
  lastWrong,
  grade,
  answers,
  nextInterval,
}: {
  status: RecallStatus;
  you: string;
  lastWrong: string | null;
  grade: RecallGrade | null;
  answers: string[];
  nextInterval: number | null;
}) {
  if (status === "solved") {
    const others = answers.slice(1);
    const tone =
      grade === "good"
        ? "border-emerald-600/50 bg-emerald-600/15 text-emerald-200"
        : grade === "hard"
          ? "border-amber-600/50 bg-amber-600/15 text-amber-200"
          : "border-slate-600/50 bg-slate-700/25 text-slate-300";
    return (
      <div className={`mt-3 rounded-lg border px-3 py-2.5 text-sm lg:text-[15px] ${tone}`}>
        <span className="font-semibold">
          {grade === "good"
            ? "✓ Straight from memory."
            : grade === "hard"
              ? "✓ Right, with help."
              : "✓ Got there — but that one isn't stuck yet."}
        </span>{" "}
        {nextInterval != null && (
          <span className="text-slate-400">Back {formatInterval(nextInterval)}.</span>
        )}
        {others.length > 0 && (
          <span className="text-slate-400">
            {" "}
            You also play {others.join(" / ")} here.
          </span>
        )}
      </div>
    );
  }

  if (status === "wrong") {
    return (
      <div className="mt-3 rounded-lg border border-rose-600/50 bg-rose-600/15 px-3 py-2.5 text-sm lg:text-[15px] text-rose-200">
        {`✗ ${lastWrong} isn't your move here. Try again, or take a hint.`}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2.5 text-sm lg:text-[15px] text-emerald-100">
      You&apos;re {you}. What do you play?
    </div>
  );
}

/** Deck health: how much of the repertoire is actually committed to memory. */
function MemoryBar({
  summary,
}: {
  summary: ReturnType<typeof summarize>;
}) {
  const { total } = summary;
  const seg = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-[12px] lg:text-[13px]">
        <span className="text-slate-400">
          Memorised{" "}
          <span className="font-semibold text-slate-200 tabular-nums">
            {Math.round(summary.retention * 100)}%
          </span>
        </span>
        <span className="tabular-nums text-slate-500">
          {summary.due} due · {summary.new} new
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-emerald-500" style={{ width: `${seg(summary.known)}%` }} />
        <div className="h-full bg-emerald-700" style={{ width: `${seg(summary.young)}%` }} />
        <div className="h-full bg-amber-600" style={{ width: `${seg(summary.learning)}%` }} />
      </div>
      <div className="mt-1 flex gap-3 text-[11px] lg:text-[12px] text-slate-500">
        <Legend colour="bg-emerald-500" label="known" n={summary.known} />
        <Legend colour="bg-emerald-700" label="learning" n={summary.young} />
        <Legend colour="bg-amber-600" label="shaky" n={summary.learning} />
        <Legend colour="bg-slate-800" label="new" n={summary.new} />
      </div>
    </div>
  );
}

function Legend({
  colour,
  label,
  n,
}: {
  colour: string;
  label: string;
  n: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-sm ${colour}`} />
      {n} {label}
    </span>
  );
}

function CaughtUp({
  summary,
  now,
  hasCards,
  onPractise,
  onExit,
}: {
  summary: ReturnType<typeof summarize>;
  now: number;
  hasCards: boolean;
  onPractise: () => void;
  onExit: () => void;
}) {
  if (!hasCards) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm lg:text-[15px] text-slate-300">
        This repertoire has no moves of your own yet — add some lines in Build
        mode and they&apos;ll turn up here as cards.
        <div className="mt-3">
          <Button variant="primary" onClick={onExit}>
            Go to Build mode
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-600/50 bg-emerald-600/15 px-3 py-2.5 text-sm lg:text-[15px] text-emerald-200">
      ✓ Nothing due — you&apos;re on top of this repertoire.
      {summary.nextDue != null && (
        <span className="text-slate-400">
          {" "}
          Next review {formatDue(summary.nextDue, now)}.
        </span>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onPractise}>
          Drill the shakiest anyway
        </Button>
        <Button variant="ghost" onClick={onExit}>
          ← Exit recall
        </Button>
      </div>
    </div>
  );
}

function Finished({
  recalled,
  forgotten,
  onAgain,
  onPractise,
  onExit,
}: {
  recalled: number;
  forgotten: number;
  onAgain: () => void;
  onPractise: () => void;
  onExit: () => void;
}) {
  const answered = recalled + forgotten;
  const rate = answered > 0 ? Math.round((recalled / answered) * 100) : 0;
  return (
    <div className="rounded-lg border border-emerald-600/50 bg-emerald-600/15 px-3 py-3 text-sm lg:text-[15px] text-emerald-200">
      <p className="font-semibold">✓ Set complete — {rate}% from memory.</p>
      <p className="mt-1 text-[13px] lg:text-sm text-slate-400">
        {recalled} recalled, {forgotten} needed relearning. Every card you got is
        now scheduled further out; the ones you missed come back soon.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onAgain}>
          Next set →
        </Button>
        <Button variant="secondary" onClick={onPractise}>
          Drill the shakiest
        </Button>
        <Button variant="ghost" onClick={onExit}>
          ← Exit
        </Button>
      </div>
    </div>
  );
}
