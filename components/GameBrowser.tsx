"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useChessComGames } from "@/hooks/useChessComGames";
import {
  colorOf,
  endReason,
  formatTimeControl,
  isValidUsername,
  loadSavedUsername,
  normalizeUsername,
  outcomeOf,
  refreshPlayer,
  saveUsername,
  type ChessComGame,
} from "@/lib/chesscom";
import { Button, Panel, PanelHeader } from "./ui";

interface Props {
  onSelect: (game: ChessComGame, username: string) => void;
  /** Set when the last selected game's PGN could not be read. */
  loadError: string | null;
}

const TIME_CLASS_ICON: Record<string, string> = {
  bullet: "⚡",
  blitz: "🔥",
  rapid: "⏱",
  daily: "📅",
};

/**
 * Look up any Chess.com player by username — no login, no API key — and list
 * their recent public games to pick one apart.
 */
export function GameBrowser({ onSelect, loadError }: Props) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<{ username: string; nonce: number } | null>(
    null,
  );
  const { games, loading, error, errorKind, monthsChecked } =
    useChessComGames(query);

  // Pick up where the user left off. Archives and months are cached for the
  // session, so coming back from a game re-lists instantly.
  useEffect(() => {
    const saved = loadSavedUsername();
    if (!saved) return;
    setInput(saved);
    setQuery({ username: saved, nonce: 0 });
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const username = normalizeUsername(input);
    if (!isValidUsername(username)) return;
    saveUsername(username);
    // An explicit search means "go and look again", so drop the session cache.
    refreshPlayer(username);
    setQuery((q) => ({ username, nonce: (q?.nonce ?? 0) + 1 }));
  };

  const username = query?.username ?? "";

  return (
    <Panel>
      <PanelHeader
        title="Analyse your games"
        right={
          <span className="text-[10px] text-slate-500">via Chess.com</span>
        }
      />

      <div className="space-y-2 border-b border-slate-800 p-3">
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Chess.com username"
            autoComplete="username"
            spellCheck={false}
            aria-label="Chess.com username"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
          <Button
            variant="primary"
            type="submit"
            disabled={!isValidUsername(input) || loading}
          >
            {loading ? "Loading…" : "Find games"}
          </Button>
        </form>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Public games only — you don&apos;t need to log in. Pick a game and
          Stockfish reviews every move, then the coach walks you through what
          went wrong.
        </p>
      </div>

      <div className="max-h-[52vh] overflow-y-auto scroll-thin p-2">
        {loadError && (
          <p className="mb-2 rounded-md border border-rose-900/60 bg-rose-950/40 px-2.5 py-2 text-[11px] text-rose-300">
            {loadError}
          </p>
        )}

        {error ? (
          <ErrorState kind={errorKind} message={error} />
        ) : loading && games.length === 0 ? (
          <p className="animate-soft-pulse py-6 text-center text-xs text-slate-500">
            Fetching games from Chess.com…
          </p>
        ) : games.length === 0 && query ? (
          <p className="py-6 text-center text-xs leading-relaxed text-slate-500">
            No standard-chess games found in {username}&apos;s last six months
            of archives.
          </p>
        ) : games.length === 0 ? (
          <p className="py-6 text-center text-xs leading-relaxed text-slate-500">
            Enter a Chess.com username above to pull in their recent games.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {games.map((g) => (
                <GameRow
                  key={g.id}
                  game={g}
                  username={username}
                  onSelect={() => onSelect(g, username)}
                />
              ))}
            </ul>
            {loading && (
              <p className="animate-soft-pulse py-2 text-center text-[10px] text-slate-500">
                Checking older archives… ({monthsChecked}{" "}
                {monthsChecked === 1 ? "month" : "months"} so far)
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function ErrorState({
  kind,
  message,
}: {
  kind: string | null;
  message: string;
}) {
  return (
    <div className="py-6 text-center">
      <p className="text-xs font-semibold text-rose-300">{message}</p>
      {kind === "not_found" && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          Check the spelling — it needs to be the Chess.com username, not the
          display name.
        </p>
      )}
      {kind === "proxy_unavailable" && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          Chess.com blocks direct browser requests, so this feature needs the
          app&apos;s <code className="text-slate-400">/api/chesscom</code> route
          — it isn&apos;t reachable on this deployment.
        </p>
      )}
      {kind === "rate_limited" && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          Chess.com limits how often their archives can be read. Give it a
          minute.
        </p>
      )}
    </div>
  );
}

const OUTCOME_STYLE = {
  win: { dot: "bg-emerald-500", label: "W", text: "text-emerald-300" },
  loss: { dot: "bg-rose-500", label: "L", text: "text-rose-300" },
  draw: { dot: "bg-slate-500", label: "D", text: "text-slate-300" },
  unknown: { dot: "bg-slate-700", label: "·", text: "text-slate-400" },
} as const;

function GameRow({
  game,
  username,
  onSelect,
}: {
  game: ChessComGame;
  username: string;
  onSelect: () => void;
}) {
  const color = colorOf(game, username) ?? "white";
  const me = color === "white" ? game.white : game.black;
  const them = color === "white" ? game.black : game.white;
  const outcome = outcomeOf(me.result);
  const style = OUTCOME_STYLE[outcome];
  const accuracy =
    game.accuracies != null
      ? color === "white"
        ? game.accuracies.white
        : game.accuracies.black
      : null;

  const date = game.endTime
    ? new Date(game.endTime * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group flex w-full items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-2.5 py-2 text-left transition hover:border-emerald-600/60 hover:bg-slate-800/60"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-slate-950 ${style.dot}`}
          title={`${outcome} by ${endReason(game).toLowerCase()}`}
        >
          {style.label}
        </span>

        <span
          className={`h-3 w-3 shrink-0 rounded-sm border ${
            color === "white"
              ? "border-slate-400 bg-slate-100"
              : "border-slate-600 bg-slate-900"
          }`}
          title={`You played ${color}`}
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-slate-100">
            {them.username}
            {them.rating != null && (
              <span className="ml-1 text-[11px] font-normal text-slate-500">
                {them.rating}
              </span>
            )}
          </span>
          <span className="block truncate text-[10px] text-slate-500">
            {TIME_CLASS_ICON[game.timeClass] ?? "•"}{" "}
            {formatTimeControl(game.timeControl) || game.timeClass}
            {date && ` · ${date}`} · {endReason(game)}
          </span>
        </span>

        {accuracy != null && (
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400"
            title="Chess.com's own accuracy for this game"
          >
            {accuracy.toFixed(1)}
          </span>
        )}

        <span className="shrink-0 rounded bg-emerald-600/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 transition group-hover:bg-emerald-600 group-hover:text-white">
          Review
        </span>
      </button>
    </li>
  );
}
