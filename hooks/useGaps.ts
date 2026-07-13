"use client";

import { useEffect, useMemo, useState } from "react";
import { loadBook, type Book } from "@/lib/book";
import { findGaps, rankGaps, type Gap } from "@/lib/gaps";
import type { Repertoire } from "@/lib/types";

/**
 * Loads the opening book and computes the active repertoire's coverage gaps.
 * Recomputes whenever the repertoire changes, so gaps shrink as you fill them.
 */
export function useGaps(rep: Repertoire | null): {
  ready: boolean;
  error: boolean;
  gaps: Gap[];
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

  return { ready: !!book, error, gaps };
}
