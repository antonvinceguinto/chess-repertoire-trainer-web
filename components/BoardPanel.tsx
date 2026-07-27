"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Chessboard, defaultPieces } from "react-chessboard";
import { useTrainer } from "@/context/TrainerContext";
import { legalMoves, tryMove } from "@/lib/chess";
import type { Classification } from "@/lib/classify";
import {
  moveAt,
  terminalEval,
  type GameReview,
  type MoveClass,
  type MoveReview,
} from "@/lib/review";
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
  /** Move reactions keyed by 0-based move index, for the on-board badge. */
  moveClasses?: Map<number, Classification>;
}

const HIGHLIGHT = "rgba(250, 204, 21, 0.45)";
/** Right-click annotation colour (Lichess-style square marker). */
const RED_HIGHLIGHT = "rgba(235, 66, 66, 0.6)";
/** Square tint for a move that isn't part of the game at all. */
const BRANCH_HIGHLIGHT = "rgba(56, 189, 248, 0.40)";

/** Square tint for the move just played, by how good it was. */
const REVIEW_TINT: Record<MoveClass, string> = {
  blunder: "rgba(244, 63, 94, 0.45)",
  mistake: "rgba(251, 146, 60, 0.45)",
  inaccuracy: "rgba(251, 191, 36, 0.45)",
  good: "rgba(148, 163, 184, 0.40)",
  excellent: "rgba(52, 211, 153, 0.40)",
  best: "rgba(34, 197, 94, 0.42)",
  great: "rgba(56, 189, 248, 0.45)",
  brilliant: "rgba(45, 212, 191, 0.45)",
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

/**
 * Piece styles. All of them draw the same Staunton silhouettes the board
 * already ships (react-chessboard's set) — only the material changes, which is
 * how chess.com's own sets differ from one another too. Nothing is redrawn, so
 * every style stays as legible as the default at any board size, and the
 * built-in detail marks (the knight's eye, the king's cross) keep their own
 * contrast colours automatically.
 */
const PIECE_SETS = {
  standard: { label: "Standard", white: "#ffffff", black: "#000000" },
  classic: { label: "Classic", white: "#f7f1e4", black: "#2f2b26" },
  wood: { label: "Wood", white: "#e7c79b", black: "#6a4527" },
  ice: { label: "Ice", white: "#e9f2fb", black: "#41566f" },
} as const;
type PieceSet = keyof typeof PIECE_SETS;
const PIECE_SET_ORDER: PieceSet[] = ["standard", "classic", "wood", "ice"];
const DEFAULT_PIECE_SET: PieceSet = "standard";
const PIECE_SET_KEY = "chess-piece-set";

/** Props react-chessboard hands each piece renderer. */
type PieceRenderProps = {
  fill?: string;
  square?: string;
  svgStyle?: CSSProperties;
};

const MIN_BOARD = 320;
const MAX_BOARD = 900;
const DEFAULT_BOARD = 560;
const BOARD_SIZE_KEY = "chess-board-size";

export function BoardPanel({
  evaluation,
  engineStatus,
  engineEnabled,
  review = null,
  moveClasses,
}: Props) {
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
    reviewSession,
    reviewChallenge,
    inVariation,
    restoreGame,
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

  // Free play in review is only safe once there is a game to come back to.
  const reviewLive = mode === "review" && reviewSession != null;

  const evalMatches = evaluation != null && evaluation.fen === fen;
  const liveBestLine =
    evalMatches && evaluation.lines.length > 0 ? evaluation.lines[0] : null;

  // No longer a movement gate — it only suppresses the answer arrow, including
  // after a wrong guess, when the user can step back onto the puzzle.
  const challengeOpen =
    mode === "review" &&
    reviewChallenge != null &&
    ply === reviewChallenge.index &&
    reviewChallenge.status !== "correct";

  // The move that produced the position on the board, and its verdict. Inside a
  // variation the moves are no longer the game's, so `review.moves[ply - 1]`
  // would label a different move — leave it unmarked there.
  const reviewedMove =
    mode === "review" && !reviewChallenge && !inVariation && ply >= 1
      ? moveAt(review, ply - 1)
      : null;

  // The live engine is parked during review, so drive the eval bar from the
  // sweep's own numbers instead of leaving it stuck at 0.00.
  const reviewBestLine: EngineLine | null = useMemo(() => {
    if (mode !== "review" || inVariation || !review) return null;
    // Mid-sweep the move under the cursor may have no verdict yet, so fall back
    // to the latest one before it rather than blanking the bar. `moves` is in
    // half-move order, so the last match is the closest one.
    let judged: MoveReview | null = null;
    for (const m of review.moves) {
      if (m.index > ply - 1) break;
      judged = m;
    }
    const move = judged ?? review.moves[0];
    if (!move) return null;
    const scoreWhite = judged ? judged.cpAfter : move.cpBefore;
    const mate = judged ? judged.mateAfter : move.mateBefore;
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

  // A move that ends the game leaves Stockfish nothing to search (no `pv`, so no
  // lines), which would blank the bar at the most satisfying possible moment.
  // Score those directly, the way the sweep already scores a game's final move.
  const terminalLine: EngineLine | null = useMemo(() => {
    if (mode !== "review" || !inVariation) return null;
    const term = terminalEval(fen);
    if (!term) return null;
    return {
      multipv: 1,
      depth: 0,
      type: term.terminal === "checkmate" ? "mate" : "cp",
      value: 0,
      scoreWhite: term.cpWhite,
      uci: "",
      san: "",
      pvSan: [],
    };
  }, [mode, inVariation, fen]);

  // On the game only the sweep may drive the bar — otherwise the last evaluation
  // from build mode lingers on the identical starting position. Off the game the
  // sweep knows nothing, so the live engine takes over. `engineEnabled` is
  // load-bearing: useEngine keeps its last evaluation after being disabled.
  const bestLine =
    mode === "review"
      ? reviewBestLine ?? terminalLine ?? (engineEnabled ? liveBestLine : null)
      : liveBestLine;

  // Resizable board widget (persisted across sessions).
  const [size, setSize] = useState(DEFAULT_BOARD);
  const [resizing, setResizing] = useState(false);

  // Board colour scheme and piece style (both persisted across sessions).
  const [theme, setTheme] = useState<BoardTheme>(DEFAULT_THEME);
  const [pieceSet, setPieceSet] = useState<PieceSet>(DEFAULT_PIECE_SET);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(BOARD_SIZE_KEY));
    if (saved >= MIN_BOARD && saved <= MAX_BOARD) setSize(saved);
    const savedTheme = window.localStorage.getItem(BOARD_THEME_KEY);
    if (savedTheme && savedTheme in BOARD_THEMES) {
      setTheme(savedTheme as BoardTheme);
    }
    const savedPieces = window.localStorage.getItem(PIECE_SET_KEY);
    if (savedPieces && savedPieces in PIECE_SETS) {
      setPieceSet(savedPieces as PieceSet);
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

  const selectPieceSet = (name: PieceSet) => {
    setPieceSet(name);
    try {
      window.localStorage.setItem(PIECE_SET_KEY, name);
    } catch {
      /* ignore */
    }
  };

  // Re-colour the board's own pieces. Each default piece takes a `fill` for its
  // body paths, so tinting is all a style needs — the geometry, the outlines and
  // the contrast details are the board's and stay untouched.
  const pieces = useMemo(() => {
    const set = PIECE_SETS[pieceSet];
    if (pieceSet === DEFAULT_PIECE_SET) return undefined; // board's own colours
    const out: Record<string, (props?: PieceRenderProps) => ReactElement> = {};
    for (const key of Object.keys(defaultPieces)) {
      const render = defaultPieces[key];
      const fill = key[0] === "w" ? set.white : set.black;
      out[key] = (props?: PieceRenderProps) => render({ ...props, fill });
    }
    return out;
  }, [pieceSet]);

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
      if (e.key === "Escape") {
        // Bail out of a side line back onto the game.
        if (mode === "review" && inVariation) restoreGame();
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
  }, [
    mode,
    navLocked,
    fixQueue,
    inVariation,
    restoreGame,
    prevFix,
    nextFix,
    goBack,
    goForward,
    goStart,
    goEnd,
    flipBoard,
  ]);

  const userChar = session ? (session.color === "white" ? "w" : "b") : null;

  const offGame = mode === "review" && inVariation;
  const highlightStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (lastMove) {
      // In review, colour the last move by how good it was — unless it isn't the
      // game's move at all, which gets the "this is a side line" sky tint.
      const tint = reviewedMove
        ? REVIEW_TINT[reviewedMove.classification]
        : offGame
          ? BRANCH_HIGHLIGHT
          : HIGHLIGHT;
      styles[lastMove.from] = { background: tint };
      styles[lastMove.to] = { background: tint };
    }
    return styles;
  }, [lastMove, reviewedMove, offGame]);

  // Click / tap to move: first tap selects a piece, second tap moves it.
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  // Right-click square annotations (red markers), cleared when the position changes.
  const [redSquares, setRedSquares] = useState<Set<string>>(new Set());
  useEffect(() => {
    setMoveFrom(null);
    setRedSquares(new Set());
  }, [fen]);

  const redStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    for (const sq of redSquares) styles[sq] = { background: RED_HIGHLIGHT };
    return styles;
  }, [redSquares]);

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
    const engineArrows = () => {
      if (!engineEnabled || !evalMatches) return [];
      const palette = ["#22c55e", "#38bdf8", "#a78bfa"];
      return evaluation!.lines.slice(0, 3).map((l, i) => ({
        startSquare: l.uci.slice(0, 2),
        endSquare: l.uci.slice(2, 4),
        color: palette[i] ?? "#64748b",
      }));
    };
    let raw: { startSquare: string; endSquare: string; color: string }[];
    if (mode === "train") {
      const targetLine = session?.lines[session.lineIndex];
      const expected = targetLine?.[ply];
      if (!session?.revealed || !expected) return [];
      const mv = tryMove(fen, expected);
      if (!mv) return [];
      raw = [{ startSquare: mv.from, endSquare: mv.to, color: "#22c55e" }];
    } else if (mode === "review") {
      // Never draw the answer while it's still being asked for — including after
      // a wrong guess, when the user can step back onto the puzzle.
      if (challengeOpen) return [];
      if (inVariation) {
        // Off the game the sweep's arrow describes a move that isn't there.
        raw = engineArrows();
      } else {
        if (!reviewedMove?.bestSan || reviewedMove.bestSan === reviewedMove.san)
          return [];
        const best = tryMove(reviewedMove.fenBefore, reviewedMove.bestSan);
        if (!best) return [];
        raw = [{ startSquare: best.from, endSquare: best.to, color: "#22c55e" }];
      }
    } else {
      raw = engineArrows();
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
    inVariation,
    reviewedMove,
    challengeOpen,
  ]);

  // Merge move highlights with the click-to-move option dots; also reused by the
  // custom square renderer below (which replaces the board's default squares).
  const squareStyles = useMemo(
    () => ({ ...highlightStyles, ...redStyles, ...optionSquares }),
    [highlightStyles, redStyles, optionSquares],
  );

  // The last move's reaction badge (chess.com-style). Two sources feed it: while
  // reviewing a game it's the sweep's verdict on that move, and everywhere else
  // it's the live move-review's reaction. Review's classes are a subset of the
  // classifier's, so both render through the same disc.
  const badgeSquare = lastMove
    ? mode === "review"
      ? reviewedMove
        ? lastMove.to
        : null
      : lastMove.to
    : null;
  const badgeClass: MoveClass | Classification["cls"] | null = !lastMove
    ? null
    : mode === "review"
      ? reviewedMove?.classification ?? null
      : moveClasses?.get(ply - 1)?.cls ?? null;

  // Draw the reaction badge on the last move's destination square. Providing a
  // squareRenderer replaces the board's default square content, so it re-applies
  // squareStyles itself; it's left undefined when there's no badge to show.
  const squareRenderer = useMemo(() => {
    if (!badgeClass || !badgeSquare) return undefined;
    return ({ square, children }: { square: string; children?: ReactNode }) => (
      <div
        style={{ position: "relative", width: "100%", height: "100%", ...squareStyles[square] }}
      >
        {children}
        {square === badgeSquare && (
          <div
            style={{
              // A CSS size-container (so the disc sizes its glyph to the square),
              // kept inside the square since the board clips overflow at edges.
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
      pieces,
      id: "trainer-board",
      squareRenderer,
      canDragPiece: ({ piece }: { piece: { pieceType: string } }) => {
        if (mode === "train") {
          if (!userChar) return false;
          return piece.pieceType[0] === userChar && turn === userChar;
        }
        // Reviewing: the board is yours to explore — your moves only ever fork a
        // side line, and the game stays intact underneath. With no game loaded
        // there is nothing to fork or come back to, so the board stays inert.
        if (mode === "review") return reviewLive && piece.pieceType[0] === turn;
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
        // Any left click clears the red annotations.
        setRedSquares((prev) => (prev.size === 0 ? prev : new Set()));
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
            : mode === "review"
              ? reviewLive && pc === turn
              : pc === turn);
        setMoveFrom(canSelect ? square : null);
      },
      // Right-click toggles a red marker on the square (right-drag still draws
      // arrows via react-chessboard's built-in handling).
      onSquareRightClick: ({ square }: { square: string }) => {
        setRedSquares((prev) => {
          const next = new Set(prev);
          if (next.has(square)) next.delete(square);
          else next.add(square);
          return next;
        });
      },
    }),
    [
      fen,
      orientation,
      theme,
      pieces,
      squareStyles,
      arrows,
      squareRenderer,
      mode,
      userChar,
      turn,
      playMove,
      moveFrom,
      reviewLive,
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
        {reviewLive ? (
          <ControlButton
            onClick={() => restoreGame()}
            disabled={!inVariation}
            title="Put the reviewed game back on the board (Esc)"
          >
            ↩ Back to the game
          </ControlButton>
        ) : (
          <ControlButton onClick={resetBoard} disabled={navLocked} title="Reset to start">
            ↺ Reset
          </ControlButton>
        )}

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

        <div className="mx-1 h-5 w-px bg-slate-700" />
        <div className="flex items-center gap-1" role="group" aria-label="Piece style">
          {PIECE_SET_ORDER.map((name) => {
            const set = PIECE_SETS[name];
            const active = pieceSet === name;
            // Preview each style with the piece itself, in that style's colours.
            const Knight = defaultPieces.wN;
            return (
              <button
                key={name}
                type="button"
                onClick={() => selectPieceSet(name)}
                title={`${set.label} pieces`}
                aria-label={`${set.label} pieces`}
                aria-pressed={active}
                className={`flex h-6 w-6 items-center justify-center rounded-md border bg-slate-900 transition ${
                  active
                    ? "border-emerald-400 ring-2 ring-emerald-400/70"
                    : "border-slate-600 hover:border-slate-400"
                }`}
              >
                <span className="block h-[18px] w-[18px]">
                  <Knight fill={set.white} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto text-xs text-slate-400">
          {mode === "review" && !inVariation ? (
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
