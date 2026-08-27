export type LayerType = "group" | "rectangle" | "ellipse" | "path" | "text" | "star";

export type Layer = {
  id: string;
  name: string;
  type: LayerType;
  parent?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fill: string;
  visible: boolean;
  start: number;
  duration: number;
};

export const initialLayers: Layer[] = [
  { id: "scene", name: "Hero scene", type: "group", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, fill: "#ffffff", visible: true, start: 0, duration: 5 },
  { id: "orb", name: "Sun orb", type: "ellipse", parent: "scene", x: 72, y: 11, width: 24, height: 43, rotation: 0, opacity: 100, fill: "#ff795f", visible: true, start: .3, duration: 2.3 },
  { id: "wave", name: "Flowing path", type: "path", parent: "scene", x: 0, y: 35, width: 100, height: 48, rotation: -5, opacity: 100, fill: "#7557f6", visible: true, start: .85, duration: 3.1 },
  { id: "title", name: "Main title", type: "text", parent: "scene", x: 9, y: 25, width: 48, height: 30, rotation: 0, opacity: 100, fill: "#17131f", visible: true, start: 1.55, duration: 2.4 },
  { id: "details", name: "Details", type: "group", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, fill: "#ffffff", visible: true, start: 0, duration: 5 },
  { id: "spark", name: "Sparkle", type: "star", parent: "details", x: 88, y: 82, width: 7, height: 10, rotation: 12, opacity: 100, fill: "#d8ff65", visible: true, start: 2.2, duration: 1.8 },
  { id: "caption", name: "Caption", type: "text", parent: "details", x: 9, y: 57, width: 38, height: 7, rotation: 0, opacity: 70, fill: "#756c63", visible: true, start: 1.8, duration: 2.5 },
];

export const toolTypes: Exclude<LayerType, "group">[] = ["rectangle", "ellipse", "path", "text", "star"];

export function formatTime(seconds: number) {
  const frames = Math.floor((seconds % 1) * 30);
  return `00:${String(Math.floor(seconds)).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
