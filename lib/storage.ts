import type { Platform } from "./types"

export type SleeperLink = {
  username: string
  userId: string
  displayName: string
  avatar: string | null
  leagueId: string
  leagueName: string
  rosterId: number
}

export type EspnLink = {
  leagueId: string
  season: number
  espnS2: string
  swid: string
  teamId: number
  teamName: string
  leagueName: string
}

export type StoredConnections = {
  version: 1
  active: Platform | null
  sleeper: SleeperLink | null
  espn: EspnLink | null
}

const KEY = "cut-line.connection.v1"

export const emptyConnections: StoredConnections = {
  version: 1,
  active: null,
  sleeper: null,
  espn: null,
}

export function readConnections(): StoredConnections {
  if (typeof window === "undefined") return emptyConnections
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return emptyConnections
    const parsed = JSON.parse(raw) as StoredConnections
    if (parsed.version !== 1) return emptyConnections
    return {
      version: 1,
      active: parsed.active === "sleeper" || parsed.active === "espn" ? parsed.active : null,
      sleeper: parsed.sleeper ?? null,
      espn: parsed.espn ?? null,
    }
  } catch {
    return emptyConnections
  }
}

export function writeConnections(value: StoredConnections) {
  window.localStorage.setItem(KEY, JSON.stringify(value))
}
