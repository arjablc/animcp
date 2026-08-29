import { MoreHorizontal, PenLine, Trash2 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link } from "react-router-dom";
import type { Project } from "../../lib/projects";
import { Button } from "../atoms/Button";

export function ProjectCard({ project, onDelete, onRename }: { project: Project; onDelete: () => void; onRename: () => void }) {
  return <article className="group overflow-hidden rounded-xl border border-white/10 bg-zinc-900 transition hover:-translate-y-0.5 hover:border-white/20">
    <Link to={`/app/${project.id}`} className="block">
      <div className="grid aspect-video place-items-center bg-[#f4efdf] text-[10px] font-semibold uppercase tracking-[.16em] text-stone-400">{Math.max(0, project.layers.length - 1)} layers</div>
    </Link>
    <div className="flex items-center gap-3 p-3.5"><div className="min-w-0 flex-1"><Link to={`/app/${project.id}`} className="select-text block truncate text-sm font-semibold text-zinc-100 hover:text-lime-300">{project.name}</Link><p className="mt-1 text-[10px] text-zinc-600">Edited {new Date(project.updatedAt).toLocaleDateString()}</p></div>
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button className="size-8 text-zinc-500"><MoreHorizontal className="size-4" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-36 rounded-md border border-white/10 bg-zinc-900 p-1 text-zinc-300 shadow-2xl"><DropdownMenu.Item onSelect={onRename} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none focus:bg-white/8"><PenLine className="size-3.5" />Rename</DropdownMenu.Item><DropdownMenu.Item onSelect={onDelete} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-red-400 outline-none focus:bg-red-500/10"><Trash2 className="size-3.5" />Delete</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    </div>
  </article>;
}
