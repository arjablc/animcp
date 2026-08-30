<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import type { P5Project } from "./project";

  let { project, ondelete } = $props<{ project: P5Project; ondelete: () => void }>();
</script>

<Card class="project-card">
  <a href={`/projects/${project.id}`}>
    <div class="project-preview"><span>{project.name.slice(0, 2).toUpperCase()}</span></div>
    <h3>{project.name}</h3>
    <p>Revision {project.revision} · {new Date(project.updatedAt).toLocaleDateString()}</p>
  </a>
  <Button variant="ghost" size="xs" class="delete" aria-label={`Delete ${project.name}`} onclick={ondelete}>Delete</Button>
</Card>
