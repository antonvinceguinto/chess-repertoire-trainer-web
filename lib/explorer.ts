import type { ExplorerData, ExplorerDb, ExplorerMove } from "./types";

const ENDPOINTS: Record<ExplorerDb, string> = {
  lichess: "https://explorer.lichess.ovh/lichess",
  masters: "https://explorer.lichess.ovh/masters",
};

interface RawMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}

interface RawResponse {
  white: number;
  draws: number;
  black: number;
  moves: RawMove[];
  opening: { eco: string; name: string } | null;
}

export class ExplorerRateLimitError extends Error {
  constructor() {
    super("Opening explorer rate limit reached. Please wait a moment.");
    this.name = "ExplorerRateLimitError";
  }
}

/**
 * Query the Lichess opening explorer for the given position.
 * `lichess` = all rated online games; `masters` = over-the-board master games.
 */
export async function fetchExplorer(
  fen: string,
  db: ExplorerDb,
  signal?: AbortSignal,
): Promise<ExplorerData> {
  const params = new URLSearchParams({
    fen,
    moves: "12",
    topGames: "0",
    recentGames: "0",
  });
  if (db === "lichess") {
    params.set("variant", "standard");
    params.set("speeds", "blitz,rapid,classical");
    params.set("ratings", "1600,1800,2000,2200,2500");
  }

  const res = await fetch(`${ENDPOINTS[db]}?${params.toString()}`, { signal });
  if (res.status === 429) throw new ExplorerRateLimitError();
  if (!res.ok) throw new Error(`Explorer request failed (${res.status})`);

  const raw = (await res.json()) as RawResponse;
  const moves: ExplorerMove[] = (raw.moves ?? []).map((m) => {
    const total = m.white + m.draws + m.black;
    return {
      uci: m.uci,
      san: m.san,
      white: m.white,
      draws: m.draws,
      black: m.black,
      total,
      averageRating: m.averageRating ?? null,
    };
  });
  const total = raw.white + raw.draws + raw.black;
  return {
    white: raw.white,
    draws: raw.draws,
    black: raw.black,
    total,
    moves,
    opening: raw.opening,
  };
}
