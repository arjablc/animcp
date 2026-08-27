import { useRef, useState } from "react";
import { Download, FolderOpen, Redo2, Undo2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../atoms/Button";
import { Tip } from "../atoms/Tip";

export function EditorHeader({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const lastTap = useRef(0);
  const finish = () => { if (draft.trim()) onRename(draft.trim()); else setDraft(name); setEditing(false); };
  const tapName = () => { const now = Date.now(); if (now - lastTap.current < 350) setEditing(true); lastTap.current = now; };

  return <header className="grid h-[54px] shrink-0 grid-cols-[1fr_auto] items-center border-b border-white/10 bg-zinc-900 sm:h-[58px] sm:grid-cols-[190px_1fr_auto] lg:grid-cols-[238px_1fr_auto]">
    <div className="flex min-w-0 items-center gap-2.5 pl-4"><Link to="/" className="flex shrink-0 items-center gap-2.5 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-lime-300 font-bold text-zinc-950">A</span><span className="hidden sm:inline">AniMCP</span></Link>{editing ? <input autoFocus className="select-text min-w-0 flex-1 rounded border border-lime-300/40 bg-zinc-950 px-2 py-1 text-xs outline-none sm:hidden" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={finish} onKeyDown={(event) => { if (event.key === "Enter") finish(); if (event.key === "Escape") { setDraft(name); setEditing(false); } }} /> : <strong className="select-text truncate text-[10px] text-zinc-400 sm:hidden" onPointerUp={tapName}>{name}</strong>}</div>
    <div className="hidden items-baseline gap-2.5 border-l border-white/10 pl-5 sm:flex">{editing ? <input autoFocus className="select-text w-48 rounded border border-lime-300/40 bg-zinc-950 px-2 py-1 text-xs outline-none" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={finish} onKeyDown={(event) => { if (event.key === "Enter") finish(); if (event.key === "Escape") { setDraft(name); setEditing(false); } }} /> : <strong className="select-text cursor-text text-xs text-zinc-200" title="Double tap to rename" onPointerUp={tapName}>{name}</strong>}<span className="text-[9px] text-zinc-600">Saved locally</span></div>
    <div className="flex items-center gap-1.5 pr-3">
      <Tip label="All projects"><Link to="/projects"><Button className="size-8 text-zinc-500"><FolderOpen className="size-3.5" /></Button></Link></Tip>
      <Tip label="Undo"><Button className="hidden size-8 text-zinc-500 sm:inline-flex"><Undo2 className="size-3.5" /></Button></Tip>
      <Tip label="Redo"><Button className="hidden size-8 text-zinc-500 sm:inline-flex"><Redo2 className="size-3.5" /></Button></Tip>
      <Button className="hidden h-8 border border-white/10 px-3 sm:inline-flex">Preview</Button>
      <Button className="h-8 gap-1.5 bg-lime-300 px-3 text-zinc-950 hover:bg-lime-200"><Download className="size-3" />Export</Button>
    </div>
  </header>;
}
