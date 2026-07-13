/**
 * How deep to chase coverage gaps. Gaps and coverage are filtered by a
 * minimum "importance" (the probability of actually reaching that exact
 * position from the start), so a club player isn't buried in 0.3% sidelines
 * while a master can demand everything.
 */
export type Thoroughness = "club" | "tournament" | "master";

export interface ThoroughnessLevel {
  id: Thoroughness;
  label: string;
  blurb: string;
  /** Only count gaps/replies you'll reach at least this often (0..1). */
  minImportance: number;
}

export const THOROUGHNESS_LEVELS: ThoroughnessLevel[] = [
  {
    id: "club",
    label: "Club",
    blurb: "Main lines you'll meet most games",
    minImportance: 0.02,
  },
  {
    id: "tournament",
    label: "Tournament",
    blurb: "Down to the occasional sideline",
    minImportance: 0.005,
  },
  {
    id: "master",
    label: "Master",
    blurb: "Everything, including rare lines",
    minImportance: 0,
  },
];

export const DEFAULT_THOROUGHNESS: Thoroughness = "tournament";
export const THOROUGHNESS_KEY = "chess-thoroughness";

export function minImportanceFor(level: Thoroughness): number {
  return (
    THOROUGHNESS_LEVELS.find((l) => l.id === level)?.minImportance ?? 0
  );
}
