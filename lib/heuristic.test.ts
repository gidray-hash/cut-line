import assert from "node:assert/strict"
import { test } from "node:test"
import { arrangeRoster, recommend } from "./heuristic.ts"
import { scorePlayerStats } from "./score.ts"
import { rankStandings, standingNote } from "./standings.ts"
import type { EvalPlayer } from "./types.ts"

function player(overrides: Partial<EvalPlayer> & Pick<EvalPlayer, "id" | "name" | "position">): EvalPlayer {
  return {
    team: "DAL",
    injury: "healthy",
    injuryLabel: null,
    onBye: false,
    byeWeek: null,
    projection: 10,
    recentAverage: 10,
    recentWeeks: 3,
    slot: "BN",
    availability: "rostered",
    ownedPercent: 40,
    searchRank: null,
    starter: false,
    canStart: true,
    opponent: null,
    harrisRank: null,
    seasonRank: null,
    ...overrides,
  }
}

test("PPR scoring matches receptions, yards, and touchdowns", () => {
  const scoring = { rec: 1, rec_yd: 0.1, rec_td: 6 }
  const points = scorePlayerStats(
    { rec: 6, rec_yd: 124, rec_td: 2, pts_ppr: 30.4 },
    scoring,
    false,
  )
  assert.equal(points, 30.4)
})

test("defense points use the published total", () => {
  const points = scorePlayerStats({ sack: 3, pts_std: 8, pts_allow: 17 }, { sack: 1 }, true)
  assert.equal(points, 8)
})

test("an injured starting back becomes a waiver claim, not a drop", () => {
  const roster = [
    player({ id: "qb", name: "Starter QB", position: "QB", slot: "QB", starter: true, harrisRank: 4, seasonRank: 5 }),
    player({
      id: "rb1",
      name: "Injured Back",
      position: "RB",
      slot: "RB",
      starter: true,
      injury: "out",
      injuryLabel: "Out",
      harrisRank: 3,
      seasonRank: 8,
    }),
    player({ id: "wr", name: "Starter WR", position: "WR", slot: "WR", starter: true, harrisRank: 6, seasonRank: 10 }),
    player({ id: "junk", name: "Bench WR", position: "WR", harrisRank: 30, seasonRank: 40, ownedPercent: 4 }),
  ]
  const available = [
    player({
      id: "add",
      name: "Waiver Back",
      position: "RB",
      availability: "waiver",
      harrisRank: 12,
      seasonRank: 18,
      ownedPercent: 62,
    }),
  ]
  const result = recommend({
    week: 6,
    starterSlots: ["QB", "RB", "WR"],
    roster,
    available,
    rosterFull: true,
    faabRemaining: 40,
    useFaab: true,
    ranksLoaded: true,
    seasonPositions: ["QB", "RB", "WR", "TE"],
  })
  assert.deepEqual(result.holes, ["RB"])
  assert.equal(result.claims.length, 1)
  assert.equal(result.claims[0]?.add.name, "Waiver Back")
  assert.equal(result.claims[0]?.drop?.name, "Bench WR")
  assert.match(result.claims[0]?.reason ?? "", /short a healthy RB/)
  assert.match(result.claims[0]?.reason ?? "", /season-long rank has Waiver Back at 18, 22 spots ahead of Bench WR at 40/)
  assert.doesNotMatch(result.claims[0]?.reason ?? "", /projected|proj/)
  assert.match(result.claims[0]?.bidHint ?? "", /FAAB/)
  assert.doesNotMatch(result.claims[0]?.bidHint ?? "", /\$/)
  assert.equal(result.drops.some((drop) => drop.player.name === "Injured Back"), false)
})

test("free agents stay out of the claim list", () => {
  const roster = [
    player({ id: "qb", name: "QB", position: "QB", slot: "QB", starter: true, harrisRank: 5, seasonRank: 5 }),
    player({ id: "rb", name: "RB", position: "RB", slot: "RB", starter: true, harrisRank: 8, seasonRank: 8 }),
  ]
  const available = [
    player({
      id: "fa",
      name: "Free WR",
      position: "WR",
      availability: "free",
      harrisRank: 14,
      seasonRank: 15,
      ownedPercent: 55,
    }),
    player({
      id: "w",
      name: "Waiver WR",
      position: "WR",
      availability: "waiver",
      harrisRank: 16,
      seasonRank: 20,
      ownedPercent: 48,
    }),
  ]
  const result = recommend({
    week: 6,
    starterSlots: ["QB", "RB", "WR"],
    roster,
    available,
    rosterFull: false,
    faabRemaining: null,
    useFaab: false,
    ranksLoaded: true,
    seasonPositions: ["QB", "RB", "WR", "TE"],
  })
  assert.equal(result.claims.some((claim) => claim.add.name === "Free WR"), false)
  assert.equal(result.freeAgents.some((pick) => pick.player.name === "Free WR"), true)
  assert.equal(result.freeAgents[0]?.suggestedDrop, null)
  assert.match(result.freeAgents[0]?.reason ?? "", /does not require a waiver claim/)
})

