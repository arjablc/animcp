import type { P5Project } from "./project";

const storageKey = "animcp.p5-projects.v1";

export function getProjects(): P5Project[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter(isProject) : [];
  } catch {
    return [];
  }
}

export function getProject(id: string) {
  return getProjects().find((project) => project.id === id);
}

export function saveProject(project: P5Project) {
  const projects = getProjects();
  const index = projects.findIndex((item) => item.id === project.id);
  if (index === -1) projects.unshift(project);
  else projects[index] = project;
  localStorage.setItem(storageKey, JSON.stringify(projects));
}

export function deleteProject(id: string) {
  localStorage.setItem(storageKey, JSON.stringify(getProjects().filter((project) => project.id !== id)));
}

function isProject(value: unknown): value is P5Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<P5Project>;
  return project.version === 1 && typeof project.id === "string" && typeof project.name === "string" && typeof project.source === "string" && typeof project.revision === "number" && !!project.config && !!project.schema;
}
