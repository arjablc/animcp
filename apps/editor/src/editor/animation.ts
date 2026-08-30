import { layerProperties, type AnimationTrack, type Keyframe, type Layer, type LayerProperty, type SvgPart, type SvgProperty, type SvgValue } from "./model";

const defaults: Record<SvgProperty, SvgValue> = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: "#000000", stroke: "none", strokeWidth: 1 };

export function partValue(layer: Layer, part: SvgPart, property: SvgProperty, time: number): SvgValue {
  const track = layer.animations?.find((item) => item.partId === part.id && item.property === property);
  const base = layer.partOverrides?.[part.id]?.[property] ?? sourceValue(part, property) ?? defaults[property];
  return track?.keyframes.length ? interpolate(track.keyframes, time) : base;
}

export function layerValue(layer: Layer, property: LayerProperty, time: number): SvgValue {
  const track = layer.animations?.find((item) => item.partId === undefined && item.property === property);
  return track?.keyframes.length ? interpolate(track.keyframes, time) : layer[property];
}

export function evaluatedLayer(layer: Layer, time: number): Layer {
  return { ...layer, ...Object.fromEntries(layerProperties.map((property) => [property, layerValue(layer, property, time)])) } as Layer;
}

export function setPartProperty(layers: Layer[], layerId: string, partId: string, property: SvgProperty, value: SvgValue) {
  return updateTarget(layers, layerId, partId, (layer) => ({ ...layer, partOverrides: { ...layer.partOverrides, [partId]: { ...layer.partOverrides?.[partId], [property]: value } } }));
}

export function setPartKeyframes(layers: Layer[], layerId: string, partId: string, property: SvgProperty, keyframes: Keyframe[]) {
  return updateTarget(layers, layerId, partId, (layer) => {
    const animations = (layer.animations ?? []).filter((track) => track.partId !== partId || track.property !== property);
    if (keyframes.length) animations.push({ partId, property, keyframes: [...keyframes].sort((a, b) => a.time - b.time) });
    return { ...layer, animations };
  });
}

export function setLayerKeyframes(layers: Layer[], layerId: string, property: LayerProperty, keyframes: Keyframe[]) {
  return layers.map((layer) => {
    if (layer.id !== layerId || layer.type === "group") return layer;
    const animations = (layer.animations ?? []).filter((track) => track.partId !== undefined || track.property !== property);
    if (keyframes.length) animations.push({ property, keyframes: [...keyframes].sort((a, b) => a.time - b.time) });
    return { ...layer, animations };
  });
}

export function upsertPartKeyframe(layers: Layer[], layerId: string, partId: string, property: SvgProperty, keyframe: Keyframe) {
  const layer = layers.find((item) => item.id === layerId);
  const track = layer?.animations?.find((item) => item.partId === partId && item.property === property);
  return setPartKeyframes(layers, layerId, partId, property, [...(track?.keyframes.filter((item) => Math.abs(item.time - keyframe.time) > .001) ?? []), keyframe]);
}

export function upsertLayerKeyframe(layers: Layer[], layerId: string, property: LayerProperty, keyframe: Keyframe) {
  const track = layers.find((item) => item.id === layerId)?.animations?.find((item) => item.partId === undefined && item.property === property);
  return setLayerKeyframes(layers, layerId, property, [...(track?.keyframes.filter((item) => Math.abs(item.time - keyframe.time) > .001) ?? []), keyframe]);
}

export function togglePartKeyframe(layers: Layer[], layerId: string, partId: string, property: SvgProperty, time: number, value: SvgValue) {
  const track = layers.find((item) => item.id === layerId)?.animations?.find((item) => item.partId === partId && item.property === property);
  const existing = track?.keyframes.find((item) => Math.abs(item.time - time) <= .001);
  return existing ? setPartKeyframes(layers, layerId, partId, property, track!.keyframes.filter((item) => item !== existing)) : upsertPartKeyframe(layers, layerId, partId, property, { time, value });
}

