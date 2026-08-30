# AniMCP

This monorepo contains two agent-native animation editors and a thin Go operational API.

## Layout

- `apps/editor`: React SVG animation editor
- `apps/p5_editor`: SvelteKit p5.js editor with generated controls and WebMCP tools
- `backend`: thin Go operational API
- `docs`: experiment records

## Run the p5 editor

```sh
pnpm install
pnpm dev:p5
```

Run all checks with `pnpm check`, tests with `pnpm test`, and production builds with `pnpm build`.

## Run the backend

```sh
cd backend
go run ./cmd/api
```

The service exposes `/healthz`, `/readyz`, and `/api/v1/version` on port 8080 by default.
