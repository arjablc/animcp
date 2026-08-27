# WebMCP Generated-Image Transport Test Plan

**Project:** WebMCP Animation Editor  
**Status:** Must be executed before depending on agent-generated image import  
**Date:** 2026-08-27

---

## 1. Why This Test Exists

The product's intended zero-OpenAI-API flow depends on a specific capability:

```text
ChatGPT / Codex
      │
      ├── generates an image
      │
      ├── obtains/represents the generated image bytes
      │
      ▼
WebMCP tool invocation
      │
      ▼
our page reconstructs the PNG
```

The WebMCP side is capable of receiving JSON-serializable tool arguments. A base64 string can therefore be represented in a tool argument.

However, the key uncertainty is **not merely whether JavaScript can decode base64**.

The actual uncertainty is whether the current ChatGPT/Codex + browser-agent environment can reliably take an image it generated and pass the complete encoded bytes into a WebMCP tool call at useful image sizes.

The current WebMCP draft defines JSON-schema-described tools and JSON-parsed input objects. It does not define a dedicated first-class binary/file parameter for this use case.

Therefore base64 transport is a deliberate application-level workaround and must be validated empirically.

### If we skip this test

We risk building the whole editor around this assumption:

```text
"the agent can simply send us the generated PNG"
```

and discovering late in the hackathon that:

- the agent cannot access generated image bytes
- tool arguments are truncated
- large strings exceed practical limits
- the agent refuses or fails to reproduce exact bytes
- encoding is corrupted
- transfer latency is unacceptable
- generated image data is available only as an internal attachment/file object that WebMCP cannot directly inject

That would break the central zero-API-key demo flow.

The test exists to turn that assumption into evidence.

---

## 2. What We Are Testing

This plan separates the problem into four layers.

### Layer A — our importer

Can our page correctly accept, validate, decode, and persist a base64 PNG passed through a WebMCP tool?

This is completely under our control.

### Layer B — WebMCP argument transport

Can a realistic encoded payload survive a WebMCP invocation without truncation or corruption?

### Layer C — agent file handoff

Can ChatGPT/Codex obtain the bytes or equivalent encoded representation of an image it has generated and place them into the tool argument?

This is the most important uncertainty.

### Layer D — realistic production behavior

Is the complete interaction reliable and responsive enough to use in the hackathon demo?

---

## 3. Core Hypotheses

### H1 — importer correctness

A known valid base64 PNG passed into `import_asset` is reconstructed into a valid PNG Blob with the expected dimensions.

### H2 — exact transport

WebMCP can carry the complete encoded payload without modification at useful payload sizes.

### H3 — generated-image bridge

The current ChatGPT/Codex environment can take an image it generated and invoke `import_asset` with enough image data to recreate it.

### H4 — 512px is reliable

A realistic 512×512 transparent or simple illustrated PNG can be imported reliably in the target judge environment.

### H5 — 1024px is feasible or gracefully downgraded

1024×1024 import either works reliably or the product can intentionally request/use a smaller image without breaking the experience.

### H6 — retries are safe

A repeated or retried invocation does not create uncontrolled duplicate assets.

### H7 — chunking is a viable fallback

If a single large tool argument fails, the same bytes can be transferred through bounded chunks without requiring an AI API or cloud file backend.

---

## 4. Test Environment

Run the test in the **same environment expected for judging**, not only in a normal browser tab.

Record for each run:

- date
- browser/version
- WebMCP implementation/version if visible
- ChatGPT/Codex environment used
- whether WebMCP is native, experimental, polyfilled, or site-tool-provided
- operating system
- frontend build commit

WebMCP is still a Community Group draft and can change quickly. Compatibility with the actual agent surface is more important than compatibility with an isolated JavaScript mock.

---

## 5. Minimal Test Harness

Build this before the full timeline editor.

The page only needs:

```text
WebMCP status
registered-tool status
asset list
import progress
image preview
metadata/result panel
```

### Primary tool

Conceptual schema:

```ts
import_asset({
  transferId: string,
  name?: string,
  mimeType: "image/png",
  encoding: "base64",
  data: string,
  expectedBytes?: number,
  sha256?: string
})
```

