import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PACKAGE_NAME,
  queryLatestVersion,
  installPackage,
  upgradeSelf,
  UpgradeDeps,
} from "../../src/commands/upgrade";

function makeDeps(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps & {
  calls: { cmd: string; args: string[] }[];
  logs: string[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  const logs: string[] = [];
  const recordRun = overrides.run ?? (async () => ({ stdout: "" }));
  return {
    calls,
    logs,
    run: async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return recordRun(cmd, args);
    },
    exit: overrides.exit ?? ((code: number) => {
      process.exitCode = code;
    }),
    log: (m: string) => logs.push(m),
    logError: (m: string) => logs.push(m),
  } as any;
}

describe("okit upgrade", () => {
  beforeEach(() => {
    process.exitCode = 0;
  });
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it("uses the scoped npm package name @cing-self/okit-cli", () => {
    expect(PACKAGE_NAME).toBe("@cing-self/okit-cli");
  });

  it("does not treat the bare 'okit-cli' as the npm package", () => {
    expect(PACKAGE_NAME).not.toBe("okit-cli");
  });

  it("queryLatestVersion shells out via the npm CLI with the package name", async () => {
    const deps = makeDeps({
      run: async (cmd, args) => ({ stdout: "2.3.0" }),
    });
    const version = await queryLatestVersion(deps);
    expect(version).toBe("2.3.0");
    expect(deps.calls[0]).toEqual({ cmd: "npm", args: ["view", PACKAGE_NAME, "version"] });
  });

  it("queryLatestVersion returns null when npm view fails", async () => {
    const deps = makeDeps({
      run: async () => {
        throw new Error("network down");
      },
    });
    const version = await queryLatestVersion(deps);
    expect(version).toBeNull();
  });

  it("installPackage runs npm update -g with the package name", async () => {
    const deps = makeDeps({
      run: async () => ({ stdout: "" }),
    });
    const ok = await installPackage(deps);
    expect(ok).toBe(true);
    expect(deps.calls[0]).toEqual({ cmd: "npm", args: ["update", "-g", PACKAGE_NAME] });
  });

  it("installPackage returns false and logs on failure", async () => {
    const deps = makeDeps({
      run: async () => {
        throw new Error("EACCES permission denied");
      },
    });
    const ok = await installPackage(deps);
    expect(ok).toBe(false);
    expect(deps.logs.some((l) => l.includes("升级失败"))).toBe(true);
  });

  it("exits 0 and skips install when already the latest version", async () => {
    const exit = vi.fn();
    const deps = makeDeps({
      run: async () => ({ stdout: "2.3.0" }),
      exit,
    });
    await upgradeSelf(deps);
    expect(deps.calls.filter((c) => c.cmd === "npm" && c.args[0] === "update").length).toBe(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("installs and exits 0 when a newer version exists", async () => {
    const exit = vi.fn();
    const deps = makeDeps({
      run: async (cmd, args) => {
        if (args[0] === "view") return { stdout: "2.3.1" };
        return { stdout: "" };
      },
      exit,
    });
    await upgradeSelf(deps);
    expect(deps.calls.some((c) => c.args[0] === "update")).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits 1 when the version query fails", async () => {
    const exit = vi.fn();
    const deps = makeDeps({
      run: async () => {
        throw new Error("npm view failed");
      },
      exit,
    });
    await upgradeSelf(deps);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits 1 when the install fails", async () => {
    const exit = vi.fn();
    const deps = makeDeps({
      run: async (cmd, args) => {
        if (args[0] === "view") return { stdout: "2.3.1" };
        throw new Error("EACCES permission denied");
      },
      exit,
    });
    await upgradeSelf(deps);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("never invokes sudo", async () => {
    const deps = makeDeps({
      run: async (cmd, args) => {
        if (args[0] === "view") return { stdout: "2.3.1" };
        return { stdout: "" };
      },
    });
    await upgradeSelf(deps);
    expect(deps.calls.some((c) => c.cmd === "sudo")).toBe(false);
  });
});
