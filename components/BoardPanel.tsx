"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Chessboard } from "react-chessboard";
import { useTrainer } from "@/context/TrainerContext";
import { legalMoves, tryMove } from "@/lib/chess";
import type { EngineEval, EngineStatus } from "@/lib/types";
import { EvalBar } from "./EvalBar";
import { ControlButton } from "./ui";

interface Props {
  evaluation: EngineEval | null;
  engineStatus: EngineStatus;
  engineEnabled: boolean;
}

const HIGHLIGHT = "rgba(250, 204, 21, 0.45)";

/** Selectable board colour schemes (light / dark square colours). */
const BOARD_THEMES = {
  green: { label: "Green", light: "#edeed1", dark: "#7aa25c" },
  brown: { label: "Brown", light: "#f0d9b5", dark: "#b58863" },
  blue: { label: "Blue", light: "#e3ecf5", dark: "#5d84a8" },
} as const;
type BoardTheme = keyof typeof BOARD_THEMES;
const BOARD_THEME_ORDER: BoardTheme[] = ["green", "brown", "blue"];
const DEFAULT_THEME: BoardTheme = "green";
const BOARD_THEME_KEY = "chess-board-theme";

const MIN_BOARD = 320;
const MAX_BOARD = 900;
const DEFAULT_BOARD = 560;
const BOARD_SIZE_KEY = "chess-board-size";

