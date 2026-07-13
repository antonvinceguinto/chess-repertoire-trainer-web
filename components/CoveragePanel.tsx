"use client";

import { useMemo, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useDanger } from "@/hooks/useDanger";
import { overallProgress, type OpeningProgress } from "@/lib/coverage";
import { gapKey, type DangerScore } from "@/lib/danger";
import type { Gap } from "@/lib/gaps";
import { THOROUGHNESS_LEVELS, type Thoroughness } from "@/lib/thoroughness";
import { Empty, GapRow } from "./GapRow";
import { Button, Panel, PanelHeader } from "./ui";

interface Props {
  progress: OpeningProgress[];
  gaps: Gap[];
  ready: boolean;
  error: boolean;
  level: Thoroughness;
  onLevelChange: (level: Thoroughness) => void;
  onPrepare: (sans: string[]) => void;
  onStartFix: (paths: string[][]) => void;
}

type View = "openings" | "gaps";

/** The move path that lands on the position where a gap needs answering. */
function gapPath(g: Gap): string[] {
  return g.kind === "defense" ? [...g.lineSans, g.missingSan as string] : g.lineSans;
}

export function CoveragePanel({
  progress,
  gaps,
  ready,
  error,
  level,
  onLevelChange,
  onPrepare,
  onStartFix,
}: Props) {
  const { activeRepertoire } = useTrainer();
  const [view, setView] = useState<View>("openings");
  const [dangerOn, setDangerOn] = useState(false);
  const hasLines = !!activeRepertoire && activeRepertoire.root.length > 0;

  const overall = useMemo(() => overallProgress(progress), [progress]);

  // Engine-scored danger for the flat gap list (only while that view is open).
  const danger = useDanger(gaps, dangerOn && view === "gaps" && ready);

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
          gaps={gaps}
          onPrepare={onPrepare}
          onStartFix={onStartFix}
        />
      );
  } else {
    body =
      gaps.length === 0 ? (
        <Empty tone="ok">
          ✓ No major gaps. Your repertoire answers the common lines.
        </Empty>
      ) : (
        <AllGapsView
          gaps={gaps}
          onPrepare={onPrepare}
          onStartFix={onStartFix}
          dangerOn={dangerOn}
          onDangerToggle={() => setDangerOn((d) => !d)}
          dangerScores={danger.scores}
          dangerDone={danger.done}
          dangerTotal={danger.total}
        />
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
      {hasLines && (
        <LevelSelector level={level} onLevelChange={onLevelChange} />
      )}
      <div className="max-h-[62vh] overflow-y-auto scroll-thin p-2">{body}</div>
    </Panel>
  );
}

function LevelSelector({
  level,
  onLevelChange,
}: {
  level: Thoroughness;
  onLevelChange: (level: Thoroughness) => void;
}) {
  const active = THOROUGHNESS_LEVELS.find((l) => l.id === level);
  return (
    <div className="border-b border-slate-800 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-slate-500">Prepare for</span>
        <div className="flex flex-1 rounded-md border border-slate-700 bg-slate-800/60 p-0.5 text-[11px]">
          {THOROUGHNESS_LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onLevelChange(l.id)}
              title={l.blurb}
              className={`flex-1 rounded px-2 py-0.5 font-medium transition ${
                level === l.id
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {active && (
        <p className="mt-1 text-[10px] text-slate-600">{active.blurb}.</p>
      )}
    </div>
  );
}

function OpeningsView({
  progress,
  overall,
  gaps,
  onPrepare,
  onStartFix,
}: {
  progress: OpeningProgress[];
  overall: { covered: number; total: number; coverage: number };
  gaps: Gap[];
  onPrepare: (sans: string[]) => void;
  onStartFix: (paths: string[][]) => void;
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
          {progress.length === 1 ? "opening" : "openings"} fully covered.
        </p>
        {gaps.length > 0 && (
          <Button
            variant="primary"
            onClick={() => onStartFix(gaps.map(gapPath))}
            className="mt-2 w-full !py-1.5 text-xs"
          >
            ⚡ Fix {gaps.length} {gaps.length === 1 ? "gap" : "gaps"} — guided
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {progress.map((p) => (
          <OpeningRow
            key={p.family}
            p={p}
            onPrepare={onPrepare}
            onStartFix={onStartFix}
          />
        ))}
      </ul>
    </>
  );
}

function OpeningRow({
  p,
  onPrepare,
  onStartFix,
}: {
  p: OpeningProgress;
  onPrepare: (sans: string[]) => void;
  onStartFix: (paths: string[][]) => void;
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
        <div className="border-t border-slate-800 p-1.5">
          <Button
            variant="secondary"
            onClick={() => onStartFix(p.gaps.map(gapPath))}
            className="mb-1.5 w-full !py-1 text-[11px]"
          >
            ⚡ Fix {p.family} — {p.gaps.length}{" "}
            {p.gaps.length === 1 ? "gap" : "gaps"}
          </Button>
          <ul className="flex flex-col gap-1">
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
        </div>
      )}
    </li>
  );
}

function AllGapsView({
  gaps,
  onPrepare,
  onStartFix,
  dangerOn,
  onDangerToggle,
  dangerScores,
  dangerDone,
  dangerTotal,
}: {
  gaps: Gap[];
  onPrepare: (sans: string[]) => void;
  onStartFix: (paths: string[][]) => void;
  dangerOn: boolean;
  onDangerToggle: () => void;
  dangerScores: Map<string, DangerScore>;
  dangerDone: number;
  dangerTotal: number;
}) {
  const maxImp = gaps[0].importance || 1;
  const defenses = gaps.filter((g) => g.kind === "defense").length;
  const replies = gaps.length - defenses;

  // When danger scoring is on, sort the sharpest gaps to the top (importance
  // breaks ties); unscored gaps keep their place until their score arrives.
  const ordered = useMemo(() => {
    if (!dangerOn) return gaps;
    return [...gaps].sort((a, b) => {
      const da = dangerScores.get(gapKey(a))?.score ?? -1;
      const db = dangerScores.get(gapKey(b))?.score ?? -1;
      if (db !== da) return db - da;
      return b.importance - a.importance;
    });
  }, [gaps, dangerOn, dangerScores]);

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <p className="text-[11px] leading-relaxed text-slate-500">
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
        </p>
        <button
          type="button"
          onClick={onDangerToggle}
          title="Rank by how sharp each gap is, using Stockfish"
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
            dangerOn
              ? "border-rose-600/60 bg-rose-500/15 text-rose-300"
              : "border-slate-700 text-slate-400 hover:text-slate-200"
          }`}
        >
          ⚠ By danger
        </button>
      </div>
      {dangerOn && dangerDone < dangerTotal && (
        <p className="animate-soft-pulse px-1 pb-2 text-[10px] text-slate-500">
          Scoring danger with Stockfish… {dangerDone}/{dangerTotal}
        </p>
      )}
      <Button
        variant="primary"
        onClick={() => onStartFix(ordered.map(gapPath))}
        className="mb-2 w-full !py-1.5 text-xs"
      >
        ⚡ Fix all {gaps.length} — guided, with engine suggestions
      </Button>
      <ul className="flex flex-col gap-1">
        {ordered.map((g, i) => (
          <GapRow
            key={`${g.fen}-${g.missingSan ?? "reply"}`}
            gap={g}
            rank={dangerOn ? 0 : i + 1}
            maxImp={maxImp}
            danger={dangerOn ? dangerScores.get(gapKey(g)) : undefined}
            onPrepare={onPrepare}
          />
        ))}
      </ul>
    </>
  );
}
