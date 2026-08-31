# AniMCP motion-editor pivot — implementation plan

Status: first v2 implementation delivered; see the implementation checkpoint below.  
Date: 2026-08-31.  
Basis: supplied pivot proposal, with SVG and PNG imports, keyframeable gradients, explicit browser WebMCP registration, and on-demand Google Fonts explicitly included.

## 1. Product and scope

AniMCP becomes a local-first motion-graphics timeline that humans and agents edit together. Humans create/import artwork, inspect playback, and adjust keyframes. Agents perform deterministic timing, easing, copying, coordination, and revision operations on the same state through WebMCP.

Initial layer types: rectangle, ellipse, text, imported SVG, and PNG image. Imported artwork is immutable content with editable transform/opacity tracks. SVG stays vector; PNG stays raster. Neither is traced, decomposed, or point-edited.

Required release capabilities:

- Property tracks, first-class keyframes, playback, selection, and a usable timeline.
- Shape/text creation, SVG/PNG import, and animated solid colors and gradients.
- Motion surgery, constraints, locks, atomic undo/redo, and visible human/agent history.
- Local autosave, portable native project export/import, current-frame SVG export, and a clearly bounded Lottie exporter.
- Starter compositions and a demonstrable human → agent → human → agent workflow.

Remove from the new editor: freehand, pen, path-point editing, path morphing, generated in-betweens, vectorization and its worker, and generated-image transport. No video export, chat UI, image generation, grouping, masks, expressions, or character-animation tooling in this release. Preserve legacy data and compatibility code until transition gates pass.

## 2. What the repository already provides

The application is SvelteKit/Svelte with Fabric. `animation/model.ts` stores v1 vector projects as full path/transform snapshots keyed by frame. `animation/commands.ts` already provides a shared mutation boundary, validation, revision checks, and undo/redo. `animation/state.svelte.ts` owns session state and autosaving.

`timeline/Timeline.svelte` is currently layer/snapshot oriented, not a property-track editor. `canvas/FabricCanvas.svelte` is coupled to paths, drawing, and point controls. `editor/VectorEditor.svelte` couples these to raster import and tracing. These require substantial replacement.

Retain the patterns in `persistence/vector-storage.ts` and `webmcp/vector-tools.ts`, including capability detection and lifecycle cleanup. Adapt rather than assume schema compatibility. Current native export omits asset bytes; current vector Lottie output has an empty assets array. Both must change for portable PNG/SVG projects.

## 3. Canonical model and evaluator

Introduce `features/motion/` with model, validation, evaluation, easing, commands, migrations, and session state. Fabric objects remain projections, never project data.

- Project v2: `kind: 'motion-graphics'`, composition, layers, asset references, revision, timestamps.
- Composition: width, height, background, FPS, duration in frames. Retain existing 12/15/24/30 FPS support and add 60; make duration limits FPS-aware rather than retaining the existing 1,800-frame cap blindly.
- Layers: stable ID, name, content type, visibility, locks, order, content, paint, and typed property tracks.
- Tracks: default value and ordered keyframes with stable IDs, integer frame, typed value, and outgoing easing.
- Transform tracks: position X/Y, scale X/Y, rotation, opacity. Define local bounds and anchor coordinates consistently across native and imported layers; anchor editing is initially static.
- Native geometry/style tracks: width, height, rectangle corner radius, stroke width, fill/stroke color and opacity. Text content, font choice, alignment, and font size are initially static.
- Easing: linear, hold, cubic Bézier, and named presets mapped to curves. Expose overshoot through deterministic added keys.

Evaluation rules: no keys uses the default; before the first/after the last key holds its value; between keys evaluates the outgoing segment easing. Frame domain is `0..durationFrames-1`; playback can sample fractional frames. Rotation is continuous numeric degrees, without implicit shortest-path wrapping. No materialized in-between frames.

Validate property-specific bounds and finite values. Clamp bounded evaluated properties such as opacity; do not clamp position or rotation overshoot. One key per property per integer frame. Reject collisions and out-of-range mutations atomically unless an operation explicitly requests a supported resolution policy.

## 4. Keyframeable gradients — initial release

