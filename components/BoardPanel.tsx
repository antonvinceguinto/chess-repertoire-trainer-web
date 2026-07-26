"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Chessboard } from "react-chessboard";
import { useTrainer } from "@/context/TrainerContext";
import { legalMoves, tryMove } from "@/lib/chess";
import type { GameReview, MoveClass } from "@/lib/review";
import type { EngineEval, EngineLine, EngineStatus } from "@/lib/types";
import { EvalBar } from "./EvalBar";
import { MoveClassDisc } from "./MoveClassBadge";
import { ControlButton } from "./ui";

interface Props {
  evaluation: EngineEval | null;
  engineStatus: EngineStatus;
  engineEnabled: boolean;
  /** Set while reviewing a game, so the board can colour the move just played. */
  review?: GameReview | null;
}

const HIGHLIGHT = "rgba(250, 204, 21, 0.45)";

/** Square tint for the move just played, by how good it was. */
const REVIEW_TINT: Record<MoveClass, string> = {
  blunder: "rgba(244, 63, 94, 0.45)",
  mistake: "rgba(251, 146, 60, 0.45)",
  inaccuracy: "rgba(251, 191, 36, 0.45)",
  good: "rgba(148, 163, 184, 0.40)",
  excellent: "rgba(52, 211, 153, 0.40)",
  best: "rgba(34, 197, 94, 0.42)",
  great: "rgba(56, 189, 248, 0.45)",
  book: "rgba(167, 139, 250, 0.40)",
};

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

