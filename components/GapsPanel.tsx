"use client";

import { useTrainer } from "@/context/TrainerContext";
import { START_FEN, formatMoveSequence } from "@/lib/chess";
import type { Gap } from "@/lib/gaps";
import { Panel, PanelHeader } from "./ui";

interface Props {
  gaps: Gap[];
  ready: boolean;
  error: boolean;
  onPrepare: (sans: string[]) => void;
}

function commonness(imp: number): { label: string; cls: string } {
  if (imp >= 0.06) return { label: "Very common", cls: "text-rose-300" };
  if (imp >= 0.02) return { label: "Common", cls: "text-amber-300" };
  if (imp >= 0.005) return { label: "Occasional", cls: "text-sky-300" };
  return { label: "Rare", cls: "text-slate-400" };
}

export function GapsPanel({ gaps, ready, error, onPrepare }: Props) {
  const { activeRepertoire } = useTrainer();

  let body: React.ReactNode;

  if (!activeRepertoire) {
    body = (
      <Empty>Create a repertoire to see which lines you still need to prepare.</Empty>
    );
  } else if (activeRepertoire.root.length === 0) {
    body = (
      <Empty>
        Add some moves to your repertoire first — then this tab shows the common
        lines you haven&apos;t answered yet.
      </Empty>
    );
  } else if (error) {
    body = <Empty tone="error">Could not load the opening book.</Empty>;
  } else if (!ready) {
    body = <Empty pulse>Scanning your repertoire for gaps…</Empty>;
  } else if (gaps.length === 0) {
    body = (
      <Empty tone="ok">
        ✓ No major gaps. Your repertoire already answers the common lines from
        here.
      </Empty>
    );
  } else {
    const maxImp = gaps[0].importance || 1;
    const defenses = gaps.filter((g) => g.kind === "defense").length;
    const replies = gaps.length - defenses;
    body = (
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

  return (
    <Panel>
      <PanelHeader title="Coverage gaps" />
      <div className="max-h-[62vh] overflow-y-auto scroll-thin p-2">{body}</div>
    </Panel>
  );
}

function GapRow({
  gap,
  rank,
  maxImp,
  onPrepare,
}: {
  gap: Gap;
  rank: number;
  maxImp: number;
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

function Empty({
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
