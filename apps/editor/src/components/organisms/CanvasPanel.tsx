import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { Hand, MousePointer2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { getStoredAsset } from "../../assets/importer";
import { layerPositionFromDrag, trackStartFromPointer, type Layer } from "../../editor/model";
import { cn } from "../../lib/cn";
import { Button } from "../atoms/Button";
import { SvgLayer } from "../molecules/SvgLayer";

type MoveHandlers = {
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
};

function ImportedAssetLayer({ layer, selected, selectedPart, time, move, onSelectPart }: { layer: Layer; selected: string; selectedPart?: string; time: number; move: MoveHandlers; onSelectPart: (partId?: string) => void }) {
  const [svg, setSvg] = useState<string>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    if (!layer.assetId) { setMissing(true); return; }
    void getStoredAsset(layer.assetId).then((asset) => {
      if (!active) return;
      if (!asset) { setMissing(true); return; }
      setSvg(asset.svg);
    }).catch(() => active && setMissing(true));
    return () => { active = false; };
  }, [layer.assetId]);

  const style: CSSProperties = { left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity / 100, transform: `rotate(${layer.rotation}deg)` };
  return <div data-canvas-layer-id={layer.id} className={cn("absolute grid touch-none cursor-grab place-items-center overflow-hidden outline-offset-2 active:cursor-grabbing", selected === layer.id && "outline outline-1 outline-lime-300")} style={style} {...move}>
    {svg ? <SvgLayer source={svg} layer={layer} time={time} selectedPart={selected === layer.id ? selectedPart : undefined} onSelectPart={onSelectPart} /> : missing ? <span className="text-[8px] text-red-400">Asset unavailable</span> : <span className="text-[8px] text-zinc-500">Loading asset...</span>}
  </div>;
}

