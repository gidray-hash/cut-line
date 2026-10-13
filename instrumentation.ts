export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { startHarrisRefresh } = await import("./lib/harris")
  startHarrisRefresh()
}
