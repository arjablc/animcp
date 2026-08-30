import { useEffect, useEffectEvent, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Panel, PanelGroup } from "react-resizable-panels";
import { importSvgFile, type ImportResult, type SvgAssetMetadata } from "../../assets/importer";
import { layerTrackFor, setLayerKeyframes, setPartKeyframes, setPartProperty, toggleLayerKeyframe, togglePartKeyframe, trackFor, upsertLayerKeyframe, upsertPartKeyframe } from "../../editor/animation";
import { fitImageToCanvas, layerProperties, type Keyframe, type Layer, type LayerProperty, type LayerType, type SvgProperty, type SvgValue } from "../../editor/model";
import type { Project } from "../../lib/projects";
import { registerEditorTools } from "../../webmcp";
import { CanvasPanel } from "./CanvasPanel";
import { EditorHeader } from "./EditorHeader";
import { LayersPanel } from "./LayersPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ResizeHandle } from "../atoms/ResizeHandle";

export function EditorShell({ project, onSave, onRename }: { project: Project; onSave: (layers: Layer[]) => void; onRename: (name: string) => void }) {
  const [layers, setLayers] = useState<Layer[]>(() => project.layers.map((layer) => ({ ...layer, inTimeline: layer.inTimeline ?? false })));
  const [selected, setSelected] = useState(project.layers[0]?.id ?? "scene");
  const [selectedPart, setSelectedPart] = useState<string>();
  const [zoom, setZoom] = useState(72);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [importNotice, setImportNotice] = useState<{ message: string; error?: boolean }>();
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const selectedLayer = layers.find((layer) => layer.id === selected) ?? layers[0];
  const part = selectedPart ? selectedLayer?.svgParts?.find((item) => item.id === selectedPart) : undefined;

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { onSave(layers); }, [layers]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTime((value) => value >= 5 ? 0 : Math.min(5, value + .03)), 30);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!importNotice) return;
    const timer = window.setTimeout(() => setImportNotice(undefined), 3_000);
    return () => window.clearTimeout(timer);
  }, [importNotice]);

  function addImportedAsset(asset: SvgAssetMetadata) {
    const id = `svg-${crypto.randomUUID()}`;
    const parent = selectedLayer?.type === "group" ? selectedLayer.id : selectedLayer?.parent;
    setLayers((items) => [...items, {
      id, assetId: asset.id, type: "svg", parent, name: asset.name, svgParts: asset.parts,
      ...fitImageToCanvas(asset.width, asset.height), rotation: 0, opacity: 100, fill: "#ffffff",
      visible: true, start: 0, duration: 5, inTimeline: false,
    }]);
    setSelected(id);
    setSelectedPart(undefined);
    setImportNotice({ message: `Imported ${asset.name} with ${asset.parts.length} named parts.` });
  }

  function handleImportResult(result: ImportResult) {
    if (result.ok) addImportedAsset(result.asset);
    else setImportNotice({ message: result.error.message, error: true });
  }

  async function importFiles(files: File[]) {
    for (const file of files) {
      setImportNotice({ message: `Importing ${file.name}...` });
      handleImportResult(await importSvgFile(file));
    }
  }

  function selectLayer(id: string) {
    setSelected(id);
    setSelectedPart(undefined);
  }

  function selectPart(layerId: string, partId?: string) {
    setSelected(layerId);
    setSelectedPart(partId);
  }

  function updateSelected(patch: Partial<Layer>) {
    updateAnimatedLayer(selected, patch);
  }

  function updatePartProperty(property: SvgProperty, value: SvgValue) {
    if (!selectedPart || !validValue(property, value)) return;
    setLayers((items) => trackFor(selectedLayer, selectedPart, property)
      ? upsertPartKeyframe(items, selected, selectedPart, property, { time, value })
      : setPartProperty(items, selected, selectedPart, property, value));
  }

  function togglePartAnimation(property: SvgProperty, value: SvgValue) {
    if (!selectedPart || !validValue(property, value)) return;
    setLayers((items) => togglePartKeyframe(items, selected, selectedPart, property, time, value));
  }

  function toggleLayerAnimation(property: LayerProperty, value: SvgValue) {
    if (!validLayerValue(property, value)) return;
    setLayers((items) => toggleLayerKeyframe(items, selected, property, time, value));
  }

  function addLayer(type: LayerType) {
    const id = `${type}-${Date.now()}`;
    const parent = selectedLayer?.type === "group" ? selectedLayer.id : selectedLayer?.parent;
    setLayers((items) => [...items, { id, type, parent, name: type === "group" ? "New group" : `New ${type}`, x: 40, y: 35, width: type === "text" ? 28 : 18, height: type === "text" ? 10 : 24, rotation: 0, opacity: 100, fill: type === "text" ? "#17131f" : "#d8ff65", visible: true, start: time, duration: Math.min(2, 5 - time), inTimeline: false }]);
    selectLayer(id);
  }

  function deleteSelected() {
    if (!selectedLayer || selectedLayer.type === "group") return;
    setLayers((items) => items.filter((layer) => layer.id !== selected));
    selectLayer(selectedLayer.parent ?? layers[0].id);
  }

  const getScene = useEffectEvent(() => ({ ok: true, project: { id: project.id, name: project.name, duration: 5 }, playhead: time, playing, layers: layers.map((layer) => ({ id: layer.id, name: layer.name, type: layer.type, visible: layer.visible, parts: layer.svgParts ?? [], animations: layer.animations ?? [] })) }));
  const getParts = useEffectEvent((layerId: string) => {
    const layer = layers.find((item) => item.id === layerId && item.type === "svg");
    return layer ? { ok: true, layerId, parts: layer.svgParts ?? [] } : { ok: false, error: "SVG layer not found." };
  });
  const setProperty = useEffectEvent((target: { layerId: string; partId: string }, property: SvgProperty, value: SvgValue) => {
    if (!targetExists(layers, target) || !validValue(property, value)) return { ok: false, error: "Invalid SVG target or property value." };
    setLayers((items) => setPartProperty(items, target.layerId, target.partId, property, value));
    return { ok: true, ...target, property, value };
  });
  const setLayerProperty = useEffectEvent((layerId: string, property: LayerProperty, value: SvgValue) => {
    if (!layers.some((layer) => layer.id === layerId && layer.type !== "group") || !validLayerValue(property, value)) return { ok: false, error: "Invalid layer or property value." };
    setLayers((items) => items.map((layer) => layer.id === layerId ? { ...layer, [property]: value } : layer));
    return { ok: true, layerId, property, value };
  });
  const animate = useEffectEvent((target: { layerId: string; partId: string }, property: SvgProperty, keyframes: Keyframe[]) => {
    if (!targetExists(layers, target) || !validKeyframes(keyframes, (value) => validValue(property, value))) return { ok: false, error: "Invalid SVG target or keyframes." };
    setLayers((items) => setPartKeyframes(items, target.layerId, target.partId, property, keyframes));
    return { ok: true, ...target, property, keyframes };
  });
  const deleteAnimation = useEffectEvent((target: { layerId: string; partId: string }, property: SvgProperty) => {
    if (!targetExists(layers, target)) return { ok: false, error: "SVG target not found." };
    setLayers((items) => setPartKeyframes(items, target.layerId, target.partId, property, []));
    return { ok: true, ...target, property };
  });
  const animateLayer = useEffectEvent((layerId: string, property: LayerProperty, keyframes: Keyframe[]) => {
    if (!layers.some((layer) => layer.id === layerId && layer.type !== "group") || !validKeyframes(keyframes, (value) => validLayerValue(property, value))) return { ok: false, error: "Invalid layer or keyframes." };
    setLayers((items) => setLayerKeyframes(items, layerId, property, keyframes).map((layer) => layer.id === layerId ? { ...layer, inTimeline: true } : layer));
    return { ok: true, layerId, property, keyframes };
  });
  const deleteLayerAnimation = useEffectEvent((layerId: string, property: LayerProperty) => {
    if (!layers.some((layer) => layer.id === layerId && layer.type !== "group")) return { ok: false, error: "Layer not found." };
    setLayers((items) => setLayerKeyframes(items, layerId, property, []));
    return { ok: true, layerId, property };
  });
  const seek = useEffectEvent((next: number) => { setTime(Math.max(0, Math.min(5, next))); return { ok: true, time: next }; });
  const playback = useEffectEvent((next: boolean) => { setPlaying(next); return { ok: true, playing: next }; });

  useEffect(() => {
    const controller = new AbortController();
    void registerEditorTools({ getScene, getParts, setProperty, setLayerProperty, animate, animateLayer, deleteAnimation, deleteLayerAnimation, setPlayhead: seek, setPlayback: playback }, controller.signal);
    return () => controller.abort();
  }, []);

  function updateAnimatedLayer(id: string, patch: Partial<Layer>) {
    setLayers((items) => Object.entries(patch).reduce((next, [key, value]) => {
      const layer = next.find((item) => item.id === id);
      if (layer && layerProperties.includes(key as LayerProperty) && layerTrackFor(layer, key as LayerProperty)) return upsertLayerKeyframe(next, id, key as LayerProperty, { time, value: value as SvgValue });
      return next.map((item) => item.id === id ? { ...item, [key]: value } : item);
    }, items));
  }
  const updateLayer = (id: string, patch: Partial<Layer>) => setLayers((items) => items.map((layer) => layer.id === id ? { ...layer, ...patch } : layer));
  const layerPanel = <LayersPanel layers={layers} selected={selected} selectedPart={selectedPart} onSelect={selectLayer} onSelectPart={selectPart} onAdd={addLayer} onChange={updateLayer} />;

  if (!selectedLayer) return null;
  return <Tooltip.Provider delayDuration={250}><main className="relative flex h-screen min-h-[600px] w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-300"><EditorHeader name={project.name} onRename={onRename} />
    <PanelGroup direction="vertical" className="min-h-0 flex-1">
      <Panel defaultSize={73} minSize={45}>
        <div className="relative size-full">
          {desktop ? <PanelGroup direction="horizontal"><Panel defaultSize={17} minSize={12} maxSize={30}>{layerPanel}</Panel><ResizeHandle /><Panel defaultSize={64} minSize={35}><CanvasPanel layers={layers} selected={selected} selectedPart={selectedPart} time={time} zoom={zoom} importNotice={importNotice} onSelect={selectLayer} onSelectPart={selectPart} onChange={updateAnimatedLayer} onZoom={setZoom} onImport={importFiles} /></Panel><ResizeHandle /><Panel defaultSize={19} minSize={15} maxSize={35}><PropertiesPanel layer={selectedLayer} part={part} time={time} onChange={updateSelected} onPartChange={updatePartProperty} onToggleLayerKeyframe={toggleLayerAnimation} onTogglePartKeyframe={togglePartAnimation} onDelete={deleteSelected} /></Panel></PanelGroup> : <><CanvasPanel layers={layers} selected={selected} selectedPart={selectedPart} time={time} zoom={zoom} importNotice={importNotice} onSelect={selectLayer} onSelectPart={selectPart} onChange={updateAnimatedLayer} onZoom={setZoom} onImport={importFiles} /><div className="absolute left-2.5 top-2.5 z-20 max-h-[320px] w-[190px] overflow-auto rounded-lg border border-white/10 shadow-2xl">{layerPanel}</div></>}
        </div>
      </Panel>
      <ResizeHandle direction="vertical" />
      <Panel defaultSize={27} minSize={15} maxSize={55}><TimelinePanel layers={layers} selected={selected} selectedPart={selectedPart} time={time} playing={playing} onSelect={selectLayer} onTime={setTime} onPlaying={setPlaying} onChange={updateLayer} /></Panel>
    </PanelGroup>
  </main></Tooltip.Provider>;
}

function targetExists(layers: Layer[], target: { layerId: string; partId: string }) {
  return layers.some((layer) => layer.id === target.layerId && layer.type === "svg" && layer.svgParts?.some((part) => part.id === target.partId));
}

function validValue(property: SvgProperty, value: SvgValue) {
  if (property === "fill" || property === "stroke") return typeof value === "string" && (value === "none" || /^#[0-9a-f]{6}$/i.test(value));
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (property === "opacity") return value >= 0 && value <= 1;
  if (property === "strokeWidth") return value >= 0;
  return true;
}

function validLayerValue(property: LayerProperty, value: SvgValue) {
  if (property === "fill") return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (property === "opacity") return value >= 0 && value <= 100;
  if (property === "width" || property === "height") return value >= 0;
  return true;
}

function validKeyframes(keyframes: Keyframe[], valid: (value: SvgValue) => boolean) {
  return keyframes.length > 0 && new Set(keyframes.map((keyframe) => keyframe.time)).size === keyframes.length && keyframes.every((keyframe) => Number.isFinite(keyframe.time) && keyframe.time >= 0 && keyframe.time <= 5 && valid(keyframe.value));
}
