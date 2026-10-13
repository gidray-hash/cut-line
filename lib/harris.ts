const WEEKLY_PAGES = [
  { position: "QB", url: "https://www.harrisfootball.com/ranks" },
  { position: "RB", url: "https://www.harrisfootball.com/rb-ranks" },
  { position: "WR", url: "https://www.harrisfootball.com/wr-ranks" },
  { position: "TE", url: "https://www.harrisfootball.com/te-ranks" },
  { position: "DEF", url: "https://www.harrisfootball.com/def-ranks" },
] as const

const SEASON_URL = "https://www.harrisfootball.com/ros-ranks"
const FRESH_MS = 20 * 60 * 60 * 1000
const CACHE_FILE = "harris-cache.json"

function nodeImport<T>(specifier: string): Promise<T> {
  const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<T>
  return load(specifier)
}

const TEAM_ABBR: Record<string, string> = {
  "arizona cardinals": "ARI",
  cardinals: "ARI",
  "atlanta falcons": "ATL",
  falcons: "ATL",
  "baltimore ravens": "BAL",
  ravens: "BAL",
  "buffalo bills": "BUF",
  bills: "BUF",
  "carolina panthers": "CAR",
  panthers: "CAR",
  "chicago bears": "CHI",
  bears: "CHI",
  "cincinnati bengals": "CIN",
  bengals: "CIN",
  "cleveland browns": "CLE",
  browns: "CLE",
  "dallas cowboys": "DAL",
  cowboys: "DAL",
  "denver broncos": "DEN",
  broncos: "DEN",
  "detroit lions": "DET",
  lions: "DET",
  "green bay packers": "GB",
  packers: "GB",
  "houston texans": "HOU",
  texans: "HOU",
  "indianapolis colts": "IND",
  colts: "IND",
  "jacksonville jaguars": "JAX",
  jaguars: "JAX",
  "kansas city chiefs": "KC",
  chiefs: "KC",
  "las vegas raiders": "LV",
  raiders: "LV",
  "los angeles chargers": "LAC",
  chargers: "LAC",
  "los angeles rams": "LAR",
  rams: "LAR",
  "miami dolphins": "MIA",
  dolphins: "MIA",
  "minnesota vikings": "MIN",
  vikings: "MIN",
  "new england patriots": "NE",
  patriots: "NE",
  "new orleans saints": "NO",
  saints: "NO",
  "new york giants": "NYG",
  giants: "NYG",
  "new york jets": "NYJ",
  jets: "NYJ",
  "philadelphia eagles": "PHI",
  eagles: "PHI",
  "pittsburgh steelers": "PIT",
  steelers: "PIT",
  "san francisco 49ers": "SF",
  "49ers": "SF",
  "seattle seahawks": "SEA",
  seahawks: "SEA",
  "tampa bay buccaneers": "TB",
  buccaneers: "TB",
  "tennessee titans": "TEN",
  titans: "TEN",
  "washington commanders": "WAS",
  commanders: "WAS",
}

export class HarrisAccessError extends Error {
  readonly url: string
  readonly status: number | null

  constructor(message: string, url: string, status: number | null) {
    super(message)
    this.name = "HarrisAccessError"
    this.url = url
    this.status = status
  }
}

export type HarrisBoard = {
  week: number | null
  updated: string | null
  seasonWeek: number | null
  seasonUpdated: string | null
  seasonLabel: string | null
  weekly: Map<string, number>
  season: Map<string, number>
  seasonPositions: string[]
  counts: { weekly: Record<string, number>; season: number }
  fetchedAt: string
}

type CacheFile = {
  week: number | null
  updated: string | null
  seasonWeek: number | null
  seasonUpdated: string | null
  seasonLabel: string | null
  weekly: [string, number][]
  season: [string, number][]
  seasonPositions: string[]
  counts: { weekly: Record<string, number>; season: number }
  fetchedAt: string
}

let memory: HarrisBoard | null = null

