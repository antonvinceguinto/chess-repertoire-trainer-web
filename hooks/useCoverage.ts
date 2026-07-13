"use client";

import { useEffect, useMemo, useState } from "react";
import { loadBook, type Book } from "@/lib/book";
import { rankGaps, type Gap } from "@/lib/gaps";
import { openingProgress, type OpeningProgress } from "@/lib/coverage";
import type { Repertoire } from "@/lib/types";

/**
 * Loads the opening book once and derives, for the active repertoire, both the
 * flat ranked gap list and the per-opening coverage progress. Recomputes when
 * the repertoire changes, so numbers move as you fill lines in.
 */
export function useCoverage(
  rep: Repertoire | null,
  minImportance = 0,
): {
  ready: boolean;
  error: boolean;
  gaps: Gap[];
  progress: OpeningProgress[];
} {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    loadBook()
      .then((b) => active && setBook(b))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);

  const progress = useMemo(
    () => (rep && book ? openingProgress(rep, book, minImportance) : []),
    [rep, book, minImportance],
  );
  // Derive the flat gap list from the same per-opening walk, so the "All gaps"
  // list and the "By opening" covered/open counts can never disagree (e.g. on a
  // transposition answered via one move order but not another).
  const gaps = useMemo(
    () => rankGaps(progress.flatMap((p) => p.gaps), 40, minImportance),
    [progress, minImportance],
  );

  return { ready: !!book, error, gaps, progress };
}
