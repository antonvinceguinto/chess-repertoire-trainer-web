"use client";

import { useEffect, useRef, useState } from "react";
import { StockfishEngine } from "@/lib/engine";
import type { EngineEval, EngineStatus } from "@/lib/types";

/**
 * Runs a single Stockfish worker while `enabled` and (re-)analyzes the given FEN
 * whenever it changes. Evaluations for stale positions are filtered out so the
 * UI never shows a score for the wrong board. When disabled the worker is torn
 * down entirely (book-only mode) rather than left idling in the background.
 */
export function useEngine(fen: string, enabled: boolean, multipv = 3, depth = 20) {
  const [status, setStatus] = useState<EngineStatus>("loading");
  const [evaluation, setEvaluation] = useState<EngineEval | null>(null);
  const engineRef = useRef<StockfishEngine | null>(null);
  const requestedRef = useRef<string>("");

  // Only spin up Stockfish while the engine is on. Toggling it off unloads the
  // worker; toggling it back on reloads it and the analyze effect below re-runs.
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, multipv, depth]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !enabled) {
      requestedRef.current = "";
      setEvaluation(null);
      return;
    }
    requestedRef.current = fen;
    setEvaluation(null);
    engine.analyze(fen);
  }, [fen, enabled]);

  return { status, evaluation };
}
