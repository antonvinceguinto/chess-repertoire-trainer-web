"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StockfishEngine } from "@/lib/engine";
import {
  DANGER_DEPTH,
  DANGER_MULTIPV,
  dangerFromEval,
  dangerTargetFen,
  gapKey,
  type DangerScore,
} from "@/lib/danger";
import type { Gap } from "@/lib/gaps";

/**
 * When enabled, evaluates each gap's position in the background with a
 * dedicated Stockfish instance (one at a time, so it never fights the main
 * analysis engine) and scores how dangerous being unprepared there is. Results
 * are cached by position for the session, so re-toggling is instant.
 */
export function useDanger(
  gaps: Gap[],
  enabled: boolean,
): {
  scores: Map<string, DangerScore>;
  done: number;
  total: number;
  failed: boolean;
} {
  // Cache keyed by the evaluated FEN — survives toggles and gap-list changes.
  const cache = useRef(new Map<string, DangerScore>());
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  const gapTargets = useMemo(
    () => gaps.map((g) => ({ key: gapKey(g), target: dangerTargetFen(g) })),
    [gaps],
  );

  useEffect(() => {
    if (!enabled) return;
    setFailed(false);
    const queue = gapTargets
      .map((g) => g.target)
      .filter((t, i, arr) => arr.indexOf(t) === i && !cache.current.has(t));
    if (queue.length === 0) return;

    let cancelled = false;
    let idx = 0;
    const engine = new StockfishEngine(
      (evaluation) => {
        if (cancelled) return;
        // Act once per completed search. Ignore streaming snapshots; advance
        // even on an empty result (terminal position) so the queue never stalls.
        if (evaluation.running) return;
        if (evaluation.lines.length > 0) {
          const score = dangerFromEval(evaluation.fen, evaluation);
          if (score) {
            cache.current.set(evaluation.fen, score);
            setVersion((v) => v + 1);
          }
        }
        idx += 1;
        if (idx < queue.length) engine.analyze(queue[idx]);
      },
      (status) => {
        if (status === "error" && !cancelled) setFailed(true);
      },
      { depth: DANGER_DEPTH, multipv: DANGER_MULTIPV },
    );
    engine.analyze(queue[0]);

    return () => {
      cancelled = true;
      engine.destroy();
    };
  }, [enabled, gapTargets]);

  const scores = useMemo(() => {
    const m = new Map<string, DangerScore>();
    for (const g of gapTargets) {
      const s = cache.current.get(g.target);
      if (s) m.set(g.key, s);
    }
    return m;
    // version forces recompute as results stream in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapTargets, version]);

  return { scores, done: scores.size, total: gapTargets.length, failed };
}
