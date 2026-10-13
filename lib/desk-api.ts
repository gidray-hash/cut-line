import type { AdviceResult, SleeperConnectResult } from "./types"

const direct = process.env.NEXT_PUBLIC_DIRECT === "1"

export const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error || "That request failed.")
  return data
}

export function registerDeskWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  const scope = publicBase ? `${publicBase}/` : "/"
  navigator.serviceWorker.register(`${publicBase}/sw.js`, { scope }).catch(() => undefined)
}

export async function loadNflState(): Promise<{ season?: number; week?: number } | null> {
  if (direct) {
    const { nflState } = await import("./nfl")
    const state = await nflState()
    return { season: state.season, week: state.week }
  }
  const response = await fetch("/api/nfl")
  if (!response.ok) return null
  return (await response.json()) as { season?: number; week?: number }
}

export async function loadHarrisMeta(): Promise<{
  week: number | null
  updated: string | null
  seasonWeek: number | null
  seasonUpdated: string | null
  seasonLabel: string | null
} | null> {
  if (direct) {
    const { harrisBoard, harrisMeta } = await import("./harris")
    return harrisMeta(await harrisBoard())
  }
  const response = await fetch("/api/harris")
  if (!response.ok) return null
  return (await response.json()) as {
    week: number | null
    updated: string | null
    seasonWeek: number | null
    seasonUpdated: string | null
    seasonLabel: string | null
  }
}

export async function connectSleeperUser(username: string): Promise<SleeperConnectResult> {
  if (direct) {
    const { connectSleeper } = await import("./sleeper")
    return connectSleeper(username)
  }
  return postJson<SleeperConnectResult>("/api/sleeper/connect", { username })
}

export async function loadSleeperAdvice(body: {
  leagueId: string
  userId: string
  rosterId?: number | null
}): Promise<AdviceResult> {
  if (direct) {
    const { sleeperAdvice } = await import("./sleeper")
    return sleeperAdvice({
      leagueId: body.leagueId,
      userId: body.userId,
      rosterId: body.rosterId ?? null,
    })
  }
  return postJson<AdviceResult>("/api/sleeper/advice", body)
}

export async function loadEspnAdvice(body: {
  leagueId: string
  season: number
  espnS2: string
  swid: string
  teamId?: number | null
}): Promise<AdviceResult> {
  if (direct) {
    const { espnAdvice } = await import("./espn")
    return espnAdvice({
      leagueId: body.leagueId,
      season: body.season,
      espnS2: body.espnS2,
      swid: body.swid,
      teamId: body.teamId ?? null,
    })
  }
  return postJson<AdviceResult>("/api/espn/advice", body)
}
