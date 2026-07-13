"use client";

import { useMemo, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { overallProgress, type OpeningProgress } from "@/lib/coverage";
import type { Gap } from "@/lib/gaps";
import { Empty, GapRow } from "./GapRow";
import { Panel, PanelHeader } from "./ui";

interface Props {
  progress: OpeningProgress[];
  gaps: Gap[];
  ready: boolean;
  error: boolean;
  onPrepare: (sans: string[]) => void;
}

type View = "openings" | "gaps";

export function CoveragePanel({ progress, gaps, ready, error, onPrepare }: Props) {
  const { activeRepertoire } = useTrainer();
  const [view, setView] = useState<View>("openings");

  const overall = useMemo(() => overallProgress(progress), [progress]);

  let body: React.ReactNode;
  if (!activeRepertoire) {
    body = <Empty>Create a repertoire to track your opening coverage.</Empty>;
  } else if (activeRepertoire.root.length === 0) {
    body = (
      <Empty>
        Add some moves to your repertoire first — then this tab tracks how
        prepared you are against each opening.
      </Empty>
    );
  } else if (error) {
    body = <Empty tone="error">Could not load the opening book.</Empty>;
  } else if (!ready) {
    body = <Empty pulse>Measuring your coverage…</Empty>;
  } else if (view === "openings") {
    body =
      progress.length === 0 ? (
        <Empty tone="ok">
          ✓ Fully prepared — no open theory from your repertoire.
        </Empty>
      ) : (
        <OpeningsView
          key={activeRepertoire?.id}
          progress={progress}
          overall={overall}
          onPrepare={onPrepare}
        />
      );
  } else {
    body =
      gaps.length === 0 ? (
        <Empty tone="ok">
          ✓ No major gaps. Your repertoire answers the common lines.
        </Empty>
      ) : (
        <AllGapsView gaps={gaps} onPrepare={onPrepare} />
      );
  }

  return (
    <Panel>
      <PanelHeader
        title="Coverage"
        right={
          <div className="flex rounded-md border border-slate-700 bg-slate-800/60 p-0.5 text-[11px]">
            {(
              [
                ["openings", "By opening"],
                ["gaps", "All gaps"],
              ] as [View, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded px-2 py-0.5 font-medium transition ${
                  view === v
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <div className="max-h-[62vh] overflow-y-auto scroll-thin p-2">{body}</div>
    </Panel>
  );
}

function OpeningsView({
  progress,
  overall,
  onPrepare,
}: {
  progress: OpeningProgress[];
  overall: { covered: number; total: number; coverage: number };
  onPrepare: (sans: string[]) => void;
}) {
  // Only reach 100% when every reply is truly answered (rounding 99.5→100 would
  // otherwise show "100%" next to "N to close").
  const pct =
    overall.covered >= overall.total
      ? 100
      : Math.min(99, Math.round(overall.coverage * 100));
  const fullyPrepared = progress.filter((p) => p.open === 0).length;

  return (
    <>
      <div className="mb-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Overall prepared
          </span>
          <span className="text-sm font-bold tabular-nums text-slate-100">
            {pct}%
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          {overall.covered} of {overall.total} replies answered ·{" "}
          {fullyPrepared} of {progress.length}{" "}
          {progress.length === 1 ? "opening" : "openings"} fully covered. Tap an
          opening to see and fill its gaps.
        </p>
      </div>

      <ul className="flex flex-col gap-1">
        {progress.map((p) => (
          <OpeningRow key={p.family} p={p} onPrepare={onPrepare} />
        ))}
      </ul>
    </>
  );
}

function OpeningRow({
  p,
  onPrepare,
}: {
  p: OpeningProgress;
  onPrepare: (sans: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = p.open === 0;
  const pct = done ? 100 : Math.min(99, Math.round(p.coverage * 100));
  const barColor = done
    ? "from-emerald-600 to-emerald-400"
    : pct >= 60
      ? "from-emerald-700 to-emerald-500"
      : pct >= 30
        ? "from-amber-600 to-amber-400"
        : "from-rose-700 to-rose-500";

  return (
    <li className="rounded-md border border-slate-800 bg-slate-900/40">
      <button
        type="button"
        onClick={() => !done && setOpen((o) => !o)}
        aria-expanded={done ? undefined : open}
        className={`w-full rounded-md px-2.5 py-2 text-left transition ${
          done ? "cursor-default" : "hover:bg-slate-800/50"
        }`}
      >
        <div className="flex items-center gap-2">
          {!done && (
            <span
              className={`shrink-0 text-[10px] text-slate-500 transition ${open ? "rotate-90" : ""}`}
            >
              ▶
            </span>
          )}
          {p.eco && (
            <span className="shrink-0 font-mono text-[10px] text-slate-500">
              {p.eco}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-100">
            {p.family}
          </span>
          {done ? (
            <span className="shrink-0 text-[10px] font-semibold text-emerald-300">
              ✓ Prepared
            </span>
          ) : (
            <span className="shrink-0 text-[10px] font-medium text-amber-300">
              {p.open} to close
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all`}
              style={{ width: `${Math.max(3, pct)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-300">
            {p.covered}/{p.total} · {pct}%
          </span>
        </div>
      </button>

      {open && !done && p.gaps.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-slate-800 p-1.5">
          {p.gaps.map((g) => (
            <GapRow
              key={`${g.fen}-${g.missingSan ?? "reply"}`}
              gap={g}
              rank={0}
              maxImp={p.gaps[0].importance || 1}
              onPrepare={onPrepare}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function AllGapsView({
  gaps,
  onPrepare,
}: {
  gaps: Gap[];
  onPrepare: (sans: string[]) => void;
}) {
  const maxImp = gaps[0].importance || 1;
  const defenses = gaps.filter((g) => g.kind === "defense").length;
  const replies = gaps.length - defenses;

  return (
    <>
      <p className="px-1 pb-2 text-[11px] leading-relaxed text-slate-500">
        {defenses > 0 && (
          <>
            <span className="text-slate-300">{defenses}</span> unanswered{" "}
            {defenses === 1 ? "defense" : "defenses"}
          </>
        )}
        {defenses > 0 && replies > 0 && " · "}
        {replies > 0 && (
          <>
            <span className="text-slate-300">{replies}</span> unfinished{" "}
            {replies === 1 ? "line" : "lines"}
          </>
        )}
        . Ranked by how often you&apos;ll face them. Tap one to prepare it.
      </p>
      <ul className="flex flex-col gap-1">
        {gaps.map((g, i) => (
          <GapRow
            key={`${g.fen}-${g.missingSan ?? "reply"}`}
            gap={g}
            rank={i + 1}
            maxImp={maxImp}
            onPrepare={onPrepare}
          />
        ))}
      </ul>
    </>
  );
}
