// Builds a compact opening book (public/openings/book.json) from the Lichess
// chess-openings TSV files. Run: node scripts/build-book.mjs <inputDir> <outFile>
import fs from "node:fs";
import path from "node:path";
import { Chess } from "chess.js";

const inputDir = process.argv[2];
const outFile = process.argv[3];
if (!inputDir || !outFile) {
  console.error("usage: node build-book.mjs <inputDir> <outFile>");
  process.exit(1);
}

/** Normalised position key: placement + turn + castling + en passant. */
const key = (fen) => fen.split(" ").slice(0, 4).join(" ");

function parseSans(pgn) {
  return pgn
    .replace(/\d+\.(\.\.)?/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && t !== "*");
}

const positions = new Map(); // posKey -> { label, plies }
const edges = new Map(); // posKey -> Map(san -> { childKey, count, bestName, bestPlies })

let rows = 0;
for (const letter of ["a", "b", "c", "d", "e"]) {
  const file = path.join(inputDir, `${letter}.tsv`);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split("\t");
    if (!pgn) continue;
    const label = `${eco}|${name}`;
    const sans = parseSans(pgn);
    const chess = new Chess();
    let ok = true;
    for (const san of sans) {
      const parentKey = key(chess.fen());
      let mv;
      try {
        mv = chess.move(san);
      } catch {
        ok = false;
        break;
      }
      if (!mv) {
        ok = false;
        break;
      }
      const childKey = key(chess.fen());
      let em = edges.get(parentKey);
      if (!em) {
        em = new Map();
        edges.set(parentKey, em);
      }
      let e = em.get(mv.san);
      if (!e) {
        e = { childKey, count: 0, bestName: null, bestPlies: Infinity };
        em.set(mv.san, e);
      }
      e.count++;
      if (sans.length < e.bestPlies) {
        e.bestPlies = sans.length;
        e.bestName = label;
      }
    }
    if (ok) {
      rows++;
      const fk = key(chess.fen());
      const cur = positions.get(fk);
      if (!cur || sans.length < cur.plies) {
        positions.set(fk, { label, plies: sans.length });
      }
    }
  }
}

// Build compact output with a shared names table.
const names = [];
const nameIndex = new Map();
const ni = (label) => {
  if (label == null) return -1;
  let idx = nameIndex.get(label);
  if (idx === undefined) {
    idx = names.push(label) - 1;
    nameIndex.set(label, idx);
  }
  return idx;
};

const positionsOut = {};
for (const [k, v] of positions) positionsOut[k] = ni(v.label);

const movesOut = {};
for (const [k, em] of edges) {
  const arr = [];
  for (const [san, e] of em) {
    const childPos = positions.get(e.childKey);
    const label = childPos ? childPos.label : e.bestName;
    arr.push([san, e.count, ni(label)]);
  }
  arr.sort((a, b) => b[1] - a[1]);
  movesOut[k] = arr;
}

const out = { names, positions: positionsOut, moves: movesOut };
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out));

console.log(
  `openings=${rows} names=${names.length} positions=${positions.size} branchPoints=${edges.size} bytes=${fs.statSync(outFile).size}`,
);
