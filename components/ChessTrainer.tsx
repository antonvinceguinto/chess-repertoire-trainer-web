"use client";

import { useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useEngine } from "@/hooks/useEngine";
import { useGaps } from "@/hooks/useGaps";
import { BoardPanel } from "./BoardPanel";
import { MoveList } from "./MoveList";
import { EnginePanel } from "./EnginePanel";
import { BookPanel } from "./BookPanel";
import { GapsPanel } from "./GapsPanel";
import { RepertoireSelect } from "./RepertoireSelect";
import { RepertoireTree } from "./RepertoireTree";
import { TrainPanel } from "./TrainPanel";
import { Panel, PanelHeader } from "./ui";

type Tab = "analysis" | "repertoire" | "gaps";

export function ChessTrainer() {
  const {
    fen,
    mode,
    activeRepertoire,
    playLineSans,
    startTraining,
    stopTraining,
  } = useTrainer();

  const [engineOn, setEngineOn] = useState(true);
  const [multipv, setMultipv] = useState(3);
  const [tab, setTab] = useState<Tab>("analysis");

  const engineEnabled = engineOn && mode === "build";
  const { status, evaluation } = useEngine(fen, engineEnabled, multipv);
  const { gaps, ready: gapsReady, error: gapsError } = useGaps(activeRepertoire);

  const prepareGap = (sans: string[]) => {
    playLineSans(sans);
    setTab("analysis");
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <Header
        mode={mode}
        canTrain={!!activeRepertoire}
        onBuild={stopTraining}
        onTrain={startTraining}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(360px,440px)]">
        {/* Left: board */}
        <div className="mx-auto w-fit max-w-full lg:mx-0">
          <BoardPanel
            evaluation={evaluation}
            engineStatus={status}
            engineEnabled={engineEnabled}
          />
        </div>

        {/* Right: panels */}
        <div className="flex flex-col gap-3">
          <RepertoireSelect />

          {mode === "train" ? (
            <TrainPanel />
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

              {tab === "repertoire" && (
                <Panel>
                  <PanelHeader title="Saved lines" />
                  <div className="max-h-[60vh] overflow-y-auto scroll-thin">
                    <RepertoireTree />
                  </div>
                </Panel>
              )}

              {tab === "gaps" && (
                <GapsPanel
                  gaps={gaps}
                  ready={gapsReady}
                  error={gapsError}
                  onPrepare={prepareGap}
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
}: {
  mode: "build" | "train";
  canTrain: boolean;
  onBuild: () => void;
  onTrain: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-100">
          <span className="text-2xl">♞</span> Opening Trainer
        </h1>
        <p className="text-xs text-slate-500">
          Build your repertoire with Stockfish &amp; the Lichess explorer, then
          drill it from memory.
        </p>
      </div>

      <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-1">
        <button
          type="button"
          onClick={onBuild}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
            mode === "build"
              ? "bg-emerald-600 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          🛠 Build
        </button>
        <button
          type="button"
          onClick={onTrain}
          disabled={!canTrain}
          title={canTrain ? "Train this repertoire" : "Create a repertoire first"}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            mode === "train"
              ? "bg-emerald-600 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          🎯 Train
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-6 text-center text-[11px] text-slate-600">
      Analysis by Stockfish 18 (WASM, in-browser). Opening statistics from the
      Lichess opening explorer. Repertoires are saved locally in your browser.
    </footer>
  );
}
