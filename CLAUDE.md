# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Subagents: hard cap of 4

**Never spawn more than 4 subagents for a task — including inside a workflow, counted across the whole run, not per phase.** This is a hard ceiling, not a guideline, and it overrides "be exhaustive" instructions such as ultracode.

The failure mode to avoid is fan-out proportional to results: a phase that spawns one agent per candidate/finding/file looks small when written and then explodes at runtime (one such run reached 26 agents from a single per-rule verification stage). If a stage would spawn one agent per item, batch the items into at most 4 agents instead, or do it inline.

Prefer inline work. Reach for a subagent only when the task genuinely needs parallel independent exploration, and say up front how many you intend to spawn.

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

- **Board position** as `line: LineMove[]` (half-moves from the start) plus a `ply` cursor. The current `fen` is _derived_: `fenAtPly(line, ply)`. Navigation (`goBack`/`goForward`/`playMove`/…) just moves `ply` or splices `line`; playing a move at a mid-line ply truncates the future.
- **Repertoires** (loaded/saved to localStorage) and the active selection.
- **Mode** (`build` | `train` | `recall` | `review`) and, per drilling mode, its session (`TrainSession` / `RecallSession`).
- **Spaced-repetition memory** (`memory`, `cardStates`) — the persisted review schedule Recall grades into.
- **Gap-fixing queue** (`fixQueue`/`fixIndex`) for the guided Fix flow.
- **Game review** (`reviewSession`, `reviewChallenge`, `variationFrom`) for the Review flow.

`ChessTrainer.tsx` is the layout shell: it wires the shared hooks (engine, coverage, book, game review) and swaps the right-hand panel based on `mode`/`fixQueue`/active tab. `BoardPanel.tsx` renders the `react-chessboard` and handles keyboard nav.

`playMove` dispatches on mode. `train` and `recall` are handled by callbacks defined just above it; `fix` and `review` need handlers defined *later* in the provider, so they're reached through a ref (`fixSaveRef`, `reviewMoveRef`). Follow whichever pattern the position in the file calls for rather than reordering it.

### Repertoire data model

A repertoire is an immutable tree of `RepNode` (see `lib/types.ts`). `lib/repertoire.ts` holds the pure tree operations (`addLine`, `removeLine`, `setComment`, `enumerateLines`, path lookups) and the localStorage layer (`loadRepertoires`/`saveRepertoires`, keys `chess-repertoires-v1` and `chess-active-repertoire-v1`). Mutations return new trees; the provider maps them into state.

### Four knowledge sources

1. **Stockfish 18 (WASM, in-browser)** — `lib/engine.ts` wraps the single-threaded "lite" worker under `public/stockfish/`, speaks UCI, tracks MultiPV lines, normalizes scores to White's perspective, and throttles emissions. **Four** hooks each own a *separate* `StockfishEngine`: `useEngine` (live board analysis, one search at a time, re-analyzed on FEN change, stale evals discarded), `useDanger` (background gap scoring), `useMoveReview` (grading the line you're building), and `useGameReview` (whole-game sweep). Keep the instances independent so they never contend. `engineEnabled` in `ChessTrainer.tsx` decides when the primary one runs: while building with the engine toggled on, plus inside a review side line, where the sweep has no data to offer.
2. **Bundled opening book** — `public/openings/book.json` (~900 KB), generated offline by `scripts/build-book.mjs` from Lichess opening TSVs. `lib/book.ts` fetches/caches it. Compact shape: a shared `names` table + `positions` map + `moves` map. It powers opening names, theory-move suggestions, coverage/gap analysis, and the "Book" class in both move review and game review.
3. **Lichess opening explorer (live API)** — `lib/explorer.ts` (`fetchExplorer`) pulls real game statistics; `hooks/useExplorer.ts` drives it. Handles 429 rate-limiting explicitly.
4. **Chess.com published-data API (live, via the proxy route)** — `lib/chesscom.ts` fetches a player's monthly archives and games by username, with no login. Archive lists and month payloads are cached in module-level `Map`s for the session (`refreshPlayer()` clears them for an explicit re-search); only the last username is persisted, in `chess-chesscom-username-v1`. Errors are typed by `ChessComError.kind` so the UI can distinguish a bad username from a rate limit from a missing proxy route.

### Position keys and transpositions

Everything that indexes positions (book, gaps, coverage, the book builder) keys on the **FEN normalized to its first 4 fields** — placement + side + castling + en passant (`fen.split(" ").slice(0, 4).join(" ")`) — so different move orders reaching the same position collapse to one key. Preserve this convention when touching position-keyed logic.

