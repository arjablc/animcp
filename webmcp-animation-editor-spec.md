# AniMCP — WebMCP Vector Animation Editor Specification

**Status:** Archived v1 specification — retained vector editor only. New v2 motion work follows `motion-editor-pivot-plan.md` and the README.
**Version:** 1.0  
**Date:** 2026-08-31  
**Primary application:** `animcp-web`  
**Supersedes:** legacy planning documents

## 1. Product definition

AniMCP is a local-first, browser-based 2D vector animation editor controlled by both a human and an AI agent.

The human gets a normal creative editor:

- canvas
- selection and drawing tools
- layers
- timeline
- playhead
- keyframes
- playback
- project import/export

The AI agent gets a structured WebMCP tool surface for reading and changing the same project.

The application is the editing environment. ChatGPT/Codex is the agent interface and supplies intelligence when available. AniMCP does not contain a chat interface and does not call the OpenAI API in the initial product.

The central product interaction is:

```text
human creates or imports a visual
        ↓
agent edits the same project through WebMCP
        ↓
human scrubs, inspects, and adjusts the result
        ↓
agent continues from the updated project state
```

## 2. Product goals

### 2.1 Required goals

1. Make short vector animations quickly.
2. Make every important editor action available to both the UI and WebMCP.
3. Keep projects usable without authentication, a backend, or an AI API key.
4. Preserve editable vector paths and keyframes as the canonical project data.
5. Support reliable local autosave and project export/import.
6. Provide a credible agent workflow for creating, modifying, and interpolating animation.
7. Keep the core editor open source and suitable for a later hosted SaaS layer.

### 2.2 Success criteria

The first complete version is successful when a user can:

- create a project;
- draw a path with a freehand tool;
- create and edit keyframes;
- scrub and play the timeline;
- move, scale, rotate, recolor, and rename a layer;
- save and reload the project locally;
- export the project and a valid vector output;
- ask an agent to perform the same operations through WebMCP;
- see human and agent edits immediately in the same project.

## 3. Scope and release targets

### 3.1 MVP scope

The MVP supports a deliberately small vector model:

- one composition per project;
- 240–1920px canvas width;
- 240–1080px canvas height;
- 1–60 seconds;
- 12, 15, 24, or 30 FPS;
- 0-based internal frame numbering;
- editable path layers;
- one primary path per layer;
- stroke and optional fill;
- position, rotation, scale, and opacity;
- static layer style properties;
- path keyframes and transform keyframes;
- freehand drawing;
- basic pen/path-point editing;
- timeline scrubbing and playback;
- undo/redo for committed commands;
- local persistence;
- project JSON export/import;
- SVG export for the current frame;
- Lottie export for the supported path subset;
- WebMCP read and mutation tools.

Each freehand stroke creates a layer in the MVP. Multiple paths per layer, grouping, and layer merging are later extensions.

### 3.2 Deferred capabilities

The following are intentionally deferred:

- chat UI;
- server-side AI generation;
- authentication and accounts;
- cloud project storage;
- collaboration;
- audio tracks;
- nested compositions;
- masks and mattes;
- skeletal rigging;
- inverse kinematics;
- graph-based easing editor;
- motion blur;
- complex compositing;
- arbitrary code execution;
- full Illustrator-compatible path editing;
- automatic semantic segmentation of generated illustrations;
- guaranteed MP4/WebM export across browsers;
- mobile-native applications.

## 4. Feasibility and migration decision

This product is feasible in the current repository, but it is a new editor domain rather than a small extension to the existing p5 editor.

### 4.1 Reuse from the current app

Reuse the following foundations from `animcp-web`:

- SvelteKit routing and deployment setup;
- Svelte 5 runes and TypeScript configuration;
- local project-list shell and project navigation;
- existing UI primitives and styling system;
- WebMCP feature detection and registration lifecycle;
- revision-conflict pattern in the command layer;
- health, readiness, and version endpoints;
- test/build tooling and CI conventions.

### 4.2 Replace or retire

The p5-specific editor domain is not the target architecture for this product. Replace or retire these concepts during migration:

