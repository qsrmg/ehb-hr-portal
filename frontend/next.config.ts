import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e runner (e2e/run-all.mjs) starts a second dev server with its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Signed-in pages are Client Components behind the sign-in gate, so the server never renders them and
    // they can't set `instant` themselves. Validate only segments that opt in with `export const instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
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
