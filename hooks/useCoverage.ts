"use client";

import { useEffect, useMemo, useState } from "react";
import { loadBook, type Book } from "@/lib/book";
import { findGaps, rankGaps, type Gap } from "@/lib/gaps";
import { openingProgress, type OpeningProgress } from "@/lib/coverage";
import type { Repertoire } from "@/lib/types";

/**
 * Loads the opening book once and derives, for the active repertoire, both the
 * flat ranked gap list and the per-opening coverage progress. Recomputes when
 * the repertoire changes, so numbers move as you fill lines in.
 */
export function useCoverage(rep: Repertoire | null): {
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

  const gaps = useMemo(
    () => (rep && book ? rankGaps(findGaps(rep, book)) : []),
    [rep, book],
  );
  const progress = useMemo(
    () => (rep && book ? openingProgress(rep, book) : []),
    [rep, book],
  );

  return { ready: !!book, error, gaps, progress };
}