Support solid, linear-gradient, and radial-gradient paints on native rectangle/ellipse/text fills, and on shape strokes. Imported SVG retains its internal paints; its internal gradient stops are not exposed as editable tracks. PNG pixels are not recolored. Users can place either over animated native gradients.

Gradient paint has a stable ID and stable stop IDs. Animate:

| Gradient | Properties |
| --- | --- |
| Linear | Start X/Y, end X/Y |
| Radial | Center X/Y, focal X/Y, radius |
| Every stop | Offset, color, opacity |
| Whole paint | Opacity |

Use normalized layer-local coordinates so resizing and transforming artwork has predictable results. Define radial radius against the smaller local dimension. Use endpoint controls for linear direction rather than competing endpoint and angle tracks. Inspector may derive an angle for display.

Use a documented sRGB interpolation rule for color channels with alpha interpolated separately. Stops have offsets in `[0,1]`; evaluate then sort by offset with stable-ID tie breaking, allowing deterministic crossing/hard edges. Enforce a positive radial radius and supported focal geometry. Stop count/order identity and paint kind are structural edits, not interpolated properties; adding/removing a stop is undoable and removing one removes its tracks in the same transaction.

UI: gradient picker, stop rail, color/opacity controls, geometry controls, keyframe toggles, expandable gradient tracks, and canvas handles for geometry. Presets are conveniences, not a separate animation system. Gradient tracks participate in retiming/easing/copy operations wherever type-compatible.

Acceptance: animate a two-stop linear gradient and a radial gradient, scrub intermediate values, undo stop deletion, save/reload, and reproduce the same current frame in SVG export.

## 5. SVG/PNG import and persistence

- File picker and drag/drop create an asset-backed layer directly, fitted to the composition while preserving aspect ratio.
- SVG: parse and sanitize before rendering; reject scripts, event handlers, external references, `foreignObject`, embedded animation, and unsupported active content. Preserve supported internal shapes/gradients without making them editable paths. Never insert raw imported markup into the application DOM. Reject unsupported content with an explanation rather than silently changing it.
- PNG: validate signature, successful decode, encoded size, dimensions, and decoded pixel budget. Preserve alpha and original pixels. Reject animated PNG initially.
- Record intrinsic dimensions; normalize SVG viewBox handling. Bound SVG element count, nesting, and embedded payloads as well as byte size.
- Keep asset Blob storage in IndexedDB. Commit validated asset records and project references consistently; release temporary object URLs on replacement/disposal. Garbage collection must respect undo/redo references.
- Native `.animcp.json` includes a bounded, embedded asset payload table for portability. On import, validate the complete document/assets before publishing anything. Account for base64 expansion in total limits.
- Agent creation references assets already imported into the project. No arbitrary URL fetch or generated-image transfer protocol is needed initially.

## 6. Shared commands, context, and history

UI and WebMCP call the same renderer-independent commands and surgery functions. Every mutation supports validation, locks, revision protection, and detached results.

Add an atomic batch command: validate all steps against a staged document, then publish once, increment revision once, and append one labeled history entry. A combined “stagger + overshoot” agent request uses one batch; independent tool calls remain independent history entries. Failure commits nothing.

History records actor (`human`/`agent`), label, changed layers/properties/keyframes, and before/after state. Show a small activity panel, undo/redo, and a highlight of agent-edited keys. Undo/redo restores content while revisions remain monotonic. Start with bounded session history, not persisted history.

Session context: playhead, selected layer IDs, selected keyframe IDs, selected property paths, and frame range. Read context includes project revision and a separate context revision so delayed “these” operations cannot target a changed selection silently. Mutations resolve explicit IDs or a checked context snapshot; missing selection never means “all layers.” Playback, zoom, and selection are not durable history edits.

Persist motion locks for start/end time, duration, start/final value, and easing at a defined track/range scope. Layer lock blocks all content mutations. Per-operation preserve constraints add restrictions and cannot override human locks. Return explicit conflicts when constraints cannot all be satisfied.

## 7. Motion surgery semantics and priority

Implement pure operations returning a validated proposed edit and change summary. Support selected properties/ranges and preserve constraints consistently.

