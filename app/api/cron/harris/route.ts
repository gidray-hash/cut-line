import { harrisBoard, harrisMeta, HarrisAccessError } from "@/lib/harris"
import { jsonError } from "@/lib/upstream"

export const dynamic = "force-dynamic"

function allowed(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!allowed(request)) return jsonError("This refresh is not authorized.", 401)
  try {
    const board = await harrisBoard({ force: true })
    return Response.json(harrisMeta(board))
  } catch (error) {
    if (error instanceof HarrisAccessError) return jsonError(error.message, 403)
    return jsonError("Harris PPR rankings did not refresh.", 502)
  }
}
