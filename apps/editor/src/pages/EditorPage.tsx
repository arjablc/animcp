import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EditorShell } from "../components/organisms/EditorShell";
import { getProjects, saveProject } from "../lib/projects";

export function EditorPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(() => getProjects().find((item) => item.id === projectId));
  if (!project) return <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-300"><div className="text-center"><h1 className="text-xl font-semibold">Project not found</h1><Link to="/projects" className="mt-4 block text-xs text-lime-300">Back to projects</Link></div></main>;
  const persist = (patch: Partial<typeof project>) => setProject((current) => current ? saveProject({ ...current, ...patch }) : current);
  return <EditorShell project={project} onSave={(layers) => persist({ layers })} onRename={(name) => persist({ name })} />;
}
