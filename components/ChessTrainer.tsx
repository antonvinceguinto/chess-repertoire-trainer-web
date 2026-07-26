"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useEngine } from "@/hooks/useEngine";
import { useCoverage } from "@/hooks/useCoverage";
import { useBookData } from "@/hooks/useBookData";
import {
  DEFAULT_REVIEW_DEPTH,
  depthFor,
  useGameReview,
  type ReviewDepthId,
} from "@/hooks/useGameReview";
import type { ChessComGame } from "@/lib/chesscom";
import { importantLines } from "@/lib/lines";
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
import { FixPanel } from "./FixPanel";

type Tab = "analysis" | "repertoire" | "gaps";

export function ChessTrainer() {
  const {
    fen,
    mode,
    activeRepertoire,
    playLineSans,
    startTraining,
    stopTraining,
    fixQueue,
    startFix,
    setMode,
    reviewSession,
    startReview,
    exitReview,
    inVariation,
  } = useTrainer();
  const book = useBookData();

  const [engineOn, setEngineOn] = useState(true);
  const [multipv, setMultipv] = useState(3);
  const [tab, setTab] = useState<Tab>("analysis");
  const [reviewDepth, setReviewDepth] =
    useState<ReviewDepthId>(DEFAULT_REVIEW_DEPTH);
  const [gameLoadError, setGameLoadError] = useState<string | null>(null);
  const [thoroughness, setThoroughness] = useState<Thoroughness>(
    DEFAULT_THOROUGHNESS,
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(THOROUGHNESS_KEY);
    if (saved === "club" || saved === "tournament" || saved === "master") {
      setThoroughness(saved);
    }
  }, []);

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

  // Changing the level while training restarts the drill with the new set.
  const changeTrainLevel = (level: Thoroughness) => {
    changeThoroughness(level);
    if (mode === "train") startTraining(linesFor(level));
  };

  // If training was started before the book loaded (so it fell back to all
  // lines), re-derive the level-filtered set once the book arrives.
  const bookSyncedRef = useRef(false);
  useEffect(() => {
    if (!book || bookSyncedRef.current) return;
    bookSyncedRef.current = true;
    if (mode === "train") startTraining(linesFor(thoroughness));
    // Fire once, on the book's first load, using the values current at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // Keep the engine running while fixing gaps even if the user turned it off,
  // so the recommended reply always has an eval. In review the sweep owns every
  // number on the game itself — but inside a side line there is no sweep data at
  // all, so the live engine takes over there, and only there.
  const engineEnabled =
    ((engineOn || !!fixQueue) && mode === "build") ||
    (mode === "review" && inVariation);
  const { status, evaluation } = useEngine(fen, engineEnabled, multipv);
  const {
    gaps,
    progress,
    ready: gapsReady,
    error: gapsError,
  } = useCoverage(activeRepertoire, minImportanceFor(thoroughness));

  // Whole-game review runs on its own Stockfish instance, so it never competes
  // with the live analysis engine above.
  const { review, progress: reviewProgress } = useGameReview(
    reviewSession?.game ?? null,
    mode === "review",
    depthFor(reviewDepth),
    book,
  );

  const prepareGap = (sans: string[]) => {
    playLineSans(sans);
    setTab("analysis");
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
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <Header
        mode={mode}
        canTrain={!!activeRepertoire}
        onBuild={goBuild}
        onTrain={() => startTraining(trainableLines)}
        onReview={() => setMode("review")}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(360px,440px)]">
        {/* Left: board */}
        <div className="mx-auto w-fit max-w-full lg:mx-0">
          <BoardPanel
            evaluation={evaluation}
            engineStatus={status}
            engineEnabled={engineEnabled}
            review={mode === "review" ? review : null}
          />
        </div>

        {/* Right: panels */}
        <div className="flex flex-col gap-3">
          {mode !== "review" && <RepertoireSelect />}

          {mode === "review" ? (
            reviewSession ? (
              <ReviewPanel
                review={review}
                progress={reviewProgress}
                depthId={reviewDepth}
                onDepthChange={setReviewDepth}
              />
            ) : (
              <GameBrowser onSelect={openGame} loadError={gameLoadError} />
            )
          ) : mode === "train" ? (
            <TrainPanel
              level={thoroughness}
              onLevelChange={changeTrainLevel}
            />
          ) : fixQueue ? (
            <FixPanel evaluation={evaluation} status={status} />
          ) : (
            <>
              <MoveList />

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
                <>
                  <EnginePanel
                    evaluation={evaluation}
                    status={status}
                    engineOn={engineOn}
                    setEngineOn={setEngineOn}
                    multipv={multipv}
                    setMultipv={setMultipv}
                  />
                  <BookPanel evaluation={evaluation} />
                </>
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
  onBuild,
  onTrain,
  onReview,
}: {
  mode: Mode;
  canTrain: boolean;
  onBuild: () => void;
  onTrain: () => void;
  onReview: () => void;
}) {
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
      active ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-100">
          <span className="text-2xl">♞</span> Opening Trainer
        </h1>
        <p className="text-xs text-slate-500">
          Build your repertoire with Stockfish &amp; the Lichess explorer, drill
          it from memory, then review your real games.
        </p>
      </div>

      <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-1">
        <button type="button" onClick={onBuild} className={tab(mode === "build")}>
          🛠 Build
        </button>
        <button
          type="button"
          onClick={onTrain}
          disabled={!canTrain}
          title={canTrain ? "Train this repertoire" : "Create a repertoire first"}
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