export function BoardPanel({
  evaluation,
  engineStatus,
  engineEnabled,
  review = null,
}: Props) {
  const t = useTrainer();
  const {
    fen,
    ply,
    orientation,
    lastMove,
    mode,
    turn,
    session,
    fixQueue,
    reviewChallenge,
    inVariation,
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

  // While guiding a gap fix, the board must stay on the gap position.
  const navLocked = mode === "train" || fixQueue !== null;

  const evalMatches = evaluation != null && evaluation.fen === fen;
  const liveBestLine =
    evalMatches && evaluation.lines.length > 0 ? evaluation.lines[0] : null;

  // In review the board is a viewer: pieces only move while the coach has
  // asked you to find a move, and only until you've found it.
  const challengeOpen =
    mode === "review" &&
    reviewChallenge != null &&
    ply === reviewChallenge.index &&
    reviewChallenge.status !== "correct";

  // The move that produced the position on the board, and its verdict. Inside a
  // variation the moves are no longer the game's, so `review.moves[ply - 1]`
  // would label a different move — leave it unmarked there.
  const reviewedMove =
    mode === "review" && review && !reviewChallenge && !inVariation && ply >= 1
      ? review.moves[ply - 1] ?? null
      : null;

  // The live engine is parked during review, so drive the eval bar from the
  // sweep's own numbers instead of leaving it stuck at 0.00.
  const reviewBestLine: EngineLine | null = useMemo(() => {
    if (mode !== "review" || inVariation || !review) return null;
    const index = Math.min(ply, review.moves.length) - 1;
    const move = index >= 0 ? review.moves[index] : review.moves[0];
    if (!move) return null;
    const scoreWhite = index >= 0 ? move.cpAfter : move.cpBefore;
    const mate = index >= 0 ? move.mateAfter : move.mateBefore;
    return {
      multipv: 1,
      depth: review.depth,
      type: mate != null ? "mate" : "cp",
      value: mate != null ? Math.abs(mate) : scoreWhite,
      scoreWhite,
      uci: "",
      san: "",
      pvSan: [],
    };
  }, [mode, inVariation, review, ply]);

  // During review only the sweep may drive the bar — otherwise the last
  // evaluation from build mode lingers on the identical starting position.
  const bestLine = mode === "review" ? reviewBestLine : liveBestLine;

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

  // Keyboard navigation (not in training, where the board is pinned to a drill).
  useEffect(() => {
    if (mode === "train") return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "f") {
        flipBoard();
        return;
      }
      // During a fix the board is pinned to each gap, so left/right walk the gap
      // queue (previous / next) rather than the moves of a single line.
      if (fixQueue !== null) {
        if (e.key === "ArrowLeft") prevFix();
        else if (e.key === "ArrowRight") nextFix();
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
      // In review, colour the last move by how good it was instead of plain yellow.
      const tint = reviewedMove
        ? REVIEW_TINT[reviewedMove.classification]
        : HIGHLIGHT;
      styles[lastMove.from] = { background: tint };
      styles[lastMove.to] = { background: tint };
    }
    return styles;
  }, [lastMove, reviewedMove]);

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

  // Arrows: engine suggestions in build mode; revealed answers in train mode;
  // the move you should have played in review mode.
  const arrows = useMemo(() => {
    let raw: { startSquare: string; endSquare: string; color: string }[];
    if (mode === "train") {
      const targetLine = session?.lines[session.lineIndex];
      const expected = targetLine?.[ply];
      if (!session?.revealed || !expected) return [];
      const mv = tryMove(fen, expected);
      if (!mv) return [];
      raw = [{ startSquare: mv.from, endSquare: mv.to, color: "#22c55e" }];
    } else if (mode === "review") {
      // Never draw the answer while it's still being asked for.
      if (challengeOpen) return [];
      const solved =
        reviewChallenge && review
          ? review.moves[reviewChallenge.index] ?? null
          : null;
      const target = solved ?? reviewedMove;
      if (!target?.bestSan || target.bestSan === target.san) return [];
      const best = tryMove(target.fenBefore, target.bestSan);
      if (!best) return [];
      raw = [{ startSquare: best.from, endSquare: best.to, color: "#22c55e" }];
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
  }, [
    mode,
    session,
    ply,
    fen,
    engineEnabled,
    evalMatches,
    evaluation,
    review,
    reviewChallenge,
    reviewedMove,
    challengeOpen,
  ]);

  // Merge the move highlight with the click-to-move option dots. Also reused by
  // the square renderer below, which replaces the board's default squares.
  const squareStyles = useMemo(
    () => ({ ...highlightStyles, ...optionSquares }),
    [highlightStyles, optionSquares],
  );

  // The verdict badge for the move just played, on its destination square.
  const badgeSquare = reviewedMove && lastMove ? lastMove.to : null;
  const badgeClass = reviewedMove?.classification ?? null;

  // Draw the badge over the last move's destination square. Providing a
  // squareRenderer replaces the board's default square content, so it has to
  // re-apply squareStyles itself; left undefined when there's no badge to show.
  const squareRenderer = useMemo(() => {
    if (!badgeClass || !badgeSquare) return undefined;
    return ({ square, children }: { square: string; children?: ReactNode }) => (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          ...squareStyles[square],
        }}
      >
        {children}
        {square === badgeSquare && (
          <div
            style={{
              // A CSS size-container, so the disc scales its glyph to the
              // square. Kept inside the square — the board clips at the edges.
              position: "absolute",
              top: "2%",
              right: "2%",
              width: "40%",
              height: "40%",
              containerType: "size",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            <MoveClassDisc cls={badgeClass} />
          </div>
        )}
      </div>
    );
  }, [badgeClass, badgeSquare, squareStyles]);

  const options = useMemo(
    () => ({
      position: fen,
      boardOrientation: orientation,
      animationDurationInMs: 200,
      darkSquareStyle: { backgroundColor: BOARD_THEMES[theme].dark },
      lightSquareStyle: { backgroundColor: BOARD_THEMES[theme].light },
      squareStyles,
      arrows,
      id: "trainer-board",
      squareRenderer,
      canDragPiece: ({ piece }: { piece: { pieceType: string } }) => {
        // Reviewing: the game underneath must not change, so pieces only move
        // while the coach is asking you to find something.
        if (mode === "review") return challengeOpen && piece.pieceType[0] === turn;
        if (mode !== "train") return true;
        if (!userChar) return false;
        return piece.pieceType[0] === userChar && turn === userChar;
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
          (mode === "train"
            ? userChar != null && pc === userChar && turn === userChar
            : mode === "review"
              ? challengeOpen && pc === turn
              : pc === turn);
        setMoveFrom(canSelect ? square : null);
      },
    }),
    [
      fen,
      orientation,
      theme,
      squareStyles,
      squareRenderer,
      arrows,
      mode,
      userChar,
      turn,
      playMove,
      moveFrom,
      challengeOpen,
    ],
  );

  return (
    <div
      className="flex flex-col gap-3"
      style={{ width: size, maxWidth: "100%" }}
    >
      <div className="flex items-stretch gap-2">
        <EvalBar bestLine={bestLine} orientation={orientation} />
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
        <ControlButton onClick={goStart} disabled={navLocked} title="Start (↑)">
          ⏮
        </ControlButton>
        <ControlButton onClick={goBack} disabled={navLocked} title="Back (←)">
          ◀
        </ControlButton>
        <ControlButton onClick={goForward} disabled={navLocked} title="Forward (→)">
          ▶
        </ControlButton>
        <ControlButton onClick={goEnd} disabled={navLocked} title="End (↓)">
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
          {mode === "review" ? (
            <span className="text-slate-500">
              {review
                ? `Reviewed at depth ${review.depth}`
                : "Review engine starting…"}
            </span>
          ) : (
            <EngineStatusBadge
              status={engineStatus}
              enabled={engineEnabled}
              evaluation={evalMatches ? evaluation : null}
            />
          )}
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
