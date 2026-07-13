"use client";

import { useMemo, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useBookData } from "@/hooks/useBookData";
import { START_FEN, formatMoveSequence } from "@/lib/chess";
import { describeLines, linePruneTarget, type NamedLine } from "@/lib/lines";
import { RepertoireTree } from "./RepertoireTree";
import { Panel, PanelHeader } from "./ui";

type View = "lines" | "tree";

export function RepertoirePanel() {
  const { activeRepertoire } = useTrainer();
  const [view, setView] = useState<View>("lines");

  const hasLines = !!activeRepertoire && activeRepertoire.root.length > 0;

  return (
    <Panel>
      <PanelHeader
        title="Saved lines"
        right={
          hasLines ? (
            <div className="flex rounded-md border border-slate-700 bg-slate-800/60 p-0.5 text-[11px]">
              {(["lines", "tree"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded px-2 py-0.5 font-medium capitalize transition ${
                    view === v
                      ? "bg-slate-700 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="max-h-[60vh] overflow-y-auto scroll-thin">
        {view === "lines" ? <NamedLinesList /> : <RepertoireTree />}
      </div>
    </Panel>
  );
}

function NamedLinesList() {
  const {
    activeRepertoire,
    currentSans,
    loadLineSans,
    removeRepertoireLine,
    setLineComment,
  } = useTrainer();
  const book = useBookData();

  const lines = useMemo(
    () => (activeRepertoire ? describeLines(activeRepertoire, book) : []),
    [activeRepertoire, book],
  );

  const [editingKey, setEditingKey] = useState<string | null>(null);

  if (!activeRepertoire) {
    return <Empty>Create a repertoire to start saving lines.</Empty>;
  }
  if (lines.length === 0) {
    return (
      <Empty>
        No moves saved yet. Explore on the board and use ＋ on an engine or book
        move — or &ldquo;Save line&rdquo;.
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5 p-2">
      {lines.map((line, i) => {
        const key = line.sans.join(" ");
        return (
          <LineRow
            key={key}
            line={line}
            index={i + 1}
            currentSans={currentSans}
            editing={editingKey === key}
            onEditToggle={(on) => setEditingKey(on ? key : null)}
            onLoad={() => loadLineSans(line.sans)}
            onDelete={() => {
              if (
                window.confirm(
                  `Delete this line${line.name ? ` (${line.name})` : ""}? This removes it back to its last branch point.`,
                )
              ) {
                removeRepertoireLine(linePruneTarget(line));
              }
            }}
            onRename={(name) => {
              setLineComment(line.sans, name);
              setEditingKey(null);
            }}
          />
        );
      })}
    </ul>
  );
}

function LineRow({
  line,
  index,
  currentSans,
  editing,
  onEditToggle,
  onLoad,
  onDelete,
  onRename,
}: {
  line: NamedLine;
  index: number;
  currentSans: string[];
  editing: boolean;
  onEditToggle: (on: boolean) => void;
  onLoad: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const onPath =
    currentSans.length <= line.sans.length &&
    currentSans.every((s, i) => s === line.sans[i]);
  const isExact = onPath && currentSans.length === line.sans.length;

  const title = line.label || line.name || "Unnamed line";
  const showNameSub = !!line.label && !!line.name && line.label !== line.name;
  const extraMoves = line.namedPly > 0 ? line.sans.length - line.namedPly : 0;
  const sequence = formatMoveSequence(START_FEN, line.sans);

  return (
    <li
      className={`group rounded-lg border transition ${
        isExact
          ? "border-emerald-600/60 bg-emerald-600/10"
          : onPath
            ? "border-emerald-700/40 bg-slate-800/50"
            : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/50"
      }`}
    >
      <div className="flex items-start gap-2 p-2">
        <span
          className="mt-0.5 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-400"
          title={`Line ${index}`}
        >
          {index}
        </span>

        <button
          type="button"
          onClick={onLoad}
          className="min-w-0 flex-1 text-left"
          title="Go to this line"
        >
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {line.eco && (
              <span className="font-mono text-[10px] text-slate-500">
                {line.eco}
              </span>
            )}
            <span className="text-[13px] font-semibold text-slate-100">
              {title}
            </span>
            {extraMoves > 0 && (
              <span
                className="text-[10px] text-slate-500"
                title="Moves beyond the named position"
              >
                +{extraMoves}
              </span>
            )}
          </div>
          {showNameSub && (
            <div className="text-[11px] text-slate-500">{line.name}</div>
          )}
          <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-slate-400">
            {sequence}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onEditToggle(!editing)}
            className="rounded px-1 py-0.5 text-xs text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 hoverable:opacity-0 hoverable:group-hover:opacity-100"
            title="Rename this line"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded px-1 py-0.5 text-xs text-slate-500 transition hover:bg-rose-950/40 hover:text-rose-400 hoverable:opacity-0 hoverable:group-hover:opacity-100"
            title="Delete this line"
          >
            ✕
          </button>
        </div>
      </div>

      {editing && (
        <div className="border-t border-slate-800 p-2">
          <input
            autoFocus
            defaultValue={line.label ?? ""}
            placeholder={line.name ? `e.g. ${line.name}` : "Name this line"}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(e.currentTarget.value.trim());
              if (e.key === "Escape") onEditToggle(false);
            }}
            onBlur={(e) => onRename(e.currentTarget.value.trim())}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-slate-600">
            Enter to save · Esc to cancel · clear it to fall back to the opening
            name.
          </p>
        </div>
      )}
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
      {children}
    </p>
  );
}
