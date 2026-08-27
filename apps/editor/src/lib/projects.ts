import { initialLayers, type Layer } from "../editor/model";

const storageKey = "animcp.projects.v1";

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layers: Layer[];
};

export function createProject(name = "Untitled project", now = new Date()): Project {
  const timestamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    layers: structuredClone(initialLayers),
  };
}

export function getProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Project[];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(storageKey, JSON.stringify(projects));
}

export function saveProject(project: Project) {
  const projects = getProjects();
  const index = projects.findIndex((item) => item.id === project.id);
  const next = { ...project, updatedAt: new Date().toISOString() };
  if (index === -1) projects.unshift(next);
  else projects[index] = next;
  saveProjects(projects);
  return next;
}

export function deleteProject(id: string) {
  saveProjects(getProjects().filter((project) => project.id !== id));
}
