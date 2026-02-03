import { Step } from "../../config/registry";

export function topologicalSortSteps(
  steps: Step[],
  edges: Map<string, Set<string>>
): Step[] | null {
  const stepsByName = new Map(steps.map((s) => [s.name, s]));
  const inDegree = new Map<string, number>();

  for (const step of steps) {
    inDegree.set(step.name, 0);
  }
  for (const [from, tos] of edges.entries()) {
    if (!stepsByName.has(from)) continue;
    for (const to of tos) {
      if (!stepsByName.has(to)) continue;
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }
  }

  const queue: Step[] = [];
  for (const step of steps) {
    if ((inDegree.get(step.name) || 0) === 0) {
      queue.push(step);
    }
  }

  const ordered: Step[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    ordered.push(current);
    const neighbors = edges.get(current.name);
    if (!neighbors) continue;
    for (const next of neighbors) {
      const degree = (inDegree.get(next) || 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        const step = stepsByName.get(next);
        if (step) queue.push(step);
      }
    }
  }

  if (ordered.length !== steps.length) {
    return null;
  }
  return ordered;
}
