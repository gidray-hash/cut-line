import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { harrisBoard, toCacheFile } from "../lib/harris.ts"

const board = await harrisBoard({ force: true })
const target = path.join(process.cwd(), "public", "harris.json")
await mkdir(path.dirname(target), { recursive: true })
await writeFile(target, JSON.stringify(toCacheFile(board)))
console.log(
  JSON.stringify({
    week: board.week,
    seasonWeek: board.seasonWeek,
    season: board.counts.season,
    weekly: board.counts.weekly,
    fetchedAt: board.fetchedAt,
  }),
)
