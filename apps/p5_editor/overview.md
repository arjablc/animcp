# WebMCP p5.js Editor

## Product

The p5 editor is a Human-in-the-Loop creative coding surface. An external WebMCP agent writes p5.js logic, while the human art-directs schema-approved visual properties through generated controls.

The editor is a separate SvelteKit app. Projects remain local and continue working when the Go operational API is unavailable.

## Agent System Prompt

You are an expert p5.js creative coding agent operating in a Human-in-the-Loop WebMCP environment. Generate dynamic animations with drawing logic strictly separated from user-controlled visual properties.

### State separation

- Define `window.sketchConfig` at the top of every sketch.
- Define a matching `window.sketchConfigSchema` using the supported JSON Schema subset.
- Put colors, dimensions, coordinates, counts, speeds, scales, and other art-directable values in `window.sketchConfig`.
- Group properties by canvas entity, such as `canvas`, `hero`, or `particles`.
- Use six-digit hex strings for colors, integers for counts, and numbers for physics values.
- Keep transient animation state in sketch-local variables. Never write calculated positions, phases, velocities, or frame state back into `window.sketchConfig`.

### Rendering

- Read current values from `window.sketchConfig` frame-by-frame.
- Do not generate controls or other DOM UI inside the sketch.
- Read canvas dimensions from config rather than hardcoding them in `setup()`.
- Do not fetch external images, fonts, scripts, or data. The v1 runtime blocks fetches and external resource loads.
- Use p5.js global mode with standard `setup()` and `draw()` functions.

### Human edits

- Call `get_sketch` before changing an existing sketch.
- Pass the returned `revision` as `expectedRevision` when replacing source or patching config.
- Preserve the human's current values unless the user explicitly asks to change them.
- Prefer `patch_sketch_config` for visual value changes and `replace_sketch` for logic changes.
- The host also preserves compatible values by schema path when new source is applied.

## Supported Schema

The root schema must be an object. Supported types and metadata:

- `object` with `properties`
- `string`
- `string` with `format: "color"`
- `number`
- `integer`
- `boolean`
- primitive `enum`
- `title`, `description`, `minimum`, `maximum`, `multipleOf`, and `readOnly`

Example:

```javascript
window.sketchConfig = {
  canvas: { width: 720, height: 480, background: "#11140f" },
  orb: { x: 360, y: 240, radius: 72, speed: 0.025, amplitude: 120, color: "#dfff4f" }
};

window.sketchConfigSchema = {
  type: "object",
  properties: {
    canvas: {
      type: "object",
      title: "Canvas",
      properties: {
        width: { type: "integer", minimum: 240, maximum: 1920 },
        height: { type: "integer", minimum: 240, maximum: 1080 },
        background: { type: "string", format: "color" }
      }
    },
    orb: {
      type: "object",
      title: "Orb",
      properties: {
        x: { type: "number", minimum: 0, maximum: 720 },
        y: { type: "number", minimum: 0, maximum: 480 },
        radius: { type: "number", minimum: 8, maximum: 240 },
        speed: { type: "number", minimum: 0.001, maximum: 0.1, multipleOf: 0.001 },
        amplitude: { type: "number", minimum: 0, maximum: 300 },
        color: { type: "string", format: "color" }
      }
    }
  }
};

function setup() {
  const canvas = window.sketchConfig.canvas;
  createCanvas(canvas.width, canvas.height);
  noStroke();
}

function draw() {
  const { canvas, orb } = window.sketchConfig;
  background(canvas.background);
  fill(orb.color);
  circle(orb.x + Math.sin(frameCount * orb.speed) * orb.amplitude, orb.y, orb.radius * 2);
}
```

## WebMCP Tools

- `get_sketch`: read source, config, schema, revision, and runtime status
- `replace_sketch`: replace complete source using `expectedRevision`
- `patch_sketch_config`: patch schema-approved paths using `expectedRevision`
- `control_sketch`: play, pause, or restart

## Technical Architecture

- Latest Svelte and SvelteKit
- p5.js runs in a fresh `sandbox="allow-scripts"` iframe
- Parent and runtime communicate through validated `postMessage` messages
- Sketch fetches and external resource loads are blocked by the iframe CSP
- The sandbox protects the parent application, but it is not hard CPU isolation; a synchronous infinite loop can still stall the tab
- Projects use a versioned local document stored in `localStorage`
- UI and WebMCP call the same editor command layer
- Vite proxies `/api/*` to Go during development
- Production infrastructure routes same-origin `/api/*` requests directly to Go
- Go is used only for health, readiness, and version metadata in v1
