import { harrisBoard, harrisMeta, HarrisAccessError } from "@/lib/harris"
import { jsonError } from "@/lib/upstream"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const board = await harrisBoard()
    return Response.json(harrisMeta(board))
  } catch (error) {
    if (error instanceof HarrisAccessError) return jsonError(error.message, 403)
    return jsonError("Harris PPR rankings did not load.", 502)
  }
}