export function toggleLayerKeyframe(layers: Layer[], layerId: string, property: LayerProperty, time: number, value: SvgValue) {
  const track = layers.find((item) => item.id === layerId)?.animations?.find((item) => item.partId === undefined && item.property === property);
  const existing = track?.keyframes.find((item) => Math.abs(item.time - time) <= .001);
  return existing ? setLayerKeyframes(layers, layerId, property, track!.keyframes.filter((item) => item !== existing)) : upsertLayerKeyframe(layers, layerId, property, { time, value });
}

export function hasKeyframe(layer: Layer, partId: string, property: SvgProperty, time: number) {
  return layer.animations?.some((track) => track.partId === partId && track.property === property && track.keyframes.some((keyframe) => Math.abs(keyframe.time - time) <= .001)) ?? false;
}

export function hasLayerKeyframe(layer: Layer, property: LayerProperty, time: number) {
  return layer.animations?.some((track) => track.partId === undefined && track.property === property && track.keyframes.some((keyframe) => Math.abs(keyframe.time - time) <= .001)) ?? false;
}

export function renderSvg(source: string, layer: Layer, time: number, selectedPart?: string) {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  for (const part of layer.svgParts ?? []) {
    const element = [...document.querySelectorAll("[id]")].find((item) => item.id === part.id);
    if (!element) continue;
    if (part.id === selectedPart) element.classList.add("animcp-selected");
    const values = Object.fromEntries((["translateX", "translateY", "rotation", "scaleX", "scaleY"] as SvgProperty[]).map((property) => [property, partValue(layer, part, property, time)])) as Record<string, number>;
    const animatedTransform = `translate(${values.translateX} ${values.translateY}) rotate(${values.rotation}) scale(${values.scaleX} ${values.scaleY})`;
    element.setAttribute("transform", `${element.getAttribute("transform") ?? ""} ${animatedTransform}`.trim());
    for (const [property, attribute] of [["opacity", "opacity"], ["fill", "fill"], ["stroke", "stroke"], ["strokeWidth", "stroke-width"]] as const) {
      if (layer.partOverrides?.[part.id]?.[property] !== undefined || layer.animations?.some((track) => track.partId === part.id && track.property === property)) element.setAttribute(attribute, String(partValue(layer, part, property, time)));
    }
  }
  return new XMLSerializer().serializeToString(document);
}

function updateTarget(layers: Layer[], layerId: string, partId: string, update: (layer: Layer) => Layer) {
  return layers.map((layer) => layer.id === layerId && layer.type === "svg" && layer.svgParts?.some((part) => part.id === partId) ? update(layer) : layer);
}

function sourceValue(part: SvgPart, property: SvgProperty): SvgValue | undefined {
  if (property === "fill") return part.fill;
  if (property === "stroke") return part.stroke;
  if (property === "opacity") return part.opacity;
  if (property === "strokeWidth") return part.strokeWidth;
}

function interpolate(keyframes: Keyframe[], time: number): SvgValue {
  if (time <= keyframes[0].time) return keyframes[0].value;
  if (time >= keyframes.at(-1)!.time) return keyframes.at(-1)!.value;
  const end = keyframes.findIndex((keyframe) => keyframe.time >= time);
  const from = keyframes[end - 1];
  const to = keyframes[end];
  const progress = (time - from.time) / (to.time - from.time);
  if (typeof from.value === "number" && typeof to.value === "number") return from.value + (to.value - from.value) * progress;
  if (isColor(from.value) && isColor(to.value)) return colorBetween(from.value, to.value, progress);
  return progress < .5 ? from.value : to.value;
}

function isColor(value: SvgValue): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function colorBetween(from: string, to: string, progress: number) {
  const channels = [1, 3, 5].map((start) => Math.round(parseInt(from.slice(start, start + 2), 16) + (parseInt(to.slice(start, start + 2), 16) - parseInt(from.slice(start, start + 2), 16)) * progress));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function trackFor(layer: Layer, partId: string, property: SvgProperty): AnimationTrack | undefined {
  return layer.animations?.find((track) => track.partId === partId && track.property === property);
}

export function layerTrackFor(layer: Layer, property: LayerProperty): AnimationTrack | undefined {
  return layer.animations?.find((track) => track.partId === undefined && track.property === property);
}
