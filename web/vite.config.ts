import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DIST = resolve(__dirname, "../dist");

// Dev only: serve /scores and /data/* the way vercel.json does in production,
// from dist/data (made by `npm run score` with PROBE_PUBLIC_DIR=dist/data).
function scoresDev(): Plugin {
  return {
    name: "scores-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let p = decodeURIComponent((req.url ?? "").split("?")[0]);
        if (p === "/scores") p = "/data/scores.json";
        else if (p.startsWith("/scores/")) p = `/data/hosts/${p.slice(8)}.json`;
        if (!p.startsWith("/data/")) return next();
        const f = resolve(DIST, `.${p}`);
        if (!f.startsWith(DIST) || !existsSync(f)) {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader("content-type", "application/json");
        res.end(readFileSync(f));
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), scoresDev()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: { outDir: DIST, emptyOutDir: true },
});
