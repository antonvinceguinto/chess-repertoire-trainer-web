"use client";

import { useEffect, useState } from "react";

/**
 * A clock the render can read. Everything scheduling-related — what's due, how
 * long until the next review — depends on the current time, and reading
 * `Date.now()` during render is both impure and stuck at whenever the component
 * last happened to re-render. This ticks instead, so "12 due" becomes "13 due"
 * on its own.
 *
 * Read once via a lazy initialiser rather than on every render, so the value is
 * stable for the render that uses it. Nothing time-dependent is rendered before
 * localStorage has been read (no repertoires, no cards), so the server's
 * initial clock never reaches the markup and can't mismatch on hydration.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