| Order | Operation | Contract |
| --- | --- | --- |
| 1 | Shift | Translate selected keyframe times by signed frames |
| 2 | Align | Translate motion spans to a requested start/end/center/playhead or explicit reference; preserve each span's duration |
| 3 | Stagger | Offset spans in explicit layer order by N frames; preserve each span's duration |
| 4 | Retime | Scale times about start/end/center/playhead; round once to integer frames; reject collisions |
| 5 | Apply/copy easing | Named presets or explicit source-to-target segment mapping; easing is normalized already |
| 6 | Copy motion | Copy selected compatible properties with absolute or relative values, explicit destination frame, and timing/easing options |
| 7 | Reverse | Reflect keyframe times in a range and reverse segment easing, including correct hold behavior |
| 8 | Overshoot | Insert a peak before the preserved terminal key; amount is a fraction of signed travel; reserve settle frames |
| 9 | Anticipation | Insert opposite-direction motion before the main move within available time |
| 10 | Distribute timing | Spread span starts/ends across explicit bounds in explicit order |
| 11 | Normalize motion | Compose timing/duration/easing/displacement edits against an explicit reference and constraints |

Relative copy uses `destinationBaseline + (sourceValue - sourceBaseline)` for compatible numeric tracks; baselines are sampled at explicit source/destination anchor frames. End-anchored copy can preserve final positions. Colors use absolute copy initially; structural paint compatibility is required for gradient copies. Do not infer a source from unordered selection.

Duration scale `0.7` means 30% shorter, not mathematically 30% faster. For a speed multiplier of 1.3 use duration scale `1/1.3`. Surface this distinction in schemas/descriptions.

Insufficient frames for anticipation/overshoot, locked endpoints, impossible preserved spans, and keyframe collisions produce actionable errors. No silent timeline extension or lock violation. Reverse hold segments may require explicit step-boundary keys; reject integer-frame cases that cannot preserve the sampled result.

“Halfway between revisions” can initially be an agent-computed retime based on recorded values; a general history-blending operation is deferred. Normalization does not pretend that incompatible timing/duration/endpoints can all be preserved.

## 8. Editor UI

Retain the overall layers / preview canvas / properties / bottom timeline layout. Make the timeline resizable and central to editing.

- Toolbar: select, pan, rectangle, ellipse, text, import SVG/PNG, undo/redo, playback, export, agent status.
- Timeline: collapsible layer/property rows, gradient subtracks, marquee and multi-selection, selected range, drag keys, duplicate/delete, keyboard nudging, zoom/scroll, frame ruler, easing indicators.
- Inspector: evaluated property values at playhead, explicit keyframe diamonds, paint/gradient editing, and locks.
- Editing policy: existing keyed properties edit/create a key at playhead; unkeyed properties edit defaults unless auto-key is enabled. Clearly show auto-key state. Multi-frame gestures publish one undo entry on completion.
- Easing inspector: named presets, editable curve, numeric Bézier controls, copy/paste. No full graph editor required.
- Canvas transforms, inspector changes, and timeline changes use the same commands; preview-only drag state must not flood history/autosave.

## 9. WebMCP surface

Repository requirement: ship actual browser-side `document.modelContext.registerTool(...)` registrations, not just tool descriptions, server-side MCP endpoints, or mock implementations. Each tool supplies `name`, `description`, `inputSchema`, and an async `execute(input)` handler connected to the shared commands. Use AniMCP operation names (the supplied `search_products` example illustrates the registration shape, not a required catalog feature).

```javascript
document.modelContext.registerTool({
  name: "stagger_motion",
  description: "Stagger selected motion spans by a specified number of frames",
  inputSchema: staggerMotionInputSchema,
  execute: async (input) => motionCommands.stagger(input)
});
```

The example's schema and command adapter must be real imports in the implementation. Feature-detect the API before registration, register on editor mount, and clean up on disposal. Add a browser integration check proving that registered tools can be discovered and invoked against the open project. Document the registration entry point and browser setup in the README. The existing vector adapter already obtains `document.modelContext` and calls its registration method; preserve that actual integration when replacing the tool surface.

Keep tools goal-oriented without forcing an arbitrary tool-count cap. The supplied proposal's final list exceeds its stated 15–18 target. Use a compact explicit surface with typed operation variants where helpful:

