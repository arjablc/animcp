import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, Folder, PenTool, Plus, Sparkles, Square, Type } from "lucide-react";
import type { Layer, LayerType } from "../../editor/model";
import { toolTypes } from "../../editor/model";
import { cn } from "../../lib/cn";
import { Button } from "../atoms/Button";
import { LayerIcon } from "../atoms/LayerIcon";

const icons = { rectangle: Square, ellipse: Circle, path: PenTool, text: Type, star: Sparkles };
const labels = { rectangle: "Shape", ellipse: "Ellipse", path: "Path", text: "Text", star: "Star" };

export function LayersPanel({ layers, selected, onSelect, onAdd, onChange }: { layers: Layer[]; selected: string; onSelect: (id: string) => void; onAdd: (type: LayerType) => void; onChange: (id: string, patch: Partial<Layer>) => void }) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const lastTap = useRef<{ id: string; time: number } | undefined>(undefined);
  const toggleGroup = (id: string) => setCollapsed((groups) => groups.includes(id) ? groups.filter((group) => group !== id) : [...groups, id]);
  const finishRename = (id: string) => { if (draft.trim()) onChange(id, { name: draft.trim() }); setEditing(undefined); };
  const activate = (layer: Layer) => {
    const now = Date.now();
    if (lastTap.current?.id === layer.id && now - lastTap.current.time < 350) { setDraft(layer.name); setEditing(layer.id); }
    else onSelect(layer.id);
    lastTap.current = { id: layer.id, time: now };
  };

  return <aside className="size-full min-w-0 overflow-y-auto bg-zinc-900">
    <div className="flex h-11 items-center justify-between border-b border-white/10 px-3.5"><strong className="text-[11px]">Vectors</strong>
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button className="size-6 bg-white/5"><Plus className="size-3.5" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="start" className="z-50 min-w-36 rounded-md border border-white/10 bg-zinc-900 p-1 text-zinc-300 shadow-2xl">{[...toolTypes, "group" as const].map((type) => { const Icon = type === "group" ? Folder : icons[type]; return <DropdownMenu.Item key={type} onSelect={() => onAdd(type)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none focus:bg-white/8"><Icon className="size-3.5" />{type === "group" ? "Group" : labels[type]}</DropdownMenu.Item>; })}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    </div>
    <div className="flex justify-between px-3.5 pb-2 pt-3 text-[9px] font-bold uppercase tracking-widest text-zinc-600"><span>Layers</span><span>{layers.length}</span></div>
    {layers.map((layer) => {
      if (layer.parent && collapsed.includes(layer.parent)) return null;
      return <div key={layer.id} data-layer-id={layer.id} draggable={editing !== layer.id} onDragStart={(event) => { event.dataTransfer.setData("application/x-animcp-layer", layer.id); event.dataTransfer.effectAllowed = "move"; onSelect(layer.id); }} className={cn("mx-1.5 flex h-8 items-center gap-2 rounded-md px-2 text-[10px] text-zinc-400 hover:bg-white/5", selected === layer.id && "bg-white/8 text-zinc-100")} style={{ paddingLeft: layer.parent ? 28 : 8 }}>
        {layer.type === "group" ? <Button className="size-4" onClick={() => toggleGroup(layer.id)} aria-label={`Toggle ${layer.name}`}>{collapsed.includes(layer.id) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</Button> : <span className="w-4" />}
        <div className="flex min-w-0 flex-1 items-center gap-2" onPointerUp={() => activate(layer)}><LayerIcon type={layer.type} />{editing === layer.id ? <input autoFocus className="select-text min-w-0 flex-1 rounded bg-zinc-950 px-1 py-0.5 text-[10px] outline-none ring-1 ring-lime-300/50" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => finishRename(layer.id)} onPointerUp={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter") finishRename(layer.id); if (event.key === "Escape") setEditing(undefined); }} /> : <span className="select-text truncate">{layer.name}</span>}</div>
        <Button className="size-5 text-zinc-600" onClick={() => onChange(layer.id, { visible: !layer.visible })} aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}>{layer.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</Button>
      </div>;
    })}
  </aside>;
}
