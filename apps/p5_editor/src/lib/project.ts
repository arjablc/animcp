import type { ConfigObject, SchemaNode } from "./schema";

export type P5Project = {
  version: 1;
  id: string;
  name: string;
  source: string;
  config: ConfigObject;
  schema: SchemaNode;
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
}`;

export function createProject(name = "Untitled sketch", now = new Date()): P5Project {
  const timestamp = now.toISOString();
  return {
    version: 1,
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
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
