# AniMCP

AniMCP is a local-first, agent-native vector animation editor. The authoritative product and technical requirements are in [webmcp-animation-editor-spec.md](webmcp-animation-editor-spec.md).

## Application

The current web application is in `animcp-web`. The editor rebuild is moving from the legacy p5.js source editor to a structured Svelte/Fabric vector animation editor.

## Run the web app

```sh
cd animcp-web
pnpm install
pnpm dev
```

From `animcp-web`, run `pnpm check`, `pnpm test`, and `pnpm build`.

The SvelteKit app provides `/healthz`, `/readyz`, and `/api/v1/version` directly.
