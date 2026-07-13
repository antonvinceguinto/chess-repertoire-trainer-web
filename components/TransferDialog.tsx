"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { countLines } from "@/lib/repertoire";
import {
  backupFileName,
  encodeSyncCode,
  parseTransfer,
  serializeBackup,
  summarizeImport,
  TransferError,
} from "@/lib/transfer";
import { Button } from "./ui";

type ImportMode = "merge" | "replace";
type Feedback = { tone: "ok" | "error"; text: string } | null;

export function TransferDialog({ onClose }: { onClose: () => void }) {
  const { repertoires, importRepertoires } = useTrainer();

  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [paste, setPaste] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasData = repertoires.length > 0;
  const syncCode = useMemo(
    () => (hasData ? encodeSyncCode(repertoires) : ""),
    [repertoires, hasData],
  );
  const totalLines = useMemo(
    () => repertoires.reduce((n, r) => n + countLines(r), 0),
    [repertoires],
  );

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downloadBackup = () => {
    const blob = new Blob([serializeBackup(repertoires)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(syncCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — reveal the code so it can be selected manually.
      setShowCode(true);
    }
  };

  const runImport = (text: string) => {
    try {
      const { repertoires: reps, skipped } = parseTransfer(text);
      const summary = summarizeImport(repertoires, reps);
      const skipNote = skipped > 0 ? ` · ${skipped} invalid skipped` : "";
      if (mode === "replace" && hasData) {
        const ok = window.confirm(
          `Replace all ${repertoires.length} local repertoire(s) with the ${summary.total} from this backup? Your current data in this browser will be overwritten.` +
            (skipped > 0
              ? `\n\n${skipped} invalid entr${skipped === 1 ? "y was" : "ies were"} skipped.`
              : ""),
        );
        if (!ok) return;
      }
      const persisted = importRepertoires(reps, mode);
      if (!persisted) {
        setFeedback({
          tone: "error",
          text: `Imported ${summary.total} into this tab, but couldn't save them to this browser (storage full or private mode). Download a backup file to keep them.`,
        });
        return;
      }
      const detail =
        mode === "replace"
          ? `Replaced with ${summary.total} repertoire${summary.total === 1 ? "" : "s"}${skipNote}.`
          : `${summary.total} imported — ${summary.added} new, ${summary.updated} merged${skipNote}.`;
      setFeedback({ tone: "ok", text: `✓ ${detail}` });
      setPaste("");
    } catch (e) {
      setFeedback({
        tone: "error",
        text:
          e instanceof TransferError
            ? e.message
            : "Could not import this data.",
      });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      runImport(await file.text());
    } catch {
      setFeedback({ tone: "error", text: "Could not read that file." });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Backup and sync"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto scroll-thin rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              ⇅ Backup &amp; sync
            </h2>
            <p className="text-[11px] text-slate-500">
              Move your repertoires to another browser or device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 p-4">
          {/* Export */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Export from this browser
            </h3>
            {hasData ? (
              <>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {repertoires.length} repertoire
                  {repertoires.length === 1 ? "" : "s"} · {totalLines} line
                  {totalLines === 1 ? "" : "s"}. Save a file, or copy a code to
                  paste into the other browser&apos;s import box below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={downloadBackup}>
                    ⬇ Download backup file
                  </Button>
                  <Button variant="secondary" onClick={copyCode}>
                    {copied ? "✓ Copied" : "⧉ Copy sync code"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowCode((s) => !s)}
                  >
                    {showCode ? "Hide code" : "Show code"}
                  </Button>
                </div>
                {showCode && (
                  <textarea
                    readOnly
                    value={syncCode}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-slate-300 scroll-thin"
                  />
                )}
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-slate-500">
                No repertoires in this browser yet — nothing to export. Import a
                backup below to bring some in.
              </p>
            )}
          </section>

          <div className="border-t border-slate-800" />

          {/* Import */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Import into this browser
            </h3>

            <div className="flex items-center gap-2 rounded-lg bg-slate-800/40 p-1 text-xs">
              {(
                [
                  ["merge", "Merge"],
                  ["replace", "Replace all"],
                ] as [ImportMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md px-2 py-1 font-medium transition ${
                    mode === m
                      ? "bg-slate-700 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {mode === "merge"
                ? "Adds new repertoires and merges lines into matching ones — nothing already here is overwritten."
                : "Deletes everything in this browser and replaces it with the backup."}
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-xs text-slate-400 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-100 hover:file:bg-slate-600"
            />

            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-600">
              <span className="h-px flex-1 bg-slate-800" />
              or paste a sync code
              <span className="h-px flex-1 bg-slate-800" />
            </div>

            <textarea
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                setFeedback(null);
              }}
              placeholder="Paste a sync code (COR1.…) or backup JSON here"
              className="h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-200 placeholder:font-sans placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none scroll-thin"
            />
            <Button
              variant="primary"
              disabled={!paste.trim()}
              onClick={() => runImport(paste)}
              className="w-full"
            >
              {mode === "replace" ? "Replace all & import" : "Import"}
            </Button>

            {feedback && (
              <p
                className={`rounded-md px-2 py-1.5 text-xs ${
                  feedback.tone === "error"
                    ? "bg-rose-950/40 text-rose-300"
                    : "bg-emerald-950/40 text-emerald-300"
                }`}
              >
                {feedback.text}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
