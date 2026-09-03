# AniMCP

AniMCP is a browser-based motion graphics editor. Create a composition, add layers, animate properties with keyframes, and export the result.

Projects stay in the browser's IndexedDB storage on the current device. AniMCP has no sign-in, cloud storage, or project sharing.

## What It Supports

- Rectangle, ellipse, text, SVG, and PNG layers
- Position, size, rotation, opacity, scale, color, gradient, stroke, and timing controls
- Linear, hold, Bezier, and spring easing
- Layer locks, undo, redo, and revision checks for edits
- Starter templates and blank projects
- Import of `.animcp.json` project files
- Export to `.animcp.json`, SVG, Lottie JSON, and, in supported browsers, MP4
- Google Fonts for text layers
- WebMCP tools so a browser agent can inspect and edit the open composition


## Run Locally

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Open the URL printed by Vite. Create a project from `/projects`.

## Commands

```bash
pnpm dev       # Start the development server
pnpm test      # Run the Vitest tests
pnpm check     # Check Svelte and TypeScript
pnpm lint      # Check formatting and ESLint rules
pnpm build     # Create a production build
pnpm preview   # Build, then run the Cloudflare Worker locally
pnpm deploy    # Build and deploy with Wrangler
```

## Use The Editor

1. Open `/projects`.
2. Create a blank project, import an `.animcp.json` file, or open a template.
3. Add layers from the editor toolbar.
4. Select a layer and change its properties in the inspector.
5. Move the playhead, add keyframes, then adjust the property at another frame.
6. Use the export menu to download the project or rendered output.

Native `.animcp.json` export is the only format that keeps the full editable project. SVG exports the current frame. Lottie and MP4 exports may not preserve every editor feature. MP4 export requires a browser with H.264 recording and canvas video capture support.

## Storage And Browser Notes

- Clearing this site's browser data deletes locally saved projects.
- Export `.animcp.json` files before clearing browser data or moving to another device.
- Imported SVG and PNG files are embedded in the project.
- An SVG export with a selected Google Font keeps live text. The viewing device needs that font to display it as intended.

## Development Notes

The active editor code is in `src/lib/features/motion`. The current project model is version 2. The older vector model in `src/lib/features/animation` remains for import, validation, and export compatibility.

See [CODEBASE_GUIDE.md](CODEBASE_GUIDE.md) for the route, state, rendering, persistence, and test layout.
