"use client";

import {
  CLASS_META,
  CLASS_ORDER,
  type Classification,
  type MoveClass,
} from "@/lib/classify";

/** Small inline chip shown after a move in the move list. */
export function MoveClassChip({
  cls,
  winLoss,
}: {
  cls: MoveClass;
  winLoss?: number;
}) {
  const m = CLASS_META[cls];
  const title =
    winLoss && winLoss >= 1
      ? `${m.label} · −${winLoss.toFixed(0)}% winning chance`
      : m.label;
  return (
    <span
      className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded border px-0.5 text-[10px] font-bold leading-none ${m.chip}`}
      title={title}
      aria-label={m.label}
    >
      {m.symbol}
    </span>
  );
}

/**
 * The round, chess.com-style badge. It fills its parent and sizes its glyph
 * relative to it (`cqmin`), so the parent — which must be a CSS size container
 * (`container-type: size`) — dictates the badge size. That keeps it correct at
 * any board size (or a fixed size in the reaction card) with no pixel math.
 */
export function MoveClassDisc({ cls }: { cls: MoveClass }) {
  const m = CLASS_META[cls];
  return (
    <span
      className={`flex h-full w-full items-center justify-center rounded-full font-bold text-white shadow-md ring-2 ring-slate-950/70 ${m.disc}`}
      style={{ fontSize: m.symbol.length > 1 ? "42cqmin" : "56cqmin", lineHeight: 1 }}
      aria-hidden
    >
      {m.symbol}
    </span>
  );
}

/**
 * Explains why the current move earned its reaction — the badge, label, win%
 * given up, and a one-line reason.
 */
export function MoveReactionCard({
  san,
  index,
  classification,
}: {
  san: string;
  /** 0-based index of the move in the line (for the move number). */
  index: number;
  classification: Classification;
}) {
  const m = CLASS_META[classification.cls];
  const moveNo = Math.floor(index / 2) + 1;
  const num = index % 2 === 0 ? `${moveNo}.` : `${moveNo}…`;
  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex shrink-0"
          style={{ width: 22, height: 22, containerType: "size" }}
        >
          <MoveClassDisc cls={classification.cls} />
        </span>
        <span className="font-mono text-sm font-semibold text-slate-100">
          <span className="text-slate-500">{num}</span> {san}
        </span>
        <span
          className={`rounded border px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.chip}`}
        >
          {m.label}
        </span>
        {classification.winLoss >= 1 && (
          <span
            className="ml-auto text-[11px] font-medium tabular-nums text-slate-500"
            title="Winning chance given up versus the best move"
          >
            −{classification.winLoss.toFixed(0)}%
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-slate-300">
        {classification.reason}
      </p>
    </div>
  );
}

/** A compact key explaining every reaction symbol. */
export function MoveClassLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {CLASS_ORDER.map((cls) => (
        <span key={cls} className="inline-flex items-center gap-1">
          <MoveClassChip cls={cls} />
          <span className="text-[11px] text-slate-400">{CLASS_META[cls].label}</span>
        </span>
      ))}
    </div>
  );
}