### Coverage & gaps

`lib/gaps.ts` (`findGaps`) walks the repertoire tree against the book to surface two gap kinds: a **"defense"** gap (a popular opponent reply you haven't answered) and a **"reply"** gap (a line that stops on your own move). `lib/coverage.ts` (`openingProgress`) does the same walk but aggregates covered-vs-open counts per opening family. Both weight each gap by an **`importance`** score — the estimated probability of reaching that exact position, computed by multiplying book move-shares along the path. `lib/thoroughness.ts` turns the Club/Tournament/Master levels into a `minImportance` cutoff that filters the noise.

Optionally, **danger scoring** (`lib/danger.ts` + `hooks/useDanger.ts`) evaluates each gap's off-book position with the background engine and rates how costly being unprepared there is (Sharp / Tricky / Quiet), from how far behind you'd be and how "only-move" the best reply is. Results are cached by FEN for the session.

### Spaced repetition (`lib/memory.ts`)

Train drills whole lines from move 1, so the first move of every line gets practised dozens of times and the move on ply 12 gets practised once — and nothing survives the tab closing. Recall inverts both.

`collectCards` turns a repertoire into one **card per decision point**: a position where it's your move, keyed on the normalized FEN, holding *every* reply you have saved there (any counts as correct) plus the shortest lead-in and an `importance` computed exactly as in `importantLines`, so the same thoroughness cutoff applies. Keying on the position means transpositions collapse into one thing to remember.

`gradeCard` is SM-2 with the self-rating removed — the grade is **derived from how the answer came out**, never asked for: clean recall is `good`, a hinted one is `hard`, and a wrong guess or a full reveal is `again` (interval reset, `lapses++`, back in ten minutes). `buildQueue` fills a sitting with overdue cards first, then new material by importance; `requeue` puts a just-forgotten card back a few places later so relearning happens *inside* the sitting.

The whole store lives in localStorage under `chess-memory-v1` (`{ cards: { [repId]: { [posKey]: CardState } }, days }`). Unlike the repertoire saves, writes go through `commitMemory` rather than an effect, so a blocked localStorage surfaces in the UI instead of silently discarding every review.

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
- **Recall** (`RecallPanel`): the spaced-repetition drill. The board is dropped straight onto a scheduled position with its lead-in behind it, labelled by the deepest opening name the book knows along the way in. A three-rung **hint ladder** (name the piece → highlight its square → draw the arrow) replaces the binary reveal, and each rung taken caps the grade. Keyboard: `h` for the next hint, `Enter` for the next card. The panel also surfaces deck health (memorised %, due/new counts, day streak) and a **leech list** — positions you keep forgetting, which want understanding in Build mode rather than more repetitions.
- **Fix gaps** (`FixPanel`): walks the ranked gap queue, pinning the board to each gap position; picking a suggested reply saves it and advances. ←/→ step through the moves that lead to the gap, ↑/↓ walk the queue; you can only play a reply *at* the gap (`atGap`).
- **Move review** (`hooks/useMoveReview.ts` + `lib/classify.ts` + `lib/moveSummary.ts`): while building with the engine on, a background instance grades every move of the line you're playing and the board shows a chess.com-style reaction disc. `lib/classify.ts` owns that vocabulary (`brilliant`/`great`/`best`/…/`miss`/`blunder`) and `components/MoveClassBadge.tsx` renders it — game review reuses the same disc, since `lib/review.ts`'s classes are a subset.
- **Review** (`GameBrowser` → `ReviewPanel` + `CoachCard` + `EvalGraph`): type a Chess.com username, pick a game, and Stockfish grades every move. The board is **yours to explore**: a move either follows the game, answers an open challenge, or forks a side line off it (`branch = { from, source }`), and the reviewed game — which lives in `reviewSession.game`, never in `line` — is always one `restoreGame()` away. `branch.from` may only ever move *down*, since navigation is unlocked and you can step back and re-fork earlier. Inside a side line the live engine takes over the eval bar and arrows, because the sweep has no data there. `lib/pgn.ts` parses the PGN, including `{[%clk …]}` clocks.
- **Transfer/sync** (`lib/transfer.ts`, `TransferDialog.tsx`): import/export/merge repertoires between browsers via a sync code.

### Conventions

- Import alias `@/*` maps to the repo root (`tsconfig.json`).
- Chess logic goes through `chess.js` wrapped in `lib/chess.ts` (`tryMove`, `legalMoves`, `parsePgn`, board-inspection and SAN/UCI/FEN helpers) — use these rather than instantiating `Chess` directly. `lib/chess.ts` is the only file that imports `chess.js`.
