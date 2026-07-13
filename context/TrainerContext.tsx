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
import { mergeRepertoires } from "@/lib/transfer";
import { reshuffleLines, shuffle } from "@/lib/shuffle";

interface TrainerContextValue {
  // Position
  line: LineMove[];
  ply: number;
  fen: string;
  turn: Turn;
  orientation: Color;
  lastMove: LineMove | null;
  currentSans: string[];

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
  skipFix: () => void;
  endFix: () => void;
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

  const fen = fenAtPly(line, ply);
  const turn = turnOf(fen);
  const lastMove = ply > 0 ? line[ply - 1] : null;
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
  }, []);
  useEffect(() => stopAnimation, [stopAnimation]);

  const updateRepertoire = useCallback(
    (id: string, fn: (r: Repertoire) => Repertoire) => {
      setRepertoires((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
    },
    [],
  );

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

  const playMove = useCallback(
    (input: MoveInput | string): boolean => {
      stopAnimation();
      const mv = tryMove(fen, input);
      if (!mv) return false;
      if (mode === "train") return handleTrainMove(mv);
      // During a guided fix the board is pinned to the gap, so a board move is
      // your reply: save it and advance, like tapping a suggested move.
      if (fixSaveRef.current) {
        fixSaveRef.current(mv);
        return true;
      }
      advanceWith(mv);
      return true;
    },
    [fen, mode, handleTrainMove, advanceWith, stopAnimation],
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
      let current = 0;
      const step = () => {
        current += 1;
        setPly(current);
        animRef.current = current < total ? setTimeout(step, LINE_ANIM_MS) : null;
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
    setLine([]);
    setPly(0);
  }, [stopAnimation]);

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
      if (m === "build") setSession(null);
    },
    [stopAnimation],
  );

  // `lineSans` is the (thoroughness-filtered) set of lines to drill; the caller
  // decides which lines belong to the chosen level.
  const startTraining = useCallback(
    (lineSans: string[][]) => {
      const rep = activeRepertoire;
      if (!rep) return;
      stopAnimation();
      setFixQueue(null);
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
    [activeRepertoire, stopAnimation],
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
      setFixQueue(paths);
      setFixIndex(0);
      loadLineSans(paths[0]);
    },
    [stopAnimation, loadLineSans],
  );

  const advanceFix = useCallback(
    (from: number) => {
      const next = from + 1;
      setFixIndex(next);
      if (fixQueue && next < fixQueue.length) {
        loadLineSans(fixQueue[next]);
      } else {
        setLine([]);
        setPly(0);
      }
    },
    [fixQueue, loadLineSans],
  );

  // Save a reply at the current gap (the board is pinned there), then advance.
  const fixSaveReply = useCallback(
    (mv: LineMove) => {
      const rep = activeRepertoire;
      if (!rep) return;
      updateRepertoire(rep.id, (r) => addLine(r, [...line.slice(0, ply), mv]));
      advanceFix(fixIndex);
    },
    [activeRepertoire, line, ply, updateRepertoire, advanceFix, fixIndex],
  );

  // Save the chosen suggested response, then advance to the next gap.
  const fixAddMove = useCallback(
    (san: string) => {
      const mv = tryMove(fen, san);
      if (mv) fixSaveReply(mv);
    },
    [fen, fixSaveReply],
  );

  // Expose the current save handler to playMove (null unless actively fixing).
  fixSaveRef.current =
    fixQueue !== null && fixIndex < fixQueue.length ? fixSaveReply : null;

  const skipFix = useCallback(() => advanceFix(fixIndex), [advanceFix, fixIndex]);

  const endFix = useCallback(() => {
    setFixQueue(null);
    setFixIndex(0);
    setLine([]);
    setPly(0);
  }, []);

  const value: TrainerContextValue = {
    line,
    ply,
    fen,
    turn,
    orientation,
    lastMove,
    currentSans,
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
    skipFix,
    endFix,
  };

  return (
    <TrainerContext.Provider value={value}>{children}</TrainerContext.Provider>
  );
}
