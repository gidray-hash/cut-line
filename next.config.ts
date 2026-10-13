import type { NextConfig } from "next";

const exporting = process.env.CUTLINE_EXPORT === "1"
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined

const nextConfig: NextConfig = {
  ...(exporting
    ? { output: "export" as const }
    : { cacheComponents: true, partialPrefetching: true }),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  devIndicators: false,
  // The dev server is opened as 127.0.0.1 and through a public tunnel. Next blocks
  // client scripts for those hosts unless they are listed here, which leaves the
  // page as static HTML and drops every form submit.
  allowedDevOrigins: ["127.0.0.1", "localhost", "10.0.0.38"],
  ...(exporting
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/sw.js",
              headers: [
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
                { key: "Service-Worker-Allowed", value: "/" },
              ],
            },
          ]
        },
      }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
