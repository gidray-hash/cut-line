import type {
  AdvicePlayer,
  Claim,
  DropPick,
  EvalPlayer,
  FreeAgentPick,
  RosterSlot,
  TradeSuggestion,
} from "./types"

export const METHOD =
  "Start/sit follows Christopher Harris weekly PPR rank. The better weekly rank plays, and a worse rank sits. Waiver claims, free agents, drops, and trades follow his season-long ranks. A better season-long rank is the player to add or hold. An unranked player stays unranked. No projection is used."

const SPECIFIC = new Set(["QB", "RB", "WR", "TE", "K", "DEF"])

export function canPlay(position: string, slot: string): boolean {
  const pos = position === "DST" ? "DEF" : position
  const normalized = slot === "DST" || slot === "D/ST" ? "DEF" : slot
  if (normalized === "FLEX" || normalized === "RB/WR/TE") {
    return pos === "RB" || pos === "WR" || pos === "TE"
  }
  if (normalized === "TQB" || normalized === "QB") return pos === "QB" || pos === "TQB"
  if (normalized === "SUPER_FLEX" || normalized === "OP") {
    return pos === "QB" || pos === "TQB" || pos === "RB" || pos === "WR" || pos === "TE"
  }
  if (normalized === "REC_FLEX" || normalized === "WR/TE") {
    return pos === "WR" || pos === "TE"
  }
  if (normalized === "WRRB_FLEX" || normalized === "RB/WR") {
    return pos === "RB" || pos === "WR"
  }
  if (normalized === "DEF") return pos === "DEF"
  return pos === normalized
}

function specificity(slot: string): number {
  if (SPECIFIC.has(slot) || slot === "D/ST" || slot === "DST") return 0
  if (slot === "SUPER_FLEX" || slot === "OP") return 2
  if (slot === "TQB") return 0
  return 1
}

function displaySlot(slot: string): string {
  if (slot === "DEF") return "D/ST"
  if (slot === "SUPER_FLEX") return "SF"
  return slot
}

function byRank(rank: (player: EvalPlayer) => number | null) {
  return (a: EvalPlayer, b: EvalPlayer) => {
    const left = rank(a)
    const right = rank(b)
    if (left == null && right == null) return a.name.localeCompare(b.name)
    if (left == null) return 1
    if (right == null) return -1
    return left - right || a.name.localeCompare(b.name)
  }
}

const byWeekly = byRank((player) => player.harrisRank)
const bySeason = byRank((player) => player.seasonRank)

function usable(player: EvalPlayer): boolean {
  return (
    player.canStart &&
    !player.onBye &&
    player.injury !== "out" &&
    player.injury !== "ir" &&
    player.injury !== "suspended" &&
    player.injury !== "doubtful"
  )
}

export function toAdvicePlayer(player: EvalPlayer): AdvicePlayer {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    nflTeam: player.team,
    slot: player.slot,
    injury: player.injuryLabel,
    byeWeek: player.byeWeek,
    onBye: player.onBye,
    projection: null,
    recentAverage: null,
    recentWeeks: player.recentWeeks,
    score: null,
    opponent: player.opponent,
    harrisRank: player.harrisRank,
    seasonRank: player.seasonRank,
  }
}

export function arrangeRoster(starterSlots: string[], roster: EvalPlayer[]): {
  starters: RosterSlot[]
  bench: RosterSlot[]
  reserve: RosterSlot[]
} {
  const reserve = roster.filter((player) => !player.canStart)
  const active = roster.filter((player) => player.canStart)
  const pool = active.filter(usable).sort(byWeekly)
  const used = new Set<string>()
  const picks = new Map<number, EvalPlayer>()
  const ordered = starterSlots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => specificity(a.slot) - specificity(b.slot) || a.index - b.index)
  for (const entry of ordered) {
    const pick = pool.find((player) => !used.has(player.id) && canPlay(player.position, entry.slot))
    if (!pick) continue
    used.add(pick.id)
    picks.set(entry.index, pick)
  }
  return {
    starters: starterSlots.map((slot, index) => ({
      slot: displaySlot(slot),
      player: picks.has(index) ? { ...toAdvicePlayer(picks.get(index)!), slot: displaySlot(slot) } : null,
    })),
    bench: active
      .filter((player) => !used.has(player.id))
      .sort(byWeekly)
      .map((player) => ({ slot: "BN", player: { ...toAdvicePlayer(player), slot: "BN" } })),
    reserve: reserve.map((player) => {
      const slot = player.slot === "TAXI" ? "TAXI" : "IR"
      return { slot, player: { ...toAdvicePlayer(player), slot } }
    }),
  }
}

