import { assignRanks, harrisBoard, HarrisAccessError, type HarrisBoard } from "./harris"
import { arrangeRoster, recommend } from "./heuristic"
import { byeWeekFor, byeWeekMap, nflState, opponentByTeam, opponentFor, teamAbbreviations } from "./nfl"
import { round1 } from "./score"
import { rankStandings, recordLabel, standingNote } from "./standings"
import type { AdviceResult, EvalPlayer, ManagerAdvice } from "./types"
import { UpstreamError, readJson } from "./upstream"

const SLOT_NAME: Record<number, string> = {
  0: "QB",
  1: "TQB",
  2: "RB",
  3: "RB/WR",
  4: "WR",
  5: "WR/TE",
  6: "TE",
  7: "OP",
  16: "DEF",
  17: "K",
  23: "FLEX",
}

const POSITION_NAME: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  15: "TQB",
  16: "DEF",
}

const SLOT_ORDER = [0, 1, 2, 4, 6, 23, 3, 5, 7, 16, 17]

type EspnStat = {
  scoringPeriodId?: number
  statSourceId?: number
  statSplitTypeId?: number
  appliedTotal?: number
}

type EspnPlayer = {
  id?: number
  fullName?: string
  defaultPositionId?: number
  injuryStatus?: string
  proTeamId?: number
  stats?: EspnStat[]
  ownership?: { percentOwned?: number }
}

type EspnEntry = {
  lineupSlotId?: number
  playerPoolEntry?: { player?: EspnPlayer; onTeamId?: number }
  playerId?: number
}

type EspnTeam = {
  id: number
  name?: string
  abbrev?: string
  playoffSeed?: number
  eliminated?: boolean
  primaryOwner?: string
  owners?: string[]
  waiverRank?: number
  points?: number
  record?: {
    overall?: {
      wins?: number
      losses?: number
      ties?: number
      pointsFor?: number
      gamesBack?: number
    }
  }
  roster?: { entries?: EspnEntry[] }
}

type EspnLeague = {
  scoringPeriodId?: number
  seasonId?: number
  settings?: {
    name?: string
    size?: number
    rosterSettings?: { lineupSlotCounts?: Record<string, number> }
    scheduleSettings?: { playoffTeamCount?: number }
    acquisitionSettings?: {
      acquisitionBudget?: number
      isUsingAcquisitionBudget?: boolean
      acquisitionType?: string
      waiverHours?: number
    }
  }
  status?: {
    currentMatchupPeriod?: number
    latestScoringPeriod?: number
  }
  teams?: EspnTeam[]
  members?: Array<{ id?: string; displayName?: string }>
}

type PoolPlayer = {
  status?: string
  onTeamId?: number
  player?: EspnPlayer
  id?: number
}

function normalizeSwid(raw: string): string {
  let value = raw.trim()
  if (/^swid=/i.test(value)) value = value.slice(5)
  try {
    value = decodeURIComponent(value)
  } catch {
    throw new UpstreamError("SWID could not be read. Paste the cookie value only.", 400)
  }
  value = value.replace(/^"+|"+$/g, "")
  if (/^[0-9a-f-]{36}$/i.test(value)) value = `{${value}}`
  return value
}

function normalizeEspnS2(raw: string): string {
  let value = raw.trim()
  if (/^espn_s2=/i.test(value)) value = value.slice(8)
  value = value.replace(/^"+|"+$/g, "")
  return value
}

function assertCookie(value: string, label: string) {
  if (/[\r\n;]/.test(value)) {
    throw new UpstreamError(`${label} has extra cookie text. Paste only the value.`, 400)
  }
}

function mapInjury(raw: string | undefined): { injury: EvalPlayer["injury"]; label: string | null } {
  if (!raw || raw === "ACTIVE" || raw === "PROBABLE" || raw === "NORMAL") {
    return { injury: "healthy", label: null }
  }
  const value = raw.toLowerCase()
  if (value.includes("question")) return { injury: "questionable", label: "Questionable" }
  if (value.includes("doubt")) return { injury: "doubtful", label: "Doubtful" }
  if (value.includes("suspend")) return { injury: "suspended", label: "Suspended" }
  if (value.includes("reserve") || value.includes("pup") || value === "ir") {
    return { injury: "ir", label: "IR" }
  }
  if (value.includes("out")) return { injury: "out", label: "Out" }
  return { injury: "healthy", label: raw }
}

