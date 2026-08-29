export type LayerType = "group" | "svg" | "rectangle" | "ellipse" | "path" | "text" | "star";

export const svgProperties = ["translateX", "translateY", "rotation", "scaleX", "scaleY", "opacity", "fill", "stroke", "strokeWidth"] as const;
export type SvgProperty = typeof svgProperties[number];
export type SvgValue = number | string;
export type SvgPart = { id: string; name: string; tag: string; parentId?: string; fill?: string; stroke?: string; opacity?: number; strokeWidth?: number };
export type Keyframe = { time: number; value: SvgValue };
export type AnimationTrack = { partId: string; property: SvgProperty; keyframes: Keyframe[] };

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
  inTimeline?: boolean;
  assetId?: string;
  svgParts?: SvgPart[];
  partOverrides?: Record<string, Partial<Record<SvgProperty, SvgValue>>>;
  animations?: AnimationTrack[];
};

export const initialLayers: Layer[] = [
  { id: "scene", name: "Scene", type: "group", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, fill: "#ffffff", visible: true, start: 0, duration: 5 },
];

export const toolTypes: Exclude<LayerType, "group" | "svg">[] = ["rectangle", "ellipse", "path", "text", "star"];

export function formatTime(seconds: number) {
  const frames = Math.floor((seconds % 1) * 30);
  return `00:${String(Math.floor(seconds)).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function trackStartFromPointer(pointerX: number, width: number, dragOffset: number, duration: number) {
  return Math.max(0, Math.min(5 - duration, (pointerX - dragOffset) / width * 5));
}

export function fitImageToCanvas(imageWidth: number, imageHeight: number) {
  let width = 40;
  let height = width * 16 / 9 * imageHeight / imageWidth;
  if (height > 60) {
    height = 60;
    width = height * 9 / 16 * imageWidth / imageHeight;
  }
  return { x: (100 - width) / 2, y: (100 - height) / 2, width, height };
}

export function layerPositionFromDrag(layer: Pick<Layer, "x" | "y" | "width" | "height">, deltaX: number, deltaY: number, canvasWidth: number, canvasHeight: number) {
  return {
    x: Math.max(0, Math.min(100 - layer.width, layer.x + deltaX / canvasWidth * 100)),
    y: Math.max(0, Math.min(100 - layer.height, layer.y + deltaY / canvasHeight * 100)),
  };
}
