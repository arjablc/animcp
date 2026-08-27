import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/atoms/Button";
import { ProjectCard } from "../components/molecules/ProjectCard";
import { SiteHeader } from "../components/organisms/SiteHeader";
import { createProject, deleteProject, getProjects, saveProject, type Project } from "../lib/projects";

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState(getProjects);
  const [name, setName] = useState("");

  function addProject() {
    const project = saveProject(createProject(name.trim() || "Untitled project"));
    setProjects(getProjects());
    navigate(`/app/${project.id}`);
  }

  function rename(project: Project) {
    const name = window.prompt("Project name", project.name)?.trim();
    if (!name) return;
    saveProject({ ...project, name });
    setProjects(getProjects());
  }

  return <main className="min-h-screen bg-zinc-950 text-zinc-100"><SiteHeader /><section className="mx-auto max-w-7xl px-6 pb-20 pt-12"><div className="flex flex-col justify-between gap-6 border-b border-white/10 pb-10 sm:flex-row sm:items-end"><div><p className="mb-3 text-[10px] font-semibold uppercase tracking-[.16em] text-lime-300">Your workspace</p><h1 className="select-text text-4xl font-bold tracking-[-.05em]">Projects</h1><p className="select-text mt-3 text-sm text-zinc-500">Stored locally in this browser.</p></div><div className="flex max-w-sm gap-2"><input className="select-text min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-900 px-3 text-xs outline-none placeholder:text-zinc-700 focus:border-lime-300/50" placeholder="Project name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addProject()} /><Button onClick={addProject} className="h-10 gap-2 bg-lime-300 px-4 text-zinc-950 hover:bg-lime-200"><Plus className="size-4" />New project</Button></div></div>
    {projects.length ? <div className="grid gap-5 pt-8 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <ProjectCard key={project.id} project={project} onRename={() => rename(project)} onDelete={() => { deleteProject(project.id); setProjects(getProjects()); }} />)}</div> : <div className="grid min-h-[420px] place-items-center"><div className="text-center"><div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-white/10 bg-zinc-900"><Plus className="size-5 text-zinc-500" /></div><h2 className="text-lg font-semibold">No projects yet</h2><p className="mt-2 text-xs text-zinc-600">Name your first project above and start building.</p><Button onClick={addProject} className="mt-5 h-9 gap-2 border border-white/10 px-4">Create first project<ArrowRight className="size-3.5" /></Button></div></div>}
  </section></main>;
}
