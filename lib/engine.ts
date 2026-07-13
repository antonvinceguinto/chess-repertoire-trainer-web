import type { EngineEval, EngineLine, EngineStatus } from "./types";
import { turnOf, uciLineToSan } from "./chess";

const ENGINE_URL = "/stockfish/stockfish-18-lite-single.js";
const MATE_SCORE = 100000;

export interface EngineOptions {
  multipv?: number;
  depth?: number;
}

type EvalListener = (evalResult: EngineEval) => void;
type StatusListener = (status: EngineStatus) => void;

/**
 * Thin wrapper around the Stockfish (lite, single-threaded) WebAssembly worker.
 * Speaks UCI, tracks MultiPV lines for the current position, and emits
 * normalised {@link EngineEval} snapshots (throttled) to a listener.
 */
export class StockfishEngine {
  private worker: Worker | null = null;
  private ready = false;
  private searching = false;
  private pendingFen: string | null = null;
  private currentFen: string | null = null;
  private currentTurn: "w" | "b" = "w";
  private lines = new Map<number, EngineLine>();
  private depth = 0;

  private multipv: number;
  private maxDepth: number;

  private onEval: EvalListener;
  private onStatus: StatusListener;

  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;

  constructor(
    onEval: EvalListener,
    onStatus: StatusListener,
    options: EngineOptions = {},
  ) {
    this.onEval = onEval;
    this.onStatus = onStatus;
    this.multipv = options.multipv ?? 3;
    this.maxDepth = options.depth ?? 20;
    this.boot();
  }

  private boot() {
    if (typeof window === "undefined") return;
    try {
      this.worker = new Worker(ENGINE_URL);
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        const text = typeof data === "string" ? data : String(data ?? "");
        this.onLine(text);
      };
      this.worker.onerror = () => this.onStatus("error");
      this.post("uci");
      this.post(`setoption name MultiPV value ${this.multipv}`);
      this.post("isready");
      this.onStatus("loading");
    } catch {
      this.onStatus("error");
    }
  }

  private post(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  /** Handle a single line of UCI output from the engine. */
  private onLine(line: string) {
    if (!line) return;
    if (line === "uciok") return;
    if (line.startsWith("readyok")) {
      if (!this.ready) {
        this.ready = true;
        this.onStatus("ready");
        if (this.pendingFen != null) this.startPending();
      }
      return;
    }
    if (line.startsWith("bestmove")) {
      this.searching = false;
      if (this.pendingFen != null) {
        this.startPending();
      } else {
        this.onStatus("ready");
        this.emit(false, true);
      }
      return;
    }
    if (line.startsWith("info ")) {
      this.parseInfo(line);
    }
  }

  private parseInfo(line: string) {
    // Only "info ... multipv ... score ... pv ..." lines are useful.
    const tokens = line.split(/\s+/);
    const pvIdx = tokens.indexOf("pv");
    if (pvIdx === -1) return;

    let depth = 0;
    let multipv = 1;
    let scoreType: "cp" | "mate" | null = null;
    let scoreValue = 0;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === "depth") depth = parseInt(tokens[i + 1], 10);
      else if (t === "multipv") multipv = parseInt(tokens[i + 1], 10);
      else if (t === "score") {
        scoreType = tokens[i + 1] === "mate" ? "mate" : "cp";
        scoreValue = parseInt(tokens[i + 2], 10);
      } else if (t === "pv") break;
    }
    if (scoreType == null || !Number.isFinite(scoreValue)) return;

    const uciMoves = tokens.slice(pvIdx + 1);
    if (uciMoves.length === 0 || !this.currentFen) return;

    const whiteSign = this.currentTurn === "w" ? 1 : -1;
    let scoreWhite: number;
    if (scoreType === "mate") {
      const rel = scoreValue >= 0 ? MATE_SCORE - scoreValue : -MATE_SCORE - scoreValue;
      scoreWhite = whiteSign * rel;
    } else {
      scoreWhite = whiteSign * scoreValue;
    }

    const pvSan = uciLineToSan(this.currentFen, uciMoves, 10);
    const san = pvSan[0] ?? uciMoves[0];

    const engineLine: EngineLine = {
      multipv,
      depth,
      type: scoreType,
      value: scoreValue,
      scoreWhite,
      uci: uciMoves[0],
      san,
      pvSan,
    };
    this.lines.set(multipv, engineLine);
    this.depth = Math.max(this.depth, depth);
    this.emit(true, false);
  }

  /** Emit a snapshot, throttled to avoid flooding React with renders. */
  private emit(running: boolean, force: boolean) {
    const now = Date.now();
    const doEmit = () => {
      this.lastEmit = Date.now();
      this.emitTimer = null;
      const lines = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
      this.onEval({
        fen: this.currentFen ?? "",
        depth: this.depth,
        lines,
        running,
      });
    };
    if (force || now - this.lastEmit > 120) {
      if (this.emitTimer) {
        clearTimeout(this.emitTimer);
        this.emitTimer = null;
      }
      doEmit();
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(doEmit, 120);
    }
  }

  private startPending() {
    const fen = this.pendingFen;
    if (fen == null) return;
    this.pendingFen = null;
    this.currentFen = fen;
    this.currentTurn = turnOf(fen);
    this.lines.clear();
    this.depth = 0;
    this.searching = true;
    this.onStatus("analyzing");
    this.emit(true, true);
    this.post(`position fen ${fen}`);
    this.post(`go depth ${this.maxDepth}`);
  }

  /** Request analysis of a position. Cancels any in-flight search. */
  analyze(fen: string) {
    this.pendingFen = fen;
    if (!this.ready) return;
    if (this.searching) {
      this.post("stop");
      // bestmove handler will pick up the pending fen.
    } else {
      this.startPending();
    }
  }

  /** Stop analysis and clear the current position. */
  stop() {
    this.pendingFen = null;
    if (this.searching) this.post("stop");
  }

  setMultiPv(n: number) {
    this.multipv = n;
    this.post(`setoption name MultiPV value ${n}`);
    if (this.currentFen && !this.searching) this.analyze(this.currentFen);
  }

  destroy() {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    try {
      this.post("quit");
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
  }
}
