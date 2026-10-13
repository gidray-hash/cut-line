import { assignRanks, harrisBoard, HarrisAccessError, lookupRanks, type HarrisBoard } from "./harris"
import { arrangeRoster, recommend } from "./heuristic"
import { byeWeekFor, byeWeekMap, nflState, normalizeTeam, opponentByTeam, opponentFor, type NflState } from "./nfl"
import { recentAverage, round1, scorePlayerStats, scoringLabel } from "./score"
import { rankStandings, recordLabel, standingNote } from "./standings"
import type {
  AdviceResult,
  EvalPlayer,
  LeagueOption,
  ManagerAdvice,
  SleeperConnectResult,
} from "./types"
import { UpstreamError, readJson } from "./upstream"

const SLEEPER = "https://api.sleeper.app/v1"

type SleeperUser = {
  user_id?: string
  username?: string | null
  display_name?: string | null
  avatar?: string | null
}

type SleeperLeague = {
  league_id?: string
  name?: string
  status?: string
  total_rosters?: number
  season?: string
  roster_positions?: string[]
  scoring_settings?: Record<string, number>
  settings?: Record<string, number | null>
}

type SleeperRoster = {
  roster_id: number
  owner_id?: string | null
  co_owners?: string[] | null
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    waiver_position?: number
    waiver_budget_used?: number
  }
}

type SleeperLeagueUser = {
  user_id?: string
  display_name?: string
  metadata?: { team_name?: string }
}

type SlimPlayer = {
  name: string
  position: string
  team: string | null
  injury: string | null
  searchRank: number | null
}

type StatLine = Record<string, number>

const BENCH = new Set(["BN", "IR", "TAXI"])
let playersCache: { at: number; value: Map<string, SlimPlayer> } | null = null
const statsCache = new Map<string, { at: number; value: Map<string, StatLine> }>()

