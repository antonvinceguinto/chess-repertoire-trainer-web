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

An **almost entirely client-side** Next.js app: one page (`app/page.tsx`) renders `TrainerProvider` → `ChessTrainer`. There is no database, every component is `"use client"`, and all persistence is `localStorage`.

There is exactly **one** server-side file, and it exists for a single unavoidable reason: `app/api/chesscom/route.ts`. Chess.com's public API serves no `Access-Control-Allow-Origin` header, so the browser cannot call it directly at all — that route is a same-origin GET proxy with a regex allowlist over four read-only `pub/player/...` paths. Don't add logic to it, and don't route anything else through it. (Deployments that serve this app as static files lose only the game-review lookup; `lib/chesscom.ts` detects the missing route and says so.)

Outbound network calls: the Lichess explorer API (direct), and Chess.com (via that proxy).

### Single source of truth: `context/TrainerContext.tsx`

Nearly all state and behavior lives in this one context, consumed via `useTrainer()`. It owns:

- **Board position** as `line: LineMove[]` (half-moves from the start) plus a `ply` cursor. The current `fen` is *derived*: `fenAtPly(line, ply)`. Navigation (`goBack`/`goForward`/`playMove`/…) just moves `ply` or splices `line`; playing a move at a mid-line ply truncates the future.
- **Repertoires** (loaded/saved to localStorage) and the active selection.
- **Mode** (`build` | `train` | `review`) and, in train mode, the `TrainSession`.
- **Gap-fixing queue** (`fixQueue`/`fixIndex`) for the guided Fix flow.
- **Game review** (`reviewSession`, `reviewChallenge`, `variationFrom`) for the Review flow.

`ChessTrainer.tsx` is the layout shell: it wires the shared hooks (engine, coverage, book, game review) and swaps the right-hand panel based on `mode`/`fixQueue`/active tab. `BoardPanel.tsx` renders the `react-chessboard` and handles keyboard nav.

`playMove` dispatches on mode, using a ref per non-build mode (`fixSaveRef`, `reviewMoveRef`) so handlers defined later in the provider can be reached from a callback defined earlier. Follow that pattern rather than reordering the file.

### Repertoire data model

A repertoire is an immutable tree of `RepNode` (see `lib/types.ts`). `lib/repertoire.ts` holds the pure tree operations (`addLine`, `removeLine`, `setComment`, `enumerateLines`, path lookups) and the localStorage layer (`loadRepertoires`/`saveRepertoires`, keys `chess-repertoires-v1` and `chess-active-repertoire-v1`). Mutations return new trees; the provider maps them into state.

### Four knowledge sources

1. **Stockfish 18 (WASM, in-browser)** — `lib/engine.ts` wraps the single-threaded "lite" worker under `public/stockfish/`, speaks UCI, tracks MultiPV lines, normalizes scores to White's perspective, and throttles emissions. `hooks/useEngine.ts` runs the primary worker (one at a time, re-analyzed on FEN change, stale evals discarded). **Three** hooks each own a *separate* `StockfishEngine`: `useEngine` (live board analysis), `useDanger` (background gap scoring), and `useGameReview` (whole-game sweep). Keep the instances independent so they never contend — and note the primary one is parked outside build mode (`engineEnabled` in `ChessTrainer.tsx`), which is what leaves the review sweep a free core.
2. **Bundled opening book** — `public/openings/book.json` (~900 KB), generated offline by `scripts/build-book.mjs` from Lichess opening TSVs. `lib/book.ts` fetches/caches it. Compact shape: a shared `names` table + `positions` map + `moves` map. It powers opening names, theory-move suggestions, coverage/gap analysis, and the "Book" move class in game review.
3. **Lichess opening explorer (live API)** — `lib/explorer.ts` (`fetchExplorer`) pulls real game statistics; `hooks/useExplorer.ts` drives it. Handles 429 rate-limiting explicitly.
4. **Chess.com published-data API (live, via the proxy route)** — `lib/chesscom.ts` fetches a player's monthly archives and games by username, with no login. Archive lists and month payloads are cached in module-level `Map`s for the session (`refreshPlayer()` clears them for an explicit re-search); only the last username is persisted, in `chess-chesscom-username-v1`. Errors are typed by `ChessComError.kind` so the UI can distinguish a bad username from a rate limit from a missing proxy route.

### Position keys and transpositions

