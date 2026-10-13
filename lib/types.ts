export type Platform = "sleeper" | "espn"

export type Injury =
  | "healthy"
  | "questionable"
  | "doubtful"
  | "out"
  | "ir"
  | "suspended"

export type Availability = "rostered" | "waiver" | "free"

export type EvalPlayer = {
  id: string
  name: string
  position: string
  team: string | null
  injury: Injury
  injuryLabel: string | null
  onBye: boolean
  byeWeek: number | null
  projection: number | null
  recentAverage: number | null
  recentWeeks: number
  slot: string | null
  availability: Availability
  ownedPercent: number | null
  searchRank: number | null
  starter: boolean
  canStart: boolean
  opponent: string | null
  harrisRank: number | null
  seasonRank: number | null
}

export type AdvicePlayer = {
  id: string
  name: string
  position: string
  nflTeam: string | null
  slot: string | null
  injury: string | null
  byeWeek: number | null
  onBye: boolean
  projection: number | null
  recentAverage: number | null
  recentWeeks: number
  score: number | null
  opponent: string | null
  harrisRank: number | null
  seasonRank: number | null
}

export type RosterSlot = {
  slot: string
  player: AdvicePlayer | null
}

export type Claim = {
  rank: number
  add: AdvicePlayer
  drop: AdvicePlayer | null
  reason: string
  bidHint: string | null
}

export type FreeAgentPick = {
  rank: number
  player: AdvicePlayer
  suggestedDrop: AdvicePlayer | null
  reason: string
}

export type TradeSuggestion = {
  rank: number
  player: AdvicePlayer
  target: AdvicePlayer | null
  targetTeam: string | null
  reason: string
}

export type DropPick = {
  rank: number
  player: AdvicePlayer
  reason: string
  tone: "clear" | "if-needed"
}

export type StandingRow = {
  id: string
  name: string
  rank: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  recordLabel: string
  inPlayoffSpot: boolean
  winsBehind: number | null
  gamesBack: number | null
  isUser: boolean
}

export type ManagerAdvice = {
  platform: Platform
  league: {
    id: string
    name: string
    season: number
    week: number
    scoredWeek: number
    teamCount: number
    playoffSpots: number | null
    scoringLabel: string
    waiverLabel: string
    mode: "standard" | "guillotine"
  }
  team: {
    id: string
    name: string
    recordLabel: string
    wins: number
    losses: number
    ties: number
    pointsFor: number
    rank: number
    inPlayoffSpot: boolean
    standingNote: string
    faabRemaining: number | null
    waiverPosition: number | null
  }
  standings: StandingRow[]
  roster: {
    starters: RosterSlot[]
    bench: RosterSlot[]
    reserve: RosterSlot[]
  }
  claims: Claim[]
  freeAgents: FreeAgentPick[]
  drops: DropPick[]
  trades: TradeSuggestion[]
  holes: string[]
  method: string
  warnings: string[]
  generatedAt: string
  harris: {
    week: number | null
    updated: string | null
    seasonWeek: number | null
    seasonUpdated: string | null
    seasonLabel: string | null
  }
}

export type TeamOption = {
  id: string
  name: string
  recordLabel: string
}

export type LeagueOption = {
  id: string
  name: string
  status: string
  teams: number
}

export type SleeperConnectResult = {
  user: {
    userId: string
    username: string
    displayName: string
    avatar: string | null
  }
  season: number
  week: number
  leagues: LeagueOption[]
}

export type AdviceResult =
  | { kind: "teams"; leagueName: string; teams: TeamOption[] }
  | { kind: "advice"; advice: ManagerAdvice }
