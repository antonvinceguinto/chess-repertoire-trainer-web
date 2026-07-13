import type { Color, LineMove, RepNode, Repertoire } from "./types";

const STORAGE_KEY = "chess-repertoires-v1";
const ACTIVE_KEY = "chess-active-repertoire-v1";

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `r_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function newRepertoire(name: string, color: Color): Repertoire {
  return {
    id: makeId(),
    name: name.trim() || "Untitled repertoire",
    color,
    createdAt: Date.now(),
    root: [],
  };
}

/* ------------------------------------------------------------------ *
 * Immutable tree operations
 * ------------------------------------------------------------------ */

function addChildren(nodes: RepNode[], moves: LineMove[]): RepNode[] {
  if (moves.length === 0) return nodes;
  const [head, ...rest] = moves;
  const idx = nodes.findIndex((n) => n.san === head.san);
  if (idx === -1) {
    const child: RepNode = {
      san: head.san,
      from: head.from,
      to: head.to,
      fen: head.fen,
      children: addChildren([], rest),
    };
    return [...nodes, child];
  }
  const copy = nodes.slice();
  copy[idx] = { ...nodes[idx], children: addChildren(nodes[idx].children, rest) };
  return copy;
}

/** Return a new repertoire with the given line of moves merged into the tree. */
export function addLine(rep: Repertoire, moves: LineMove[]): Repertoire {
  if (moves.length === 0) return rep;
  return { ...rep, root: addChildren(rep.root, moves) };
}

function removeAt(nodes: RepNode[], sans: string[]): RepNode[] {
  if (sans.length === 0) return nodes;
  const [head, ...rest] = sans;
  const idx = nodes.findIndex((n) => n.san === head);
  if (idx === -1) return nodes;
  if (rest.length === 0) return nodes.filter((_, i) => i !== idx);
  const copy = nodes.slice();
  copy[idx] = { ...nodes[idx], children: removeAt(nodes[idx].children, rest) };
  return copy;
}

/** Remove the node at the end of `sans` (and its whole subtree). */
export function removeLine(rep: Repertoire, sans: string[]): Repertoire {
  return { ...rep, root: removeAt(rep.root, sans) };
}

function setCommentAt(
  nodes: RepNode[],
  sans: string[],
  comment: string,
): RepNode[] {
  if (sans.length === 0) return nodes;
  const [head, ...rest] = sans;
  const idx = nodes.findIndex((n) => n.san === head);
  if (idx === -1) return nodes;
  const copy = nodes.slice();
  if (rest.length === 0) {
    copy[idx] = { ...nodes[idx], comment: comment.trim() || undefined };
  } else {
    copy[idx] = {
      ...nodes[idx],
      children: setCommentAt(nodes[idx].children, rest, comment),
    };
  }
  return copy;
}

export function setComment(
  rep: Repertoire,
  sans: string[],
  comment: string,
): Repertoire {
  return { ...rep, root: setCommentAt(rep.root, sans, comment) };
}

/** The list of moves available after following `sans` from the root, or null if the path is broken. */
export function childrenAt(rep: Repertoire, sans: string[]): RepNode[] | null {
  let nodes = rep.root;
  for (const san of sans) {
    const next = nodes.find((n) => n.san === san);
    if (!next) return null;
    nodes = next.children;
  }
  return nodes;
}

/** The node reached by following `sans`, or null (root has no node). */
export function nodeAt(rep: Repertoire, sans: string[]): RepNode | null {
  let node: RepNode | null = null;
  let nodes = rep.root;
  for (const san of sans) {
    const next = nodes.find((n) => n.san === san);
    if (!next) return null;
    node = next;
    nodes = next.children;
  }
  return node;
}

/** Whether the full path of moves exists in the tree. */
export function pathExists(rep: Repertoire, sans: string[]): boolean {
  return childrenAt(rep, sans) !== null;
}

export function countNodes(rep: Repertoire): number {
  let count = 0;
  const walk = (nodes: RepNode[]) => {
    for (const n of nodes) {
      count++;
      walk(n.children);
    }
  };
  walk(rep.root);
  return count;
}

/** Number of complete lines (leaves) in the repertoire. */
export function countLines(rep: Repertoire): number {
  let count = 0;
  const walk = (nodes: RepNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) count++;
      else walk(n.children);
    }
  };
  walk(rep.root);
  return count;
}

/**
 * Every root-to-leaf line as a SAN sequence, in depth-first order (the same
 * order the tree is displayed). Used to drill the whole repertoire in sequence.
 */
export function enumerateLines(rep: Repertoire): string[][] {
  const lines: string[][] = [];
  const walk = (nodes: RepNode[], path: string[]) => {
    for (const node of nodes) {
      const next = [...path, node.san];
      if (node.children.length === 0) lines.push(next);
      else walk(node.children, next);
    }
  };
  walk(rep.root, []);
  return lines;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function isValidNode(n: unknown): n is RepNode {
  if (!n || typeof n !== "object") return false;
  const node = n as Record<string, unknown>;
  return (
    typeof node.san === "string" &&
    typeof node.from === "string" &&
    typeof node.to === "string" &&
    typeof node.fen === "string" &&
    Array.isArray(node.children) &&
    node.children.every(isValidNode)
  );
}

export function isValidRepertoire(r: unknown): r is Repertoire {
  if (!r || typeof r !== "object") return false;
  const rep = r as Record<string, unknown>;
  return (
    typeof rep.id === "string" &&
    typeof rep.name === "string" &&
    (rep.color === "white" || rep.color === "black") &&
    Array.isArray(rep.root) &&
    rep.root.every(isValidNode)
  );
}

export function loadRepertoires(): Repertoire[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRepertoire).map((r) => ({
      ...r,
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    }));
  } catch {
    return [];
  }
}

/** Persist all repertoires. Returns whether the write actually succeeded
 *  (localStorage can throw on quota or in private-browsing modes). */
export function saveRepertoires(reps: Repertoire[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reps));
    return true;
  } catch {
    /* quota / privacy-mode errors — report the failure to callers */
    return false;
  }
}

export function loadActiveId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
