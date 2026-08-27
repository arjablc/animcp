import { Circle, Folder, PenTool, Sparkles, Square, Type } from "lucide-react";
import type { LayerType } from "../../editor/model";
import { cn } from "../../lib/cn";

const icons = { group: Folder, rectangle: Square, ellipse: Circle, path: PenTool, text: Type, star: Sparkles };

export function LayerIcon({ type, className }: { type: LayerType; className?: string }) {
  const Icon = icons[type];
  return <Icon className={cn("size-3.5 shrink-0", type === "path" && "text-violet-400", className)} strokeWidth={1.6} />;
}
