import type { ReactNode } from "react";

export function PropertySection({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return <section className="border-t border-white/10 p-3"><h2 className="mb-3 flex items-center justify-between text-[9px] font-medium text-zinc-400"><span>{title}</span><span className="text-zinc-600">{action}</span></h2>{children}</section>;
}