The tool should return a small structured result such as:

```json
{
  "ok": true,
  "assetId": "asset_123",
  "decodedBytes": 482913,
  "width": 512,
  "height": 512,
  "mimeType": "image/png"
}
```

Never echo the base64 payload in the result.

---

## 6. Importer Validation Steps

For every import:

1. Validate `mimeType` against allowlist.
2. Reject blank or malformed base64.
3. Check encoded-length limit before allocating large buffers.
4. Decode base64 to bytes.
5. Enforce decoded byte-size limit.
6. Verify PNG signature.
7. Construct a Blob.
8. Decode with browser image APIs (`createImageBitmap` or `<img>` decode).
9. Extract width/height.
10. Optionally calculate SHA-256 with `crypto.subtle.digest`.
11. Persist the Blob in IndexedDB.
12. Render preview.
13. Return metadata only.

### Recommended initial hard limit

Start with a conservative decoded size limit such as **10 MiB per image** for the experiment.

The final production limit can be lowered after real payload measurements.

---

## 7. Stage 1 — Deterministic Fixture Tests

Do not start by asking the agent to generate an image.

First prove that the importer and WebMCP path work with known bytes.

Why:

If the generated-image test fails immediately, we need to know whether the failure is:

```text
our importer
vs
WebMCP transport
vs
agent access to generated image bytes
```

Known fixtures isolate the first two.

### Fixture set

Prepare PNG fixtures with known SHA-256 values.

| Fixture | Purpose |
|---|---|
| 1×1 PNG | absolute minimum handshake |
| 64×64 transparent line art | tiny realistic alpha image |
| 256×256 transparent illustration | small useful image |
| 512×512 transparent line art | primary target for Draw Mind-like assets |
| 512×512 full-color image | poorer compression / larger payload |
| 1024×1024 transparent illustration | upper realistic target |
| intentionally invalid/truncated PNG | validation/error path |

Record actual binary and base64 sizes rather than assuming them from dimensions.

### Pass condition

For each valid fixture:

- reconstructed PNG decodes
- dimensions match
- SHA-256 matches source when a source hash is available
- no payload truncation
- no duplicate asset on idempotent retry

---

## 8. Stage 2 — Payload Scaling Test

Goal: determine the practical single-tool-call payload envelope.

Test increasing encoded payload sizes.

Suggested sequence:

```text
< 10 KB
~ 50 KB
~ 100 KB
~ 250 KB
~ 500 KB
~ 1 MB
~ 2 MB
~ 4 MB
```

Do not manufacture claims about a WebMCP maximum. Measure the actual environment.

For each size record:

- encoded length
- decoded byte count
- call success/failure
- transfer/tool execution duration
- whether string was truncated
- whether browser UI remained responsive
- error category

### Important

Base64 increases binary size by roughly one third, so practical tool-argument size is more important than raw PNG size.

---

## 9. Stage 3 — Actual AI-Generated Image Test

Only after fixture transport works.

Ask ChatGPT/Codex to generate an image specifically suited to the project:

> Generate a 512×512 transparent PNG of a simple pencil in clean flat illustration style, isolated subject, limited palette, no texture, no shadow.

Then request that it import the generated asset through the registered `import_asset` WebMCP tool.

### What this stage answers

This does **not** merely test image generation.

It answers:

> Can the agent bridge its generated image artifact into our page's WebMCP JSON tool arguments?

That is the critical product assumption.

### Test variants

Run at least:

1. simple transparent pencil
2. transparent hand + pencil
3. simple colored object
4. more complex illustrated character/object
5. 1024×1024 version if 512 succeeds

---

## 10. Repetition / Reliability Test

A one-time success is not enough for a live demo.

For the main 512×512 generated-image path:

- run at least **5 independent attempts**
- prefer **3 consecutive successes** before treating the path as demo-ready
- repeat after browser refresh
- repeat in a fresh project/session

Record failure modes rather than manually rescuing failed runs.

---

## 11. Success Metrics

Separate image generation time from transport time.

### Required for v0

For the primary 512×512 workflow:

- generated image can be imported without manual downloading/uploading
- image reconstructs and decodes successfully
- no visible corruption
- no truncation
- editor remains usable after import
- repeated imports do not crash the page
- failure returns a recoverable error rather than leaving half-created project state

