import { Step, Registry } from "../../config/registry";
import { BrewDependencyProvider } from "../deps/BrewDependencyProvider";
import { NpmDependencyProvider } from "../deps/NpmDependencyProvider";
import { PipxDependencyProvider } from "../deps/PipxDependencyProvider";
import { DependencyProvider, PackageInfo } from "../deps/DependencyProvider";
import { getAllDependencies } from "./registryDeps";
import { topologicalSortSteps } from "./TopologicalSorter";

export type ExecutionPlan = {
  ordered: Step[];
  addedDeps: Set<string>;
  externalDependents: Map<string, string[]>;
  missingDeps: Map<string, string[]>;
};

export class ExecutionPlanner {
  static async build(
    steps: Step[],
    action: "install" | "upgrade" | "uninstall",
    registry: Registry
  ): Promise<ExecutionPlan> {
    const providers: DependencyProvider[] = [
      new BrewDependencyProvider(),
      new NpmDependencyProvider(),
      new PipxDependencyProvider(),
    ];

    let planSteps = steps;
    let addedDeps = new Set<string>();

    if (action === "install") {
      const expanded = this.expandStepsForInstall(steps, registry);
      planSteps = expanded.expanded;
      addedDeps = expanded.addedDeps;
    }

    const stepsByName = new Map(planSteps.map((s) => [s.name, s]));
    const edges = new Map<string, Set<string>>();
    const ensureEdgeSet = (name: string) => {
      if (!edges.has(name)) edges.set(name, new Set());
      return edges.get(name)!;
    };

    const missingDeps = new Map<string, string[]>();
    for (const step of planSteps) {
      const deps = step.dependencies || [];
      for (const depName of deps) {
        if (!stepsByName.has(depName)) {
          if (!missingDeps.has(step.name)) missingDeps.set(step.name, []);
          missingDeps.get(step.name)!.push(depName);
          continue;
        }
        if (action === "uninstall") {
          ensureEdgeSet(step.name).add(depName);
        } else {
          ensureEdgeSet(depName).add(step.name);
        }
      }
    }

    const externalDependents = new Map<string, string[]>();
    if (action === "uninstall") {
      await this.applyProviderEdges(planSteps, providers, ensureEdgeSet, externalDependents);
    }

    const ordered = topologicalSortSteps(planSteps, edges) || planSteps;
    return { ordered, addedDeps, externalDependents, missingDeps };
  }

  private static expandStepsForInstall(
    steps: Step[],
    registry: Registry
  ): { expanded: Step[]; addedDeps: Set<string> } {
    const selectedNames = new Set(steps.map((s) => s.name));
    const addedDeps = new Set<string>();
    const allNames = new Set<string>(selectedNames);

    for (const step of steps) {
      const deps = getAllDependencies(step, registry);
      for (const dep of deps) {
        if (!allNames.has(dep.name)) {
          addedDeps.add(dep.name);
          allNames.add(dep.name);
        }
      }
    }

    const expanded = registry.steps.filter((s) => allNames.has(s.name));
    return { expanded, addedDeps };
  }

  private static async applyProviderEdges(
    steps: Step[],
    providers: DependencyProvider[],
    ensureEdgeSet: (name: string) => Set<string>,
    externalDependents: Map<string, string[]>
  ): Promise<void> {
    for (const provider of providers) {
      const infoByStep = new Map<string, PackageInfo>();
      const nameToStep = new Map<string, Step>();

      for (const step of steps) {
        const info = provider.getPackageInfo(step);
        if (!info) continue;
        infoByStep.set(step.name, info);
        nameToStep.set(info.name, step);
      }

      for (const [stepName, info] of infoByStep.entries()) {
        const dependents = await provider.getDependents(info);
        const internal: string[] = [];
        const external: string[] = [];

        for (const depName of dependents) {
          if (nameToStep.has(depName)) internal.push(depName);
          else external.push(depName);
        }

        if (external.length > 0 && provider.id === "brew") {
          const existing = externalDependents.get(stepName) || [];
          externalDependents.set(stepName, existing.concat(external));
        }

        for (const internalName of internal) {
          const internalStep = nameToStep.get(internalName);
          if (!internalStep) continue;
          ensureEdgeSet(internalStep.name).add(stepName);
        }
      }
    }
  }
}
