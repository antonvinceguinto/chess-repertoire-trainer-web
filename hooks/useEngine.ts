"use client";

import { useEffect, useRef, useState } from "react";
import { StockfishEngine } from "@/lib/engine";
import type { EngineEval, EngineStatus } from "@/lib/types";

/**
 * Runs a single Stockfish worker for the app's lifetime and (re-)analyzes the
 * given FEN whenever it changes. Evaluations for stale positions are filtered
 * out so the UI never shows a score for the wrong board.
 */
export function useEngine(fen: string, enabled: boolean, multipv = 3, depth = 20) {
  const [status, setStatus] = useState<EngineStatus>("loading");
  const [evaluation, setEvaluation] = useState<EngineEval | null>(null);
  const engineRef = useRef<StockfishEngine | null>(null);
  const requestedRef = useRef<string>("");

  useEffect(() => {
    const engine = new StockfishEngine(
      (ev) => {
        if (ev.fen === requestedRef.current) setEvaluation(ev);
      },
      setStatus,
      { multipv, depth },
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipv, depth]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!enabled) {
      requestedRef.current = "";
      engine.stop();
      return;
    }
    requestedRef.current = fen;
    setEvaluation(null);
    engine.analyze(fen);
  }, [fen, enabled]);

  return { status, evaluation };
}
