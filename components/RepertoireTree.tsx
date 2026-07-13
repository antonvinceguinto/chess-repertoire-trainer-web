"use client";

import { useTrainer } from "@/context/TrainerContext";
import type { RepNode } from "@/lib/types";

export function RepertoireTree() {
  const { activeRepertoire, currentSans } = useTrainer();

  if (!activeRepertoire) {
    return (
      <p className="px-2 py-6 text-center text-xs text-slate-500">
        Create a repertoire to start saving lines.
      </p>
    );
  }
  if (activeRepertoire.root.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-slate-500">
        No moves saved yet. Explore on the board and use ＋ on an engine or
        explorer move — or “Save line”.
      </p>
    );
  }

  return (
    <div className="p-1.5">
      <NodeList nodes={activeRepertoire.root} path={[]} currentSans={currentSans} />
    </div>
  );
}

function NodeList({
  nodes,
  path,
  currentSans,
}: {
  nodes: RepNode[];
  path: string[];
  currentSans: string[];
}) {
  return (
    <ul className={path.length > 0 ? "ml-3 border-l border-slate-800 pl-1.5" : ""}>
      {nodes.map((node) => (
        <NodeRow
          key={node.san}
          node={node}
          path={[...path, node.san]}
          currentSans={currentSans}
        />
      ))}
    </ul>
  );
}

function NodeRow({
  node,
  path,
  currentSans,
}: {
  node: RepNode;
  path: string[];
  currentSans: string[];
}) {
  const { loadLineSans, removeRepertoireLine } = useTrainer();
  const depth = path.length - 1;
  const isWhite = depth % 2 === 0;
  const moveNo = Math.floor(depth / 2) + 1;
  const prefix = `${moveNo}${isWhite ? "." : "…"}`;

  const onPath =
    currentSans.length >= path.length &&
    path.every((san, i) => currentSans[i] === san);
  const isCurrent = onPath && currentSans.length === path.length;

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-0.5 ${
          isCurrent ? "bg-emerald-600/25 ring-1 ring-emerald-600/40" : "hover:bg-slate-800/60"
        }`}
      >
        <button
          type="button"
          onClick={() => loadLineSans(path)}
          className="flex min-w-0 flex-1 items-baseline gap-1 text-left"
          title={node.comment || "Go to this position"}
        >
          <span className="select-none text-[10px] tabular-nums text-slate-500">
            {prefix}
          </span>
          <span
            className={`font-mono text-[13px] ${
              isCurrent
                ? "text-white"
                : onPath
                  ? "text-emerald-300"
                  : "text-slate-200"
            }`}
          >
            {node.san}
          </span>
          {node.comment && (
            <span className="truncate text-[11px] italic text-slate-500">
              {node.comment}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => removeRepertoireLine(path)}
          className="shrink-0 rounded px-1 text-base text-slate-500 opacity-100 transition hover:text-rose-400 hoverable:text-xs hoverable:opacity-0 hoverable:group-hover:opacity-100"
          title="Delete this move and everything after it"
        >
          ✕
        </button>
      </div>
      {node.children.length > 0 && (
        <NodeList nodes={node.children} path={path} currentSans={currentSans} />
      )}
    </li>
  );
}
