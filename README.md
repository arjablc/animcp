# AniMCP

This monorepo contains two agent-native animation editors.

## Layout

- `apps/editor`: React SVG animation editor
- `apps/p5_editor`: SvelteKit p5.js editor with generated controls, WebMCP tools, and vector/raster Lottie JSON export
- `docs`: experiment records

## Run the p5 editor

```sh
pnpm install
pnpm dev:p5
```

Run all checks with `pnpm check`, tests with `pnpm test`, and production builds with `pnpm build`.

The SvelteKit app provides `/healthz`, `/readyz`, and `/api/v1/version` directly.
