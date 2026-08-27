import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content sideOffset={6} className="z-50 rounded bg-zinc-100 px-2 py-1 text-[10px] text-zinc-950 shadow-lg">{label}<Tooltip.Arrow className="fill-zinc-100" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
