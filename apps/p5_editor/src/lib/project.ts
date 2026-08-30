import type { ConfigObject, SchemaNode } from "./schema";

export const exportFrameRates = [12, 15, 24, 30] as const;
export type ExportFrameRate = typeof exportFrameRates[number];
export type LottieMode = "vector" | "raster";
export type ExportSettings = { durationSeconds: number; frameRate: ExportFrameRate; lottieMode: LottieMode };

export const defaultExportSettings: ExportSettings = { durationSeconds: 5, frameRate: 30, lottieMode: "vector" };

export type P5Project = {
  version: 2;
  id: string;
  name: string;
  source: string;
  config: ConfigObject;
  schema: SchemaNode;
  exportSettings: ExportSettings;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export const defaultSource = `window.sketchConfig = {
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
        width: { type: "integer", minimum: 240, maximum: 1920, title: "Width" },
        height: { type: "integer", minimum: 240, maximum: 1080, title: "Height" },
        background: { type: "string", format: "color", title: "Background" }
      }
    },
    orb: {
      type: "object",
      title: "Orb",
      properties: {
        x: { type: "number", minimum: 0, maximum: 720, title: "Center X" },
        y: { type: "number", minimum: 0, maximum: 480, title: "Center Y" },
        radius: { type: "number", minimum: 8, maximum: 240, title: "Radius" },
        speed: { type: "number", minimum: 0.001, maximum: 0.1, multipleOf: 0.001, title: "Speed" },
        amplitude: { type: "number", minimum: 0, maximum: 300, title: "Amplitude" },
        color: { type: "string", format: "color", title: "Color" }
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

window.exportLottie = ({ durationSeconds, frameRate }) => {
  const { canvas, orb } = window.sketchConfig;
  const frames = Math.round(durationSeconds * frameRate);
  const rgb = orb.color.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const positions = Array.from({ length: frames + 1 }, (_, frame) => {
    const keyframe = { t: frame, s: [orb.x + Math.sin(frame * orb.speed) * orb.amplitude, orb.y, 0] };
    return frame === frames ? keyframe : {
      ...keyframe,
      o: { x: [0, 0, 0], y: [0, 0, 0] },
      i: { x: [1, 1, 1], y: [1, 1, 1] }
    };
  });
  return {
    v: "5.12.2", fr: frameRate, ip: 0, op: frames, w: canvas.width, h: canvas.height,
    nm: "Orb sketch", ddd: 0, assets: [],
    layers: [
      {
        ddd: 0, ind: 1, ty: 4, nm: "Orb", sr: 1,
        ks: {
          o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 1, k: positions },
          a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }
        },
        ao: 0,
        shapes: [
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [orb.radius * 2, orb.radius * 2] }, nm: "Orb" },
          { ty: "fl", c: { a: 0, k: [...rgb, 1] }, o: { a: 0, k: 100 }, r: 1, nm: "Fill" }
        ],
        ip: 0, op: frames, st: 0, bm: 0
      },
      {
        ddd: 0, ind: 2, ty: 1, nm: "Background", sw: canvas.width, sh: canvas.height, sc: canvas.background,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [canvas.width / 2, canvas.height / 2, 0] }, a: { a: 0, k: [canvas.width / 2, canvas.height / 2, 0] }, s: { a: 0, k: [100, 100, 100] } },
        ao: 0, ip: 0, op: frames, st: 0, bm: 0
      }
    ]
  };
}`;

export const legacyDefaultSource = defaultSource.slice(0, defaultSource.indexOf("\n\nwindow.exportLottie"));

export function createProject(name = "Untitled sketch", now = new Date()): P5Project {
  const timestamp = now.toISOString();
  return {
    version: 2,
    id: crypto.randomUUID(),
    name,
    source: defaultSource,
    config: {
      canvas: { width: 720, height: 480, background: "#11140f" },
      orb: { x: 360, y: 240, radius: 72, speed: 0.025, amplitude: 120, color: "#dfff4f" },
    },
    schema: {
      type: "object",
      properties: {
        canvas: { type: "object", title: "Canvas", properties: {
          width: { type: "integer", minimum: 240, maximum: 1920, title: "Width" },
          height: { type: "integer", minimum: 240, maximum: 1080, title: "Height" },
          background: { type: "string", format: "color", title: "Background" },
        } },
        orb: { type: "object", title: "Orb", properties: {
          x: { type: "number", minimum: 0, maximum: 720, title: "Center X" },
          y: { type: "number", minimum: 0, maximum: 480, title: "Center Y" },
          radius: { type: "number", minimum: 8, maximum: 240, title: "Radius" },
          speed: { type: "number", minimum: 0.001, maximum: 0.1, multipleOf: 0.001, title: "Speed" },
          amplitude: { type: "number", minimum: 0, maximum: 300, title: "Amplitude" },
          color: { type: "string", format: "color", title: "Color" },
        } },
      },
    },
    exportSettings: { ...defaultExportSettings },
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
