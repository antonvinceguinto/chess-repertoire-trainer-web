"use client";

import { START_FEN, formatMoveSequence } from "@/lib/chess";
import { DANGER_META, type DangerScore } from "@/lib/danger";
import type { Gap } from "@/lib/gaps";

/**
 * Shared row/empty-state building blocks for the coverage views. A gap is one
 * opponent reply you haven't answered (or a line that stops on your move);
 * tapping the row loads it so you can prepare it.
 */
function commonness(imp: number): { label: string; cls: string } {
  if (imp >= 0.06) return { label: "Very common", cls: "text-rose-300" };
  if (imp >= 0.02) return { label: "Common", cls: "text-amber-300" };
  if (imp >= 0.005) return { label: "Occasional", cls: "text-sky-300" };
  return { label: "Rare", cls: "text-slate-400" };
}

export function GapRow({
  gap,
  rank,
  maxImp,
  danger,
  onPrepare,
}: {
  gap: Gap;
  rank: number;
  maxImp: number;
  danger?: DangerScore;
  onPrepare: (sans: string[]) => void;
}) {
  const path =
    gap.kind === "defense" ? [...gap.lineSans, gap.missingSan as string] : gap.lineSans;
  const seq = formatMoveSequence(START_FEN, path);
  const tag = commonness(gap.importance);
  const barPct = Math.max(6, Math.round((gap.importance / maxImp) * 100));

  // Emphasise the missing move (last token) for a defense gap.
  const tokens = seq.split(" ");
  const lastMove = tokens.pop() ?? "";
  const head = tokens.join(" ");

  const title =
    gap.name ??
    (gap.kind === "defense" ? "Offbeat line" : "Undecided reply");

  return (
    <li>
      <button
        type="button"
        onClick={() => onPrepare(path)}
        className="group w-full rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-2 text-left transition hover:border-emerald-600/50 hover:bg-slate-800/60"
      >
        <div className="flex items-center gap-2">
          {rank === 1 && (
            <span className="shrink-0 rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-300">
              Biggest
            </span>
          )}
          {gap.eco && (
            <span className="shrink-0 font-mono text-[10px] text-slate-500">
              {gap.eco}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-100">
            {gap.kind === "reply" && (
              <span className="text-slate-400">↪ your move · </span>
            )}
            {title}
          </span>
          {danger && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold ${DANGER_META[danger.level].text}`}
              title="How much being unprepared here can hurt (engine-scored)"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${DANGER_META[danger.level].dot}`}
              />
              {DANGER_META[danger.level].label}
            </span>
          )}
          <span className={`shrink-0 text-[10px] font-medium ${tag.cls}`}>
            {tag.label}
          </span>
        </div>

        <div className="mt-1 font-mono text-[11px] text-slate-500">
          {head}{" "}
          {gap.kind === "defense" ? (
            <span className="rounded bg-emerald-600/20 px-1 font-semibold text-emerald-300">
              {lastMove}
            </span>
          ) : (
            <>
              {lastMove}{" "}
              <span className="text-slate-600">→ your move?</span>
            </>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <span className="text-[10px] text-emerald-400 opacity-100 transition hoverable:opacity-0 hoverable:group-hover:opacity-100">
            Prepare →
          </span>
        </div>
      </button>
    </li>
  );
}

export function Empty({
  children,
  tone,
  pulse,
}: {
  children: React.ReactNode;
  tone?: "error" | "ok";
  pulse?: boolean;
}) {
  const color =
    tone === "error"
      ? "text-rose-400"
      : tone === "ok"
        ? "text-emerald-300"
        : "text-slate-500";
  return (
    <p
      className={`px-2 py-6 text-center text-xs leading-relaxed ${color} ${
        pulse ? "animate-soft-pulse" : ""
      }`}
    >
      {children}
    </p>
  );
}
