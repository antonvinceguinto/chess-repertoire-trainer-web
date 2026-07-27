"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Color,
  LineMove,
  Mode,
  Repertoire,
  TrainSession,
  Turn,
} from "@/lib/types";
import {
  START_FEN,
  fenAtPly,
  turnOf,
  tryMove,
  type MoveInput,
} from "@/lib/chess";
import {
  addLine,
  loadActiveId,
  loadRepertoires,
  newRepertoire,
  removeLine,
  saveActiveId,
  saveRepertoires,
  setComment,
} from "@/lib/repertoire";
import { loadGame } from "@/lib/pgn";
import type { ChessComGame } from "@/lib/chesscom";
import { colorOf } from "@/lib/chesscom";
import type { ReviewChallenge, ReviewSession } from "@/lib/review";
import { mergeRepertoires } from "@/lib/transfer";
import { reshuffleLines, shuffle } from "@/lib/shuffle";

/** Who built the side line currently on the board in review mode. */
export type BranchSource = "engine" | "user";

/**
 * A side line replacing the tail of the reviewed game. `from` is the number of
 * game half-moves still intact at the head of `line`, i.e. `line.slice(0, from)`
 * equals `game.moves.slice(0, from)`. It may only ever move *down* while the
 * branch lives: navigation is unlocked in review, so the user can step back
 * before the fork and play there instead.
 */
interface ReviewBranch {
  from: number;
  source: BranchSource;
  /**
   * The reviewed half-move this side line was opened to illustrate, so the coach
   * keeps talking about that move while you explore its suggestion. Null for a
   * line you struck out on your own, which illustrates nothing in particular.
   */
  origin: number | null;
  /** How to name the side line in the UI, e.g. "Qd2". */
  label: string | null;
}

/** Extra context for a side line the coach (rather than the user) opened. */
export interface VariationOptions {
  origin?: number;
  label?: string;
}

interface TrainerContextValue {
  // Position
  line: LineMove[];
  ply: number;
  fen: string;
  turn: Turn;
  orientation: Color;
  lastMove: LineMove | null;
  currentSans: string[];
  /** The gap position while fixing (end of `line`), independent of the `ply` cursor. */
  gapFen: string;
  /** True while a line is animating in move-by-move (e.g. entering a fix). */
  animating: boolean;

  // Repertoires
  repertoires: Repertoire[];
  activeId: string | null;
  activeRepertoire: Repertoire | null;
  loaded: boolean;

  // Mode / training
  mode: Mode;
  session: TrainSession | null;

  // Navigation
  playMove: (input: MoveInput | string) => boolean;
  goToPly: (ply: number) => void;
  goStart: () => void;
  goBack: () => void;
  goForward: () => void;
  goEnd: () => void;
  loadLineSans: (sans: string[]) => void;
  playLineSans: (sans: string[]) => void;
  flipBoard: () => void;
  resetBoard: () => void;

  // Repertoire management
  createRepertoire: (name: string, color: Color) => void;
  deleteRepertoire: (id: string) => void;
  renameRepertoire: (id: string, name: string) => void;
  selectRepertoire: (id: string) => void;
  /** Import repertoires; returns whether they were persisted to this browser. */
  importRepertoires: (reps: Repertoire[], mode: "merge" | "replace") => boolean;
  addCurrentLine: () => void;
  addMoveToRepertoire: (input: MoveInput | string) => void;
  removeRepertoireLine: (sans: string[]) => void;
  setLineComment: (sans: string[], comment: string) => void;

  // Training
  setMode: (m: Mode) => void;
  startTraining: (lines: string[][]) => void;
  reshuffleTraining: () => void;
  stopTraining: () => void;
  revealAnswer: () => void;
  restartLine: () => void;
  nextTrainingLine: () => void;
  prevTrainingLine: () => void;

  // Guided gap fixing
  fixQueue: string[][] | null;
  fixIndex: number;
  startFix: (paths: string[][]) => void;
  fixAddMove: (san: string) => void;
  prevFix: () => void;
  nextFix: () => void;
  skipFix: () => void;
  endFix: () => void;

