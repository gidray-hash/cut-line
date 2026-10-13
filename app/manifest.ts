import type { MetadataRoute } from "next"

const base = process.env.NEXT_PUBLIC_BASE_PATH || ""

export const dynamic = "force-static"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cut Line",
    short_name: "Cut Line",
    description: "Waiver claims, free agents, and the playoff cut for a Sleeper or ESPN league.",
    start_url: `${base}/`,
    scope: `${base}/`,
    id: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#F2F2F7",
    theme_color: "#F2F2F7",
    icons: [
      {
        src: `${base}/icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}/icons/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}/icons/icon-maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
