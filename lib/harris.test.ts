import assert from "node:assert/strict"
import { test } from "node:test"
import { harrisBoard, lookupRanks, normalizeHarrisName, parseSeasonHtml, parseWeeklyHtml } from "./harris.ts"

const weekly = `
<table>
<tr><td>Standard Scoring</td><td></td></tr>
<tr><td>1</td><td>Standard Only</td><td>CHI</td></tr>
<tr><td>2</td><td>Kenneth Walker III</td><td>LAC</td></tr>
<tr><td>PPR Scoring</td><td></td></tr>
<tr><td>1</td><td>Bijan Robinson</td><td>CHI</td></tr>
<tr><td>2</td><td>D'Andre Swift</td><td>DAL</td></tr>
</table>
Week 6 (updated 10/13/26 - 2:30 p.m. ET)
`

test("weekly parser keeps the PPR table only", () => {
  const parsed = parseWeeklyHtml(weekly, "RB")
  assert.equal(parsed.mode, "ppr")
  assert.equal(parsed.count, 2)
  assert.equal(parsed.ranks.get(`RB:${normalizeHarrisName("Bijan Robinson")}`), 1)
  assert.equal(parsed.ranks.get(`RB:${normalizeHarrisName("D'Andre Swift")}`), 2)
  assert.equal(parsed.ranks.has(`RB:${normalizeHarrisName("Standard Only")}`), false)
  assert.equal(normalizeHarrisName("Kenneth Walker III"), normalizeHarrisName("Kenneth Walker"))
  assert.equal(normalizeHarrisName("C.J. Stroud"), "cjstroud")
})

test("a standard-only page is not used", () => {
  const parsed = parseWeeklyHtml(`<table><tr><td>Standard Scoring</td></tr><tr><td>1</td><td>Only Standard</td></tr></table>`, "RB")
  assert.equal(parsed.mode, "standard-only")
  assert.equal(parsed.count, 0)
})

test("season ranks stay on the rest-of-season list", () => {
  const html = `
  <h1>Rest Of Season Ranks - Week 6</h1>
  <p>updated 10/13/26 - 2:30 p.m. ET</p>
  <table>
  <tr><td>1</td><td>Jahmyr Gibbs</td><td>RB</td><td>—</td></tr>
  <tr><td>7</td><td>Ja'Marr Chase</td><td>WR</td><td>—</td></tr>
  </table>`
  const parsed = parseSeasonHtml(html)
  assert.deepEqual(parsed.positions.sort(), ["RB", "WR"])
  assert.equal(parsed.ranks.get(`WR:${normalizeHarrisName("Ja'Marr Chase")}`), 7)
  const board = {
    week: 6,
    updated: null,
    seasonWeek: 6,
    seasonUpdated: null,
    seasonLabel: "Rest of season",
    weekly: new Map<string, number>(),
    season: parsed.ranks,
    seasonPositions: parsed.positions,
    counts: { weekly: {}, season: parsed.ranks.size },
    fetchedAt: new Date().toISOString(),
  }
  assert.deepEqual(lookupRanks(board, { position: "WR", name: "JaMarr Chase", team: "CIN" }), {
    weekly: null,
    season: 7,
  })
})

test("defense names match the team", () => {
  const parsed = parseWeeklyHtml(
    `<table><tr><td>1</td><td>Kansas City Chiefs</td><td>LAC</td></tr></table>`,
    "DEF",
  )
  const board = {
    week: 6,
    updated: null,
    seasonWeek: null,
    seasonUpdated: null,
    seasonLabel: null,
    weekly: parsed.ranks,
    season: new Map<string, number>(),
    seasonPositions: [],
    counts: { weekly: { DEF: parsed.count }, season: 0 },
    fetchedAt: new Date().toISOString(),
  }
  assert.equal(lookupRanks(board, { position: "DEF", name: "Kansas City Chiefs", team: "KC" }).weekly, 1)
  assert.equal(lookupRanks(board, { position: "DEF", name: "KC D/ST", team: "KC" }).weekly, 1)
})

test("live Harris PPR pages are public", async () => {
  const board = await harrisBoard({ force: true })
  assert.ok(board.week && board.week > 0)
  assert.ok(board.seasonWeek && board.seasonWeek > 0)
  assert.equal(board.seasonLabel, "Rest of season")
  assert.ok((board.counts.weekly.RB ?? 0) >= 20)
  assert.ok((board.counts.weekly.WR ?? 0) >= 20)
  assert.ok(board.counts.season >= 40)
  assert.ok(board.seasonPositions.includes("RB"))
  assert.equal(board.weekly.has("RB:standardscoring"), false)
})