function weekPoints(stats: EspnStat[] | undefined, week: number, source: number): number | null {
  const row = stats?.find(
    (stat) =>
      stat.scoringPeriodId === week &&
      stat.statSourceId === source &&
      stat.statSplitTypeId === 1 &&
      typeof stat.appliedTotal === "number",
  )
  return row?.appliedTotal == null ? null : round1(row.appliedTotal)
}

function recentFrom(stats: EspnStat[] | undefined, scoredWeek: number) {
  const values: number[] = []
  for (let week = scoredWeek; week >= Math.max(1, scoredWeek - 2); week -= 1) {
    const points = weekPoints(stats, week, 0)
    if (points != null) values.push(points)
  }
  if (!values.length) return { average: null as number | null, weeks: 0 }
  return {
    average: round1(values.reduce((sum, value) => sum + value, 0) / values.length),
    weeks: values.length,
  }
}

function starterSlots(counts: Record<string, number> | undefined): string[] {
  const slots: string[] = []
  const used = new Set<number>()
  for (const id of SLOT_ORDER) {
    const count = counts?.[String(id)] ?? 0
    if (count <= 0) continue
    used.add(id)
    const name = SLOT_NAME[id]
    if (!name) continue
    for (let index = 0; index < count; index += 1) slots.push(name)
  }
  for (const [key, count] of Object.entries(counts ?? {})) {
    const id = Number(key)
    if (used.has(id) || count <= 0 || id === 20 || id === 21 || id === 22) continue
    const name = SLOT_NAME[id]
    if (!name) continue
    for (let index = 0; index < count; index += 1) slots.push(name)
  }
  return slots
}

async function espnGet<T>(url: string, cookie: string | null, filter?: unknown): Promise<T> {
  if (typeof window !== "undefined" && cookie) {
    throw new UpstreamError(
      "Leave the ESPN cookie fields blank for a public league. A private league's cookies have to be forwarded by a server, and this host opens the league on the phone.",
      400,
    )
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  }
  if (cookie) headers.Cookie = cookie
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter)
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(25000),
  })
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamError(
      "ESPN refused these cookies. Copy fresh espn_s2 and SWID values from a browser where you are already logged in. This app never asks for your ESPN password.",
      401,
    )
  }
  if (response.status === 404) {
    throw new UpstreamError("ESPN could not find that league for the season you entered.", 404)
  }
  if (!response.ok) {
    throw new UpstreamError("ESPN did not return league data. Check the league id, season, and cookies.", 502)
  }
  return readJson<T>(response)
}

function sameOwner(owner: string | undefined, swid: string): boolean {
  if (!owner || !swid) return false
  return owner.replace(/[{}]/g, "").toLowerCase() === swid.replace(/[{}]/g, "").toLowerCase()
}

function ownsTeam(team: EspnTeam, swid: string): boolean {
  if (!swid) return false
  if (sameOwner(team.primaryOwner, swid)) return true
  return (team.owners ?? []).some((owner) => sameOwner(owner, swid))
}

