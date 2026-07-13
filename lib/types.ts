export type Color = "white" | "black";
export type Turn = "w" | "b";

/** A single half-move within the currently explored line (from start to cursor). */
export interface LineMove {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  /** FEN of the position *after* this move was played. */
  fen: string;
  /** Side that made this move. */
  color: Turn;
}

/** A node in a saved repertoire tree. The move leads *into* this node's position. */
export interface RepNode {
  san: string;
  from: string;
  to: string;
  /** FEN of the position after this move. */
  fen: string;
  comment?: string;
  children: RepNode[];
}

export interface Repertoire {
  id: string;
  name: string;
  /** The side the user plays / trains in this repertoire. */
  color: Color;
  createdAt: number;
  /** First moves from the starting position. */
  root: RepNode[];
}

/** One principal variation reported by the engine (MultiPV). */
export interface EngineLine {
  multipv: number;
  depth: number;
  /** "cp" (centipawns) or "mate". */
  type: "cp" | "mate";
  /** Raw score from the side-to-move perspective (cp) or moves-to-mate. */
  value: number;
  /** Centipawn score normalised to White's perspective (mate encoded as +/-100000-ish). */
  scoreWhite: number;
  /** The best move of this line in UCI (e.g. "e2e4"). */
  uci: string;
  /** The best move of this line in SAN (e.g. "e4"). */
  san: string;
  /** First few plies of the line in SAN, for a readable preview. */
  pvSan: string[];
}

export interface EngineEval {
  fen: string;
  depth: number;
  /** Sorted by multipv index (1 = best). */
  lines: EngineLine[];
  running: boolean;
}

export type EngineStatus = "loading" | "ready" | "analyzing" | "error";

/** One candidate move from the Lichess opening explorer. */
export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  total: number;
  averageRating: number | null;
}

export interface ExplorerData {
  white: number;
  draws: number;
  black: number;
  total: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
}

export type ExplorerDb = "lichess" | "masters";

export type Mode = "build" | "train";

export type TrainStatus = "playing" | "correct" | "wrong" | "complete" | "empty";

export interface TrainSession {
  repId: string;
  color: Color;
  status: TrainStatus;
  correct: number;
  mistakes: number;
  /** SAN of the last incorrect attempt, shown as feedback. */
  lastWrong: string | null;
  /** Whether the correct answer has been revealed for the current move. */
  revealed: boolean;
  /** Every root-to-leaf line of the repertoire, in tree (depth-first) order. */
  lines: string[][];
  /** Index of the line currently being drilled. */
  lineIndex: number;
}
