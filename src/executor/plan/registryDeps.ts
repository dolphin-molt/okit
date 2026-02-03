import { Step, Registry } from "../../config/registry";

export function getAllDependencies(
  step: Step,
  registry: Registry,
  visited: Set<string> = new Set()
): Step[] {
  if (!step.dependencies || step.dependencies.length === 0) {
    return [];
  }

  const deps: Step[] = [];
  for (const depName of step.dependencies) {
    if (visited.has(depName)) continue;
    visited.add(depName);

    const depStep = registry.steps.find((s) => s.name === depName);
    if (depStep) {
      const nestedDeps = getAllDependencies(depStep, registry, visited);
      deps.push(...nestedDeps);
      deps.push(depStep);
    }
  }
  return deps;
}
