import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

const LandingPage = lazy(() => import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const EditorPage = lazy(() => import("./pages/EditorPage").then((module) => ({ default: module.EditorPage })));

export function App() {
  return <BrowserRouter><Suspense fallback={<main className="min-h-screen bg-zinc-950" />}><Routes><Route path="/" element={<LandingPage />} /><Route path="/projects" element={<ProjectsPage />} /><Route path="/app/:projectId" element={<EditorPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></BrowserRouter>;
}
