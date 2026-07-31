"use client";

import { useCallback, useRef, useState } from "react";
import { ChessComError, fetchRecentGames, refreshPlayer } from "@/lib/chesscom";
import { findLeaks, type LeakScan } from "@/lib/leaks";
import type { Book } from "@/lib/book";
import type { Repertoire } from "@/lib/types";

export interface LeakProgress {
  running: boolean;
  /** Games pulled so far, so the UI can count up while months stream in. */
  fetched: number;
  months: number;
}

const IDLE: LeakProgress = { running: false, fetched: 0, months: 0 };

/**
 * Pull a slice of recent Chess.com games and match them against the active
 * repertoire. Deliberately manual — it costs several API round-trips, so it
 * runs when asked rather than on every mount.
 */
export function useLeaks(rep: Repertoire | null, book: Book | null) {
  const [scan, setScan] = useState<LeakScan | null>(null);
  const [progress, setProgress] = useState<LeakProgress>(IDLE);
  const [error, setError] = useState<string | null>(null);
  /** The username the current result belongs to, so a re-scan can be detected. */
  const [scannedUser, setScannedUser] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (username: string, opts: { fresh?: boolean; limit?: number } = {}) => {
      if (!rep) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      if (opts.fresh) refreshPlayer(username);
      setError(null);
      setProgress({ running: true, fetched: 0, months: 0 });

      try {
        const games = await fetchRecentGames(username, {
          limit: opts.limit ?? 60,
          maxMonths: 6,
          signal: ctrl.signal,
          onProgress: (collected, months) =>
            setProgress({
              running: true,
              fetched: collected.length,
              months,
            }),
        });
        if (ctrl.signal.aborted) return;
        setScan(findLeaks(games, rep, username, book));
        setScannedUser(username);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(
          e instanceof ChessComError
            ? e.message
            : "Couldn't read your games just now.",
        );
      } finally {
        if (!ctrl.signal.aborted) setProgress(IDLE);
      }
    },
    [rep, book],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setScan(null);
    setScannedUser(null);
    setError(null);
    setProgress(IDLE);
  }, []);

  return { scan, progress, error, scannedUser, run, reset };
}
