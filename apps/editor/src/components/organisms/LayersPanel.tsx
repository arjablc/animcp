import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, Folder, MousePointer2, PenTool, Plus, Sparkles, Square, Type } from "lucide-react";
import type { Layer, LayerType } from "../../editor/model";
import { toolTypes } from "../../editor/model";
import { cn } from "../../lib/cn";
import { Button } from "../atoms/Button";
import { LayerIcon } from "../atoms/LayerIcon";

const icons = { rectangle: Square, ellipse: Circle, path: PenTool, text: Type, star: Sparkles };
const labels = { rectangle: "Shape", ellipse: "Ellipse", path: "Path", text: "Text", star: "Star" };

export function LayersPanel({ layers, selected, onSelect, onAdd, onToggleVisibility }: { layers: Layer[]; selected: string; onSelect: (id: string) => void; onAdd: (type: LayerType) => void; onToggleVisibility: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggleGroup = (id: string) => setCollapsed((groups) => groups.includes(id) ? groups.filter((group) => group !== id) : [...groups, id]);

  return <aside className="size-full min-w-0 overflow-y-auto bg-zinc-900">
    <div className="flex h-11 items-center justify-between border-b border-white/10 px-3.5"><strong className="text-[11px]">Vectors</strong>
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button className="size-6 bg-white/5"><Plus className="size-3.5" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="start" className="z-50 min-w-36 rounded-md border border-white/10 bg-zinc-900 p-1 text-zinc-300 shadow-2xl">{[...toolTypes, "group" as const].map((type) => { const Icon = type === "group" ? Folder : icons[type]; return <DropdownMenu.Item key={type} onSelect={() => onAdd(type)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none focus:bg-white/8"><Icon className="size-3.5" />{type === "group" ? "Group" : labels[type]}</DropdownMenu.Item>; })}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    </div>
    <div className="grid grid-cols-3 gap-1 border-b border-white/10 p-3 max-[650px]:hidden"><Button className="h-14 flex-col gap-1 text-[9px] text-zinc-500"><MousePointer2 className="size-4 text-zinc-300" />Select</Button>{toolTypes.map((type) => { const Icon = icons[type]; return <Button key={type} onClick={() => onAdd(type)} className="h-14 flex-col gap-1 text-[9px] text-zinc-500 hover:text-lime-300"><Icon className="size-4 text-zinc-300" />{labels[type]}</Button>; })}</div>
    <div className="flex justify-between px-3.5 pb-2 pt-3 text-[9px] font-bold uppercase tracking-widest text-zinc-600"><span>Layers</span><span>{layers.length}</span></div>
    {layers.map((layer) => {
      if (layer.parent && collapsed.includes(layer.parent)) return null;
      return <div key={layer.id} className={cn("mx-1.5 flex h-8 items-center gap-2 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/5", selected === layer.id && "bg-white/8 text-zinc-100")} style={{ paddingLeft: layer.parent ? 28 : 8 }}>
        {layer.type === "group" ? <Button className="size-4" onClick={() => toggleGroup(layer.id)} aria-label={`Toggle ${layer.name}`}>{collapsed.includes(layer.id) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</Button> : <span className="w-4" />}
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(layer.id)}><LayerIcon type={layer.type} /><span className="select-text truncate">{layer.name}</span></button>
        <Button className="size-5 text-zinc-600" onClick={() => onToggleVisibility(layer.id)} aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}>{layer.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</Button>
      </div>;
    })}
  </aside>;
}
