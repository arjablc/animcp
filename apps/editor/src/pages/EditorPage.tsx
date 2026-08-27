import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { EditorShell } from "../components/organisms/EditorShell";
import { getProjects, saveProject } from "../lib/projects";

export function EditorPage() {
  const { projectId } = useParams();
  const project = useMemo(() => getProjects().find((item) => item.id === projectId), [projectId]);
  if (!project) return <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-300"><div className="text-center"><h1 className="text-xl font-semibold">Project not found</h1><Link to="/projects" className="mt-4 block text-xs text-lime-300">Back to projects</Link></div></main>;
  return <EditorShell project={project} onSave={(layers) => saveProject({ ...project, layers })} />;
}