### Reliability target

Before committing the demo to the direct single-call path:

- at least 3 consecutive successful real generated-image imports
- at least 80% success across the small test run

This is not a universal production SLA; it is a minimum confidence gate for the hackathon integration.

### Preferred

- 1024×1024 also works
- transfer overhead is acceptable compared with image generation time
- no chunking required for the normal 512px path

---

## 12. Failure Categories

Use explicit error categories.

### `AGENT_CANNOT_ACCESS_IMAGE_BYTES`

The agent has an image artifact but cannot obtain a representation it can place into the WebMCP call.

This is the most serious failure.

### `TOOL_ARGUMENT_TOO_LARGE`

The agent can produce the data but the invocation fails beyond a practical payload size.

### `PAYLOAD_TRUNCATED`

Tool executes but bytes/base64 are incomplete.

### `INVALID_BASE64`

Payload arrives but cannot be decoded.

### `INVALID_IMAGE`

Base64 decodes but image signature or decode fails.

### `HASH_MISMATCH`

Transport altered/truncated the exact bytes.

### `IMPORT_TIMEOUT`

Transport/tool execution takes too long or never completes.

### `DUPLICATE_RETRY`

An agent retry creates multiple unintended copies.

### `UI_BLOCKED`

Decode/storage causes unacceptable main-thread blocking.

---

## 13. Chunked Fallback Protocol

Do not implement chunking unless the direct single-call test shows a need.

If needed, use:

### `begin_asset_import`

```ts
{
  transferId: string,
  mimeType: "image/png",
  totalChunks: number,
  expectedBytes?: number,
  sha256?: string
}
```

### `append_asset_chunk`

```ts
{
  transferId: string,
  index: number,
  data: string
}
```

### `complete_asset_import`

```ts
{
  transferId: string
}
```

### `abort_asset_import`

```ts
{
  transferId: string
}
```

Browser keeps temporary chunks keyed by `transferId` and commits an asset only after successful completion/validation.

### Chunking requirements

- chunks must be ordered or explicitly indexed
- reject duplicate conflicting chunks
- allow safe replay of an identical chunk
- cap number of chunks
- expire abandoned transfers
- compute final size/hash before commit
- create no permanent asset until validation succeeds

---

## 14. Alternative Browser-Local Fallbacks

If direct base64 injection is awkward but the agent can expose the generated image through another browser-accessible mechanism, evaluate these in order:

1. browser-local file/attachment handoff supported by the agent environment
2. temporary accessible resource/URL if the environment provides one safely
3. clipboard/paste integration
4. drag/drop/manual upload as a user fallback
5. chunked base64 WebMCP transport

The goal is still to avoid a paid model API.

Do not add an OpenAI-funded generation backend simply because the first base64 implementation is inconvenient.

---

## 15. Go Backend and This Test

The Go backend should **not** be involved in image transport during this experiment.

Why:

- we are testing whether a backendless AI → WebMCP → browser handoff is viable
- involving the backend would hide the exact integration risk we need to measure
- image data is intentionally local during judging
- sending large generated assets through the telemetry API would create unnecessary privacy/storage/security concerns

The backend may receive a tiny anonymous test event such as:

```json
{
  "event": "image_transport_test_completed",
  "success": true,
  "transport": "single_call_base64",
  "size_bucket": "500kb_1mb",
  "resolution": "512x512",
  "error_category": null
}
```

It must never receive the image payload itself as analytics.

---

## 16. Analytics for the Experiment

Track metadata only.

Useful fields:

- transport mode (`single_call_base64`, `chunked_base64`)
- source (`fixture`, `agent_generated`)
- resolution bucket
- payload-size bucket
- success/failure
- duration bucket
- error category
- retry count

Do not track:

- image bytes
- base64
- generated prompt text
- actual image content
- project contents

---

## 17. Security Tests

Verify that the importer rejects:

- non-image MIME types
- malformed base64
- oversized payloads
- a base64 string that decodes to non-PNG bytes while claiming `image/png`
- truncated PNG
- absurd dimensions designed to exhaust resources
- duplicate/conflicting chunk indexes
- commit of incomplete chunk transfer

