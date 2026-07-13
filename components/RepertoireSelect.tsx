"use client";

import { useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { countLines, countNodes } from "@/lib/repertoire";
import type { Color } from "@/lib/types";
import { TransferDialog } from "./TransferDialog";
import { Button } from "./ui";

export function RepertoireSelect() {
  const {
    repertoires,
    activeId,
    activeRepertoire,
    selectRepertoire,
    createRepertoire,
    deleteRepertoire,
    renameRepertoire,
  } = useTrainer();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>("white");

  const submitCreate = () => {
    createRepertoire(name || "New repertoire", color);
    setName("");
    setColor("white");
    setCreating(false);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center gap-2">
        <select
          value={activeId ?? ""}
          onChange={(e) => selectRepertoire(e.target.value)}
          disabled={repertoires.length === 0}
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-50"
        >
          {repertoires.length === 0 && <option value="">No repertoires yet</option>}
          {repertoires.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.color === "white" ? "White" : "Black"})
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          onClick={() => {
            setCreating((c) => !c);
            setEditing(false);
          }}
          className="shrink-0"
        >
          ＋ New
        </Button>
        <Button
          variant="secondary"
          onClick={() => setSyncing(true)}
          className="shrink-0"
          title="Backup & sync — use your data on another browser"
          aria-label="Backup and sync"
        >
          ⇅
        </Button>
      </div>

      {syncing && <TransferDialog onClose={() => setSyncing(false)} />}

      {creating && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-700 bg-slate-800/50 p-2.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCreate()}
            placeholder="Repertoire name (e.g. Sicilian Defense)"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">I play as:</span>
            {(["white", "black"] as Color[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`rounded-md border px-3 py-1 text-xs font-medium capitalize transition ${
                  color === c
                    ? "border-emerald-500 bg-emerald-600/20 text-emerald-200"
                    : "border-slate-700 text-slate-300 hover:bg-slate-700/50"
                }`}
              >
                {c}
              </button>
            ))}
            <div className="ml-auto flex gap-1.5">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={submitCreate}>
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {activeRepertoire && !creating && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          {editing ? (
            <input
              autoFocus
              defaultValue={activeRepertoire.name}
              onBlur={(e) => {
                renameRepertoire(activeRepertoire.id, e.target.value);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameRepertoire(activeRepertoire.id, e.currentTarget.value);
                  setEditing(false);
                }
                if (e.key === "Escape") setEditing(false);
              }}
              className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
            />
          ) : (
            <>
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${
                  activeRepertoire.color === "white"
                    ? "border-slate-400 bg-slate-100 text-slate-900"
                    : "border-slate-600 bg-slate-950 text-slate-100"
                }`}
                title={`You play ${activeRepertoire.color}`}
              >
                ♚
              </span>
              <span className="tabular-nums">
                {countNodes(activeRepertoire)} moves · {countLines(activeRepertoire)} lines
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ml-auto rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                title="Rename"
              >
                ✎ Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(`Delete repertoire “${activeRepertoire.name}”? This cannot be undone.`)
                  ) {
                    deleteRepertoire(activeRepertoire.id);
                  }
                }}
                className="rounded px-1.5 py-0.5 text-rose-400/80 hover:bg-rose-950/40 hover:text-rose-300"
                title="Delete repertoire"
              >
                🗑 Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
