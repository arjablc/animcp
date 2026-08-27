import { useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { Hand, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import type { Layer } from "../../editor/model";
import { cn } from "../../lib/cn";
import { Button } from "../atoms/Button";

export function CanvasPanel({ layers, selected, zoom, onSelect, onZoom }: { layers: Layer[]; selected: string; zoom: number; onSelect: (id: string) => void; onZoom: (zoom: number) => void }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, left: 0, top: 0 });

  function startDrag(event: DragEvent, id: string) {
    event.dataTransfer.setData("application/x-animcp-layer", id);
    event.dataTransfer.effectAllowed = "move";
    onSelect(id);
  }

  function renderLayer(layer: Layer) {
    if (layer.type === "group" || !layer.visible) return null;
    const style: CSSProperties = { left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity / 100, transform: `rotate(${layer.rotation}deg)`, color: layer.fill };
    const common = cn("absolute cursor-pointer outline-offset-2", selected === layer.id && "outline outline-1 outline-lime-300");
    const select = (event: MouseEvent) => { event.stopPropagation(); onSelect(layer.id); };
    const drag = (event: DragEvent<HTMLElement>) => startDrag(event, layer.id);
    if (layer.type === "path") return <div key={layer.id} draggable className={common} style={style} onClick={select} onDragStart={drag}><svg className="size-full" viewBox="0 0 700 180" preserveAspectRatio="none"><path d="M-20 140 C130 10 250 205 405 76 C520 -15 610 90 735 2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="58" /><path d="M-20 140 C130 10 250 205 405 76 C520 -15 610 90 735 2" fill="none" stroke="#ffffff" opacity=".18" strokeLinecap="round" strokeWidth="10" /></svg></div>;
    if (layer.type === "text") return <div key={layer.id} draggable className={cn(common, "select-text flex items-center")} style={style} onClick={select} onDragStart={drag}>{layer.id === "title" ? <h1 className="select-text m-0 text-[clamp(22px,4.2vw,64px)] font-bold leading-[.96] tracking-[-.065em]">Shape ideas<br />into motion.</h1> : <p className="select-text m-0 text-[clamp(6px,.8vw,12px)]">{layer.id === "caption" ? "Every frame, exactly where it belongs." : layer.name}</p>}</div>;
    if (layer.type === "star") return <div key={layer.id} draggable className={cn(common, "grid place-items-center text-[clamp(20px,3.5vw,52px)] drop-shadow-[3px_3px_0_#17131f]")} style={style} onClick={select} onDragStart={drag}>✦</div>;
    return <div key={layer.id} draggable className={cn(common, layer.type === "ellipse" ? "rounded-full shadow-[inset_-16px_-18px_0_#00000012]" : "rounded-sm")} style={{ ...style, backgroundColor: layer.fill }} onClick={select} onDragStart={drag}>{layer.id === "orb" && <span className="absolute left-[20%] top-[18%] size-[16%] rounded-full bg-orange-300" />}</div>;
  }

  return <section
    className={cn("relative size-full min-h-0 min-w-0 overflow-hidden bg-[#111116] bg-[radial-gradient(#303039_.7px,transparent_.7px)] bg-size-[16px_16px]", panning ? "cursor-grabbing" : "cursor-default")}
    onAuxClick={(event) => event.preventDefault()}
    onPointerDown={(event) => { if (event.button !== 1) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panStart.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y }; setPanning(true); }}
    onPointerMove={(event) => { if (!panning) return; setPan({ x: panStart.current.left + event.clientX - panStart.current.x, y: panStart.current.top + event.clientY - panStart.current.y }); }}
    onPointerUp={(event) => { if (event.button === 1) setPanning(false); }}
    onWheel={(event) => { event.preventDefault(); if (event.ctrlKey || event.metaKey) onZoom(Math.max(25, Math.min(150, zoom - event.deltaY * .1))); else setPan((value) => ({ x: value.x - (event.shiftKey ? event.deltaY : event.deltaX), y: value.y - (event.shiftKey ? 0 : event.deltaY) })); }}
  >
    <div className="pointer-events-none absolute inset-x-3 top-2.5 z-10 flex justify-between"><div className="pointer-events-auto flex rounded-lg border border-white/10 bg-zinc-900/95 p-0.5 shadow-xl"><Button className="size-6 bg-white/8 text-lime-300"><MousePointer2 className="size-3" /></Button><Button className={cn("size-6 text-zinc-500", panning && "text-lime-300")}><Hand className="size-3" /></Button></div><div className="pointer-events-auto flex items-center rounded-lg border border-white/10 bg-zinc-900/95 p-0.5 shadow-xl"><Button className="size-6 text-zinc-500" onClick={() => onZoom(Math.max(25, zoom - 10))}><ZoomOut className="size-3" /></Button><span className="w-11 text-center font-mono text-[9px] text-zinc-400">{Math.round(zoom)}%</span><Button className="size-6 text-zinc-500" onClick={() => onZoom(Math.min(150, zoom + 10))}><ZoomIn className="size-3" /></Button></div></div>
    <div className="grid size-full place-items-center overflow-hidden p-3 pt-14 sm:p-12 sm:pt-14"><div data-canvas-artboard className="relative aspect-video w-[min(820px,100%)] shrink-0 overflow-hidden bg-[#f4efdf] text-[#17131f] shadow-[0_18px_55px_#0009] will-change-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 72})` }} onClick={() => onSelect("scene")}><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#907f6d_.5px,transparent_.5px)] bg-size-[5px_5px] opacity-35" /><span className="select-text absolute left-[9%] top-[22%] font-mono text-[clamp(6px,.65vw,10px)] font-semibold tracking-[.18em] text-[#6e5a3d]">MOVE WITH PURPOSE</span>{layers.map(renderLayer)}<span className="select-text absolute bottom-1 right-1.5 font-mono text-[6px] text-stone-500">1920 × 1080</span></div></div>
  </section>;
}
