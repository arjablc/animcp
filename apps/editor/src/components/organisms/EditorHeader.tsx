import { Download, FolderOpen, Redo2, Undo2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../atoms/Button";
import { Tip } from "../atoms/Tip";

export function EditorHeader({ name }: { name: string }) {
  return <header className="grid h-[58px] shrink-0 grid-cols-[238px_1fr_auto] items-center border-b border-white/10 bg-zinc-900 max-[900px]:grid-cols-[190px_1fr_auto] max-[650px]:h-[54px] max-[650px]:grid-cols-[1fr_auto]">
    <Link to="/" className="flex items-center gap-2.5 pl-4 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-lime-300 font-bold text-zinc-950">A</span>AniMCP</Link>
    <div className="flex items-baseline gap-2.5 border-l border-white/10 pl-5 max-[650px]:hidden"><strong className="select-text text-xs text-zinc-200">{name}</strong><span className="text-[9px] text-zinc-600">Saved locally</span></div>
    <div className="flex items-center gap-1.5 pr-3">
      <Tip label="All projects"><Link to="/projects"><Button className="size-8 text-zinc-500"><FolderOpen className="size-3.5" /></Button></Link></Tip>
      <Tip label="Undo"><Button className="size-8 text-zinc-500 max-[650px]:hidden"><Undo2 className="size-3.5" /></Button></Tip>
      <Tip label="Redo"><Button className="size-8 text-zinc-500 max-[650px]:hidden"><Redo2 className="size-3.5" /></Button></Tip>
      <Button className="h-8 border border-white/10 px-3 max-[650px]:hidden">Preview</Button>
      <Button className="h-8 gap-1.5 bg-lime-300 px-3 text-zinc-950 hover:bg-lime-200"><Download className="size-3" />Export</Button>
    </div>
  </header>;
}
