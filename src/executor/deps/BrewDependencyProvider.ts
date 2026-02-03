import execa from "execa";
import { Step } from "../../config/registry";
import { DependencyProvider, PackageInfo } from "./DependencyProvider";

export class BrewDependencyProvider implements DependencyProvider {
  id = "brew";

  getPackageInfo(step: Step): PackageInfo | null {
    if (!step.uninstall) return null;
    const segment = step.uninstall.split("&&")[0]?.trim() ?? "";
    const tokens = segment.split(/\s+/).filter(Boolean);
    const brewIndex = tokens.indexOf("brew");
    if (brewIndex < 0) return null;
    const uninstallIndex = tokens.indexOf("uninstall", brewIndex + 1);
    if (uninstallIndex < 0) return null;

    let isCask = false;
    for (let i = uninstallIndex + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "--cask") {
        isCask = true;
        continue;
      }
      if (token.startsWith("-")) continue;
      return { name: token, meta: { isCask } };
    }
    return null;
  }

  async getDependents(info: PackageInfo): Promise<string[]> {
    const isCask = Boolean(info.meta && info.meta.isCask);
    const caskFlag = isCask ? "--cask " : "";
    try {
      const { stdout } = await execa.command(
        `brew uses --installed ${caskFlag}${info.name}`,
        { shell: true }
      );
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
