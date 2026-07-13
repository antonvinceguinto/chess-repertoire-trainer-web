"use client";

import { useTrainer } from "@/context/TrainerContext";
import { childrenAt } from "@/lib/repertoire";
import { START_FEN, formatMoveSequence } from "@/lib/chess";
import { Button, Panel } from "./ui";

export function TrainPanel() {
  const {
    session,
    turn,
    ply,
    activeRepertoire,
    currentSans,
    revealAnswer,
    restartLine,
    nextTrainingLine,
    prevTrainingLine,
    stopTraining,
    startTraining,
  } = useTrainer();

  if (!session || !activeRepertoire) return null;

  const userChar = session.color === "white" ? "w" : "b";
  const yourTurn = turn === userChar;
  const sequence = formatMoveSequence(START_FEN, currentSans);
  const totalLines = session.lines.length;
  const targetLine = session.lines[session.lineIndex];
  const expected = targetLine?.[ply] ?? null;

  // Distinguish "wrong move that IS in your repertoire (just a different line)"
  // from a move that isn't prepared at all.
  const children = childrenAt(activeRepertoire, currentSans) ?? [];
  const wrongInRep =
    session.lastWrong != null && children.some((c) => c.san === session.lastWrong);

  const isLastLine = session.lineIndex === totalLines - 1;

  let banner: { text: string; tone: string };
  switch (session.status) {
    case "empty":
      banner = {
        text: "This repertoire has no lines yet — add some moves in Build mode first.",
        tone: "border-slate-700 bg-slate-800/60 text-slate-300",
      };
      break;
    case "complete":
      banner = {
        text: isLastLine
          ? "✓ Line complete! That was the last line — you've drilled the whole repertoire."
          : "✓ Line complete! Move on to the next line.",
        tone: "border-emerald-600/50 bg-emerald-600/15 text-emerald-200",
      };
      break;
    case "wrong":
      banner = {
        text: wrongInRep
          ? `↺ ${session.lastWrong} is in your repertoire, but a different line needs another move here. Try again.`
          : `✗ ${session.lastWrong} isn't in your repertoire here. Try again.`,
        tone: "border-rose-600/50 bg-rose-600/15 text-rose-200",
      };
      break;
    default:
      banner = yourTurn
        ? {
            text: "Your move — play your prepared repertoire move.",
            tone: "border-emerald-600/40 bg-emerald-600/10 text-emerald-100",
          }
        : {
            text: "Opponent is replying…",
            tone: "border-slate-700 bg-slate-800/60 text-slate-300 animate-soft-pulse",
          };
  }

  const showReveal =
    expected != null &&
    (session.status === "wrong" || (yourTurn && session.status === "playing"));

  return (
    <Panel className="p-3">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Training · {activeRepertoire.name}
          </h2>
          <p className="text-[11px] text-slate-500">
            Playing as {session.color}. Recall your moves from memory.
          </p>
        </div>
        <div className="flex gap-3 text-center text-xs">
          <div>
            <div className="font-bold tabular-nums text-emerald-400">
              {session.correct}
            </div>
            <div className="text-[10px] uppercase text-slate-500">correct</div>
          </div>
          <div>
            <div className="font-bold tabular-nums text-rose-400">
              {session.mistakes}
            </div>
            <div className="text-[10px] uppercase text-slate-500">missed</div>
          </div>
        </div>
      </div>

      {/* Line progress */}
      {totalLines > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Line{" "}
              <span className="font-semibold text-slate-200">
                {session.lineIndex + 1}
              </span>{" "}
              of {totalLines}
            </span>
            <span className="text-slate-500">drilled in order</span>
          </div>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{
                width: `${((session.lineIndex + 1) / totalLines) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className={`rounded-lg border px-3 py-2.5 text-sm ${banner.tone}`}>
        {banner.text}
      </div>

      {sequence && (
        <p className="mt-3 rounded-md bg-slate-900/60 px-2 py-1.5 font-mono text-[13px] text-slate-300">
          {sequence}
        </p>
      )}

      {session.revealed && expected && (
        <div className="mt-3 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm">
          <span className="text-xs text-slate-400">Play here: </span>
          <span className="font-mono font-semibold text-emerald-300">
            {expected}
          </span>
        </div>
      )}

      {/* Primary actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {session.status === "complete" ? (
          <>
            <Button variant="primary" onClick={nextTrainingLine} disabled={totalLines <= 1}>
              → Next line
            </Button>
            <Button variant="secondary" onClick={restartLine}>
              ↻ Repeat line
            </Button>
          </>
        ) : (
          <>
            {showReveal && !session.revealed && (
              <Button variant="secondary" onClick={revealAnswer}>
                💡 Reveal answer
              </Button>
            )}
            {session.status !== "empty" && (
              <Button variant="secondary" onClick={restartLine}>
                ↻ Restart line
              </Button>
            )}
          </>
        )}
        {session.status === "empty" && (
          <Button variant="primary" onClick={stopTraining}>
            Go to Build mode
          </Button>
        )}
      </div>

      {/* Line stepper */}
      {totalLines > 1 && (
        <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
          <Button variant="ghost" onClick={prevTrainingLine} title="Previous line">
            ← Prev
          </Button>
          <span className="flex-1 text-center text-[11px] tabular-nums text-slate-500">
            {session.lineIndex + 1} / {totalLines}
          </span>
          <Button variant="ghost" onClick={nextTrainingLine} title="Next line">
            Next →
          </Button>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={startTraining}
          className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Restart from line 1
        </button>
        <Button variant="ghost" onClick={stopTraining} className="ml-auto">
          ← Exit training
        </Button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Lines are drilled one at a time, in order. The app plays the
        opponent&apos;s moves for the current line while you recall yours. Use{" "}
        <span className="text-slate-400">Next line</span> to work through your
        entire repertoire.
      </p>
    </Panel>
  );
}
