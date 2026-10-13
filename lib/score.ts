export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

const SKIP = new Set(["gp", "gms_active"])

export function scoringLabel(scoring: Record<string, number>): string {
  const rec = Number(scoring.rec ?? 0)
  if (rec >= 0.9) return "PPR"
  if (rec >= 0.4 && rec < 0.6) return "Half PPR"
  if (rec === 0) return "Standard"
  return `Custom receiving (${rec} per catch)`
}

export function scorePlayerStats(
  stats: Record<string, number> | undefined,
  scoring: Record<string, number>,
  defense: boolean,
): number | null {
  if (!stats) return null
  if (defense) {
    const pts = stats.pts_std ?? stats.pts_ppr ?? stats.pts_half_ppr
    return typeof pts === "number" ? round1(pts) : null
  }
  let total = 0
  let matched = 0
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    if (
      key.startsWith("pts_") ||
      key.startsWith("pos_rank") ||
      key.startsWith("adp") ||
      key.startsWith("pos_adp")
    ) {
      continue
    }
    if (SKIP.has(key)) continue
    const mult = scoring[key]
    if (typeof mult !== "number") continue
    total += value * mult
    if (mult !== 0 && value !== 0) matched += 1
  }
  if (matched === 0) {
    const rec = Number(scoring.rec ?? 0)
    const fallback =
      rec >= 0.75 ? stats.pts_ppr : rec >= 0.25 ? stats.pts_half_ppr : stats.pts_std
    return typeof fallback === "number" ? round1(fallback) : null
  }
  return round1(total)
}

export function recentAverage(
  values: Array<number | null>,
): { average: number | null; weeks: number } {
  const scored = values.filter((value): value is number => value != null)
  if (!scored.length) return { average: null, weeks: 0 }
  const total = scored.reduce((sum, value) => sum + value, 0)
  return { average: round1(total / scored.length), weeks: scored.length }
}