Everything that indexes positions (book, gaps, coverage, the book builder) keys on the **FEN normalized to its first 4 fields** — placement + side + castling + en passant (`fen.split(" ").slice(0, 4).join(" ")`) — so different move orders reaching the same position collapse to one key. Preserve this convention when touching position-keyed logic.

### Coverage & gaps

`lib/gaps.ts` (`findGaps`) walks the repertoire tree against the book to surface two gap kinds: a **"defense"** gap (a popular opponent reply you haven't answered) and a **"reply"** gap (a line that stops on your own move). `lib/coverage.ts` (`openingProgress`) does the same walk but aggregates covered-vs-open counts per opening family. Both weight each gap by an **`importance`** score — the estimated probability of reaching that exact position, computed by multiplying book move-shares along the path. `lib/thoroughness.ts` turns the Club/Tournament/Master levels into a `minImportance` cutoff that filters the noise.

Optionally, **danger scoring** (`lib/danger.ts` + `hooks/useDanger.ts`) evaluates each gap's off-book position with the background engine and rates how costly being unprepared there is (Sharp / Tricky / Quiet), from how far behind you'd be and how "only-move" the best reply is. Results are cached by FEN for the session.

### Game review

`hooks/useGameReview.ts` sweeps a whole game: it builds `positions = [startFen, ...moves.map(m => m.fen)]`, scores terminal positions directly with `terminalEval` (Stockfish returns no lines on a mate, so never queue them), de-duplicates repeated positions, and searches the rest one at a time at MultiPV 2. Results stream in — the review is rebuilt every 4 completions.

`lib/review.ts` is pure math and the place to change judgements. It works in **win probability, not centipawns**, using Lichess's published curves, because a 100 cp slip matters at 0.0 and doesn't at +9.0:

- `winPercent(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`, on cp capped to ±1000.
- `moveAccuracy(drop) = 103.1668 * exp(-0.04354 * drop) - 3.1669`, clamped 0–100.
- Classification by win-percentage-point drop: blunder ≥ 20, mistake ≥ 10, inaccuracy ≥ 5, good ≥ 2, else excellent — overridden by `book` (in the bundled book, first 30 plies), `forced` (one legal move), and `best`/`great` (matched the engine; "great" when every alternative lost ≥ 15 points).
- Game accuracy blends a volatility-weighted mean with a harmonic mean. `volatilityWeights` is indexed by **game half-move**, not by one side's moves — `summarize` must pick a side's accuracies and their weights out together or the two arrays silently misalign. Accuracy counts every move (theory included, matching Lichess/Chess.com); ACPL excludes book moves.

`lib/coach.ts` turns a flagged move into prose. It is **deterministic and offline — there is no LLM anywhere in this app.** Every sentence is checked against the real position first, via the chess.js wrappers in `lib/chess.ts` (`attackersOf`, `piecesOn`, `pieceAt`, `inCheck`): mate won or handed over, the opponent's actual refutation, forks and double attacks, pieces left loose, material dropped, free material that was on offer. Only if no rule fires does it fall back to narrating the eval swing. Add rules the same way — check the board, don't assert.

### Feature flows

- **Build**: play/analyze on the board with engine + book/explorer panels, save lines into the active repertoire.
- **Train** (`TrainPanel`): drills every root-to-leaf line (shuffled), auto-plays the opponent's moves, and checks each user move against the expected SAN. All logic is in the provider's training section.
- **Fix gaps** (`FixPanel`): walks the ranked gap queue, pinning the board to each gap position; picking a suggested reply saves it and advances. Prev/next walk the queue (arrow keys or the panel buttons).
- **Review** (`GameBrowser` → `ReviewPanel` + `CoachCard` + `EvalGraph`): type a Chess.com username, pick a game, and Stockfish grades every move. The board is a **viewer** here — `playMove` returns false and never mutates the game — with two exceptions driven from the coach card: `startChallenge` parks the board before a flagged move and grades your answer without touching the line, and `playVariation` branches the engine's line off the game (`restoreGame` puts it back). `lib/pgn.ts` parses the PGN, including `{[%clk …]}` clocks.
- **Transfer/sync** (`lib/transfer.ts`, `TransferDialog.tsx`): import/export/merge repertoires between browsers via a sync code.

### Conventions

- Import alias `@/*` maps to the repo root (`tsconfig.json`).
- Chess logic goes through `chess.js` wrapped in `lib/chess.ts` (`tryMove`, `legalMoves`, `parsePgn`, board-inspection and SAN/UCI/FEN helpers) — use these rather than instantiating `Chess` directly. `lib/chess.ts` is the only file that imports `chess.js`.
