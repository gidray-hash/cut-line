import { sleeperAdvice } from "@/lib/sleeper"
import { jsonError, UpstreamError } from "@/lib/upstream"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      leagueId?: unknown
      userId?: unknown
      rosterId?: unknown
    }
    if (typeof body.leagueId !== "string" || typeof body.userId !== "string") {
      return jsonError("Choose a Sleeper league first.", 400)
    }
    const rosterId = typeof body.rosterId === "number" ? body.rosterId : null
    const result = await sleeperAdvice({ leagueId: body.leagueId, userId: body.userId, rosterId })
    return Response.json(result)
  } catch (error) {
    if (error instanceof UpstreamError) return jsonError(error.message, error.status)
    if (error instanceof SyntaxError) return jsonError("Send a JSON body.", 400)
    return jsonError("That Sleeper league could not be loaded.", 502)
  }
}