export function normalizeHarrisName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function numberedRows(html: string): string[][] {
  const rows: string[][] = []
  for (const match of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...match[0].matchAll(/<td[\s\S]*?<\/td>/gi)].map((cell) => decode(cell[0]))
    if (cells.length >= 2 && /^\d+$/.test(cells[0] ?? "") && cells[1]) rows.push(cells)
  }
  return rows
}

export function scoringSlice(html: string): { html: string; mode: "ppr" | "plain" | "standard-only" } {
  const ppr = html.search(/>\s*PPR Scoring\s*</i)
  const standard = html.search(/>\s*Standard Scoring\s*</i)
  if (ppr >= 0) {
    const after = html.slice(ppr)
    const end = after.search(/<\/table>/i)
    return { html: end >= 0 ? after.slice(0, end) : after, mode: "ppr" }
  }
  if (standard >= 0) return { html: "", mode: "standard-only" }
  return { html, mode: "plain" }
}

function pageStamp(html: string): { week: number | null; updated: string | null } {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "))
  const week = text.match(/Week\s+(\d+)/i)
  const updated = text.match(/updated\s+([^)<]+)/i)
  return {
    week: week ? Number(week[1]) : null,
    updated: updated ? updated[1].trim() : null,
  }
}

function blocked(html: string, status: number, url: string): HarrisAccessError | null {
  if (status === 401 || status === 403) {
    return new HarrisAccessError(
      `Harris rankings at ${url} returned HTTP ${status}. That list is behind a login, so Cut Line stopped.`,
      url,
      status,
    )
  }
  const wall = /password protected|sqs-password|password-entry|members only/i.test(html)
  if (wall && numberedRows(scoringSlice(html).html).length === 0) {
    return new HarrisAccessError(
      `Harris rankings at ${url} are behind a login page, so Cut Line stopped before reading them.`,
      url,
      status,
    )
  }
  return null
}

export function parseWeeklyHtml(
  html: string,
  position: string,
): { ranks: Map<string, number>; mode: "ppr" | "plain" | "standard-only"; count: number } {
  const slice = scoringSlice(html)
  const ranks = new Map<string, number>()
  if (slice.mode === "standard-only") return { ranks, mode: slice.mode, count: 0 }
  const pos = position === "DST" ? "DEF" : position
  let count = 0
  for (const cells of numberedRows(slice.html)) {
    const rank = Number(cells[0])
    const name = cells[1]
    if (!name || !Number.isFinite(rank)) continue
    const key = `${pos}:${normalizeHarrisName(name)}`
    if (!ranks.has(key)) {
      ranks.set(key, rank)
      count += 1
    }
    if (pos === "DEF") {
      const abbr = TEAM_ABBR[name.toLowerCase()]
      if (abbr) ranks.set(`DEF:${normalizeHarrisName(abbr)}`, rank)
    }
  }
  return { ranks, mode: slice.mode, count }
}

export function parseSeasonHtml(html: string): { ranks: Map<string, number>; positions: string[] } {
  const slice = scoringSlice(html)
  const ranks = new Map<string, number>()
  const positions = new Set<string>()
  if (slice.mode === "standard-only") return { ranks, positions: [] }
  for (const cells of numberedRows(slice.html)) {
    const rank = Number(cells[0])
    const name = cells[1]
    const position = (cells[2] ?? "").toUpperCase().replace("DST", "DEF")
    if (!name || !Number.isFinite(rank) || !/^(QB|RB|WR|TE|K|DEF)$/.test(position)) continue
    const key = `${position}:${normalizeHarrisName(name)}`
    if (!ranks.has(key)) ranks.set(key, rank)
    positions.add(position)
  }
  return { ranks, positions: [...positions] }
}

function boardFromCache(file: CacheFile): HarrisBoard {
  return {
    week: file.week,
    updated: file.updated,
    seasonWeek: file.seasonWeek,
    seasonUpdated: file.seasonUpdated,
    seasonLabel: file.seasonLabel,
    weekly: new Map(file.weekly),
    season: new Map(file.season),
    seasonPositions: file.seasonPositions,
    counts: file.counts,
    fetchedAt: file.fetchedAt,
  }
}

