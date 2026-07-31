"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useEngine } from "@/hooks/useEngine";
import { useCoverage } from "@/hooks/useCoverage";
import { useBookData } from "@/hooks/useBookData";
import { useNow } from "@/hooks/useNow";
import { REVIEW_DEPTH, useGameReview } from "@/hooks/useGameReview";
import { useMoveReview } from "@/hooks/useMoveReview";
import type { ChessComGame } from "@/lib/chesscom";
import { importantLines } from "@/lib/lines";
import { collectCards, summarize } from "@/lib/memory";
import { enumerateLines } from "@/lib/repertoire";
import {
  DEFAULT_THOROUGHNESS,
  minImportanceFor,
  THOROUGHNESS_KEY,
  type Thoroughness,
} from "@/lib/thoroughness";
import type { Mode } from "@/lib/types";
import { BoardPanel } from "./BoardPanel";
import { MoveList } from "./MoveList";
import { EnginePanel } from "./EnginePanel";
import { BookPanel } from "./BookPanel";
import { CoveragePanel } from "./CoveragePanel";
import { GameBrowser } from "./GameBrowser";
import { RepertoireSelect } from "./RepertoireSelect";
import { RepertoirePanel } from "./RepertoirePanel";
import { ReviewPanel } from "./ReviewPanel";
import { TrainPanel } from "./TrainPanel";
import { RecallPanel } from "./RecallPanel";
import { FixPanel } from "./FixPanel";

type Tab = "analysis" | "repertoire" | "gaps";

// Persisted preference: whether Stockfish runs at all. Off = a purely book-driven
// workflow (no evals, no danger scoring, worker never loaded).
const ENGINE_KEY = "chess-engine-enabled";
// Persisted preference: whether to grade moves with chess.com-style reactions.
const REVIEW_KEY = "chess-move-review";

