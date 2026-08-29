import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../atoms/Button";

export function SiteHeader() {
  return <header className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6"><Link to="/" className="flex items-center gap-2.5 text-sm font-semibold"><span className="grid size-8 place-items-center rounded-lg bg-lime-300 font-bold text-zinc-950">A</span>AniMCP</Link><nav className="flex items-center gap-2"><Link to="/projects"><Button className="h-9 px-3 text-zinc-400">Projects</Button></Link><Link to="/projects"><Button className="hidden h-9 gap-2 bg-zinc-100 px-4 text-zinc-950 hover:bg-lime-300 sm:flex">Open app<ArrowRight className="size-3.5" /></Button></Link></nav></header>;
}
