import { connectSleeper } from "@/lib/sleeper"
import { jsonError, UpstreamError } from "@/lib/upstream"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown }
    if (typeof body.username !== "string") {
      return jsonError("Enter a Sleeper username.", 400)
    }
    const result = await connectSleeper(body.username)
    return Response.json(result)
  } catch (error) {
    if (error instanceof UpstreamError) return jsonError(error.message, error.status)
    if (error instanceof SyntaxError) return jsonError("Send a JSON body.", 400)
    return jsonError("Sleeper could not be reached.", 502)
  }
}