- `P5Project`;
- editable p5 source as project state;
- the isolated p5 iframe runtime;
- generated schema-driven p5 controls;
- p5-native Lottie exporters;
- p5-specific WebMCP tools;
- p5 brush runtime loading.

The vector editor should not evaluate arbitrary user or agent-provided JavaScript. The new editor operates on validated structured project data.

### 4.3 Migration approach

Build the vector editor as the authoritative project type. The existing p5 implementation may remain temporarily behind a legacy route while the new editor is stabilized, but it must not share the new vector project schema or renderer.

The primary project route should eventually open the vector editor. Existing p5 projects may be treated as legacy data and removed during the scratch rebuild unless backward compatibility becomes a specific requirement.

## 5. Technology decisions

| Area | Decision |
|---|---|
| Framework | SvelteKit 2 with Svelte 5 |
| Language | TypeScript |
| Build | Vite and pnpm |
| UI state | Svelte 5 rune-based state in `.svelte.ts` modules |
| Renderer | Fabric.js v6 on an interactive HTML canvas |
| Interpolation | Canonical cubic path interpolation; Flubber may be used as a normalization helper |
| Durable storage | IndexedDB, with an application storage adapter |
| Temporary state | In-memory Svelte state; Fabric instances never enter durable state |
| Asset storage | IndexedDB Blobs |
| Agent integration | Feature-detected `document.modelContext` WebMCP |
| Validation | Explicit TypeScript validators; add Zod only if schema complexity warrants it |
| Heavy processing | Web Workers for vectorization and other expensive asset operations |
| Hosting | Existing SvelteKit/Cloudflare deployment |
| Server | SvelteKit endpoints only for the initial release |
| Authentication | None in the initial release |
| AI API | None in the initial release |

Fabric's `Path` constructor accepts path data as a string or complex path array. Its `toSVG()` method returns an SVG representation, so the editor must store canonical path data or the SVG `d` value rather than a complete `toSVG()` result. See the [Fabric Path API](https://fabricjs.com/api/classes/path/).