async function sleeperGet<T>(path: string): Promise<T> {
  const response = await fetch(`${SLEEPER}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  })
  if (response.status === 404) {
    throw new UpstreamError("Sleeper could not find that.", 404)
  }
  if (!response.ok) {
    throw new UpstreamError("Sleeper did not return league data. Try again in a moment.", 502)
  }
  return readJson<T>(response)
}

function owns(roster: SleeperRoster, userId: string): boolean {
  if (roster.owner_id === userId) return true
  return Array.isArray(roster.co_owners) && roster.co_owners.map(String).includes(userId)
}

function teamName(user: SleeperLeagueUser | undefined, rosterId: number): string {
  const named = user?.metadata?.team_name?.trim()
  if (named) return named
  if (user?.display_name) return user.display_name
  return `Roster ${rosterId}`
}

function pointsFor(settings: SleeperRoster["settings"]): number {
  const whole = settings?.fpts ?? 0
  const decimal = settings?.fpts_decimal ?? 0
  return round1(whole + decimal / 100)
}

export async function connectSleeper(username: string): Promise<SleeperConnectResult> {
  const trimmed = username.trim()
  if (!trimmed || trimmed.length > 40) {
    throw new UpstreamError("Enter the Sleeper username, not an email or password.", 400)
  }
  const user = await sleeperGet<SleeperUser | null>(`/user/${encodeURIComponent(trimmed)}`)
  if (!user?.user_id) {
    throw new UpstreamError("No Sleeper user goes by that username.", 404)
  }
  const state = await nflState()
  const leagues = await sleeperGet<SleeperLeague[]>(
    `/user/${user.user_id}/leagues/nfl/${state.season}`,
  )
  const options: LeagueOption[] = (Array.isArray(leagues) ? leagues : []).map((league) => ({
    id: String(league.league_id),
    name: league.name || "Untitled league",
    status: league.status || "unknown",
    teams: league.total_rosters ?? 0,
  }))
  return {
    user: {
      userId: user.user_id,
      username: user.username || trimmed,
      displayName: user.display_name || user.username || trimmed,
      avatar: user.avatar || null,
    },
    season: state.season,
    week: state.week,
    leagues: options,
  }
}

async function playerMap(): Promise<Map<string, SlimPlayer>> {
  if (playersCache && Date.now() - playersCache.at < 6 * 60 * 60 * 1000) return playersCache.value
  const response = await fetch(`${SLEEPER}/players/nfl`, {
    cache: "no-store",
    signal: AbortSignal.timeout(40000),
  })
  if (!response.ok) throw new UpstreamError("Sleeper player data did not load.", 502)
  const body = (await response.json()) as Record<string, Record<string, unknown> | null>
  const map = new Map<string, SlimPlayer>()
  for (const [id, raw] of Object.entries(body)) {
    if (!raw || typeof raw !== "object") continue
    const first = typeof raw.first_name === "string" ? raw.first_name : ""
    const last = typeof raw.last_name === "string" ? raw.last_name : ""
    const full = typeof raw.full_name === "string" ? raw.full_name : `${first} ${last}`.trim()
    const positionRaw = typeof raw.position === "string" ? raw.position : ""
    const fantasy = Array.isArray(raw.fantasy_positions) ? raw.fantasy_positions : []
    const position = positionRaw || (typeof fantasy[0] === "string" ? fantasy[0] : "")
    const searchRank = typeof raw.search_rank === "number" ? raw.search_rank : null
    map.set(id, {
      name: full || id,
      position: position === "DST" ? "DEF" : position || "?",
      team: normalizeTeam(typeof raw.team === "string" ? raw.team : null),
      injury: typeof raw.injury_status === "string" ? raw.injury_status : null,
      searchRank: searchRank != null && searchRank < 100000 ? searchRank : null,
    })
  }
  playersCache = { at: Date.now(), value: map }
  return map
}

async function statWeek(season: number, week: number, seasonType: string): Promise<Map<string, StatLine>> {
  const key = `${season}:${seasonType}:${week}`
  const cached = statsCache.get(key)
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value
  const response = await fetch(`${SLEEPER}/stats/nfl/${seasonType}/${season}/${week}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  })
  if (!response.ok) throw new UpstreamError(`Week ${week} stats did not load.`, 502)
  const body = (await response.json()) as Record<string, StatLine>
  const value = new Map(Object.entries(body))
  statsCache.set(key, { at: Date.now(), value })
  return value
}

function mapInjury(raw: string | null): { injury: EvalPlayer["injury"]; label: string | null } {
  if (!raw) return { injury: "healthy", label: null }
  const value = raw.toLowerCase()
  if (value.includes("question")) return { injury: "questionable", label: "Questionable" }
  if (value.includes("doubt")) return { injury: "doubtful", label: "Doubtful" }
  if (value.includes("sus") || value.includes("suspend")) return { injury: "suspended", label: "Suspended" }
  if (value === "ir" || value.includes("pup") || value.includes("reserve")) return { injury: "ir", label: "IR" }
  if (value === "out" || value === "o") return { injury: "out", label: "Out" }
  return { injury: "healthy", label: null }
}

function isDefense(id: string, position: string): boolean {
  return position === "DEF" || /^[A-Z]{2,3}$/.test(id)
}

async function lockedPlayerIds(leagueId: string, week: number, clearDays: number): Promise<Set<string>> {
  const ids = new Set<string>()
  if (clearDays <= 0) return ids
  const weeks = [week, Math.max(1, week - 1)]
  const lists = await Promise.all(
    weeks.map((round) =>
      sleeperGet<Array<{ status?: string; created?: number; drops?: Record<string, number> | null }>>(
        `/league/${leagueId}/transactions/${round}`,
      ).catch(() => []),
    ),
  )
  const windowMs = clearDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  for (const list of lists) {
    for (const tx of list) {
      if (tx.status !== "complete" || !tx.drops || !tx.created) continue
      if (now - tx.created > windowMs) continue
      for (const playerId of Object.keys(tx.drops)) ids.add(playerId)
    }
  }
  return ids
}