export async function espnAdvice(input: {
  leagueId: string
  season: number
  espnS2: string
  swid: string
  teamId?: number | null
}): Promise<AdviceResult> {
  if (!/^\d{1,12}$/.test(input.leagueId)) {
    throw new UpstreamError("Enter the numeric ESPN league id.", 400)
  }
  if (!Number.isInteger(input.season) || input.season < 2018 || input.season > 2035) {
    throw new UpstreamError("Enter an NFL season between 2018 and 2035.", 400)
  }
  const espnS2 = input.espnS2 ? normalizeEspnS2(input.espnS2) : ""
  const swid = input.swid ? normalizeSwid(input.swid) : ""
  if (espnS2) assertCookie(espnS2, "espn_s2")
  if (swid) assertCookie(swid, "SWID")
  const cookie = espnS2 || swid ? `espn_s2=${espnS2}; SWID=${swid}` : null
  const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${input.season}/segments/0/leagues/${input.leagueId}`
  const league = await espnGet<EspnLeague>(`${base}?view=mTeam&view=mRoster&view=mSettings`, cookie)
  const teams = league.teams ?? []
  if (!teams.length) {
    throw new UpstreamError("ESPN returned the league without teams.", 502)
  }
  let team = input.teamId ? teams.find((item) => item.id === input.teamId) : undefined
  if (!team) {
    const matched = swid ? teams.filter((item) => ownsTeam(item, swid)) : []
    if (matched.length === 1) team = matched[0]
    else {
      return {
        kind: "teams",
        leagueName: league.settings?.name || "ESPN league",
        teams: teams.map((item) => {
          const overall = item.record?.overall
          return {
            id: String(item.id),
            name: item.name || item.abbrev || `Team ${item.id}`,
            recordLabel: recordLabel(overall?.wins ?? 0, overall?.losses ?? 0, overall?.ties ?? 0),
          }
        }),
      }
    }
  }
  if (!team) throw new UpstreamError("That team is not in this ESPN league.", 404)
  const advice = await buildAdvice(base, cookie, league, team, input.season)
  return { kind: "advice", advice }
}

async function buildAdvice(
  base: string,
  cookie: string | null,
  league: EspnLeague,
  team: EspnTeam,
  season: number,
): Promise<ManagerAdvice> {
  const warnings: string[] = []
  const state = await nflState().catch(() => ({
    season,
    week: league.status?.currentMatchupPeriod ?? league.scoringPeriodId ?? 1,
    scoredWeek: Math.max(1, (league.status?.currentMatchupPeriod ?? 1) - 1),
    seasonType: "regular",
  }))
  const week = league.status?.currentMatchupPeriod || state.week
  const scoredWeek = state.scoredWeek
  const [teamsById, byes, opponents, waiverPool, freePool] = await Promise.all([
    teamAbbreviations().catch(() => {
      warnings.push("NFL team abbreviations did not load, so bye weeks may be missing.")
      return new Map<number, string>()
    }),
    byeWeekMap(season).catch(() => {
      warnings.push("Bye weeks did not load, so bye replacements may be missing.")
      return new Map<string, number>()
    }),
    opponentByTeam(season, week).catch(() => new Map<string, string>()),
    espnGet<{ players?: PoolPlayer[] }>(`${base}?view=kona_player_info&scoringPeriodId=${week}`, cookie, {
      players: {
        filterStatus: { value: ["WAIVERS"] },
        limit: 40,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    }).catch(() => {
      warnings.push("The waiver pool did not load.")
      return { players: [] }
    }),
    espnGet<{ players?: PoolPlayer[] }>(`${base}?view=kona_player_info&scoringPeriodId=${week}`, cookie, {
      players: {
        filterStatus: { value: ["FREEAGENT"] },
        limit: 30,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    }).catch(() => {
      warnings.push("Free agents did not load.")
      return { players: [] }
    }),
  ])

  const slots = starterSlots(league.settings?.rosterSettings?.lineupSlotCounts)
  const counts = league.settings?.rosterSettings?.lineupSlotCounts ?? {}
  const rosterCap = Object.entries(counts)
    .filter(([slot]) => slot !== "21" && slot !== "22")
    .reduce((sum, [, count]) => sum + count, 0)

  const make = (
    id: string,
    player: EspnPlayer | undefined,
    extras: Partial<EvalPlayer>,
  ): EvalPlayer => {
    const position = POSITION_NAME[player?.defaultPositionId ?? -1] ?? "?"
    const nflTeam = player?.proTeamId != null ? (teamsById.get(player.proTeamId) ?? null) : null
    const bye = byeWeekFor(byes, nflTeam)
    const injury = mapInjury(player?.injuryStatus)
    const recent = recentFrom(player?.stats, scoredWeek)
    const owned = player?.ownership?.percentOwned
    const made: EvalPlayer = {
      id,
      name: player?.fullName || `Player ${id}`,
      position,
      team: nflTeam,
      injury: injury.injury,
      injuryLabel: injury.label,
      onBye: bye === week,
      byeWeek: bye,
      projection: null,
      recentAverage: recent.average,
      recentWeeks: recent.weeks,
      slot: null,
      availability: "free",
      ownedPercent: typeof owned === "number" ? owned : null,
      searchRank: null,
      starter: false,
      canStart: true,
      opponent: opponentFor(opponents, nflTeam),
      harrisRank: null,
      seasonRank: null,
      ...extras,
    }
    made.harrisRank = null
    made.seasonRank = null
    return made
  }

  const rosterPlayers: EvalPlayer[] = []
  const rostered = new Set<string>()
  for (const entry of team.roster?.entries ?? []) {
    const player = entry.playerPoolEntry?.player
    const numericId = String(entry.playerId ?? player?.id ?? "")
    if (!numericId) continue
    rostered.add(numericId)
    const slotId = entry.lineupSlotId ?? 20
    const onReserve = slotId === 21
    const slot = onReserve ? "IR" : slotId === 20 ? "BN" : SLOT_NAME[slotId] ?? "START"
    rosterPlayers.push(
      make(numericId, player, {
        availability: "rostered",
        starter: !onReserve && slotId !== 20,
        canStart: !onReserve,
        slot,
      }),
    )
  }

  const available: EvalPlayer[] = []
  const pushPool = (rows: PoolPlayer[] | undefined, availability: "waiver" | "free") => {
    for (const row of rows ?? []) {
      const player = row.player
      const id = String(player?.id ?? row.id ?? "")
      if (!id || rostered.has(id)) continue
      const position = POSITION_NAME[player?.defaultPositionId ?? -1]
      if (!position) continue
      available.push(make(id, player, { availability }))
    }
  }
  pushPool(waiverPool.players, "waiver")
  pushPool(freePool.players, "free")

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
  for (const player of rosterPlayers) assignRanks(player, board)
  for (const player of available) assignRanks(player, board)
  const tradeOpponents = (league.teams ?? [])
    .filter((item) => item.id !== team.id)
    .map((item) => ({
      teamName: item.name || item.abbrev || `Team ${item.id}`,
      players: (item.roster?.entries ?? []).map((entry) => {
        const player = entry.playerPoolEntry?.player
        const id = String(entry.playerId ?? player?.id ?? "")
        const made = make(id, player, { availability: "rostered" as const, canStart: true })
        assignRanks(made, board)
        return made
      }).filter((player) => player.id),
    }))
    .filter((item) => item.players.length > 0)

  const activeCount = rosterPlayers.filter((player) => player.canStart).length
  const acquisition = league.settings?.acquisitionSettings
  const useFaab = Boolean(acquisition?.isUsingAcquisitionBudget)
  const playoffSpots = league.settings?.scheduleSettings?.playoffTeamCount ?? null
  const adviceCore = recommend({
    week,
    starterSlots: slots,
    roster: rosterPlayers,
    available,
    rosterFull: rosterCap > 0 && activeCount >= rosterCap,
    faabRemaining: null,
    useFaab,
    ranksLoaded: board != null,
    seasonPositions: board?.seasonPositions ?? [],
    opponents: tradeOpponents,
  })

  const ranked = rankStandings(
    (league.teams ?? []).map((item) => {
      const overall = item.record?.overall
      return {
        id: String(item.id),
        name: item.name || item.abbrev || `Team ${item.id}`,
        wins: overall?.wins ?? 0,
        losses: overall?.losses ?? 0,
        ties: overall?.ties ?? 0,
        pointsFor: round1(overall?.pointsFor ?? item.points ?? 0),
        gamesBack: typeof overall?.gamesBack === "number" ? overall.gamesBack : null,
      }
    }),
    playoffSpots,
  )
  const mine = ranked.find((row) => row.id === String(team.id))
  let note = mine ? standingNote(mine, playoffSpots, "standard") : "Standings did not include this team."
  if (team.eliminated) note = `ESPN has this team eliminated. ${note}`

  const arranged = arrangeRoster(slots, rosterPlayers)

  if (useFaab) {
    warnings.push("This league uses FAAB. ESPN did not include the remaining budget, so claims are not given a dollar bid.")
  }

  const waiverLabel = useFaab
    ? `FAAB, $${acquisition?.acquisitionBudget ?? 0} budget`
    : acquisition?.acquisitionType === "FREEAGENCY"
      ? "Free agency"
      : "Waivers"

  return {
    platform: "espn",
    league: {
      id: base.split("/").pop() ?? "",
      name: league.settings?.name || "ESPN league",
      season,
      week,
      scoredWeek,
      teamCount: league.settings?.size ?? league.teams?.length ?? 0,
      playoffSpots,
      scoringLabel: "League scoring",
      waiverLabel,
      mode: "standard",
    },
    team: {
      id: String(team.id),
      name: team.name || team.abbrev || `Team ${team.id}`,
      recordLabel: mine?.recordLabel ?? recordLabel(0, 0, 0),
      wins: mine?.wins ?? 0,
      losses: mine?.losses ?? 0,
      ties: mine?.ties ?? 0,
      pointsFor: mine?.pointsFor ?? 0,
      rank: mine?.rank ?? 0,
      inPlayoffSpot: mine?.inPlayoffSpot ?? false,
      standingNote: note,
      faabRemaining: null,
      waiverPosition: team.waiverRank ?? null,
    },
    standings: ranked.map((row) => ({ ...row, isUser: row.id === String(team.id) })),
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
