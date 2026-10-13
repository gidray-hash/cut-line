import { nflState } from "@/lib/nfl"
import { jsonError } from "@/lib/upstream"

export async function GET() {
  try {
    const state = await nflState()
    return Response.json(state)
  } catch {
    return jsonError("The NFL week could not be loaded.", 502)
  }
}