function toEval(
  id: string,
  meta: SlimPlayer | undefined,
  scoring: Record<string, number>,
  projection: StatLine | undefined,
  recentWeeks: Map<string, StatLine>[],
  byes: Map<string, number>,
  week: number,
  opponents: Map<string, string>,
  extras: Partial<EvalPlayer>,
): EvalPlayer {
  const position = meta?.position || (isDefense(id, "") ? "DEF" : "?")
  const defense = isDefense(id, position)
  const team = meta?.team ?? (defense ? normalizeTeam(id) : null)
  const bye = byeWeekFor(byes, team)
  const injury = mapInjury(meta?.injury ?? null)
  const recent = recentAverage(
    recentWeeks.map((stats) => scorePlayerStats(stats.get(id), scoring, defense)),
  )
  const player: EvalPlayer = {
    id,
    name: meta?.name || (defense ? `${id} D/ST` : `Player ${id}`),
    position: defense ? "DEF" : position,
    team,
    injury: injury.injury,
    injuryLabel: injury.label,
    onBye: bye === week,
    byeWeek: bye,
    projection: scorePlayerStats(projection, scoring, defense),
    recentAverage: recent.average,
    recentWeeks: recent.weeks,
    slot: null,
    availability: "free",
    ownedPercent: null,
    searchRank: meta?.searchRank ?? null,
    starter: false,
    canStart: true,
    opponent: null,
    harrisRank: null,
    seasonRank: null,
    ...extras,
  }
  player.opponent = opponentFor(opponents, player.team)
  player.harrisRank = null
  player.seasonRank = null
  return player
}

export async function sleeperAdvice(input: {
  leagueId: string
  userId: string
  rosterId?: number | null
}): Promise<AdviceResult> {
  if (!/^\d{5,30}$/.test(input.leagueId)) {
    throw new UpstreamError("That Sleeper league id does not look right.", 400)
  }
  const state = await nflState()
  const [league, rosters, users] = await Promise.all([
    sleeperGet<SleeperLeague>(`/league/${input.leagueId}`),
    sleeperGet<SleeperRoster[]>(`/league/${input.leagueId}/rosters`),
    sleeperGet<SleeperLeagueUser[]>(`/league/${input.leagueId}/users`),
  ])
  const mine = rosters.filter((roster) => owns(roster, input.userId))
  if (!mine.length) {
    throw new UpstreamError("That Sleeper user does not have a team in this league.", 404)
  }
  if (mine.length > 1 && (input.rosterId == null || !mine.some((roster) => roster.roster_id === input.rosterId))) {
    const byId = new Map(users.map((user) => [user.user_id, user]))
    return {
      kind: "teams",
      leagueName: league.name || "Sleeper league",
      teams: mine.map((roster) => ({
        id: String(roster.roster_id),
        name: teamName(byId.get(roster.owner_id ?? ""), roster.roster_id),
        recordLabel: recordLabel(roster.settings?.wins ?? 0, roster.settings?.losses ?? 0, roster.settings?.ties ?? 0),
      })),
    }
  }
  const roster = mine.find((item) => input.rosterId == null || item.roster_id === input.rosterId) ?? mine[0]
  if (!roster) throw new UpstreamError("That team is not in this league.", 404)
  return { kind: "advice", advice: await buildAdvice(league, rosters, users, roster, state) }
}