- Reads: `get_editor_context`, `get_motion`, `get_layer` (context also supplies composition, layer summaries, locks, capabilities).
- Creation: `create_layer`, `duplicate_layer`; imported layers reference existing asset IDs.
- Atomic edits: `set_property`, `edit_keyframes` (add/move/delete), `set_easing`, `delete_layer`, `set_motion_locks`.
- Surgery: `shift_motion`, `align_keyframes`, `stagger_motion`, `retime_motion`, `copy_motion`, `copy_easing`, `reverse_motion`, `add_overshoot`, `add_anticipation`; add distribution/normalization after these work.
- Composition: `batch_edit` for one transaction across several operations.
- Session/history: `set_editor_context`, `playback` (seek/play/pause), `undo`, `redo`.

Schemas expose stable property paths including gradient-stop IDs, constraints, expected revision/context revision, and request IDs. Return compact actual changes and conflicts, not complete asset bytes. Preserve retry/idempotency safeguards. Register only implemented tools; preserve a fully working manual editor if WebMCP is unavailable. Verify the browser API against current primary documentation during integration.

### Refer to elements by their text — required

- Users can identify native text layers by their actual text content, without selecting them or knowing internal IDs: “make the text 'hello' come after the text 'Title'.” Layer names remain a separate lookup field; renaming a layer must not break content-based lookup.
- Add `find_elements` with text query, exact/contains matching, case-sensitivity option, and optional selected-layer/visibility scope. Default to exact matching after Unicode normalization and trimming outer whitespace. Return stable layer IDs, actual text, layer names, visibility/locks, relevant motion spans, and project revision. Read tools include text content so agents can resolve references from current state.
- Resolve references to stable IDs before mutation and require the returned project revision. No matches returns `not_found`; multiple matches return candidates for clarification or an explicit scope, never an arbitrary first match. Text edits invalidate stale resolutions through revision checks. Treat text as document data, not agent instructions.
- Add `sequence_motion` for timing relative to a reference layer's explicit motion span: target span starts at `referenceEndFrame + gapFrames`. Default `gapFrames: 1` makes “after” mean the next frame after the reference entrance finishes. Preserve the target span's duration, values, and easing by translating its keys together; honor locks and composition bounds.
- Use an explicitly selected range or identified entrance span. If a layer has multiple distinct motion spans and no clear entrance designation, return candidate spans rather than shifting entrances and exits indiscriminately. Static text has no entrance timing to sequence: report that and ask for or accept an explicit entrance animation, rather than inventing one. Support an explicit start-relative anchor for requests such as “start hello four frames after Title starts.”
- Example flow: `find_elements({ text: 'hello', match: 'exact' })` and the equivalent lookup for `Title`; resolve unique IDs and entrance spans; execute `sequence_motion` with hello as target, Title as reference, and a one-frame gap. Commit as one undo entry and report the actual resulting frames.
- This initial guarantee applies to native text layers. Imported PNG/SVG artwork remains opaque: do not promise OCR or extraction of text inside imported artwork. Those layers can be referenced by user-assigned names.
- Acceptance: find two uniquely named text contents despite unrelated layer names; place hello's entrance after Title's; verify preserved duration/values and one-step undo. Cover duplicate text, no match, edited text/stale revisions, static layers, ambiguous entrance/exit spans, locked timing, and insufficient composition duration.

## 10. Export and compatibility

Native JSON is the lossless format and contains all artwork. SVG is a static snapshot of the evaluated current frame, embedding PNG pixels and sanitized SVG artwork and emitting native gradient definitions.

Lottie is a supported-subset export, with preflight reporting before download:

- Native shapes/transforms/opacity/easing: required baseline.
- PNG: embedded image assets with animated layer transforms.
- Native gradients: implement and verify geometry, stops, alpha, and animated output against a reference player; unsupported combinations block export with a clear report.
- Text and opaque SVG: offer explicit static-content rasterization for Lottie while retaining animated layer transforms, or report unsupported in strict-vector mode. This is export-only rasterization, never import vectorization; native projects and SVG snapshots retain vector SVG artwork.
- Do not silently drop layers, flatten animated paints, or claim universal Lottie parity. Complex unsupported cases remain available through native JSON and SVG snapshot.