export function lineupHoles(slots: string[], roster: EvalPlayer[]): string[] {
  const pool = roster.filter(usable).sort(byWeekly)
  const used = new Set<string>()
  const holes: string[] = []
  const ordered = [...slots].sort((a, b) => specificity(a) - specificity(b))
  for (const slot of ordered) {
    const pick = pool.find((player) => !used.has(player.id) && canPlay(player.position, slot))
    if (pick) used.add(pick.id)
    else holes.push(slot === "D/ST" || slot === "DST" ? "DEF" : slot)
  }
  return holes
}

function seasonCore(slots: string[], roster: EvalPlayer[]): Set<string> {
  const pool = roster.filter((player) => player.canStart && player.seasonRank != null).sort(bySeason)
  const used = new Set<string>()
  const ordered = [...slots].sort((a, b) => specificity(a) - specificity(b))
  for (const slot of ordered) {
    const pick = pool.find((player) => !used.has(player.id) && canPlay(player.position, slot))
    if (pick) used.add(pick.id)
  }
  return used
}

function rankText(player: EvalPlayer): string {
  if (player.harrisRank == null && player.seasonRank == null) return `Harris has ${player.name} unranked`
  const weekly = player.harrisRank == null ? "weekly unranked" : `weekly ${player.harrisRank}`
  const season = player.seasonRank == null ? "season-long unranked" : `season-long ${player.seasonRank}`
  return `Harris has ${player.name} ${weekly} and ${season}`
}

function seasonGap(add: EvalPlayer, drop: EvalPlayer | null): string | null {
  if (add.seasonRank == null) return null
  if (!drop) return `${add.name} is season-long ${add.seasonRank}.`
  if (drop.seasonRank == null) {
    return `${add.name} is season-long ${add.seasonRank}. Harris has ${drop.name} unranked.`
  }
  const gap = drop.seasonRank - add.seasonRank
  if (gap <= 0) return null
  return `Harris season-long rank has ${add.name} at ${add.seasonRank}, ${gap} spot${gap === 1 ? "" : "s"} ahead of ${drop.name} at ${drop.seasonRank}.`
}

function blockedAdd(player: EvalPlayer): boolean {
  return (
    player.onBye ||
    player.injury === "out" ||
    player.injury === "ir" ||
    player.injury === "suspended"
  )
}

export type RecommendInput = {
  week: number
  starterSlots: string[]
  roster: EvalPlayer[]
  available: EvalPlayer[]
  rosterFull: boolean
  faabRemaining: number | null
  useFaab: boolean
  ranksLoaded: boolean
  seasonPositions: string[]
  opponents?: { teamName: string; players: EvalPlayer[] }[]
}

export type RecommendResult = {
  claims: Claim[]
  freeAgents: FreeAgentPick[]
  drops: DropPick[]
  trades: TradeSuggestion[]
  holes: string[]
  method: string
}

function chooseDrop(add: EvalPlayer, roster: EvalPlayer[], keep: Set<string>): EvalPlayer | null {
  const unprotected = roster.filter((player) => !keep.has(player.id) && player.canStart)
  const same = unprotected.filter((player) => player.position === add.position)
  const pool = (same.length ? same : unprotected).sort((a, b) => {
    if (a.seasonRank == null && b.seasonRank == null) return 0
    if (a.seasonRank == null) return 1
    if (b.seasonRank == null) return -1
    return b.seasonRank - a.seasonRank
  })
  return pool[0] ?? null
}

function betterSeason(add: number | null, drop: number | null): boolean {
  if (add == null) return false
  if (drop == null) return true
  return add < drop
}

function claimReason(add: EvalPlayer, drop: EvalPlayer | null, holes: string[], week: number): string {
  if (add.seasonRank == null && add.harrisRank == null) {
    return `Harris has ${add.name} unranked.`
  }
  const bits = [rankText(add) + "."]
  const hole = holes.find((slot) => canPlay(add.position, slot))
  if (hole) bits.push(`The week ${week} lineup is short a healthy ${hole}.`)
  const gap = seasonGap(add, drop)
  if (gap) bits.push(gap)
  if (drop) bits.push(`Drop ${drop.name}.`)
  else bits.push("An open roster spot means no drop.")
  return bits.join(" ")
}

