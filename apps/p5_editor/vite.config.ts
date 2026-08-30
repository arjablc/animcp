import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const p5Root = resolve(
  dirname(createRequire(import.meta.url).resolve("p5")),
  "..",
);
const p5Runtime = "\0p5-runtime";

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "p5-runtime-source",
      resolveId: (id) => (id === "virtual:p5-runtime" ? p5Runtime : undefined),
      load: (id) =>
        id === p5Runtime
          ? `export default ${JSON.stringify(readFileSync(resolve(p5Root, "lib/p5.min.js"), "utf8"))}`
          : undefined,
    },
    sveltekit(),
  ],
  // server: {
  //   proxy: {
  //     "/api": { target: "http://localhost:8080", changeOrigin: true }
  //   }
  // },
  test: { include: ["tests/**/*.test.ts"] },
});
