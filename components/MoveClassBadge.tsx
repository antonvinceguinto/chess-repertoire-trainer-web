"use client";

import { CLASS_META, type MoveClass } from "@/lib/review";

/**
 * The round, chess.com-style badge for a move's verdict. It fills its parent
 * and sizes its glyph relative to it (`cqmin`), so the parent — which must be a
 * CSS size container (`container-type: size`) — dictates the badge size. That
 * keeps it correct at any board size with no pixel math.
 */
export function MoveClassDisc({ cls }: { cls: MoveClass }) {
  const meta = CLASS_META[cls];
  return (
    <span
      className={`flex h-full w-full items-center justify-center rounded-full font-bold leading-none text-white shadow-md ring-2 ring-slate-950/70 ${meta.disc}`}
      style={{ fontSize: meta.glyph.length > 1 ? "40cqmin" : "56cqmin" }}
      aria-hidden
    >
      {meta.glyph}
    </span>
  );
}

/** Small inline chip shown after a move in the move list. */
export function MoveClassChip({ cls }: { cls: MoveClass }) {
  const meta = CLASS_META[cls];
  return (
    <span
      className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[10px] font-bold leading-none ${meta.bg} ${meta.text}`}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.glyph}
    </span>
  );
}
