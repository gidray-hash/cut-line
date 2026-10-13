import { espnAdvice } from "@/lib/espn"
import { jsonError, UpstreamError } from "@/lib/upstream"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      leagueId?: unknown
      season?: unknown
      espnS2?: unknown
      swid?: unknown
      teamId?: unknown
    }
    if (typeof body.leagueId !== "string" || typeof body.season !== "number") {
      return jsonError("Enter an ESPN league id and season.", 400)
    }
    const result = await espnAdvice({
      leagueId: body.leagueId,
      season: body.season,
      espnS2: typeof body.espnS2 === "string" ? body.espnS2 : "",
      swid: typeof body.swid === "string" ? body.swid : "",
      teamId: typeof body.teamId === "number" ? body.teamId : null,
    })
    return Response.json(result)
  } catch (error) {
    if (error instanceof UpstreamError) return jsonError(error.message, error.status)
    if (error instanceof SyntaxError) return jsonError("Send a JSON body.", 400)
    return jsonError("That ESPN league could not be loaded.", 502)
  }
}