function stale(board: HarrisBoard, nflWeek: number | null | undefined, force: boolean): boolean {
  if (force) return true
  const age = Date.now() - Date.parse(board.fetchedAt)
  if (!Number.isFinite(age) || age > FRESH_MS) return true
  if (nflWeek && board.week && board.week !== nflWeek) return true
  return false
}

export function toCacheFile(board: HarrisBoard): CacheFile {
  return {
    week: board.week,
    updated: board.updated,
    seasonWeek: board.seasonWeek,
    seasonUpdated: board.seasonUpdated,
    seasonLabel: board.seasonLabel,
    weekly: [...board.weekly.entries()],
    season: [...board.season.entries()],
    seasonPositions: board.seasonPositions,
    counts: board.counts,
    fetchedAt: board.fetchedAt,
  }
}

function cacheFileOk(file: CacheFile | null): file is CacheFile {
  return Boolean(file?.fetchedAt && Array.isArray(file.weekly) && Array.isArray(file.season))
}

async function readPublished(): Promise<HarrisBoard | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
    const response = await fetch(`${base}/harris.json`, { cache: "no-store" })
    if (!response.ok) return null
    const file = (await response.json()) as CacheFile
    if (!cacheFileOk(file)) return null
    return boardFromCache(file)
  } catch {
    return null
  }
}

async function readCache(): Promise<HarrisBoard | null> {
  if (typeof window !== "undefined") return readPublished()
  try {
    const fs = await nodeImport<typeof import("node:fs/promises")>("node:fs/promises")
    const path = await nodeImport<typeof import("node:path")>("node:path")
    const file = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", CACHE_FILE), "utf8")) as CacheFile
    if (!cacheFileOk(file)) return null
    return boardFromCache(file)
  } catch {
    return null
  }
}

async function writeCache(board: HarrisBoard): Promise<void> {
  if (typeof window !== "undefined") return
  const fs = await nodeImport<typeof import("node:fs/promises")>("node:fs/promises")
  const path = await nodeImport<typeof import("node:path")>("node:path")
  const target = path.join(process.cwd(), "data", CACHE_FILE)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(toCacheFile(board)))
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  })
  const html = await response.text()
  const denial = blocked(html, response.status, url)
  if (denial) throw denial
  if (!response.ok) {
    throw new Error(`Harris rankings at ${url} returned HTTP ${response.status}.`)
  }
  return html
}

async function fetchBoard(): Promise<HarrisBoard> {
  const pages = await Promise.all([
    ...WEEKLY_PAGES.map(async (page) => ({ ...page, html: await fetchPage(page.url) })),
    fetchPage(SEASON_URL).then((html) => ({ position: "ROS" as const, url: SEASON_URL, html })),
  ])
  const weekly = new Map<string, number>()
  const counts: Record<string, number> = {}
  let week: number | null = null
  let updated: string | null = null
  for (const page of pages) {
    if (page.position === "ROS") continue
    const stamp = pageStamp(page.html)
    week = week ?? stamp.week
    updated = updated ?? stamp.updated
    const parsed = parseWeeklyHtml(page.html, page.position)
    if (parsed.mode === "standard-only") {
      throw new HarrisAccessError(
        `Harris ${page.position} rankings at ${page.url} only published a standard-scoring table. Cut Line did not use it.`,
        page.url,
        200,
      )
    }
    for (const [key, rank] of parsed.ranks) {
      if (!weekly.has(key)) weekly.set(key, rank)
    }
    counts[page.position] = parsed.count
  }
  const seasonPage = pages.find((page) => page.position === "ROS")
  if (!seasonPage) throw new Error("Harris season-long ranks did not load.")
  const seasonStamp = pageStamp(seasonPage.html)
  const season = parseSeasonHtml(seasonPage.html)
  if (season.ranks.size === 0) {
    throw new HarrisAccessError(
      `Harris season-long ranks at ${SEASON_URL} did not include a public PPR list. Cut Line stopped.`,
      SEASON_URL,
      200,
    )
  }
  return {
    week,
    updated,
    seasonWeek: seasonStamp.week,
    seasonUpdated: seasonStamp.updated,
    seasonLabel: /rest of season/i.test(decode(seasonPage.html)) ? "Rest of season" : "Season",
    weekly,
    season: season.ranks,
    seasonPositions: season.positions,
    counts: { weekly: counts, season: season.ranks.size },
    fetchedAt: new Date().toISOString(),
  }
}

