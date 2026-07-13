import { isValidRepertoire } from "./repertoire";
import type { RepNode, Repertoire } from "./types";

/**
 * Portable backup / sync of the whole repertoire collection.
 *
 * Everything lives in localStorage, which is per-browser and per-device, so to
 * use the same repertoires elsewhere the data has to physically travel there.
 * Two carriers are supported, both fully offline:
 *   - a downloadable `.json` backup file
 *   - a copy-pasteable "sync code" (base64url of the same JSON)
 * Either one can be fed back through {@link parseTransfer}.
 */

const APP_TAG = "chess-opening-repertoire";
export const TRANSFER_VERSION = 1;

/** Prefix + separator that marks a sync code, e.g. `COR1.eyJhcHAiOi...`. */
const CODE_PREFIX = "COR1";
/** Valid base64url body characters (no whitespace). */
const CODE_BODY_RE = /^[A-Za-z0-9_-]+$/;

export interface TransferPayload {
  app: typeof APP_TAG;
  version: number;
  exportedAt: number;
  repertoires: Repertoire[];
}

/** Thrown with a user-facing message when import data can't be understood. */
export class TransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferError";
  }
}

function buildPayload(reps: Repertoire[]): TransferPayload {
  return {
    app: APP_TAG,
    version: TRANSFER_VERSION,
    exportedAt: Date.now(),
    repertoires: reps,
  };
}

/* ------------------------------------------------------------------ *
 * base64url helpers (unicode-safe, chunked for large payloads)
 * ------------------------------------------------------------------ */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/** Pretty-printed JSON for a downloadable backup file. */
export function serializeBackup(reps: Repertoire[]): string {
  return JSON.stringify(buildPayload(reps), null, 2);
}

/** Compact copy-paste code carrying the same data as the backup file. */
export function encodeSyncCode(reps: Repertoire[]): string {
  const json = JSON.stringify(buildPayload(reps));
  const bytes = new TextEncoder().encode(json);
  return `${CODE_PREFIX}.${toBase64Url(bytes)}`;
}

/** A filename-safe local date like `2026-07-13` (not UTC, so it matches the
 *  user's calendar even near midnight). */
export function backupFileName(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `chess-repertoire-backup-${y}-${m}-${d}.json`;
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/** The valid repertoires plus how many entries were dropped as invalid. */
export interface ParsedTransfer {
  repertoires: Repertoire[];
  skipped: number;
}

function extractRepertoires(data: unknown): ParsedTransfer {
  let arr: unknown[];
  if (Array.isArray(data)) {
    // A bare array of repertoires (also our older/raw storage shape).
    arr = data;
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { repertoires?: unknown }).repertoires)
  ) {
    arr = (data as { repertoires: unknown[] }).repertoires;
  } else if (isValidRepertoire(data)) {
    arr = [data];
  } else {
    throw new TransferError("No repertoires found in this backup.");
  }

  const valid = arr.filter(isValidRepertoire);
  const repertoires = valid.map((r) => ({
    ...r,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
  }));

  if (repertoires.length === 0) {
    throw new TransferError("No valid repertoires found in this backup.");
  }
  // Surface partial corruption instead of silently dropping repertoires.
  return { repertoires, skipped: arr.length - valid.length };
}

/**
 * Parse either a backup file's JSON text or a pasted sync code into repertoires.
 * Throws {@link TransferError} with a friendly message on failure.
 */
export function parseTransfer(text: string): ParsedTransfer {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new TransferError("Nothing to import — paste a code or choose a file.");
  }

  let json: string;
  if (trimmed.startsWith(`${CODE_PREFIX}.`)) {
    // Sync code. Strip interior whitespace first: transports like email hard-
    // wrap long lines, and base64url never legitimately contains whitespace.
    const body = trimmed.slice(CODE_PREFIX.length + 1).replace(/\s+/g, "");
    if (!CODE_BODY_RE.test(body)) {
      throw new TransferError("This sync code looks corrupted or incomplete.");
    }
    try {
      json = new TextDecoder().decode(fromBase64Url(body));
    } catch {
      throw new TransferError("This sync code looks corrupted or incomplete.");
    }
  } else {
    json = trimmed;
  }

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new TransferError("This isn't a valid backup file or sync code.");
  }
  return extractRepertoires(data);
}

/**
 * Union two move trees by SAN, recursively. Moves present in either side are
 * kept; where both sides have the same move, their subtrees are merged and the
 * existing comment wins (falling back to the incoming one). This makes a merge
 * additive — no line from either browser is ever lost.
 */
function mergeNodes(local: RepNode[], incoming: RepNode[]): RepNode[] {
  const out: RepNode[] = local.map((n) => ({ ...n, children: n.children.slice() }));
  for (const inc of incoming) {
    const i = out.findIndex((n) => n.san === inc.san);
    if (i === -1) {
      out.push(inc);
    } else {
      out[i] = {
        ...out[i],
        comment: out[i].comment ?? inc.comment,
        children: mergeNodes(out[i].children, inc.children),
      };
    }
  }
  return out;
}

/**
 * Merge incoming repertoires into the existing ones by id. A brand-new id is
 * added as-is; when an id already exists locally, the two trees are unioned
 * (see {@link mergeNodes}) so neither browser's lines are overwritten. The
 * local name/color are kept and the earlier createdAt is preserved.
 */
export function mergeRepertoires(
  existing: Repertoire[],
  incoming: Repertoire[],
): Repertoire[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const inc of incoming) {
    const local = byId.get(inc.id);
    if (!local) {
      byId.set(inc.id, inc);
    } else {
      byId.set(inc.id, {
        ...local,
        root: mergeNodes(local.root, inc.root),
        createdAt: Math.min(local.createdAt, inc.createdAt),
      });
    }
  }
  return [...byId.values()];
}

/** How an incoming set compares to what's already stored. */
export interface ImportSummary {
  total: number;
  added: number;
  updated: number;
}

export function summarizeImport(
  existing: Repertoire[],
  incoming: Repertoire[],
): ImportSummary {
  const existingIds = new Set(existing.map((r) => r.id));
  // Dedupe within the incoming set so the counts match what mergeRepertoires
  // (which collapses duplicate ids) actually stores.
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (existingIds.has(r.id)) updated++;
    else added++;
  }
  return { total: seen.size, added, updated };
}
