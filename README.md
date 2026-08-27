# AniMCP

This monorepo starts by testing whether an agent can reliably transfer a generated PNG into a browser page through WebMCP.

## Layout

- `apps/image-transport-test`: disposable Phase 0 transport harness
- `apps/editor`: the eventual animation editor
- `backend`: thin Go operational API
- `docs`: experiment records

## Run the transport test app

```sh
npm install
npm run dev:test
```

Run the importer checks with `npm test` and the production build with `npm run build`.

Use **Run locally** to validate the importer and **Copy tool input** to give an agent deterministic PNG bytes for a real WebMCP call. The app pins that fixture's byte count and hash by transfer ID, so only an unchanged copied fixture is shown as fixture-verified. Generated images are self-checked when they supply `expectedBytes` and `sha256`. The copied payload never appears in the page or result history.

## Run the backend

```sh
go run ./cmd/api
```

The service exposes `/healthz`, `/readyz`, and `/api/v1/version` on port 8080 by default.
