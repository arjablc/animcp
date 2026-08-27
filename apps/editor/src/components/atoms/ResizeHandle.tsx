import { GripVertical } from "lucide-react";
import { PanelResizeHandle } from "react-resizable-panels";

export function ResizeHandle({ direction = "horizontal" }: { direction?: "horizontal" | "vertical" }) {
  return <PanelResizeHandle className={direction === "horizontal" ? "group relative z-20 w-px bg-white/10 outline-none after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-lime-300 focus-visible:bg-lime-300" : "group relative z-20 h-px bg-white/10 outline-none after:absolute after:inset-x-0 after:-top-1 after:h-2 hover:bg-lime-300 focus-visible:bg-lime-300"}>{direction === "horizontal" && <span className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-800 py-1 group-hover:block"><GripVertical className="size-3 text-zinc-500" /></span>}</PanelResizeHandle>;
}
