"use client";

import { useEffect, useState } from "react";
import { fetchExplorer } from "@/lib/explorer";
import type { ExplorerData, ExplorerDb } from "@/lib/types";

/**
 * Fetches Lichess opening-explorer statistics for the given position.
 * Debounced and abortable so rapid navigation doesn't spam the API.
 */
export function useExplorer(fen: string, enabled: boolean, db: ExplorerDb) {
  const [data, setData] = useState<ExplorerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    setError(null);
    const timer = setTimeout(() => {
      setLoading(true);
      fetchExplorer(fen, db, controller.signal)
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e: unknown) => {
          if (active && (e as Error)?.name !== "AbortError") {
            setError((e as Error).message ?? "Explorer error");
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [fen, enabled, db]);

  return { data, loading, error };
}