test("the better weekly Harris rank starts", () => {
  const roster = [
    player({ id: "bye", name: "Bye Star", position: "WR", harrisRank: 1, seasonRank: 1, onBye: true }),
    player({ id: "h", name: "Healthy", position: "WR", harrisRank: 12, seasonRank: 20 }),
    player({ id: "o", name: "Out Star", position: "WR", harrisRank: 2, seasonRank: 2, injury: "out", injuryLabel: "Out" }),
    player({ id: "u", name: "No Rank", position: "WR" }),
  ]
  const lined = arrangeRoster(["WR"], roster)
  assert.equal(lined.starters[0]?.player?.name, "Healthy")
  assert.equal(lined.starters[0]?.player?.harrisRank, 12)
  assert.equal(lined.bench.some((slot) => slot.player?.name === "No Rank" && slot.player.harrisRank == null), true)
})

test("a worse season-long rank is a trade, and an unranked add is not an upgrade", () => {
  const roster = [
    player({ id: "stud", name: "Stud Back", position: "RB", harrisRank: 2, seasonRank: 2 }),
    player({ id: "sell", name: "Hot Week", position: "RB", harrisRank: 8, seasonRank: 55 }),
  ]
  const result = recommend({
    week: 6,
    starterSlots: ["RB"],
    roster,
    available: [
      player({ id: "blank", name: "Unranked Back", position: "RB", availability: "waiver" }),
    ],
    rosterFull: true,
    faabRemaining: null,
    useFaab: false,
    ranksLoaded: true,
    seasonPositions: ["RB", "WR"],
    opponents: [
      {
        teamName: "Other",
        players: [player({ id: "theirs", name: "Better Hold", position: "RB", seasonRank: 14, harrisRank: 20 })],
      },
    ],
  })
  assert.equal(result.claims.length, 0)
  assert.equal(result.trades[0]?.player.name, "Hot Week")
  assert.match(result.trades[0]?.reason ?? "", /weekly 8/)
  assert.match(result.trades[0]?.reason ?? "", /season-long 55/)
  assert.match(result.trades[0]?.reason ?? "", /wrong value to hold/)
  assert.equal(result.trades[0]?.target?.name, "Better Hold")
  assert.equal(result.trades[0]?.targetTeam, "Other")
  assert.equal(result.drops.some((drop) => drop.player.name === "Stud Back"), false)
})

test("playoff picture counts wins behind the cut", () => {
  const rows = rankStandings(
    [
      { id: "a", name: "Alpha", wins: 4, losses: 1, ties: 0, pointsFor: 700, gamesBack: null },
      { id: "b", name: "Bravo", wins: 4, losses: 1, ties: 0, pointsFor: 650, gamesBack: null },
      { id: "c", name: "Cut", wins: 3, losses: 2, ties: 0, pointsFor: 800, gamesBack: null },
      { id: "d", name: "You", wins: 2, losses: 3, ties: 0, pointsFor: 600, gamesBack: null },
    ],
    2,
  )
  const you = rows.find((row) => row.id === "d")
  assert.ok(you)
  assert.equal(you.inPlayoffSpot, false)
  assert.equal(you.winsBehind, 2)
  assert.equal(you.rank, 4)
  assert.match(standingNote(you, 2, "standard"), /2 wins behind/)
  const leader = rows[0]
  assert.ok(leader)
  assert.match(standingNote(leader, 2, "standard"), /In a playoff spot/)
})

test("ESPN games back is used when the API sends it", () => {
  const rows = rankStandings(
    [{ id: "y", name: "You", wins: 3, losses: 2, ties: 0, pointsFor: 400, gamesBack: 1 }],
    4,
  )
  const you = rows[0]
  assert.ok(you)
  you.rank = 5
  you.inPlayoffSpot = false
  assert.match(standingNote(you, 4, "standard"), /1 game out/)
})