Never render arbitrary SVG received through this PNG importer.

When SVG import is later supported, sanitize it separately because SVG is active document content and has different security concerns from decoded raster images.

---

## 18. Performance Tests

Measure:

- base64 decode duration
- image decode duration
- IndexedDB write duration
- memory spike
- main-thread blocking

If decoding large base64 payloads noticeably blocks rendering, move conversion/processing into a Web Worker where practical.

VTracer vectorization must already run in a Web Worker and is measured separately from transport.

---

## 19. Go / No-Go Decision Tree

### Case A — direct generated-image import works reliably

**Decision: GO.**

Use single-call `import_asset` for normal generated PNGs.

Keep chunking unimplemented unless later measurements require it.

### Case B — deterministic base64 works, generated-image bytes are unavailable to the agent

**Decision: NO-GO for automatic generated-image handoff as currently designed.**

The problem is outside our importer.

Investigate agent-provided attachment/file/URL/clipboard handoff before changing architecture.

Do not claim automatic generated-image import in the demo until proven.

### Case C — small generated images work but realistic images exceed argument limits

**Decision: CONDITIONAL GO.**

Implement chunked base64 transport and retest.

If chunking reaches the required reliability, use it.

### Case D — 512 works, 1024 fails

**Decision: GO for MVP.**

Standardize generated assets around 512px during judging.

The assets are intended for vectorization, so 1024px is desirable but not a blocker if 512px produces usable tracing quality.

### Case E — tool transport itself is unreliable even for modest fixtures

**Decision: STOP depending on WebMCP for binary payload transport.**

Keep WebMCP for animation commands and use another agent/browser-local asset handoff mechanism.

### Case F — no automatic agent handoff path is available

**Decision: retain manual import as fallback, but reassess the hackathon demo story.**

The editor is still useful, but the intended zero-friction "generate → import → animate" loop is materially weaker.

---

## 20. Definition of Done

This investigation is complete when we have written evidence for all of the following:

- [ ] WebMCP fixture import works.
- [ ] Known bytes reconstruct exactly for representative fixtures.
- [ ] Practical single-call payload envelope is measured.
- [ ] Real ChatGPT/Codex-generated image handoff has been tested.
- [ ] 512×512 generated image outcome is known.
- [ ] 1024×1024 generated image outcome is known.
- [ ] Retry/idempotency behavior is known.
- [ ] Failure categories are implemented.
- [ ] Decision made: single-call vs chunked vs alternate handoff.
- [ ] Analytics contain metadata only, never image contents.
- [ ] Final transport choice is documented in the main project plan.

---

## 21. Recommended Order of Work

```text
1. 1×1 fixture
2. 64×64 fixture
3. 256×256 fixture
4. 512×512 fixture
5. 1024×1024 fixture
6. payload scaling test
7. real 512×512 agent-generated PNG
8. repeat reliability run
9. real 1024×1024 agent-generated PNG
10. implement chunking only if necessary
11. lock transport architecture
12. continue full editor build
```

Do this before investing deeply in the animation timeline because this is the highest-risk assumption that the rest of the product does not control.

---

## 22. Final Reason We Are Testing This

The product thesis is not merely:

> "WebMCP can call JavaScript functions."

That part is already what WebMCP is designed to do.

The risky thesis is:

> "An AI agent that generated a raster image can hand that generated asset into our live webpage through the current WebMCP/tool environment without our application paying for the model API or running an image-generation backend."

If true, this gives the project an unusually clean architecture:

```text
user's agent supplies intelligence + image generation
our browser app supplies editing + vectorization + animation
```

If false, we need to know immediately because it changes the most compelling end-to-end workflow.

That is why this experiment is Phase 0 rather than a late integration test.

---

## 23. References / Current Platform Note

Checked 2026-08-27:

- WebMCP Community Group draft, 26 Aug 2026: https://webmachinelearning.github.io/webmcp/

The WebMCP document explicitly describes `document.modelContext`, JSON-schema-described tool inputs, and JSON parsing of tool input arguments. The specification is a Community Group report rather than a W3C Standard, so this project should expect integration details to evolve.

