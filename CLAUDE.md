# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The import above is load-bearing: this repo pins **Next.js 16.2.10 / React 19.2** and the App Router APIs, file conventions, and lint rules differ from older Next.js. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. The ESLint config (`eslint-config-next`) enforces strict React-Compiler rules — notably `react-hooks/set-state-in-effect` and "no ref access during render" — which several existing files already trip; don't treat a non-empty `npm run lint` as your regression.

## Commands

```bash
npm run dev        # dev server at http://localhost:3000
npm run build      # production build (also the real typecheck gate)
npm run lint       # eslint (strict next config; has pre-existing violations)
npx tsc --noEmit   # standalone typecheck
```

There is **no test framework** configured — verify changes by running the app.

Rebuild the bundled opening book (only when the Lichess `chess-openings` TSVs change):

```bash
node scripts/build-book.mjs <inputDir> <outFile>   # writes public/openings/book.json
```

## Architecture

A **fully client-side** Next.js app: one page (`app/page.tsx`) renders `TrainerProvider` → `ChessTrainer`. There is no backend, no API route, and no database — every component is `"use client"` and all persistence is `localStorage`. The only network calls are to the live Lichess explorer API.

### Single source of truth: `context/TrainerContext.tsx`

Nearly all state and behavior lives in this one context, consumed via `useTrainer()`. It owns:

- **Board position** as `line: LineMove[]` (half-moves from the start) plus a `ply` cursor. The current `fen` is *derived*: `fenAtPly(line, ply)`. Navigation (`goBack`/`goForward`/`playMove`/…) just moves `ply` or splices `line`; playing a move at a mid-line ply truncates the future.
- **Repertoires** (loaded/saved to localStorage) and the active selection.
- **Mode** (`build` | `train`) and, in train mode, the `TrainSession`.
- **Gap-fixing queue** (`fixQueue`/`fixIndex`) for the guided Fix flow.

`ChessTrainer.tsx` is the layout shell: it wires the shared hooks (engine, coverage, book) and swaps the right-hand panel based on `mode`/`fixQueue`/active tab. `BoardPanel.tsx` renders the `react-chessboard` and handles keyboard nav.

### Repertoire data model

A repertoire is an immutable tree of `RepNode` (see `lib/types.ts`). `lib/repertoire.ts` holds the pure tree operations (`addLine`, `removeLine`, `setComment`, `enumerateLines`, path lookups) and the localStorage layer (`loadRepertoires`/`saveRepertoires`, keys `chess-repertoires-v1` and `chess-active-repertoire-v1`). Mutations return new trees; the provider maps them into state.

### Three knowledge sources

1. **Stockfish 18 (WASM, in-browser)** — `lib/engine.ts` wraps the single-threaded "lite" worker under `public/stockfish/`, speaks UCI, tracks MultiPV lines, normalizes scores to White's perspective, and throttles emissions. `hooks/useEngine.ts` keeps one worker alive for the app's lifetime, re-analyzes on FEN change, and discards evals for stale positions.
2. **Bundled opening book** — `public/openings/book.json` (~900 KB), generated offline by `scripts/build-book.mjs` from Lichess opening TSVs. `lib/book.ts` fetches/caches it. Compact shape: a shared `names` table + `positions` map + `moves` map. It powers opening names, theory-move suggestions, and all coverage/gap analysis.
3. **Lichess opening explorer (live API)** — `lib/explorer.ts` (`fetchExplorer`) pulls real game statistics; `hooks/useExplorer.ts` drives it. Handles 429 rate-limiting explicitly.

### Position keys and transpositions

Everything that indexes positions (book, gaps, coverage, the book builder) keys on the **FEN normalized to its first 4 fields** — placement + side + castling + en passant (`fen.split(" ").slice(0, 4).join(" ")`) — so different move orders reaching the same position collapse to one key. Preserve this convention when touching position-keyed logic.

### Coverage & gaps

`lib/gaps.ts` (`findGaps`) walks the repertoire tree against the book to surface two gap kinds: a **"defense"** gap (a popular opponent reply you haven't answered) and a **"reply"** gap (a line that stops on your own move). `lib/coverage.ts` (`openingProgress`) does the same walk but aggregates covered-vs-open counts per opening family. Both weight each gap by an **`importance`** score — the estimated probability of reaching that exact position, computed by multiplying book move-shares along the path. `lib/thoroughness.ts` turns the Club/Tournament/Master levels into a `minImportance` cutoff that filters the noise.

### Feature flows

- **Build**: play/analyze on the board with engine + book/explorer panels, save lines into the active repertoire.
- **Train** (`TrainPanel`): drills every root-to-leaf line (shuffled), auto-plays the opponent's moves, and checks each user move against the expected SAN. All logic is in the provider's training section.
- **Fix gaps** (`FixPanel`): walks the ranked gap queue, pinning the board to each gap position; picking a suggested reply saves it and advances. Prev/next walk the queue (arrow keys or the panel buttons).
- **Transfer/sync** (`lib/transfer.ts`, `TransferDialog.tsx`): import/export/merge repertoires between browsers via a sync code.

### Conventions

- Import alias `@/*` maps to the repo root (`tsconfig.json`).
- Chess logic goes through `chess.js` wrapped in `lib/chess.ts` (`tryMove`, `legalMoves`, SAN/UCI/FEN helpers) — use these rather than instantiating `Chess` directly.