export function ChessTrainer() {
  const {
    fen,
    line,
    mode,
    activeRepertoire,
    startTraining,
    stopTraining,
    startRecall,
    stopRecall,
    cardStates,
    fixQueue,
    startFix,
    setMode,
    reviewSession,
    startReview,
    exitReview,
    inVariation,
  } = useTrainer();
  const book = useBookData();
  const now = useNow();

  const [engineOn, setEngineOnState] = useState(true);
  const [reviewOn, setReviewOnState] = useState(true);
  const [multipv, setMultipv] = useState(3);
  const [tab, setTab] = useState<Tab>("analysis");
  const [gameLoadError, setGameLoadError] = useState<string | null>(null);
  const [thoroughness, setThoroughness] = useState<Thoroughness>(
    DEFAULT_THOROUGHNESS,
  );
  const [bookHidden, setBookHidden] = useState(false);
  // Persisted prefs live in localStorage, which is only readable after mount.
  // Until we've read them, keep the engine dormant so a saved "off" choice never
  // spins up (then tears down) a Stockfish worker on load.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THOROUGHNESS_KEY);
      if (saved === "club" || saved === "tournament" || saved === "master") {
        setThoroughness(saved);
      }
      // Restore a previously chosen book-only (engine off) preference.
      if (window.localStorage.getItem(ENGINE_KEY) === "0") setEngineOnState(false);
      // Restore the move-review (reactions) preference.
      if (window.localStorage.getItem(REVIEW_KEY) === "0") setReviewOnState(false);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const setEngineOn = (on: boolean) => {
    setEngineOnState(on);
    try {
      window.localStorage.setItem(ENGINE_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const setReviewOn = (on: boolean) => {
    setReviewOnState(on);
    try {
      window.localStorage.setItem(REVIEW_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const changeThoroughness = (t: Thoroughness) => {
    setThoroughness(t);
    try {
      window.localStorage.setItem(THOROUGHNESS_KEY, t);
    } catch {
      /* ignore */
    }
  };

  // The lines Train drills at the chosen level (all lines until the book loads).
  const linesFor = (level: Thoroughness) =>
    activeRepertoire
      ? book
        ? importantLines(activeRepertoire, book, minImportanceFor(level))
        : enumerateLines(activeRepertoire)
      : [];
  const trainableLines = useMemo(
    () => linesFor(thoroughness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRepertoire, book, thoroughness],
  );

  // The positions Recall schedules, filtered by the same level. Every position
  // where it's your move and you have an answer saved becomes one card.
  const cardsFor = (level: Thoroughness) => {
    if (!activeRepertoire) return [];
    const all = collectCards(activeRepertoire, book);
    if (!book) return all;
    const min = minImportanceFor(level);
    const kept = all.filter((c) => c.importance >= min);
    // Same fallback as `importantLines`: a cutoff that filters everything out
    // would leave nothing to drill at all.
    return kept.length > 0 ? kept : all;
  };
  const recallCards = useMemo(
    () => cardsFor(thoroughness),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRepertoire, book, thoroughness],
  );

  // Positions waiting for attention — overdue reviews plus material never seen.
  // Drives the badge on the Recall tab, so the work to do is visible from Build.
  const dueCount = useMemo(() => {
    const s = summarize(recallCards, cardStates, now);
    return s.due + s.new;
  }, [recallCards, cardStates, now]);

  // Changing the level while drilling restarts it with the new set.
  const changeTrainLevel = (level: Thoroughness) => {
    changeThoroughness(level);
    if (mode === "train") startTraining(linesFor(level));
    if (mode === "recall") startRecall(cardsFor(level));
  };

  // If a drill was started before the book loaded (so it fell back to the whole
  // repertoire), re-derive the level-filtered set once the book arrives.
  const bookSyncedRef = useRef(false);
  useEffect(() => {
    if (!book || bookSyncedRef.current) return;
    bookSyncedRef.current = true;
    if (mode === "train") startTraining(linesFor(thoroughness));
    if (mode === "recall") startRecall(cardsFor(thoroughness));
    // Fire once, on the book's first load, using the values current at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // Stockfish runs only while building with the engine turned on, and only once
  // the persisted preference has been read (so a saved "off" never briefly boots
  // the worker). Turning it off is a global, persisted choice that drops the
  // whole app into a book-only workflow (gap-fixing included) — nothing here
  // re-enables it behind the user's back.
  //
  // Review is the one exception, and only inside a side line: the whole mode is
  // engine-driven (the sweep below ignores `engineOn` too), the sweep has no
  // data off the game, and the toggle lives in a panel review doesn't render.
  const engineEnabled =
    (engineOn && hydrated && mode === "build") ||
    (mode === "review" && inVariation);
  const { status, evaluation } = useEngine(fen, engineEnabled, multipv);

  // Move review runs its own background engine to grade every move in the
  // current line — only while building with the engine on (not during a fix).
  // Both sides are graded: while building you play the whole line yourself, and
  // an opponent's blunder is exactly what the review should surface.
  // `mode === "build"` is explicit because engineEnabled is now also true inside
  // a review side line, and grading the board there is the game review's job.
  const reviewEnabled =
    engineEnabled && mode === "build" && reviewOn && !fixQueue;
  const review = useMoveReview(line, reviewEnabled, book);

  const {
    gaps,
    progress,
    ready: gapsReady,
    error: gapsError,
  } = useCoverage(activeRepertoire, minImportanceFor(thoroughness));

  // Whole-game review runs on its own Stockfish instance, so it never competes
  // with the live analysis engine above. Named `gameReview` to keep it distinct
  // from `review` above, which is the per-move grading of the build-mode line.
  const { review: gameReview, progress: reviewProgress } = useGameReview(
    reviewSession?.game ?? null,
    mode === "review",
    REVIEW_DEPTH,
    book,
  );

  // Tapping a single gap row reproduces it as a one-gap guided fix: the board
  // pins to the position and the suggested replies are one tap from being saved.
  const prepareGap = (sans: string[]) => {
    startFix([sans]);
  };

  const openGame = (game: ChessComGame, username: string) => {
    setGameLoadError(
      startReview(game, username)
        ? null
        : "That game's PGN couldn't be read — try another one.",
    );
  };

  const goBuild = () => {
    exitReview();
    stopTraining();
    stopRecall();
  };

  // The opening book sits in its own left column while building; during
  // training / gap-fixing / review the board takes over that space.
  const buildBoard = mode === "build" && !fixQueue;
  const showBook = buildBoard && !bookHidden;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1760px] px-3 py-4 sm:px-5">
      <Header
        mode={mode}
        canTrain={!!activeRepertoire}
        dueCount={dueCount}
        onBuild={goBuild}
        onTrain={() => startTraining(trainableLines)}
        onRecall={() => startRecall(recallCards)}
        onReview={() => setMode("review")}
      />

      <div
        className={`mt-4 grid grid-cols-1 gap-4 ${
          showBook
            ? "xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(360px,440px)]"
            : "lg:grid-cols-[minmax(320px,1fr)_minmax(360px,440px)]"
        }`}
      >
        {/* Left column: opening book (build mode only) */}
        {showBook && (
          <aside className="order-3 xl:order-1">
            <BookPanel
              evaluation={evaluation}
              onHide={() => setBookHidden(true)}
            />
          </aside>
        )}

        {/* Centre: board */}
        <div className="order-1 flex max-w-full flex-col items-center xl:order-2">
          {buildBoard && bookHidden && (
            <div className="mb-2 flex w-full justify-start">
              <button
                type="button"
                onClick={() => setBookHidden(false)}
                className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
                title="Show the opening book"
              >
                ← Show opening book
              </button>
            </div>
          )}
          <BoardPanel
            evaluation={evaluation}
            engineStatus={status}
            engineEnabled={engineEnabled}
            review={mode === "review" ? gameReview : null}
            moveClasses={reviewEnabled ? review.classes : undefined}
          />
        </div>

        {/* Right column: panels */}
        <div className="order-2 flex flex-col gap-3 xl:order-3">
          {mode !== "review" && <RepertoireSelect />}

          {mode === "review" ? (
            reviewSession ? (
              <ReviewPanel
                review={gameReview}
                progress={reviewProgress}
              />
            ) : (
              <GameBrowser onSelect={openGame} loadError={gameLoadError} />
            )
          ) : mode === "train" ? (
            <TrainPanel
              level={thoroughness}
              onLevelChange={changeTrainLevel}
            />
          ) : mode === "recall" ? (
            <RecallPanel
              cards={recallCards}
              level={thoroughness}
              onLevelChange={changeTrainLevel}
            />
          ) : fixQueue ? (
            <FixPanel evaluation={evaluation} status={status} engineOn={engineOn} />
          ) : (
            <>
              <MoveList
                classes={review.classes}
                reviewOn={reviewOn}
                onToggleReview={setReviewOn}
                reviewAvailable={engineOn}
                reviewBusy={review.busy}
              />

              <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/40 p-1 text-sm">
                {(["analysis", "repertoire", "gaps"] as Tab[]).map((tb) => (
                  <button
                    key={tb}
                    type="button"
                    onClick={() => setTab(tb)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium capitalize transition ${
                      tab === tb
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {tb}
                    {tb === "gaps" && gaps.length > 0 && (
                      <span className="rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-300">
                        {gaps.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {tab === "analysis" && (
                <EnginePanel
                  evaluation={evaluation}
                  status={status}
                  engineOn={engineOn}
                  setEngineOn={setEngineOn}
                  multipv={multipv}
                  setMultipv={setMultipv}
                />
              )}

              {tab === "repertoire" && <RepertoirePanel />}

              {tab === "gaps" && (
                <CoveragePanel
                  progress={progress}
                  gaps={gaps}
                  ready={gapsReady}
                  error={gapsError}
                  level={thoroughness}
                  onLevelChange={changeThoroughness}
                  onPrepare={prepareGap}
                  onStartFix={startFix}
                  engineAvailable={engineOn}
                />
              )}
            </>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}

function Header({
  mode,
  canTrain,
  dueCount,
  onBuild,
  onTrain,
  onRecall,
  onReview,
}: {
  mode: Mode;
  canTrain: boolean;
  dueCount: number;
  onBuild: () => void;
  onTrain: () => void;
  onRecall: () => void;
  onReview: () => void;
}) {
  const tab = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
      active ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-100">
          <span className="text-2xl">♞</span> Opening Trainer
        </h1>
        <p className="text-xs text-slate-500">
          Build your repertoire with Stockfish &amp; the Lichess explorer, commit
          it to memory, then review your real games.
        </p>
      </div>

      <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-1">
        <button type="button" onClick={onBuild} className={tab(mode === "build")}>
          🛠 Build
        </button>
        <button
          type="button"
          onClick={onRecall}
          disabled={!canTrain}
          title={
            canTrain
              ? "Spaced repetition — drill the positions you're about to forget"
              : "Create a repertoire first"
          }
          className={tab(mode === "recall")}
        >
          🧠 Recall
          {canTrain && dueCount > 0 && (
            <span
              className={`rounded-full px-1.5 text-[10px] font-bold ${
                mode === "recall"
                  ? "bg-emerald-800 text-emerald-100"
                  : "bg-emerald-500/20 text-emerald-300"
              }`}
            >
              {dueCount > 99 ? "99+" : dueCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onTrain}
          disabled={!canTrain}
          title={canTrain ? "Play whole lines end to end" : "Create a repertoire first"}
          className={tab(mode === "train")}
        >
          🎯 Train
        </button>
        <button
          type="button"
          onClick={onReview}
          title="Analyse your own Chess.com games"
          className={tab(mode === "review")}
        >
          🔍 Review
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-6 text-center text-[11px] text-slate-600">
      Analysis by Stockfish 18 (WASM, in-browser). Opening statistics from the
      Lichess opening explorer. Game history from the public Chess.com API.
      Repertoires are saved locally in your browser.
    </footer>
  );
}
