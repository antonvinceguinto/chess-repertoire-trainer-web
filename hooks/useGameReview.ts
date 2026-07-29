"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StockfishEngine } from "@/lib/engine";
import { isBookMove, type Book } from "@/lib/book";
import type { LoadedGame } from "@/lib/pgn";
import {
  buildReview,
  evalFromEngine,
  terminalEval,
  type GameReview,
  type PositionEval,
} from "@/lib/review";

/** Depth presets offered in the UI, cheapest first. */
export const REVIEW_DEPTHS = [
  { id: "quick", label: "Quick", depth: 10, blurb: "Fastest — catches obvious blunders" },
  { id: "standard", label: "Standard", depth: 25, blurb: "Balanced — the default" },
  { id: "deep", label: "Deep", depth: 30, blurb: "Slowest — most thorough" },
] as const;

export type ReviewDepthId = (typeof REVIEW_DEPTHS)[number]["id"];
export const DEFAULT_REVIEW_DEPTH: ReviewDepthId = "standard";

export function depthFor(id: ReviewDepthId): number {
  return REVIEW_DEPTHS.find((d) => d.id === id)?.depth ?? 25;
}

/** Two lines let us tell "the only move" apart from "one of several fine moves". */
const REVIEW_MULTIPV = 2;

export interface ReviewProgress {
  done: number;
  total: number;
  running: boolean;
  failed: boolean;
}

/**
 * Sweep a whole game with a *dedicated* Stockfish instance — separate from the
 * board's live analysis engine (`useEngine`) and from the gap scorer
 * (`useDanger`) so the three never contend for the same worker.
 *
 * Positions are analysed one at a time, oldest first, so the eval graph and the
 * move list fill in from the start of the game while the rest is still running.
 * Repeated positions are analysed once and reused.
 */
export function useGameReview(
  game: LoadedGame | null,
  enabled: boolean,
  depth: number,
  book: Book | null,
): { review: GameReview | null; progress: ReviewProgress } {
  // FEN before each move, plus the final position.
  const positions = useMemo(
    () => (game ? [game.startFen, ...game.moves.map((m) => m.fen)] : []),
    [game],
  );

  const evalsRef = useRef<(PositionEval | null)[]>([]);
  const [version, setVersion] = useState(0);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    evalsRef.current = new Array(positions.length).fill(null);
    setVersion((v) => v + 1);
    setDone(0);
    setFailed(false);
    if (!enabled || positions.length === 0) {
      setRunning(false);
      return;
    }

    // Positions that end the game can't be searched — score them directly.
    const queue: number[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < positions.length; i++) {
      const fen = positions[i];
      const terminal = terminalEval(fen);
      if (terminal) {
        evalsRef.current[i] = terminal;
        continue;
      }
      // A repetition reaches the same position twice — analyse it once.
      if (!seen.has(fen)) {
        seen.set(fen, i);
        queue.push(i);
      }
    }

    /** Copy a finished eval onto every index sharing that position. */
    const fill = (fen: string, result: PositionEval) => {
      for (let i = 0; i < positions.length; i++) {
        if (positions[i] === fen) evalsRef.current[i] = { ...result, fen };
      }
    };

    let cancelled = false;
    let index = 0;
    setRunning(true);

    const engine = new StockfishEngine(
      (evaluation) => {
        if (cancelled) return;
        // Ignore the streaming snapshots; act once per completed search.
        if (evaluation.running) return;

        const result = evalFromEngine(evaluation);
        if (result) fill(evaluation.fen, result);

        index += 1;
        setDone(index);
        // Re-render every few positions (and at the end) so the panel streams
        // in without re-deriving the whole review on every single eval.
        if (index % 4 === 0 || index >= queue.length) setVersion((v) => v + 1);

        if (index < queue.length) {
          engine.analyze(positions[queue[index]]);
        } else {
          setRunning(false);
        }
      },
      (status) => {
        if (status === "error" && !cancelled) {
          setFailed(true);
          setRunning(false);
        }
      },
      { depth, multipv: REVIEW_MULTIPV },
    );

    if (queue.length === 0) {
      setRunning(false);
      setVersion((v) => v + 1);
    } else {
      engine.analyze(positions[queue[0]]);
    }

    return () => {
      cancelled = true;
      engine.destroy();
    };
  }, [enabled, positions, depth]);

  const review = useMemo(() => {
    if (!game || positions.length === 0) return null;
    const built = buildReview({
      moves: game.moves,
      positions,
      evals: evalsRef.current,
      isBookMove: book
        ? (fen, san, i) => i < 30 && isBookMove(book, fen, san)
        : undefined,
      depth,
    });
    return built.moves.length > 0 ? built : null;
    // `version` is what advances as results stream in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, positions, book, depth, version]);

  const total = useMemo(() => {
    const unique = new Set<string>();
    for (const fen of positions) {
      if (!terminalEval(fen)) unique.add(fen);
    }
    return unique.size;
  }, [positions]);

  return { review, progress: { done, total, running, failed } };
}
