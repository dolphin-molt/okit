import { Step } from "../../config/registry";

export interface PackageInfo {
  name: string;
  meta?: Record<string, unknown>;
}

export interface DependencyProvider {
  id: string;
  getPackageInfo(step: Step): PackageInfo | null;
  getDependents(info: PackageInfo): Promise<string[]>;
}
