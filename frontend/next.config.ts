import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e runner (e2e/run-all.mjs) starts a second dev server with its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
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