export function recommend(input: RecommendInput): RecommendResult {
  const holes = lineupHoles(input.starterSlots, input.roster)
  const keep = seasonCore(input.starterSlots, input.roster)
  const seen = new Set<string>()
  const available = input.available.filter((player) => {
    if (player.availability === "rostered" || seen.has(player.id)) return false
    seen.add(player.id)
    return true
  })
  const ranked = available.filter((player) => player.seasonRank != null).sort(bySeason)
  const claims: Claim[] = []
  const freeAgents: FreeAgentPick[] = []

  if (input.ranksLoaded) {
    for (const add of ranked) {
      if (claims.length >= 5 && freeAgents.length >= 6) break
      if (blockedAdd(add)) continue
      if (!input.starterSlots.some((slot) => canPlay(add.position, slot))) continue
      const drop = input.rosterFull ? chooseDrop(add, input.roster, keep) : null
      if (input.rosterFull && !drop) continue
      if (!betterSeason(add.seasonRank, drop?.seasonRank ?? null)) continue
      const fills = holes.some((slot) => canPlay(add.position, slot))
      if (!fills && drop?.seasonRank != null && add.seasonRank != null && drop.seasonRank - add.seasonRank < 1) continue
      if (add.availability === "waiver" && claims.length < 5) {
        claims.push({
          rank: claims.length + 1,
          add: toAdvicePlayer(add),
          drop: drop ? toAdvicePlayer(drop) : null,
          reason: claimReason(add, drop, holes, input.week),
          bidHint: input.useFaab ? "FAAB league. Bid off the season-long rank gap." : null,
        })
      }
      if (add.availability === "free" && freeAgents.length < 6 && !claims.some((claim) => claim.add.id === add.id)) {
        freeAgents.push({
          rank: freeAgents.length + 1,
          player: toAdvicePlayer(add),
          suggestedDrop: drop ? toAdvicePlayer(drop) : null,
          reason: `${claimReason(add, drop, holes, input.week)} ${add.name} is unlocked, so this add does not require a waiver claim.`.trim(),
        })
      }
    }
  }

  const anySeason = input.roster.some((player) => player.seasonRank != null)
  const drops: DropPick[] =
    input.ranksLoaded && (anySeason || input.seasonPositions.length > 0)
      ? input.roster
          .filter((player) => player.canStart && !keep.has(player.id))
          .sort((a, b) => {
            if (a.seasonRank == null && b.seasonRank == null) return a.name.localeCompare(b.name)
            if (a.seasonRank == null) return 1
            if (b.seasonRank == null) return -1
            return b.seasonRank - a.seasonRank
          })
          .slice(0, 5)
          .map((player, index) => {
            const tone: "clear" | "if-needed" =
              player.seasonRank == null || player.seasonRank >= 60 ? "clear" : "if-needed"
            const status =
              player.injury === "out" || player.injury === "ir" || player.injury === "suspended"
                ? ` ${player.name} is ${player.injuryLabel ?? "unavailable"}, and the season-long rank is still the reason.`
                : player.onBye
                  ? ` ${player.name} is on bye. The bye is not the cut. The season-long rank is.`
                  : ""
            return {
              rank: index + 1,
              player: toAdvicePlayer(player),
              reason: `${rankText(player)}. ${
                player.seasonRank == null
                  ? "Harris has him unranked, so there is no season-long rank worth holding."
                  : `Season-long ${player.seasonRank} is outside the ranks worth holding.`
              }${status}`.trim(),
              tone,
            }
          })
      : []

  const trades: TradeSuggestion[] = []
  if (input.ranksLoaded) {
    const shop = input.roster
      .filter((player) => player.canStart && !keep.has(player.id))
      .filter((player) => {
        if (player.seasonRank != null) return true
        return input.seasonPositions.includes(player.position)
      })
      .sort((a, b) => {
        if (a.seasonRank == null && b.seasonRank == null) return a.name.localeCompare(b.name)
        if (a.seasonRank == null) return 1
        if (b.seasonRank == null) return -1
        return b.seasonRank - a.seasonRank
      })
    for (const player of shop) {
      if (trades.length >= 4) break
      if (player.seasonRank == null && player.harrisRank == null && !input.seasonPositions.includes(player.position)) {
        continue
      }
      const targetPool = (input.opponents ?? []).flatMap((team) =>
        team.players
          .filter((mate) => canPlay(mate.position, player.position) && mate.seasonRank != null)
          .filter((mate) => player.seasonRank == null || mate.seasonRank! < player.seasonRank)
          .map((mate) => ({ teamName: team.teamName, player: mate })),
      )
      targetPool.sort((a, b) => (a.player.seasonRank ?? 999) - (b.player.seasonRank ?? 999))
      const target = targetPool[0] ?? null
      if (player.seasonRank == null && !target) continue
      const reason = [
        `${rankText(player)}.`,
        player.seasonRank == null
          ? "Harris has him unranked, so that is not a season-long hold."
          : `Season-long ${player.seasonRank} is the wrong value to hold.`,
        player.harrisRank != null && player.seasonRank != null && player.harrisRank + 12 <= player.seasonRank
          ? `Weekly ${player.harrisRank} is ${player.seasonRank - player.harrisRank} spots better than that season-long rank.`
          : "",
        target
          ? `${target.teamName} has ${target.player.name} at season-long ${target.player.seasonRank}.`
          : "Shop him for a better season-long rank.",
      ]
        .filter(Boolean)
        .join(" ")
      trades.push({
        rank: trades.length + 1,
        player: toAdvicePlayer(player),
        target: target ? toAdvicePlayer(target.player) : null,
        targetTeam: target?.teamName ?? null,
        reason,
      })
    }
  }

  return { claims, freeAgents, drops, trades, holes, method: METHOD }
}
