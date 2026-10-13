export type StandingInput = {
  id: string
  name: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  gamesBack: number | null
}

export type RankedStanding = StandingInput & {
  rank: number
  inPlayoffSpot: boolean
  winsBehind: number | null
  recordLabel: string
}

export function recordLabel(wins: number, losses: number, ties: number): string {
  if (ties > 0) return `${wins}-${losses}-${ties}`
  return `${wins}-${losses}`
}

export function rankStandings(
  teams: StandingInput[],
  playoffSpots: number | null,
): RankedStanding[] {
  const sorted = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.ties !== a.ties) return b.ties - a.ties
    return b.pointsFor - a.pointsFor
  })
  const spots = playoffSpots && playoffSpots > 0 ? playoffSpots : null
  const cutoff = spots ? sorted[spots - 1] : undefined
  return sorted.map((team, index) => {
    const rank = index + 1
    const inPlayoffSpot = spots != null && rank <= spots
    let winsBehind: number | null = null
    if (spots == null) winsBehind = null
    else if (inPlayoffSpot) winsBehind = 0
    else if (cutoff) winsBehind = Math.max(0, cutoff.wins - team.wins)
    return {
      ...team,
      rank,
      inPlayoffSpot,
      winsBehind,
      recordLabel: recordLabel(team.wins, team.losses, team.ties),
    }
  })
}

function gamesPhrase(value: number): string {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1)
  const unit = value === 1 ? "game" : "games"
  return `${shown} ${unit}`
}

export function standingNote(
  row: RankedStanding,
  playoffSpots: number | null,
  mode: "standard" | "guillotine",
): string {
  if (mode === "guillotine") {
    return "Guillotine league: there is no bracket to climb. The weekly low score is eliminated, so this board favors players who score this week."
  }
  if (playoffSpots == null || playoffSpots <= 0) {
    return "This league did not publish a playoff field size, so the cut line is not ranked."
  }
  if (row.inPlayoffSpot) {
    return `In a playoff spot, ${row.rank} of ${playoffSpots}.`
  }
  if (row.gamesBack != null && row.gamesBack > 0) {
    return `${gamesPhrase(row.gamesBack)} out of a playoff spot.`
  }
  if (row.winsBehind != null && row.winsBehind > 0) {
    const unit = row.winsBehind === 1 ? "win" : "wins"
    return `${row.winsBehind} ${unit} behind the last playoff spot.`
  }
  return "Tied on wins with the last playoff spot, trailing on points."
}
