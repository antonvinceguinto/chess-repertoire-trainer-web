"use client";

import { useEffect, useState } from "react";
import { useTrainer } from "@/context/TrainerContext";
import { useLeaks } from "@/hooks/useLeaks";
import type { Book } from "@/lib/book";
import {
  isValidUsername,
  loadSavedUsername,
  saveUsername,
} from "@/lib/chesscom";
import { leakCards, moveLabel, type Leak } from "@/lib/leaks";
import { formatMoveSequence } from "@/lib/chess";
import { START_FEN } from "@/lib/chess";
import { Button, Panel, PanelHeader } from "./ui";

interface Props {
  book: Book | null;
}

/**
 * Leaks: the positions where your real games stopped matching your repertoire.
 *
 * Train and Recall drill what the book says you're *likely* to face. This drills
 * what you demonstrably got wrong, ranked by how often it actually happened.
 */
export function LeaksPanel({ book }: Props) {
  const { activeRepertoire, playLineSans, startRecall } = useTrainer();
  const { scan, progress, error, run } = useLeaks(activeRepertoire, book);
  const [username, setUsername] = useState("");

  // Same idiom as GameBrowser: localStorage is only readable after mount, so the
  // saved username is picked up here rather than in a lazy initialiser (which
  // would render differently on the server and the client).
  useEffect(() => {
    const saved = loadSavedUsername();
    if (saved) setUsername(saved);
  }, []);

  if (!activeRepertoire) {
    return (
      <Panel>
        <PanelHeader title="Leaks" />
        <p className="p-4 text-center text-[12px] lg:text-[13px] leading-relaxed text-slate-500">
          Pick a repertoire first — leaks are the places your games left it.
        </p>
      </Panel>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = username.trim();
    if (!isValidUsername(user)) return;
    saveUsername(user);
    run(user);
  };

  const leaks = scan?.leaks ?? [];
  const cards = leakCards(leaks);

  return (
    <Panel>
      <PanelHeader
        title="Leaks"
        right={
          scan ? (
            <span className="text-[11px] lg:text-[12px] tabular-nums text-slate-500">
              {scan.scanned} games
            </span>
          ) : undefined
        }
      />

      <div className="space-y-3 p-3">
        <p className="text-[12px] lg:text-[13px] leading-relaxed text-slate-500">
          Where your real games left <span className="text-slate-300">{activeRepertoire.name}</span> —
          the first move in each game that your repertoire doesn&apos;t have. These
          are worth more than new theory: you already reached them.
        </p>

        <form onSubmit={submit} className="flex gap-1.5">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Chess.com username"
            aria-label="Chess.com username"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-[13px] lg:text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!isValidUsername(username) || progress.running}
          >
            {progress.running ? "Scanning…" : "Scan games"}
          </Button>
        </form>

        {progress.running && (
          <p className="animate-soft-pulse text-center text-[11px] lg:text-[12px] text-slate-500">
            Reading your games — {progress.fetched} so far
            {progress.months > 0 && ` (${progress.months} month${progress.months === 1 ? "" : "s"})`}…
          </p>
        )}

        {error && (
          <p className="text-[12px] lg:text-[13px] text-rose-400">{error}</p>
        )}

        {scan && !progress.running && (
          <>
            <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-2 text-[11px] lg:text-[12px] text-slate-400">
              <span>
                <span className="font-semibold text-slate-200">{scan.scanned}</span>{" "}
                games as {activeRepertoire.color}
              </span>
              <span>
                <span className="font-semibold text-emerald-300">{scan.clean}</span>{" "}
                stayed in book
              </span>
              <span className="ml-auto">
                <span className="font-semibold text-amber-300">{leaks.length}</span>{" "}
                {leaks.length === 1 ? "leak" : "leaks"}
              </span>
            </div>

            {scan.scanned === 0 ? (
              <p className="py-3 text-center text-[12px] lg:text-[13px] leading-relaxed text-slate-500">
                None of those games were played as {activeRepertoire.color}. Switch
                to a repertoire for the other colour, or play a few games first.
              </p>
            ) : leaks.length === 0 ? (
              <p className="py-3 text-center text-[12px] lg:text-[13px] leading-relaxed text-emerald-300">
                ✓ No leaks — every game followed your repertoire until it ran out.
                Widen it in the Gaps tab and scan again.
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5">
                  {leaks.map((leak) => (
                    <LeakRow
                      key={leak.key}
                      leak={leak}
                      onStudy={() => playLineSans(leak.lead)}
                    />
                  ))}
                </ul>

                {cards.length > 0 && (
                  <Button
                    variant="primary"
                    onClick={() => startRecall(cards, { ignoreSchedule: true })}
                    className="w-full"
                  >
                    🎯 Drill these {cards.length}{" "}
                    {cards.length === 1 ? "position" : "positions"}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function LeakRow({ leak, onStudy }: { leak: Leak; onStudy: () => void }) {
  const seq = formatMoveSequence(START_FEN, leak.lead);
  const top = leak.played[0];
  return (
    <li className="rounded-md border border-slate-800 bg-slate-900/40 p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] lg:text-[14px] font-semibold text-slate-100">
          {leak.eco && (
            <span className="mr-1.5 font-mono text-[10px] lg:text-[11px] text-slate-500">
              {leak.eco}
            </span>
          )}
          {leak.name ?? "Off the book"}
        </span>
        <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] lg:text-[11px] font-semibold tabular-nums text-slate-300">
          {leak.games.length}×
        </span>
        {leak.losses > 0 && (
          <span
            className="shrink-0 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] lg:text-[11px] font-semibold tabular-nums text-rose-300"
            title="Games you lost after this"
          >
            {leak.losses} lost
          </span>
        )}
      </div>

      <div className="mt-1 font-mono text-[11px] lg:text-[12px] leading-relaxed text-slate-500">
        {seq || "start"}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] lg:text-[13px]">
        <span className="text-slate-500">{moveLabel(leak.index)}</span>
        <span className="text-rose-300">
          you played{" "}
          <span className="font-mono font-semibold">{top?.san}</span>
          {top && top.count < leak.games.length && ` (${top.count}×)`}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-emerald-300">
          repertoire says{" "}
          <span className="font-mono font-semibold">
            {leak.expected.slice(0, 3).join(", ")}
          </span>
          {leak.expected.length > 3 && " …"}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Button variant="secondary" onClick={onStudy} className="!py-1 text-[11px] lg:text-[12px]">
          Study position
        </Button>
        <a
          href={leak.games[0]?.url}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto text-[11px] lg:text-[12px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Latest game ↗
        </a>
      </div>
    </li>
  );
}
