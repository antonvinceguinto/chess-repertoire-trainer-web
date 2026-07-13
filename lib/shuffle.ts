/** Fisher–Yates shuffle, returning a new array (leaves the input untouched). */
export function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Shuffle repertoire lines for a fresh training pass, avoiding an immediate
 * repeat of the line just finished — so a new pass never opens with the same
 * line the previous pass ended on (unless there is only one line).
 */
export function reshuffleLines(
  lines: string[][],
  justFinished: string[],
): string[][] {
  const next = shuffle(lines);
  if (next.length > 1 && next[0].join(" ") === justFinished.join(" ")) {
    const j = 1 + Math.floor(Math.random() * (next.length - 1));
    [next[0], next[j]] = [next[j], next[0]];
  }
  return next;
}