export async function harrisBoard(options?: { force?: boolean; nflWeek?: number | null }): Promise<HarrisBoard> {
  if (typeof window !== "undefined") {
    if (memory && !options?.force) return memory
    const cached = memory ?? (await readPublished())
    if (!cached) throw new Error("Harris PPR rankings are not on this host yet.")
    memory = cached
    return cached
  }
  const force = options?.force === true
  const nflWeek = options?.nflWeek
  if (!force && memory && !stale(memory, nflWeek, false)) return memory
  if (!force) {
    const cached = memory ?? (await readCache())
    if (cached && !stale(cached, nflWeek, false)) {
      memory = cached
      return cached
    }
  }
  try {
    const next = await fetchBoard()
    memory = next
    await writeCache(next).catch(() => undefined)
    return next
  } catch (error) {
    if (error instanceof HarrisAccessError) throw error
    const cached = memory ?? (await readCache())
    if (cached) {
      memory = cached
      return cached
    }
    throw error
  }
}

export function lookupRanks(
  board: HarrisBoard | null,
  player: { position: string; name: string; team: string | null },
): { weekly: number | null; season: number | null } {
  if (!board) return { weekly: null, season: null }
  const position = player.position === "DST" || player.position === "D/ST" ? "DEF" : player.position
  const keys = new Set<string>([`${position}:${normalizeHarrisName(player.name)}`])
  if (position === "DEF") {
    if (player.team) keys.add(`DEF:${normalizeHarrisName(player.team)}`)
    const abbr = TEAM_ABBR[player.name.toLowerCase()] ?? (player.team ? TEAM_ABBR[player.team.toLowerCase()] : undefined)
    if (abbr) keys.add(`DEF:${normalizeHarrisName(abbr)}`)
    const stripped = player.name.replace(/\b(d\/st|dst|defense)\b/gi, "").trim()
    if (stripped) keys.add(`DEF:${normalizeHarrisName(stripped)}`)
  }
  let weekly: number | null = null
  let season: number | null = null
  for (const key of keys) {
    if (weekly == null && board.weekly.has(key)) weekly = board.weekly.get(key) ?? null
    if (season == null && board.season.has(key)) season = board.season.get(key) ?? null
  }
  return { weekly, season }
}

export function assignRanks(
  player: { position: string; name: string; team: string | null; harrisRank: number | null; seasonRank: number | null },
  board: HarrisBoard | null,
): void {
  const found = lookupRanks(board, player)
  player.harrisRank = found.weekly
  player.seasonRank = found.season
}

export function harrisMeta(board: HarrisBoard) {
  return {
    week: board.week,
    updated: board.updated,
    seasonWeek: board.seasonWeek,
    seasonUpdated: board.seasonUpdated,
    seasonLabel: board.seasonLabel,
    counts: board.counts,
    fetchedAt: board.fetchedAt,
  }
}

export function startHarrisRefresh(): void {
  const flag = globalThis as typeof globalThis & { __cutlineHarrisRefresh?: boolean }
  if (flag.__cutlineHarrisRefresh) return
  flag.__cutlineHarrisRefresh = true
  const run = () => {
    void harrisBoard({ force: true }).catch(() => undefined)
  }
  run()
  setInterval(run, 24 * 60 * 60 * 1000)
}