Version transition: retain original v1 records and allow export/open through compatibility routing. Convert static-geometry v1 layers to immutable SVG content plus transform/opacity tracks in a new v2 copy. Preserve all motion samples, including generated keys, unless equivalence is proven. Path-morphing projects cannot migrate losslessly into this model: keep them in the existing editor and explain why. The existing `/legacy` route is for the older source editor, so add separate v1-vector routing rather than repurposing it blindly.

### Google Fonts — required, loaded on demand

- Provide a Figma-like searchable font-family picker covering the Google Fonts catalog, not a small curated/bundled list. Support the available weights, italic styles, and script subsets for the selected family; use variable-font weights where available. Arbitrary variable axes can follow later.
- Fetch font stylesheets/files on demand from Google Fonts; do not bundle font binaries in the application or native project. Lazy-load picker previews only for visible results. Catalog metadata may be cached separately from fonts; refresh it without requiring an application release. Choose the catalog retrieval mechanism during implementation, without exposing private API credentials in the browser or requiring users to supply a key.
- Persist family, weight, style, and font size in text content. Font selection remains a static text property initially, not an animated family switch. Expose these choices to agent layer creation/editing too.
- Await the requested font before measuring or rendering final text; update Fabric text metrics and canvas projection after loading. Show loading/failure states and avoid silently saving fallback measurements as the intended layout.
- A first load requires network access; offline use is limited to fonts already available in the browser cache. Show an explicit unavailable-font warning with retry/fallback controls. Do not promise that all Google Fonts work offline.
- Native projects store font references, so reopening may require fetching fonts again. SVG snapshots must warn when live text depends on external fonts; do not label such exports fully self-contained. Offer explicit text rasterization when a self-contained visual snapshot is needed. Lottie text rasterization must wait for the correct font and block or request an explicit fallback when it cannot load.
- Acceptance: search and use an arbitrary catalog family, switch weight/italic, reopen the project, verify canvas metrics after loading, and test both unavailable-network behavior and exported text appearance. No font binaries should be added to the repository/build bundle.

## 11. Implementation sequence and gates

1. **Model and transaction foundation.** Add v2 typed tracks, gradients, validation, evaluator, locks, and batch/history contracts. Gate: deterministic evaluation and atomic rollback tests pass.
2. **End-to-end rectangle slice.** New motion editor/session, Fabric projection, transform inspector, basic property timeline and playback; add minimal v2 persistence immediately. Gate: animate, scrub, undo, reload a rectangle without v1 changes.
3. **Native content, imports, and paints.** Ellipse/text, on-demand Google Fonts picker, SVG/PNG import, asset lifecycle, gradient inspector/tracks/handles. Gate: imported artwork and animated gradients survive reload and portable native round-trip; arbitrary Google Fonts load with correct text metrics and explicit offline limitations.
4. **Timeline and easing polish.** Multi-select, drag, ranges, keyboard controls, curve inspector, lock controls. Gate: a human can make and revise the demo animation without agent tools.
5. **Surgery engine.** Implement operations in the order above, with endpoint/constraint tests and batches. Gate: stagger + copy easing + overshoot is one undoable transaction and preserves requested finish/pose.
6. **WebMCP and activity UI.** Context-aware tools, text-content lookup and relative sequencing, shared command integration, highlights/history. Gate: “make hello come after Title” resolves native text and changes the correct entrance spans; agent reads a human timing change, revises from the new revision, and stale requests fail cleanly.
7. **Exports and v1 migration.** SVG snapshot, bounded Lottie subset/preflight, safe v1 copy conversion and compatibility routing. Gate: fresh-browser native import has all assets; reference-player checks match supported motion.
8. **Templates and cutover.** Product cards first, then logo reveal, lower third, kinetic title, onboarding. Update README and authoritative spec, route new projects to v2, remove obsolete features from the new surface. Gate: full demo and regression checks pass; v1 originals remain accessible.

Do not begin by deleting the working editor. Build a thin v2 slice beside it, switch new projects once functional, and retire code only after its compatibility responsibility is resolved.

## 12. Validation and demonstration

Extend the current Vitest tests with meaningful coverage of evaluator boundaries, asymmetric easing, gradient stop identity, retiming collisions, relative copy baselines, constraints, atomic batches, asset round-trips, and migration preservation. Reuse relevant command/storage/WebMCP regression cases.