Fabric v6 also exposes `controlsUtils.createPathControls`, which may provide the baseline point-editing controls. The editor still owns state synchronization, tool behavior, and undo/redo. See [Fabric path controls](https://fabricjs.com/api/fabric/namespaces/controlsutils/functions/createpathcontrols/).

## 6. Architecture

The editor has one source of truth and two command clients.

```text
                  Animation Project State
                            ▲
                            │
                   Editor Command Layer
                     ▲                 ▲
                     │                 │
                Human UI            WebMCP
                     │                 │
                     └──────┬──────────┘
                            │
                    Fabric Renderer
                            │
                         Canvas
```

### 6.1 State rules

1. Project state contains JSON-safe data only.
2. Fabric `Canvas`, `Path`, `Control`, and object references are runtime-only.
3. UI actions call commands.
4. WebMCP tools call the same commands.
5. Commands validate input, update state, create an undo entry, increment the revision, and schedule persistence.
6. The renderer projects state into Fabric objects.
7. Renderer events become commands after a user interaction is committed.
8. No tool may mutate the project object directly.

### 6.2 Runtime projection

The renderer maintains a runtime map:

```ts
Map<LayerId, fabric.Path>
```

At a minimum, it must:

- render the active frame;
- preserve layer ordering;
- apply style and transform;
- show selection state;
- switch drawing/selection/path-editing modes;
- commit user changes only through commands;
- dispose Fabric listeners and the canvas on unmount.

The first implementation may clear and rebuild visible objects when the frame changes. It should use a keyed diff once object count or timeline scrubbing makes rebuilds visibly expensive.

## 7. Canonical project document

The internal format is owned by AniMCP. Lottie and SVG are export formats, not editing formats.

### 7.1 Top-level document

```ts
type AnimationProject = {
  version: 1;
  kind: 'vector-animation';
  id: string;
  name: string;
  canvas: CanvasSettings;
  timeline: TimelineSettings;
  layers: VectorLayer[];
  assets: AssetRecord[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type CanvasSettings = {
  width: number;
  height: number;
  background: string;
};

type TimelineSettings = {
  fps: 12 | 15 | 24 | 30;
  frameCount: number;
};
```

`currentFrame`, selection, zoom, active tool, playback status, and panel layout are UI session state. They do not belong in the durable project document unless a future product requirement makes them part of the saved experience.

### 7.2 Layer

```ts
type VectorLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  style: LayerStyle;
  keyframes: Record<number, ShapeKeyframe>;
};

type LayerStyle = {
  stroke: string;
  strokeWidth: number;
  strokeLineCap: 'butt' | 'round' | 'square';
  strokeLineJoin: 'miter' | 'round' | 'bevel';
  fill: string | null;
  opacity: number;
};

type ShapeKeyframe = {
  paths: PathData[];
  transform: Transform;
  easing: Easing;
  generated?: boolean;
};

type Transform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
};

type Easing =
  | { type: 'linear' }
  | { type: 'hold' }
  | { type: 'bezier'; x1: number; y1: number; x2: number; y2: number };
```

The MVP exposes one path in `paths`. The array is used so the format can add multiple subpaths without another migration.

### 7.3 Path data

The editor's canonical path subset uses absolute coordinates and a restricted command vocabulary:

```ts
type PathData = PathCommand[];

type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };
```

Importers may accept relative commands, quadratic curves, smooth curves, and arcs, but they must normalize them to this subset before the path enters project state. Arc and quadratic conversion belongs in a tested path-normalization module.

Path invariants:

- coordinates are finite numbers;
- commands use absolute canvas coordinates;
- `M` begins every subpath;
- `Z` closes only the current subpath;
- no path exceeds the configured command limit;
- empty paths are rejected;
- a path has no embedded executable content;
- transforms are stored separately from path geometry.

### 7.4 Assets

```ts
type AssetRecord = {
  id: string;
  name: string;
  kind: 'raster' | 'vector';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  width: number;
  height: number;
  byteLength: number;
  source: 'file' | 'webmcp' | 'vectorized';
  blobKey: string;
  createdAt: string;
};
```

Raster assets can be animated as image layers in a later extension. Vectorization is optional and does not happen automatically for every import.

### 7.5 Versioning and migrations

The top-level `version` is mandatory. Any incompatible change requires:

1. a new version number;
2. a pure migration function;
3. malformed-input rejection;
4. tests for old and new documents;
5. a backup or recoverable copy before destructive migration.

## 8. Timeline behavior

### 8.1 Frame model

- Internal frames are integers from `0` through `frameCount - 1`.
- The UI may display frame numbers starting at `1`, but conversion happens at the UI boundary.
- A project has a fixed FPS and frame count in the MVP.
- Playback time is `frame / fps`.
- Scrubbing never changes project revision because it is session state.

### 8.2 Hold behavior

For a layer at frame `f`:

1. If an exact keyframe exists, render it.
2. Otherwise use the nearest earlier keyframe.
3. If no earlier keyframe exists, use the nearest later keyframe only when the layer's first visible frame is later than zero.
4. If no keyframe exists, the layer is invisible.

### 8.3 Interpolation

Between keyframes `a` and `b`:

- transform values interpolate numerically;
- opacity interpolates numerically;
- easing maps normalized frame progress;
- paths interpolate only after normalization to compatible canonical command sequences;
- incompatible path shapes produce a structured error rather than silently corrupting geometry;
- generated in-betweens may be stored as `generated: true`;
- existing user-authored keyframes are not overwritten unless `overwrite: true` is provided.

The interpolation engine must be deterministic. The same project, keyframes, and frame must produce the same output across repeated renders.

## 9. Fabric renderer and tools

### 9.1 Canvas lifecycle

The Fabric canvas is created after the `<canvas>` element is mounted and disposed when the component unmounts.

The component must not create a new Fabric canvas on every reactive state update. Initialization and rendering are separate effects:

- initialization effect: create canvas, configure events, return cleanup;
- projection effect: render the active project frame;
- transient interaction state: keep outside durable project state until commit.

### 9.2 Selection tool

Selection mode supports:

- select one layer;
- move;
- scale;
- rotate;
- delete selected layer;
- lock/visibility restrictions;
- commit a single undoable command on pointer release.

While the pointer is moving, the renderer may update a transient Fabric object without writing every intermediate position to IndexedDB.

### 9.3 Freehand tool

The freehand tool uses Fabric's brush support.

On stroke completion:

1. receive the created Fabric path;
2. extract its path commands;
3. normalize to `PathData`;
4. create a new layer or replace the selected layer according to tool mode;
5. write a keyframe at the current frame;
6. return focus to selection mode if configured;
7. create one undo entry.

Stroke color, width, cap, and join come from the active style controls.

### 9.4 Pen/path-editing tool

The path tool supports:

- selecting a path;
- showing anchor points;
- dragging anchor points;
- editing cubic control handles;
- adding a point only when the path can remain in the canonical subset;
- deleting a point with a confirmation-safe command;
- committing the edited geometry to the current keyframe.

Start with Fabric's path control helper where it provides the required behavior. If the helper does not expose the needed handle model, implement a controlled overlay using Fabric controls. The overlay must update canonical `PathData`, not retain hidden authoritative circles or lines in project state.

### 9.5 Renderer synchronization

Renderer-to-state synchronization must include:

- a guard against projection feedback loops;
- a distinction between state-driven updates and user-driven events;
- object identity by layer ID;
- `setCoords()` after custom control or nonstandard geometry changes where Fabric requires it;
- listener cleanup on object removal and component disposal.

## 10. Shared command layer

The command layer is the application boundary for all state mutations.

### 10.1 Command requirements

Every mutation command must:

- validate its input;
- check an optional `expectedRevision`;
- reject edits during incompatible long-running operations;
- clone or immutably replace affected data;
- update `revision` and `updatedAt`;
- add an undo record;
- schedule durable persistence;
- return a compact result.

Revision conflicts must be explicit and recoverable:

```ts
{
  ok: false,
  category: 'conflict',
  message: 'Revision conflict.',
  currentRevision: 12
}
```

### 10.2 Required commands

Read commands:

- `get_project`
- `get_scene`
- `get_selection`
- `get_timeline`

Project commands:

- `rename_project`
- `update_canvas`
- `update_timeline`

Layer commands:

- `add_layer`
- `remove_layer`
- `rename_layer`
- `set_layer_visibility`
- `set_layer_lock`
- `set_layer_style`
- `reorder_layer`

Keyframe/path commands:

- `set_current_frame`
- `add_keyframe`
- `update_keyframe`
- `delete_keyframe`
- `update_path`
- `generate_inbetweens`
- `clear_generated_inbetweens`

Playback commands:

- `play`
- `pause`
- `restart`

Asset/export commands:

- `import_asset`
- `vectorize_asset`
- `export_project`
- `export_svg`
- `export_lottie`

### 10.3 Undo and redo

Undo/redo is command-based. A drag, point edit, or brush stroke becomes one history entry when committed, not hundreds of pointer-move entries.

Agent commands and human commands share the same history. Undoing an agent action must be no different from undoing a human action.

## 11. WebMCP contract

Feature-detect `document.modelContext`. If unavailable, the editor remains fully functional and displays a non-blocking status.

### 11.1 Registration

Registration must:

- happen after the editor command layer is ready;
- register a stable tool set;
- pass an abort signal when supported;
- clean up or invalidate stale registrations on route teardown;
- never expose Fabric objects or internal references;
- return structured success/error results.

### 11.2 Mutation input conventions

All mutation tools should use:

```ts
type MutationMeta = {
  expectedRevision: number;
  requestId?: string;
};
```

Tool schemas must use `additionalProperties: false` where practical, bounded arrays/strings, enumerated values, and finite-number constraints.

### 11.3 Important tool schemas

#### `get_project`

Returns project metadata, canvas, timeline, layer summaries, revision, current frame, selection, and capabilities. Large path payloads should be returned only when requested or when the agent needs the full scene.

#### `add_layer`

```json
{
  "name": "Pencil stroke",
  "style": {
    "stroke": "#00c3ff",
    "strokeWidth": 4,
    "fill": null
  },
  "expectedRevision": 0
}
```

#### `add_keyframe`

Accepts a layer ID, frame number, canonical path data, transform, and optional style override. The command rejects invalid frames and malformed paths.

#### `generate_inbetweens`

```json
{
  "layerId": "layer_1",
  "startFrame": 0,
  "endFrame": 30,
  "overwrite": false,
  "expectedRevision": 4
}
```

The command requires valid start/end keyframes, compatible paths, and `endFrame > startFrame`.

#### `import_asset`

The public concept is asset import. Base64 is only one transport implementation and must not be part of the tool name.

### 11.4 Tool result shape

Success:

```json
{
  "ok": true,
  "revision": 8,
  "changed": ["layer_1"]
}
```

Failure:

```json
{
  "ok": false,
  "category": "validation",
  "message": "The path contains an unsupported command.",
  "revision": 8
}
```

Tool results must not echo prompts, image bytes, base64 payloads, or full project contents unless the read tool explicitly requests them.

## 12. Asset import and image transport

### 12.1 Manual raster import

The editor may accept PNG, JPEG, or WebP files from a file picker or drag/drop.

Every import must:

1. validate the claimed MIME type;
2. enforce an encoded and decoded byte limit;
3. verify browser decodability;
4. extract dimensions;
5. store the Blob in IndexedDB;
6. create an asset record;
7. revoke temporary object URLs when no longer needed;
8. return metadata, not binary contents.

Initial limit: 10 MiB decoded bytes per raster asset. Adjust only after measured browser behavior and documented review.

### 12.2 Agent-generated image handoff

The desired optional flow is:

```text
agent generates image
        ↓
agent obtains an allowed byte/resource representation
        ↓
WebMCP import_asset
        ↓
browser validates and persists Blob
```

This is an external integration assumption and must be tested in the actual ChatGPT/Codex browser-agent environment. The editor must not claim this flow works until the test passes.

### 12.3 Deterministic transport test

Before depending on generated-image import, verify:

- 1×1, 64×64, 256×256, 512×512, and 1024×1024 PNG fixtures;
- exact decode and dimensions;
- payload scaling from under 10 KB through at least 4 MB encoded;
- retry and duplicate behavior;
- timeout and UI responsiveness;
- actual 512×512 generated-image handoff;
- actual 1024×1024 generated-image handoff when 512 succeeds.

Record browser/version, agent environment, payload sizes, duration buckets, and failure categories. Never record image bytes or prompts.

### 12.4 Transport decision gate

- If direct 512×512 generated-image import succeeds in at least 3 consecutive attempts and at least 80% of a small repeated run, it is acceptable for the demo path.
- If deterministic transport works but the agent cannot access generated-image bytes, keep manual import and investigate browser-local handoff mechanisms.
- If single-call payloads are too large, implement bounded chunking only after measurement.
- If even modest deterministic payloads are unreliable, WebMCP remains an animation-control surface but not the binary asset transport.

### 12.5 Optional chunked fallback

Only implement if the test requires it:

- `begin_asset_import`
- `append_asset_chunk`
- `complete_asset_import`
- `abort_asset_import`

Chunking requirements:

- indexed chunks;
- safe replay of identical chunks;
- rejection of conflicting duplicates;
- bounded transfer count and total size;
- expiration of abandoned transfers;
- final hash/size validation;
- no permanent asset until complete validation succeeds.

### 12.6 SVG security

SVG import is separate from raster import. Do not render arbitrary imported SVG without sanitization. Strip scripts, event attributes, external references, unsafe URLs, and unsupported elements before conversion into project paths.

## 13. Vectorization

Vectorization is an optional asset pipeline, not a prerequisite for drawing vector paths manually.

```text
raster asset
    ↓
optional preprocessing
    ↓
VTracer or equivalent WASM worker
    ↓
sanitized SVG
    ↓
canonical PathData
    ↓
editable vector layer(s)
```

Requirements:

- run expensive processing in a Web Worker;
- make the operation cancelable;
- report progress;
- enforce input/output limits;
- sanitize SVG before parsing;
- simplify excessive path complexity;
- preserve the source raster asset;
- make vectorization failure recoverable.

Vectorization does not infer semantic parts. A character image does not automatically become head, arm, hand, and pencil layers.

## 14. Export

### 14.1 Native project export

Export the canonical document as:

```text
<safe-project-name>.animcp.json
```

Import must validate the full document before replacing the current project. Import should offer a recoverable error and must not partially mutate project state.

### 14.2 SVG export

Export the visible state at the current frame as sanitized SVG. The output must include:

- canvas dimensions;
- background;
- layer order;
- path geometry;
- stroke/fill/style;
- transforms;
- opacity.

### 14.3 Lottie export

Lottie export is supported for the canonical MVP path subset.

The exporter must:

- generate valid document timing from FPS and frame count;
- map cubic path vertices and in/out tangents correctly;
- preserve closed paths;
- preserve layer order and visibility;
- map transform and opacity keyframes;
- validate dimensions, layer count, and JSON size;
- reject unsupported path structures with a clear error;
- include unit tests for straight lines, cubic curves, multiple subpaths, closed paths, and animated transforms.

The exporter must not rely on `Path.toSVG()` as its intermediate editing representation.

### 14.4 Video export

Browser video recording is not part of the initial acceptance bar. Add it only after deterministic vector export works and only with an explicit supported-format policy. Do not label a browser-generated WebM as MP4.

## 15. Persistence

### 15.1 IndexedDB model

Use an application storage adapter with separate logical stores:

- `projects`: project metadata and JSON document;
- `assets`: Blob data and asset metadata;
- `snapshots`: optional recovery/undo snapshots;
- `transfers`: temporary chunked imports, if enabled.

The editor remains usable when persistence is unavailable for the current session, but it must show a visible unsaved/error state.

### 15.2 Autosave

- update in-memory state immediately;
- debounce durable writes;
- flush on page visibility change and before unload where possible;
- avoid writing on every pointer movement;
- retain the last successfully persisted revision;
- surface storage quota failures.

### 15.3 Project list

The home page lists local projects by metadata only. Opening a project loads the document and required asset records. Deleting a project removes its project record and associated assets after the target IDs have been resolved.

## 16. User interface specification

### 16.1 Composition layout

Desktop layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ project name · undo/redo · playback · export · WebMCP state │
├──────────────┬──────────────────────────┬───────────────────┤
│ tools/assets │          canvas          │ layers/properties │
├──────────────┴──────────────────────────┴───────────────────┤
│ timeline: ruler · tracks · keyframes · playhead             │
└─────────────────────────────────────────────────────────────┘
```

Mobile may collapse panels into tabs, but the canvas, current frame, and primary playback controls must remain accessible.

### 16.2 Required panels

- toolbar: select, pencil, pen, hand/pan, delete;
- canvas viewport: zoom, pan, fit-to-view;
- layers: select, reorder, visibility, lock, rename;
- properties: style and transform values;
- timeline: frame ruler, layer rows, keyframe markers, playhead;
- status: save state, revision, WebMCP availability, recoverable errors.

### 16.3 Keyboard behavior

Minimum shortcuts:

- Space: play/pause;
- `V`: selection tool;
- `P`: pen tool;
- `B`: freehand tool;
- Delete/Backspace: delete selected layer or point;
- Cmd/Ctrl+Z: undo;
- Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y: redo;
- left/right arrows: move one frame;
- Shift+left/right: move ten frames.

Shortcuts must not interfere with text inputs.

### 16.4 Accessibility

- visible focus styles;
- labels for all controls;
- keyboard access to timeline and properties;
- status messages exposed to assistive technology;
- sufficient contrast;
- no essential action available only through pointer gestures.

## 17. Reliability, security, and privacy

### 17.1 Reliability

- validate every imported project and tool input;
- use stable IDs;
- detect corrupted storage records;
- keep command operations deterministic;
- reject revision conflicts instead of silently overwriting changes;
- make long operations cancelable;
- keep failed operations from leaving partial project state;
- provide a recovery path for failed saves and imports.

### 17.2 Security

- do not evaluate arbitrary source code;
- do not trust WebMCP input;
- cap path commands, layer counts, frame counts, and asset sizes;
- sanitize SVG separately from raster import;
- apply a restrictive production CSP;
- do not log image bytes, base64, prompts, SVG content, or full project data;
- keep external requests disabled unless a feature explicitly requires them.

### 17.3 Privacy

The initial product is local-first and does not require an account. Analytics, if enabled, must describe workflow events rather than creative content.

## 18. Analytics and operations

Analytics are optional after the editor workflow is stable.

### 18.1 Cloudflare Web Analytics

Use for aggregate traffic and real-user performance if enabled by the deployment.

### 18.2 GA4 product events

Use a small typed wrapper for:

- `editor_opened`;
- `webmcp_supported`;
- `webmcp_tools_registered`;
- `webmcp_tool_succeeded`;
- `webmcp_tool_failed`;
- `asset_import_started`;
- `asset_import_succeeded`;
- `asset_import_failed`;
- `asset_vectorization_started`;
- `asset_vectorization_succeeded`;
- `asset_vectorization_failed`;
- `layer_created`;
- `keyframe_created`;
- `timeline_played`;
- `project_exported`;
- `manual_edit_after_agent_edit`;
- `agent_edit_after_manual_edit`.

Permitted parameters are low-cardinality metadata such as tool name, resolution bucket, size bucket, duration bucket, source type, and error category. Do not send arbitrary tool arguments.

If consent is required for the deployment jurisdiction, implement an appropriate consent flow before behavioral analytics.

### 18.3 Existing server endpoints

Keep the current SvelteKit operational endpoints:

- `GET /healthz`;
- `GET /readyz`;
- `GET /api/v1/version`.

Do not add a general backend or database for the MVP. A first-party telemetry endpoint is optional and must not receive creative content.

## 19. Testing specification

### 19.1 Unit tests

Cover:

- path normalization;
- path validation;
- path interpolation;
- easing;
- frame lookup and hold behavior;
- layer ordering;
- command validation;
- revision conflicts;
- undo/redo;
- project migrations;
- IndexedDB serialization boundaries;
- PNG import validation;
- Lottie conversion and validation.

### 19.2 Component tests

Cover:

- canvas mount/dispose;
- current-frame projection;
- selection and property editing;
- timeline scrubbing;
- keyframe creation/removal;
- playhead movement;
- layer visibility/lock behavior;
- import/export error states;
- save status.

### 19.3 WebMCP tests

Use a mock `document.modelContext` to verify:

- registration;
- schemas;
- tool names;
- successful command execution;
- malformed input handling;
- revision conflicts;
- cleanup/abort behavior;
- identical state transitions between UI and WebMCP.

### 19.4 Browser/E2E tests

At minimum:

1. create a project;
2. draw a path;
3. add a second keyframe;
4. scrub and play;
5. reload and recover the project;
6. export and reimport JSON;
7. export SVG;
8. export Lottie;
9. invoke a WebMCP mutation and observe the same canvas/timeline result;
10. reject a malformed or oversized asset without corrupting the project.

### 19.5 Acceptance thresholds

- no TypeScript/Svelte diagnostics;
- all unit/component tests pass;
- production build passes;
- no uncaught errors during the core E2E flow;
- save/reload preserves geometry, styles, keyframes, and timeline settings;
- three consecutive successful WebMCP mutation runs in the target browser-agent environment;
- no creative payloads appear in logs or analytics fixtures.

## 20. Implementation phases

### Phase 0 — canonical model and risk probes

- define `AnimationProject` v1;
- define path normalization and validation;
- define command result/error types;
- prove Fabric v6 can render and edit the chosen path subset;
- run deterministic WebMCP asset transport fixtures;
- do not build the full timeline before the path model is stable.

### Phase 1 — renderer and commands

- create project state module;
- create command layer;
- mount Fabric canvas;
- render one static path layer;
- add selection, transform, and style commands;
- add unit tests.

### Phase 2 — drawing and timeline

- freehand tool;
- pen/path controls;
- layers panel;
- timeline ruler and playhead;
- keyframe creation/deletion;
- frame projection;
- playback clock;
- undo/redo.

### Phase 3 — interpolation and export

- canonical cubic interpolation;
- generated in-betweens;
- project JSON export/import;
- current-frame SVG export;
- supported-subset Lottie export;
- strict exporter tests.

### Phase 4 — WebMCP

- read tools;
- layer and keyframe mutation tools;
- timeline/playback tools;
- revision conflict handling;
- same-command verification between UI and agent.

### Phase 5 — assets and vectorization

- manual raster import;
- IndexedDB Blob storage;
- optional agent `import_asset`;
- Web Worker vectorization;
- SVG sanitization and path conversion.

### Phase 6 — reliability and polish

- persistence recovery;
- performance profiling;
- keyboard/accessibility pass;
- analytics and consent if required;
- demo projects;
- public documentation and deployment.

## 21. Demo scenario

The primary demo should demonstrate shared state, not a one-shot tool call.

Example request:

> Create a simple pencil stroke animation. Start with a short stroke at frame 0, extend it through frame 30, and ease gently into the final position. Use a cyan stroke on a dark background.

Expected sequence:

```text
agent creates or imports path
        ↓
agent adds layer and keyframes
        ↓
human scrubs the timeline
        ↓
human edits a point or transform
        ↓
agent reads the new revision
        ↓
agent generates or adjusts in-betweens
        ↓
human exports the result
```

The demo must show the editor as a useful application even when WebMCP is unavailable.

## 22. Repository direction

The current application lives under `animcp-web`. The vector editor should be organized around features and domain modules rather than the old p5 runtime:

```text
animcp-web/src/lib/
├── features/
│   ├── animation/
│   │   ├── model.ts
│   │   ├── validation.ts
│   │   ├── interpolation.ts
│   │   ├── commands.ts
│   │   ├── state.svelte.ts
│   │   └── migrations.ts
│   ├── canvas/
│   │   ├── FabricCanvas.svelte
│   │   ├── projection.ts
│   │   ├── path-controls.ts
│   │   └── brushes.ts
│   ├── timeline/
│   ├── layers/
│   ├── assets/
│   ├── export/
│   ├── persistence/
│   └── webmcp/
└── components/
```

The exact file split may change during implementation. The boundaries do not:

- domain model is renderer-independent;
- commands are client-independent;
- Fabric is a renderer, not storage;
- WebMCP is an adapter, not business logic;
- persistence is behind an adapter.

## 23. Post-MVP hosted product path

When hosted capabilities become valuable, add services around the local editor:

1. authentication;
2. cloud project synchronization;
3. object storage for assets;
4. shareable read-only links;
5. project history and snapshots;
6. usage limits;
7. billing;
8. optional hosted generation;
9. collaboration and teams.

These services must extend the local project and command model rather than replace it.

## 24. Definition of done

The specification is implemented when:

- a vector project can be created and reloaded locally;
- the canvas renders canonical path layers through Fabric;
- freehand and pen editing create valid project data;
- transforms and styles are editable;
- timeline scrubbing and playback render the correct frame;
- keyframes and in-betweens are deterministic;
- undo/redo works for UI and WebMCP actions;
- WebMCP tools execute shared commands with revision protection;
- project JSON export/import round-trips successfully;
- SVG export is correct for the current frame;
- Lottie export passes the supported-subset tests;
- malformed assets and tool inputs fail safely;
- no arbitrary code execution exists in the vector editor;
- all checks, tests, and production build pass;
- the generated-image transport decision is documented as supported, fallback-only, or not supported.

## 25. References

- [Fabric.js Path API](https://fabricjs.com/api/classes/path/)
- [Fabric.js path controls](https://fabricjs.com/api/fabric/namespaces/controlsutils/functions/createpathcontrols/)
- [Fabric.js custom controls](https://fabricjs.com/demos/custom-controls/)
- [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/)


See this is not what I wanted

- The editor is fine
- In the timeline there we can create a flip book: which will not be keyframes but actual frame
- We will specify what happens give the end position
- Then the mcp will create the in between animations. 

Currently it just looks like some generic ass animation with keframes thingy. 

The changes that needs to be made: 
- Remove keyframing from the ui
- The user creates/draws somthing say on frame 1 
- And then the user creates something else in frame 2 
- The ai's job is to go from frame 1 to frame 2
- The user is able to specify what happens in between as well. 

Can you build that ? 
The ui: 
Others the same: 
timeline, with the ability to add frames, also the ability to tell 
