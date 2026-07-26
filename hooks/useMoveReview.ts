"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StockfishEngine } from "@/lib/engine";
import { classifyMove, type Classification } from "@/lib/classify";
import { fenAtPly, fenKey } from "@/lib/chess";
import { bookMovesFrom, type Book } from "@/lib/book";
import type { EngineEval, LineMove } from "@/lib/types";

/** Shallow-but-quick is plenty to grade opening moves; MultiPV 2 spots only-moves. */
export const REVIEW_DEPTH = 16;
export const REVIEW_MULTIPV = 2;

/**
 * chess.com-style move review. While enabled, a dedicated background Stockfish
 * instance (kept separate from the main analysis and danger engines so they
 * never contend) evaluates every position along the current line, one at a
 * time, and each played move is graded from the evals of the positions on
 * either side of it. Completed evals are cached by position for the session, so
 * navigating back and forth — or re-toggling — is instant.
 *
 * Both sides' moves are graded — while building you play the whole line yourself,
 * and an opponent blunder is exactly what you want the review to surface.
 *
 * Returns a map keyed by the 0-based move index into `line`.
 */
export function useMoveReview(
  line: LineMove[],
  enabled: boolean,
  book: Book | null,
): { classes: Map<number, Classification>; busy: boolean } {
  // Completed evals, keyed by normalised FEN — survives navigation and toggles.
  const cache = useRef(new Map<string, EngineEval>());
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  const engineRef = useRef<StockfishEngine | null>(null);
  const busyRef = useRef(false);

  // Every distinct position we need an eval for: plies 0..N along the line.
  const positions = useMemo(() => {
    if (line.length === 0) return [] as string[];
    const fens: string[] = [];
    const seen = new Set<string>();
    for (let p = 0; p <= line.length; p++) {
      const f = fenAtPly(line, p);
      const k = fenKey(f);
      if (!seen.has(k)) {
        seen.add(k);
        fens.push(f);
      }
    }
    return fens;
  }, [line]);
  const positionsRef = useRef(positions);

  // Feed the engine the next position that still needs evaluating, if idle.
  const pump = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || busyRef.current) return;
    const next = positionsRef.current.find((f) => !cache.current.has(fenKey(f)));
    if (!next) return;
    busyRef.current = true;
    engine.analyze(next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setFailed(false);
    const engine = new StockfishEngine(
      (evaluation) => {
        // Act once per completed search; ignore streaming snapshots. Store even
        // an empty result (a terminal position) so the queue never stalls on it.
        if (evaluation.running) return;
        cache.current.set(fenKey(evaluation.fen), evaluation);
        busyRef.current = false;
        setVersion((v) => v + 1);
        pump();
      },
      (status) => {
        // If the (third) review worker can't boot, don't leave the queue wedged
        // with busyRef stuck true and the indicator pulsing forever.
        if (status === "error") {
          setFailed(true);
          busyRef.current = false;
        }
      },
      { depth: REVIEW_DEPTH, multipv: REVIEW_MULTIPV },
    );
    engineRef.current = engine;
    busyRef.current = false;
    pump();
    return () => {
      engine.destroy();
      engineRef.current = null;
      busyRef.current = false;
    };
  }, [enabled, pump]);

  // Keep the queue current and pick up newly-needed positions as the line
  // grows / changes (the ref lets the engine callback read the latest list).
  useEffect(() => {
    positionsRef.current = positions;
    if (enabled) pump();
  }, [positions, enabled, pump]);

  // Book membership depends only on the line, not the streaming evals, so hoist
  // it out of the per-eval recompute below (bookMovesFrom is comparatively dear).
  const bookFlags = useMemo(() => {
    if (!book) return [] as boolean[];
    return line.map((m, i) =>
      bookMovesFrom(book, fenAtPly(line, i)).some(
        (bm) => bm.from === m.from && bm.to === m.to,
      ),
    );
  }, [line, book]);

  const classes = useMemo(() => {
    const m = new Map<number, Classification>();
    if (!enabled) return m;
    for (let i = 0; i < line.length; i++) {
      const beforeFen = fenAtPly(line, i);
      const before = cache.current.get(fenKey(beforeFen)) ?? null;
      const after = cache.current.get(fenKey(line[i].fen)) ?? null;
      const c = classifyMove({
        beforeFen,
        move: line[i],
        before,
        after,
        isBook: bookFlags[i] ?? false,
      });
      if (c) m.set(i, c);
    }
    return m;
    // `version` forces a recompute as evals stream in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, bookFlags, enabled, version]);

  // Still grading while any needed position hasn't been evaluated yet.
  const busy = enabled && !failed && positions.some((f) => !cache.current.has(fenKey(f)));

  return { classes, busy };
}