async function buildAdvice(
  league: SleeperLeague,
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
  roster: SleeperRoster,
  state: NflState,
): Promise<ManagerAdvice> {
  const warnings: string[] = []
  const scoring = league.scoring_settings ?? {}
  const settings = league.settings ?? {}
  const positions = league.roster_positions ?? []
  const starterSlots = positions.filter((slot) => !BENCH.has(slot))
  const byUser = new Map(users.map((user) => [user.user_id, user]))
  const clearDays = Number(settings.waiver_clear_days ?? 1)
  const week = state.week
  const scoredWeek = state.scoredWeek

  const [players, byes, locked, opponents, ...recentStats] = await Promise.all([
    playerMap(),
    byeWeekMap(state.season).catch(() => {
      warnings.push("Bye weeks did not load, so bye replacements may be missing.")
      return new Map<string, number>()
    }),
    lockedPlayerIds(String(league.league_id), week, clearDays),
    opponentByTeam(state.season, week).catch(() => new Map<string, string>()),
    ...[0, 1, 2]
      .map((offset) => scoredWeek - offset)
      .filter((value) => value >= 1)
      .map((value) => statWeek(state.season, value, state.seasonType || "regular")),
  ])

  const rostered = new Set<string>()
  for (const entry of rosters) {
    for (const id of entry.players ?? []) if (id && id !== "0") rostered.add(id)
  }

  let board: HarrisBoard | null = null
  try {
    board = await harrisBoard({ nflWeek: week })
  } catch (error) {
    if (error instanceof HarrisAccessError) throw error
    warnings.push("Harris PPR rankings did not load, so players are unranked.")
  }
  if (board?.week && board.week !== week) {
    warnings.push(`Harris weekly ranks are still Week ${board.week}. Start/sit uses that list.`)
  }

  const candidateIds = new Set<string>()
  if (board) {
    for (const [id, meta] of players) {
      if (rostered.has(id)) continue
      const defense = isDefense(id, meta.position)
      const position = defense ? "DEF" : meta.position
      if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(position)) continue
      const found = lookupRanks(board, {
        position,
        name: meta.name,
        team: meta.team ?? (defense ? normalizeTeam(id) : null),
      })
      if (found.weekly != null || found.season != null) candidateIds.add(id)
    }
  }

  const reserve = new Set(roster.reserve ?? [])
  const taxi = new Set(roster.taxi ?? [])
  const starterIds = (roster.starters ?? []).filter((id) => id && id !== "0")
  const starterSet = new Set(starterIds)
  const make = (id: string, extras: Partial<EvalPlayer>) =>
    toEval(id, players.get(id), scoring, undefined, recentStats, byes, week, opponents, extras)

  const rosterPlayers: EvalPlayer[] = []
  for (const id of roster.players ?? []) {
    if (!id || id === "0") continue
    const onReserve = reserve.has(id) || taxi.has(id)
    rosterPlayers.push(
      make(id, {
        availability: "rostered",
        starter: starterSet.has(id),
        canStart: !onReserve,
        slot: onReserve ? (reserve.has(id) ? "IR" : "TAXI") : starterSet.has(id) ? "START" : "BN",
      }),
    )
  }

  const available: EvalPlayer[] = []
  for (const id of candidateIds) {
    if (rostered.has(id)) continue
    const meta = players.get(id)
    if (!meta) continue
    if (!["QB", "RB", "WR", "TE", "K", "DEF"].includes(meta.position) && !isDefense(id, meta.position)) {
      continue
    }
    available.push(
      make(id, {
        availability: locked.has(id) ? "waiver" : "free",
      }),
    )
  }

  for (const player of rosterPlayers) assignRanks(player, board)
  for (const player of available) assignRanks(player, board)
  const tradeOpponents = rosters
    .filter((entry) => entry.roster_id !== roster.roster_id)
    .map((entry) => {
      const teamPlayers: EvalPlayer[] = []
      for (const id of entry.players ?? []) {
        if (!id || id === "0") continue
        const made = make(id, { availability: "rostered", canStart: true })
        assignRanks(made, board)
        teamPlayers.push(made)
      }
      return {
        teamName: teamName(byUser.get(entry.owner_id ?? ""), entry.roster_id),
        players: teamPlayers,
      }
    })

  const activeSlots = positions.filter((slot) => slot !== "IR" && slot !== "TAXI").length
  const activeCount = (roster.players ?? []).filter((id) => id && id !== "0" && !reserve.has(id) && !taxi.has(id)).length
  const waiverType = Number(settings.waiver_type ?? 2)
  const budget = Number(settings.waiver_budget ?? 0)
  const used = roster.settings?.waiver_budget_used ?? 0
  const useFaab = waiverType === 1
  const faabRemaining = useFaab ? Math.max(0, budget - used) : null
  const mode = Number(settings.type) === 3 ? "guillotine" : "standard"
  const playoffSpots = mode === "guillotine" ? null : Number(settings.playoff_teams ?? 0) || null
  const adviceCore = recommend({
    week,
    starterSlots,
    roster: rosterPlayers,
    available,
    rosterFull: activeCount >= activeSlots && activeSlots > 0,
    faabRemaining,
    useFaab,
    ranksLoaded: board != null,
    seasonPositions: board?.seasonPositions ?? [],
    opponents: tradeOpponents,
  })

  const standingsInput = rosters.map((entry) => ({
    id: String(entry.roster_id),
    name: teamName(byUser.get(entry.owner_id ?? ""), entry.roster_id),
    wins: entry.settings?.wins ?? 0,
    losses: entry.settings?.losses ?? 0,
    ties: entry.settings?.ties ?? 0,
    pointsFor: pointsFor(entry.settings),
    gamesBack: null,
  }))
  const ranked = rankStandings(standingsInput, playoffSpots)
  const mine = ranked.find((row) => row.id === String(roster.roster_id))
  const note = mine ? standingNote(mine, playoffSpots, mode) : "Standings did not include this team."

  const arranged = arrangeRoster(starterSlots, rosterPlayers)

  if (positions.some((slot) => ["DL", "LB", "DB", "IDP_FLEX"].includes(slot))) {
    warnings.push("This league starts individual defensive players. Pickup advice covers offense, kickers, and team defense.")
  }
  if (league.status === "pre_draft") {
    warnings.push("This league is still before the draft, so the playoff picture is only a shell.")
  }
  const waiverLabel =
    waiverType === 1
      ? `FAAB, $${budget} budget`
      : waiverType === 0
        ? "Rolling waivers"
        : "Waiver priority, reset from the standings"

  return {
    platform: "sleeper",
    league: {
      id: String(league.league_id),
      name: league.name || "Sleeper league",
      season: state.season,
      week,
      scoredWeek,
      teamCount: league.total_rosters ?? rosters.length,
      playoffSpots,
      scoringLabel: scoringLabel(scoring),
      waiverLabel,
      mode,
    },
    team: {
      id: String(roster.roster_id),
      name: teamName(byUser.get(roster.owner_id ?? ""), roster.roster_id),
      recordLabel: mine?.recordLabel ?? recordLabel(roster.settings?.wins ?? 0, roster.settings?.losses ?? 0, roster.settings?.ties ?? 0),
      wins: roster.settings?.wins ?? 0,
      losses: roster.settings?.losses ?? 0,
      ties: roster.settings?.ties ?? 0,
      pointsFor: mine?.pointsFor ?? pointsFor(roster.settings),
      rank: mine?.rank ?? rosters.length,
      inPlayoffSpot: mine?.inPlayoffSpot ?? false,
      standingNote: note,
      faabRemaining,
      waiverPosition: roster.settings?.waiver_position ?? null,
    },
    standings: ranked.map((row) => ({ ...row, isUser: row.id === String(roster.roster_id) })),
    roster: arranged,
    claims: adviceCore.claims,
    freeAgents: adviceCore.freeAgents,
    drops: adviceCore.drops,
    trades: adviceCore.trades,
    holes: adviceCore.holes,
    method: adviceCore.method,
    warnings,
    generatedAt: new Date().toISOString(),
    harris: {
      week: board?.week ?? null,
      updated: board?.updated ?? null,
      seasonWeek: board?.seasonWeek ?? null,
      seasonUpdated: board?.seasonUpdated ?? null,
      seasonLabel: board?.seasonLabel ?? null,
    },
  }
}
