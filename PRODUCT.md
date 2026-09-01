# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Designers creating motion graphics who need a precise, lightweight timeline without moving into a full video-production tool.

## Product Purpose

AniMCP is a browser-based motion graphics editor for creating and revising animated compositions. Users create or import a composition, work with layers and keyframes, preview motion, and export or save their work for the next revision.

## Positioning

AniMCP exposes the shared editor through WebMCP, so a designer and an agent can work on the same composition. Agent edits are explicit, revision-aware, undoable, and respect author-defined locks.

## Operating Context

Users work in a timeline editor with layered text, shapes, SVG, and PNG assets. They adjust composition settings, motion properties, keyframes, easing, gradients, and timing relationships; projects can start blank, from a template, or from an imported `.animcp.json` file.

## Capabilities and Constraints

- Browser projects are saved locally on the device with IndexedDB; there are no accounts or cloud-sync capabilities in the current product.
- Supported motion-layer types are rectangles, ellipses, text, SVG, and PNG.
- The editor supports property animation, linear, hold, Bezier, and spring easing, layer locks, and project/layer/keyframe limits for reliability.
- Current composition limits are 240-1920 px per dimension, supported frame rates of 12, 15, 24, 30, or 60 fps, and a maximum duration of 60 seconds.
- Import accepts JSON project files; the interface advertises SVG and PNG asset support plus Google Fonts.
- Preserve an approachable editor while retaining timeline and layer precision.

## Brand Commitments

- Product name: AniMCP.
- Product voice: human intent, precise motion, and designer control while collaborating with an agent.
- Existing product copy must not imply accounts, cloud sync, teams, or server-side agent control.

## Evidence on Hand

- Existing product interface and factual copy: `src/lib/features/motion/components/MotionLibrary.svelte`.
- WebMCP tool implementation: `src/lib/features/motion/webmcp.ts`.
- Local project persistence: `src/lib/features/motion/storage.ts`.
- Existing assets: `src/lib/assets/studio.png`, `static/og.svg`, and `static/favicon.svg`.
- No customer testimonials, pricing, case studies, benchmarks, or external proof are present in the repository; future work must not fabricate them.

## Product Principles

- Keep designers in control of the composition and its revision history.
- Make precise motion work approachable instead of replicating a full video-production suite.
- Treat agent collaboration as a transparent editing partner, not an opaque automation layer.
- Preserve local-first project ownership and clearly communicate product limits.
