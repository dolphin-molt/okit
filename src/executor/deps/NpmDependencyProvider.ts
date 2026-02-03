import execa from "execa";
import { Step } from "../../config/registry";
import { DependencyProvider, PackageInfo } from "./DependencyProvider";

type NpmTree = {
  name?: string;
  dependencies?: Record<string, NpmTree>;
};

export class NpmDependencyProvider implements DependencyProvider {
  id = "npm";
  private dependentsCache: Map<string, string[]> | null = null;
  private loadError = false;

  getPackageInfo(step: Step): PackageInfo | null {
    if (!step.uninstall) return null;
    const segment = step.uninstall.split("&&")[0]?.trim() ?? "";
    const tokens = segment.split(/\s+/).filter(Boolean);
    const npmIndex = tokens.indexOf("npm");
    if (npmIndex < 0) return null;
    const uninstallIndex = tokens.findIndex(
      (token, index) =>
        index > npmIndex && (token === "uninstall" || token === "remove")
    );
    if (uninstallIndex < 0) return null;

    for (let i = uninstallIndex + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith("-")) continue;
      return { name: token };
    }
    return null;
  }

  async getDependents(info: PackageInfo): Promise<string[]> {
    if (this.loadError) return [];
    if (!this.dependentsCache) {
      this.dependentsCache = await this.buildDependentsCache();
    }
    return this.dependentsCache.get(info.name) || [];
  }

  private async buildDependentsCache(): Promise<Map<string, string[]>> {
    try {
      const { stdout } = await execa.command("npm ls -g --json --all", {
        shell: true,
      });
      const tree = JSON.parse(stdout) as NpmTree;
      return this.buildReverseDependencies(tree);
    } catch {
      this.loadError = true;
      return new Map();
    }
  }

  private buildReverseDependencies(tree: NpmTree): Map<string, string[]> {
    const rootName = tree.name;
    const reverse = new Map<string, Set<string>>();

    const walk = (node: NpmTree, parentName?: string) => {
      if (!node.dependencies) return;
      for (const [depName, depNode] of Object.entries(node.dependencies)) {
        if (parentName && parentName !== rootName) {
          if (!reverse.has(depName)) reverse.set(depName, new Set());
          reverse.get(depName)!.add(parentName);
        }
        walk(depNode, depName);
      }
    };

    walk(tree, tree.name);

    const result = new Map<string, string[]>();
    for (const [name, deps] of reverse.entries()) {
      result.set(name, Array.from(deps));
    }
    return result;
  }
}