export function BoardPanel({ evaluation, engineStatus, engineEnabled }: Props) {
  const t = useTrainer();
  const {
    fen,
    ply,
    line,
    orientation,
    lastMove,
    mode,
    turn,
    session,
    fixQueue,
    playMove,
    goStart,
    goBack,
    goForward,
    goEnd,
    prevFix,
    nextFix,
    flipBoard,
    resetBoard,
  } = t;

  // While guiding a gap fix, the board must stay on the gap position (no free
  // play or reset). Stepping ←/→ through the line's moves to review it is still
  // allowed — only training locks that out.
  const navLocked = mode === "train" || fixQueue !== null;
  const moveNavLocked = mode === "train";
  // The gap sits at the end of `line`; scrubbed back to review, you can't grab
  // pieces until you step forward to the gap again.
  const atGap = fixQueue === null || ply === line.length;

  const evalMatches = evaluation != null && evaluation.fen === fen;
  const bestLine = evalMatches && evaluation.lines.length > 0 ? evaluation.lines[0] : null;

  // Resizable board widget (persisted across sessions).
  const [size, setSize] = useState(DEFAULT_BOARD);
  const [resizing, setResizing] = useState(false);

  // Board colour scheme (persisted across sessions).
  const [theme, setTheme] = useState<BoardTheme>(DEFAULT_THEME);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(BOARD_SIZE_KEY));
    if (saved >= MIN_BOARD && saved <= MAX_BOARD) setSize(saved);
    const savedTheme = window.localStorage.getItem(BOARD_THEME_KEY);
    if (savedTheme && savedTheme in BOARD_THEMES) {
      setTheme(savedTheme as BoardTheme);
    }
  }, []);

  const selectTheme = (name: BoardTheme) => {
    setTheme(name);
    try {
      window.localStorage.setItem(BOARD_THEME_KEY, name);
    } catch {
      /* ignore */
    }
  };

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = size;
    let latest = startSize;
    let raf = 0;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      // Diagonal drag: grow with whichever axis moves further from the corner.
      const delta = Math.max(ev.clientX - startX, ev.clientY - startY);
      latest = Math.min(MAX_BOARD, Math.max(MIN_BOARD, startSize + delta));
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setSize(latest);
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) cancelAnimationFrame(raf);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setResizing(false);
      setSize(latest);
      try {
        window.localStorage.setItem(BOARD_SIZE_KEY, String(Math.round(latest)));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Keyboard navigation (build mode only; not while a fix is locked to a gap).
  useEffect(() => {
    if (mode !== "build") return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "f") {
        flipBoard();
        return;
      }
      // During a fix the board is pinned to each gap. Left/right step through the
      // moves that lead to the gap (to review how it arose); up/down walk the gap
      // queue (previous / next).
      if (fixQueue !== null) {
        if (e.key === "ArrowLeft") goBack();
        else if (e.key === "ArrowRight") goForward();
        else if (e.key === "ArrowUp") prevFix();
        else if (e.key === "ArrowDown") nextFix();
        return;
      }
      if (navLocked) return; // keep the board pinned during training
      if (e.key === "ArrowLeft") goBack();
      else if (e.key === "ArrowRight") goForward();
      else if (e.key === "ArrowUp") goStart();
      else if (e.key === "ArrowDown") goEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, navLocked, fixQueue, prevFix, nextFix, goBack, goForward, goStart, goEnd, flipBoard]);

  const userChar = session ? (session.color === "white" ? "w" : "b") : null;

  const highlightStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.from] = { background: HIGHLIGHT };
      styles[lastMove.to] = { background: HIGHLIGHT };
    }
    return styles;
  }, [lastMove]);

  // Click / tap to move: first tap selects a piece, second tap moves it.
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  useEffect(() => {
    setMoveFrom(null);
  }, [fen]);

  // Highlight the selected square and dots on its legal destinations.
  const optionSquares = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (!moveFrom) return styles;
    styles[moveFrom] = { background: "rgba(56, 189, 248, 0.5)" };
    for (const m of legalMoves(fen)) {
      if (m.from !== moveFrom) continue;
      const capture = m.flags.includes("c") || m.flags.includes("e");
      styles[m.to] = capture
        ? {
            background:
              "radial-gradient(circle, transparent 55%, rgba(56,189,248,0.55) 57%)",
          }
        : {
            background:
              "radial-gradient(circle, rgba(56,189,248,0.5) 22%, transparent 24%)",
          };
    }
    return styles;
  }, [moveFrom, fen]);

  // Arrows: engine suggestions in build mode; revealed answers in train mode.
  const arrows = useMemo(() => {
    let raw: { startSquare: string; endSquare: string; color: string }[];
    if (mode === "train") {
      const targetLine = session?.lines[session.lineIndex];
      const expected = targetLine?.[ply];
      if (!session?.revealed || !expected) return [];
      const mv = tryMove(fen, expected);
      if (!mv) return [];
      raw = [{ startSquare: mv.from, endSquare: mv.to, color: "#22c55e" }];
    } else {
      if (!engineEnabled || !evalMatches) return [];
      const palette = ["#22c55e", "#38bdf8", "#a78bfa"];
      raw = evaluation!.lines.slice(0, 3).map((l, i) => ({
        startSquare: l.uci.slice(0, 2),
        endSquare: l.uci.slice(2, 4),
        color: palette[i] ?? "#64748b",
      }));
    }
    // Two PV lines can transiently share a first move — keep one arrow per square pair.
    const seen = new Set<string>();
    return raw.filter((a) => {
      const k = `${a.startSquare}-${a.endSquare}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [mode, session, ply, fen, engineEnabled, evalMatches, evaluation]);

  const options = useMemo(
    () => ({
      position: fen,
      boardOrientation: orientation,
      animationDurationInMs: 200,
      darkSquareStyle: { backgroundColor: BOARD_THEMES[theme].dark },
      lightSquareStyle: { backgroundColor: BOARD_THEMES[theme].light },
      squareStyles: { ...highlightStyles, ...optionSquares },
      arrows,
      id: "trainer-board",
      canDragPiece: ({ piece }: { piece: { pieceType: string } }) => {
        if (mode === "train") {
          if (!userChar) return false;
          return piece.pieceType[0] === userChar && turn === userChar;
        }
        // While fixing, you can only make your reply at the gap — not while
        // reviewing an earlier move.
        return atGap;
      },
      onPieceDrop: ({
        sourceSquare,
        targetSquare,
        piece,
      }: {
        sourceSquare: string;
        targetSquare: string | null;
        piece: { pieceType: string };
      }) => {
        if (!targetSquare) return false;
        const isPawn = piece.pieceType[1]?.toLowerCase() === "p";
        const rank = targetSquare[1];
        const promotion = isPawn && (rank === "1" || rank === "8") ? "q" : undefined;
        return playMove({ from: sourceSquare, to: targetSquare, promotion });
      },
      onSquareClick: ({
        square,
        piece,
      }: {
        square: string;
        piece: { pieceType: string } | null;
      }) => {
        // A piece is already selected and a different square was tapped: try to move.
        if (moveFrom && square !== moveFrom) {
          const legal = legalMoves(fen).filter(
            (m) => m.from === moveFrom && m.to === square,
          );
          if (legal.length > 0) {
            const promotion = legal.some((m) => m.promotion) ? "q" : undefined;
            playMove({ from: moveFrom, to: square, promotion });
            setMoveFrom(null);
            return;
          }
        }
        // Deselect if tapping the selected square; else (re)select a movable piece.
        if (moveFrom === square) {
          setMoveFrom(null);
          return;
        }
        const pc = piece?.pieceType[0];
        const canSelect =
          pc != null &&
          atGap &&
          (mode === "train"
            ? userChar != null && pc === userChar && turn === userChar
            : pc === turn);
        setMoveFrom(canSelect ? square : null);
      },
    }),
    [
      fen,
      orientation,
      theme,
      highlightStyles,
      optionSquares,
      arrows,
      mode,
      userChar,
      turn,
      playMove,
      moveFrom,
      atGap,
    ],
  );

  return (
    <div
      className="flex flex-col gap-3"
      style={{ width: size, maxWidth: "100%" }}
    >
      <div className="flex items-stretch gap-2">
        {/* The eval bar only means something while Stockfish is actually
            running (build mode, engine on) — hide it in book-only / train. */}
        {engineEnabled && <EvalBar bestLine={bestLine} orientation={orientation} />}
        <div className="relative min-w-0 flex-1">
          <Chessboard options={options} />
          <div
            onPointerDown={startResize}
            role="slider"
            aria-label="Resize board"
            aria-valuemin={MIN_BOARD}
            aria-valuemax={MAX_BOARD}
            aria-valuenow={Math.round(size)}
            tabIndex={0}
            title="Drag to resize the board"
            className={`absolute -bottom-1.5 -right-1.5 z-20 hidden h-5 w-5 cursor-nwse-resize touch-none select-none items-center justify-center rounded-md border bg-slate-800/95 shadow-md transition-colors hoverable:flex ${
              resizing
                ? "border-emerald-500 text-emerald-300"
                : "border-slate-600 text-slate-400 hover:border-emerald-500 hover:text-emerald-300"
            }`}
          >
            <svg
              viewBox="0 0 10 10"
              className="h-2.5 w-2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            >
              <path d="M9 3 L3 9 M9 6.5 L6.5 9" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ControlButton onClick={goStart} disabled={moveNavLocked} title="Start (↑)">
          ⏮
        </ControlButton>
        <ControlButton onClick={goBack} disabled={moveNavLocked} title="Back (←)">
          ◀
        </ControlButton>
        <ControlButton onClick={goForward} disabled={moveNavLocked} title="Forward (→)">
          ▶
        </ControlButton>
        <ControlButton onClick={goEnd} disabled={moveNavLocked} title="End (↓)">
          ⏭
        </ControlButton>
        <div className="mx-1 h-5 w-px bg-slate-700" />
        <ControlButton onClick={flipBoard} title="Flip board (f)">
          ⇅ Flip
        </ControlButton>
        <ControlButton onClick={resetBoard} disabled={navLocked} title="Reset to start">
          ↺ Reset
        </ControlButton>

        <div className="mx-1 h-5 w-px bg-slate-700" />
        <div className="flex items-center gap-1" role="group" aria-label="Board colour">
          {BOARD_THEME_ORDER.map((name) => {
            const t = BOARD_THEMES[name];
            const active = theme === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => selectTheme(name)}
                title={`${t.label} board`}
                aria-label={`${t.label} board`}
                aria-pressed={active}
                className={`h-6 w-6 rounded-md border transition ${
                  active
                    ? "border-emerald-400 ring-2 ring-emerald-400/70"
                    : "border-slate-600 hover:border-slate-400"
                }`}
                style={{
                  background: `linear-gradient(135deg, ${t.light} 0 50%, ${t.dark} 50% 100%)`,
                }}
              />
            );
          })}
        </div>

        <div className="ml-auto text-xs text-slate-400">
          <EngineStatusBadge status={engineStatus} enabled={engineEnabled} evaluation={evalMatches ? evaluation : null} />
        </div>
      </div>
    </div>
  );
}

function EngineStatusBadge({
  status,
  enabled,
  evaluation,
}: {
  status: EngineStatus;
  enabled: boolean;
  evaluation: EngineEval | null;
}) {
  if (!enabled) return <span className="text-slate-500">Engine off</span>;
  if (status === "error")
    return <span className="text-rose-400">Engine failed to load</span>;
  if (status === "loading")
    return <span className="animate-soft-pulse">Loading Stockfish…</span>;
  const depth = evaluation?.depth ?? 0;
  const running = evaluation?.running;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${running ? "animate-soft-pulse bg-emerald-400" : "bg-emerald-500"}`}
      />
      Stockfish 18 · depth {depth}
    </span>
  );
}
