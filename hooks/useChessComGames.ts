"use client";

import { useEffect, useState } from "react";
import {
  ChessComError,
  fetchRecentGames,
  type ChessComErrorKind,
  type ChessComGame,
} from "@/lib/chesscom";

/** What to look up. A new `nonce` re-runs the same username (retry button). */
export interface GamesQuery {
  username: string;
  nonce: number;
}

export interface GamesState {
  games: ChessComGame[];
  loading: boolean;
  error: string | null;
  errorKind: ChessComErrorKind | null;
  /** Monthly archives walked so far, so the UI can show it's still digging. */
  monthsChecked: number;
}

const IDLE: GamesState = {
  games: [],
  loading: false,
  error: null,
  errorKind: null,
  monthsChecked: 0,
};

/**
 * Fetch a Chess.com player's recent games. Results stream in a month at a
 * time; changing or clearing the query aborts whatever is in flight.
 */
export function useChessComGames(query: GamesQuery | null): GamesState {
  const [state, setState] = useState<GamesState>(IDLE);

  const username = query?.username ?? "";
  const nonce = query?.nonce ?? 0;

  useEffect(() => {
    if (!username) {
      setState(IDLE);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState({ ...IDLE, loading: true });

    fetchRecentGames(username, {
      limit: 60,
      maxMonths: 6,
      signal: controller.signal,
      onProgress: (games, monthsChecked) => {
        if (active) {
          setState((s) => ({ ...s, games, monthsChecked }));
        }
      },
    })
      .then((games) => {
        if (active) setState({ ...IDLE, games, monthsChecked: 0 });
      })
      .catch((err: unknown) => {
        if (!active || (err as Error)?.name === "AbortError") return;
        const chessErr = err instanceof ChessComError ? err : null;
        setState({
          ...IDLE,
          error:
            chessErr?.message ?? "Could not load games from Chess.com.",
          errorKind: chessErr?.kind ?? "unknown",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [username, nonce]);

  return state;
}
