import { Step, Registry, resolveCmd } from "../../config/registry";

// 判断一个 step 在当前平台上是否可用（有安装命令）
function isAvailableOnCurrentPlatform(step: Step): boolean {
  return resolveCmd(step.install) !== undefined;
}

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
    if (!depStep) continue;

    // 跳过当前平台不可用的依赖（如 Linux 上的 Homebrew）
    if (!isAvailableOnCurrentPlatform(depStep)) continue;

    const nestedDeps = getAllDependencies(depStep, registry, visited);
    deps.push(...nestedDeps);
    deps.push(depStep);
  }
  return deps;
}
