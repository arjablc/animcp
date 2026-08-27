import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { Layer, LayerType } from "../../editor/model";
import type { Project } from "../../lib/projects";
import { CanvasPanel } from "./CanvasPanel";
import { EditorHeader } from "./EditorHeader";
import { LayersPanel } from "./LayersPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ResizeHandle } from "../atoms/ResizeHandle";

export function EditorShell({ project, onSave }: { project: Project; onSave: (layers: Layer[]) => void }) {
  const [layers, setLayers] = useState(project.layers);
  const [selected, setSelected] = useState("wave");
  const [zoom, setZoom] = useState(72);
  const [time, setTime] = useState(1.27);
  const [playing, setPlaying] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 901px)").matches);
  const selectedLayer = layers.find((layer) => layer.id === selected) ?? layers[0];

  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    onSave(layers);
  }, [layers]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTime((value) => value >= 5 ? 0 : Math.min(5, value + .03)), 30);
    return () => window.clearInterval(timer);
  }, [playing]);

  function updateSelected(patch: Partial<Layer>) {
    setLayers((items) => items.map((layer) => layer.id === selected ? { ...layer, ...patch } : layer));
  }

  function addLayer(type: LayerType) {
    const id = `${type}-${Date.now()}`;
    const parent = selectedLayer.type === "group" ? selectedLayer.id : selectedLayer.parent;
    setLayers((items) => [...items, { id, type, parent, name: type === "group" ? "New group" : `New ${type}`, x: 40, y: 35, width: type === "text" ? 28 : 18, height: type === "text" ? 10 : 24, rotation: 0, opacity: 100, fill: type === "text" ? "#17131f" : "#d8ff65", visible: true, start: time, duration: Math.min(2, 5 - time) }]);
    setSelected(id);
  }

  function deleteSelected() {
    if (selectedLayer.type === "group") return;
    setLayers((items) => items.filter((layer) => layer.id !== selected));
    setSelected(selectedLayer.parent ?? layers[0].id);
  }

  const layerPanel = <LayersPanel layers={layers} selected={selected} onSelect={setSelected} onAdd={addLayer} onToggleVisibility={(id) => setLayers((items) => items.map((layer) => layer.id === id ? { ...layer, visible: !layer.visible } : layer))} />;

  return <Tooltip.Provider delayDuration={250}><main className="flex h-screen min-h-[600px] w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-300"><EditorHeader name={project.name} />
    <PanelGroup direction="vertical" className="min-h-0 flex-1">
      <Panel defaultSize={73} minSize={45}>
        <div className="relative size-full">
          {desktop ? <PanelGroup direction="horizontal"><Panel defaultSize={17} minSize={12} maxSize={30}>{layerPanel}</Panel><ResizeHandle /><Panel defaultSize={64} minSize={35}><CanvasPanel layers={layers} selected={selected} zoom={zoom} onSelect={setSelected} onZoom={setZoom} /></Panel><ResizeHandle /><Panel defaultSize={19} minSize={15} maxSize={35}><PropertiesPanel layer={selectedLayer} onChange={updateSelected} onDelete={deleteSelected} /></Panel></PanelGroup> : <><CanvasPanel layers={layers} selected={selected} zoom={zoom} onSelect={setSelected} onZoom={setZoom} /><div className="absolute left-2.5 top-2.5 z-20 max-h-[320px] w-[190px] overflow-auto rounded-lg border border-white/10 shadow-2xl">{layerPanel}</div></>}
        </div>
      </Panel>
      <ResizeHandle direction="vertical" />
      <Panel defaultSize={27} minSize={15} maxSize={55}><TimelinePanel layers={layers} selected={selected} time={time} playing={playing} onSelect={setSelected} onTime={setTime} onPlaying={setPlaying} /></Panel>
    </PanelGroup>
  </main></Tooltip.Provider>;
}