  // Game review (your own Chess.com games)
  reviewSession: ReviewSession | null;
  /** Load a downloaded game onto the board. Returns false if its PGN is unreadable. */
  startReview: (source: ChessComGame, username: string) => boolean;
  /** Put the reviewed game away but stay on the game list. */
  closeReviewGame: () => void;
  /** Leave review mode entirely and go back to building. */
  exitReview: () => void;
  /** Ply the board is on, expressed as the half-move index the review lists. */
  reviewChallenge: ReviewChallenge | null;
  /** Park the board before move `index` and ask the user to find `bestSan`. */
  startChallenge: (index: number, bestSan: string) => void;
  endChallenge: () => void;
  /** Play a variation onto the board from `fromPly`, keeping the game restorable. */
  playVariation: (
    fromPly: number,
    sans: string[],
    options?: VariationOptions,
  ) => void;
  /** True while a side line — the engine's or your own — has replaced part of the game. */
  inVariation: boolean;
  /** Half-move the side line forked from the game at; null when the game itself is up. */
  variationFrom: number | null;
  /** The reviewed move the current side line illustrates, if it illustrates one. */
  variationOrigin: number | null;
  /** Readable name for the current side line, when it has one. */
  variationLabel: string | null;
  /** Who built the current side line; null when the game itself is up. */
  branchSource: BranchSource | null;
  /** Put the reviewed game back on the board at `ply`. */
  restoreGame: (ply?: number) => void;
}

const TrainerContext = createContext<TrainerContextValue | null>(null);

export function useTrainer(): TrainerContextValue {
  const ctx = useContext(TrainerContext);
  if (!ctx) throw new Error("useTrainer must be used within a TrainerProvider");
  return ctx;
}

const OPPONENT_DELAY_MS = 550;
/** Cadence for animated line playback (e.g. when previewing a gap line). */
const LINE_ANIM_MS = 500;
const LINE_ANIM_START_MS = 200;

/** Replay a SAN sequence from the start into a list of line moves. */
function buildLine(sans: string[]): LineMove[] {
  let f = START_FEN;
  const line: LineMove[] = [];
  for (const san of sans) {
    const mv = tryMove(f, san);
    if (!mv) break;
    line.push(mv);
    f = mv.fen;
  }
  return line;
}

