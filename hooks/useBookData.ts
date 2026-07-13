"use client";

import { useEffect, useState } from "react";
import { loadBook, type Book } from "@/lib/book";

/** Loads the bundled opening book once and returns the raw book object. */
export function useBookData(): Book | null {
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    let active = true;
    loadBook()
      .then((b) => active && setBook(b))
      .catch(() => {
        /* names just won't resolve; the list still works */
      });
    return () => {
      active = false;
    };
  }, []);

  return book;
}
