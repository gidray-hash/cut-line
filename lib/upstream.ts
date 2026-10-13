export class UpstreamError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new UpstreamError("The league service returned an unreadable response.", 502)
  }
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status })
}