export function TrainerProvider({ children }: { children: React.ReactNode }) {
  const [line, setLine] = useState<LineMove[]>([]);
  const [ply, setPly] = useState(0);
  // True while a line is playing in move-by-move (e.g. entering a fix).
  const [animating, setAnimating] = useState(false);
  const [orientation, setOrientation] = useState<Color>("white");
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("build");
  const [session, setSession] = useState<TrainSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Guided gap-fixing: a queue of gap positions to walk through and answer.
  const [fixQueue, setFixQueue] = useState<string[][] | null>(null);
  const [fixIndex, setFixIndex] = useState(0);
  // Latest "save this reply & advance" handler, or null when not fixing — lets
  // playMove (defined earlier) route a board move through the fix flow.
  const fixSaveRef = useRef<((mv: LineMove) => void) | null>(null);
  // Game review: the loaded game, the "find the better move" prompt, and the
  // side line branched off it (null when the game itself is up).
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [reviewChallenge, setReviewChallenge] =
    useState<ReviewChallenge | null>(null);
  const [branch, setBranch] = useState<ReviewBranch | null>(null);

  const fen = fenAtPly(line, ply);
  const variationFrom = branch?.from ?? null;
  const turn = turnOf(fen);
  const lastMove = ply > 0 ? line[ply - 1] : null;
  // The board can scrub back (via ←/→) to review how a gap arose while fixing;
  // the gap itself is always the end of `line`, so pin its FEN independent of `ply`.
  const gapFen = fenAtPly(line, line.length);
  const activeRepertoire = useMemo(
    () => repertoires.find((r) => r.id === activeId) ?? null,
    [repertoires, activeId],
  );
  const currentSans = useMemo(
    () => line.slice(0, ply).map((m) => m.san),
    [line, ply],
  );

  /* ---------------- Persistence ---------------- */

  useEffect(() => {
    const reps = loadRepertoires();
    const active = loadActiveId();
    setRepertoires(reps);
    setActiveId(
      active && reps.some((r) => r.id === active)
        ? active
        : reps[0]?.id ?? null,
    );
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveRepertoires(repertoires);
  }, [repertoires, loaded]);

  useEffect(() => {
    if (loaded) saveActiveId(activeId);
  }, [activeId, loaded]);

  /* ---------------- Helpers ---------------- */

  // Timer for animated line playback; cancelled by any manual navigation.
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopAnimation = useCallback(() => {
    if (animRef.current) {
      clearTimeout(animRef.current);
      animRef.current = null;
    }
    setAnimating(false);
  }, []);
  useEffect(() => stopAnimation, [stopAnimation]);

  const updateRepertoire = useCallback(
    (id: string, fn: (r: Repertoire) => Repertoire) => {
      setRepertoires((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
    },
    [],
  );

  /** Drop everything about a reviewed game (any other mode takes the board). */
  const clearReview = useCallback(() => {
    setReviewSession(null);
    setReviewChallenge(null);
    setBranch(null);
  }, []);

  const advanceWith = useCallback(
    (mv: LineMove) => {
      setLine((prev) => {
        if (ply < prev.length && prev[ply].san === mv.san) return prev;
        return [...prev.slice(0, ply), mv];
      });
      setPly((p) => p + 1);
    },
    [ply],
  );

  /* ---------------- Training move handling ---------------- */

  const handleTrainMove = useCallback(
    (mv: LineMove): boolean => {
      if (!session) return false;
      const userChar: Turn = session.color === "white" ? "w" : "b";
      if (mv.color !== userChar) return false;

      const targetLine = session.lines[session.lineIndex];
      const expected = targetLine?.[ply];
      if (mv.san !== expected) {
        setSession((s) =>
          s ? { ...s, status: "wrong", mistakes: s.mistakes + 1, lastWrong: mv.san } : s,
        );
        return false;
      }
      advanceWith(mv);
      setSession((s) =>
        s
          ? { ...s, status: "correct", correct: s.correct + 1, lastWrong: null, revealed: false }
          : s,
      );
      return true;
    },
    [session, ply, advanceWith],
  );

  // Auto-play the opponent's move for the line being drilled, and detect end-of-line.
  useEffect(() => {
    if (mode !== "train" || !session) return;
    if (session.status === "wrong") return;

    const targetLine = session.lines[session.lineIndex];
    if (!targetLine) {
      if (session.status !== "empty") {
        setSession((s) => (s ? { ...s, status: "empty" } : s));
      }
      return;
    }

    if (ply >= targetLine.length) {
      if (session.status !== "complete") {
        setSession((s) => (s ? { ...s, status: "complete" } : s));
      }
      return;
    }

    const userChar: Turn = session.color === "white" ? "w" : "b";
    if (turn === userChar) {
      // status "wrong" already returned above; nudge stale states back to playing.
      if (session.status !== "playing" && session.status !== "correct") {
        setSession((s) => (s ? { ...s, status: "playing" } : s));
      }
      return;
    }

    // Opponent to move — play the exact move from the current line after a short delay.
    const expected = targetLine[ply];
    const timer = setTimeout(() => {
      const mv = tryMove(fen, expected);
      if (!mv) return;
      setLine((prev) => [...prev.slice(0, ply), mv]);
      setPly((p) => p + 1);
      setSession((s) =>
        s ? { ...s, status: "playing", lastWrong: null, revealed: false } : s,
      );
    }, OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mode, session, turn, ply, fen]);

  /* ---------------- Navigation ---------------- */

  // Latest "check this against the engine's move" handler for review mode, or
  // null outside it — same indirection trick as fixSaveRef.
  const reviewMoveRef = useRef<((mv: LineMove) => boolean) | null>(null);

  const playMove = useCallback(
    (input: MoveInput | string): boolean => {
      stopAnimation();
      const mv = tryMove(fen, input);
      if (!mv) return false;
      if (mode === "train") return handleTrainMove(mv);
      // Reviewing a finished game: the move follows the game, answers an open
      // challenge, or forks your own line off it — handleReviewMove decides.
      if (mode === "review") return reviewMoveRef.current?.(mv) ?? false;
      // During a guided fix the board is pinned to the gap. A move made *at* the
      // gap is your reply — save it and advance. While scrubbed back reviewing an
      // earlier move (via ←) the board is read-only, so ignore the move.
      if (fixQueue !== null) {
        if (fixSaveRef.current && ply === line.length) {
          fixSaveRef.current(mv);
          return true;
        }
        return false;
      }
      advanceWith(mv);
      return true;
    },
    [fen, mode, handleTrainMove, advanceWith, stopAnimation, fixQueue, ply, line],
  );

  const goToPly = useCallback(
    (n: number) => {
      stopAnimation();
      setPly(Math.max(0, Math.min(line.length, n)));
    },
    [line.length, stopAnimation],
  );
  const goStart = useCallback(() => {
    stopAnimation();
    setPly(0);
  }, [stopAnimation]);
  const goBack = useCallback(() => {
    stopAnimation();
    setPly((p) => Math.max(0, p - 1));
  }, [stopAnimation]);
  const goForward = useCallback(() => {
    stopAnimation();
    setPly((p) => Math.min(line.length, p + 1));
  }, [line.length, stopAnimation]);
  const goEnd = useCallback(() => {
    stopAnimation();
    setPly(line.length);
  }, [line.length, stopAnimation]);

  const loadLineSans = useCallback(
    (sans: string[]) => {
      stopAnimation();
      const newLine = buildLine(sans);
      setLine(newLine);
      setPly(newLine.length);
    },
    [stopAnimation],
  );

  /** Load a line and play it move-by-move (~0.5s each) instead of jumping. */
  const playLineSans = useCallback(
    (sans: string[]) => {
      stopAnimation();
      const newLine = buildLine(sans);
      setLine(newLine);
      setPly(0);
      const total = newLine.length;
      if (total === 0) return;
      setAnimating(true);
      let current = 0;
      const step = () => {
        current += 1;
        setPly(current);
        if (current < total) {
          animRef.current = setTimeout(step, LINE_ANIM_MS);
        } else {
          animRef.current = null;
          setAnimating(false);
        }
      };
      animRef.current = setTimeout(step, LINE_ANIM_START_MS);
    },
    [stopAnimation],
  );

  const flipBoard = useCallback(
    () => setOrientation((o) => (o === "white" ? "black" : "white")),
    [],
  );
  const resetBoard = useCallback(() => {
    stopAnimation();
    // In review the board belongs to the loaded game: "reset" means its first
    // position, never an empty board.
    if (mode === "review") {
      const game = reviewSession?.game;
      if (!game) return;
      setReviewChallenge(null);
      setLine(game.moves);
      setBranch(null);
      setPly(0);
      return;
    }
    setLine([]);
    setPly(0);
  }, [mode, reviewSession, stopAnimation]);

  /* ---------------- Repertoire management ---------------- */

  const createRepertoire = useCallback((name: string, color: Color) => {
    const rep = newRepertoire(name, color);
    setRepertoires((prev) => [...prev, rep]);
    setActiveId(rep.id);
    setOrientation(color);
    setFixQueue(null); // a fix queue for another repertoire must not carry over
    setLine([]);
    setPly(0);
  }, []);

  const deleteRepertoire = useCallback((id: string) => {
    setFixQueue(null);
    setRepertoires((prev) => {
      const next = prev.filter((r) => r.id !== id);
      setActiveId((curr) => (curr === id ? next[0]?.id ?? null : curr));
      return next;
    });
  }, []);

  const renameRepertoire = useCallback(
    (id: string, name: string) => {
      updateRepertoire(id, (r) => ({ ...r, name: name.trim() || r.name }));
    },
    [updateRepertoire],
  );

  const selectRepertoire = useCallback(
    (id: string) => {
      setActiveId(id);
      setFixQueue(null); // a queue built for another repertoire no longer applies
      const rep = repertoires.find((r) => r.id === id);
      if (rep) setOrientation(rep.color);
    },
    [repertoires],
  );

  /**
   * Bring in repertoires from a backup file / sync code. "replace" swaps the
   * whole collection; "merge" adds new ids and updates matching ones. Any
   * in-progress line or training session is cleared so the board stays sane.
   */
  const importRepertoires = useCallback(
    (incoming: Repertoire[], importMode: "merge" | "replace"): boolean => {
      if (incoming.length === 0) return false;
      stopAnimation();
      setModeState("build");
      setSession(null);
      setFixQueue(null);
      setLine([]);
      setPly(0);

      const next =
        importMode === "replace"
          ? incoming
          : mergeRepertoires(repertoires, incoming);
      let nextActive = activeId;
      if (
        importMode === "replace" ||
        !nextActive ||
        !next.some((r) => r.id === nextActive)
      ) {
        nextActive = incoming[0]?.id ?? next[0]?.id ?? null;
      }
      setRepertoires(next);
      setActiveId(nextActive);
      const activeRep = next.find((r) => r.id === nextActive);
      if (activeRep) setOrientation(activeRep.color);

      // Persist immediately so we can tell the user whether the write stuck
      // (the effect below also saves, but its result is unobservable here).
      return saveRepertoires(next);
    },
    [repertoires, activeId, stopAnimation],
  );

  const addCurrentLine = useCallback(() => {
    const rep = activeRepertoire;
    if (!rep || ply === 0) return;
    updateRepertoire(rep.id, (r) => addLine(r, line.slice(0, ply)));
  }, [activeRepertoire, line, ply, updateRepertoire]);

  const addMoveToRepertoire = useCallback(
    (input: MoveInput | string) => {
      const rep = activeRepertoire;
      if (!rep) return;
      const mv = tryMove(fen, input);
      if (!mv) return;
      const moves = [...line.slice(0, ply), mv];
      updateRepertoire(rep.id, (r) => addLine(r, moves));
      advanceWith(mv);
    },
    [activeRepertoire, fen, line, ply, updateRepertoire, advanceWith],
  );

  const removeRepertoireLine = useCallback(
    (sans: string[]) => {
      if (!activeId) return;
      updateRepertoire(activeId, (r) => removeLine(r, sans));
    },
    [activeId, updateRepertoire],
  );

  const setLineComment = useCallback(
    (sans: string[], comment: string) => {
      if (!activeId) return;
      updateRepertoire(activeId, (r) => setComment(r, sans, comment));
    },
    [activeId, updateRepertoire],
  );

  /* ---------------- Training controls ---------------- */

  const setMode = useCallback(
    (m: Mode) => {
      stopAnimation();
      setFixQueue(null);
      setModeState(m);
      if (m !== "review") clearReview();
      if (m === "build") setSession(null);
    },
    [stopAnimation, clearReview],
  );

  // `lineSans` is the (thoroughness-filtered) set of lines to drill; the caller
  // decides which lines belong to the chosen level.
  const startTraining = useCallback(
    (lineSans: string[][]) => {
      const rep = activeRepertoire;
      if (!rep) return;
      stopAnimation();
      setFixQueue(null);
      clearReview();
      // Random order, but a full shuffled pass covers every line before a repeat.
      const lines = shuffle(lineSans);
      setLine([]);
      setPly(0);
      setOrientation(rep.color);
      setModeState("train");
      setSession({
        repId: rep.id,
        color: rep.color,
        status: lines.length === 0 ? "empty" : "playing",
        correct: 0,
        mistakes: 0,
        lastWrong: null,
        revealed: false,
        lines,
        lineIndex: 0,
      });
    },
    [activeRepertoire, stopAnimation, clearReview],
  );

  // Fresh random pass over the current session's lines (no re-filtering needed).
  const reshuffleTraining = useCallback(() => {
    setLine([]);
    setPly(0);
    setSession((s) =>
      s && s.lines.length > 0
        ? {
            ...s,
            lines: shuffle(s.lines),
            lineIndex: 0,
            status: "playing",
            lastWrong: null,
            revealed: false,
          }
        : s,
    );
  }, []);

  const stopTraining = useCallback(() => {
    stopAnimation();
    setModeState("build");
    setSession(null);
  }, [stopAnimation]);

  // Switching, creating, or deleting the active repertoire mid-drill would leave
  // the session bound to the old one — drop out of training when they diverge.
  useEffect(() => {
    if (session && activeId !== session.repId) stopTraining();
  }, [activeId, session, stopTraining]);

  const revealAnswer = useCallback(() => {
    setSession((s) => (s ? { ...s, revealed: true } : s));
  }, []);

  // Replay the current line from the start.
  const restartLine = useCallback(() => {
    setLine([]);
    setPly(0);
    setSession((s) =>
      s ? { ...s, status: "playing", lastWrong: null, revealed: false } : s,
    );
  }, []);

  // Advance to the next line in the shuffled order. Reaching the end means the
  // whole repertoire was drilled, so reshuffle for a fresh random pass.
  const nextTrainingLine = useCallback(() => {
    setLine([]);
    setPly(0);
    setSession((s) => {
      if (!s || s.lines.length === 0) return s;
      if (s.lineIndex < s.lines.length - 1) {
        return {
          ...s,
          lineIndex: s.lineIndex + 1,
          status: "playing",
          lastWrong: null,
          revealed: false,
        };
      }
      return {
        ...s,
        lines: reshuffleLines(s.lines, s.lines[s.lineIndex]),
        lineIndex: 0,
        status: "playing",
        lastWrong: null,
        revealed: false,
      };
    });
  }, []);

  // Step back through lines already seen this pass (stops at the first).
  const prevTrainingLine = useCallback(() => {
    setLine([]);
    setPly(0);
    setSession((s) => {
      if (!s || s.lines.length === 0) return s;
      return {
        ...s,
        lineIndex: Math.max(0, s.lineIndex - 1),
        status: "playing",
        lastWrong: null,
        revealed: false,
      };
    });
  }, []);

  /* ---------------- Guided gap fixing ---------------- */

  // Start walking a queue of gap positions; each lands where it's your move so
  // you can add a response and jump straight to the next one.
  const startFix = useCallback(
    (paths: string[][]) => {
      if (paths.length === 0) return;
      stopAnimation();
      setModeState("build");
      setSession(null);
      clearReview();
      setFixQueue(paths);
      setFixIndex(0);
      // Play the moves into the first gap one by one so you see how the position
      // arises, rather than snapping the board to a mid-game position.
      playLineSans(paths[0]);
    },
    [stopAnimation, playLineSans, clearReview],
  );

  // Jump to a specific gap in the queue. The index is clamped to the queue; an
  // index at (or past) the end lands on the "caught up" screen with a cleared
  // board. Each valid gap reloads its position so the board is pinned there.
  const goFix = useCallback(
    (index: number) => {
      if (!fixQueue) return;
      const clamped = Math.max(0, Math.min(fixQueue.length, index));
      setFixIndex(clamped);
      if (clamped < fixQueue.length) {
        loadLineSans(fixQueue[clamped]);
      } else {
        setLine([]);
        setPly(0);
      }
    },
    [fixQueue, loadLineSans],
  );

  const advanceFix = useCallback(
    (from: number) => goFix(from + 1),
    [goFix],
  );

  // Save a reply at the current gap (the board is pinned there), then advance.
  const fixSaveReply = useCallback(
    (mv: LineMove) => {
      const rep = activeRepertoire;
      if (!rep) return;
      // `line` is exactly the path to the gap, so the reply is appended to it —
      // this stays correct even when the board is scrubbed back for review.
      updateRepertoire(rep.id, (r) => addLine(r, [...line, mv]));
      advanceFix(fixIndex);
    },
    [activeRepertoire, line, updateRepertoire, advanceFix, fixIndex],
  );

  // Save the chosen suggested response, then advance to the next gap.
  const fixAddMove = useCallback(
    (san: string) => {
      const mv = tryMove(gapFen, san);
      if (mv) fixSaveReply(mv);
    },
    [gapFen, fixSaveReply],
  );

  // Expose the current save handler to playMove (null unless actively fixing).
  fixSaveRef.current =
    fixQueue !== null && fixIndex < fixQueue.length ? fixSaveReply : null;

  // Walk the queue without saving — step back to review/redo an earlier gap, or
  // step forward to the next one (equivalent to skipping the current gap).
  const prevFix = useCallback(() => goFix(fixIndex - 1), [goFix, fixIndex]);
  const nextFix = useCallback(() => goFix(fixIndex + 1), [goFix, fixIndex]);

  const skipFix = useCallback(() => advanceFix(fixIndex), [advanceFix, fixIndex]);

  const endFix = useCallback(() => {
    setFixQueue(null);
    setFixIndex(0);
    setLine([]);
    setPly(0);
  }, []);

  /* ---------------- Game review ---------------- */

  /**
   * Put a downloaded game on the board and switch to review mode. The board
   * starts at move 0 so the eval graph and summary read from the beginning.
   */
  const startReview = useCallback(
    (source: ChessComGame, username: string): boolean => {
      const game = loadGame(source.pgn);
      if (!game) return false;
      stopAnimation();
      setSession(null);
      setFixQueue(null);
      setReviewChallenge(null);
      setBranch(null);
      setModeState("review");
      const color = colorOf(source, username) ?? "white";
      setReviewSession({ source, game, color, username });
      setOrientation(color);
      setLine(game.moves);
      setPly(0);
      return true;
    },
    [stopAnimation],
  );

  // Back to the game list: drop the game, keep the user in review mode.
  const closeReviewGame = useCallback(() => {
    stopAnimation();
    clearReview();
    setLine([]);
    setPly(0);
  }, [stopAnimation, clearReview]);

  const exitReview = useCallback(() => {
    if (mode !== "review") return;
    stopAnimation();
    clearReview();
    setModeState("build");
    setLine([]);
    setPly(0);
  }, [mode, stopAnimation, clearReview]);

  /** Put the reviewed game back on the board, dropping any side line. */
  const restoreGame = useCallback(
    (toPly?: number) => {
      const game = reviewSession?.game;
      if (!game) return;
      stopAnimation();
      setReviewChallenge(null);
      setLine(game.moves);
      // Leaving a line the coach opened lands *on* the move it was explaining,
      // so the card carries on about that move rather than the one before it.
      // Any other side line just returns to the fork.
      const fallback =
        branch?.origin != null ? branch.origin + 1 : branch?.from ?? 0;
      setPly(Math.max(0, Math.min(game.moves.length, toPly ?? fallback)));
      setBranch(null);
    },
    [reviewSession, branch, stopAnimation],
  );

  // Park the board on the position *before* a flagged move and wait for an
  // answer. Doubles as "try again": it re-parks and re-arms from any state.
  const startChallenge = useCallback(
    (index: number, bestSan: string) => {
      const game = reviewSession?.game;
      if (!game) return;
      stopAnimation();
      setBranch(null);
      setLine(game.moves);
      setPly(index);
      setReviewChallenge({ index, bestSan, status: "waiting", lastWrong: null });
    },
    [reviewSession, stopAnimation],
  );

  // Dismissing a challenge throws the attempt away, puts the real game back and
  // steps onto the flagged move itself, so the coach keeps talking about it
  // rather than the opponent's previous move. Restoring is not optional: once an
  // answer is committed, `index` holds the user's move, not the game's.
  const endChallenge = useCallback(() => {
    const index = reviewChallenge?.index;
    setReviewChallenge(null);
    restoreGame(index != null ? index + 1 : undefined);
  }, [reviewChallenge, restoreGame]);

  /**
   * A board move while reviewing. The reviewed game is never touched — it lives
   * in `reviewSession.game.moves` and `restoreGame` always puts it back — so a
   * move here either follows the game, answers an open challenge, or forks your
   * own line off it. Either way it is *committed*: react-chessboard renders from
   * the `position` prop, so a move that never reaches `line` snaps straight back.
   */
  const handleReviewMove = useCallback(
    (mv: LineMove): boolean => {
      // No game loaded (the game list is up): nothing to fork off, and
      // restoreGame would be a no-op, so keep the board inert.
      if (!reviewSession) return false;

      // Only a move played *from* the challenge position is an answer; anything
      // else is ordinary exploration and leaves the challenge armed.
      const challenge = reviewChallenge;
      if (challenge && ply === challenge.index) {
        setReviewChallenge((c) =>
          c
            ? mv.san === c.bestSan
              ? { ...c, status: "correct", lastWrong: null }
              : { ...c, status: "wrong", lastWrong: mv.san }
            : c,
        );
      }

      // Exactly advanceWith's own rule: replaying the move already in front of
      // the cursor leaves `line` untouched and only steps the cursor, so walking
      // the game (or the engine's line) by dragging must not invent a branch.
      const branched = !(ply < line.length && line[ply].san === mv.san);
      advanceWith(mv);
      if (branched) {
        // advanceWith truncates at `ply`, so the fork is at most `ply`. Never
        // raise it: restoreGame() defaults to it, and everything that indexes
        // the game by it would otherwise land inside the discarded branch.
        setBranch((b) => {
          const from = b === null ? ply : Math.min(b.from, ply);
          // Taking over a coach line keeps it anchored to the move it explains,
          // but stepping back *before* that move leaves it behind entirely.
          const keeps = b?.origin != null && from >= b.origin;
          return {
            from,
            source: "user",
            origin: keeps ? b!.origin : null,
            label: keeps ? b!.label : null,
          };
        });
      }
      return true;
    },
    [reviewSession, reviewChallenge, ply, line, advanceWith],
  );

  reviewMoveRef.current = mode === "review" ? handleReviewMove : null;

  /**
   * Branch a line off the reviewed game and play it out, so "here's what you
   * should have done" is something you watch rather than read.
   */
  const playVariation = useCallback(
    (fromPly: number, sans: string[], options?: VariationOptions) => {
      const base = reviewSession ? reviewSession.game.moves : line;
      stopAnimation();
      setReviewChallenge(null);

      let f = fenAtPly(base, fromPly);
      const extra: LineMove[] = [];
      for (const san of sans) {
        const mv = tryMove(f, san);
        if (!mv) break;
        extra.push(mv);
        f = mv.fen;
      }
      if (extra.length === 0) return;

      setLine([...base.slice(0, fromPly), ...extra]);
      setBranch({
        from: fromPly,
        source: "engine",
        origin: options?.origin ?? null,
        label: options?.label ?? extra[0].san,
      });
      setPly(fromPly);

      const total = fromPly + extra.length;
      let current = fromPly;
      const step = () => {
        current += 1;
        setPly(current);
        animRef.current = current < total ? setTimeout(step, LINE_ANIM_MS) : null;
      };
      animRef.current = setTimeout(step, LINE_ANIM_START_MS);
    },
    [reviewSession, line, stopAnimation],
  );

  const value: TrainerContextValue = {
    line,
    ply,
    fen,
    turn,
    orientation,
    lastMove,
    currentSans,
    gapFen,
    animating,
    repertoires,
    activeId,
    activeRepertoire,
    loaded,
    mode,
    session,
    playMove,
    goToPly,
    goStart,
    goBack,
    goForward,
    goEnd,
    loadLineSans,
    playLineSans,
    flipBoard,
    resetBoard,
    createRepertoire,
    deleteRepertoire,
    renameRepertoire,
    selectRepertoire,
    importRepertoires,
    addCurrentLine,
    addMoveToRepertoire,
    removeRepertoireLine,
    setLineComment,
    setMode,
    startTraining,
    reshuffleTraining,
    stopTraining,
    revealAnswer,
    restartLine,
    nextTrainingLine,
    prevTrainingLine,
    fixQueue,
    fixIndex,
    startFix,
    fixAddMove,
    prevFix,
    nextFix,
    skipFix,
    endFix,
    reviewSession,
    startReview,
    closeReviewGame,
    exitReview,
    reviewChallenge,
    startChallenge,
    endChallenge,
    playVariation,
    inVariation: branch !== null,
    variationFrom,
    variationOrigin: branch?.origin ?? null,
    variationLabel: branch?.label ?? null,
    branchSource: branch?.source ?? null,
    restoreGame,
  };

  return (
    <TrainerContext.Provider value={value}>{children}</TrainerContext.Provider>
  );
}
