"use client";

import { useEffect, useState } from "react";
import {
  bookMovesFrom,
  loadBook,
  openingNameFrom,
  type Book,
  type BookMove,
  type OpeningName,
} from "@/lib/book";

/** Loads the bundled opening book once and derives lookups for the given FEN. */
export function useBook(fen: string): {
  ready: boolean;
  error: boolean;
  opening: OpeningName | null;
  moves: BookMove[];
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

  return {
    ready: !!book,
    error,
    opening: book ? openingNameFrom(book, fen) : null,
    moves: book ? bookMovesFrom(book, fen) : [],
  };
}
