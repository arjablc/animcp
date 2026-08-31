# AniMCP

AniMCP is a local-first motion graphics editor for humans and agents. Create a composition, animate property tracks, and revise timing, easing, gradients, and motion relationships through browser WebMCP.

## Run

```sh
cd animcp-web
pnpm install
pnpm dev
```

Open the printed local URL. The home page creates v2 motion compositions; `/vector` lists previous vector projects, and `/legacy` retains p5 sketches. Existing project databases are not overwritten.

```sh
pnpm check
pnpm test
pnpm build
```

## Motion studio

- Rectangle, ellipse, text, immutable SVG, and PNG layers. No tracing/vectorization in the new editor.
- Independent transform, geometry, color, and gradient tracks with linear, hold, and Bézier easing.
- Linear/radial gradient fills with animated geometry, stop colors, offsets, and opacity; canvas geometry handles.
- Search Google Fonts or enter a family directly. Fonts load from Google on demand; no font binaries are bundled. First use needs a connection. The public catalog adapter is isolated in `/api/fonts`; if its upstream format changes, direct family entry still works.
- Animation bars connect adjacent keys. Click a bar to edit easing in Properties, drag it to retime, drag its edges to trim, or nudge with arrow keys (Shift: 10 frames). Inspector diamonds add keys. Drag the ruler/playhead to scrub; Shift+wheel pans horizontally. Space toggles playback. A drag is one undo entry.
- Shared transactions, endpoint/easing locks, atomic agent batches, revisions, activity history, and IndexedDB autosave.
- Five starters: product cards, logo reveal, lower third, kinetic title, and app onboarding.

## Actual browser WebMCP registration

`animcp-web/src/lib/features/motion/webmcp.ts` registers real tools with:

```javascript
await document.modelContext.registerTool({
  name,
  description,
  inputSchema,
  execute: async (input) => { /* shared editor commands */ }
}, { signal });
```

Use a browser/agent integration implementing `document.modelContext` in a secure context (localhost or HTTPS). The toolbar reports registration status. Browsers without this experimental API retain the complete manual editor. No server-side MCP service, API key, or in-app chatbot is required. The browser owns agent discovery and invocation. See the [WebMCP project](https://github.com/webmachinelearning/webmcp) for current implementation status.

Tools include `get_editor_context`, `get_motion`, `get_layer`, `find_elements`, creation/property/keyframe/paint commands, `shift_motion`, `stagger_motion`, `retime_motion`, `copy_motion`, `copy_easing`, `align_keyframes`, `reverse_motion`, `add_overshoot`, `add_anticipation`, `distribute_timing`, `normalize_motion`, `sequence_motion`, `batch_edit`, playback, undo, and redo.

For “make the text hello come after Title”:

1. Call `find_elements` for each text. Match actual native text, not layer names. Multiple matches are returned as ambiguous candidates.
2. Read their tracks/spans and the current project revision.
3. Call `sequence_motion` with resolved target/reference IDs and `expectedRevision`. The default gap is one frame after the reference finishes; target duration and values are preserved. Explicit ranges are required for ambiguous multi-stage motion.

Mutations require `expectedRevision`. Selection-based mutations also require `expectedContextRevision`; stale reads fail instead of changing a new selection. `requestId` makes retries idempotent for the bounded session cache. `batch_edit` validates every operation and commits once; one Undo restores the entire batch. Text in artwork is document data, not instructions. Imported SVG/PNG internals are opaque and do not receive OCR/text lookup.

## Portability and export boundaries

Native `.animcp.json` contains embedded SVG/PNG assets. New projects live separately in `animcp-motion-v2`. Native imports validate data before saving a new copy. Importing a v1 JSON with static geometry creates a v2 SVG-based copy with frame-sampled motion; path-morph projects stay in the previous editor. Large migrations can exceed the 20,000-key limit and are rejected without modifying originals.

SVG export snapshots the current frame and embeds artwork. Live text references fonts; external viewers need those fonts. Lottie export samples at composition FPS, exports native shapes/gradient fills and transforms, and rasterizes static text/SVG content. Animated text paints, animated imported width/height, off-center radial focal points, and text outside export bounds produce errors. Use native JSON for lossless editing. Lottie support is experimental; it is not a promise of identical behavior across all players.

SVG import accepts an intentionally limited passive element/attribute set, rejects external resources/scripts/embedded animations, and keeps imported content immutable. PNG is limited to 16 megapixels, 8192px per side, and 10 MiB; animated PNG is rejected. Native projects are limited to 50 MiB, 200 layers, 200 assets, and 20,000 keys. Fonts remain references rather than bundled assets.

The [pivot plan](motion-editor-pivot-plan.md) records the broader target and implementation checkpoints. The previous [vector specification](webmcp-animation-editor-spec.md) describes the retained v1 editor, not the new v2 model.

### Motion studio controls

The motion editor uses a collapsible shadcn sidebar with Layers, Activity, and Composition tabs. Drag layers to reorder, or use the raise/lower buttons. The floating toolbar contains drawing, import, WebMCP, undo/redo, and export controls. Motion surgery remains available to agents through WebMCP.

Playback and Auto-key sit beside the bottom timeline. Drag the ruler or playhead to scrub; use the horizontal scrollbar or Shift+wheel to pan. Animation bars represent adjacent keyframes: click a bar for easing in Properties, drag it to move timing, or drag its selected edges to trim. Easing changes apply immediately. Drag numeric property inputs to adjust, click to type, hold Shift for larger steps or Alt for finer steps. Auto-key preserves the starting pose when the first edit is made after frame zero. Google Fonts opens with 16 families and searches the full online catalog.
