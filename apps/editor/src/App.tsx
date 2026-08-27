import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Slider from "@radix-ui/react-slider";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Box, ChevronDown, ChevronRight, Circle, Download, Eye, EyeOff, Folder, Hand,
  MousePointer2, MoreHorizontal, Pause, PenTool, Play, Plus, Redo2, RotateCcw,
  SkipBack, SkipForward, Sparkles, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { registerImportTool } from "./webmcp";

type LayerType = "group" | "rectangle" | "ellipse" | "path" | "text" | "star";
type Layer = {
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

const initialLayers: Layer[] = [
  { id: "scene", name: "Hero scene", type: "group", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, fill: "#ffffff", visible: true, start: 0, duration: 5 },
  { id: "orb", name: "Sun orb", type: "ellipse", parent: "scene", x: 72, y: 11, width: 24, height: 43, rotation: 0, opacity: 100, fill: "#ff795f", visible: true, start: .3, duration: 2.3 },
  { id: "wave", name: "Flowing path", type: "path", parent: "scene", x: 0, y: 35, width: 100, height: 48, rotation: -5, opacity: 100, fill: "#7557f6", visible: true, start: .85, duration: 3.1 },
  { id: "title", name: "Main title", type: "text", parent: "scene", x: 9, y: 25, width: 48, height: 30, rotation: 0, opacity: 100, fill: "#17131f", visible: true, start: 1.55, duration: 2.4 },
  { id: "details", name: "Details", type: "group", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 100, fill: "#ffffff", visible: true, start: 0, duration: 5 },
  { id: "spark", name: "Sparkle", type: "star", parent: "details", x: 88, y: 82, width: 7, height: 10, rotation: 12, opacity: 100, fill: "#d8ff65", visible: true, start: 2.2, duration: 1.8 },
  { id: "caption", name: "Caption", type: "text", parent: "details", x: 9, y: 57, width: 38, height: 7, rotation: 0, opacity: 70, fill: "#756c63", visible: true, start: 1.8, duration: 2.5 },
];

const icons: Record<LayerType, typeof Square> = { group: Folder, rectangle: Square, ellipse: Circle, path: PenTool, text: Type, star: Sparkles };
const toolItems: { type: Exclude<LayerType, "group">; label: string; icon: typeof Square }[] = [
  { type: "rectangle", label: "Shape", icon: Square },
  { type: "ellipse", label: "Ellipse", icon: Circle },
  { type: "path", label: "Path", icon: PenTool },
  { type: "text", label: "Text", icon: Type },
  { type: "star", label: "Star", icon: Sparkles },
];

function cn(...values: ClassValue[]) { return twMerge(clsx(values)); }

function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lime-300 disabled:pointer-events-none disabled:opacity-40", className)} {...props} />;
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content sideOffset={6} className="z-50 rounded bg-zinc-100 px-2 py-1 text-[10px] text-zinc-950 shadow-lg">{label}<Tooltip.Arrow className="fill-zinc-100" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

function LayerIcon({ type, className }: { type: LayerType; className?: string }) {
  const Icon = icons[type];
  return <Icon className={cn("size-3.5 shrink-0", type === "path" && "text-violet-400", className)} strokeWidth={1.6} />;
}

export function formatTime(seconds: number) {
  const frames = Math.floor((seconds % 1) * 30);
  return `00:${String(Math.floor(seconds)).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function App() {
  const [layers, setLayers] = useState(initialLayers);
  const [selected, setSelected] = useState("wave");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [zoom, setZoom] = useState(72);
  const [time, setTime] = useState(1.27);
  const [playing, setPlaying] = useState(false);
  const selectedLayer = layers.find((layer) => layer.id === selected) ?? layers[0];
  const timelineLayers = layers.filter((layer) => layer.type !== "group");

  useEffect(() => {
    const controller = new AbortController();
    void registerImportTool({ onResult: () => undefined }, controller.signal);
    return () => controller.abort();
  }, []);

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
    setLayers((items) => [...items, {
      id, type, parent, name: type === "group" ? "New group" : `New ${type}`,
      x: 40, y: 35, width: type === "text" ? 28 : 18, height: type === "text" ? 10 : 24,
      rotation: 0, opacity: 100, fill: type === "text" ? "#17131f" : "#d8ff65",
      visible: true, start: time, duration: Math.min(2, 5 - time),
    }]);
    setSelected(id);
  }

  function deleteSelected() {
    if (!selectedLayer || selectedLayer.type === "group") return;
    setLayers((items) => items.filter((layer) => layer.id !== selected));
    setSelected(selectedLayer.parent ?? layers[0].id);
  }

  function toggleGroup(id: string) {
    setCollapsed((groups) => groups.includes(id) ? groups.filter((group) => group !== id) : [...groups, id]);
  }

  function renderLayer(layer: Layer) {
    if (layer.type === "group" || !layer.visible) return null;
    const style = { left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity / 100, transform: `rotate(${layer.rotation}deg)`, color: layer.fill };
    const active = selected === layer.id;
    const common = cn("absolute cursor-pointer outline-offset-2", active && "outline outline-1 outline-lime-300");
    if (layer.type === "path") return <svg key={layer.id} className={common} style={style} viewBox="0 0 700 180" preserveAspectRatio="none" onClick={() => setSelected(layer.id)}><path d="M-20 140 C130 10 250 205 405 76 C520 -15 610 90 735 2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="58" /><path d="M-20 140 C130 10 250 205 405 76 C520 -15 610 90 735 2" fill="none" stroke="#ffffff" opacity=".18" strokeLinecap="round" strokeWidth="10" /></svg>;
    if (layer.type === "text") return <div key={layer.id} className={cn(common, "flex items-center")} style={style} onClick={() => setSelected(layer.id)}>{layer.id === "title" ? <h1 className="m-0 text-[clamp(22px,4.2vw,64px)] font-bold leading-[.96] tracking-[-.065em]">Shape ideas<br />into motion.</h1> : <p className="m-0 text-[clamp(6px,.8vw,12px)]">{layer.id === "caption" ? "Every frame, exactly where it belongs." : layer.name}</p>}</div>;
    if (layer.type === "star") return <div key={layer.id} className={cn(common, "grid place-items-center text-[clamp(20px,3.5vw,52px)] drop-shadow-[3px_3px_0_#17131f]")} style={style} onClick={() => setSelected(layer.id)}>✦</div>;
    return <div key={layer.id} className={cn(common, layer.type === "ellipse" ? "rounded-full shadow-[inset_-16px_-18px_0_#00000012]" : "rounded-sm")} style={{ ...style, backgroundColor: layer.fill }} onClick={() => setSelected(layer.id)}>{layer.id === "orb" && <span className="absolute left-[20%] top-[18%] size-[16%] rounded-full bg-orange-300" />}</div>;
  }

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="grid h-screen min-h-[600px] w-screen grid-cols-[238px_minmax(420px,1fr)_268px] grid-rows-[58px_minmax(0,1fr)_218px] overflow-hidden bg-zinc-950 text-zinc-300 max-[900px]:grid-cols-[190px_minmax(360px,1fr)] max-[650px]:grid-cols-[100vw] max-[650px]:grid-rows-[54px_minmax(410px,1fr)_190px]">
        <header className="col-span-full grid grid-cols-[238px_1fr_auto] items-center border-b border-white/10 bg-zinc-900 max-[900px]:grid-cols-[190px_1fr_auto] max-[650px]:grid-cols-[1fr_auto]">
          <div className="flex items-center gap-2.5 pl-4 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-lime-300 font-bold text-zinc-950">A</span>AniMCP</div>
          <div className="flex items-baseline gap-2.5 border-l border-white/10 pl-5 max-[650px]:hidden"><strong className="text-xs text-zinc-200">Summer motion</strong><span className="text-[9px] text-zinc-600">Saved just now</span></div>
          <div className="flex items-center gap-1.5 pr-3">
            <Tip label="Undo"><Button className="size-8 text-zinc-500 max-[650px]:hidden"><Undo2 className="size-3.5" /></Button></Tip>
            <Tip label="Redo"><Button className="size-8 text-zinc-500 max-[650px]:hidden"><Redo2 className="size-3.5" /></Button></Tip>
            <Button className="h-8 border border-white/10 px-3 max-[650px]:hidden">Preview</Button>
            <Button className="h-8 gap-1.5 bg-lime-300 px-3 text-zinc-950 hover:bg-lime-200"><Download className="size-3" />Export</Button>
          </div>
        </header>

        <aside className="row-start-2 min-w-0 border-r border-white/10 bg-zinc-900 max-[650px]:absolute max-[650px]:left-2.5 max-[650px]:top-16 max-[650px]:z-20 max-[650px]:max-h-[350px] max-[650px]:w-[190px] max-[650px]:overflow-auto max-[650px]:rounded-lg max-[650px]:border max-[650px]:shadow-2xl">
          <div className="flex h-11 items-center justify-between border-b border-white/10 px-3.5"><strong className="text-[11px]">Vectors</strong>
            <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button className="size-6 bg-white/5"><Plus className="size-3.5" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="start" className="z-50 min-w-36 rounded-md border border-white/10 bg-zinc-900 p-1 text-zinc-300 shadow-2xl">{[...toolItems, { type: "group" as const, label: "Group", icon: Folder }].map(({ type, label, icon: Icon }) => <DropdownMenu.Item key={type} onSelect={() => addLayer(type)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none hover:bg-white/8 focus:bg-white/8"><Icon className="size-3.5" />{label}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
          </div>
          <div className="grid grid-cols-3 gap-1 border-b border-white/10 p-3 max-[650px]:hidden">
            <Button className="h-14 flex-col gap-1 text-[9px] text-zinc-500"><MousePointer2 className="size-4 text-zinc-300" />Select</Button>
            {toolItems.map(({ type, label, icon: Icon }) => <Button key={type} onClick={() => addLayer(type)} className="h-14 flex-col gap-1 text-[9px] text-zinc-500 hover:text-lime-300"><Icon className="size-4 text-zinc-300" />{label}</Button>)}
          </div>
          <div className="flex justify-between px-3.5 pb-2 pt-3 text-[9px] font-bold uppercase tracking-widest text-zinc-600"><span>Layers</span><span>{layers.length}</span></div>
          <div>
            {layers.map((layer) => {
              if (layer.parent && collapsed.includes(layer.parent)) return null;
              return <div key={layer.id} className={cn("mx-1.5 flex h-8 items-center gap-2 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/5", selected === layer.id && "bg-white/8 text-zinc-100")} style={{ paddingLeft: layer.parent ? 28 : 8 }}>
                {layer.type === "group" ? <Button className="size-4" onClick={() => toggleGroup(layer.id)} aria-label={`Toggle ${layer.name}`}>{collapsed.includes(layer.id) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</Button> : <span className="w-4" />}
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelected(layer.id)}><LayerIcon type={layer.type} /><span className="truncate">{layer.name}</span></button>
                <Button className="size-5 text-zinc-600" onClick={() => setLayers((items) => items.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item))} aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}>{layer.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</Button>
              </div>;
            })}
          </div>
        </aside>

        <section className="relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-hidden bg-[#111116] bg-[radial-gradient(#303039_.7px,transparent_.7px)] bg-size-[16px_16px] max-[650px]:col-start-1">
          <div className="pointer-events-none absolute inset-x-3 top-2.5 z-10 flex justify-between">
            <div className="pointer-events-auto flex rounded-lg border border-white/10 bg-zinc-900/95 p-0.5 shadow-xl"><Button className="size-6 bg-white/8 text-lime-300"><MousePointer2 className="size-3" /></Button><Button className="size-6 text-zinc-500"><Hand className="size-3" /></Button></div>
            <div className="pointer-events-auto flex items-center rounded-lg border border-white/10 bg-zinc-900/95 p-0.5 shadow-xl"><Button className="size-6 text-zinc-500" onClick={() => setZoom(Math.max(25, zoom - 10))}><ZoomOut className="size-3" /></Button><span className="w-11 text-center font-mono text-[9px] text-zinc-400">{zoom}%</span><Button className="size-6 text-zinc-500" onClick={() => setZoom(Math.min(150, zoom + 10))}><ZoomIn className="size-3" /></Button></div>
          </div>
          <div className="grid size-full place-items-center overflow-auto p-12 pt-14 max-[650px]:px-3">
            <div className="relative aspect-video w-[min(820px,100%)] shrink-0 overflow-hidden bg-[#f4efdf] text-[#17131f] shadow-[0_18px_55px_#0009] transition-transform" style={{ transform: `scale(${zoom / 72})` }} onClick={() => setSelected("scene")}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#907f6d_.5px,transparent_.5px)] bg-size-[5px_5px] opacity-35" />
              <span className="absolute left-[9%] top-[22%] font-mono text-[clamp(6px,.65vw,10px)] font-semibold tracking-[.18em] text-[#6e5a3d]">MOVE WITH PURPOSE</span>
              {layers.map(renderLayer)}
              <span className="absolute bottom-1 right-1.5 font-mono text-[6px] text-stone-500">1920 × 1080</span>
            </div>
          </div>
        </section>

        <aside className="col-start-3 row-start-2 overflow-y-auto border-l border-white/10 bg-zinc-900 max-[900px]:hidden">
          <div className="flex h-11 items-center justify-between border-b border-white/10 px-3.5"><strong className="text-[11px]">Properties</strong><Button className="size-7 text-zinc-500"><MoreHorizontal className="size-4" /></Button></div>
          <div className="m-3 flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[.025] p-2.5"><LayerIcon type={selectedLayer.type} className="size-4" /><div className="min-w-0 flex-1"><input className="w-full bg-transparent text-[10px] font-semibold outline-none focus:text-lime-300" value={selectedLayer.name} onChange={(event) => updateSelected({ name: event.target.value })} /><span className="block text-[8px] capitalize text-zinc-600">{selectedLayer.type}</span></div><Button className="size-7 text-zinc-600 hover:text-red-400" disabled={selectedLayer.type === "group"} onClick={deleteSelected}><Trash2 className="size-3.5" /></Button></div>
          <PropertySection title="Transform" action={<RotateCcw className="size-3" />}>
            <div className="grid grid-cols-2 gap-1.5">{(["x", "y", "width", "height", "rotation"] as const).map((key) => <NumberField key={key} label={{ x: "X", y: "Y", width: "W", height: "H", rotation: "R" }[key]} value={selectedLayer[key]} onChange={(value) => updateSelected({ [key]: value })} />)}</div>
          </PropertySection>
          <PropertySection title="Appearance" action={<Plus className="size-3" />}>
            <label className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[.025] px-2 text-[9px] text-zinc-500"><span className="w-9">Fill</span><input type="color" className="size-4 cursor-pointer rounded border-0 bg-transparent p-0" value={selectedLayer.fill} onChange={(event) => updateSelected({ fill: event.target.value })} /><input className="min-w-0 flex-1 bg-transparent font-mono text-[9px] text-zinc-400 outline-none" value={selectedLayer.fill} onChange={(event) => /^#[0-9a-f]{6}$/i.test(event.target.value) && updateSelected({ fill: event.target.value })} /></label>
            <div className="mt-3 grid grid-cols-[50px_1fr_34px] items-center text-[9px] text-zinc-500"><span>Opacity</span><Slider.Root value={[selectedLayer.opacity]} max={100} step={1} onValueChange={([opacity]) => updateSelected({ opacity })} className="relative flex h-4 touch-none select-none items-center"><Slider.Track className="relative h-0.5 flex-1 rounded bg-white/10"><Slider.Range className="absolute h-full rounded bg-lime-300" /></Slider.Track><Slider.Thumb className="block size-3 rounded-full bg-lime-300 outline-none ring-zinc-900 focus:ring-2" /></Slider.Root><span className="text-right font-mono text-[8px] text-zinc-400">{selectedLayer.opacity}%</span></div>
          </PropertySection>
        </aside>

        <section className="col-span-full row-start-3 grid grid-cols-[238px_1fr] grid-rows-[43px_1fr] border-t border-white/10 bg-zinc-900 max-[900px]:grid-cols-[190px_1fr] max-[650px]:grid-cols-[115px_1fr]">
          <div className="col-span-full grid grid-cols-[238px_1fr_auto] items-center border-b border-white/10 max-[900px]:grid-cols-[190px_1fr_auto] max-[650px]:grid-cols-[115px_1fr_auto]">
            <div className="flex justify-center gap-1"><Button className="size-6 text-zinc-600" onClick={() => setTime(Math.max(0, time - 1 / 30))}><SkipBack className="size-3" /></Button><Button className="size-6 rounded-full bg-lime-300 text-zinc-950 hover:bg-lime-200" onClick={() => setPlaying(!playing)}>{playing ? <Pause className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}</Button><Button className="size-6 text-zinc-600" onClick={() => setTime(Math.min(5, time + 1 / 30))}><SkipForward className="size-3" /></Button></div>
            <div className="flex gap-1.5 pl-3 font-mono text-[9px]"><strong className="text-lime-300">{formatTime(time)}</strong><span className="text-zinc-700">/ 00:05:00</span></div>
            <Button className="mr-3 text-[8px] text-zinc-600" onClick={() => setTime(0)}>Reset</Button>
          </div>
          <div className="min-w-0 border-r border-white/10 pt-6">{timelineLayers.slice(0, 3).map((layer) => <button key={layer.id} onClick={() => setSelected(layer.id)} className={cn("flex h-[42px] w-full min-w-0 items-center gap-2 px-3.5 text-left text-[9px] text-zinc-500", selected === layer.id && "bg-white/5 text-zinc-200")}><LayerIcon type={layer.type} /><span className="truncate">{layer.name}</span></button>)}</div>
          <div className="relative overflow-hidden bg-[linear-gradient(90deg,#25252c_1px,transparent_1px)] bg-size-[10%_100%] pt-6" onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTime(Math.max(0, Math.min(5, (event.clientX - rect.left) / rect.width * 5))); }}>
            <div className="absolute inset-x-0 top-0 h-6 border-b border-white/10">{[0, 1, 2, 3, 4, 5].map((tick) => <span key={tick} className="absolute top-1.5 font-mono text-[7px] text-zinc-600" style={{ left: `${tick * 20}%` }}>{tick}s</span>)}</div>
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-lime-300" style={{ left: `${time / 5 * 100}%` }}><span className="absolute -left-1 top-0 size-2 rounded-b-full bg-lime-300" /></div>
            {timelineLayers.slice(0, 3).map((layer, index) => <div key={layer.id} className="relative h-[42px] border-b border-white/5"><button onClick={(event) => { event.stopPropagation(); setSelected(layer.id); }} className={cn("absolute top-2 h-6 rounded border bg-violet-950/70", index === 0 ? "border-red-400/70 bg-red-950/60" : index === 2 ? "border-blue-400/70 bg-blue-950/60" : "border-violet-400/70", selected === layer.id && "ring-1 ring-lime-300")} style={{ left: `${layer.start / 5 * 100}%`, width: `${layer.duration / 5 * 100}%` }}><i className="absolute left-1 top-2 size-1.5 rotate-45 bg-zinc-200" /><i className="absolute right-1 top-2 size-1.5 rotate-45 bg-zinc-200" /></button></div>)}
          </div>
        </section>
      </main>
    </Tooltip.Provider>
  );
}

function PropertySection({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return <section className="border-t border-white/10 p-3"><h2 className="mb-3 flex items-center justify-between text-[9px] font-medium text-zinc-400"><span>{title}</span><span className="text-zinc-600">{action}</span></h2>{children}</section>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="flex h-8 items-center rounded-md border border-white/10 bg-white/[.025]"><span className="w-7 text-center font-mono text-[8px] text-zinc-600">{label}</span><input type="number" className="min-w-0 flex-1 bg-transparent font-mono text-[9px] text-zinc-400 outline-none" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