export function CanvasPanel({ layers, selected, selectedPart, time, zoom, importNotice, onSelect, onSelectPart, onChange, onZoom, onImport }: { layers: Layer[]; selected: string; selectedPart?: string; time: number; zoom: number; importNotice?: { message: string; error?: boolean }; onSelect: (id: string) => void; onSelectPart: (layerId: string, partId?: string) => void; onChange: (id: string, patch: Partial<Layer>) => void; onZoom: (zoom: number) => void; onImport: (files: File[]) => void }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const panStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const layerDrag = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; layer: Layer; width: number; height: number } | undefined>(undefined);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  function moveHandlers(layer: Layer): MoveHandlers {
    const finish = (event: PointerEvent<HTMLDivElement>) => {
      if (layerDrag.current?.pointerId !== event.pointerId) return;
      const timeline = document.querySelector<HTMLElement>("[data-timeline-dropzone]");
      const rect = timeline?.getBoundingClientRect();
      if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        onChange(layer.id, { inTimeline: true, start: trackStartFromPointer(event.clientX - rect.left, rect.width, 0, layer.duration) });
      }
      layerDrag.current = undefined;
    };
    return {
      onClick: (event) => event.stopPropagation(),
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        const artboard = event.currentTarget.closest("[data-canvas-artboard]")?.getBoundingClientRect();
        if (!artboard) return;
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        layerDrag.current = { id: layer.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, layer, width: artboard.width, height: artboard.height };
        onSelect(layer.id);
      },
      onPointerMove: (event) => {
        const drag = layerDrag.current;
        if (!drag || drag.id !== layer.id || drag.pointerId !== event.pointerId) return;
        onChange(layer.id, layerPositionFromDrag(drag.layer, event.clientX - drag.clientX, event.clientY - drag.clientY, drag.width, drag.height));
      },
      onPointerUp: finish,
      onPointerCancel: finish,
    };
  }

  function renderLayer(layer: Layer) {
    if (layer.type === "group" || !layer.visible) return null;
    const move = moveHandlers(layer);
    if (layer.type === "svg") return <ImportedAssetLayer key={layer.id} layer={layer} selected={selected} selectedPart={selectedPart} time={time} move={move} onSelectPart={(partId) => onSelectPart(layer.id, partId)} />;
    const style: CSSProperties = { left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity / 100, transform: `rotate(${layer.rotation}deg)`, color: layer.fill };
    const common = cn("absolute touch-none cursor-grab outline-offset-2 active:cursor-grabbing", selected === layer.id && "outline outline-1 outline-lime-300");
    if (layer.type === "path") return <div key={layer.id} data-canvas-layer-id={layer.id} className={common} style={style} {...move}><svg className="size-full" viewBox="0 0 700 180" preserveAspectRatio="none"><path d="M-20 140 C130 10 250 205 405 76 C520 -15 610 90 735 2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="58" /><path d="M-20 140 C130 10 250 205 405 76 C520 -15 610 90 735 2" fill="none" stroke="#ffffff" opacity=".18" strokeLinecap="round" strokeWidth="10" /></svg></div>;
    if (layer.type === "text") return <div key={layer.id} data-canvas-layer-id={layer.id} className={cn(common, "select-text flex items-center")} style={style} {...move}>{layer.id === "title" ? <h1 className="select-text m-0 text-[clamp(22px,4.2vw,64px)] font-bold leading-[.96] tracking-[-.065em]">Shape ideas<br />into motion.</h1> : <p className="select-text m-0 text-[clamp(6px,.8vw,12px)]">{layer.id === "caption" ? "Every frame, exactly where it belongs." : layer.name}</p>}</div>;
    if (layer.type === "star") return <div key={layer.id} data-canvas-layer-id={layer.id} className={cn(common, "grid place-items-center text-[clamp(20px,3.5vw,52px)] drop-shadow-[3px_3px_0_#17131f]")} style={style} {...move}>✦</div>;
    return <div key={layer.id} data-canvas-layer-id={layer.id} className={cn(common, layer.type === "ellipse" ? "rounded-full shadow-[inset_-16px_-18px_0_#00000012]" : "rounded-sm")} style={{ ...style, backgroundColor: layer.fill }} {...move}>{layer.id === "orb" && <span className="absolute left-[20%] top-[18%] size-[16%] rounded-full bg-orange-300" />}</div>;
  }

  return <section
    className={cn("relative size-full min-h-0 min-w-0 overflow-hidden bg-[#111116] bg-[radial-gradient(#303039_.7px,transparent_.7px)] bg-size-[16px_16px]", panning ? "cursor-grabbing" : "cursor-default")}
    onAuxClick={(event) => event.preventDefault()}
    onPointerDown={(event) => { if (event.button !== 1) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panStart.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y }; setPanning(true); }}
    onPointerMove={(event) => { if (!panning) return; setPan({ x: panStart.current.left + event.clientX - panStart.current.x, y: panStart.current.top + event.clientY - panStart.current.y }); }}
    onPointerUp={(event) => { if (event.button === 1) setPanning(false); }}
    onWheel={(event) => { event.preventDefault(); if (event.ctrlKey || event.metaKey) onZoom(Math.max(25, Math.min(150, zoom - event.deltaY * .1))); else setPan((value) => ({ x: value.x - (event.shiftKey ? event.deltaY : event.deltaX), y: value.y - (event.shiftKey ? 0 : event.deltaY) })); }}
    onDragEnter={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); dragDepth.current += 1; setDraggingFiles(true); }}
    onDragOver={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
    onDragLeave={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) return; dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDraggingFiles(false); } }}
    onDrop={(event) => { if (!event.dataTransfer.files.length) return; event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false); onImport(Array.from(event.dataTransfer.files)); }}
  >
    {draggingFiles && <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-xl border-2 border-dashed border-lime-300 bg-zinc-950/85 text-sm font-semibold text-lime-300">Drop an SVG to import</div>}
    {importNotice && <div className={cn("pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-md border bg-zinc-950/95 px-3 py-2 text-[10px] shadow-xl", importNotice.error ? "border-red-400/30 text-red-300" : "border-lime-300/20 text-lime-300")}>{importNotice.message}</div>}
    <div className="pointer-events-none absolute inset-x-3 top-2.5 z-10 flex justify-between"><div className="pointer-events-auto flex rounded-lg border border-white/10 bg-zinc-900/95 p-0.5 shadow-xl"><Button className="size-6 bg-white/8 text-lime-300"><MousePointer2 className="size-3" /></Button><Button className={cn("size-6 text-zinc-500", panning && "text-lime-300")}><Hand className="size-3" /></Button><Button className="size-6 text-zinc-500" aria-label="Import SVG" title="Import SVG" onClick={() => fileInput.current?.click()}><Upload className="size-3" /></Button><input ref={fileInput} type="file" accept="image/svg+xml,.svg" hidden onChange={(event) => { onImport(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></div><div className="pointer-events-auto flex items-center rounded-lg border border-white/10 bg-zinc-900/95 p-0.5 shadow-xl"><Button className="size-6 text-zinc-500" onClick={() => onZoom(Math.max(25, zoom - 10))}><ZoomOut className="size-3" /></Button><span className="w-11 text-center font-mono text-[9px] text-zinc-400">{Math.round(zoom)}%</span><Button className="size-6 text-zinc-500" onClick={() => onZoom(Math.min(150, zoom + 10))}><ZoomIn className="size-3" /></Button></div></div>
    <div className="grid size-full place-items-center overflow-hidden p-3 pt-14 sm:p-12 sm:pt-14"><div data-canvas-artboard className="relative aspect-video w-[min(820px,100%)] shrink-0 overflow-hidden bg-[#f4efdf] text-[#17131f] shadow-[0_18px_55px_#0009] will-change-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 72})` }} onClick={() => onSelect("scene")}>{layers.map(renderLayer)}</div></div>
  </section>;
}