Run `pnpm check`, `pnpm test`, and `pnpm build`. Browser checks cover canvas/timeline agreement, drag undo grouping, async asset loading, gradient appearance, font readiness, malicious/oversized imports, storage failure, export preflight, and human/agent concurrency. Add player-based comparison for supported Lottie exports; passing schema checks alone is insufficient.

Primary demo:

1. Open three poorly timed cards, a title, an imported SVG logo, a PNG image, and an animated native gradient.
2. Agent staggers cards by four frames and copies title easing.
3. Agent adds subtle scale overshoot while preserving final poses and the overall finish.
4. Human drags the middle card's timing.
5. Agent reads the updated context and matches the rhythm while preserving stagger.
6. Undo the agent batch in one step, redo, export, and reopen the project.

The critical path is the property-track/gradient model → usable timeline → constrained transactions → agent surgery. Distribution/normalization and the four additional templates follow the core demo, but remain part of the planned pivot.


## Implementation checkpoint — 2026-08-31

Implemented in `animcp-web/src/lib/features/motion/`: validated v2 property tracks, linear/radial gradient fills, native shapes/text, SVG/PNG asset-backed layers, on-demand Google Fonts, SVG preview, property timeline, curve controls, canvas gradient handles, shared transactions/history/locks, motion operations, text-content lookup and sequencing, real browser WebMCP registration, local storage, native/SVG/Lottie export, five templates, and conservative v1 static-geometry copy import. New projects use `/motion`; previous vector projects remain under `/vector` and their original editor route.

Implementation choices and current limits:

- SVG renders the new preview rather than Fabric, sharing geometry with SVG snapshot export. Fabric stays in the previous editor.
- Gradient fills are implemented. Independent gradient strokes remain a follow-up; stroke color/width are keyframeable.
- The redesigned timeline selects adjacent-key animation segments as bars. Selected bars expose immediate easing and exact timing in Properties. Agent tools retain explicit key/range selection. Pan/zoom of the canvas and a full graph editor are not implemented; timeline zoom and canvas fitting are available.
- Lottie samples at composition FPS rather than preserving cubic segment metadata. Static text/SVG become image assets; unsupported animated paints, off-center radial focus, and overflowing text bounds are rejected. Cross-player visual parity remains unverified and Lottie is labeled experimental.
- Native JSON embeds artwork. SVG snapshots with live text depend on fonts installed/available in the receiving viewer; a self-contained text-rasterized SVG option remains a follow-up.
- v1 static geometry migrates into immutable SVG with frame-sampled motion. Original v1 records remain untouched; path morphs and over-limit copies are rejected. Complex v1 migration needs more browser fixtures before being treated as broadly compatible.
- The public Google Fonts catalog endpoint is isolated behind `/api/fonts`; direct family entry remains available if catalog retrieval fails. Picker previews use UI text rather than downloading every listed font.
- Session history is bounded and not persisted. Reload restores document/assets, not undo history. No deployment was performed.

## Layout and interaction revision — implemented

- Official shadcn Sidebar with collapsible icon rail and Layers / Activity / Composition tabs; pointer-based layer reorder and accessible raise/lower controls.
- Compact floating Lucide toolbar for move, shapes, text, import, undo/redo, WebMCP, and export. Surgery UI removed; agent commands retained.
- Icon-based properties with numeric drag previews and one commit per gesture; click to type, Shift/Alt for coarse/fine adjustment.
- Bottom timeline with nearby transport and shadcn Auto-key checkbox, dark scrollbars, sticky layer labels, horizontal scroll, ruler and playhead scrubbing.
- Animation bars with drag/trim, neighboring-key collision bounds, and immediate easing presets/Bezier controls in the properties panel only.
- Font popover initially lists 16 families, searches the complete online catalog, and loads a chosen family on demand.
- Auto-key seeds frame zero when starting a static track at a later frame, preserving the original pose for interpolation.

Browser verified: sidebar collapse/tab navigation, pointer layer reorder and undo, numeric drag/type and undo/redo, auto-key interpolation, font search/loading, bar movement/trimming, easing application, direct playhead/ruler scrubbing before and after horizontal scrolling, playback, and 38 registered WebMCP tools.
