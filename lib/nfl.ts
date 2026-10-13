const ALIASES: Record<string, string> = {
  WSH: "WAS",
  JAC: "JAX",
  LA: "LAR",
  OAK: "LV",
  STL: "LAR",
}

export function normalizeTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null
  const upper = abbr.trim().toUpperCase()
  if (!upper || upper === "FA" || upper === "NONE") return null
  return ALIASES[upper] ?? upper
}

export type NflState = {
  season: number
  week: number
  scoredWeek: number
  seasonType: string
}

type SleeperState = {
  week?: number
  display_week?: number
  season?: string
  season_type?: string
  league_season?: string
}

let stateCache: { at: number; value: NflState } | null = null
let byeCache: { at: number; season: number; value: Map<string, number> } | null = null
let teamCache: { at: number; value: Map<number, string> } | null = null

const SIX_HOURS = 6 * 60 * 60 * 1000

export async function nflState(): Promise<NflState> {
  if (stateCache && Date.now() - stateCache.at < 10 * 60 * 1000) return stateCache.value
  const response = await fetch("https://api.sleeper.app/v1/state/nfl", {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error("The NFL calendar could not be loaded from Sleeper.")
  const body = (await response.json()) as SleeperState
  const season = Number(body.league_season ?? body.season ?? 2026)
  const week = Number(body.week ?? 1)
  const scoredWeek = Number(body.display_week ?? Math.max(1, week - 1))
  const value: NflState = {
    season: Number.isFinite(season) ? season : 2026,
    week: Number.isFinite(week) ? week : 1,
    scoredWeek: Number.isFinite(scoredWeek) ? scoredWeek : 1,
    seasonType: body.season_type ?? "regular",
  }
  stateCache = { at: Date.now(), value }
  return value
}

export async function teamAbbreviations(): Promise<Map<number, string>> {
  if (teamCache && Date.now() - teamCache.at < SIX_HOURS) return teamCache.value
  const response = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40",
    { cache: "no-store", signal: AbortSignal.timeout(15000) },
  )
  if (!response.ok) throw new Error("NFL team abbreviations could not be loaded.")
  const body = (await response.json()) as {
    sports?: Array<{
      leagues?: Array<{
        teams?: Array<{ team?: { id?: string; abbreviation?: string } }>
      }>
    }>
  }
  const map = new Map<number, string>()
  for (const sport of body.sports ?? []) {
    for (const league of sport.leagues ?? []) {
      for (const entry of league.teams ?? []) {
        const id = Number(entry.team?.id)
        const abbr = normalizeTeam(entry.team?.abbreviation)
        if (Number.isFinite(id) && abbr) map.set(id, abbr)
      }
    }
  }
  if (!map.size) throw new Error("NFL team abbreviations came back empty.")
  teamCache = { at: Date.now(), value: map }
  return map
}

function remember(map: Map<string, number>, abbr: string | undefined, week: number) {
  const normalized = normalizeTeam(abbr)
  if (!normalized) return
  map.set(normalized, week)
  if (abbr) map.set(abbr.toUpperCase(), week)
}

export async function byeWeekMap(season: number): Promise<Map<string, number>> {
  if (byeCache && byeCache.season === season && Date.now() - byeCache.at < SIX_HOURS) {
    return byeCache.value
  }
  const weeks = Array.from({ length: 14 }, (_, index) => index + 1)
  const map = new Map<string, number>()
  await Promise.all(
    weeks.map(async (week) => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) })
      if (!response.ok) return
      const body = (await response.json()) as {
        week?: { teamsOnBye?: Array<{ abbreviation?: string }> }
      }
      for (const team of body.week?.teamsOnBye ?? []) {
        remember(map, team.abbreviation, week)
      }
    }),
  )
  byeCache = { at: Date.now(), season, value: map }
  return map
}

let opponentCache: { at: number; key: string; value: Map<string, string> } | null = null

export async function opponentByTeam(season: number, week: number): Promise<Map<string, string>> {
  const key = `${season}:${week}`
  if (opponentCache && opponentCache.key === key && Date.now() - opponentCache.at < 10 * 60 * 1000) {
    return opponentCache.value
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) })
  const map = new Map<string, string>()
  if (!response.ok) return map
  const body = (await response.json()) as {
    events?: Array<{
      competitions?: Array<{
        competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }>
      }>
    }>
  }
  for (const event of body.events ?? []) {
    const competitors = event.competitions?.[0]?.competitors ?? []
    const home = normalizeTeam(competitors.find((row) => row.homeAway === "home")?.team?.abbreviation)
    const away = normalizeTeam(competitors.find((row) => row.homeAway === "away")?.team?.abbreviation)
    if (!home || !away) continue
    map.set(home, away)
    map.set(away, home)
  }
  opponentCache = { at: Date.now(), key, value: map }
  return map
}

export function opponentFor(map: Map<string, string>, team: string | null): string | null {
  if (!team) return null
  const normalized = normalizeTeam(team)
  if (!normalized) return null
  return map.get(normalized) ?? null
}

export function byeWeekFor(map: Map<string, number>, team: string | null): number | null {
  if (!team) return null
  const normalized = normalizeTeam(team)
  if (!normalized) return null
  return map.get(normalized) ?? map.get(team.toUpperCase()) ?? null
}
