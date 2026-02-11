import { Step } from "../../config/registry";
import { DependencyProvider, PackageInfo } from "./DependencyProvider";

export class UvToolDependencyProvider implements DependencyProvider {
  id = "uv";

  getPackageInfo(step: Step): PackageInfo | null {
    if (!step.uninstall) return null;
    const segment = step.uninstall.split("&&")[0]?.trim() ?? "";
    const tokens = segment.split(/\s+/).filter(Boolean);
    const uvIndex = tokens.indexOf("uv");
    if (uvIndex < 0) return null;
    const toolIndex = tokens.findIndex((token, index) => index > uvIndex && token === "tool");
    if (toolIndex < 0) return null;
    const uninstallIndex = tokens.findIndex(
      (token, index) => index > toolIndex && token === "uninstall"
    );
    if (uninstallIndex < 0) return null;

    for (let i = uninstallIndex + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith("-")) continue;
      return { name: token };
    }
    return null;
  }

  async getDependents(_info: PackageInfo): Promise<string[]> {
    return [];
  }
}
